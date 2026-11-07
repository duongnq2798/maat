// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Base mainnet addresses verified on 2026-11-06.
library BaseAddresses {
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant POLICY_REGISTRY = 0x8453000000000000000000000000000000000002;

    address internal constant NVDAC = 0xb20000000000000000000078ee7ce2fE4908108C;
    address internal constant GOOGLC = 0xb2000000000000000000002D0BA3164cc74f58B7;
    address internal constant AAPLC = 0xb200000000000000000000C2e324d24d7eEcd1fb;

    address internal constant NVDA_FEED = 0x04689a41629776563E6822F76f2e57D148d28513;
    address internal constant GOOGL_FEED = 0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2;
    address internal constant AAPL_FEED = 0x787f13dEa48Db0897CbCDD985de77809D837F988;

    /// Aerodrome Slipstream pools, token0 = USDC for all three.
    address internal constant NVDAC_USDC_POOL = 0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC;
    address internal constant GOOGLC_USDC_POOL = 0x16c70F04C3080a127486Cdf5a4C33c066bBF47C3;
    address internal constant AAPLC_USDC_POOL = 0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6;

    /// Aave V4 Equities Hub on Base (verified on Base, 2026-11-06).
    /// On the MAG7 spoke reserveId == hub assetId.
    address internal constant AAVE_MAG7_SPOKE = 0x17905Db0e4A3514467539956c084180616AE7B8D;
    address internal constant AAVE_EQUITIES_HUB = 0xa4d5947Eb727A052bae69C593FfC84247EC9864E;
    address internal constant AAVE_MAG7_ORACLE = 0xaBaf048fD7675Ea34a84332371ffd5D55E322A47;
    uint256 internal constant AAVE_RESERVE_AAPLC = 0;
    uint256 internal constant AAVE_RESERVE_GOOGLC = 2;
    uint256 internal constant AAVE_RESERVE_NVDAC = 5;
    uint256 internal constant AAVE_RESERVE_USDC = 7;

    /// Thu 2026-11-05 15:30 UTC (10:30 ET). NVDA feed = 186.67486580, age 14 s.
    uint256 internal constant BLOCK_SESSION = 53_551_627;
    /// Sat 2026-10-31 18:00 UTC. NVDA feed last updated Fri 2026-10-30 ~19:51 UTC.
    uint256 internal constant BLOCK_WEEKEND = 53_340_127;
}
