// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PriceLib} from "../src/lib/PriceLib.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract PriceLibHarness {
    function readFeed(address f) external view returns (bool, uint256, uint256) {
        return PriceLib.readFeed(f);
    }

    function twap(address p, address s, uint32 w) external view returns (bool, uint256) {
        return PriceLib.twapPrice(p, s, w);
    }
}

contract PriceLibTest is Test {
    PriceLibHarness internal h;
    MockERC20 internal usdc;
    MockERC20 internal stock;

    function setUp() public {
        vm.warp(1793892600);
        h = new PriceLibHarness();
        usdc = new MockERC20("USDC", 6);
        stock = new MockERC20("NVDAc", 8);
    }

    function test_priceFromSqrt_stockIsToken1() public pure {
        // slot0 of the NVDAc/USDC Slipstream pool on 2026-11-06 (~$185.08)
        uint256 p = PriceLib.priceFromSqrt(58237376898234626810359736464, false, 8, 6);
        assertApproxEqAbs(p, 18507832338, 1);
    }

    function test_priceFromSqrt_stockIsToken0() public pure {
        // sqrt(1.848) * 2^96 encodes $184.80 when the stock is token0
        uint256 p = PriceLib.priceFromSqrt(107703686134665736396608634880, true, 8, 6);
        assertApproxEqRel(p, 18480000000, 1e14);
    }

    function test_twapPrice() public {
        MockPool pool = new MockPool(address(usdc), address(stock));
        pool.setTick(-6932, 1800); // ~ $200.0036
        (bool ok, uint256 p) = h.twap(address(pool), address(stock), 1800);
        assertTrue(ok);
        assertApproxEqRel(p, 200e8, 1e15);
    }

    function test_twapRoundsNegativeTicksDown() public {
        MockPool pool = new MockPool(address(usdc), address(stock));
        pool.setTick(-6933, 1800);
        (, uint256 expected) = h.twap(address(pool), address(stock), 1800);
        pool.setCumulatives(0, -6932 * 1800 - 1); // average -6932.0006 -> floor -6933
        (, uint256 p) = h.twap(address(pool), address(stock), 1800);
        assertEq(p, expected);
    }

    function test_readFeed() public {
        MockFeed f = new MockFeed(200e8);
        f.set(200e8, block.timestamp - 30);
        (bool ok, uint256 price, uint256 age) = h.readFeed(address(f));
        assertTrue(ok);
        assertEq(price, 200e8);
        assertEq(age, 30);
    }

    function test_readFeedRejectsBadAnswers() public {
        MockFeed f = new MockFeed(0);
        (bool ok,,) = h.readFeed(address(f));
        assertFalse(ok);
        f.set(-1, block.timestamp);
        (ok,,) = h.readFeed(address(f));
        assertFalse(ok);
        f.set(200e8, block.timestamp + 1);
        (ok,,) = h.readFeed(address(f));
        assertFalse(ok);
        f.set(200e8, 0);
        (ok,,) = h.readFeed(address(f));
        assertFalse(ok);
    }

    function test_premiumBps() public pure {
        assertEq(PriceLib.premiumBps(101e8, 100e8), 100);
        assertEq(PriceLib.premiumBps(99e8, 100e8), 100);
        assertEq(PriceLib.premiumBps(100e8, 100e8), 0);
    }
}
