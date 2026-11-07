import { FACTS } from "./facts";
import { dayLabel, formatInt } from "./format";
import type { ReasonCode } from "./reasons";

/** enum Action in contracts/src/Types.sol, in order (parity-tested). */
export const ACTIONS = ["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY", "PAY_EXPENSE"] as const;
export type ActionName = (typeof ACTIONS)[number];

export type DecisionSource = "base-fork" | "base-mainnet";

export const SOURCE_LABEL: Record<DecisionSource, string> = {
  "base-fork": "Base fork",
  "base-mainnet": "Base mainnet",
};

export interface DecisionRow {
  source: DecisionSource;
  /** Fork rows: always the fork point. Mainnet rows: the block of the tx. */
  block: number;
  /** New York time, already formatted. */
  timeLabel: string;
  action: ActionName;
  symbol: string;
  amountUsd: number;
  allowed: boolean;
  reason: ReasonCode;
  gasUsed?: number;
  note?: string;
  /** Mainnet rows only (W2). */
  txHash?: `0x${string}`;
}

const thu = `${dayLabel(FACTS.forkDay.value)} ${FACTS.forkTimeEt.value}`;
const sat = dayLabel(FACTS.forkDay.value, FACTS.weekendOffsetDays.value);
const block = FACTS.forkBlock.value;
const gas = FACTS.gas.value;

/** The Plan 2B fork run (agent/test/integration/agent.fork.test.ts), in the order it ran. */
const FORK_ROWS: readonly DecisionRow[] = [
  {
    source: "base-fork",
    block,
    timeLabel: thu,
    action: "BUY",
    symbol: "NVDAc",
    amountUsd: 20,
    allowed: true,
    reason: "OK",
    gasUsed: gas.buy,
    note: `NVDAc under its ${FACTS.targetWeightPct.value}% target weight.`,
  },
  {
    source: "base-fork",
    block,
    timeLabel: thu,
    action: "SUPPLY",
    symbol: "NVDAc",
    amountUsd: 15,
    allowed: true,
    reason: "OK",
    gasUsed: gas.supply,
    note: "Posted as collateral on Aave V4.",
  },
  {
    source: "base-fork",
    block,
    timeLabel: thu,
    action: "BORROW",
    symbol: "USDC",
    amountUsd: 5,
    allowed: true,
    reason: "OK",
    gasUsed: gas.borrow,
    note: `Compute runway, health factor above ${FACTS.mandate.value.targetHealthFactor.toFixed(1)}.`,
  },
  {
    source: "base-fork",
    block,
    timeLabel: sat,
    action: "BUY",
    symbol: "GOOGLc",
    amountUsd: 10,
    allowed: false,
    reason: "MARKET_CLOSED",
    gasUsed: gas.refusalLog,
    note: "Weekend. Refused and logged once.",
  },
];

/** W1: the labeled fork run. W2 replaces this with Decision events read from the mainnet vault. */
export function getDecisions(): DecisionRow[] {
  return FORK_ROWS.map((r) => ({ ...r }));
}

export function intentLabel(r: DecisionRow): string {
  return `${r.action} ${r.symbol} · $${r.amountUsd}`;
}

export function decisionLabel(r: DecisionRow): string {
  return `${r.allowed ? "ALLOWED" : "REFUSED"} · ${r.reason}`;
}

export function gasLabel(r: DecisionRow): string {
  return r.gasUsed === undefined ? "n/a" : formatInt(r.gasUsed);
}
