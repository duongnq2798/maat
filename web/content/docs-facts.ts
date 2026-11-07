import type { Fact } from "./facts";

const fact = <T>(value: T, source: string): Fact<T> => ({ value, source });
const SPEC = "docs/superpowers/specs/2026-11-06-mandate-treasury-design.md";

/**
 * Numbers only the docs center cites (docs spec §2.4). They live apart from FACTS so the landing page's
 * bundle does not carry them. test/docs-facts.test.ts checks each one against the file it names.
 */
export const DOCS_FACTS = {
  gracePeriodDays: fact(7, "contracts/src/MandateVault.sol GRACE_PERIOD = 7 days, the window to apply a queued change"),
  maxDeriskWindowHours: fact(
    12,
    "contracts/src/MandateVault.sol MAX_DERISK_WINDOW = 12 hours, the longest deriskWindow a mandate may set",
  ),
  earlyCloseMin: fact(780, "contracts/src/MarketCalendar.sol constructor: _setEarlyClose(..., 780), a 13:00 ET close"),
  calendarPreload: fact(
    { holidays: 3, earlyCloses: 2 },
    "contracts/src/MarketCalendar.sol constructor: _addHoliday and _setEarlyClose calls",
  ),
  etOffsetHours: fact(
    { dst: 4, standard: 5 },
    "contracts/src/MarketCalendar.sol etOffsetSeconds: 4 hours to subtract from UTC during US daylight saving time, 5 hours otherwise",
  ),
  priceDecimals: fact(8, "contracts/src/lib/PriceLib.sol PRICE_DECIMALS = 8, the decimals of every price the vault reads"),
  usdcDecimals: fact(
    6,
    "contracts/src/lib/PriceLib.sol USDC_DECIMALS = 6; the MandateVault constructor reverts BadUsdcDecimals for any other value",
  ),
  maxTokenDecimals: fact(
    18,
    "contracts/src/MandateVault.sol _requireValidTokenConfig: a stock token whose decimals() is above 18 is InvalidConfig",
  ),
  healthFactorBound: fact(
    1,
    "contracts/src/MandateVault.sol _requireValidCredit: a minHealthFactor below WAD (1e18, a health factor of 1.0) is InvalidConfig",
  ),
  maxTxPerDay: fact(40, "agent/src/config.ts MAAT_MAX_TX_PER_DAY default"),
  dailyComputeUsd: fact(0.5, "agent/src/config.ts MAAT_DEFAULT_DAILY_COMPUTE_USD default"),
  maxIntents: fact(6, "agent/src/llm/schema.ts MAX_INTENTS, intents per Claude proposal"),
  maxRationaleChars: fact(600, "agent/src/llm/schema.ts MAX_RATIONALE_CHARS, characters per intent rationale"),
  maxGas: fact(3_000_000, "agent/src/exec/calls.ts MAX_GAS, the gas limit cap on every transaction the agent sends"),
  executeGasFloor: fact(2_500_000, "agent/src/exec/calls.ts EXECUTE_GAS_FLOOR, the minimum gas limit for execute"),
  cashReservePct: fact(30, "agent/src/policy.ts DEFAULT_POLICY.cashReserveBps = 3000"),
  runwayDays: fact(7, "agent/src/policy.ts DEFAULT_POLICY.runwayDays, days of compute cost kept as cash"),
  minTradeUsd: fact(
    1,
    "agent/src/policy.ts DEFAULT_POLICY.minTradeUsd6 = 1_000_000n, the smallest suggestion the policy keeps",
  ),
  offSessionMinutes: fact(60, "agent/src/loop/scheduler.ts OFF_SESSION_MS, agent loop cadence outside the session"),
  billMinUsd: fact(0.1, "agent/src/loop/runOnce.ts BILL_MIN_USD6 = 100_000n, the smallest compute bill the agent pays"),
  treasuryUsd: fact({ min: 20, max: 200 }, `${SPEC} §1 Constraints: small mainnet amounts, $20 to $200`),
  addressesVerifiedOn: fact(
    "2026-11-06",
    "contracts/script/BaseAddresses.sol library NatSpec: Base mainnet addresses verified on 2026-11-06",
  ),
  amzncPoolLiquidityUsd: fact(
    34_000,
    `README.md Base integrations: AMZNc's pool held only about $34k of liquidity when the basket was chosen; ${SPEC} §3.5: on 2026-11-06`,
  ),
} as const;
