// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TickMath} from "v4-core/libraries/TickMath.sol";
import {FullMath} from "v4-core/libraries/FullMath.sol";
import {IAggregatorV3, ICLPool, IERC20Minimal} from "../interfaces/IExternal.sol";

/// @notice All prices are USD per 1 whole token with 8 decimals.
library PriceLib {
    uint8 internal constant PRICE_DECIMALS = 8;
    uint8 internal constant USDC_DECIMALS = 6;

    function readFeed(address feed) internal view returns (bool ok, uint256 price, uint256 age) {
        try IAggregatorV3(feed).latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return (false, 0, 0);
            return (true, uint256(answer), block.timestamp - updatedAt);
        } catch {
            return (false, 0, 0);
        }
    }

    /// @notice Time-weighted price of `stock` from a stock/USDC concentrated-liquidity pool.
    function twapPrice(address pool, address stock, uint32 window) internal view returns (bool ok, uint256 price) {
        if (window == 0) return (false, 0);
        uint32[] memory ago = new uint32[](2);
        ago[0] = window;
        try ICLPool(pool).observe(ago) returns (int56[] memory cum, uint160[] memory) {
            int56 delta = cum[1] - cum[0];
            int56 w = int56(uint56(window));
            int24 tick = int24(delta / w);
            if (delta < 0 && delta % w != 0) tick--;
            bool stockIsToken0 = ICLPool(pool).token0() == stock;
            price = priceFromSqrt(
                TickMath.getSqrtPriceAtTick(tick), stockIsToken0, IERC20Minimal(stock).decimals(), USDC_DECIMALS
            );
            return (price != 0, price);
        } catch {
            return (false, 0);
        }
    }

    function priceFromSqrt(uint160 sqrtPriceX96, bool stockIsToken0, uint8 stockDecimals, uint8 quoteDecimals)
        internal
        pure
        returns (uint256)
    {
        uint256 scale = 10 ** (uint256(stockDecimals) + PRICE_DECIMALS - quoteDecimals);
        uint256 sqrtP = uint256(sqrtPriceX96);
        if (stockIsToken0) {
            // quote raw per stock raw = sqrtP^2 / 2^192
            uint256 ratioX96 = FullMath.mulDiv(sqrtP, sqrtP, 1 << 96);
            return FullMath.mulDiv(ratioX96, scale, 1 << 96);
        }
        // quote raw per stock raw = 2^192 / sqrtP^2
        uint256 inv = FullMath.mulDiv(1 << 96, 1 << 96, sqrtP);
        return FullMath.mulDiv(inv, scale, sqrtP);
    }

    function premiumBps(uint256 dexPrice, uint256 oraclePrice) internal pure returns (uint256) {
        uint256 diff = dexPrice > oraclePrice ? dexPrice - oraclePrice : oraclePrice - dexPrice;
        return diff * 10_000 / oraclePrice;
    }
}
