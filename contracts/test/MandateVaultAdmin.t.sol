// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate, TokenConfig} from "../src/Types.sol";

contract MandateVaultAdminTest is VaultFixture {
    function test_mandateChangeNeedsTimelock() public {
        Mandate memory m = defaultMandate();
        m.maxPremiumBps = 100;
        bytes32 h = vault.mandateChangeHash(m);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, h));
        vault.applyMandate(m);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(vault));
        emit ChangeQueued(h, block.timestamp + 24 hours);
        vault.queueChange(h);

        vm.warp(block.timestamp + 23 hours);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotReady.selector, h, THU_1030_ET + 24 hours));
        vault.applyMandate(m);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.mandate().maxPremiumBps, 100);
        assertEq(vault.mandateHash(), keccak256(abi.encode(m)));
        assertEq(vault.queuedAt(h), 0);
    }

    function test_appliedParamsMustMatchQueued() public {
        Mandate memory queued = defaultMandate();
        queued.maxPremiumBps = 100;
        bytes32 queuedHash = vault.mandateChangeHash(queued); // evaluate before pranking: a view call would consume the prank
        vm.prank(owner);
        vault.queueChange(queuedHash);
        vm.warp(block.timestamp + 25 hours);

        Mandate memory other = defaultMandate();
        other.maxPremiumBps = 500;
        bytes32 otherHash = vault.mandateChangeHash(other); // evaluate before pranking: a view call would consume the prank
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, otherHash));
        vault.applyMandate(other);
    }

    function test_cancelledChangeCannotBeApplied() public {
        Mandate memory m = defaultMandate();
        m.dailyCapUsd = 1_000e6;
        bytes32 h = vault.mandateChangeHash(m);
        vm.startPrank(owner);
        vault.queueChange(h);
        vault.cancelChange(h);
        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, h));
        vault.applyMandate(m);
        vm.stopPrank();
    }

    function test_payeeAndTokenChangesAreTimelocked() public {
        address newPayee = makeAddr("newPayee");
        TokenConfig memory c = TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: 2000});
        vm.startPrank(owner);
        vault.queueChange(vault.payeeChangeHash(newPayee, true));
        vault.queueChange(vault.tokenChangeHash(address(nvda), c));
        vm.warp(block.timestamp + 24 hours);
        vault.applyPayee(newPayee, true);
        vault.applyTokenConfig(address(nvda), c);
        vm.stopPrank();
        assertTrue(vault.allowedPayee(newPayee));
        (,,, uint16 w) = vault.tokenConfig(address(nvda));
        assertEq(w, 2000);
        assertEq(vault.tokens().length, 1);
    }

    function test_executorCannotUseOwnerFunctions() public {
        vm.startPrank(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.withdraw(address(usdc), 1e6);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.queueChange(bytes32(uint256(1)));
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.setExecutor(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.setPaused(false);
        vm.stopPrank();
    }

    function test_withdrawOnlyGoesToOwner() public {
        vm.prank(owner);
        vault.withdraw(address(usdc), 50e6);
        assertEq(usdc.balanceOf(owner), 50e6);
        assertEq(vault.recordedUsdc(), 150e6);
    }

    function test_notifyRevenue() public {
        usdc.mint(address(vault), 10e6);
        vm.expectEmit(false, false, false, true, address(vault));
        emit RevenueReceived(10e6);
        assertEq(vault.notifyRevenue(), 10e6);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_revenueBeforeTradeIsCounted() public {
        usdc.mint(address(vault), 10e6); // x402 payment lands, nobody calls notifyRevenue
        adapter.setNextOut(0.1e8);
        vm.expectEmit(false, false, false, true, address(vault));
        emit RevenueReceived(10e6);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
        assertEq(vault.recordedUsdc(), 190e6);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_rotatingExecutorRevokesOldOne() public {
        address newExec = makeAddr("newExec");
        vm.prank(owner);
        vault.setExecutor(newExec);
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.prank(executor, executor);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.execute(i);
    }
}
