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
        emit MandateChangeQueued(h, block.timestamp + 24 hours, m);
        vault.queueMandate(m);

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
        vm.prank(owner);
        vault.queueMandate(queued);
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
        vault.queueMandate(m);
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
        vault.queuePayee(newPayee, true);
        vault.queueTokenConfig(address(nvda), c);
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
        vault.queueMandate(defaultMandate());
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.queueTokenConfig(address(nvda), _tokenCfg(2000));
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.queuePayee(executor, true);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.fund(1e6);
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

    // ---------------------------------------------------------------- fix round 1

    function _tokenCfg(uint16 weight) internal view returns (TokenConfig memory) {
        return TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: weight});
    }

    function test_applyMandateCannotBeReplayed() public {
        Mandate memory m = defaultMandate();
        m.maxPremiumBps = 100;
        bytes32 h = vault.mandateChangeHash(m);
        vm.startPrank(owner);
        vault.queueMandate(m);
        vm.warp(block.timestamp + 24 hours);
        vault.applyMandate(m);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, h));
        vault.applyMandate(m);
        vm.stopPrank();
    }

    function test_applyPayeeTimelockNegativePaths() public {
        address pA = makeAddr("payeeA");
        address pB = makeAddr("payeeB");
        bytes32 hA = vault.payeeChangeHash(pA, true);
        bytes32 hB = vault.payeeChangeHash(pB, true);
        uint256 t0 = THU_1030_ET; // constant: via_ir may rematerialize block.timestamp after vm.warp

        vm.startPrank(owner);
        // unqueued
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, hA));
        vault.applyPayee(pA, true);

        // queued but early
        vault.queuePayee(pA, true);
        vm.warp(t0 + 23 hours);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotReady.selector, hA, t0 + 24 hours));
        vault.applyPayee(pA, true);

        // queued A, apply different params B
        vm.warp(t0 + 24 hours);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, hB));
        vault.applyPayee(pB, true);

        // success clears the queue, replay fails
        vault.applyPayee(pA, true);
        assertEq(vault.queuedAt(hA), 0);
        assertTrue(vault.allowedPayee(pA));
        assertFalse(vault.allowedPayee(pB));
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, hA));
        vault.applyPayee(pA, true);
        vm.stopPrank();
    }

    function test_applyTokenConfigTimelockNegativePaths() public {
        TokenConfig memory cA = _tokenCfg(2000);
        TokenConfig memory cB = _tokenCfg(3000);
        bytes32 hA = vault.tokenChangeHash(address(nvda), cA);
        bytes32 hB = vault.tokenChangeHash(address(nvda), cB);
        uint256 t0 = THU_1030_ET; // constant: via_ir may rematerialize block.timestamp after vm.warp

        vm.startPrank(owner);
        // unqueued
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, hA));
        vault.applyTokenConfig(address(nvda), cA);

        // queued but early
        vault.queueTokenConfig(address(nvda), cA);
        vm.warp(t0 + 23 hours);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotReady.selector, hA, t0 + 24 hours));
        vault.applyTokenConfig(address(nvda), cA);

        // queued A, apply different params B
        vm.warp(t0 + 24 hours);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, hB));
        vault.applyTokenConfig(address(nvda), cB);

        // success clears the queue, replay fails
        vault.applyTokenConfig(address(nvda), cA);
        assertEq(vault.queuedAt(hA), 0);
        (,,, uint16 w) = vault.tokenConfig(address(nvda));
        assertEq(w, 2000);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, hA));
        vault.applyTokenConfig(address(nvda), cA);
        vm.stopPrank();
    }

    function test_nonOwnerCannotCancelChange() public {
        address p = makeAddr("queuedPayee");
        bytes32 h = vault.payeeChangeHash(p, true);
        vm.prank(owner);
        vault.queuePayee(p, true);
        address stranger = makeAddr("stranger");

        vm.prank(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.cancelChange(h);
        vm.prank(stranger);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.cancelChange(h);
        assertEq(vault.queuedAt(h), block.timestamp);
    }

    function test_nonOwnerCannotApplyReadyChanges() public {
        Mandate memory m = defaultMandate();
        m.maxPremiumBps = 100;
        TokenConfig memory c = _tokenCfg(2000);
        address newPayee = makeAddr("newPayee");
        address stranger = makeAddr("stranger");
        bytes32 hM = vault.mandateChangeHash(m);
        bytes32 hT = vault.tokenChangeHash(address(nvda), c);
        bytes32 hP = vault.payeeChangeHash(newPayee, true);

        vm.startPrank(owner);
        vault.queueMandate(m);
        vault.queueTokenConfig(address(nvda), c);
        vault.queuePayee(newPayee, true);
        vm.stopPrank();
        vm.warp(block.timestamp + 24 hours);

        address[2] memory callers = [executor, stranger];
        for (uint256 i; i < callers.length; ++i) {
            vm.startPrank(callers[i]);
            vm.expectRevert(MandateVault.NotOwner.selector);
            vault.applyMandate(m);
            vm.expectRevert(MandateVault.NotOwner.selector);
            vault.applyTokenConfig(address(nvda), c);
            vm.expectRevert(MandateVault.NotOwner.selector);
            vault.applyPayee(newPayee, true);
            vm.stopPrank();
        }
        // nothing was consumed or applied
        assertEq(vault.queuedAt(hM), THU_1030_ET);
        assertEq(vault.queuedAt(hT), THU_1030_ET);
        assertEq(vault.queuedAt(hP), THU_1030_ET);
        assertEq(vault.mandate().maxPremiumBps, 50);
        assertFalse(vault.allowedPayee(newPayee));
    }

    // ---------------------------------------------------------------- final review: I1 public, expiring timelock

    function test_queueTokenConfigAndPayeeEmitFullParams() public {
        TokenConfig memory c = _tokenCfg(2000);
        address p = makeAddr("newPayee");
        bytes32 hT = vault.tokenChangeHash(address(nvda), c);
        bytes32 hP = vault.payeeChangeHash(p, true);
        uint256 eta = THU_1030_ET + 24 hours;

        vm.startPrank(owner);
        vm.expectEmit(true, true, false, true, address(vault));
        emit TokenConfigChangeQueued(hT, eta, address(nvda), c);
        vault.queueTokenConfig(address(nvda), c);
        vm.expectEmit(true, true, false, true, address(vault));
        emit PayeeChangeQueued(hP, eta, p, true);
        vault.queuePayee(p, true);
        vm.stopPrank();
        assertEq(vault.queuedAt(hT), THU_1030_ET);
        assertEq(vault.queuedAt(hP), THU_1030_ET);
    }

    function test_expiredChangeReverts() public {
        Mandate memory m = defaultMandate();
        m.perTradeCapUsd = 10e6;
        bytes32 h = vault.mandateChangeHash(m);
        address p = makeAddr("latePayee");
        bytes32 hP = vault.payeeChangeHash(p, true);
        uint256 t0 = THU_1030_ET; // constant: via_ir may rematerialize block.timestamp after vm.warp

        vm.startPrank(owner);
        vault.queueMandate(m);
        vault.queuePayee(p, true);
        vm.warp(t0 + 24 hours + 7 days + 1);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeExpired.selector, h));
        vault.applyMandate(m);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeExpired.selector, hP));
        vault.applyPayee(p, true);
        assertEq(vault.mandate().perTradeCapUsd, 50e6);
        assertFalse(vault.allowedPayee(p));

        // re-queueing restarts the clock
        vault.queueMandate(m);
        vm.warp(t0 + 24 hours + 7 days + 1 + 24 hours);
        vault.applyMandate(m);
        vm.stopPrank();
        assertEq(vault.mandate().perTradeCapUsd, 10e6);
    }

    function test_applyAtExactGraceEdgeWorks() public {
        Mandate memory m = defaultMandate();
        m.perTradeCapUsd = 10e6;
        vm.startPrank(owner);
        vault.queueMandate(m);
        vm.warp(THU_1030_ET + vault.TIMELOCK() + vault.GRACE_PERIOD());
        vault.applyMandate(m);
        vm.stopPrank();
        assertEq(vault.mandate().perTradeCapUsd, 10e6);
        assertEq(vault.GRACE_PERIOD(), 7 days);
    }

    // ---------------------------------------------------------------- final review: I2 hash-committed full policy

    function _policyHashOf(Mandate memory m, address[] memory payees_) internal view returns (bytes32) {
        address[] memory toks = vault.tokens();
        TokenConfig[] memory cfgs = new TokenConfig[](toks.length);
        for (uint256 i; i < toks.length; ++i) {
            (bool a, address f, address pl, uint16 w) = vault.tokenConfig(toks[i]);
            cfgs[i] = TokenConfig({allowed: a, feed: f, pool: pl, maxWeightBps: w});
        }
        return keccak256(abi.encode(m, toks, cfgs, payees_));
    }

    function _one(address a) internal pure returns (address[] memory arr) {
        arr = new address[](1);
        arr[0] = a;
    }

    function test_constructorEmitsPolicyHash() public {
        address[] memory toks = _one(address(nvda));
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = _tokenCfg(4000);
        bytes32 expected = keccak256(abi.encode(defaultMandate(), toks, cfgs, _one(payee)));
        vm.expectEmit(false, false, false, true);
        emit PolicyHashUpdated(expected);
        MandateVault v =
            new MandateVault(owner, executor, address(usdc), address(registry), defaultMandate(), toks, cfgs, _one(payee));
        assertEq(v.policyHash(), expected);
        assertEq(vault.policyHash(), expected); // fixture vault has the same policy
    }

    function test_payeesReflectsAllowAndRevoke() public {
        address p2 = makeAddr("payee2");
        assertEq(vault.payees().length, 1);
        assertEq(vault.payees()[0], payee);

        _queuePayeeAndWait(p2, true);
        vm.prank(owner);
        vault.applyPayee(p2, true);
        address[] memory list = vault.payees();
        assertEq(list.length, 2);
        assertEq(list[1], p2);

        // allowing an already-allowed payee adds no duplicate
        _queuePayeeAndWait(p2, true);
        vm.prank(owner);
        vault.applyPayee(p2, true);
        assertEq(vault.payees().length, 2);

        _queuePayeeAndWait(payee, false);
        vm.prank(owner);
        vault.applyPayee(payee, false);
        list = vault.payees();
        assertEq(list.length, 1);
        assertEq(list[0], p2);
        assertFalse(vault.allowedPayee(payee));

        // revoking a payee that is not allowed is a no-op on the list
        _queuePayeeAndWait(payee, false);
        vm.prank(owner);
        vault.applyPayee(payee, false);
        assertEq(vault.payees().length, 1);
    }

    function test_constructorDeduplicatesPayees() public {
        address[] memory ps = new address[](2);
        ps[0] = payee;
        ps[1] = payee;
        MandateVault v = new MandateVault(
            owner, executor, address(usdc), address(registry), defaultMandate(), new address[](0), new TokenConfig[](0), ps
        );
        assertEq(v.payees().length, 1);
    }

    function test_policyHashTracksPayeeAndTokenConfig() public {
        bytes32 h0 = vault.policyHash();
        bytes32 m0 = vault.mandateHash();
        assertEq(h0, _policyHashOf(defaultMandate(), _one(payee)));

        address p2 = makeAddr("payee2");
        address[] memory both = new address[](2);
        both[0] = payee;
        both[1] = p2;
        bytes32 h1 = _policyHashOf(defaultMandate(), both);
        _queuePayeeAndWait(p2, true);
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(vault));
        emit PolicyHashUpdated(h1);
        vault.applyPayee(p2, true);
        assertEq(vault.policyHash(), h1);
        assertTrue(h1 != h0);
        assertEq(vault.mandateHash(), m0); // mandateHash unchanged by payee changes

        TokenConfig memory c = _tokenCfg(2000);
        _queueTokenAndWait(address(nvda), c);
        vm.prank(owner);
        vault.applyTokenConfig(address(nvda), c);
        bytes32 h2 = vault.policyHash();
        assertTrue(h2 != h1);
        assertEq(h2, _policyHashOf(defaultMandate(), both));
        assertEq(vault.mandateHash(), m0);

        Mandate memory m = defaultMandate();
        m.dailyCapUsd = 90e6;
        _queueMandateAndWait(m);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.policyHash(), _policyHashOf(m, both));
        assertEq(vault.mandateHash(), keccak256(abi.encode(m)));
    }

    // ---------------------------------------------------------------- final review: M4 owner funding

    function test_fundIsNotCountedAsRevenue() public {
        usdc.mint(owner, 100e6);
        vm.startPrank(owner);
        usdc.approve(address(vault), 100e6);
        vm.expectEmit(false, false, false, true, address(vault));
        emit Funded(100e6);
        vault.fund(100e6);
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(vault)), 300e6);
        assertEq(vault.recordedUsdc(), 300e6);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_fundKeepsPendingRevenue() public {
        usdc.mint(address(vault), 10e6); // unrecorded revenue lands first
        usdc.mint(owner, 50e6);
        vm.startPrank(owner);
        usdc.approve(address(vault), 50e6);
        vault.fund(50e6);
        vm.stopPrank();
        assertEq(vault.notifyRevenue(), 10e6);
        assertEq(vault.recordedUsdc(), 260e6);
    }
}
