// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AaveV4CreditAdapter} from "../../src/adapters/AaveV4CreditAdapter.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {ICreditAdapter} from "../../src/adapters/ICreditAdapter.sol";
import {IAaveV4Spoke} from "../../src/interfaces/IAaveV4.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {MaatConfig} from "../../script/MaatConfig.sol";

contract AaveV4CreditAdapterForkTest is Test {
    uint256 internal constant MIN_HF = 1.5e18;
    AaveV4CreditAdapter internal adapter;
    uint256 internal collateral;

    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        (address[] memory toks, uint256[] memory ids) = MaatConfig.creditReserves();
        adapter = new AaveV4CreditAdapter(address(this), A.USDC, A.AAVE_MAG7_SPOKE, A.AAVE_RESERVE_USDC, toks, ids);
        AerodromeSwapAdapter swap = new AerodromeSwapAdapter();
        deal(A.USDC, address(this), 100e6);
        IERC20Minimal(A.USDC).approve(address(swap), 20e6);
        collateral = swap.swapExactIn(A.NVDAC_USDC_POOL, A.USDC, 20e6, 0, address(this)); // ~10.7e6 raw
        IB20Asset(A.NVDAC).approve(address(adapter), type(uint256).max);
        IERC20Minimal(A.USDC).approve(address(adapter), type(uint256).max);
    }

    function _usdc(address a) internal view returns (uint256) {
        return IERC20Minimal(A.USDC).balanceOf(a);
    }

    function test_reservesMatchOnchain() public view {
        assertEq(adapter.hub(), A.AAVE_EQUITIES_HUB);
        assertEq(adapter.collateralOperator(), A.AAVE_MAG7_SPOKE);
        assertTrue(adapter.supportsToken(A.NVDAC));
        assertTrue(adapter.supportsToken(A.GOOGLC));
        assertTrue(adapter.supportsToken(A.AAPLC));
    }

    function test_fullCreditLoopOnAave() public {
        adapter.supply(A.NVDAC, collateral);
        assertEq(adapter.suppliedOf(A.NVDAC), collateral);
        (bool enabled,) = IAaveV4Spoke(A.AAVE_MAG7_SPOKE).getUserReserveStatus(A.AAVE_RESERVE_NVDAC, address(adapter));
        assertTrue(enabled);

        uint256 projected = adapter.projectedHealthFactorAfterBorrow(5e6);
        uint256 before = _usdc(address(this));
        adapter.borrow(5e6, MIN_HF);
        assertEq(_usdc(address(this)), before + 5e6);
        assertEq(_usdc(address(adapter)), 0);
        assertApproxEqRel(adapter.healthFactor(), projected, 1e12); // within 1e-6
        assertApproxEqRel(adapter.healthFactor(), 2.7979e18, 0.01e18); // research/04 §5
        assertTrue(adapter.hasPosition());

        vm.warp(vm.getBlockTimestamp() + 1 hours);
        uint256 owed = adapter.debt();
        assertGt(owed, 5e6); // interest accrued
        before = _usdc(address(this));
        adapter.repay(10e6);
        assertEq(adapter.debt(), 0);
        assertApproxEqAbs(_usdc(address(this)), before - owed, 1);
        assertEq(_usdc(address(adapter)), 0);

        assertEq(adapter.withdraw(A.NVDAC, type(uint256).max, MIN_HF), collateral);
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(this)), collateral);
        assertFalse(adapter.hasPosition());
    }

    function test_borrowBelowMinimumHealthFactorReverts() public {
        adapter.supply(A.NVDAC, collateral);
        // $19.98 x 70% = $13.99 of capacity; $10 leaves HF ~1.40 < 1.5
        vm.expectPartialRevert(ICreditAdapter.HealthFactorTooLow.selector);
        adapter.borrow(10e6, MIN_HF);
    }
}
