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

    /// @dev Binds a fresh adapter to the address the next vault deployment gets, so only `m`'s bounds can fail.
    function _expectCreditConfigRevert(Mandate memory m) internal {
        m.creditAdapter = address(_adapterForExternalDeploy(address(usdc)));
        vm.expectRevert(MandateVault.InvalidConfig.selector);
        this.deployVaultExternal(m);
    }
}
