// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CreditFixture} from "./utils/CreditFixture.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate, TokenConfig} from "../src/Types.sol";
import {ICreditAdapter} from "../src/adapters/ICreditAdapter.sol";
import {B20Constants} from "../src/interfaces/IB20Asset.sol";
import {MockCreditAdapter} from "./mocks/MockCreditAdapter.sol";

contract MandateVaultCreditTest is CreditFixture {
    // ------------------------------------------------------------------ config (Task 1)

    function test_creditMandateIsAccepted() public view {
        Mandate memory m = vault.mandate();
        assertEq(m.creditAdapter, address(credit));
        assertEq(m.minHealthFactor, MIN_HF);
        assertEq(m.targetHealthFactor, TARGET_HF);
        assertEq(m.deriskWindow, 6 hours);
    }

    function test_rejectsAdapterWithoutCode() public {
        Mandate memory m = creditMandate();
        m.creditAdapter = makeAddr("noCodeAdapter");
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }

    function test_rejectsAdapterBoundToAnotherVault() public {
        Mandate memory m = creditMandate();
        m.creditAdapter = address(new MockCreditAdapter(makeAddr("otherVault"), address(usdc)));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }

    function test_rejectsAdapterWithOtherUsdc() public {
        Mandate memory m = creditMandate();
        m.creditAdapter = address(_adapterForExternalDeploy(makeAddr("otherUsdc")));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }

    /// @dev Control for the rejection tests above: the same external-deploy path accepts a well-formed adapter,
    /// so those reverts come from the field under test and not from a mispredicted vault address.
    function test_externalDeployAcceptsWellFormedAdapter() public {
        Mandate memory m = creditMandate();
        m.creditAdapter = address(_adapterForExternalDeploy(address(usdc)));
        MandateVault v = this.deployVaultExternal(m);
        assertEq(v.mandate().creditAdapter, m.creditAdapter);
    }

    function test_rejectsBadHealthFactorBounds() public {
        Mandate memory m = creditMandate();
        m.minHealthFactor = 0.99e18;
        _expectCreditConfigRevert(m);
        m = creditMandate();
        m.targetHealthFactor = MIN_HF - 1;
        _expectCreditConfigRevert(m);
        m = creditMandate();
        m.deriskWindow = 12 hours + 1;
        _expectCreditConfigRevert(m);
    }

    function test_acceptsBoundaryHealthFactorBounds() public {
        Mandate memory m = creditMandate();
        m.minHealthFactor = 1e18;
        m.targetHealthFactor = 1e18;
        m.deriskWindow = 12 hours;
        (MandateVault v,) = _deployCreditVault(m);
        assertEq(v.mandate().deriskWindow, 12 hours);
    }

    function test_cannotSwitchAdapterWithOpenPosition() public {
        credit.setDebt(1e6);
        Mandate memory m = vault.mandate();
        m.creditAdapter = address(new MockCreditAdapter(address(vault), address(usdc)));
        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.CreditPositionOpen.selector);
        vault.applyMandate(m);
    }

    function test_cannotDisableCreditWithSuppliedCollateral() public {
        credit.setSupplied(address(nvda), 1e8);
        Mandate memory m = vault.mandate();
        m.creditAdapter = address(0);
        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.CreditPositionOpen.selector);
        vault.applyMandate(m);
    }

    function test_unreadablePositionCountsAsOpen() public {
        credit.setViewsRevert(true);
        Mandate memory m = vault.mandate();
        m.creditAdapter = address(0);
        _queueMandateAndWait(m);
        vm.prank(owner);
        vm.expectRevert(MandateVault.CreditPositionOpen.selector);
        vault.applyMandate(m);
    }

    function test_canSwitchAdapterWhenFlat() public {
        Mandate memory m = vault.mandate();
        MockCreditAdapter next = new MockCreditAdapter(address(vault), address(usdc));
        m.creditAdapter = address(next);
        _queueMandateAndWait(m);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.mandate().creditAdapter, address(next));
    }

    function test_canRetuneSameAdapterWithOpenPosition() public {
        credit.setDebt(1e6);
        Mandate memory m = vault.mandate();
        m.targetHealthFactor = 2.5e18;
        _queueMandateAndWait(m);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.mandate().targetHealthFactor, 2.5e18);
    }

    // ------------------------------------------------------------------ SUPPLY / REPAY (Task 3)

    function test_supplyMovesCollateralToAdapter() public {
        _supplyAll();
        assertEq(nvda.balanceOf(address(vault)), 0);
        assertEq(nvda.balanceOf(address(credit)), 1e8);
        assertEq(credit.suppliedOf(address(nvda)), 1e8);
        assertEq(nvda.allowance(address(vault), address(credit)), 0);
        assertEq(vault.spentOnDay(vault.today()), 0);
    }

    function test_supplyIsAllowedWhileMarketClosed() public {
        vm.warp(SAT_1300_ET);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.OK);
    }

    function test_supplyRefusals() public {
        _assertReason(_execCredit(Action.SUPPLY, address(usdc), 1e6), Reason.TOKEN_NOT_ALLOWED);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 0), Reason.INSUFFICIENT_BALANCE);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8 + 1), Reason.INSUFFICIENT_BALANCE);
        credit.setSupported(address(nvda), false);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.TOKEN_NOT_ALLOWED);
    }

    function test_supplyOfPausedTokenIsRefused() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.TOKEN_PAUSED);
    }

    function test_supplyChecksCustodianPolicy() public {
        address hub = makeAddr("hub");
        credit.setCustodian(hub);
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 9);
        registry.setAuthorized(9, address(credit), true); // the adapter may receive, the hub may not
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.POLICY_BLOCKED);
        registry.setAuthorized(9, hub, true);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.OK);
    }

    function test_supplyAdapterFailureIsLogged() public {
        credit.setMutationsRevert(true, "");
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.CREDIT_FAILED);
        assertEq(nvda.balanceOf(address(vault)), 1e8);
        assertEq(nvda.allowance(address(vault), address(credit)), 0);
    }

    function test_unreadableAdapterIsCreditFailed() public {
        credit.setViewsRevert(true);
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.CREDIT_FAILED);
    }

    function test_repayPullsOnlyTheDebt() public {
        credit.setDebt(5e6);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 10e6), Reason.OK);
        assertEq(usdc.balanceOf(address(vault)), 195e6);
        assertEq(credit.debt(), 0);
        assertEq(usdc.allowance(address(vault), address(credit)), 0);
        assertEq(vault.spentOnDay(vault.today()), 0);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_repayIsAllowedWhileMarketClosed() public {
        credit.setDebt(5e6);
        vm.warp(SAT_1300_ET);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 5e6), Reason.OK);
        assertEq(credit.debt(), 0);
    }

    function test_repayRefusals() public {
        credit.setDebt(5e6);
        _assertReason(_execCredit(Action.REPAY, address(nvda), 5e6), Reason.TOKEN_NOT_ALLOWED);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 0), Reason.INSUFFICIENT_BALANCE);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 200e6 + 1), Reason.INSUFFICIENT_BALANCE);
        vm.prank(owner);
        vault.setPaused(true);
        _assertReason(_execCredit(Action.REPAY, address(usdc), 5e6), Reason.VAULT_PAUSED);
    }

    function test_concentrationCountsSuppliedCollateral() public {
        _supplyAll();
        // $200 supplied NVDAc + $20 buy over $400 total = 55% > 40%. Ignoring collateral it would be 10%.
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.CONCENTRATION);
        credit.setSupplied(address(nvda), 0); // control: without the collateral the same buy passes
        adapter.setNextOut(0.1e8);
        (, r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
    }

    function test_unreadableCollateralFailsConcentrationClosed() public {
        _supplyAll();
        credit.setSupplied(address(nvda), 0);
        credit.setViewsRevert(true);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.CONCENTRATION);
    }

    /// @dev Binds a fresh adapter to the address the next vault deployment gets, so only `m`'s bounds can fail.
    function _expectCreditConfigRevert(Mandate memory m) internal {
        m.creditAdapter = address(_adapterForExternalDeploy(address(usdc)));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }
}
