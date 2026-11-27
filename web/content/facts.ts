import type { SenderLabel } from "../lib/chain/ledger";
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

/** One Decision log of the Base mainnet vault as an RPC returned it, with its block's time and its tx's gas. */
export interface RecordedLog {
  /** The emitting contract, the MandateVault. */
  address: `0x${string}`;
  blockNumber: string;
  logIndex: number;
  transactionHash: `0x${string}`;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  /** Unix seconds of the block. */
  blockTime: number;
  /** The tx's gasUsed, decimal. */
  gasUsed: string;
  /** Who sent it, as /ledger labels it (lib/chain/ledger.ts senderLabel): the tx's sender against the vault's owner(). */
  sender: SenderLabel;
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
  mainnetDecisions: fact<readonly RecordedLog[]>(
    [
      {
        address: "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b",
        blockNumber: "61700601",
        logIndex: 24,
        transactionHash: "0xdfdb6739912a73542d90129bd7269a939dc8b2d47a869f56d9ab5e3a02e86c3b",
        topics: [
          "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322",
          "0xdc06ec8e29767044d325cc10445a942d26a463a4ed08487b013c5fed2a59243c",
          "0x000000000000000000000000b20000000000000000000078ee7ce2fe4908108c",
        ],
        data: "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004c4b40000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6",
        blockTime: 1795530495,
        gasUsed: "113352",
        sender: "owner, by hand",
      },
      {
        address: "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b",
        blockNumber: "61745836",
        logIndex: 46,
        transactionHash: "0x61622340a151c73c3f2b3bc910292a3e3136bd4aa7ecd55a92f59914953a23c8",
        topics: [
          "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322",
          "0x475efb77a4242345466f42fc844ac578b99716db50eca20d0ffe27549a68ee3d",
          "0x000000000000000000000000b20000000000000000000078ee7ce2fe4908108c",
        ],
        data: "0x000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004c4b40000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000baa4c52e17e7acc5c7cc851e57a9df523c70b5a1530d77055bb2401370f57f6",
        blockTime: 1795539542,
        gasUsed: "702443",
        sender: "owner, by hand",
      },
      {
        address: "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b",
        blockNumber: "62776552",
        logIndex: 35,
        transactionHash: "0xca9e2dfe58cea6dc033292a1733a64658e702c3de25627ee7af136d42a38bed6",
        topics: [
          "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322",
          "0x22b5b771641eee43c5b450b8ec57bacdfeb2f0e3f4ffcb7070bfb1cce1b6b4ed",
          "0x000000000000000000000000b2000000000000000000002d0ba3164cc74f58b7",
        ],
        data: "0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000476c1100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006b855268417f4edb7b305281f7d7afb5bd7dc5506878a9e36476cf0ca78e0a6c1",
        blockTime: 1795745686,
        gasUsed: "120814",
        sender: "agent",
      },
    ],
    "the vault's Decision log in each tx's receipt (eth_getTransactionReceipt), its block's timestamp (eth_getBlockByNumber), the tx's gasUsed and its sender (eth_getTransactionByHash) against the vault's owner() 0x3c3a66f7...1D6a, read with cast from base-rpc.publicnode.com: the owner's two smoke-test Decisions on 2026-11-25, and on 2026-11-27 the first Decision of Maat's agent, sent by its executor 0x9bC6E49d...115A, whose maat:v1 blob names neither a probe nor a brief. An eth_getLogs scan of the vault from its deploy block 61,698,517 through block 62,875,303 found these three Decision logs and no other; /ledger and the landing read any later one from Base. web/content/docs/get-started/status.mdx records all three txs",
  ),
} as const;
