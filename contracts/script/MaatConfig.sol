// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SessionMode, Mandate, TokenConfig} from "../src/Types.sol";
import {BaseAddresses as A} from "./BaseAddresses.sol";

/// @notice Agent #1 mandate (spec §3.2) and basket (spec §3.5).
library MaatConfig {
    /// Credit defaults (spec §3.2). targetHealthFactor already includes the spec's "targetHF + buffer".
    uint64 internal constant MIN_HEALTH_FACTOR = 1.5e18;
    uint64 internal constant TARGET_HEALTH_FACTOR = 2e18;
    // 8h: starts Fri 12:00 ET, so REGULAR gets 4 trading hours (12:00-16:00) at targetHF before the 20:00 freeze.
    uint32 internal constant DERISK_WINDOW = 8 hours;

    function defaultMandate(SessionMode mode, address calendar, address swapAdapter, address creditAdapter)
        internal
        pure
        returns (Mandate memory)
    {
        return Mandate({
            sessionMode: mode,
            // 100 not 50: measured in-session TWAP(1800s)-vs-Chainlink premiums at BLOCK_SESSION were
            // NVDAc 53 bps, GOOGLc 49 bps, AAPLc 29 bps (measured in session on a Base fork).
            maxPremiumBps: 100,
            // Worst BUY cost against the oracle (pool spot plus fee, 15-min samples, NYSE sessions of Nov 2-6
            // and 9-13 2026) was 121 bps on NVDAc, p99 109 bps. 150 costs at most $0.75 on a $50 trade.
            maxSlippageBps: 150,
            // The feeds' 24h heartbeat plus 1h. They update on a 0.5% move or every 24h; in those sessions
            // they were older than 1h for up to 46% of the time (AAPL), never older than 24h. A dead feed is
            // still caught; the TWAP-vs-oracle premium check is the guard against a frozen price.
            maxStaleness: 25 hours,
            multiplierCooldown: 1 days,
            twapWindow: 1800,
            perTradeCapUsd: 50e6,
            dailyCapUsd: 100e6,
            calendar: calendar,
            swapAdapter: swapAdapter,
            creditAdapter: creditAdapter,
            minHealthFactor: MIN_HEALTH_FACTOR,
            targetHealthFactor: TARGET_HEALTH_FACTOR,
            deriskWindow: DERISK_WINDOW
        });
    }

    function basket() internal pure returns (address[] memory toks, TokenConfig[] memory cfgs) {
        toks = new address[](3);
        cfgs = new TokenConfig[](3);
        toks[0] = A.NVDAC;
        cfgs[0] = TokenConfig({allowed: true, feed: A.NVDA_FEED, pool: A.NVDAC_USDC_POOL, maxWeightBps: 4000});
        toks[1] = A.GOOGLC;
        cfgs[1] = TokenConfig({allowed: true, feed: A.GOOGL_FEED, pool: A.GOOGLC_USDC_POOL, maxWeightBps: 4000});
        toks[2] = A.AAPLC;
        cfgs[2] = TokenConfig({allowed: true, feed: A.AAPL_FEED, pool: A.AAPLC_USDC_POOL, maxWeightBps: 4000});
    }

    /// Aave V4 MAG7 reserves for the basket, in basket order.
    function creditReserves() internal pure returns (address[] memory toks, uint256[] memory ids) {
        toks = new address[](3);
        ids = new uint256[](3);
        toks[0] = A.NVDAC;
        ids[0] = A.AAVE_RESERVE_NVDAC;
        toks[1] = A.GOOGLC;
        ids[1] = A.AAVE_RESERVE_GOOGLC;
        toks[2] = A.AAPLC;
        ids[2] = A.AAVE_RESERVE_AAPLC;
    }
}
