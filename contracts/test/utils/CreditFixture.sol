// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./VaultFixture.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate} from "../../src/Types.sol";
import {MockCreditAdapter} from "../mocks/MockCreditAdapter.sol";

/// @notice VaultFixture with credit enabled through a MockCreditAdapter. The vault holds 200 USDC and 1 NVDAc
/// ($200); the adapter holds 1,000 USDC to lend.
abstract contract CreditFixture is VaultFixture {
    uint256 internal constant FRI_1300_ET = 1793988000; // Fri 2026-11-06 18:00 UTC
    uint256 internal constant FRI_1400_ET = 1793991600; // Fri 2026-11-06 19:00 UTC
    uint256 internal constant FRI_1500_ET = 1793995200; // Fri 2026-11-06 20:00 UTC
    uint64 internal constant MIN_HF = 1.5e18;
    uint64 internal constant TARGET_HF = 2e18;

    MockCreditAdapter internal credit;

    function setUp() public virtual override {
        super.setUp();
        (vault, credit) = _deployCreditVault(creditMandate());
        usdc.mint(address(vault), 200e6);
        vault.notifyRevenue();
        nvda.mint(address(vault), 1e8);
    }

    /// @dev deriskWindow is 6h so Fri 14:00-16:00 ET (REGULAR market still open) falls inside the window.
    function creditMandate() internal view returns (Mandate memory m) {
        m = defaultMandate();
        m.minHealthFactor = MIN_HF;
        m.targetHealthFactor = TARGET_HF;
        m.deriskWindow = 6 hours;
    }

    /// @dev Deploys the adapter at nonce n, bound to the address the vault gets at nonce n + 1, then the vault.
    /// Foundry bumps this contract's nonce on every external call it makes, so no call (setSupported, mint) may
    /// sit between the two deployments; the adapter is configured after the vault exists.
    function _deployCreditVault(Mandate memory m) internal returns (MandateVault v, MockCreditAdapter a) {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        a = new MockCreditAdapter(predicted, address(usdc));
        m.creditAdapter = address(a);
        v = _deployVault(m);
        assertEq(address(v), predicted);
        a.setSupported(address(nvda), true);
        usdc.mint(address(a), 1_000e6);
    }

    /// @dev A fresh adapter (over `usdc_`) bound to the address `this.deployVaultExternal` will give the vault.
    /// The self-call bumps the nonce once before the vault is created, hence + 2 (adapter, then the call).
    function _adapterForExternalDeploy(address usdc_) internal returns (MockCreditAdapter) {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 2);
        return new MockCreditAdapter(predicted, usdc_);
    }

    /// @dev External so constructor reverts can be caught with vm.expectRevert.
    function deployVaultExternal(Mandate memory m) external returns (MandateVault) {
        return _deployVault(m);
    }

    function _creditIntent(Action a, address token, uint256 amount) internal returns (Intent memory i) {
        i = _intent(a, amount);
        i.token = token;
    }

    function _execCredit(Action a, address token, uint256 amount) internal returns (Reason reason) {
        (, reason) = _exec(_creditIntent(a, token, amount));
    }

    function _supplyAll() internal {
        _assertReason(_execCredit(Action.SUPPLY, address(nvda), 1e8), Reason.OK);
    }

    /// @dev Warps and refreshes the collateral feed so FEED_STALE cannot mask the check under test.
    function _warpFresh(uint256 ts) internal {
        vm.warp(ts);
        feed.set(200e8, ts);
    }
}
