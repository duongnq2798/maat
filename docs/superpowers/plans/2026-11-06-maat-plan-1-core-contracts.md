# Maat — Plan 1: Core Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Maat's onchain part on Base mainnet: `MarketCalendar`, `PriceLib`, `GuardLib`, `AerodromeSwapAdapter` and `MandateVault` (BUY / SELL / PAY_EXPENSE, with a `Decision` log). Test with unit tests and fork tests, then add a deploy script.

**Architecture:** The vault receives an `Intent` from the executor (the agent). The vault checks the mandate itself (allowlist, balance, limits, weight) and calls `GuardLib.checkMarket` to check market conditions: pause, policy, trading hours, feed staleness, multiplier, DEX premium versus the oracle. If an intent is rejected, the vault does not revert but emits `Decision(allowed=false, reason)`. Swaps go straight into the Aerodrome Slipstream pool through the adapter, with a `minOut` floor computed from the oracle. Every change that loosens the configuration must go through a 24h timelock.

**Tech Stack:** Solidity 0.8.28, Foundry ≥ 1.8.4 (`hardfork = "base:Cobalt"` to run the B20 precompile), forge-std, `uniswap/v4-core` (only `TickMath` and `FullMath` are used).

**Spec:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md`

### Plan roadmap (the spec is split by subsystem)
- **Plan 1 (this file):** core contracts + fork tests. Week 1.
- **Plan 2:** `CreditAdapter` for the Aave V4 Equities Hub (SUPPLY / BORROW / REPAY / WITHDRAW_COLLATERAL, HF, Friday de-risk) + agent runtime (Claude API, CDP executor, Builder Code `dataSuffix`). Waiting for the Aave V4 research results in `research/03-aave-v4-equities-hub.md`.
- **Plan 3:** Guard Service (`readMarketState`, `preview`) + endpoint x402 + dashboard Next.js + diary.
- **Plan 4:** `MandateFactory`, MCP server, Bankr Skill, replay page, video demo.

### Facts verified onchain on 2026-11-06 (`cast call` to `https://mainnet.base.org`)
- The B20 token is a **precompile**: its bytecode is only `0xef`. Foundry < 1.8.4 cannot run it. These calls can be used: `isPaused(uint8)`, `policyId(bytes32)`, `uiMultiplier()`, `effectiveAt()`, `balanceOfUI(address)`. The policy of NVDAc, GOOGLc and AAPLc is `5` in all 3 transfer scopes, and `isAuthorized(5, 0xdEaD) == true` (blocklist).
- PolicyRegistry: `0x8453000000000000000000000000000000000002`.
- The "Coinbase NVDA" feed has 8 decimals and returns `18457691531` (184.5769), which **matches `nav_price` from the Coinbase API**. So the feed is the price of 1 token, with the multiplier already included.
- Aerodrome Slipstream pool NVDAc/USDC `0xF668…C8EC`: token0 = USDC, token1 = NVDAc, tickSpacing 10, `observe()` is usable. The 30-minute TWAP comes out at about $184.8 (about 0.17% off the feed).
- AMZNc has only about $34k of liquidity (Uniswap), so **the basket is NVDAc / GOOGLc / AAPLc**.
- Pinned blocks for fork tests: `53551627` (Thursday 2026-11-05 15:30 UTC = 10:30 ET, NVDA feed = 186.67486580, feed age 14s) and `53340127` (Saturday 2026-10-31 18:00 UTC, feed unchanged since 30 Oct ~19:51 UTC).

## Global Constraints

- Solidity `0.8.28`; Foundry **≥ 1.8.4**; `foundry.toml` has `hardfork = "base:Cobalt"` and `via_ir = true`.
- Chain Base mainnet (8453). USDC has 6 decimals; B20 has 8 decimals; the Chainlink equity feed has 8 decimals and is the **price of 1 raw token**.
- Valuation = `balanceOf` (raw) × feed price. **Do not use `balanceOfUI` for valuation** (use it for display only).
- `execute()` **does not revert** when the guard rejects. The vault reverts only on a permission error (`NotExecutor`) or a replay (`IntentAlreadyUsed`). Every other outcome emits `Decision`.
- The executor can never move funds out, except through two paths: a swap through an allowlisted adapter (funds return to the vault), or `PAY_EXPENSE` to a payee on the allowlist. When the owner withdraws, funds go only to `owner`.
- Loosening the configuration (mandate, token config, payee) must go through `queueChange` + a **24h** timelock. `MarketCalendar` only allows tightening.
- Token basket: NVDAc, GOOGLc, AAPLc. Default parameters: `maxPremiumBps 50`, `maxSlippageBps 100`, `maxStaleness 3600`, `multiplierCooldown 1 days`, `twapWindow 1800`, `perTradeCapUsd 50e6`, `dailyCapUsd 100e6`, `maxWeightBps 4000`, `sessionMode REGULAR`.
- The team's treasury. It does not accept user funds and does not serve US users. **Every mainnet transaction is signed by you (the owner).**
- All commands run in Git Bash, from the `contracts/` directory, unless noted otherwise. Every new shell must load the env before running fork tests: `set -a; source .env; set +a`.

## Review Focus

1. **A pool where the stock is token0** (token order reversed from the NVDAc pool). Users expect the TWAP to still give the correct price. Test: `test_priceFromSqrt_stockIsToken0` (Task 2).
2. **Negative tick cumulative that is not evenly divisible by the window.** The tick must round toward −∞ like Uniswap's OracleLibrary. Test: `test_twapRoundsNegativeTicksDown` (Task 2).
3. **The swap fills only partially** (the pool stops at the price limit). The leftover tokenIn must be returned to the vault, not stuck in the adapter. Test: `test_refundsUnusedInputOnPartialFill` (Task 4).
4. **The multiplier changes through the legacy path, without setting `effectiveAt`.** The vault must still detect the change and start the cooldown. Test: `test_multiplierChangeStartsCooldown` (Task 5).
5. **USDC revenue arrives between two `notifyRevenue` calls, and then the vault trades right away.** That amount must still be recorded as revenue, not swallowed. Test: `test_revenueBeforeTradeIsCounted` (Task 6).

---

## File Structure

```
contracts/
  foundry.toml              Foundry config (hardfork base:Cobalt, rpc "base")
  remappings.txt
  .env.example              BASE_RPC_URL, MAAT_OWNER, MAAT_EXECUTOR, MAAT_EXPENSE_PAYEE
  src/
    Types.sol               enum Action/Reason/SessionMode, struct Intent/Mandate/TokenConfig
    IMandateVaultEvents.sol the vault's events (tests inherit it too)
    MarketCalendar.sol      NYSE session hours in ET (with DST), holidays, early closes; can only tighten
    GuardLib.sol            market checks: pause, policy, hours, feed, multiplier, premium
    MandateVault.sol        Intent → check → execute → Decision; timelock; revenue
    interfaces/
      IB20Asset.sol         IB20Asset, IPolicyRegistry, B20Constants
      IExternal.sol         IERC20Minimal, IAggregatorV3, ICLPool, ISwapCallback
    lib/
      DateLib.sol           Gregorian date conversions, weekday, n-th Sunday
      PriceLib.sol          read the feed, TWAP from the CL pool, premium
      TokenTransfer.sol     safeTransfer/From/Approve (bubbles up the revert reason)
    adapters/
      ISwapAdapter.sol
      AerodromeSwapAdapter.sol  swaps directly against the CL pool; callback verifies the pool; refunds unused input
  script/
    BaseAddresses.sol       mainnet addresses + pinned fork blocks
    MaatConfig.sol          default mandate + token basket
    Deploy.s.sol
  test/
    mocks/                  MockERC20, MockB20, MockPolicyRegistry, MockFeed, MockPool, MockPartialPool, MockSwapAdapter
    utils/VaultFixture.sol
    MarketCalendar.t.sol  PriceLib.t.sol  GuardLib.t.sol  AerodromeSwapAdapter.t.sol
    MandateVault.t.sol  MandateVaultAdmin.t.sol
    fork/ B20Smoke.t.sol  PriceLibFork.t.sol  AerodromeSwapAdapterFork.t.sol  MandateVaultFork.t.sol  DeployFork.t.sol
```

---

### Task 0: Repo, toolchain, and fork smoke test for the B20 precompile

**Files:**
- Create: `.gitignore` (at the root), `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/.env.example`
- Create: `contracts/src/interfaces/IB20Asset.sol`, `contracts/src/interfaces/IExternal.sol`, `contracts/script/BaseAddresses.sol`
- Test: `contracts/test/fork/B20Smoke.t.sol`

**Interfaces:**
- Produces: `IB20Asset`, `IPolicyRegistry`, `B20Constants` (`POLICY_REGISTRY`, `FEATURE_TRANSFER`, `TRANSFER_SENDER_POLICY`, `TRANSFER_RECEIVER_POLICY`, `TRANSFER_EXECUTOR_POLICY`); `IERC20Minimal`, `IAggregatorV3`, `ICLPool`, `ISwapCallback`; library `BaseAddresses` (addresses and blocks).

- [ ] **Step 1: Initialize git and upgrade Foundry**

```bash
cd /e/APP2028/stocks-maxxing-hackathon
git init
foundryup
forge --version
```
Expected: `forge Version: 1.8.4` or newer. If it is lower, run `foundryup --install stable` and check again.

- [ ] **Step 2: Create the project structure and install libraries**

```bash
mkdir -p contracts/src/interfaces contracts/src/lib contracts/src/adapters contracts/script contracts/test/mocks contracts/test/utils contracts/test/fork
cd contracts
forge install foundry-rs/forge-std uniswap/v4-core
```

`/e/APP2028/stocks-maxxing-hackathon/.gitignore`:
```gitignore
contracts/out/
contracts/cache/
contracts/broadcast/*/31337/
.env
contracts/.env
node_modules/
```

`contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"
evm_version = "cancun"
hardfork = "base:Cobalt"
via_ir = true
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
base = "${BASE_RPC_URL}"

[fmt]
line_length = 110
```

`contracts/remappings.txt`:
```
forge-std/=lib/forge-std/src/
v4-core/=lib/v4-core/src/
```

`contracts/.env.example`:
```bash
# Public RPC with archive state (tried on 2026-11-06). If you get a 429, use a free Alchemy/QuickNode key.
BASE_RPC_URL=https://mainnet.base.org
MAAT_OWNER=0x0000000000000000000000000000000000000000
MAAT_EXECUTOR=0x0000000000000000000000000000000000000000
MAAT_EXPENSE_PAYEE=0x0000000000000000000000000000000000000000
```

```bash
cp .env.example .env
```

- [ ] **Step 3: Write the interfaces**

`contracts/src/interfaces/IB20Asset.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Subset of the B20 Asset surface (Base hardfork Cobalt) used by Maat.
/// Verified against NVDAc on Base mainnet on 2026-11-06 with `cast call`.
interface IB20Asset {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function isPaused(uint8 feature) external view returns (bool);
    function policyId(bytes32 scope) external view returns (uint64);
    function uiMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
}

interface IPolicyRegistry {
    function isAuthorized(uint64 policyId, address account) external view returns (bool);
    function policyExists(uint64 policyId) external view returns (bool);
}

library B20Constants {
    address internal constant POLICY_REGISTRY = 0x8453000000000000000000000000000000000002;
    uint8 internal constant FEATURE_TRANSFER = 0;
    bytes32 internal constant TRANSFER_SENDER_POLICY = keccak256("TRANSFER_SENDER_POLICY");
    bytes32 internal constant TRANSFER_RECEIVER_POLICY = keccak256("TRANSFER_RECEIVER_POLICY");
    bytes32 internal constant TRANSFER_EXECUTOR_POLICY = keccak256("TRANSFER_EXECUTOR_POLICY");
}
```

`contracts/src/interfaces/IExternal.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Aerodrome Slipstream / Uniswap v3 style concentrated-liquidity pool.
interface ICLPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}

interface ISwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}
```

`contracts/script/BaseAddresses.sol`:
```solidity
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

    /// Thu 2026-11-05 15:30 UTC (10:30 ET). NVDA feed = 186.67486580, age 14 s.
    uint256 internal constant BLOCK_SESSION = 53_551_627;
    /// Sat 2026-10-31 18:00 UTC. NVDA feed last updated Fri 2026-10-30 ~19:51 UTC.
    uint256 internal constant BLOCK_WEEKEND = 53_340_127;
}
```

- [ ] **Step 4: Write the fork smoke test (this test must fail if the precompile does not run)**

`contracts/test/fork/B20Smoke.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IB20Asset, IPolicyRegistry, B20Constants} from "../../src/interfaces/IB20Asset.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

contract B20SmokeForkTest is Test {
    function setUp() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
    }

    function test_readsB20StateThroughPrecompile() public view {
        IB20Asset t = IB20Asset(A.NVDAC);
        assertEq(t.decimals(), 8);
        assertGe(t.uiMultiplier(), 1e18);
        assertFalse(t.isPaused(B20Constants.FEATURE_TRANSFER));
        uint64 id = t.policyId(B20Constants.TRANSFER_RECEIVER_POLICY);
        assertTrue(id == 0 || IPolicyRegistry(B20Constants.POLICY_REGISTRY).policyExists(id));
    }

    function test_transfersNvdacOnFork() public {
        address holder = A.NVDAC_USDC_POOL;
        vm.prank(holder);
        IB20Asset(A.NVDAC).transfer(address(0xBEEF), 1e8);
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(0xBEEF)), 1e8);
    }
}
```

- [ ] **Step 5: Run the smoke test**

```bash
set -a; source .env; set +a
forge test --match-path test/fork/B20Smoke.t.sol -vvv
```
Expected: 2 test PASS.
If it fails with `EvmError: Revert`/`call to non-contract` when calling `0xb2000…`, the precompile is not running. Check `forge --version` (must be ≥ 1.8.4) and re-run with the `--hardfork base:Cobalt` flag. If you get HTTP 429, switch `BASE_RPC_URL` to an RPC with a key.

- [ ] **Step 6: Commit**

```bash
cd /e/APP2028/stocks-maxxing-hackathon
git add .gitignore contracts docs research reports research_notes
git commit -m "chore: scaffold Maat contracts with Base B20 fork smoke test"
```

---

### Task 1: Types, DateLib and MarketCalendar

**Files:**
- Create: `contracts/src/Types.sol`, `contracts/src/lib/DateLib.sol`, `contracts/src/MarketCalendar.sol`
- Test: `contracts/test/MarketCalendar.t.sol`

**Interfaces:**
- Produces:
  - `enum Action { BUY, SELL, SUPPLY, WITHDRAW_COLLATERAL, BORROW, REPAY, PAY_EXPENSE }`
  - `enum Reason { OK, VAULT_PAUSED, ACTION_NOT_SUPPORTED, TOKEN_NOT_ALLOWED, TOKEN_PAUSED, POLICY_BLOCKED, MARKET_CLOSED, FEED_STALE, BAD_PRICE, MULTIPLIER_COOLDOWN, PREMIUM_TOO_HIGH, SIZE_LIMIT, CONCENTRATION, PAYEE_NOT_ALLOWED, INSUFFICIENT_BALANCE, SWAP_FAILED }`
  - `enum SessionMode { REGULAR, FEED_24_5 }`
  - `struct Intent { bytes32 id; Action action; address token; uint256 amount; uint256 minOut; address payee; bytes32 rationaleHash; }`
  - `struct Mandate { SessionMode sessionMode; uint16 maxPremiumBps; uint16 maxSlippageBps; uint32 maxStaleness; uint32 multiplierCooldown; uint32 twapWindow; uint128 perTradeCapUsd; uint128 dailyCapUsd; address calendar; address swapAdapter; }`
  - `struct TokenConfig { bool allowed; address feed; address pool; uint16 maxWeightBps; }`
  - `DateLib.daysFromCivil(uint256 y, uint256 m, uint256 d) → uint256`, `DateLib.civilFromDays(uint256) → (y, m, d)`, `DateLib.weekday(uint256) → uint256` (0 = Sunday), `DateLib.nthSunday(uint256 y, uint256 m, uint256 n) → uint256`
  - `MarketCalendar(address owner)`; `isOpen(uint256 ts, SessionMode mode) → bool`; `etOffsetSeconds(uint256 ts) → uint256`; `localTime(uint256 ts) → (etDay, weekday, minuteOfDay)`; `addHoliday(y,m,d)`; `setEarlyClose(y,m,d,uint16 closeMin)`; `isHoliday(uint256 etDay) → bool`; `earlyCloseMin(uint256 etDay) → uint16`

- [ ] **Step 1: Write the failing test**

`contracts/test/MarketCalendar.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {DateLib} from "../src/lib/DateLib.sol";
import {SessionMode} from "../src/Types.sol";

contract MarketCalendarTest is Test {
    MarketCalendar internal cal;

    // UTC timestamps computed with Python datetime on 2026-11-06.
    uint256 internal constant THU_1530_UTC = 1793892600; // 10:30 EST
    uint256 internal constant THU_2130_UTC = 1793914200; // 16:30 EST
    uint256 internal constant THU_1415_UTC = 1793888100; // 09:15 EST
    uint256 internal constant FRI_0639_UTC = 1793947140; // 01:39 EST
    uint256 internal constant SAT_1800_UTC = 1793469600; // Sat 31 Oct
    uint256 internal constant MON_0030_UTC = 1794184200; // Sun 8 Nov 19:30 EST
    uint256 internal constant MON_0130_UTC = 1794187800; // Sun 8 Nov 20:30 EST
    uint256 internal constant SAT_0030_UTC = 1794011400; // Fri 6 Nov 19:30 EST
    uint256 internal constant SAT_0130_UTC = 1794015000; // Fri 6 Nov 20:30 EST
    uint256 internal constant THANKSGIVING_1530_UTC = 1795707000; // Thu 26 Nov
    uint256 internal constant FRI27_1730_UTC = 1795800600; // 12:30 EST, early close 13:00
    uint256 internal constant FRI27_1830_UTC = 1795804200; // 13:30 EST
    uint256 internal constant WED_1345_UTC_EDT = 1793195100; // Wed 28 Oct 09:45 EDT
    uint256 internal constant TUE_DEC1_1530_UTC = 1796139000; // Tue 1 Dec 10:30 EST

    function setUp() public {
        cal = new MarketCalendar(address(this));
    }

    function test_daysFromCivil() public pure {
        assertEq(DateLib.daysFromCivil(1970, 1, 1), 0);
        assertEq(DateLib.daysFromCivil(2000, 2, 29), 11016);
        assertEq(DateLib.daysFromCivil(2026, 11, 26), 20783);
    }

    function test_civilFromDaysRoundTrip() public pure {
        (uint256 y, uint256 m, uint256 d) = DateLib.civilFromDays(20783);
        assertEq(y, 2026);
        assertEq(m, 11);
        assertEq(d, 26);
        (y, m, d) = DateLib.civilFromDays(11016);
        assertEq(y, 2000);
        assertEq(m, 2);
        assertEq(d, 29);
    }

    function test_weekdayAndNthSunday() public pure {
        assertEq(DateLib.weekday(20783), 4); // Thursday
        assertEq(DateLib.nthSunday(2026, 3, 2), 20520); // 8 Mar 2026
        assertEq(DateLib.nthSunday(2026, 11, 1), 20758); // 1 Nov 2026
    }

    function test_dstBoundaries() public view {
        assertEq(cal.etOffsetSeconds(1772953140), 5 hours); // 8 Mar 06:59 UTC
        assertEq(cal.etOffsetSeconds(1772953200), 4 hours); // 8 Mar 07:00 UTC
        assertEq(cal.etOffsetSeconds(1793512740), 4 hours); // 1 Nov 05:59 UTC
        assertEq(cal.etOffsetSeconds(1793512800), 5 hours); // 1 Nov 06:00 UTC
    }

    function test_regularSession() public view {
        assertTrue(cal.isOpen(THU_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(THU_2130_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(THU_1415_UTC, SessionMode.REGULAR));
        assertTrue(cal.isOpen(WED_1345_UTC_EDT, SessionMode.REGULAR));
        assertFalse(cal.isOpen(FRI_0639_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(SAT_1800_UTC, SessionMode.REGULAR));
    }

    function test_feed245Session() public view {
        assertTrue(cal.isOpen(THU_2130_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(FRI_0639_UTC, SessionMode.FEED_24_5));
        assertFalse(cal.isOpen(SAT_1800_UTC, SessionMode.FEED_24_5));
        assertFalse(cal.isOpen(MON_0030_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(MON_0130_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(SAT_0030_UTC, SessionMode.FEED_24_5));
        assertFalse(cal.isOpen(SAT_0130_UTC, SessionMode.FEED_24_5));
    }

    function test_holidaysAndEarlyClose() public view {
        assertFalse(cal.isOpen(THANKSGIVING_1530_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(THANKSGIVING_1530_UTC, SessionMode.FEED_24_5));
        assertTrue(cal.isOpen(FRI27_1730_UTC, SessionMode.REGULAR));
        assertFalse(cal.isOpen(FRI27_1830_UTC, SessionMode.REGULAR));
    }

    function test_ownerCanOnlyMakeItStricter() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(MarketCalendar.NotOwner.selector);
        cal.addHoliday(2026, 12, 1);

        vm.expectRevert(MarketCalendar.InvalidClose.selector);
        cal.setEarlyClose(2026, 11, 27, 840); // later than the existing 13:00 close
        cal.setEarlyClose(2026, 11, 27, 720); // earlier is fine
        assertEq(cal.earlyCloseMin(DateLib.daysFromCivil(2026, 11, 27)), 720);

        assertTrue(cal.isOpen(TUE_DEC1_1530_UTC, SessionMode.REGULAR));
        cal.addHoliday(2026, 12, 1);
        assertFalse(cal.isOpen(TUE_DEC1_1530_UTC, SessionMode.REGULAR));
    }
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `forge test --match-path test/MarketCalendar.t.sol`
Expected: FAIL when compiling (`Source "src/MarketCalendar.sol" not found`).

- [ ] **Step 3: Implement**

`contracts/src/Types.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

enum Action {
    BUY,
    SELL,
    SUPPLY,
    WITHDRAW_COLLATERAL,
    BORROW,
    REPAY,
    PAY_EXPENSE
}

enum Reason {
    OK,
    VAULT_PAUSED,
    ACTION_NOT_SUPPORTED,
    TOKEN_NOT_ALLOWED,
    TOKEN_PAUSED,
    POLICY_BLOCKED,
    MARKET_CLOSED,
    FEED_STALE,
    BAD_PRICE,
    MULTIPLIER_COOLDOWN,
    PREMIUM_TOO_HIGH,
    SIZE_LIMIT,
    CONCENTRATION,
    PAYEE_NOT_ALLOWED,
    INSUFFICIENT_BALANCE,
    SWAP_FAILED
}

enum SessionMode {
    REGULAR, // NYSE 09:30-16:00 ET
    FEED_24_5 // Chainlink equity feed window: Sun 20:00 ET -> Fri 20:00 ET
}

/// @notice BUY: amount = USDC in (6 decimals). SELL: amount = stock raw amount. PAY_EXPENSE: USDC to `payee`.
struct Intent {
    bytes32 id;
    Action action;
    address token;
    uint256 amount;
    uint256 minOut;
    address payee;
    bytes32 rationaleHash;
}

/// @notice USD amounts are USDC units (6 decimals).
struct Mandate {
    SessionMode sessionMode;
    uint16 maxPremiumBps;
    uint16 maxSlippageBps;
    uint32 maxStaleness;
    uint32 multiplierCooldown;
    uint32 twapWindow;
    uint128 perTradeCapUsd;
    uint128 dailyCapUsd;
    address calendar;
    address swapAdapter;
}

struct TokenConfig {
    bool allowed;
    address feed;
    address pool;
    uint16 maxWeightBps;
}
```

`contracts/src/lib/DateLib.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Proleptic Gregorian calendar helpers (Howard Hinnant's algorithms). Day 0 = 1970-01-01.
library DateLib {
    function daysFromCivil(uint256 y, uint256 m, uint256 d) internal pure returns (uint256) {
        int256 yy = int256(y) - (m <= 2 ? int256(1) : int256(0));
        int256 era = (yy >= 0 ? yy : yy - 399) / 400;
        int256 yoe = yy - era * 400;
        int256 mp = (int256(m) + 9) % 12; // March = 0
        int256 doy = (153 * mp + 2) / 5 + int256(d) - 1;
        int256 doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        return uint256(era * 146097 + doe - 719468);
    }

    function civilFromDays(uint256 dayNumber) internal pure returns (uint256 y, uint256 m, uint256 d) {
        int256 z = int256(dayNumber) + 719468;
        int256 era = z / 146097;
        int256 doe = z - era * 146097;
        int256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int256 yy = yoe + era * 400;
        int256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        int256 mp = (5 * doy + 2) / 153;
        d = uint256(doy - (153 * mp + 2) / 5 + 1);
        m = uint256(mp < 10 ? mp + 3 : mp - 9);
        y = uint256(m <= 2 ? yy + 1 : yy);
    }

    /// @return 0 = Sunday ... 6 = Saturday
    function weekday(uint256 dayNumber) internal pure returns (uint256) {
        return (dayNumber + 4) % 7;
    }

    /// @return day number of the n-th (1-based) Sunday of month `m` in year `y`
    function nthSunday(uint256 y, uint256 m, uint256 n) internal pure returns (uint256) {
        uint256 first = daysFromCivil(y, m, 1);
        uint256 offset = (7 - weekday(first)) % 7;
        return first + offset + (n - 1) * 7;
    }
}
```

`contracts/src/MarketCalendar.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DateLib} from "./lib/DateLib.sol";
import {SessionMode} from "./Types.sol";

/// @notice US equity session calendar in America/New_York time.
/// The owner can only make it stricter; loosening means deploying a new calendar through the vault timelock.
contract MarketCalendar {
    uint256 internal constant OPEN_MIN = 570; // 09:30
    uint256 internal constant CLOSE_MIN = 960; // 16:00
    uint256 internal constant FEED_EDGE_MIN = 1200; // 20:00

    address public immutable owner;
    mapping(uint256 etDay => bool) public isHoliday;
    mapping(uint256 etDay => uint16) public earlyCloseMin;

    event HolidayAdded(uint256 indexed etDay);
    event EarlyCloseSet(uint256 indexed etDay, uint16 closeMin);

    error NotOwner();
    error InvalidClose();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        owner = owner_;
        _addHoliday(2026, 11, 26); // Thanksgiving
        _addHoliday(2026, 12, 25); // Christmas
        _addHoliday(2027, 1, 1); // New Year
        _setEarlyClose(2026, 11, 27, 780); // 13:00
        _setEarlyClose(2026, 12, 24, 780);
    }

    function addHoliday(uint256 y, uint256 m, uint256 d) external onlyOwner {
        _addHoliday(y, m, d);
    }

    function setEarlyClose(uint256 y, uint256 m, uint256 d, uint16 closeMin) external onlyOwner {
        _setEarlyClose(y, m, d, closeMin);
    }

    /// @return seconds to subtract from UTC: 4h during US DST, 5h otherwise
    function etOffsetSeconds(uint256 ts) public pure returns (uint256) {
        (uint256 y,,) = DateLib.civilFromDays(ts / 1 days);
        uint256 dstStart = DateLib.nthSunday(y, 3, 2) * 1 days + 7 hours; // 02:00 EST
        uint256 dstEnd = DateLib.nthSunday(y, 11, 1) * 1 days + 6 hours; // 02:00 EDT
        return (ts >= dstStart && ts < dstEnd) ? 4 hours : 5 hours;
    }

    function localTime(uint256 ts) public pure returns (uint256 etDay, uint256 weekday, uint256 minuteOfDay) {
        uint256 local = ts - etOffsetSeconds(ts);
        etDay = local / 1 days;
        weekday = DateLib.weekday(etDay);
        minuteOfDay = (local % 1 days) / 60;
    }

    function isOpen(uint256 ts, SessionMode mode) external view returns (bool) {
        (uint256 day, uint256 wd, uint256 minute) = localTime(ts);
        if (isHoliday[day]) return false;
        if (mode == SessionMode.REGULAR) {
            if (wd == 0 || wd == 6) return false;
            uint256 close = earlyCloseMin[day] != 0 ? earlyCloseMin[day] : CLOSE_MIN;
            return minute >= OPEN_MIN && minute < close;
        }
        if (wd == 6) return false;
        if (wd == 0) return minute >= FEED_EDGE_MIN;
        if (wd == 5) return minute < FEED_EDGE_MIN;
        return true;
    }

    function _addHoliday(uint256 y, uint256 m, uint256 d) internal {
        uint256 day = DateLib.daysFromCivil(y, m, d);
        isHoliday[day] = true;
        emit HolidayAdded(day);
    }

    function _setEarlyClose(uint256 y, uint256 m, uint256 d, uint16 closeMin) internal {
        if (closeMin <= OPEN_MIN || closeMin >= CLOSE_MIN) revert InvalidClose();
        uint256 day = DateLib.daysFromCivil(y, m, d);
        uint16 current = earlyCloseMin[day];
        if (current != 0 && closeMin >= current) revert InvalidClose();
        earlyCloseMin[day] = closeMin;
        emit EarlyCloseSet(day, closeMin);
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `forge test --match-path test/MarketCalendar.t.sol -vv`
Expected: 8 test PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/Types.sol contracts/src/lib/DateLib.sol contracts/src/MarketCalendar.sol contracts/test/MarketCalendar.t.sol
git commit -m "feat: add ET market calendar with DST, holidays and stricter-only updates"
```

---

### Task 2: PriceLib (feed, TWAP, premium)

**Files:**
- Create: `contracts/src/lib/PriceLib.sol`, `contracts/test/mocks/MockFeed.sol`, `contracts/test/mocks/MockPool.sol`, `contracts/test/mocks/MockERC20.sol`
- Test: `contracts/test/PriceLib.t.sol`, `contracts/test/fork/PriceLibFork.t.sol`

**Interfaces:**
- Consumes: `IAggregatorV3`, `ICLPool`, `IERC20Minimal` (Task 0).
- Produces:
  - `PriceLib.readFeed(address feed) → (bool ok, uint256 price8, uint256 age)`
  - `PriceLib.twapPrice(address pool, address stock, uint32 window) → (bool ok, uint256 price8)`, assumes the other coin in the pool is USDC (6 decimals)
  - `PriceLib.priceFromSqrt(uint160 sqrtPriceX96, bool stockIsToken0, uint8 stockDecimals, uint8 quoteDecimals) → uint256 price8`
  - `PriceLib.premiumBps(uint256 dexPrice, uint256 oraclePrice) → uint256`
  - Mocks: `MockFeed(int256 answer)` + `set(int256 answer, uint256 updatedAt)`; `MockPool(address token0, address token1)` + `setTick(int24 tick, uint32 window)` + `setCumulatives(int56 c0, int56 c1)`; `MockERC20(string symbol, uint8 decimals)` + `mint(address,uint256)`

- [ ] **Step 1: Write the mocks and the failing test**

`contracts/test/mocks/MockERC20.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockERC20 {
    string public symbol;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory symbol_, uint8 decimals_) {
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
```

`contracts/test/mocks/MockFeed.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockFeed {
    int256 public answer;
    uint256 public updatedAt;

    constructor(int256 answer_) {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
```

`contracts/test/mocks/MockPool.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockPool {
    address public immutable token0;
    address public immutable token1;
    int56 internal _c0;
    int56 internal _c1;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    /// @notice Makes observe([window, 0]) report a constant `tick` over the window.
    function setTick(int24 tick, uint32 window) external {
        _c0 = 0;
        _c1 = int56(tick) * int56(uint56(window));
    }

    function setCumulatives(int56 c0, int56 c1) external {
        _c0 = c0;
        _c1 = c1;
    }

    function observe(uint32[] calldata) external view returns (int56[] memory cum, uint160[] memory spl) {
        cum = new int56[](2);
        spl = new uint160[](2);
        cum[0] = _c0;
        cum[1] = _c1;
    }
}
```

`contracts/test/PriceLib.t.sol`:
```solidity
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
```

`contracts/test/fork/PriceLibFork.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to confirm it fails**

Run: `forge test --match-path test/PriceLib.t.sol`
Expected: FAIL when compiling (`src/lib/PriceLib.sol` not found).

- [ ] **Step 3: Implement**

`contracts/src/lib/PriceLib.sol`:
```solidity
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
```

- [ ] **Step 4: Run the tests**

```bash
forge test --match-path test/PriceLib.t.sol -vv
forge test --match-path test/fork/PriceLibFork.t.sol -vv
```
Expected: 7 unit test PASS, 1 fork test PASS.
If the fork test fails for GOOGLc or AAPLc with a premium ≥ 100 bps, record the number in `research/04-onchain-findings.md` and then loosen the threshold **of that test only** to 200 bps. This is data for choosing `maxPremiumBps`.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/lib/PriceLib.sol contracts/test/mocks contracts/test/PriceLib.t.sol contracts/test/fork/PriceLibFork.t.sol
git commit -m "feat: add PriceLib for Chainlink staleness, Slipstream TWAP and premium"
```

---

### Task 3: GuardLib (market checks)

**Files:**
- Create: `contracts/src/GuardLib.sol`, `contracts/test/mocks/MockB20.sol`, `contracts/test/mocks/MockPolicyRegistry.sol`
- Test: `contracts/test/GuardLib.t.sol`

**Interfaces:**
- Consumes: `PriceLib.readFeed/twapPrice/premiumBps` (Task 2); `MarketCalendar.isOpen`, `SessionMode`, `Reason` (Task 1); `IB20Asset`, `IPolicyRegistry`, `B20Constants` (Task 0).
- Produces:
  - `struct GuardLib.MarketCheck { address token; address feed; address pool; address calendar; address registry; address vault; address adapter; bool isBuy; SessionMode sessionMode; uint32 maxStaleness; uint32 twapWindow; uint16 maxPremiumBps; uint32 multiplierCooldown; uint256 lastMultiplier; uint256 multiplierChangedAt; }`
  - `GuardLib.checkMarket(MarketCheck memory) → (Reason reason, uint256 oraclePrice8)`. Check order: TOKEN_PAUSED → POLICY_BLOCKED → MARKET_CLOSED → BAD_PRICE/FEED_STALE → MULTIPLIER_COOLDOWN → BAD_PRICE/PREMIUM_TOO_HIGH → OK
  - `GuardLib.multiplierBlocked(IB20Asset, uint256 last, uint256 changedAt, uint32 cooldown) → bool`
  - `GuardLib.authorized(address token, address registry, bytes32 scope, address account) → bool`
  - Mocks: `MockB20(string symbol)` with `mint`, `setPaused(uint8,bool)`, `setPolicyId(bytes32,uint64)`, `setUiMultiplier(uint256)`, `setEffectiveAt(uint256)`; `MockPolicyRegistry.setAuthorized(uint64 id, address account, bool ok)`

- [ ] **Step 1: Write the mocks and the failing test**

`contracts/test/mocks/MockB20.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockB20 {
    string public symbol;
    uint8 public constant decimals = 8;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(uint8 => bool) public isPaused;
    mapping(bytes32 => uint64) public policyId;
    uint256 public uiMultiplier = 1e18;
    uint256 public effectiveAt;

    error ContractPaused(uint8 feature);

    constructor(string memory symbol_) {
        symbol = symbol_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setPaused(uint8 feature, bool p) external {
        isPaused[feature] = p;
    }

    function setPolicyId(bytes32 scope, uint64 id) external {
        policyId[scope] = id;
    }

    function setUiMultiplier(uint256 m) external {
        uiMultiplier = m;
    }

    function setEffectiveAt(uint256 t) external {
        effectiveAt = t;
    }

    function balanceOfUI(address account) external view returns (uint256) {
        return balanceOf[account] * uiMultiplier / 1e18;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        if (isPaused[0]) revert ContractPaused(0);
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
```

`contracts/test/mocks/MockPolicyRegistry.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

contract MockPolicyRegistry {
    mapping(uint64 => mapping(address => bool)) internal _allowed;
    mapping(uint64 => bool) internal _exists;

    function setAuthorized(uint64 id, address account, bool ok) external {
        _allowed[id][account] = ok;
        _exists[id] = true;
    }

    function isAuthorized(uint64 id, address account) external view returns (bool) {
        return _allowed[id][account];
    }

    function policyExists(uint64 id) external view returns (bool) {
        return id == 0 || _exists[id];
    }
}
```

`contracts/test/GuardLib.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {GuardLib} from "../src/GuardLib.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {Reason, SessionMode} from "../src/Types.sol";
import {B20Constants} from "../src/interfaces/IB20Asset.sol";
import {MockB20} from "./mocks/MockB20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockPool} from "./mocks/MockPool.sol";
import {MockPolicyRegistry} from "./mocks/MockPolicyRegistry.sol";

contract GuardHarness {
    function check(GuardLib.MarketCheck memory c) external view returns (Reason, uint256) {
        return GuardLib.checkMarket(c);
    }
}

contract GuardLibTest is Test {
    uint256 internal constant THU_1030_ET = 1793892600;
    address internal constant VAULT = address(0xA11CE);
    address internal constant ADAPTER = address(0xADA);

    GuardHarness internal h;
    MockB20 internal nvda;
    MockFeed internal feed;
    MockPool internal pool;
    MockPolicyRegistry internal registry;
    MarketCalendar internal calendar;

    function setUp() public {
        vm.warp(THU_1030_ET);
        h = new GuardHarness();
        nvda = new MockB20("NVDAc");
        MockERC20 usdc = new MockERC20("USDC", 6);
        feed = new MockFeed(200e8);
        pool = new MockPool(address(usdc), address(nvda));
        pool.setTick(-6932, 1800);
        registry = new MockPolicyRegistry();
        calendar = new MarketCalendar(address(this));
    }

    function _c() internal view returns (GuardLib.MarketCheck memory c) {
        c = GuardLib.MarketCheck({
            token: address(nvda),
            feed: address(feed),
            pool: address(pool),
            calendar: address(calendar),
            registry: address(registry),
            vault: VAULT,
            adapter: ADAPTER,
            isBuy: true,
            sessionMode: SessionMode.REGULAR,
            maxStaleness: 3600,
            twapWindow: 1800,
            maxPremiumBps: 50,
            multiplierCooldown: 1 days,
            lastMultiplier: 1e18,
            multiplierChangedAt: 0
        });
    }

    function _expect(GuardLib.MarketCheck memory c, Reason want) internal view {
        (Reason got,) = h.check(c);
        assertEq(uint8(got), uint8(want));
    }

    function test_okReturnsOraclePrice() public view {
        (Reason r, uint256 p) = h.check(_c());
        assertEq(uint8(r), uint8(Reason.OK));
        assertEq(p, 200e8);
    }

    function test_paused() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        _expect(_c(), Reason.TOKEN_PAUSED);
    }

    function test_pauseIsCheckedBeforeMarketHours() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        vm.warp(1793469600); // Saturday
        _expect(_c(), Reason.TOKEN_PAUSED);
    }

    function test_policyBlocksVaultAsReceiver() public {
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 7);
        _expect(_c(), Reason.POLICY_BLOCKED);
        registry.setAuthorized(7, VAULT, true);
        _expect(_c(), Reason.OK);
    }

    function test_policyOnSellChecksAdapterAndPool() public {
        GuardLib.MarketCheck memory c = _c();
        c.isBuy = false;
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 9);
        registry.setAuthorized(9, ADAPTER, true);
        _expect(c, Reason.POLICY_BLOCKED); // pool not authorized as receiver
        registry.setAuthorized(9, address(pool), true);
        _expect(c, Reason.OK);
    }

    function test_marketClosed() public {
        vm.warp(1793469600);
        feed.set(200e8, block.timestamp);
        _expect(_c(), Reason.MARKET_CLOSED);
    }

    function test_feedStaleAndBad() public {
        feed.set(200e8, block.timestamp - 3601);
        _expect(_c(), Reason.FEED_STALE);
        feed.set(0, block.timestamp);
        _expect(_c(), Reason.BAD_PRICE);
    }

    function test_multiplierRules() public {
        GuardLib.MarketCheck memory c = _c();
        nvda.setUiMultiplier(1.01e18); // differs from lastMultiplier (legacy path, no effectiveAt)
        _expect(c, Reason.MULTIPLIER_COOLDOWN);

        c.lastMultiplier = 1.01e18;
        c.multiplierChangedAt = block.timestamp - 1 hours;
        _expect(c, Reason.MULTIPLIER_COOLDOWN);
        c.multiplierChangedAt = block.timestamp - 25 hours;
        _expect(c, Reason.OK);

        nvda.setEffectiveAt(block.timestamp + 1 hours); // pending update
        _expect(c, Reason.MULTIPLIER_COOLDOWN);
        nvda.setEffectiveAt(block.timestamp - 1 hours); // just flipped
        _expect(c, Reason.MULTIPLIER_COOLDOWN);
        nvda.setEffectiveAt(block.timestamp - 25 hours);
        _expect(c, Reason.OK);
    }

    function test_premiumTooHigh() public {
        pool.setTick(-7932, 1800); // ~ $221 vs $200 oracle
        _expect(_c(), Reason.PREMIUM_TOO_HIGH);
    }
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `forge test --match-path test/GuardLib.t.sol`
Expected: FAIL when compiling (`src/GuardLib.sol` not found).

- [ ] **Step 3: Implement**

`contracts/src/GuardLib.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Reason, SessionMode} from "./Types.sol";
import {MarketCalendar} from "./MarketCalendar.sol";
import {PriceLib} from "./lib/PriceLib.sol";
import {IB20Asset, IPolicyRegistry, B20Constants} from "./interfaces/IB20Asset.sol";

/// @notice Market-safety checks for one B20 trade. Pure function of onchain state plus the caller's
/// multiplier bookkeeping, so the vault and the off-chain Guard Service agree on every verdict.
library GuardLib {
    struct MarketCheck {
        address token;
        address feed;
        address pool;
        address calendar;
        address registry;
        address vault;
        address adapter;
        bool isBuy;
        SessionMode sessionMode;
        uint32 maxStaleness;
        uint32 twapWindow;
        uint16 maxPremiumBps;
        uint32 multiplierCooldown;
        uint256 lastMultiplier;
        uint256 multiplierChangedAt;
    }

    function checkMarket(MarketCheck memory c) internal view returns (Reason, uint256) {
        IB20Asset t = IB20Asset(c.token);
        if (t.isPaused(B20Constants.FEATURE_TRANSFER)) return (Reason.TOKEN_PAUSED, 0);
        if (!transferPathAuthorized(c)) return (Reason.POLICY_BLOCKED, 0);
        if (!MarketCalendar(c.calendar).isOpen(block.timestamp, c.sessionMode)) return (Reason.MARKET_CLOSED, 0);

        (bool ok, uint256 oracle, uint256 age) = PriceLib.readFeed(c.feed);
        if (!ok) return (Reason.BAD_PRICE, 0);
        if (age > c.maxStaleness) return (Reason.FEED_STALE, 0);

        if (multiplierBlocked(t, c.lastMultiplier, c.multiplierChangedAt, c.multiplierCooldown)) {
            return (Reason.MULTIPLIER_COOLDOWN, 0);
        }

        (bool tok, uint256 dex) = PriceLib.twapPrice(c.pool, c.token, c.twapWindow);
        if (!tok) return (Reason.BAD_PRICE, 0);
        if (PriceLib.premiumBps(dex, oracle) > c.maxPremiumBps) return (Reason.PREMIUM_TOO_HIGH, 0);
        return (Reason.OK, oracle);
    }

    function multiplierBlocked(IB20Asset t, uint256 last, uint256 changedAt, uint32 cooldown)
        internal
        view
        returns (bool)
    {
        if (last != 0 && t.uiMultiplier() != last) return true;
        if (changedAt != 0 && block.timestamp < changedAt + cooldown) return true;
        uint256 eff = t.effectiveAt();
        if (eff > block.timestamp) return true; // scheduled update pending
        return eff != 0 && block.timestamp < eff + cooldown;
    }

    /// BUY: pool -> vault (pool executes). SELL: vault -> adapter, adapter -> pool (adapter executes).
    function transferPathAuthorized(MarketCheck memory c) internal view returns (bool) {
        bytes32 s = B20Constants.TRANSFER_SENDER_POLICY;
        bytes32 r = B20Constants.TRANSFER_RECEIVER_POLICY;
        bytes32 e = B20Constants.TRANSFER_EXECUTOR_POLICY;
        if (c.isBuy) {
            return authorized(c.token, c.registry, s, c.pool) && authorized(c.token, c.registry, r, c.vault)
                && authorized(c.token, c.registry, e, c.pool) && authorized(c.token, c.registry, e, tx.origin);
        }
        return authorized(c.token, c.registry, s, c.vault) && authorized(c.token, c.registry, s, c.adapter)
            && authorized(c.token, c.registry, r, c.adapter) && authorized(c.token, c.registry, r, c.pool)
            && authorized(c.token, c.registry, e, c.adapter) && authorized(c.token, c.registry, e, tx.origin);
    }

    function authorized(address token, address registry, bytes32 scope, address account)
        internal
        view
        returns (bool)
    {
        uint64 id = IB20Asset(token).policyId(scope);
        if (id == 0) return true; // ALWAYS_ALLOW
        return IPolicyRegistry(registry).isAuthorized(id, account);
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `forge test --match-path test/GuardLib.t.sol -vv`
Expected: 9 test PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/GuardLib.sol contracts/test/mocks/MockB20.sol contracts/test/mocks/MockPolicyRegistry.sol contracts/test/GuardLib.t.sol
git commit -m "feat: add GuardLib market checks for pause, policy, hours, feed, multiplier, premium"
```

---

### Task 4: AerodromeSwapAdapter

**Files:**
- Create: `contracts/src/lib/TokenTransfer.sol`, `contracts/src/adapters/ISwapAdapter.sol`, `contracts/src/adapters/AerodromeSwapAdapter.sol`, `contracts/test/mocks/MockPartialPool.sol`
- Test: `contracts/test/AerodromeSwapAdapter.t.sol`, `contracts/test/fork/AerodromeSwapAdapterFork.t.sol`

**Interfaces:**
- Consumes: `ICLPool`, `ISwapCallback`, `IERC20Minimal` (Task 0); `TickMath` (v4-core); `MockERC20` (Task 2).
- Produces:
  - `ISwapAdapter.swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient) → uint256 amountOut`. The adapter **pulls** `amountIn` **itself** from `msg.sender` with `transferFrom`, so the caller must `approve` first. The output and any leftover input are both sent to `recipient`. Reverts if `amountOut < minOut`.
  - `AerodromeSwapAdapter` errors: `BadCallback()`, `TokenNotInPool()`, `InsufficientOutput(uint256 amountOut, uint256 minOut)`
  - `TokenTransfer.safeTransfer(token,to,amount)`, `safeTransferFrom(token,from,to,amount)`, `safeApprove(token,spender,amount)`, error `TransferFailed(address token)`

- [ ] **Step 1: Write the mock and the failing test**

`contracts/test/mocks/MockPartialPool.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapCallback, IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Fills only half of the exact-input amount, like a pool that hits its price limit.
contract MockPartialPool {
    address public immutable token0;
    address public immutable token1;
    uint256 public outAmount;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function setOut(uint256 o) external {
        outAmount = o;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 a0, int256 a1)
    {
        int256 used = amountSpecified / 2;
        address tokenIn = zeroForOne ? token0 : token1;
        address tokenOut = zeroForOne ? token1 : token0;
        IERC20Minimal(tokenOut).transfer(recipient, outAmount);
        if (zeroForOne) (a0, a1) = (used, -int256(outAmount));
        else (a0, a1) = (-int256(outAmount), used);
        uint256 before = IERC20Minimal(tokenIn).balanceOf(address(this));
        ISwapCallback(msg.sender).uniswapV3SwapCallback(a0, a1, data);
        require(IERC20Minimal(tokenIn).balanceOf(address(this)) >= before + uint256(used), "NOT_PAID");
    }
}
```

`contracts/test/AerodromeSwapAdapter.t.sol`:
```solidity
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
```

`contracts/test/fork/AerodromeSwapAdapterFork.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to confirm it fails**

Run: `forge test --match-path test/AerodromeSwapAdapter.t.sol`
Expected: FAIL when compiling (`src/adapters/AerodromeSwapAdapter.sol` not found).

- [ ] **Step 3: Implement**

`contracts/src/lib/TokenTransfer.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Minimal} from "../interfaces/IExternal.sol";

/// @notice ERC-20 calls that tolerate missing return values and bubble up the token's revert reason
/// (B20 reverts with typed errors such as PolicyForbids).
library TokenTransfer {
    error TransferFailed(address token);

    function safeTransfer(address token, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20Minimal.approve, (spender, amount)));
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        if (ret.length != 0 && !abi.decode(ret, (bool))) revert TransferFailed(token);
    }
}
```

`contracts/src/adapters/ISwapAdapter.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISwapAdapter {
    /// @notice Pulls `amountIn` of `tokenIn` from msg.sender, swaps it in `pool`, sends the output and any
    /// unused input to `recipient`. Reverts if the output is below `minOut`.
    function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut);
}
```

`contracts/src/adapters/AerodromeSwapAdapter.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TickMath} from "v4-core/libraries/TickMath.sol";
import {ISwapAdapter} from "./ISwapAdapter.sol";
import {ICLPool, ISwapCallback, IERC20Minimal} from "../interfaces/IExternal.sol";
import {TokenTransfer} from "../lib/TokenTransfer.sol";

/// @notice Exact-input swaps directly against an Aerodrome Slipstream pool (no router).
contract AerodromeSwapAdapter is ISwapAdapter, ISwapCallback {
    using TokenTransfer for address;

    address private transient _activePool;

    error BadCallback();
    error TokenNotInPool();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        address t0 = ICLPool(pool).token0();
        address t1 = ICLPool(pool).token1();
        if (tokenIn != t0 && tokenIn != t1) revert TokenNotInPool();
        bool zeroForOne = tokenIn == t0;

        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        _activePool = pool;
        (int256 a0, int256 a1) = ICLPool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1,
            abi.encode(tokenIn)
        );
        _activePool = address(0);

        amountOut = uint256(-(zeroForOne ? a1 : a0));
        if (amountOut < minOut) revert InsufficientOutput(amountOut, minOut);

        uint256 leftover = IERC20Minimal(tokenIn).balanceOf(address(this));
        if (leftover != 0) tokenIn.safeTransfer(recipient, leftover);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        if (msg.sender != _activePool || msg.sender == address(0)) revert BadCallback();
        address tokenIn = abi.decode(data, (address));
        uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        tokenIn.safeTransfer(msg.sender, owed);
    }
}
```

- [ ] **Step 4: Run the tests**

```bash
forge test --match-path test/AerodromeSwapAdapter.t.sol -vv
forge test --match-path test/fork/AerodromeSwapAdapterFork.t.sol -vvv
```
Expected: 4 unit test PASS, 1 fork test PASS.
If the fork test reverts right inside `swap`, re-run with `-vvvv` and read the trace to see what name the pool calls as the callback. If Slipstream calls a selector other than `uniswapV3SwapCallback`, rename the function in `ISwapCallback` and in the adapter to match, then re-run both tests.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/lib/TokenTransfer.sol contracts/src/adapters contracts/test/mocks/MockPartialPool.sol contracts/test/AerodromeSwapAdapter.t.sol contracts/test/fork/AerodromeSwapAdapterFork.t.sol
git commit -m "feat: add Aerodrome Slipstream swap adapter with callback guard and refunds"
```

---

### Task 5: MandateVault — the execute flow and the Decision log

**Files:**
- Create: `contracts/src/IMandateVaultEvents.sol`, `contracts/src/MandateVault.sol`, `contracts/test/mocks/MockSwapAdapter.sol`, `contracts/test/utils/VaultFixture.sol`
- Test: `contracts/test/MandateVault.t.sol`

**Interfaces:**
- Consumes: `GuardLib.MarketCheck/checkMarket` (Task 3); `PriceLib.readFeed` (Task 2); `ISwapAdapter`, `TokenTransfer` (Task 4); `MarketCalendar`, Types (Task 1); `IB20Asset`, `B20Constants` (Task 0); the mocks from Tasks 2 and 3.
- Produces:
  - `constructor(address owner, address executor, address usdc, address policyRegistry, Mandate mandate, address[] tokens, TokenConfig[] configs, address[] payees)` (USDC must have 6 decimals)
  - `execute(Intent calldata) → (bool allowed, Reason reason)` (only the executor can call it); `previewIntent(Intent calldata) → Reason`; `notifyRevenue() → uint256`; `syncMultiplier(address token)`
  - Owner: `setExecutor`, `setPaused`, `withdraw(address token, uint256 amount)`, `queueChange(bytes32)`, `cancelChange(bytes32)`, `applyMandate(Mandate)`, `applyTokenConfig(address, TokenConfig)`, `applyPayee(address, bool)`
  - Views: `owner()`, `usdc()`, `policyRegistry()`, `executor()`, `paused()`, `mandate() → Mandate`, `mandateHash()`, `tokens() → address[]`, `tokenConfig(address) → (bool,address,address,uint16)`, `allowedPayee(address)`, `usedIntent(bytes32)`, `spentOnDay(uint256)`, `lastMultiplier(address)`, `multiplierChangedAt(address)`, `queuedAt(bytes32)`, `recordedUsdc()`, `today()`, `mandateChangeHash(Mandate)`, `tokenChangeHash(address, TokenConfig)`, `payeeChangeHash(address, bool)`, `TIMELOCK()`
  - Errors: `NotOwner()`, `NotExecutor()`, `ZeroAddress()`, `LengthMismatch()`, `BadUsdcDecimals()`, `IntentAlreadyUsed(bytes32 id)`, `ChangeNotQueued(bytes32 changeHash)`, `ChangeNotReady(bytes32 changeHash, uint256 eta)`
  - Events (`IMandateVaultEvents`): `Decision(bytes32 indexed intentId, Action action, address indexed token, uint256 amount, bool allowed, Reason reason, bytes32 rationaleHash)`, `ExecutorSet`, `PausedSet`, `ChangeQueued(bytes32 indexed, uint256 eta)`, `ChangeCancelled`, `MandateApplied(bytes32 indexed mandateHash)`, `TokenConfigApplied(address indexed, TokenConfig)`, `PayeeApplied(address indexed, bool)`, `RevenueReceived(uint256)`, `Withdrawn(address indexed, uint256)`, `MultiplierChangeDetected(address indexed, uint256, uint256)`
  - `VaultFixture` (for Task 6): `owner`, `executor`, `payee`, `usdc`, `nvda`, `feed`, `pool`, `adapter`, `registry`, `calendar`, `vault`, `THU_1030_ET`, `defaultMandate()`, `_intent(Action, uint256)`, `_exec(Intent)`, `_assertReason(Reason, Reason)`

- [ ] **Step 1: Write the event interface, the mock adapter, the fixture and the failing test**

`contracts/src/IMandateVaultEvents.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Action, Reason, TokenConfig} from "./Types.sol";

interface IMandateVaultEvents {
    event Decision(
        bytes32 indexed intentId,
        Action action,
        address indexed token,
        uint256 amount,
        bool allowed,
        Reason reason,
        bytes32 rationaleHash
    );
    event ExecutorSet(address indexed executor);
    event PausedSet(bool paused);
    event ChangeQueued(bytes32 indexed changeHash, uint256 eta);
    event ChangeCancelled(bytes32 indexed changeHash);
    event MandateApplied(bytes32 indexed mandateHash);
    event TokenConfigApplied(address indexed token, TokenConfig config);
    event PayeeApplied(address indexed payee, bool allowed);
    event RevenueReceived(uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);
    event MultiplierChangeDetected(address indexed token, uint256 oldMultiplier, uint256 newMultiplier);
}
```

`contracts/test/mocks/MockSwapAdapter.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapAdapter} from "../../src/adapters/ISwapAdapter.sol";
import {ICLPool, IERC20Minimal} from "../../src/interfaces/IExternal.sol";

/// @notice Pays a preset output from its own balance. Must be pre-funded with output tokens.
contract MockSwapAdapter is ISwapAdapter {
    uint256 public nextOut;
    bool public shouldRevert;

    error MockRevert();
    error InsufficientOutput(uint256 amountOut, uint256 minOut);

    function setNextOut(uint256 o) external {
        nextOut = o;
    }

    function setRevert(bool r) external {
        shouldRevert = r;
    }

    function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256)
    {
        if (shouldRevert) revert MockRevert();
        IERC20Minimal(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        address t0 = ICLPool(pool).token0();
        address tokenOut = tokenIn == t0 ? ICLPool(pool).token1() : t0;
        if (nextOut < minOut) revert InsufficientOutput(nextOut, minOut);
        IERC20Minimal(tokenOut).transfer(recipient, nextOut);
        return nextOut;
    }
}
```

`contracts/test/utils/VaultFixture.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {IMandateVaultEvents} from "../../src/IMandateVaultEvents.sol";
import {Action, Reason, SessionMode, Intent, Mandate, TokenConfig} from "../../src/Types.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockB20} from "../mocks/MockB20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {MockPolicyRegistry} from "../mocks/MockPolicyRegistry.sol";
import {MockSwapAdapter} from "../mocks/MockSwapAdapter.sol";

abstract contract VaultFixture is Test, IMandateVaultEvents {
    uint256 internal constant THU_1030_ET = 1793892600; // Thu 2026-11-05 15:30 UTC
    uint256 internal constant SAT_1300_ET = 1793469600; // Sat 2026-10-31 18:00 UTC

    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal payee = makeAddr("payee");

    MockERC20 internal usdc;
    MockB20 internal nvda;
    MockFeed internal feed;
    MockPool internal pool;
    MockSwapAdapter internal adapter;
    MockPolicyRegistry internal registry;
    MarketCalendar internal calendar;
    MandateVault internal vault;
    uint256 internal nonce;

    function setUp() public virtual {
        vm.warp(THU_1030_ET);
        usdc = new MockERC20("USDC", 6);
        nvda = new MockB20("NVDAc");
        feed = new MockFeed(200e8);
        pool = new MockPool(address(usdc), address(nvda));
        pool.setTick(-6932, 1800); // ~ $200.0036
        adapter = new MockSwapAdapter();
        usdc.mint(address(adapter), 1_000_000e6);
        nvda.mint(address(adapter), 1_000e8);
        registry = new MockPolicyRegistry();
        calendar = new MarketCalendar(owner);

        address[] memory toks = new address[](1);
        toks[0] = address(nvda);
        TokenConfig[] memory cfgs = new TokenConfig[](1);
        cfgs[0] = TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: 4000});
        address[] memory payees = new address[](1);
        payees[0] = payee;

        vault = new MandateVault(owner, executor, address(usdc), address(registry), defaultMandate(), toks, cfgs, payees);
        usdc.mint(address(vault), 200e6);
        vault.notifyRevenue(); // baseline recordedUsdc = 200e6
    }

    function defaultMandate() internal view returns (Mandate memory) {
        return Mandate({
            sessionMode: SessionMode.REGULAR,
            maxPremiumBps: 50,
            maxSlippageBps: 100,
            maxStaleness: 3600,
            multiplierCooldown: 1 days,
            twapWindow: 1800,
            perTradeCapUsd: 50e6,
            dailyCapUsd: 100e6,
            calendar: address(calendar),
            swapAdapter: address(adapter)
        });
    }

    function _intent(Action a, uint256 amount) internal returns (Intent memory) {
        return Intent({
            id: keccak256(abi.encode(++nonce)),
            action: a,
            token: address(nvda),
            amount: amount,
            minOut: 0,
            payee: address(0),
            rationaleHash: keccak256("rationale")
        });
    }

    function _exec(Intent memory i) internal returns (bool allowed, Reason reason) {
        vm.prank(executor, executor);
        return vault.execute(i);
    }

    function _assertReason(Reason got, Reason want) internal pure {
        assertEq(uint8(got), uint8(want));
    }
}
```

`contracts/test/MandateVault.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {Action, Reason, Intent} from "../src/Types.sol";
import {B20Constants} from "../src/interfaces/IB20Asset.sol";

contract MandateVaultTest is VaultFixture {
    function test_buyInSessionIsAllowed() public {
        adapter.setNextOut(0.1e8); // $20 / $200
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Decision(i.id, Action.BUY, address(nvda), 20e6, true, Reason.OK, i.rationaleHash);
        (bool allowed, Reason r) = _exec(i);
        assertTrue(allowed);
        _assertReason(r, Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 0.1e8);
        assertEq(usdc.balanceOf(address(vault)), 180e6);
        assertEq(vault.spentOnDay(vault.today()), 20e6);
        assertEq(usdc.allowance(address(vault), address(adapter)), 0);
    }

    function test_refusalIsLoggedNotReverted() public {
        vm.warp(SAT_1300_ET);
        feed.set(200e8, block.timestamp);
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.expectEmit(true, true, false, true, address(vault));
        emit Decision(i.id, Action.BUY, address(nvda), 20e6, false, Reason.MARKET_CLOSED, i.rationaleHash);
        (bool allowed, Reason r) = _exec(i);
        assertFalse(allowed);
        _assertReason(r, Reason.MARKET_CLOSED);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
        assertTrue(vault.usedIntent(i.id));
    }

    function test_refusesStaleFeed() public {
        feed.set(200e8, block.timestamp - 7200);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.FEED_STALE);
    }

    function test_refusesPremium() public {
        pool.setTick(-7932, 1800);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.PREMIUM_TOO_HIGH);
    }

    function test_refusesPausedToken() public {
        nvda.setPaused(B20Constants.FEATURE_TRANSFER, true);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.TOKEN_PAUSED);
    }

    function test_refusesWhenPolicyBlocksVault() public {
        nvda.setPolicyId(B20Constants.TRANSFER_RECEIVER_POLICY, 7);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.POLICY_BLOCKED);
        registry.setAuthorized(7, address(vault), true);
        adapter.setNextOut(0.1e8);
        (, r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
    }

    function test_multiplierChangeStartsCooldown() public {
        nvda.setUiMultiplier(1.01e18); // legacy-style change: effectiveAt stays 0
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
        assertEq(vault.multiplierChangedAt(address(nvda)), block.timestamp);
        assertEq(vault.lastMultiplier(address(nvda)), 1.01e18);

        vm.warp(block.timestamp + 25 hours); // Fri 11:30 ET
        feed.set(200e8, block.timestamp);
        adapter.setNextOut(0.1e8);
        (, r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
    }

    function test_pendingMultiplierBlocks() public {
        nvda.setEffectiveAt(block.timestamp + 1 hours);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
    }

    function test_perTradeCap() public {
        (, Reason r) = _exec(_intent(Action.BUY, 60e6));
        _assertReason(r, Reason.SIZE_LIMIT);
    }

    function test_dailyCap() public {
        adapter.setNextOut(0.2e8); // $40 at $200
        (, Reason r) = _exec(_intent(Action.BUY, 40e6));
        _assertReason(r, Reason.OK);
        (, r) = _exec(_intent(Action.BUY, 40e6));
        _assertReason(r, Reason.OK);
        (, r) = _exec(_intent(Action.BUY, 40e6)); // 120 > 100
        _assertReason(r, Reason.SIZE_LIMIT);
    }

    function test_concentration() public {
        adapter.setNextOut(0.25e8); // $50 at $200
        (, Reason r) = _exec(_intent(Action.BUY, 50e6)); // 25% of $200
        _assertReason(r, Reason.OK);
        (, r) = _exec(_intent(Action.BUY, 50e6)); // would be 50% > 40%
        _assertReason(r, Reason.CONCENTRATION);
    }

    function test_slippageFloorIsEnforcedEvenIfAgentSendsZero() public {
        adapter.setNextOut(0.098e8); // floor is 0.099e8 (1% below oracle-implied 0.1e8)
        (bool allowed, Reason r) = _exec(_intent(Action.BUY, 20e6));
        assertFalse(allowed);
        _assertReason(r, Reason.SWAP_FAILED);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
        assertEq(usdc.allowance(address(vault), address(adapter)), 0);
    }

    function test_agentMinOutAboveFloorIsUsed() public {
        adapter.setNextOut(0.1e8);
        Intent memory i = _intent(Action.BUY, 20e6);
        i.minOut = 0.1e8 + 1;
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.SWAP_FAILED);
    }

    function test_swapRevertIsRecorded() public {
        adapter.setRevert(true);
        Intent memory i = _intent(Action.BUY, 20e6);
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.SWAP_FAILED);
        assertTrue(vault.usedIntent(i.id));
        assertEq(vault.spentOnDay(vault.today()), 0);
    }

    function test_sellAfterBuy() public {
        adapter.setNextOut(0.1e8);
        _exec(_intent(Action.BUY, 20e6));
        adapter.setNextOut(19.9e6); // floor = $20 * 0.99 = 19.8e6
        (, Reason r) = _exec(_intent(Action.SELL, 0.1e8));
        _assertReason(r, Reason.OK);
        assertEq(nvda.balanceOf(address(vault)), 0);
        assertEq(usdc.balanceOf(address(vault)), 199.9e6);
        assertEq(vault.spentOnDay(vault.today()), 40e6);
    }

    function test_payExpenseWorksWhenMarketClosed() public {
        vm.warp(SAT_1300_ET);
        Intent memory i = _intent(Action.PAY_EXPENSE, 5e6);
        i.payee = payee;
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.OK);
        assertEq(usdc.balanceOf(payee), 5e6);
        assertEq(vault.recordedUsdc(), 195e6);
    }

    function test_payExpenseRejectsUnknownPayee() public {
        Intent memory i = _intent(Action.PAY_EXPENSE, 5e6);
        i.payee = makeAddr("attacker");
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.PAYEE_NOT_ALLOWED);
        assertEq(usdc.balanceOf(address(vault)), 200e6);
    }

    function test_replayReverts() public {
        Intent memory i = _intent(Action.BUY, 60e6);
        _exec(i);
        vm.prank(executor, executor);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.IntentAlreadyUsed.selector, i.id));
        vault.execute(i);
    }

    function test_onlyExecutorCanExecute() public {
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.prank(owner);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.execute(i);
    }

    function test_unsupportedActionsAreRefused() public {
        (, Reason r) = _exec(_intent(Action.BORROW, 5e6));
        _assertReason(r, Reason.ACTION_NOT_SUPPORTED);
    }

    function test_vaultPaused() public {
        vm.prank(owner);
        vault.setPaused(true);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.VAULT_PAUSED);
    }

    function test_tokenNotAllowed() public {
        Intent memory i = _intent(Action.BUY, 20e6);
        i.token = address(usdc);
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.TOKEN_NOT_ALLOWED);
    }

    function test_insufficientBalance() public {
        (, Reason r) = _exec(_intent(Action.SELL, 1e8));
        _assertReason(r, Reason.INSUFFICIENT_BALANCE);
        (, r) = _exec(_intent(Action.BUY, 0));
        _assertReason(r, Reason.INSUFFICIENT_BALANCE);
    }

    function test_previewMatchesExecute() public {
        Intent memory i = _intent(Action.BUY, 20e6);
        _assertReason(vault.previewIntent(i), Reason.OK);
        nvda.setUiMultiplier(1.02e18);
        _assertReason(vault.previewIntent(i), Reason.MULTIPLIER_COOLDOWN);
        (, Reason r) = _exec(i);
        _assertReason(r, Reason.MULTIPLIER_COOLDOWN);
    }
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `forge test --match-path test/MandateVault.t.sol`
Expected: FAIL when compiling (`src/MandateVault.sol` not found).

- [ ] **Step 3: Implement**

`contracts/src/MandateVault.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Action, Reason, Intent, Mandate, TokenConfig} from "./Types.sol";
import {GuardLib} from "./GuardLib.sol";
import {IMandateVaultEvents} from "./IMandateVaultEvents.sol";
import {PriceLib} from "./lib/PriceLib.sol";
import {TokenTransfer} from "./lib/TokenTransfer.sol";
import {IB20Asset} from "./interfaces/IB20Asset.sol";
import {IERC20Minimal} from "./interfaces/IExternal.sol";
import {ISwapAdapter} from "./adapters/ISwapAdapter.sol";

/// @title MandateVault — "LLM proposes, contract decides."
/// @notice Holds an agent's USDC + tokenized-stock treasury. The executor submits intents; the vault applies
/// the mandate and market guards and records every verdict, including refusals, as a Decision event.
contract MandateVault is IMandateVaultEvents {
    using TokenTransfer for address;

    uint256 public constant TIMELOCK = 24 hours;
    uint256 internal constant BPS = 10_000;

    address public immutable owner;
    address public immutable usdc;
    address public immutable policyRegistry;
    address public executor;
    bool public paused;

    Mandate internal _mandate;
    mapping(address => TokenConfig) public tokenConfig;
    mapping(address => bool) internal _listed;
    address[] internal _tokens;
    mapping(address => bool) public allowedPayee;

    mapping(bytes32 => bool) public usedIntent;
    mapping(uint256 utcDay => uint256) public spentOnDay;
    mapping(address => uint256) public lastMultiplier;
    mapping(address => uint256) public multiplierChangedAt;
    mapping(bytes32 => uint256) public queuedAt;
    uint256 public recordedUsdc;

    error NotOwner();
    error NotExecutor();
    error ZeroAddress();
    error LengthMismatch();
    error BadUsdcDecimals();
    error IntentAlreadyUsed(bytes32 id);
    error ChangeNotQueued(bytes32 changeHash);
    error ChangeNotReady(bytes32 changeHash, uint256 eta);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address owner_,
        address executor_,
        address usdc_,
        address policyRegistry_,
        Mandate memory mandate_,
        address[] memory tokens_,
        TokenConfig[] memory configs_,
        address[] memory payees_
    ) {
        if (owner_ == address(0) || executor_ == address(0) || usdc_ == address(0) || policyRegistry_ == address(0)) {
            revert ZeroAddress();
        }
        if (tokens_.length != configs_.length) revert LengthMismatch();
        if (IERC20Minimal(usdc_).decimals() != 6) revert BadUsdcDecimals();
        owner = owner_;
        executor = executor_;
        usdc = usdc_;
        policyRegistry = policyRegistry_;
        _mandate = mandate_;
        emit MandateApplied(keccak256(abi.encode(mandate_)));
        for (uint256 i; i < tokens_.length; ++i) {
            _setToken(tokens_[i], configs_[i]);
        }
        for (uint256 i; i < payees_.length; ++i) {
            allowedPayee[payees_[i]] = true;
            emit PayeeApplied(payees_[i], true);
        }
    }

    // ------------------------------------------------------------------ executor

    function execute(Intent calldata intent) external returns (bool allowed, Reason reason) {
        if (msg.sender != executor) revert NotExecutor();
        if (usedIntent[intent.id]) revert IntentAlreadyUsed(intent.id);
        usedIntent[intent.id] = true;
        if (tokenConfig[intent.token].allowed) _syncMultiplier(intent.token);

        uint256 price;
        (reason, price) = _check(intent);
        if (reason == Reason.OK) reason = _perform(intent, price);
        allowed = reason == Reason.OK;
        emit Decision(intent.id, intent.action, intent.token, intent.amount, allowed, reason, intent.rationaleHash);
    }

    /// @notice Same verdict execute() would reach before trading. Cannot predict SWAP_FAILED.
    function previewIntent(Intent calldata intent) external view returns (Reason reason) {
        (reason,) = _check(intent);
    }

    // ------------------------------------------------------------------ anyone

    function notifyRevenue() public returns (uint256 amount) {
        uint256 bal = IERC20Minimal(usdc).balanceOf(address(this));
        if (bal > recordedUsdc) {
            amount = bal - recordedUsdc;
            emit RevenueReceived(amount);
        }
        recordedUsdc = bal;
    }

    function syncMultiplier(address token) external {
        if (tokenConfig[token].allowed) _syncMultiplier(token);
    }

    // ------------------------------------------------------------------ owner

    function setExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        executor = newExecutor;
        emit ExecutorSet(newExecutor);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function withdraw(address token, uint256 amount) external onlyOwner {
        if (token == usdc) notifyRevenue();
        token.safeTransfer(owner, amount);
        if (token == usdc) recordedUsdc = IERC20Minimal(usdc).balanceOf(address(this));
        emit Withdrawn(token, amount);
    }

    function queueChange(bytes32 changeHash) external onlyOwner {
        queuedAt[changeHash] = block.timestamp;
        emit ChangeQueued(changeHash, block.timestamp + TIMELOCK);
    }

    function cancelChange(bytes32 changeHash) external onlyOwner {
        delete queuedAt[changeHash];
        emit ChangeCancelled(changeHash);
    }

    function applyMandate(Mandate calldata m) external onlyOwner {
        _consume(mandateChangeHash(m));
        _mandate = m;
        emit MandateApplied(keccak256(abi.encode(m)));
    }

    function applyTokenConfig(address token, TokenConfig calldata c) external onlyOwner {
        _consume(tokenChangeHash(token, c));
        _setToken(token, c);
    }

    function applyPayee(address payee, bool allowed) external onlyOwner {
        _consume(payeeChangeHash(payee, allowed));
        allowedPayee[payee] = allowed;
        emit PayeeApplied(payee, allowed);
    }

    // ------------------------------------------------------------------ views

    function mandate() external view returns (Mandate memory) {
        return _mandate;
    }

    function mandateHash() external view returns (bytes32) {
        return keccak256(abi.encode(_mandate));
    }

    function tokens() external view returns (address[] memory) {
        return _tokens;
    }

    function today() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function mandateChangeHash(Mandate memory m) public pure returns (bytes32) {
        return keccak256(abi.encode("MANDATE", m));
    }

    function tokenChangeHash(address token, TokenConfig memory c) public pure returns (bytes32) {
        return keccak256(abi.encode("TOKEN", token, c));
    }

    function payeeChangeHash(address payee, bool allowed) public pure returns (bytes32) {
        return keccak256(abi.encode("PAYEE", payee, allowed));
    }

    // ------------------------------------------------------------------ internal: checks

    function _check(Intent calldata intent) internal view returns (Reason, uint256) {
        if (paused) return (Reason.VAULT_PAUSED, 0);
        if (intent.action == Action.PAY_EXPENSE) return (_checkExpense(intent), 0);
        if (intent.action != Action.BUY && intent.action != Action.SELL) return (Reason.ACTION_NOT_SUPPORTED, 0);

        TokenConfig memory cfg = tokenConfig[intent.token];
        if (!cfg.allowed) return (Reason.TOKEN_NOT_ALLOWED, 0);
        bool isBuy = intent.action == Action.BUY;
        uint256 available = isBuy
            ? IERC20Minimal(usdc).balanceOf(address(this))
            : IB20Asset(intent.token).balanceOf(address(this));
        if (intent.amount == 0 || intent.amount > available) return (Reason.INSUFFICIENT_BALANCE, 0);

        (Reason r, uint256 price) = GuardLib.checkMarket(_marketCheck(intent.token, cfg, isBuy));
        if (r != Reason.OK) return (r, 0);

        uint256 notional = isBuy ? intent.amount : _valueUsd(intent.token, intent.amount, price);
        if (!_withinCaps(notional)) return (Reason.SIZE_LIMIT, 0);
        if (isBuy && _weightAfterBuyBps(intent.token, intent.amount, price) > cfg.maxWeightBps) {
            return (Reason.CONCENTRATION, 0);
        }
        return (Reason.OK, price);
    }

    function _checkExpense(Intent calldata intent) internal view returns (Reason) {
        if (!allowedPayee[intent.payee]) return Reason.PAYEE_NOT_ALLOWED;
        if (intent.amount == 0 || intent.amount > IERC20Minimal(usdc).balanceOf(address(this))) {
            return Reason.INSUFFICIENT_BALANCE;
        }
        if (!_withinCaps(intent.amount)) return Reason.SIZE_LIMIT;
        return Reason.OK;
    }

    function _marketCheck(address token, TokenConfig memory cfg, bool isBuy)
        internal
        view
        returns (GuardLib.MarketCheck memory c)
    {
        Mandate memory m = _mandate;
        c.token = token;
        c.feed = cfg.feed;
        c.pool = cfg.pool;
        c.calendar = m.calendar;
        c.registry = policyRegistry;
        c.vault = address(this);
        c.adapter = m.swapAdapter;
        c.isBuy = isBuy;
        c.sessionMode = m.sessionMode;
        c.maxStaleness = m.maxStaleness;
        c.twapWindow = m.twapWindow;
        c.maxPremiumBps = m.maxPremiumBps;
        c.multiplierCooldown = m.multiplierCooldown;
        c.lastMultiplier = lastMultiplier[token];
        c.multiplierChangedAt = multiplierChangedAt[token];
    }

    function _withinCaps(uint256 usd) internal view returns (bool) {
        return usd <= _mandate.perTradeCapUsd && spentOnDay[today()] + usd <= _mandate.dailyCapUsd;
    }

    /// @dev raw stock amount x 8-decimal price -> USDC (6 decimals)
    function _valueUsd(address token, uint256 raw, uint256 price8) internal view returns (uint256) {
        return raw * price8 / 10 ** (uint256(IB20Asset(token).decimals()) + 2);
    }

    function _weightAfterBuyBps(address token, uint256 usdIn, uint256 price8) internal view returns (uint256) {
        uint256 total = IERC20Minimal(usdc).balanceOf(address(this));
        uint256 tokenValue;
        for (uint256 i; i < _tokens.length; ++i) {
            address t = _tokens[i];
            uint256 bal = IB20Asset(t).balanceOf(address(this));
            if (bal == 0) continue;
            uint256 p = t == token ? price8 : _latestPrice(t);
            uint256 v = _valueUsd(t, bal, p);
            total += v;
            if (t == token) tokenValue = v;
        }
        if (total == 0) return BPS;
        return (tokenValue + usdIn) * BPS / total;
    }

    function _latestPrice(address token) internal view returns (uint256 price) {
        (, price,) = PriceLib.readFeed(tokenConfig[token].feed);
    }

    // ------------------------------------------------------------------ internal: effects

    function _perform(Intent calldata intent, uint256 price) internal returns (Reason) {
        notifyRevenue();
        uint256 notional = intent.amount;
        if (intent.action == Action.PAY_EXPENSE) {
            usdc.safeTransfer(intent.payee, intent.amount);
        } else {
            bool isBuy = intent.action == Action.BUY;
            address tokenIn = isBuy ? usdc : intent.token;
            uint256 expectedOut = isBuy
                ? intent.amount * 10 ** (uint256(IB20Asset(intent.token).decimals()) + 2) / price
                : _valueUsd(intent.token, intent.amount, price);
            if (!isBuy) notional = expectedOut;
            uint256 floorOut = expectedOut * (BPS - _mandate.maxSlippageBps) / BPS;
            uint256 minOut = intent.minOut > floorOut ? intent.minOut : floorOut;

            address adapter = _mandate.swapAdapter;
            tokenIn.safeApprove(adapter, intent.amount);
            try ISwapAdapter(adapter).swapExactIn(
                tokenConfig[intent.token].pool, tokenIn, intent.amount, minOut, address(this)
            ) returns (uint256) {
                tokenIn.safeApprove(adapter, 0);
            } catch {
                tokenIn.safeApprove(adapter, 0);
                return Reason.SWAP_FAILED;
            }
        }
        spentOnDay[today()] += notional;
        recordedUsdc = IERC20Minimal(usdc).balanceOf(address(this));
        return Reason.OK;
    }

    function _syncMultiplier(address token) internal {
        uint256 cur = IB20Asset(token).uiMultiplier();
        uint256 last = lastMultiplier[token];
        if (cur == last) return;
        multiplierChangedAt[token] = block.timestamp;
        lastMultiplier[token] = cur;
        emit MultiplierChangeDetected(token, last, cur);
    }

    function _setToken(address token, TokenConfig memory c) internal {
        if (token == address(0)) revert ZeroAddress();
        if (!_listed[token]) {
            _listed[token] = true;
            _tokens.push(token);
        }
        tokenConfig[token] = c;
        if (c.allowed) lastMultiplier[token] = IB20Asset(token).uiMultiplier();
        emit TokenConfigApplied(token, c);
    }

    function _consume(bytes32 changeHash) internal {
        uint256 t = queuedAt[changeHash];
        if (t == 0) revert ChangeNotQueued(changeHash);
        if (block.timestamp < t + TIMELOCK) revert ChangeNotReady(changeHash, t + TIMELOCK);
        delete queuedAt[changeHash];
    }
}
```

- [ ] **Step 4: Run the tests**

Run: `forge test --match-path test/MandateVault.t.sol -vv`
Expected: 24 test PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/IMandateVaultEvents.sol contracts/src/MandateVault.sol contracts/test/mocks/MockSwapAdapter.sol contracts/test/utils/VaultFixture.sol contracts/test/MandateVault.t.sol
git commit -m "feat: add MandateVault intent execution with onchain Decision log"
```

---

### Task 6: MandateVault — timelock, owner permissions, revenue

**Files:**
- Test: `contracts/test/MandateVaultAdmin.t.sol`
- Modify: `contracts/src/MandateVault.sol`, only if a test fails (Task 5 already implemented the admin functions; this task pins the behavior with tests and fixes bugs if there are any)

**Interfaces:**
- Consumes: `VaultFixture` and the entire owner API of `MandateVault` (Task 5).
- Produces: no new API.

- [ ] **Step 1: Write the tests**

`contracts/test/MandateVaultAdmin.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {VaultFixture} from "./utils/VaultFixture.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {Action, Reason, Intent, Mandate, TokenConfig} from "../src/Types.sol";

contract MandateVaultAdminTest is VaultFixture {
    function test_mandateChangeNeedsTimelock() public {
        Mandate memory m = defaultMandate();
        m.maxPremiumBps = 100;
        bytes32 h = vault.mandateChangeHash(m);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, h));
        vault.applyMandate(m);

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(vault));
        emit ChangeQueued(h, block.timestamp + 24 hours);
        vault.queueChange(h);

        vm.warp(block.timestamp + 23 hours);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotReady.selector, h, THU_1030_ET + 24 hours));
        vault.applyMandate(m);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(owner);
        vault.applyMandate(m);
        assertEq(vault.mandate().maxPremiumBps, 100);
        assertEq(vault.mandateHash(), keccak256(abi.encode(m)));
        assertEq(vault.queuedAt(h), 0);
    }

    function test_appliedParamsMustMatchQueued() public {
        Mandate memory queued = defaultMandate();
        queued.maxPremiumBps = 100;
        vm.prank(owner);
        vault.queueChange(vault.mandateChangeHash(queued));
        vm.warp(block.timestamp + 25 hours);

        Mandate memory other = defaultMandate();
        other.maxPremiumBps = 500;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, vault.mandateChangeHash(other)));
        vault.applyMandate(other);
    }

    function test_cancelledChangeCannotBeApplied() public {
        Mandate memory m = defaultMandate();
        m.dailyCapUsd = 1_000e6;
        bytes32 h = vault.mandateChangeHash(m);
        vm.startPrank(owner);
        vault.queueChange(h);
        vault.cancelChange(h);
        vm.warp(block.timestamp + 25 hours);
        vm.expectRevert(abi.encodeWithSelector(MandateVault.ChangeNotQueued.selector, h));
        vault.applyMandate(m);
        vm.stopPrank();
    }

    function test_payeeAndTokenChangesAreTimelocked() public {
        address newPayee = makeAddr("newPayee");
        TokenConfig memory c = TokenConfig({allowed: true, feed: address(feed), pool: address(pool), maxWeightBps: 2000});
        vm.startPrank(owner);
        vault.queueChange(vault.payeeChangeHash(newPayee, true));
        vault.queueChange(vault.tokenChangeHash(address(nvda), c));
        vm.warp(block.timestamp + 24 hours);
        vault.applyPayee(newPayee, true);
        vault.applyTokenConfig(address(nvda), c);
        vm.stopPrank();
        assertTrue(vault.allowedPayee(newPayee));
        (,,, uint16 w) = vault.tokenConfig(address(nvda));
        assertEq(w, 2000);
        assertEq(vault.tokens().length, 1);
    }

    function test_executorCannotUseOwnerFunctions() public {
        vm.startPrank(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.withdraw(address(usdc), 1e6);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.queueChange(bytes32(uint256(1)));
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.setExecutor(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.setPaused(false);
        vm.stopPrank();
    }

    function test_withdrawOnlyGoesToOwner() public {
        vm.prank(owner);
        vault.withdraw(address(usdc), 50e6);
        assertEq(usdc.balanceOf(owner), 50e6);
        assertEq(vault.recordedUsdc(), 150e6);
    }

    function test_notifyRevenue() public {
        usdc.mint(address(vault), 10e6);
        vm.expectEmit(false, false, false, true, address(vault));
        emit RevenueReceived(10e6);
        assertEq(vault.notifyRevenue(), 10e6);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_revenueBeforeTradeIsCounted() public {
        usdc.mint(address(vault), 10e6); // x402 payment lands, nobody calls notifyRevenue
        adapter.setNextOut(0.1e8);
        vm.expectEmit(false, false, false, true, address(vault));
        emit RevenueReceived(10e6);
        (, Reason r) = _exec(_intent(Action.BUY, 20e6));
        _assertReason(r, Reason.OK);
        assertEq(vault.recordedUsdc(), 190e6);
        assertEq(vault.notifyRevenue(), 0);
    }

    function test_rotatingExecutorRevokesOldOne() public {
        address newExec = makeAddr("newExec");
        vm.prank(owner);
        vault.setExecutor(newExec);
        Intent memory i = _intent(Action.BUY, 20e6);
        vm.prank(executor, executor);
        vm.expectRevert(MandateVault.NotExecutor.selector);
        vault.execute(i);
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `forge test --match-path test/MandateVaultAdmin.t.sol -vv`
Expected: 9 tests PASS. If any test fails, fix `MandateVault.sol` so it behaves as the test describes (do not change the test), then re-run all of `test/MandateVault.t.sol`.

- [ ] **Step 3: Run all unit tests**

Run: `forge test --no-match-path "test/fork/*" -vv`
Expected: all PASS (8 + 7 + 9 + 4 + 24 + 9 = 61 tests).

- [ ] **Step 4: Commit**

```bash
git add contracts/test/MandateVaultAdmin.t.sol contracts/src/MandateVault.sol
git commit -m "test: lock MandateVault timelock, owner-only and revenue accounting"
```

---

### Task 7: Fork integration test for the whole vault

**Files:**
- Create: `contracts/script/MaatConfig.sol`
- Test: `contracts/test/fork/MandateVaultFork.t.sol`

**Interfaces:**
- Consumes: `MandateVault` (Task 5), `AerodromeSwapAdapter` (Task 4), `MarketCalendar` (Task 1), `BaseAddresses` (Task 0).
- Produces: `MaatConfig.defaultMandate(SessionMode mode, address calendar, address adapter) → Mandate`; `MaatConfig.basket() → (address[] tokens, TokenConfig[] configs)`.

- [ ] **Step 1: Write the config and the test**

`contracts/script/MaatConfig.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SessionMode, Mandate, TokenConfig} from "../src/Types.sol";
import {BaseAddresses as A} from "./BaseAddresses.sol";

/// @notice Agent #1 mandate (spec §3.2) and basket (spec §3.5).
library MaatConfig {
    function defaultMandate(SessionMode mode, address calendar, address adapter)
        internal
        pure
        returns (Mandate memory)
    {
        return Mandate({
            sessionMode: mode,
            maxPremiumBps: 50,
            maxSlippageBps: 100,
            maxStaleness: 3600,
            multiplierCooldown: 1 days,
            twapWindow: 1800,
            perTradeCapUsd: 50e6,
            dailyCapUsd: 100e6,
            calendar: calendar,
            swapAdapter: adapter
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
```

`contracts/test/fork/MandateVaultFork.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {Action, Reason, SessionMode, Intent, TokenConfig} from "../../src/Types.sol";
import {IB20Asset} from "../../src/interfaces/IB20Asset.sol";
import {IERC20Minimal} from "../../src/interfaces/IExternal.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";
import {MaatConfig} from "../../script/MaatConfig.sol";

contract MandateVaultForkTest is Test {
    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal payee = makeAddr("payee");
    MandateVault internal vault;
    uint256 internal nonce;

    function _deploy(uint256 blockNumber, SessionMode mode) internal {
        vm.createSelectFork("base", blockNumber);
        MarketCalendar calendar = new MarketCalendar(owner);
        AerodromeSwapAdapter adapter = new AerodromeSwapAdapter();
        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        address[] memory payees = new address[](1);
        payees[0] = payee;
        vault = new MandateVault(
            owner,
            executor,
            A.USDC,
            A.POLICY_REGISTRY,
            MaatConfig.defaultMandate(mode, address(calendar), address(adapter)),
            toks,
            cfgs,
            payees
        );
        deal(A.USDC, address(vault), 200e6);
        vault.notifyRevenue();
    }

    function _exec(Action a, address token, uint256 amount, address to) internal returns (Reason r) {
        Intent memory i = Intent({
            id: keccak256(abi.encode(++nonce)),
            action: a,
            token: token,
            amount: amount,
            minOut: 0,
            payee: to,
            rationaleHash: keccak256("fork")
        });
        vm.prank(executor, executor);
        (, r) = vault.execute(i);
    }

    function test_buyAndSellNvdacInSession() public {
        _deploy(A.BLOCK_SESSION, SessionMode.REGULAR);
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 20e6, address(0))), uint8(Reason.OK));
        uint256 bal = IB20Asset(A.NVDAC).balanceOf(address(vault));
        assertApproxEqRel(bal, 10_714_000, 0.02e18); // $20 / $186.67

        assertEq(uint8(_exec(Action.SELL, A.NVDAC, bal, address(0))), uint8(Reason.OK));
        assertEq(IB20Asset(A.NVDAC).balanceOf(address(vault)), 0);
        assertApproxEqRel(IERC20Minimal(A.USDC).balanceOf(address(vault)), 200e6, 0.01e18);
    }

    function test_basketBuysInSession() public {
        _deploy(A.BLOCK_SESSION, SessionMode.REGULAR);
        assertEq(uint8(_exec(Action.BUY, A.GOOGLC, 20e6, address(0))), uint8(Reason.OK));
        assertEq(uint8(_exec(Action.BUY, A.AAPLC, 20e6, address(0))), uint8(Reason.OK));
        assertGt(IB20Asset(A.GOOGLC).balanceOf(address(vault)), 0);
        assertGt(IB20Asset(A.AAPLC).balanceOf(address(vault)), 0);
    }

    function test_weekendBuyIsRefusedInBothModes() public {
        _deploy(A.BLOCK_WEEKEND, SessionMode.REGULAR);
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 20e6, address(0))), uint8(Reason.MARKET_CLOSED));
        _deploy(A.BLOCK_WEEKEND, SessionMode.FEED_24_5);
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 20e6, address(0))), uint8(Reason.MARKET_CLOSED));
        assertEq(IERC20Minimal(A.USDC).balanceOf(address(vault)), 200e6);
    }

    function test_compromisedExecutorIsBounded() public {
        _deploy(A.BLOCK_SESSION, SessionMode.REGULAR);
        address attacker = makeAddr("attacker");
        assertEq(uint8(_exec(Action.PAY_EXPENSE, A.USDC, 100e6, attacker)), uint8(Reason.PAYEE_NOT_ALLOWED));
        assertEq(uint8(_exec(Action.BUY, A.NVDAC, 60e6, address(0))), uint8(Reason.SIZE_LIMIT));
        vm.prank(executor);
        vm.expectRevert(MandateVault.NotOwner.selector);
        vault.withdraw(A.USDC, 1);
        assertEq(IERC20Minimal(A.USDC).balanceOf(attacker), 0);
        assertEq(IERC20Minimal(A.USDC).balanceOf(address(vault)), 200e6);
    }
}
```

- [ ] **Step 2: Run the fork test**

Run: `forge test --match-path test/fork/MandateVaultFork.t.sol -vvv`
Expected: 4 test PASS.
If `test_basketBuysInSession` returns `PREMIUM_TOO_HIGH` for GOOGLc or AAPLc, that is real data, not a code bug. Record the measured premium (from Task 2) in `research/04-onchain-findings.md` and report back so that `maxPremiumBps` can be chosen; do not silently loosen the default parameters.

- [ ] **Step 3: Commit**

```bash
git add contracts/script/MaatConfig.sol contracts/test/fork/MandateVaultFork.t.sol
git commit -m "test: fork-test MandateVault against live Base pools, feeds and B20 tokens"
```

---

### Task 8: Deploy script, dry-run, and mainnet deploy (you sign)

**Files:**
- Create: `contracts/script/Deploy.s.sol`, `deployments/README.md`
- Test: `contracts/test/fork/DeployFork.t.sol`

**Interfaces:**
- Consumes: `MaatConfig` (Task 7), `BaseAddresses` (Task 0), the contracts from Tasks 1, 4, 5.
- Produces: `Deploy.run() → (MarketCalendar calendar, AerodromeSwapAdapter adapter, MandateVault vault)`; reads env `MAAT_OWNER`, `MAAT_EXECUTOR`, `MAAT_EXPENSE_PAYEE`.

- [ ] **Step 1: Write the failing test**

`contracts/test/fork/DeployFork.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {MandateVault} from "../../src/MandateVault.sol";
import {MarketCalendar} from "../../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../../src/adapters/AerodromeSwapAdapter.sol";
import {SessionMode} from "../../src/Types.sol";
import {BaseAddresses as A} from "../../script/BaseAddresses.sol";

contract DeployForkTest is Test {
    function test_deployWiresEverything() public {
        vm.createSelectFork("base", A.BLOCK_SESSION);
        address owner = makeAddr("owner");
        address executor = makeAddr("executor");
        address payee = makeAddr("payee");
        vm.setEnv("MAAT_OWNER", vm.toString(owner));
        vm.setEnv("MAAT_EXECUTOR", vm.toString(executor));
        vm.setEnv("MAAT_EXPENSE_PAYEE", vm.toString(payee));

        (MarketCalendar calendar, AerodromeSwapAdapter adapter, MandateVault vault) = new Deploy().run();

        assertEq(vault.owner(), owner);
        assertEq(vault.executor(), executor);
        assertEq(vault.usdc(), A.USDC);
        assertEq(vault.policyRegistry(), A.POLICY_REGISTRY);
        assertTrue(vault.allowedPayee(payee));
        assertEq(vault.tokens().length, 3);
        assertEq(vault.mandate().calendar, address(calendar));
        assertEq(vault.mandate().swapAdapter, address(adapter));
        assertEq(uint8(vault.mandate().sessionMode), uint8(SessionMode.REGULAR));
        assertEq(calendar.owner(), owner);
    }
}
```

- [ ] **Step 2: Run to confirm it fails**

Run: `forge test --match-path test/fork/DeployFork.t.sol`
Expected: FAIL when compiling (`script/Deploy.s.sol` not found).

- [ ] **Step 3: Implement**

`contracts/script/Deploy.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {MandateVault} from "../src/MandateVault.sol";
import {MarketCalendar} from "../src/MarketCalendar.sol";
import {AerodromeSwapAdapter} from "../src/adapters/AerodromeSwapAdapter.sol";
import {SessionMode, TokenConfig} from "../src/Types.sol";
import {BaseAddresses as A} from "./BaseAddresses.sol";
import {MaatConfig} from "./MaatConfig.sol";

contract Deploy is Script {
    function run() external returns (MarketCalendar calendar, AerodromeSwapAdapter adapter, MandateVault vault) {
        address owner = vm.envAddress("MAAT_OWNER");
        address executor = vm.envAddress("MAAT_EXECUTOR");
        address payee = vm.envAddress("MAAT_EXPENSE_PAYEE");

        (address[] memory toks, TokenConfig[] memory cfgs) = MaatConfig.basket();
        address[] memory payees = new address[](1);
        payees[0] = payee;

        vm.startBroadcast();
        calendar = new MarketCalendar(owner);
        adapter = new AerodromeSwapAdapter();
        vault = new MandateVault(
            owner,
            executor,
            A.USDC,
            A.POLICY_REGISTRY,
            MaatConfig.defaultMandate(SessionMode.REGULAR, address(calendar), address(adapter)),
            toks,
            cfgs,
            payees
        );
        vm.stopBroadcast();

        console2.log("MarketCalendar      ", address(calendar));
        console2.log("AerodromeSwapAdapter", address(adapter));
        console2.log("MandateVault        ", address(vault));
    }
}
```

`deployments/README.md`:
```markdown
# Deployments

| Network | Contract | Address | Tx | Date |
|---|---|---|---|---|
| Base mainnet | MarketCalendar | | | |
| Base mainnet | AerodromeSwapAdapter | | | |
| Base mainnet | MandateVault | | | |

Owner = your wallet. The executor is temporarily your wallet until Plan 2 (CDP Server Wallet). Payee = the compute-expense wallet.
```

- [ ] **Step 4: Run the tests and the dry-run**

```bash
forge test --match-path test/fork/DeployFork.t.sol -vv
MAAT_OWNER=0x0000000000000000000000000000000000000001 MAAT_EXECUTOR=0x0000000000000000000000000000000000000002 MAAT_EXPENSE_PAYEE=0x0000000000000000000000000000000000000003 forge script script/Deploy.s.sol --fork-url "$BASE_RPC_URL"
```
Expected: tests PASS. The dry-run prints 3 addresses and `Script ran successfully`, but **does not broadcast**.

- [ ] **Step 5: Re-run all tests**

Run: `forge test -vv`
Expected: all unit and fork tests PASS.

- [ ] **Step 6: Commit**

```bash
git add contracts/script/Deploy.s.sol contracts/test/fork/DeployFork.t.sol deployments/README.md
git commit -m "feat: add Base mainnet deploy script for Maat core"
```

- [ ] **Step 7 (YOU do this yourself, signing with your wallet): deploy to mainnet and run the smoke test**

The agent does not perform this step. The agent only guides you and checks the result after you have finished running it.

```bash
cast wallet import maat-owner --interactive
```
Edit `contracts/.env`: `MAAT_OWNER`, `MAAT_EXECUTOR` (temporarily your own wallet) and `MAAT_EXPENSE_PAYEE` are all set to your wallet address. Add `ETHERSCAN_API_KEY` (an Etherscan v2 key works for Basescan).
```bash
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --broadcast --verify
```
Fund the vault with **$20 USDC**, then send a BUY $5 NVDAc intent. Do this only during US session hours, 9:30–16:00 ET (14:30–21:00 UTC while the US is on standard time):
```bash
VAULT=0x...   # address of the MandateVault you just deployed
cast send "$VAULT" "notifyRevenue()" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast call "$VAULT" "previewIntent((bytes32,uint8,address,uint256,uint256,address,bytes32))(uint8)" "($(cast keccak maat-smoke-1),0,0xb20000000000000000000078ee7ce2fE4908108C,5000000,0,0x0000000000000000000000000000000000000000,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL"
cast send "$VAULT" "execute((bytes32,uint8,address,uint256,uint256,address,bytes32))" "($(cast keccak maat-smoke-1),0,0xb20000000000000000000078ee7ce2fE4908108C,5000000,0,0x0000000000000000000000000000000000000000,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
```
Expected: `previewIntent` returns `0` (OK). The `execute` transaction has a `Decision` log with `allowed=true`. Then send one more new intent (id `maat-smoke-2`) over the weekend: the log must have `reason=6` (MARKET_CLOSED). This is the first mainnet proof for the video and the build-in-public post. Fill in the address and tx hash in `deployments/README.md`.

---

## Self-review (done while writing the plan)

- **Spec cross-check:**
  - §3.1 GuardLib, checks 1–9: checks 1, 8, 9 and the payee check are in the vault; 2–7 are in GuardLib.
  - §3.1 `MarketCalendar`: Task 1.
  - §3.2 vault (roles, Intent, mandate, timelock, `minOut` floor, revenue, events): Task 5–6.
  - §3.3 SwapAdapter: Task 4. `CreditAdapter` (SUPPLY / BORROW / REPAY / WITHDRAW_COLLATERAL, `fridayDeriskWindow`, HF) is deliberately **moved to Plan 2**; in Plan 1 these actions return `ACTION_NOT_SUPPORTED`. The mandate does not yet have `targetHF`/`minHF`/`fridayDeriskWindow`; Plan 2 will add them (struct change, deploy vault v1).
  - §3.4–3.7 (Guard Service, agent, dashboard, factory): Plan 2–4.
  - §6 testing (unit, fork, replay scenarios 1, 2, 3, 4, 5): unit tests cover all 5 scenarios; fork tests include the weekend, token pause via a mock, and a compromised executor.
  - §7 week 1: GuardLib + Calendar + Vault + SwapAdapter + deploy v0.
- **Placeholder:** there is no TBD/TODO. The fallback branches (Slipstream callback name, a really high premium) all have a concrete action.
- **Type consistency:**
  - `MarketCheck.registry` was added so that tests do not depend on the precompile; the vault passes `policyRegistry`.
  - The vault constructor has 8 parameters, matching in Tasks 5, 7, 8.
  - `Reason` follows the enum order: `MARKET_CLOSED = 6`, matching the note in Task 8.
