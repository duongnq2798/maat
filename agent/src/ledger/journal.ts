import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import type { PreviewResult } from "../chain/preview.js";

export type JournalEntry =
  | { kind: "run"; runId: string; block: bigint; day: bigint; mode: "dry-run" | "live"; ok: boolean; summary: string; costUsd6: bigint; suggestions: number; proposals: number; error?: string }
  | { kind: "intent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; preview: PreviewResult; gate: string; txHash?: Hex; decision?: { allowed: boolean; reason: string } }
  | { kind: "housekeeping"; runId: string; call: "syncMultiplier"; token: Address; txHash?: Hex; gasUsed?: bigint; note?: string }
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
