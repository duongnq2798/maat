import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import type { PreviewResult } from "../chain/preview.js";

export type Decision = { allowed: boolean; reason: string };

export type JournalEntry =
  | { kind: "run"; runId: string; block: bigint; day: bigint; mode: "dry-run" | "live"; ok: boolean; summary: string; costUsd6: bigint; suggestions: number; proposals: number; error?: string }
  | { kind: "intent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; preview: PreviewResult; previewError?: string; gate: string; note?: string; txHash?: Hex; gasUsed?: bigint; decision?: Decision }
  /** Written right after the send returns, before the receipt: with `intent` it brackets the pending window. */
  | { kind: "sent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; preview: PreviewResult; previewError?: string; gate: string; note?: string; txHash: Hex; gas: bigint }
  /** A send from an earlier round, settled (applied / dropped) or still pending at round start. */
  | { kind: "reconcile"; runId: string; intentId: Hex; action: string; txHash?: Hex; outcome: "applied" | "pending" | "dropped"; decision?: Decision; note?: string }
  | { kind: "mismatch"; runId: string; intentId: Hex; preview: string; decision: Decision; message: string }
  | { kind: "housekeeping"; runId: string; call: "syncMultiplier"; token: Address; txHash?: Hex; gas?: bigint; gasUsed?: bigint; note?: string }
  | { kind: "skip"; runId: string; index: number; symbol: string; action: string; error: string }
  | { kind: "error"; runId: string; message: string };

type Stringified<T> = {
  [K in keyof T]: T[K] extends bigint ? string : T[K] extends bigint | undefined ? string | undefined : T[K];
};

/**
 * A journal line as read back from disk: every bigint is a decimal string and `ts` is present. `commit` is the git
 * commit of the agent code that wrote the row (see gitCommit.ts); rows older code wrote have none.
 */
export type JournalRow = JournalEntry extends infer E ? (E extends unknown ? Stringified<E> & { ts: string; commit?: string } : never) : never;

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/**
 * Whether a row was written in dry-run, by this code or older code: a round's `run` row names its mode, a gated
 * intent row reads "dry-run: would ...", and a housekeeping row a dry-run skipped is noted "dry-run".
 */
export function isDryRunRow(r: Record<string, unknown>): boolean {
  return (
    (r.kind === "run" && r.mode === "dry-run") ||
    (typeof r.gate === "string" && r.gate.startsWith("dry-run")) ||
    (r.kind === "housekeeping" && r.note === "dry-run")
  );
}

/** Whether a row was written in live mode: a round's `run` row names its mode, and only live sends a tx. */
export function isLiveRow(r: Record<string, unknown>): boolean {
  return (r.kind === "run" && r.mode === "live") || r.kind === "sent";
}

/** Append-only JSONL. Rows are written from `JournalEntry` and read back as `JournalRow` (bigints as strings). */
export class Journal {
  private readonly file: string;

  /** With `commit`, every row this journal appends carries it. */
  constructor(
    private readonly dir: string,
    private readonly opts: { commit?: string } = {},
  ) {
    this.file = join(dir, "journal.jsonl");
  }

  async append(e: JournalEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const commit = this.opts.commit === undefined ? {} : { commit: this.opts.commit };
    await appendFile(this.file, JSON.stringify({ ts: new Date().toISOString(), ...commit, ...e }, replacer) + "\n");
  }

  /**
   * The first dry-run row on disk, or null. A line that does not parse (a write cut short by a crash) is passed over:
   * it cannot be told apart, and every dry-run round that reaches Claude also writes a `run` row naming its mode.
   */
  firstDryRunRow(): Promise<{ ts?: unknown; runId?: unknown } | null> {
    return this.firstRow(isDryRunRow);
  }

  /** The first live row on disk, or null; a line cut short is passed over, as in firstDryRunRow. */
  firstLiveRow(): Promise<{ ts?: unknown; runId?: unknown } | null> {
    return this.firstRow(isLiveRow);
  }

  private async firstRow(match: (r: Record<string, unknown>) => boolean): Promise<{ ts?: unknown; runId?: unknown } | null> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    for (const line of text.split("\n")) {
      if (line.trim().length === 0) continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (row !== null && typeof row === "object" && match(row as Record<string, unknown>)) return row as { ts?: unknown; runId?: unknown };
    }
    return null;
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
