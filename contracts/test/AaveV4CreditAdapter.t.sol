// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AaveV4CreditAdapter} from "../src/adapters/AaveV4CreditAdapter.sol";
import {ICreditAdapter} from "../src/adapters/ICreditAdapter.sol";
import {MockSpoke} from "./mocks/MockSpoke.sol";
import {MockB20} from "./mocks/MockB20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract AaveV4CreditAdapterTest is Test {
    uint256 internal constant NVDA_ID = 5;
    uint256 internal constant GOOGL_ID = 2;
    uint256 internal constant USDC_ID = 7;
    uint256 internal constant MIN_HF = 1.5e18;

    address internal vault = makeAddr("vault");
    MockERC20 internal usdc;
    MockB20 internal nvda;
    MockB20 internal googl;
    MockSpoke internal spoke;
    AaveV4CreditAdapter internal adapter;

    function setUp() public {
        usdc = new MockERC20("USDC", 6);
        nvda = new MockB20("NVDAc");
        googl = new MockB20("GOOGLc");
        spoke = new MockSpoke();
        spoke.addReserve(NVDA_ID, address(nvda), 8, 200e8, 7000);
        spoke.addReserve(GOOGL_ID, address(googl), 8, 100e8, 7600);
        spoke.addReserve(USDC_ID, address(usdc), 6, 1e8, 0);
        spoke.setUsdcReserve(USDC_ID);
        usdc.mint(address(spoke), 1_000_000e6);
        adapter = _deploy(_one(address(nvda)), _oneId(NVDA_ID));
        nvda.mint(vault, 10e8);
        usdc.mint(vault, 1_000e6);
        vm.startPrank(vault);
        nvda.approve(address(adapter), type(uint256).max);
        usdc.approve(address(adapter), type(uint256).max);
        vm.stopPrank();
    }

    function _deploy(address[] memory toks, uint256[] memory ids) internal returns (AaveV4CreditAdapter) {
        return new AaveV4CreditAdapter(vault, address(usdc), address(spoke), USDC_ID, toks, ids);
    }

    function deployExternal(address[] memory toks, uint256[] memory ids) external returns (AaveV4CreditAdapter) {
        return _deploy(toks, ids);
    }

    function _one(address a) internal pure returns (address[] memory r) {
        r = new address[](1);
        r[0] = a;
    }

    function _oneId(uint256 id) internal pure returns (uint256[] memory r) {
        r = new uint256[](1);
        r[0] = id;
    }

    function _supply(uint256 amount) internal {
        vm.prank(vault);
        adapter.supply(address(nvda), amount);
    }

    function _borrow(uint256 amount) internal {
        vm.prank(vault);
        adapter.borrow(amount, MIN_HF);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructorBindsReserves() public view {
        assertEq(adapter.vault(), vault);
        assertEq(adapter.usdc(), address(usdc));
        assertEq(adapter.hub(), address(spoke));
        assertEq(adapter.collateralCustodian(address(nvda)), address(spoke));
        assertEq(adapter.collateralOperator(), address(spoke));
        assertTrue(adapter.supportsToken(address(nvda)));
        assertFalse(adapter.supportsToken(address(googl)));
        assertEq(adapter.collaterals().length, 1);
    }

    function test_constructorRejectsMismatchedReserve() public {
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, GOOGL_ID));
        this.deployExternal(_one(address(nvda)), _oneId(GOOGL_ID));
    }

    function test_constructorRejectsForeignHub() public {
        spoke.setHub(NVDA_ID, makeAddr("otherHub"));
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, NVDA_ID));
        this.deployExternal(_one(address(nvda)), _oneId(NVDA_ID));
    }

    function test_constructorRejectsWrongUsdcReserve() public {
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, NVDA_ID));
        new AaveV4CreditAdapter(vault, address(usdc), address(spoke), NVDA_ID, new address[](0), new uint256[](0));
    }

    function test_constructorRejectsDuplicateAndBadInput() public {
        address[] memory twice = new address[](2);
        twice[0] = address(nvda);
        twice[1] = address(nvda);
        uint256[] memory ids = new uint256[](2);
        ids[0] = NVDA_ID;
        ids[1] = NVDA_ID;
        vm.expectRevert(abi.encodeWithSelector(AaveV4CreditAdapter.ReserveMismatch.selector, NVDA_ID));
        this.deployExternal(twice, ids);
        vm.expectRevert(AaveV4CreditAdapter.LengthMismatch.selector);
        this.deployExternal(twice, _oneId(NVDA_ID));
        vm.expectRevert(AaveV4CreditAdapter.ZeroAddress.selector);
        new AaveV4CreditAdapter(address(0), address(usdc), address(spoke), USDC_ID, new address[](0), new uint256[](0));
    }

    // ------------------------------------------------------------------ access

    function test_onlyVaultCanMovePosition() public {
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.supply(address(nvda), 1e8);
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.withdraw(address(nvda), 1e8, MIN_HF);
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.borrow(1e6, MIN_HF);
        vm.expectRevert(ICreditAdapter.NotVault.selector);
        adapter.repay(1e6);
    }

    // ------------------------------------------------------------------ supply

    function test_supplyEnablesCollateralOnce() public {
        _supply(1e8);
        assertEq(adapter.suppliedOf(address(nvda)), 1e8);
        assertEq(nvda.balanceOf(address(spoke)), 1e8);
        assertTrue(spoke.usingAsCollateral(NVDA_ID, address(adapter)));
        assertEq(spoke.setCollateralCalls(), 1);
        assertEq(nvda.allowance(address(adapter), address(spoke)), 0);
        _supply(1e8);
        assertEq(spoke.setCollateralCalls(), 1);
        assertTrue(adapter.hasPosition());
    }

    function test_supplyUnsupportedTokenReverts() public {
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ICreditAdapter.UnsupportedToken.selector, address(googl)));
        adapter.supply(address(googl), 1e8);
    }

    // ------------------------------------------------------------------ borrow

    function test_borrowSendsUsdcToVaultAndChecksHf() public {
        _supply(1e8);
        _borrow(50e6);
        assertEq(usdc.balanceOf(vault), 1_050e6);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(adapter.debt(), 50e6);
        assertEq(adapter.healthFactor(), 2.8e18);
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ICreditAdapter.HealthFactorTooLow.selector, 1.4e18, MIN_HF));
        adapter.borrow(50e6, MIN_HF);
    }

    function test_projectionMatchesPostBorrowHf() public {
        assertEq(adapter.projectedHealthFactorAfterBorrow(0), type(uint256).max);
        _supply(1e8);
        _borrow(20e6);
        uint256 projected = adapter.projectedHealthFactorAfterBorrow(30e6);
        _borrow(30e6);
        assertEq(projected, adapter.healthFactor());
        assertEq(projected, 2.8e18);
    }

    // ------------------------------------------------------------------ repay

    function test_repayPullsOnlyDebtAndSweeps() public {
        _supply(1e8);
        _borrow(50e6);
        spoke.accrue(address(adapter), 7); // interest accrued since the agent read the debt
        uint256 before = usdc.balanceOf(vault);
        vm.prank(vault);
        uint256 repaid = adapter.repay(100e6);
        assertEq(repaid, 50e6 + 7);
        assertEq(usdc.balanceOf(vault), before - 50e6 - 7);
        assertEq(adapter.debt(), 0);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(usdc.allowance(address(adapter), address(spoke)), 0);
    }

    function test_repayWithoutDebtIsNoop() public {
        uint256 before = usdc.balanceOf(vault);
        vm.prank(vault);
        assertEq(adapter.repay(5e6), 0);
        assertEq(usdc.balanceOf(vault), before);
    }

    // ------------------------------------------------------------------ withdraw

    function test_withdrawReturnsCollateralAndChecksHf() public {
        _supply(1e8);
        _borrow(50e6);
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ICreditAdapter.HealthFactorTooLow.selector, 1.4e18, MIN_HF));
        adapter.withdraw(address(nvda), 0.5e8, MIN_HF); // leaves $100 x 70% / $50 = 1.4
        vm.prank(vault);
        assertEq(adapter.withdraw(address(nvda), 0.25e8, MIN_HF), 0.25e8); // leaves 2.1
        assertEq(nvda.balanceOf(vault), 9.25e8);
    }

    function test_withdrawAllWithoutDebtClosesPosition() public {
        _supply(1e8);
        vm.prank(vault);
        assertEq(adapter.withdraw(address(nvda), type(uint256).max, MIN_HF), 1e8);
        assertEq(nvda.balanceOf(vault), 10e8);
        assertFalse(adapter.hasPosition());
    }

    function test_unsupportedTokenHasNothingSupplied() public view {
        assertEq(adapter.suppliedOf(address(googl)), 0);
        assertFalse(adapter.hasPosition());
    }
}
