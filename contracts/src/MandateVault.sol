// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Action, Reason, Intent, Mandate, TokenConfig} from "./Types.sol";
import {GuardLib} from "./GuardLib.sol";
import {IMandateVaultEvents} from "./IMandateVaultEvents.sol";
import {PriceLib} from "./lib/PriceLib.sol";
import {TokenTransfer} from "./lib/TokenTransfer.sol";
import {IB20Asset} from "./interfaces/IB20Asset.sol";
import {IERC20Minimal, ICLPool} from "./interfaces/IExternal.sol";
import {ISwapAdapter} from "./adapters/ISwapAdapter.sol";

/// @title MandateVault — "LLM proposes, contract decides."
/// @notice Holds an agent's USDC + tokenized-stock treasury. The executor submits intents; the vault applies
/// the mandate and market guards and records every verdict, including refusals, as a Decision event.
contract MandateVault is IMandateVaultEvents {
    using TokenTransfer for address;

    uint256 public constant TIMELOCK = 24 hours;
    uint256 internal constant BPS = 10_000;

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
            allowedPayee[payees_[i]] = true;
            emit PayeeApplied(payees_[i], true);
        }
    }

    // ------------------------------------------------------------------ executor

    function execute(Intent calldata intent) external returns (bool allowed, Reason reason) {
        if (msg.sender != executor) revert NotExecutor();
        if (usedIntent[intent.id]) revert IntentAlreadyUsed(intent.id);
        usedIntent[intent.id] = true;
        if (tokenConfig[intent.token].allowed) _syncMultiplier(intent.token);

        uint256 price;
        (reason, price) = _check(intent);
        if (reason == Reason.OK) reason = _perform(intent, price);
        allowed = reason == Reason.OK;
        emit Decision(intent.id, intent.action, intent.token, intent.amount, allowed, reason, intent.rationaleHash);
    }

    /// @notice Same verdict execute() would reach before trading. Cannot predict SWAP_FAILED.
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
        if (tokenConfig[token].allowed) _syncMultiplier(token);
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

    function queueChange(bytes32 changeHash) external onlyOwner {
        queuedAt[changeHash] = block.timestamp;
        emit ChangeQueued(changeHash, block.timestamp + TIMELOCK);
    }

    function cancelChange(bytes32 changeHash) external onlyOwner {
        delete queuedAt[changeHash];
        emit ChangeCancelled(changeHash);
    }

    function applyMandate(Mandate calldata m) external onlyOwner {
        _consume(mandateChangeHash(m));
        _requireValidMandate(m);
        _mandate = m;
        emit MandateApplied(keccak256(abi.encode(m)));
    }

    function applyTokenConfig(address token, TokenConfig calldata c) external onlyOwner {
        _consume(tokenChangeHash(token, c));
        _setToken(token, c);
    }

    function applyPayee(address payee, bool allowed) external onlyOwner {
        _consume(payeeChangeHash(payee, allowed));
        allowedPayee[payee] = allowed;
        emit PayeeApplied(payee, allowed);
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
        if (paused) return (Reason.VAULT_PAUSED, 0);
        if (intent.action == Action.PAY_EXPENSE) return (_checkExpense(intent), 0);
        if (intent.action != Action.BUY && intent.action != Action.SELL) return (Reason.ACTION_NOT_SUPPORTED, 0);

        TokenConfig memory cfg = tokenConfig[intent.token];
        if (!cfg.allowed) return (Reason.TOKEN_NOT_ALLOWED, 0);
        bool isBuy = intent.action == Action.BUY;
        uint256 available = isBuy
            ? IERC20Minimal(usdc).balanceOf(address(this))
            : IB20Asset(intent.token).balanceOf(address(this));
        if (intent.amount == 0 || intent.amount > available) return (Reason.INSUFFICIENT_BALANCE, 0);

        (Reason r, uint256 price) = GuardLib.checkMarket(_marketCheck(intent.token, cfg, isBuy));
        if (r != Reason.OK) return (r, 0);

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

    function _weightAfterBuyBps(address token, uint256 usdIn, uint256 price8) internal view returns (uint256) {
        uint256 total = IERC20Minimal(usdc).balanceOf(address(this));
        uint256 tokenValue;
        for (uint256 i; i < _tokens.length; ++i) {
            address t = _tokens[i];
            uint256 bal = IB20Asset(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 p = t == token ? price8 : _latestPrice(t);
            uint256 v = _valueUsd(t, bal, p);
            total += v;
            if (t == token) tokenValue = v;
        }
        if (total == 0) return BPS;
        return (tokenValue + usdIn) * BPS / total;
    }

    function _latestPrice(address token) internal view returns (uint256 price) {
        (, price,) = PriceLib.readFeed(tokenConfig[token].feed);
    }

    // ------------------------------------------------------------------ internal: effects

    function _perform(Intent calldata intent, uint256 price) internal returns (Reason) {
        notifyRevenue();
        uint256 notional = intent.amount;
        if (intent.action == Action.PAY_EXPENSE) {
            usdc.safeTransfer(intent.payee, intent.amount);
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
            tokenIn.safeApprove(adapter, intent.amount);
            try ISwapAdapter(adapter).swapExactIn(
                tokenConfig[intent.token].pool, tokenIn, intent.amount, minOut, address(this)
            ) returns (uint256) {
                tokenIn.safeApprove(adapter, 0);
            } catch {
                tokenIn.safeApprove(adapter, 0);
                return Reason.SWAP_FAILED;
            }
        }
        spentOnDay[today()] += notional;
        recordedUsdc = IERC20Minimal(usdc).balanceOf(address(this));
        return Reason.OK;
    }

    function _syncMultiplier(address token) internal {
        uint256 cur = IB20Asset(token).uiMultiplier();
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
    }

    function _setToken(address token, TokenConfig memory c) internal {
        if (token == address(0)) revert ZeroAddress();
        if (c.allowed) _requireValidTokenConfig(token, c);
        if (!_listed[token]) {
            _listed[token] = true;
            _tokens.push(token);
        }
        tokenConfig[token] = c;
        if (c.allowed) lastMultiplier[token] = IB20Asset(token).uiMultiplier();
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
    }

    function _consume(bytes32 changeHash) internal {
        uint256 t = queuedAt[changeHash];
        if (t == 0) revert ChangeNotQueued(changeHash);
        if (block.timestamp < t + TIMELOCK) revert ChangeNotReady(changeHash, t + TIMELOCK);
        delete queuedAt[changeHash];
    }
}
