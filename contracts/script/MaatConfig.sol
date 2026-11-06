// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SessionMode, Mandate, TokenConfig} from "../src/Types.sol";
import {BaseAddresses as A} from "./BaseAddresses.sol";

/// @notice Agent #1 mandate (spec §3.2) and basket (spec §3.5).
library MaatConfig {
    /// Credit defaults (spec §3.2). targetHealthFactor already includes the spec's "targetHF + buffer".
    uint64 internal constant MIN_HEALTH_FACTOR = 1.5e18;
    uint64 internal constant TARGET_HEALTH_FACTOR = 2e18;
    uint32 internal constant DERISK_WINDOW = 4 hours;

    function defaultMandate(SessionMode mode, address calendar, address swapAdapter, address creditAdapter)
        internal
        pure
        returns (Mandate memory)
    {
        return Mandate({
            sessionMode: mode,
            // 100 not 50: measured in-session TWAP(1800s)-vs-Chainlink premiums at BLOCK_SESSION were
            // NVDAc 53 bps, GOOGLc 49 bps, AAPLc 29 bps (research/04-onchain-findings.md).
            maxPremiumBps: 100,
            maxSlippageBps: 100,
            maxStaleness: 3600,
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
}
