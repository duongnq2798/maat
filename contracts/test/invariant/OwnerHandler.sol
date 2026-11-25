// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {Mandate} from "../../src/Types.sol";
import {spread} from "./VaultHandler.sol";

/// @notice The owner queues, cancels and applies changes between three valid mandates, at whatever time the run is
/// at, and keeps its own record of when each was queued. The vault must apply exactly when that record says the
/// timelock is over and the grace period is not, and refuse with the matching error otherwise.
contract OwnerHandler is CommonBase {
    MandateVault internal immutable vault;
    address internal immutable owner;
    uint256 internal immutable timelock;
    uint256 internal immutable grace;
    Mandate[3] internal _mandates;

    /// When this handler last queued _mandates[i] and has not applied or cancelled it since; 0 = not queued.
    uint256[3] public queuedAt;
    /// keccak256(abi.encode(m)) of the last mandate applied here, which mandateHash() must equal.
    bytes32 public expectedMandateHash;
    uint256 public applied;
    uint256 public refusedApplies;
    uint256 public timelockViolations;
    string public lastViolation;

    constructor(MandateVault vault_, address owner_, Mandate[3] memory mandates_) {
        vault = vault_;
        owner = owner_;
        timelock = vault_.TIMELOCK();
        grace = vault_.GRACE_PERIOD();
        for (uint256 i; i < 3; ++i) {
            _mandates[i] = mandates_[i];
        }
        expectedMandateHash = vault_.mandateHash();
    }

    /// @dev Queues (four times in ten), cancels (one in ten) or applies (five in ten) a change to one of the three
    /// mandates. A queue takes a mandate that is not queued yet, if there is one, except one time in four, when it
    /// may queue one again and restart its clock. An apply takes a queued mandate, one whose wait is over if there
    /// is one, except one time in four, when it tries any of the three: often unqueued, early or expired.
    function changeMandate(uint256 seed) external {
        seed = spread(seed);
        uint256 op = seed % 10;
        uint256 which = (seed >> 8) % 3;
        bool any = (seed >> 16) % 4 == 0;
        if (op < 4) _queue(any ? which : _unqueuedPick(which));
        else if (op == 4) _cancel(which);
        else _apply(any ? which : _queuedPick(which));
    }

    function _queue(uint256 which) internal {
        vm.prank(owner);
        vault.queueMandate(_mandates[which]);
        queuedAt[which] = vm.getBlockTimestamp(); // via_ir may cache block.timestamp across warps
    }

    function _cancel(uint256 which) internal {
        bytes32 changeHash = vault.mandateChangeHash(_mandates[which]); // before the prank, which takes the next call
        vm.prank(owner);
        vault.cancelChange(changeHash);
        queuedAt[which] = 0;
    }

    function _apply(uint256 which) internal {
        Mandate memory m = _mandates[which];
        uint256 now_ = vm.getBlockTimestamp();
        uint256 q = queuedAt[which];
        bool ready = q != 0 && now_ >= q + timelock && now_ <= q + timelock + grace;
        bytes32 changeHash = vault.mandateChangeHash(m);
        vm.prank(owner);
        try vault.applyMandate(m) {
            if (!ready) {
                _violation(string.concat("applied mandate ", vm.toString(which), " outside its window"));
            }
            expectedMandateHash = keccak256(abi.encode(m));
            queuedAt[which] = 0;
            ++applied;
        } catch (bytes memory err) {
            bytes memory want;
            if (q == 0) {
                want = abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, changeHash);
            } else if (now_ < q + timelock) {
                want = abi.encodeWithSelector(MandateVault.ChangeNotReady.selector, changeHash, q + timelock);
            } else if (!ready) {
                want = abi.encodeWithSelector(MandateVault.ChangeExpired.selector, changeHash);
            }
            if (ready || keccak256(err) != keccak256(want)) {
                _violation(
                    string.concat("apply of mandate ", vm.toString(which), " reverted: ", vm.toString(err))
                );
            }
            ++refusedApplies;
        }
    }

    function _unqueuedPick(uint256 fallback_) internal view returns (uint256) {
        for (uint256 i; i < 3; ++i) {
            if (queuedAt[(fallback_ + i) % 3] == 0) return (fallback_ + i) % 3;
        }
        return fallback_;
    }

    function _queuedPick(uint256 fallback_) internal view returns (uint256 which) {
        which = fallback_;
        uint256 now_ = vm.getBlockTimestamp();
        for (uint256 i; i < 3; ++i) {
            uint256 q = queuedAt[i];
            if (q == 0) continue;
            if (now_ >= q + timelock && now_ <= q + timelock + grace) return i;
            which = i;
        }
    }

    function _violation(string memory what) internal {
        ++timelockViolations;
        lastViolation = what;
    }
}
