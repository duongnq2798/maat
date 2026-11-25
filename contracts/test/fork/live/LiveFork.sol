// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {MandateVault} from "../../../src/MandateVault.sol";
import {IERC20Minimal} from "../../../src/interfaces/IExternal.sol";
import {LIVE_VAULT} from "../../../script/QueueReserveCaps.s.sol";

/// @notice What the live fork suites (test/fork/LiveVault*.t.sol) share: the vault deployed on Base mainnet
/// (deployments/README.md), at the block .github/workflows/live-fork.yml pins for the run. Foundry forks the chain
/// locally: nothing is signed or broadcast, and the suites act as the live owner and executor with vm.prank. From
/// contracts/, with BASE_RPC_URL set: LIVE_FORK_BLOCK=<block> forge test --match-path "test/fork/LiveVault*"
/// --fuzz-seed <block>. Without LIVE_FORK_BLOCK the suites fork the latest block.
abstract contract LiveFork is Test {
    MandateVault internal constant LIVE = MandateVault(LIVE_VAULT);
    /// The one sender of the invariant fuzzer's calls (targetSender): the handlers prank whoever acts.
    address internal constant FUZZ_SENDER = address(0xF022);

    /// @dev Forks Base at LIVE_FORK_BLOCK, or at the latest block when it is unset, through the `base` endpoint of
    /// foundry.toml (BASE_RPC_URL).
    function _selectLiveFork() internal returns (uint256 forkBlock) {
        forkBlock = vm.envOr("LIVE_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork("base");
        else vm.createSelectFork("base", forkBlock);
        forkBlock = vm.getBlockNumber();
        // Base charges each call an L1 data fee, even at a zero gas price: the callers need ETH on the fork.
        vm.deal(DEFAULT_SENDER, 1 ether);
        vm.deal(FUZZ_SENDER, 1 ether);
        assertGt(LIVE_VAULT.code.length, 0, "no code at the live vault");
        console2.log("live fork block", forkBlock);
    }

    /// @dev Tops the vault up the way the owner does (deployments/go-live.md step 6): approve, then fund, so the
    /// vault records it as capital and not as revenue. The owner's USDC comes from a cheat code.
    function _fundAsOwner(uint256 amount) internal {
        address owner = LIVE.owner();
        IERC20Minimal usdc = IERC20Minimal(LIVE.usdc());
        deal(address(usdc), owner, usdc.balanceOf(owner) + amount);
        vm.startPrank(owner);
        usdc.approve(LIVE_VAULT, amount);
        LIVE.fund(amount);
        vm.stopPrank();
    }
}
