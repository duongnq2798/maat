// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Vm} from "forge-std/Vm.sol";
import {MandateVault} from "../../../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate} from "../../../src/Types.sol";
import {IB20Asset} from "../../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal, IAggregatorV3} from "../../../src/interfaces/IExternal.sol";
import {ICreditAdapter} from "../../../src/adapters/ICreditAdapter.sol";
import {Ghosts, spread} from "../../invariant/VaultHandler.sol";

/// @dev The outcomes only execute can reach, after the checks passed: the ones previewIntent's NatSpec names, and the
/// venue's own health check after a BORROW or a WITHDRAW_COLLATERAL. Against the real adapter a test cannot know the
/// health factor after the action, so either health reason counts, for those two actions only.
function decidedWhileActing(Action a, Reason preview, Reason r) pure returns (bool) {
    if (preview != Reason.OK) return false;
    if (r == Reason.SWAP_FAILED || r == Reason.TRANSFER_FAILED || r == Reason.CREDIT_FAILED) return true;
    if (a != Action.BORROW && a != Action.WITHDRAW_COLLATERAL) return false;
    return r == Reason.HEALTH_FACTOR_LOW || r == Reason.DERISK_WINDOW;
}

/// @notice The deployed vault and what its mandate wires it to at the fork block. The three mandates the owner
/// handler switches between keep the same adapters.
struct LiveEnv {
    MandateVault vault;
    address usdc;
    address executor; // vault.executor() at the fork block
    address swap; // mandate().swapAdapter
    address credit; // mandate().creditAdapter, or address(0) when credit is off
}

/// @notice The live counterpart of test/invariant/VaultHandler.sol: the same sends and the same Ghosts, against the
/// real tokens, feeds, pools, calendar and adapters instead of mocks. Nothing here scripts a dependency, so a swap
/// pays what the pool pays and a health factor is what the venue computes.
abstract contract LiveVaultHandler is CommonBase, StdUtils {
    bytes32 internal constant TRANSFER = keccak256("Transfer(address,address,uint256)");
    address public constant STRANGER = address(0x57A2);

    LiveEnv internal env;
    /// The vault's tokens() at the fork block; the run lists or delists none.
    address[] internal tokens;
    /// The allowlist at the fork block; the run changes no payee.
    address[] internal payees;
    Ghosts public immutable ghosts;

    /// Coverage, read by LiveVaultInvariants.afterInvariant.
    uint256 public allowedSends;
    uint256 public refusedReasons; // bit r is set once execute returned allowed = false with Reason r

    constructor(LiveEnv memory env_, address[] memory tokens_, address[] memory payees_, Ghosts ghosts_) {
        env = env_;
        tokens = tokens_;
        payees = payees_;
        ghosts = ghosts_;
    }

    /// @dev VaultHandler._send against the live vault: previews `i` as the live executor (tx.origin too, as for the
    /// agent), then sends it. One send in 16 comes from a stranger and one in 16 replays the last used id: those must
    /// revert with NotExecutor and IntentAlreadyUsed, and nothing else may revert.
    function _send(Intent memory i, uint256 seed) internal {
        Ghosts g = ghosts;
        MandateVault v = env.vault;
        address caller = env.executor;
        bytes memory mustRevert;
        uint256 k = seed % 16;
        bool replay = k == 1 && g.lastId() != bytes32(0);
        if (replay) {
            i.id = g.lastId();
            mustRevert = abi.encodeWithSelector(MandateVault.IntentAlreadyUsed.selector, i.id);
        } else {
            i.id = g.nextId();
        }
        if (k == 0) {
            caller = STRANGER;
            mustRevert = abi.encodeWithSelector(MandateVault.NotExecutor.selector);
        }

        uint256 day = vm.getBlockTimestamp() / 1 days; // via_ir may cache block.timestamp across warps
        g.touch(day, v.mandate().dailyCapUsd);
        uint256 notional = _notional(i);
        (bool previewed, Reason preview) = _preview(i);
        vm.recordLogs();
        vm.prank(caller, caller);
        try v.execute(i) returns (bool allowed, Reason reason) {
            Vm.Log[] memory logs = vm.getRecordedLogs();
            if (mustRevert.length != 0) {
                g.revertViolation(string.concat("execute did not revert for ", _describe(i)));
                return;
            }
            g.used(i.id);
            if (allowed) ++allowedSends;
            else refusedReasons |= 1 << uint8(reason);
            if (allowed && notional != 0) g.spend(day, notional);
            if (previewed && preview != reason && !decidedWhileActing(i.action, preview, reason)) {
                g.previewMismatch(
                    string.concat(
                        _describe(i),
                        ": preview ",
                        vm.toString(uint8(preview)),
                        ", execute ",
                        vm.toString(uint8(reason))
                    )
                );
            }
            _checkAllowances(i);
            _checkOutflows(i, logs);
        } catch (bytes memory err) {
            vm.getRecordedLogs();
            if (mustRevert.length != 0 && keccak256(err) == keccak256(mustRevert)) {
                g.expectedRevert(replay);
            } else {
                g.revertViolation(
                    string.concat("execute reverted for ", _describe(i), ": ", vm.toString(err))
                );
            }
        }
    }

    function _preview(Intent memory i) internal returns (bool, Reason) {
        vm.prank(env.executor, env.executor);
        try env.vault.previewIntent(i) returns (Reason r) {
            return (true, r);
        } catch (bytes memory err) {
            ghosts.revertViolation(
                string.concat("previewIntent reverted for ", _describe(i), ": ", vm.toString(err))
            );
            return (false, Reason.OK);
        }
    }

    /// @dev What an allowed `i` adds to spentOnDay, computed the vault's way: the USDC of a BUY or a payment, the
    /// oracle value of the stock of a SELL, nothing for credit.
    function _notional(Intent memory i) internal view returns (uint256) {
        if (i.action == Action.BUY || i.action == Action.PAY_EXPENSE) return i.amount;
        if (i.action != Action.SELL) return 0;
        uint256 price = _price(i.token);
        if (price == 0) return 0;
        return i.amount * price / 10 ** (uint256(IB20Asset(i.token).decimals()) + 2);
    }

    /// @dev The vault's allowances to both adapters, for USDC and every listed token, are 0 after every call.
    function _checkAllowances(Intent memory i) internal {
        address v = address(env.vault);
        address[2] memory spenders = [env.swap, env.credit];
        for (uint256 s; s < 2; ++s) {
            if (spenders[s] == address(0)) continue;
            bool left = IERC20Minimal(env.usdc).allowance(v, spenders[s]) != 0;
            for (uint256 t; t < tokens.length && !left; ++t) {
                left = IERC20Minimal(tokens[t]).allowance(v, spenders[s]) != 0;
            }
            if (left) ghosts.allowanceLeft(string.concat("allowance left after ", _describe(i)));
        }
    }

    /// @dev Every USDC transfer out of the vault goes to the swap adapter, the credit adapter or a payee.
    function _checkOutflows(Intent memory i, Vm.Log[] memory logs) internal {
        address v = address(env.vault);
        for (uint256 j; j < logs.length; ++j) {
            Vm.Log memory l = logs[j];
            if (l.emitter != env.usdc || l.topics.length != 3 || l.topics[0] != TRANSFER) continue;
            if (address(uint160(uint256(l.topics[1]))) != v) continue;
            address to = address(uint160(uint256(l.topics[2])));
            if (to == env.swap || to == env.credit || env.vault.allowedPayee(to)) continue;
            ghosts.strayOutflow(string.concat("USDC to ", vm.toString(to), " in ", _describe(i)));
        }
    }

    // ------------------------------------------------------------------ inputs

    function _intent(Action a, address token, uint256 amount) internal pure returns (Intent memory i) {
        i.action = a;
        i.token = token;
        i.amount = amount;
        i.rationaleHash = keccak256("live-invariant");
    }

    /// @dev A listed token 15 times in 16; otherwise USDC itself, which the vault never lists, so every trade or
    /// credit action on it is refused.
    function _pick(uint256 seed) internal view returns (address) {
        if (seed % 16 == 0) return env.usdc;
        return tokens[(seed >> 4) % tokens.length];
    }

    /// @dev The token's feed answer through the vault's config, or 0 for a token with no feed or a bad answer.
    function _price(address token) internal view returns (uint256) {
        (, address feed,,) = env.vault.tokenConfig(token);
        if (feed == address(0)) return 0;
        (, int256 answer,,,) = IAggregatorV3(feed).latestRoundData();
        return answer > 0 ? uint256(answer) : 0;
    }

    function _held(address token) internal view returns (uint256) {
        return IERC20Minimal(token).balanceOf(address(env.vault));
    }

    /// @dev VaultHandler._size: mostly a size under a quarter of `cap`, one in sixteen near or over `cap`
    /// (SIZE_LIMIT), one in sixteen zero (INSUFFICIENT_BALANCE).
    function _size(uint256 seed, uint256 x, uint256 cap) internal pure returns (uint256) {
        uint256 k = seed % 16;
        if (k == 0) return 0;
        if (k == 1) return _bound(x, cap / 2, cap * 3 / 2);
        return _bound(x, cap / 50, cap / 4);
    }

    /// @dev Up to `held`, and one time in sixteen one more than that (INSUFFICIENT_BALANCE).
    function _upTo(uint256 seed, uint256 x, uint256 held) internal pure returns (uint256) {
        if (seed % 16 == 0) return held + 1;
        return _bound(x, 1, held == 0 ? 1 : held);
    }

    function _describe(Intent memory i) internal pure returns (string memory) {
        return string.concat("action ", vm.toString(uint8(i.action)), " amount ", vm.toString(i.amount));
    }
}

/// @notice BUY and SELL of the vault's listed tokens (and now and then of USDC, which it never lists), through the
/// real swap adapter and pools. One send in 32 carries a minOut no pool can pay, which must end as SWAP_FAILED.
contract LiveTradeHandler is LiveVaultHandler {
    constructor(LiveEnv memory env_, address[] memory tokens_, address[] memory payees_, Ghosts ghosts_)
        LiveVaultHandler(env_, tokens_, payees_, ghosts_)
    {}

    function buy(uint256 seed, uint256 usdcIn) external {
        seed = spread(seed);
        Mandate memory m = env.vault.mandate();
        Intent memory i = _intent(Action.BUY, _pick(seed), _size(seed >> 8, usdcIn, m.perTradeCapUsd));
        if ((seed >> 16) % 32 == 1) i.minOut = type(uint128).max;
        _send(i, seed >> 32);
    }

    /// @dev Half the time a size up to what the vault holds, so a SELL can pass the balance check; otherwise a size
    /// against the per-trade cap at the oracle price.
    function sell(uint256 seed, uint256 raw) external {
        seed = spread(seed);
        Mandate memory m = env.vault.mandate();
        address token = _pick(seed);
        uint256 price = _price(token);
        uint256 amount;
        if ((seed >> 24) % 2 == 0) {
            amount = _upTo(seed >> 8, raw, _held(token));
        } else {
            uint256 scale = 10 ** (uint256(IB20Asset(token).decimals()) + 2);
            uint256 capRaw = price == 0 ? 1e8 : uint256(m.perTradeCapUsd) * scale / price;
            amount = _size(seed >> 8, raw, capRaw);
        }
        Intent memory i = _intent(Action.SELL, token, amount);
        if ((seed >> 16) % 32 == 1) i.minOut = type(uint128).max;
        _send(i, seed >> 32);
    }
}

/// @notice PAY_EXPENSE to an allowlisted payee three times in four, to an address off the allowlist otherwise.
contract LiveExpenseHandler is LiveVaultHandler {
    address public constant NOT_A_PAYEE = address(0xB111);

    constructor(LiveEnv memory env_, address[] memory tokens_, address[] memory payees_, Ghosts ghosts_)
        LiveVaultHandler(env_, tokens_, payees_, ghosts_)
    {}

    function payExpense(uint256 seed, uint256 usdc) external {
        seed = spread(seed);
        Intent memory i =
            _intent(Action.PAY_EXPENSE, env.usdc, _size(seed >> 8, usdc, env.vault.mandate().perTradeCapUsd));
        i.payee = seed % 4 == 0 || payees.length == 0 ? NOT_A_PAYEE : payees[(seed >> 2) % payees.length];
        _send(i, seed >> 32);
    }
}

/// @notice SUPPLY, BORROW, REPAY and WITHDRAW_COLLATERAL through the credit adapter the live mandate names, on the
/// real venue. Sizes come from what the vault holds, what the adapter holds for it and what it owes.
contract LiveCreditHandler is LiveVaultHandler {
    constructor(LiveEnv memory env_, address[] memory tokens_, address[] memory payees_, Ghosts ghosts_)
        LiveVaultHandler(env_, tokens_, payees_, ghosts_)
    {}

    function supply(uint256 seed, uint256 raw) external {
        seed = spread(seed);
        address token = _pick(seed);
        _send(_intent(Action.SUPPLY, token, _upTo(seed >> 8, raw, _held(token))), seed >> 32);
    }

    function withdrawCollateral(uint256 seed, uint256 raw) external {
        seed = spread(seed);
        address token = _pick(seed);
        _send(_intent(Action.WITHDRAW_COLLATERAL, token, _upTo(seed >> 8, raw, _supplied(token))), seed >> 32);
    }

    function borrow(uint256 seed, uint256 usdc) external {
        seed = spread(seed);
        uint256 amount = (seed >> 8) % 16 == 0 ? 0 : _bound(usdc, 1e6, 20e6);
        _send(_intent(Action.BORROW, env.usdc, amount), seed >> 32);
    }

    function repay(uint256 seed, uint256 usdc) external {
        seed = spread(seed);
        uint256 debt = _debt();
        uint256 amount = (seed >> 8) % 16 == 0 ? 0 : _bound(usdc, 1, debt > 1e6 ? debt + 1e6 : 1e6);
        _send(_intent(Action.REPAY, env.usdc, amount), seed >> 32);
    }

    /// @dev The adapter's views, read for sizing only: a revert reads as 0, and the vault's own read of the same view
    /// decides the intent.
    function _supplied(address token) internal view returns (uint256) {
        if (env.credit == address(0)) return 0;
        try ICreditAdapter(env.credit).suppliedOf(token) returns (uint256 s) {
            return s;
        } catch {
            return 0;
        }
    }

    function _debt() internal view returns (uint256) {
        if (env.credit == address(0)) return 0;
        try ICreditAdapter(env.credit).debt() returns (uint256 d) {
            return d;
        } catch {
            return 0;
        }
    }
}
