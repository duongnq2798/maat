import { REASONS } from "./reasons";

/** A number shown on the site and where it comes from. test/facts.test.ts checks every one the repo can prove. */
export interface Fact<T> {
  readonly value: T;
  readonly source: string;
}

function fact<T>(value: T, source: string): Fact<T> {
  return { value, source };
}

export interface MandateFacts {
  sessionMode: "REGULAR" | "FEED_24_5";
  maxStalenessSec: number;
  maxPremiumBps: number;
  maxSlippageBps: number;
  twapWindowSec: number;
  multiplierCooldownSec: number;
  perTradeCapUsd: number;
  dailyCapUsd: number;
  maxWeightBps: number;
  minHealthFactor: number;
  targetHealthFactor: number;
  deriskWindowSec: number;
}

export interface Holiday {
  /** ET date, "YYYY-MM-DD". */
  date: string;
  name: string;
}

export interface EarlyClose {
  /** ET date, "YYYY-MM-DD". */
  date: string;
  /** Minutes after midnight ET. */
  closeMin: number;
}

export interface EventParam {
  type: string;
  indexed: boolean;
  name: string;
}

const SPEC = "docs/superpowers/specs/2026-11-06-mandate-treasury-design.md";
const FORK_TEST = "agent/test/integration/agent.fork.test.ts";

export const FACTS = {
  checksPerTrade: fact(9, `${SPEC} §3.1, the nine ordered checks`),
  refusalCount: fact(REASONS.length, "contracts/src/Types.sol enum Reason, every member except OK"),
  timelockHours: fact(24, "contracts/src/MandateVault.sol TIMELOCK = 24 hours"),
  forkBlock: fact(53_551_627, `${FORK_TEST} BLOCK_SESSION`),
  forkDay: fact("2026-11-05", "UTC and ET date of Base block 53,551,627, the fork point: contracts/script/BaseAddresses.sol BLOCK_SESSION comment (Thu 2026-11-05 15:30 UTC, 10:30 ET)"),
  forkTimeEt: fact("10:30", "time of Base block 53,551,627 in New York (ET): contracts/script/BaseAddresses.sol BLOCK_SESSION comment"),
  weekendOffsetDays: fact(2, `${FORK_TEST}: setNextBlockTimestamp(now + 2n * 86_400n) before the weekend BUY`),
  nvdaUiMultiplier: fact(
    "1.000537939576369481",
    "agent/test/integration/anvil.ts: NVDAc.uiMultiplier() = 1000537939576369481 (WAD) at the fork block",
  ),
  premiumsBps: fact(
    { AAPLc: 29, GOOGLc: 49, NVDAc: 53 },
    "contracts/script/MaatConfig.sol: TWAP(1800 s) vs Chainlink, measured in session at BLOCK_SESSION",
  ),
  mandate: fact<MandateFacts>(
    {
      sessionMode: "REGULAR",
      maxStalenessSec: 90_000,
      maxPremiumBps: 100,
      maxSlippageBps: 150,
      twapWindowSec: 1800,
      multiplierCooldownSec: 86_400,
      perTradeCapUsd: 50,
      dailyCapUsd: 100,
      maxWeightBps: 4000,
      minHealthFactor: 1.5,
      targetHealthFactor: 2,
      deriskWindowSec: 28_800,
    },
    "contracts/script/MaatConfig.sol defaultMandate(), MIN/TARGET_HEALTH_FACTOR, DERISK_WINDOW, basket(); sessionMode from contracts/script/Deploy.s.sol",
  ),
  gas: fact(
    { buy: 758_192, supply: 286_707, borrow: 484_173, refusalLog: 111_116 },
    `gasUsed per tx in agent/test/integration/fork-gas.json, written by MAAT_GAS_LOG from ${FORK_TEST} at BLOCK_SESSION (BUY varies a little between runs, the other three do not)`,
  ),
  feedAgeSec: fact(14, "age of the NVDAc Chainlink answer at BLOCK_SESSION, measured on the fork: contracts/script/BaseAddresses.sol BLOCK_SESSION comment (age 14 s)"),
  forkRunMaxStalenessSec: fact(
    3600,
    "maxStaleness of the vault in the recorded fork run (fork-gas.json): agent/test/integration/deploy.ts at 4492eed (git show 4492eed:agent/test/integration/deploy.ts); the helper now deploys the default mandate's value",
  ),
  loopMinutes: fact(15, "agent/src/loop/scheduler.ts IN_SESSION_MS, agent loop cadence in session"),
  rebalanceDriftPct: fact(5, "agent/src/policy.ts DEFAULT_POLICY.driftBps, rebalance past a 5-point drift"),
  targetWeightPct: fact(
    23.3,
    "agent/src/policy.ts DEFAULT_POLICY: (10,000 - cashReserveBps 3000) / 3 tokens = 2,333 bps per token",
  ),
  x402Price: fact("about one cent", `${SPEC} §3.4, x402 check priced at ~0.01 USDC`),
  solidityVersion: fact("0.8.28", "pragma solidity in contracts/src/IMandateVaultEvents.sol"),
  decisionEvent: fact<readonly EventParam[]>(
    [
      { type: "bytes32", indexed: true, name: "intentId" },
      { type: "Action", indexed: false, name: "action" },
      { type: "address", indexed: true, name: "token" },
      { type: "uint256", indexed: false, name: "amount" },
      { type: "bool", indexed: false, name: "allowed" },
      { type: "Reason", indexed: false, name: "reason" },
      { type: "bytes32", indexed: false, name: "rationaleHash" },
    ],
    "contracts/src/IMandateVaultEvents.sol event Decision",
  ),
  nyseSessionMin: fact(
    { open: 570, close: 960 },
    "contracts/src/MarketCalendar.sol OPEN_MIN, CLOSE_MIN (minutes after midnight ET)",
  ),
  feedEdgeMin: fact(
    1200,
    "contracts/src/MarketCalendar.sol FEED_EDGE_MIN: assumes Chainlink equity feeds stop Fri 20:00 ET and resume Sun 20:00 ET (not measured in the repository)",
  ),
  calendar: fact<{ holidays: readonly Holiday[]; earlyCloses: readonly EarlyClose[] }>(
    {
      holidays: [
        { date: "2026-11-26", name: "Thanksgiving" },
        { date: "2026-12-25", name: "Christmas" },
        { date: "2027-01-01", name: "New Year" },
        { date: "2027-01-18", name: "Martin Luther King Jr. Day" },
        { date: "2027-02-15", name: "Washington's Birthday" },
        { date: "2027-03-26", name: "Good Friday" },
        { date: "2027-05-31", name: "Memorial Day" },
        { date: "2027-06-18", name: "Juneteenth (observed)" },
        { date: "2027-07-05", name: "Independence Day (observed)" },
        { date: "2027-09-06", name: "Labor Day" },
        { date: "2027-11-25", name: "Thanksgiving" },
        { date: "2027-12-24", name: "Christmas (observed)" },
      ],
      earlyCloses: [
        { date: "2026-11-27", closeMin: 780 },
        { date: "2026-12-24", closeMin: 780 },
        { date: "2027-11-26", closeMin: 780 },
      ],
    },
    "contracts/src/MarketCalendar.sol constructor: _addHoliday (names from its comments) and _setEarlyClose",
  ),
  basket: fact(["NVDAc", "GOOGLc", "AAPLc"] as const, "contracts/script/MaatConfig.sol basket(), in listing order"),
  forkVaultUsd: fact(
    200,
    "agent/test/integration/deploy.ts: owner.fund(200_000_000n), the USDC the fork vault starts with",
  ),
} as const;
