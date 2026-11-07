// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PriceLib} from "../../src/lib/PriceLib.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

contract PriceLibForkTest is Test {
    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
    }

    function _premium(address feed, address pool, address stock) internal view returns (uint256) {
        (bool fok, uint256 oracle,) = PriceLib.readFeed(feed);
        (bool tok, uint256 dex) = PriceLib.twapPrice(pool, stock, 1800);
        assertTrue(fok && tok);
        return PriceLib.premiumBps(dex, oracle);
    }

    function test_liveBasketTradesNearNav() public view {
        assertLt(_premium(A.NVDA_FEED, A.NVDAC_USDC_POOL, A.NVDAC), 100);
        assertLt(_premium(A.GOOGL_FEED, A.GOOGLC_USDC_POOL, A.GOOGLC), 100);
        assertLt(_premium(A.AAPL_FEED, A.AAPLC_USDC_POOL, A.AAPLC), 100);
    }
}
