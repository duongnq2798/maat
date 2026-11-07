// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

contract AerodromeSwapAdapterForkTest is Test {
    AerodromeSwapAdapter internal adapter;

    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        adapter = new AerodromeSwapAdapter();
        deal(A.USDC, address(this), 1_000e6);
    }

    function test_buyAndSellNvdac() public {
        IERC20Minimal(A.USDC).approve(address(adapter), 100e6);
        uint256 out = adapter.swapExactIn(A.NVDAC_USDC_POOL, A.USDC, 100e6, 0, address(this));
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(this)), out);
        assertApproxEqRel(out, 53_569_000, 0.02e18); // $100 / $186.67
        assertEq(IERC20Minimal(A.USDC).balanceOf(address(adapter)), 0);

        IB20Asset(A.NVDAC).approve(address(adapter), out);
        uint256 usdcBack = adapter.swapExactIn(A.NVDAC_USDC_POOL, A.NVDAC, out, 0, address(this));
        assertApproxEqRel(usdcBack, 100e6, 0.02e18);
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(adapter)), 0);
    }
}
