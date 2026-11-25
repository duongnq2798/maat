import { keccak256, toBytes, type Hash, type Hex } from "viem";
import type { RationaleEntry } from "./chain/rationale";

interface JournalLine {
  kind?: unknown;
  intentId?: unknown;
  rationale?: unknown;
  rationaleHash?: unknown;
  txHash?: unknown;
  ts?: unknown;
}

/**
 * The rationales of agent/src/ledger/journal.ts lines (`intent` and `sent`) that reached a transaction, one per intent
 * id (the latest line wins), oldest first. Throws if a line's text does not hash to its rationaleHash: such a file
 * would only ever show "Hash mismatch".
 */
export function exportRationales(lines: readonly unknown[]): RationaleEntry[] {
  const byId = new Map<string, RationaleEntry>();
  for (const raw of lines) {
    const l = raw as JournalLine;
    if ((l.kind !== "intent" && l.kind !== "sent") || typeof l.txHash !== "string") continue;
    if (typeof l.intentId !== "string" || typeof l.rationale !== "string" || typeof l.rationaleHash !== "string") continue;
    if (keccak256(toBytes(l.rationale)).toLowerCase() !== l.rationaleHash.toLowerCase()) {
      throw new Error(`rationale hash mismatch for ${l.intentId}`);
    }
    const entry: RationaleEntry = {
      intentId: l.intentId as Hex,
      rationaleHash: l.rationaleHash as Hex,
      text: l.rationale,
      txHash: l.txHash as Hash,
      ts: typeof l.ts === "string" ? l.ts : "",
    };
    const prev = byId.get(l.intentId.toLowerCase());
    if (!prev || prev.ts <= entry.ts) byId.set(l.intentId.toLowerCase(), entry);
  }
  return [...byId.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
