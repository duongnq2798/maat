// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Action, Reason, Intent, Mandate, TokenConfig} from "./Types.sol";
import {GuardLib} from "./GuardLib.sol";
import {IMandateVaultEvents} from "./IMandateVaultEvents.sol";
import {PriceLib} from "./lib/PriceLib.sol";
import {TokenTransfer} from "./lib/TokenTransfer.sol";
import {IB20Asset} from "./interfaces/IB20Asset.sol";
import {IERC20Minimal, ICLPool, IAggregatorV3} from "./interfaces/IExternal.sol";
import {ISwapAdapter} from "./adapters/ISwapAdapter.sol";
import {ICreditAdapter} from "./adapters/ICreditAdapter.sol";
import {MarketCalendar} from "./MarketCalendar.sol";

/// @title MandateVault — "LLM proposes, contract decides."
/// @notice Holds an agent's USDC + tokenized-stock treasury. The executor submits intents; the vault applies
/// the mandate and market guards and records every verdict, including refusals, as a Decision event.
contract MandateVault is IMandateVaultEvents {
    using TokenTransfer for address;

    uint256 public constant TIMELOCK = 24 hours;
    /// @notice A queued change must be applied within this window after its eta, or it expires.
    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant MAX_DERISK_WINDOW = 12 hours;
    uint256 internal constant FRIDAY = 5; // DateLib.weekday: 0 = Sunday
    uint256 internal constant FEED_FREEZE_MINUTE = 20 * 60; // Fri 20:00 ET: Chainlink equity feeds stop

    address public immutable owner;
    address public immutable usdc;
    address public immutable policyRegistry;
    address public executor;
    bool public paused;

    Mandate internal _mandate;
    mapping(address => TokenConfig) public tokenConfig;
    mapping(address => bool) internal _listed;
    address[] internal _tokens;
    mapping(address => bool) public allowedPayee;
    address[] internal _payees;
    mapping(address => uint256) internal _payeeIndex; // 1-based position in _payees, 0 = absent

    mapping(bytes32 => bool) public usedIntent;
    mapping(uint256 utcDay => uint256) public spentOnDay;
    mapping(address => uint256) public lastMultiplier;
    mapping(address => uint256) public multiplierChangedAt;
    mapping(bytes32 => uint256) public queuedAt;
    uint256 public recordedUsdc;

    error NotOwner();
    error NotExecutor();
    error ZeroAddress();
    error LengthMismatch();
    error BadUsdcDecimals();
    error InvalidConfig();
    error IntentAlreadyUsed(bytes32 id);
    error ChangeNotQueued(bytes32 changeHash);
    error ChangeNotReady(bytes32 changeHash, uint256 eta);
    error ChangeExpired(bytes32 changeHash);
    error CreditPositionOpen();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address owner_,
        address executor_,
        address usdc_,
        address policyRegistry_,
        Mandate memory mandate_,
        address[] memory tokens_,
        TokenConfig[] memory configs_,
        address[] memory payees_
    ) {
        if (owner_ == address(0) || executor_ == address(0) || usdc_ == address(0) || policyRegistry_ == address(0)) {
            revert ZeroAddress();
        }
        if (tokens_.length != configs_.length) revert LengthMismatch();
        if (IERC20Minimal(usdc_).decimals() != 6) revert BadUsdcDecimals();
        owner = owner_;
        executor = executor_;
        usdc = usdc_;
        policyRegistry = policyRegistry_;
        _requireValidMandate(mandate_);
        _mandate = mandate_;
        emit MandateApplied(keccak256(abi.encode(mandate_)));
        for (uint256 i; i < tokens_.length; ++i) {
            _setToken(tokens_[i], configs_[i]);
        }
        for (uint256 i; i < payees_.length; ++i) {
            if (payees_[i] == address(0)) revert ZeroAddress();
            _setPayee(payees_[i], true);
        }
        emit PolicyHashUpdated(policyHash());
    }

    // ------------------------------------------------------------------ executor

    function execute(Intent calldata intent) external returns (bool allowed, Reason reason) {
        if (msg.sender != executor) revert NotExecutor();
        if (usedIntent[intent.id]) revert IntentAlreadyUsed(intent.id);
        usedIntent[intent.id] = true;
        if (_hasMarket(tokenConfig[intent.token])) _syncMultiplier(intent.token);

        uint256 price;
        (reason, price) = _check(intent);
        if (reason == Reason.OK) reason = _perform(intent, price);
        allowed = reason == Reason.OK;
        emit Decision(intent.id, intent.action, intent.token, intent.amount, allowed, reason, intent.rationaleHash);
    }

    /// @notice Same verdict execute() would reach before acting. Cannot predict SWAP_FAILED / TRANSFER_FAILED /
    /// CREDIT_FAILED, nor the adapter's own post-action health check on WITHDRAW_COLLATERAL against debt.
    /// @dev Does not check usedIntent: a reused id previews normally but execute() reverts IntentAlreadyUsed.
    function previewIntent(Intent calldata intent) external view returns (Reason reason) {
        (reason,) = _check(intent);
    }

    // ------------------------------------------------------------------ anyone

    function notifyRevenue() public returns (uint256 amount) {
        uint256 bal = IERC20Minimal(usdc).balanceOf(address(this));
        if (bal > recordedUsdc) {
            amount = bal - recordedUsdc;
            emit RevenueReceived(amount);
        }
        recordedUsdc = bal;
    }

    function syncMultiplier(address token) external {
        if (_hasMarket(tokenConfig[token])) _syncMultiplier(token);
    }

    // ------------------------------------------------------------------ owner

    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        executor = newExecutor;
        emit ExecutorSet(newExecutor);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function withdraw(address token, uint256 amount) external onlyOwner {
        if (token == usdc) notifyRevenue();
        token.safeTransfer(owner, amount);
        if (token == usdc) recordedUsdc = IERC20Minimal(usdc).balanceOf(address(this));
        emit Withdrawn(token, amount);
    }

    /// @notice Owner capital injection. Pulls USDC from the owner (approve first) and records it so it is not
    /// reported as revenue by notifyRevenue(). Revenue that was already pending stays pending.
    function fund(uint256 amount) external onlyOwner {
        usdc.safeTransferFrom(msg.sender, address(this), amount); // msg.sender == owner (onlyOwner)
        recordedUsdc += amount;
        emit Funded(amount);
    }

    /// @notice Timelocked changes are queued with their full parameters (emitted in the event) and can be
    /// applied with exactly those parameters between eta = queuedAt + TIMELOCK and eta + GRACE_PERIOD.
    function queueMandate(Mandate calldata m) external onlyOwner returns (bytes32 changeHash) {
        changeHash = mandateChangeHash(m);
        emit MandateChangeQueued(changeHash, _queue(changeHash), m);
    }

    function queueTokenConfig(address token, TokenConfig calldata c) external onlyOwner returns (bytes32 changeHash) {
        changeHash = tokenChangeHash(token, c);
        emit TokenConfigChangeQueued(changeHash, _queue(changeHash), token, c);
    }

    function queuePayee(address payee, bool allowed) external onlyOwner returns (bytes32 changeHash) {
        changeHash = payeeChangeHash(payee, allowed);
        emit PayeeChangeQueued(changeHash, _queue(changeHash), payee, allowed);
    }

    function cancelChange(bytes32 changeHash) external onlyOwner {
        delete queuedAt[changeHash];
        emit ChangeCancelled(changeHash);
    }

    function applyMandate(Mandate calldata m) external onlyOwner {
        _consume(mandateChangeHash(m));
        _requireValidMandate(m);
        _requireNoOrphanedPosition(m.creditAdapter);
        _mandate = m;
        emit MandateApplied(keccak256(abi.encode(m)));
        emit PolicyHashUpdated(policyHash());
    }

    function applyTokenConfig(address token, TokenConfig calldata c) external onlyOwner {
        _consume(tokenChangeHash(token, c));
        _setToken(token, c);
        emit PolicyHashUpdated(policyHash());
    }

    function applyPayee(address payee, bool allowed) external onlyOwner {
        if (allowed && payee == address(0)) revert ZeroAddress();
        _consume(payeeChangeHash(payee, allowed));
        _setPayee(payee, allowed);
        emit PolicyHashUpdated(policyHash());
    }

    // ------------------------------------------------------------------ views

    function mandate() external view returns (Mandate memory) {
        return _mandate;
    }

    function mandateHash() external view returns (bytes32) {
        return keccak256(abi.encode(_mandate));
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function payees() external view returns (address[] memory) {
        return _payees;
    }

    /// @notice Commitment to the whole policy: keccak256(abi.encode(mandate, tokens, configs, payees)), where
    /// configs[i] = tokenConfig[tokens[i]] (tokens in listing order, delisted ones included) and payees is the
    /// current allowlist in payees() order. Emitted as PolicyHashUpdated on construction and every apply.
    function policyHash() public view returns (bytes32) {
        uint256 n = _tokens.length;
        TokenConfig[] memory configs = new TokenConfig[](n);
        for (uint256 i; i < n; ++i) {
            configs[i] = tokenConfig[_tokens[i]];
        }
        return keccak256(abi.encode(_mandate, _tokens, configs, _payees));
    }

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function mandateChangeHash(Mandate memory m) public pure returns (bytes32) {
        return keccak256(abi.encode("MANDATE", m));
    }

    function tokenChangeHash(address token, TokenConfig memory c) public pure returns (bytes32) {
        return keccak256(abi.encode("TOKEN", token, c));
    }

    function payeeChangeHash(address payee, bool allowed) public pure returns (bytes32) {
        return keccak256(abi.encode("PAYEE", payee, allowed));
    }

    // ------------------------------------------------------------------ internal: checks

    function _check(Intent calldata intent) internal view returns (Reason, uint256) {
        // REPAY only lowers risk: spec 3.1 lets it through the vault pause; its own checks still apply
        if (paused && intent.action != Action.REPAY) return (Reason.VAULT_PAUSED, 0);
        if (intent.action == Action.PAY_EXPENSE) return (_checkExpense(intent), 0);
        if (intent.action != Action.BUY && intent.action != Action.SELL) return (_checkCredit(intent), 0);

        TokenConfig memory cfg = tokenConfig[intent.token];
        bool isBuy = intent.action == Action.BUY;
        // SELL also works for exit-only tokens, so a delisting never traps a holding while a market exists
        if (isBuy ? !cfg.allowed : !_hasMarket(cfg)) return (Reason.TOKEN_NOT_ALLOWED, 0);
        (Reason r, uint256 price) = GuardLib.checkMarket(_marketCheck(intent.token, cfg, isBuy));
        if (r != Reason.OK) return (r, 0);

        // after the market checks so market reasons take precedence (spec §3.1 table order, checks 2-7)
        uint256 available = isBuy
            ? IERC20Minimal(usdc).balanceOf(address(this))
            : IB20Asset(intent.token).balanceOf(address(this));
        if (intent.amount == 0 || intent.amount > available) return (Reason.INSUFFICIENT_BALANCE, 0);

        uint256 notional = isBuy ? intent.amount : _valueUsd(intent.token, intent.amount, price);
        if (!_withinCaps(notional)) return (Reason.SIZE_LIMIT, 0);
        if (isBuy && _weightAfterBuyBps(intent.token, intent.amount, price) > cfg.maxWeightBps) {
            return (Reason.CONCENTRATION, 0);
        }
        return (Reason.OK, price);
    }

    function _checkExpense(Intent calldata intent) internal view returns (Reason) {
        if (!allowedPayee[intent.payee]) return Reason.PAYEE_NOT_ALLOWED;
        if (intent.amount == 0 || intent.amount > IERC20Minimal(usdc).balanceOf(address(this))) {
            return Reason.INSUFFICIENT_BALANCE;
        }
        if (!_withinCaps(intent.amount)) return Reason.SIZE_LIMIT;
        return Reason.OK;
    }

    /// @dev Spec §3.1: SUPPLY (adding collateral) and REPAY reduce risk, so only checks 1-3 apply and they are
    /// allowed while the market is closed. Credit actions are not capped by perTradeCapUsd / dailyCapUsd.
    function _checkCredit(Intent calldata intent) internal view returns (Reason) {
        ICreditAdapter ca = ICreditAdapter(_mandate.creditAdapter);
        if (address(ca) == address(0)) return Reason.ACTION_NOT_SUPPORTED;
        Action a = intent.action;
        if (a == Action.REPAY) {
            if (intent.token != usdc) return Reason.TOKEN_NOT_ALLOWED;
            if (intent.amount == 0 || intent.amount > IERC20Minimal(usdc).balanceOf(address(this))) {
                return Reason.INSUFFICIENT_BALANCE;
            }
            return Reason.OK;
        }
        if (a == Action.SUPPLY) return _checkCollateralMove(ca, intent, true);
        if (a == Action.BORROW) {
            if (intent.token != usdc) return Reason.TOKEN_NOT_ALLOWED;
            if (intent.amount == 0) return Reason.INSUFFICIENT_BALANCE;
            return _checkBorrow(ca, intent.amount);
        }
        return _checkCollateralMove(ca, intent, false);
    }

    /// @dev SUPPLY needs an allowed token; WITHDRAW_COLLATERAL only a listed one, so collateral can always
    /// come home after a delisting.
    function _checkCollateralMove(ICreditAdapter ca, Intent calldata intent, bool isSupply)
        internal
        view
        returns (Reason)
    {
        address token = intent.token;
        if (isSupply ? !tokenConfig[token].allowed : !_listed[token]) return Reason.TOKEN_NOT_ALLOWED;
        try ca.supportsToken(token) returns (bool s) {
            if (!s) return Reason.TOKEN_NOT_ALLOWED;
        } catch {
            return Reason.CREDIT_FAILED;
        }
        if (GuardLib.tokenPaused(token)) return Reason.TOKEN_PAUSED;
        (bool readable, bool authorized) = _creditPathAuthorized(ca, token, isSupply);
        if (!readable) return Reason.CREDIT_FAILED;
        if (!authorized) return Reason.POLICY_BLOCKED;
        if (isSupply) {
            if (intent.amount == 0 || intent.amount > IB20Asset(token).balanceOf(address(this))) {
                return Reason.INSUFFICIENT_BALANCE;
            }
            return Reason.OK;
        }
        (bool ok, uint256 supplied) = _supplied(ca, token);
        if (!ok) return Reason.CREDIT_FAILED;
        if (intent.amount == 0 || intent.amount > supplied) return Reason.INSUFFICIENT_BALANCE;
        // Without debt, withdrawing collateral is risk-free and allowed at any hour.
        try ca.debt() returns (uint256 d) {
            if (d == 0) return Reason.OK;
        } catch {
            return Reason.CREDIT_FAILED;
        }
        // Against debt it adds risk: checks 4-6 here, the health factor in the adapter after the withdrawal.
        return _checkCollateralMarket(ca, false);
    }

    /// @dev Spec §3.1: borrowing adds risk, so checks 4-6 apply to every supplied collateral, then the projected
    /// health factor must clear minHealthFactor (targetHealthFactor inside the derisk window).
    function _checkBorrow(ICreditAdapter ca, uint256 amount) internal view returns (Reason) {
        Reason r = _checkCollateralMarket(ca, true);
        if (r != Reason.OK) return r;
        try ca.projectedHealthFactorAfterBorrow(amount) returns (uint256 hf) {
            return _healthReason(hf);
        } catch {
            return Reason.CREDIT_FAILED;
        }
    }

    /// @dev Market open (check 4), then for each supplied collateral: not paused, live feed, no multiplier change.
    /// BORROW also refuses exit-only collateral (allowed == false): a delisted token may be unwound, not levered.
    function _checkCollateralMarket(ICreditAdapter ca, bool isBorrow) internal view returns (Reason) {
        Mandate memory m = _mandate;
        if (!GuardLib.marketOpen(m.calendar, m.sessionMode)) return Reason.MARKET_CLOSED;
        for (uint256 i; i < _tokens.length; ++i) {
            address t = _tokens[i];
            (bool ok, uint256 supplied) = _supplied(ca, t);
            if (!ok) return Reason.CREDIT_FAILED;
            if (supplied == 0) continue;
            if (isBorrow && !tokenConfig[t].allowed) return Reason.TOKEN_NOT_ALLOWED;
            Reason r = GuardLib.collateralHealthy(
                GuardLib.CollateralCheck({
                    token: t,
                    feed: tokenConfig[t].feed,
                    maxStaleness: m.maxStaleness,
                    multiplierCooldown: m.multiplierCooldown,
                    lastMultiplier: lastMultiplier[t],
                    multiplierChangedAt: multiplierChangedAt[t]
                })
            );
            if (r != Reason.OK) return r;
        }
        return Reason.OK;
    }

    function _healthReason(uint256 hf) internal view returns (Reason) {
        if (hf < _mandate.minHealthFactor) return Reason.HEALTH_FACTOR_LOW;
        if (hf < _mandate.targetHealthFactor && _inDeriskWindow()) return Reason.DERISK_WINDOW;
        return Reason.OK;
    }

    function _requiredHealthFactor() internal view returns (uint256) {
        return _inDeriskWindow() ? _mandate.targetHealthFactor : _mandate.minHealthFactor;
    }

    /// @dev The last `deriskWindow` seconds before 20:00 ET on the last session day before a freeze: every
    /// Friday (Chainlink equity feeds stop for the weekend), and a Mon-Thu followed by a holiday on Friday or
    /// mid-week. Fail-closed: an unreadable calendar or holiday flag counts as inside the window.
    function _inDeriskWindow() internal view returns (bool) {
        uint256 w = _mandate.deriskWindow;
        if (w == 0) return false;
        MarketCalendar cal = MarketCalendar(_mandate.calendar);
        try cal.localTime(block.timestamp) returns (uint256 etDay, uint256 wd, uint256 minute) {
            if (minute >= FEED_FREEZE_MINUTE || minute + w / 60 < FEED_FREEZE_MINUTE) return false;
            if (wd == FRIDAY) return true;
            if (wd == 0 || wd == 6) return false;
            try cal.isHoliday(etDay + 1) returns (bool h) {
                return h;
            } catch {
                return true;
            }
        } catch {
            return true;
        }
    }

    /// @dev Maps an adapter revert to a Reason. Only a well-formed HealthFactorTooLow(hf, min) becomes a health
    /// reason; anything else (empty data, Panic, venue errors) is CREDIT_FAILED.
    function _creditFailure(bytes memory err) internal view returns (Reason) {
        if (err.length == 68 && bytes4(err) == ICreditAdapter.HealthFactorTooLow.selector) {
            uint256 hf;
            assembly ("memory-safe") {
                hf := mload(add(err, 36))
            }
            Reason r = _healthReason(hf);
            return r == Reason.OK ? Reason.CREDIT_FAILED : r;
        }
        return Reason.CREDIT_FAILED;
    }

    /// @dev SUPPLY: vault -> adapter -> custodian, pulled by the adapter, then by the operator.
    /// WITHDRAW_COLLATERAL: custodian -> adapter -> vault, sent by the custodian, then by the adapter.
    /// @return readable false when the adapter's custodian/operator views revert.
    function _creditPathAuthorized(ICreditAdapter ca, address token, bool isSupply)
        internal
        view
        returns (bool readable, bool authorized)
    {
        address custodian;
        address operator;
        try ca.collateralCustodian(token) returns (address c) {
            custodian = c;
        } catch {
            return (false, false);
        }
        try ca.collateralOperator() returns (address o) {
            operator = o;
        } catch {
            return (false, false);
        }
        address self = address(this);
        address a = address(ca);
        authorized = isSupply
            ? GuardLib.transferable(token, policyRegistry, _pair(self, a), _pair(a, custodian), _pair(a, operator))
            : GuardLib.transferable(token, policyRegistry, _pair(custodian, a), _pair(a, self), _pair(custodian, a));
        readable = true;
    }

    function _supplied(ICreditAdapter ca, address token) internal view returns (bool ok, uint256 amount) {
        try ca.suppliedOf(token) returns (uint256 s) {
            return (true, s);
        } catch {
            return (false, 0);
        }
    }

    function _pair(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2);
        r[0] = a;
        r[1] = b;
    }

    function _marketCheck(address token, TokenConfig memory cfg, bool isBuy)
        internal
        view
        returns (GuardLib.MarketCheck memory c)
    {
        Mandate memory m = _mandate;
        c.token = token;
        c.feed = cfg.feed;
        c.pool = cfg.pool;
        c.calendar = m.calendar;
        c.registry = policyRegistry;
        c.vault = address(this);
        c.adapter = m.swapAdapter;
        c.isBuy = isBuy;
        c.sessionMode = m.sessionMode;
        c.maxStaleness = m.maxStaleness;
        c.twapWindow = m.twapWindow;
        c.maxPremiumBps = m.maxPremiumBps;
        c.multiplierCooldown = m.multiplierCooldown;
        c.lastMultiplier = lastMultiplier[token];
        c.multiplierChangedAt = multiplierChangedAt[token];
    }

    function _withinCaps(uint256 usd) internal view returns (bool) {
        return usd <= _mandate.perTradeCapUsd && spentOnDay[today()] + usd <= _mandate.dailyCapUsd;
    }

    /// @dev raw stock amount x 8-decimal price -> USDC (6 decimals)
    function _valueUsd(address token, uint256 raw, uint256 price8) internal view returns (uint256) {
        return raw * price8 / 10 ** (uint256(IB20Asset(token).decimals()) + 2);
    }

    /// @dev Weight is measured against net equity: tokens held by the vault plus collateral supplied through the
    /// credit adapter, minus credit debt (USDC, 6 decimals like the rest of the sum), so borrowing cannot loosen
    /// the cap. Fail-closed: unreadable collateral or debt, or debt >= assets, returns a weight above any cap.
    function _weightAfterBuyBps(address token, uint256 usdIn, uint256 price8) internal view returns (uint256) {
        uint256 total = IERC20Minimal(usdc).balanceOf(address(this));
        uint256 tokenValue;
        ICreditAdapter ca = ICreditAdapter(_mandate.creditAdapter);
        for (uint256 i; i < _tokens.length; ++i) {
            address t = _tokens[i];
            uint256 bal = IB20Asset(t).balanceOf(address(this));
            if (address(ca) != address(0)) {
                (bool ok, uint256 supplied) = _supplied(ca, t);
                if (!ok) return type(uint256).max;
                bal += supplied;
            }
            if (bal == 0) continue;
            uint256 p = t == token ? price8 : _latestPrice(t);
            uint256 v = _valueUsd(t, bal, p);
            total += v;
            if (t == token) tokenValue = v;
        }
        if (address(ca) != address(0)) {
            try ca.debt() returns (uint256 d) {
                if (d != 0) {
                    if (d >= total) return type(uint256).max;
                    total -= d;
                }
            } catch {
                return type(uint256).max;
            }
        }
        if (total == 0) return BPS;
        return (tokenValue + usdIn) * BPS / total;
    }

    /// @dev Valuation price for a holding other than the one being traded. Returns 0 (valued at zero, which is
    /// conservative for concentration) when the token is delisted, its feed is not a contract, or the read is
    /// bad or stale, so a stray holding can never make execute() revert.
    function _latestPrice(address token) internal view returns (uint256) {
        TokenConfig memory cfg = tokenConfig[token];
        if (!cfg.allowed || cfg.feed.code.length == 0) return 0;
        (bool ok, uint256 price, uint256 age) = PriceLib.readFeed(cfg.feed);
        if (!ok || age > _mandate.maxStaleness) return 0;
        return price;
    }

    // ------------------------------------------------------------------ internal: effects

    function _perform(Intent calldata intent, uint256 price) internal returns (Reason) {
        notifyRevenue();
        if (_isCredit(intent.action)) return _performCredit(intent);
        uint256 notional = intent.amount;
        if (intent.action == Action.PAY_EXPENSE) {
            // nothing is recorded on failure: spentOnDay unchanged, recordedUsdc already equals the balance
            if (!usdc.tryTransfer(intent.payee, intent.amount)) return Reason.TRANSFER_FAILED;
        } else {
            bool isBuy = intent.action == Action.BUY;
            address tokenIn = isBuy ? usdc : intent.token;
            uint256 expectedOut = isBuy
                ? intent.amount * 10 ** (uint256(IB20Asset(intent.token).decimals()) + 2) / price
                : _valueUsd(intent.token, intent.amount, price);
            if (!isBuy) notional = expectedOut;
            uint256 floorOut = expectedOut * (BPS - _mandate.maxSlippageBps) / BPS;
            uint256 minOut = intent.minOut > floorOut ? intent.minOut : floorOut;

            address adapter = _mandate.swapAdapter;
            // A failing approve is a token-call failure, not a swap failure: TRANSFER_FAILED. Allowance resets
            // are best effort (results ignored) so a token whose approve fails can never revert execute().
            if (!tokenIn.tryApprove(adapter, intent.amount)) {
                tokenIn.tryApprove(adapter, 0);
                return Reason.TRANSFER_FAILED;
            }
            try ISwapAdapter(adapter).swapExactIn(
                tokenConfig[intent.token].pool, tokenIn, intent.amount, minOut, address(this)
            ) returns (uint256) {
                tokenIn.tryApprove(adapter, 0);
            } catch {
                tokenIn.tryApprove(adapter, 0);
                return Reason.SWAP_FAILED;
            }
        }
        spentOnDay[today()] += notional;
        recordedUsdc = IERC20Minimal(usdc).balanceOf(address(this));
        return Reason.OK;
    }

    function _isCredit(Action a) internal pure returns (bool) {
        return a == Action.SUPPLY || a == Action.WITHDRAW_COLLATERAL || a == Action.BORROW || a == Action.REPAY;
    }

    /// @dev A token with a feed or pool configured has a market: it is validated like an allowed token and its
    /// multiplier is tracked. allowed=false with a market is exit-only: SELL keeps working, BUY and SUPPLY are
    /// refused. Clearing both feed and pool removes the market (no SELL; collateral can still be withdrawn).
    function _hasMarket(TokenConfig memory c) internal pure returns (bool) {
        return c.allowed || c.feed != address(0) || c.pool != address(0);
    }

    /// @dev Credit actions are neither trades nor expenses: spentOnDay is untouched, and recordedUsdc is reset so
    /// borrowed USDC is never reported as revenue (nor repaid USDC as a loss). Mutating adapter calls are
    /// low-level: a typed call, even inside try with its `returns` clause omitted, still ABI-decodes the declared
    /// return values in the caller, so empty or short return data would revert execute(). Return data is
    /// ignored; balances are the source of truth.
    function _performCredit(Intent calldata intent) internal returns (Reason reason) {
        address ca = _mandate.creditAdapter;
        Action a = intent.action;
        uint256 amount = intent.amount;
        if (a == Action.SUPPLY || a == Action.REPAY) {
            address token = a == Action.SUPPLY ? intent.token : usdc;
            if (!token.tryApprove(ca, amount)) {
                token.tryApprove(ca, 0);
                return Reason.TRANSFER_FAILED;
            }
            (bool ok,) = ca.call(
                a == Action.SUPPLY
                    ? abi.encodeCall(ICreditAdapter.supply, (token, amount))
                    : abi.encodeCall(ICreditAdapter.repay, (amount))
            );
            if (!ok) reason = Reason.CREDIT_FAILED;
            token.tryApprove(ca, 0);
        } else {
            uint256 minHf = _requiredHealthFactor();
            (bool ok, bytes memory err) = ca.call(
                a == Action.BORROW
                    ? abi.encodeCall(ICreditAdapter.borrow, (amount, minHf))
                    : abi.encodeCall(ICreditAdapter.withdraw, (intent.token, amount, minHf))
            );
            if (!ok) reason = _creditFailure(err);
        }
        recordedUsdc = IERC20Minimal(usdc).balanceOf(address(this));
    }

    function _syncMultiplier(address token) internal {
        // A reverting uiMultiplier() must not revert execute(); GuardLib then fails closed with MULTIPLIER_COOLDOWN.
        try IB20Asset(token).uiMultiplier() returns (uint256 cur) {
            _recordMultiplier(token, cur);
        } catch {}
    }

    function _recordMultiplier(address token, uint256 cur) internal {
        uint256 last = lastMultiplier[token];
        if (cur == last) return;
        multiplierChangedAt[token] = block.timestamp;
        lastMultiplier[token] = cur;
        emit MultiplierChangeDetected(token, last, cur);
    }

    /// @dev Config-time validation only (constructor / timelocked apply); never called from execute().
    /// GuardLib's try/catch cannot cover calls to addresses without code, so contracts are checked here.
    function _requireValidMandate(Mandate memory m) internal view {
        if (m.calendar.code.length == 0 || m.swapAdapter.code.length == 0) revert InvalidConfig();
        if (m.maxSlippageBps > BPS) revert InvalidConfig();
        if (m.creditAdapter != address(0)) _requireValidCredit(m);
    }

    /// @dev The adapter must be a contract bound to this vault and its USDC, so the vault can never route
    /// collateral into a position it does not control.
    function _requireValidCredit(Mandate memory m) internal view {
        if (m.creditAdapter.code.length == 0) revert InvalidConfig();
        if (m.minHealthFactor < WAD || m.targetHealthFactor < m.minHealthFactor) revert InvalidConfig();
        if (m.deriskWindow > MAX_DERISK_WINDOW) revert InvalidConfig();
        ICreditAdapter ca = ICreditAdapter(m.creditAdapter);
        try ca.vault() returns (address v) {
            if (v != address(this)) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try ca.usdc() returns (address u) {
            if (u != usdc) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
    }

    /// @dev Only this vault can move a position held by its adapter, so switching or disabling the adapter
    /// while debt or collateral remains would strand it. Fail-closed: an unreadable position counts as open.
    function _requireNoOrphanedPosition(address next) internal view {
        address current = _mandate.creditAdapter;
        if (current == address(0) || current == next) return;
        try ICreditAdapter(current).hasPosition() returns (bool open) {
            if (open) revert CreditPositionOpen();
        } catch {
            revert CreditPositionOpen();
        }
    }

    function _setToken(address token, TokenConfig memory c) internal {
        if (token == address(0)) revert ZeroAddress();
        // every listed token is read in execute() loops; a call to an address without code would revert it
        if (token.code.length == 0) revert InvalidConfig();
        bool market = _hasMarket(c);
        if (market) _requireValidTokenConfig(token, c);
        if (!_listed[token]) {
            _listed[token] = true;
            _tokens.push(token);
        }
        tokenConfig[token] = c;
        if (market) {
            uint256 cur = IB20Asset(token).uiMultiplier();
            // First snapshot (last == 0) starts no cooldown; re-applying must not silently absorb a later change.
            if (lastMultiplier[token] == 0) lastMultiplier[token] = cur;
            else _recordMultiplier(token, cur);
        }
        emit TokenConfigApplied(token, c);
    }

    function _requireValidTokenConfig(address token, TokenConfig memory c) internal view {
        if (c.feed.code.length == 0 || c.pool.code.length == 0) revert InvalidConfig();
        address t0;
        address t1;
        try ICLPool(c.pool).token0() returns (address a) {
            t0 = a;
        } catch {
            revert InvalidConfig();
        }
        try ICLPool(c.pool).token1() returns (address b) {
            t1 = b;
        } catch {
            revert InvalidConfig();
        }
        bool matches = (t0 == token && t1 == usdc) || (t0 == usdc && t1 == token);
        if (!matches) revert InvalidConfig();
        // Valuation math assumes an 8-decimal Chainlink answer and 10 ** (tokenDecimals + 2) scaling.
        // Config-time only (constructor loop / timelocked apply), so calls/reverts in a loop are intended.
        // forge-lint: disable-start(calls-loop, require-revert-in-loop)
        try IAggregatorV3(c.feed).decimals() returns (uint8 d) {
            if (d != PriceLib.PRICE_DECIMALS) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        try IERC20Minimal(token).decimals() returns (uint8 d) {
            if (d > 18) revert InvalidConfig();
        } catch {
            revert InvalidConfig();
        }
        // forge-lint: disable-end(calls-loop, require-revert-in-loop)
    }

    function _setPayee(address payee, bool allowed) internal {
        uint256 idx = _payeeIndex[payee];
        if (allowed && idx == 0) {
            _payees.push(payee);
            _payeeIndex[payee] = _payees.length;
        } else if (!allowed && idx != 0) {
            address last = _payees[_payees.length - 1];
            _payees[idx - 1] = last;
            _payeeIndex[last] = idx;
            _payees.pop();
            delete _payeeIndex[payee];
        }
        allowedPayee[payee] = allowed;
        emit PayeeApplied(payee, allowed);
    }

    /// @return eta earliest time the change can be applied. Re-queueing the same change restarts its clock.
    function _queue(bytes32 changeHash) internal returns (uint256 eta) {
        queuedAt[changeHash] = block.timestamp;
        eta = block.timestamp + TIMELOCK;
    }

    function _consume(bytes32 changeHash) internal {
        uint256 t = queuedAt[changeHash];
        if (t == 0) revert ChangeNotQueued(changeHash);
        if (block.timestamp < t + TIMELOCK) revert ChangeNotReady(changeHash, t + TIMELOCK);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > t + TIMELOCK + GRACE_PERIOD) revert ChangeExpired(changeHash);
        delete queuedAt[changeHash];
    }
}
