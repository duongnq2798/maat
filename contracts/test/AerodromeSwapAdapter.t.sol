// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {AerodromeSwapAdapter} from "../src/adapters/AerodromeSwapAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPartialPool} from "./mocks/MockPartialPool.sol";

contract AerodromeSwapAdapterTest is Test {
    AerodromeSwapAdapter internal adapter;
    MockERC20 internal usdc;
    MockERC20 internal stock;
    MockPartialPool internal pool;

    function setUp() public {
        adapter = new AerodromeSwapAdapter();
        usdc = new MockERC20("USDC", 6);
        stock = new MockERC20("NVDAc", 8);
        pool = new MockPartialPool(address(usdc), address(stock));
        stock.mint(address(pool), 10e8);
        usdc.mint(address(this), 100e6);
        usdc.approve(address(adapter), 100e6);
    }

    function test_refundsUnusedInputOnPartialFill() public {
        pool.setOut(0.25e8);
        uint256 out = adapter.swapExactIn(address(pool), address(usdc), 100e6, 0.2e8, address(this));
        assertEq(out, 0.25e8);
        assertEq(stock.balanceOf(address(this)), 0.25e8);
        assertEq(usdc.balanceOf(address(this)), 50e6); // half refunded
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(stock.balanceOf(address(adapter)), 0);
    }

    function test_revertsBelowMinOut() public {
        pool.setOut(0.1e8);
        vm.expectRevert(abi.encodeWithSelector(AerodromeSwapAdapter.InsufficientOutput.selector, 0.1e8, 0.2e8));
        adapter.swapExactIn(address(pool), address(usdc), 100e6, 0.2e8, address(this));
    }

    function test_rejectsTokenNotInPool() public {
        MockERC20 other = new MockERC20("X", 18);
        vm.expectRevert(AerodromeSwapAdapter.TokenNotInPool.selector);
        adapter.swapExactIn(address(pool), address(other), 1, 0, address(this));
    }

    function test_rejectsCallbackOutsideSwap() public {
        vm.expectRevert(AerodromeSwapAdapter.BadCallback.selector);
        adapter.uniswapV3SwapCallback(1, 0, abi.encode(address(usdc)));
    }
}
