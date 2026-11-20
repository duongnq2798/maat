import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import type { PreviewResult } from "../chain/preview.js";

export type Decision = { allowed: boolean; reason: string };

export type JournalEntry =
  | { kind: "run"; runId: string; block: bigint; day: bigint; mode: "dry-run" | "live"; ok: boolean; summary: string; costUsd6: bigint; suggestions: number; proposals: number; error?: string }
  | { kind: "intent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; preview: PreviewResult; previewError?: string; gate: string; txHash?: Hex; gasUsed?: bigint; decision?: Decision }
  /** Written right after the send returns, before the receipt: with `intent` it brackets the pending window. */
  | { kind: "sent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; preview: PreviewResult; previewError?: string; gate: string; txHash: Hex; gas: bigint }
  /** A send from an earlier round, settled (applied / dropped) or still pending at round start. */
  | { kind: "reconcile"; runId: string; intentId: Hex; action: string; txHash?: Hex; outcome: "applied" | "pending" | "dropped"; decision?: Decision; note?: string }
  | { kind: "mismatch"; runId: string; intentId: Hex; preview: string; decision: Decision; message: string }
  | { kind: "housekeeping"; runId: string; call: "syncMultiplier"; token: Address; txHash?: Hex; gas?: bigint; gasUsed?: bigint; note?: string }
  /** amount: USDC (6 decimals) the vault recorded as revenue; on a dry run, what it would record. */
  | { kind: "housekeeping"; runId: string; call: "notifyRevenue"; amount: bigint; txHash?: Hex; gas?: bigint; gasUsed?: bigint; note?: string }
  | { kind: "skip"; runId: string; index: number; symbol: string; action: string; error: string }
  | { kind: "error"; runId: string; message: string };

type Stringified<T> = {
  [K in keyof T]: T[K] extends bigint ? string : T[K] extends bigint | undefined ? string | undefined : T[K];
};

/** A journal line as read back from disk: every bigint is a decimal string and `ts` is present. */
export type JournalRow = JournalEntry extends infer E ? (E extends unknown ? Stringified<E> & { ts: string } : never) : never;

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** Append-only JSONL. Rows are written from `JournalEntry` and read back as `JournalRow` (bigints as strings). */
export class Journal {
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, "journal.jsonl");
  }

  async append(e: JournalEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file, JSON.stringify({ ts: new Date().toISOString(), ...e }, replacer) + "\n");
  }

  async read(): Promise<JournalRow[]> {
    try {
      const text = await readFile(this.file, "utf8");
      return text
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as JournalRow);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
}
