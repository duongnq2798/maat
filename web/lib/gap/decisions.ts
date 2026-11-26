import { REASONS, type ReasonCode } from "@/content/reasons";

/** topic0 of MandateVault's Decision event, as content/generated/abi.json gives it (test/gap-decisions.test.ts). */
export const DECISION_TOPIC = "0x31e6f801fe8c4e61fff662a75a05831c8f1341359c56a18463b2a33bfa2df322";

/**
 * Who sent a Decision, as /ledger's senderLabel gives it (spec 2026-11-25 maat:v1, section 4): owner is "owner, by hand",
 * brief is "brief-driven", and unlabelled is a transaction that is not a direct execute call to the vault.
 */
export const SENDERS = ["agent", "probe", "brief", "owner", "unlabelled"] as const;
export type Sender = (typeof SENDERS)[number];

/** OK, then enum Reason in contracts/src/Types.sol, as the Decision log's reason reads. */
export const REASON_CODES = ["OK", ...REASONS] as const satisfies readonly ReasonCode[];

/** One Decision log inside a window's blocks. */
export interface WindowDecision {
  block: number;
  logIndex: number;
  ts: number;
  tx: string;
  sender: Sender;
  allowed: boolean;
  reason: ReasonCode;
}

export interface DecisionCounts {
  count: number;
  marketClosed: number;
  bySender: Record<Sender, { count: number; marketClosed: number }>;
}

/** How many Decisions a window holds, and how many the vault refused with MARKET_CLOSED, in all and by sender. */
export function decisionCounts(list: readonly Pick<WindowDecision, "sender" | "reason">[]): DecisionCounts {
  const bySender = Object.fromEntries(SENDERS.map((s) => [s, { count: 0, marketClosed: 0 }])) as DecisionCounts["bySender"];
  let marketClosed = 0;
  for (const d of list) {
    const closed = d.reason === "MARKET_CLOSED" ? 1 : 0;
    bySender[d.sender].count++;
    bySender[d.sender].marketClosed += closed;
    marketClosed += closed;
  }
  return { count: list.length, marketClosed, bySender };
}
