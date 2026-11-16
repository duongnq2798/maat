// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Vm} from "forge-std/Vm.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {Action, Reason, Intent} from "../../src/Types.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockB20} from "../mocks/MockB20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockSwapAdapter} from "../mocks/MockSwapAdapter.sol";
import {MockCreditAdapter} from "../mocks/MockCreditAdapter.sol";

/// @dev The fuzzer leans on small and edge values; hashing a seed spreads every bit the handlers slice from it.
function spread(uint256 seed) pure returns (uint256) {
    return uint256(keccak256(abi.encode(seed)));
}

/// @notice The vault and the mocks it depends on, as MandateVaultInvariants.setUp deploys them.
struct Env {
    MandateVault vault;
    MockERC20 usdc;
    MockB20[2] tokens; // listed, allowed and supported by the credit adapter
    MockFeed[2] feeds; // tokens[i]'s feed
    MockB20 unlisted; // never listed: every action on it is refused
    MockSwapAdapter swap;
    MockCreditAdapter credit;
    address executor;
    address[2] payees; // the allowlist; it does not change during a run
}

/// @notice What the handlers saw, in one place for the invariants. Each counter of a broken rule must stay 0.
contract Ghosts {
    uint256 public revertViolations; // execute reverted otherwise than the handler caused, or did not revert
    uint256 public previewMismatches;
    uint256 public allowancesLeft;
    uint256 public strayOutflows;
    string public lastViolation;

    uint256 public expectedReverts;
    uint256 public adjacentSpendDays; // spends on a UTC day that follows a day with spends
    bytes32 public lastId;
    uint256 internal _nonce;

    uint256[] internal _days;
    mapping(uint256 utcDay => bool) internal _touched;
    /// Largest dailyCapUsd in force at an execute on that day (a mandate change can lower the cap mid-day).
    mapping(uint256 utcDay => uint256) public maxDailyCap;
    /// What spentOnDay should be: the notional of the trades and payments execute allowed that day.
    mapping(uint256 utcDay => uint256) public spentModel;

    function nextId() external returns (bytes32) {
        return keccak256(abi.encode("intent", ++_nonce));
    }

    function used(bytes32 id) external {
        lastId = id;
    }

    function touch(uint256 day, uint256 dailyCap) external {
        if (!_touched[day]) {
            _touched[day] = true;
            _days.push(day);
        }
        if (dailyCap > maxDailyCap[day]) maxDailyCap[day] = dailyCap;
    }

    function spend(uint256 day, uint256 notional) external {
        if (spentModel[day] == 0 && day != 0 && spentModel[day - 1] != 0) ++adjacentSpendDays;
        spentModel[day] += notional;
    }

    function expectedRevert() external {
        ++expectedReverts;
    }

    function revertViolation(string calldata what) external {
        ++revertViolations;
        lastViolation = what;
    }

    function previewMismatch(string calldata what) external {
        ++previewMismatches;
        lastViolation = what;
    }

    function allowanceLeft(string calldata what) external {
        ++allowancesLeft;
        lastViolation = what;
    }

    function strayOutflow(string calldata what) external {
        ++strayOutflows;
        lastViolation = what;
    }

    function dayCount() external view returns (uint256) {
        return _days.length;
    }

    function dayAt(uint256 i) external view returns (uint256) {
        return _days[i];
    }
}

/// @notice Shared by the handlers that send intents: builds them, sends them the way the agent does and records
/// what the invariants check. Handlers never revert; every outcome is counted instead.
abstract contract VaultHandler is CommonBase, StdUtils {
    bytes32 internal constant TRANSFER = keccak256("Transfer(address,address,uint256)");
    address internal constant STRANGER = address(0x57A2);

    Env internal env;
    Ghosts public immutable ghosts;

    /// Coverage, read by MandateVaultInvariants.afterInvariant.
    uint256 public sends;
    uint256 public allowedSends;
    uint256 public refusedReasons; // bit r is set once execute returned allowed = false with Reason r

    constructor(Env memory env_, Ghosts ghosts_) {
        env = env_;
        ghosts = ghosts_;
    }

    /// @dev Previews `i` as the executor, with tx.origin the executor too as for the agent, then sends it. One send
    /// in 16 comes from a stranger and one in 16 replays the last used id: those must revert with NotExecutor and
    /// IntentAlreadyUsed. Nothing else may revert while every mock follows its ABI.
    function _send(Intent memory i, uint256 seed) internal {
        Ghosts g = ghosts;
        MandateVault v = env.vault;
        address caller = env.executor;
        bytes memory mustRevert;
        uint256 k = seed % 16;
        if (k == 1 && g.lastId() != bytes32(0)) {
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
            ++sends;
            if (allowed) ++allowedSends;
            else refusedReasons |= 1 << uint8(reason);
            if (allowed && notional != 0) g.spend(day, notional);
            if (previewed && preview != reason && !_decidedWhileActing(i.action, preview, reason)) {
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
                g.expectedRevert();
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

    /// @dev The outcomes only execute can reach, after the checks passed: the ones previewIntent's NatSpec names.
    function _decidedWhileActing(Action a, Reason preview, Reason r) internal pure returns (bool) {
        if (preview != Reason.OK) return false;
        if (r == Reason.SWAP_FAILED || r == Reason.TRANSFER_FAILED || r == Reason.CREDIT_FAILED) return true;
        // the adapter's own health check after a borrow or a withdrawal
        return (a == Action.BORROW || a == Action.WITHDRAW_COLLATERAL)
            && (r == Reason.HEALTH_FACTOR_LOW || r == Reason.DERISK_WINDOW);
    }

    /// @dev What an allowed `i` adds to spentOnDay, computed the vault's way: the USDC of a BUY or a payment, the
    /// oracle value of the stock of a SELL, nothing for credit.
    function _notional(Intent memory i) internal view returns (uint256) {
        if (i.action == Action.BUY || i.action == Action.PAY_EXPENSE) return i.amount;
        MockFeed feed = _feedOf(i.token);
        if (i.action != Action.SELL || address(feed) == address(0)) return 0;
        return i.amount * _price(feed) / 10 ** (uint256(MockB20(i.token).decimals()) + 2);
    }

    function _checkAllowances(Intent memory i) internal {
        address v = address(env.vault);
        address[2] memory spenders = [address(env.swap), address(env.credit)];
        for (uint256 s; s < 2; ++s) {
            bool left = env.usdc.allowance(v, spenders[s]) != 0
                || env.tokens[0].allowance(v, spenders[s]) != 0
                || env.tokens[1].allowance(v, spenders[s]) != 0;
            if (left) ghosts.allowanceLeft(string.concat("allowance left after ", _describe(i)));
        }
    }

    /// @dev Every USDC transfer out of the vault goes to the swap adapter, the credit adapter or a payee.
    function _checkOutflows(Intent memory i, Vm.Log[] memory logs) internal {
        address v = address(env.vault);
        for (uint256 j; j < logs.length; ++j) {
            Vm.Log memory l = logs[j];
            if (l.emitter != address(env.usdc) || l.topics.length != 3 || l.topics[0] != TRANSFER) continue;
            if (address(uint160(uint256(l.topics[1]))) != v) continue;
            address to = address(uint160(uint256(l.topics[2])));
            if (to == address(env.swap) || to == address(env.credit) || env.vault.allowedPayee(to)) continue;
            ghosts.strayOutflow(string.concat("USDC to ", vm.toString(to), " in ", _describe(i)));
        }
    }

    // ------------------------------------------------------------------ inputs

    function _intent(Action a, address token, uint256 amount) internal pure returns (Intent memory i) {
        i.action = a;
        i.token = token;
        i.amount = amount;
        i.rationaleHash = keccak256("invariant");
    }

    /// @dev A listed token 15 times in 16, the unlisted one otherwise.
    function _pick(uint256 seed) internal view returns (MockB20 token, MockFeed feed) {
        if (seed % 16 == 0) return (env.unlisted, MockFeed(address(0)));
        uint256 t = (seed >> 4) % 2;
        return (env.tokens[t], env.feeds[t]);
    }

    function _feedOf(address token) internal view returns (MockFeed) {
        if (token == address(env.tokens[0])) return env.feeds[0];
        if (token == address(env.tokens[1])) return env.feeds[1];
        return MockFeed(address(0));
    }

    function _price(MockFeed feed) internal view returns (uint256) {
        return uint256(feed.answer());
    }

    /// @dev Mostly a size under a quarter of `cap`, so several fit in a day; one in sixteen near or over `cap`
    /// (SIZE_LIMIT), one in sixteen zero (INSUFFICIENT_BALANCE).
    function _size(uint256 seed, uint256 x, uint256 cap) internal pure returns (uint256) {
        uint256 k = seed % 16;
        if (k == 0) return 0;
        if (k == 1) return _bound(x, cap / 2, cap * 3 / 2);
        return _bound(x, cap / 50, cap / 4);
    }

    function _describe(Intent memory i) internal pure returns (string memory) {
        return string.concat("action ", vm.toString(uint8(i.action)), " amount ", vm.toString(i.amount));
    }
}
