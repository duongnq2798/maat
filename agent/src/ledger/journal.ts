import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import type { PreviewResult } from "../chain/preview.js";
import { GENESIS, MAX_TEXT_CHARS } from "../rationale/blob.js";
import { canon } from "../rationale/canon.js";
import { clean, sanitize } from "../rationale/sanitize.js";

export type Decision = { allowed: boolean; reason: string };

export type JournalEntry =
  | { kind: "run"; runId: string; block: bigint; day: bigint; mode: "dry-run" | "live"; ok: boolean; summary: string; costUsd6: bigint; suggestions: number; proposals: number; error?: string }
  /** `rationale` is the text as written; `blob` the maat:v1 blob whose keccak256 is `rationaleHash`. */
  | { kind: "intent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; blob?: string; preview: PreviewResult; previewError?: string; gate: string; note?: string; txHash?: Hex; gasUsed?: bigint; decision?: Decision }
  /** Written right after the send returns, before the receipt: with `intent` it brackets the pending window. */
  | { kind: "sent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; blob?: string; preview: PreviewResult; previewError?: string; gate: string; note?: string; txHash: Hex; gas: bigint }
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
 * commit of the agent code that wrote the row (see gitCommit.ts); `prev` and `hash` chain the rows (see rowHash).
 * Rows older code wrote have none of the three.
 */
export type JournalRow = JournalEntry extends infer E ? (E extends unknown ? Stringified<E> & { ts: string; commit?: string; prev?: Hex; hash?: Hex } : never) : never;

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

// The public projection (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md §3.2): the fields the
// journal publisher may push, and the only ones a row's hash covers. Never `rationale`, `previewError`, `error`,
// `message` or `note`, nor any field not listed. A kind not listed exports the common fields only.
const COMMON = ["ts", "kind", "runId", "commit", "prev", "hash"] as const;
const BY_KIND: Readonly<Record<string, readonly string[]>> = {
  run: ["block", "day", "mode", "ok", "costUsd6", "suggestions", "proposals"],
  intent: ["index", "intentId", "action", "symbol", "amountUsd6", "rationaleHash", "blob", "preview", "gate", "txHash", "gasUsed", "decision"],
  sent: ["index", "intentId", "action", "symbol", "amountUsd6", "rationaleHash", "blob", "preview", "gate", "txHash", "gas"],
  reconcile: ["intentId", "action", "txHash", "outcome", "decision"],
  mismatch: ["intentId", "preview", "decision"],
  housekeeping: ["call", "token", "txHash", "gas", "gasUsed"],
  skip: ["index", "symbol", "action"],
};
/** How a `run` row's error starts when the daily LLM cap stopped the round before Claude was called (runOnce.ts). */
const LLM_CAP_ERROR = "llm cap: ";

/**
 * The public projection of a row as it is on disk (bigints as decimal strings). A `run` row's summary is sanitized,
 * and left out when sanitizer steps 1 to 3 leave nothing of it (only spaces, emoji or other dropped characters), so
 * it is never "(no text)". Its only trace of an error is `capped: true` when the LLM cap stopped the round.
 */
export function project(row: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  const kind = typeof row.kind === "string" ? row.kind : "";
  for (const k of [...COMMON, ...(Object.hasOwn(BY_KIND, kind) ? BY_KIND[kind]! : [])]) if (row[k] !== undefined) p[k] = row[k];
  if (kind === "run") {
    if (typeof row.summary === "string" && clean(row.summary) !== "") p.summary = sanitize(row.summary, MAX_TEXT_CHARS);
    if (typeof row.error === "string" && row.error.startsWith(LLM_CAP_ERROR)) p.capped = true;
  }
  return p;
}

/** A row's hash: keccak256 of the canonical JSON of its projection with `prev` (§3.1). Any `hash` in it is ignored. */
export function rowHash(projected: Readonly<Record<string, unknown>>, prev: Hex): Hex {
  return keccak256(toBytes(canon({ ...projected, prev, hash: undefined })));
}

/** The line the publisher pushes for a chained row: canon({ ...projection, prev, hash }). */
export function publishedLine(row: Readonly<Record<string, unknown>>): string {
  return canon(project(row));
}

export type ChainReport =
  | { ok: true; published: boolean; rows: number; legacy: number; skipped: number; head: Hex }
  | { ok: false; published: boolean; rows: number; line: number; problem: string };

const parseObject = (line: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(line);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Checks a journal's hash chain. Published lines (the agent-journal branch, §3.6) must each be canonical JSON, the
 * first with prev GENESIS. Local lines (journal.jsonl on the agent's PC) may begin with rows older code wrote, which
 * have no hash; from the first row with one, every row must have one. A local line that does not parse (a write a
 * crash cut short) carries no row and is passed over: the next row's prev still names the last row before it.
 * Which kind `text` is follows from its first line.
 */
export function verifyJournal(text: string): ChainReport {
  const all = text.split("\n").map((l, i) => ({ line: l.replace(/\r$/, ""), n: i + 1 })).filter((l) => l.line.trim().length > 0);
  const first = all[0] ? parseObject(all[0].line) : null;
  const published = first !== null && canonOr(first) === all[0]!.line;
  let head: Hex = GENESIS;
  let chained = published;
  let rows = 0;
  let legacy = 0;
  let skipped = 0;
  const fail = (line: number, problem: string): ChainReport => ({ ok: false, published, rows, line, problem });
  for (const { line, n } of all) {
    const row = parseObject(line);
    if (row === null) {
      if (published) return fail(n, "the line is not a JSON object");
      if (chained) skipped++;
      else legacy++;
      continue;
    }
    if (published && canonOr(row) !== line) return fail(n, "the line is not canonical JSON");
    if (typeof row.hash !== "string") {
      if (chained) return fail(n, "the row has no hash, but an earlier row started the chain");
      legacy++;
      continue;
    }
    chained = true;
    if (row.prev !== head) return fail(n, `prev ${String(row.prev)} is not the previous row's hash ${head}`);
    let want: Hex;
    try {
      want = rowHash(published ? row : project(row), head);
    } catch (e) {
      return fail(n, `the row has no canonical form: ${(e as Error).message}`);
    }
    if (want !== row.hash) return fail(n, `the hash ${row.hash} does not match the row (recomputed ${want})`);
    head = want;
    rows++;
  }
  return { ok: true, published, rows, legacy, skipped, head };
}

function canonOr(v: unknown): string | null {
  try {
    return canon(v);
  } catch {
    return null;
  }
}

/** The hash of the last row in `text` that has one, or GENESIS; lines that do not parse are passed over. */
function lastHash(text: string): Hex {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = parseObject(lines[i]!);
    if (row && typeof row.hash === "string") return row.hash as Hex;
  }
  return GENESIS;
}

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

/**
 * Append-only JSONL. Rows are written from `JournalEntry` and read back as `JournalRow` (bigints as strings). Every
 * row it appends carries `prev`, the previous row's hash (GENESIS for the first), and its own `hash` (rowHash), so a
 * rewritten row breaks every link after it. The last hash is kept in memory, read back from the file on first use.
 */
export class Journal {
  private readonly file: string;
  /** The hash of the last chained row; null until read from the file. */
  private last: Hex | null = null;
  /** The file ends without a newline (a write a crash cut short): the next row starts a fresh line. */
  private cutShort = false;
  /** Appends run one at a time, so each row chains to the one before it. */
  private queue: Promise<void> = Promise.resolve();

  /** With `commit`, every row this journal appends carries it. */
  constructor(
    private readonly dir: string,
    private readonly opts: { commit?: string } = {},
  ) {
    this.file = join(dir, "journal.jsonl");
  }

  /** The hash of the last row in the journal, or GENESIS when no row has one: the blob's `j`. */
  async head(): Promise<Hex> {
    await this.queue;
    return this.loadHead();
  }

  append(e: JournalEntry): Promise<void> {
    const write = this.queue.then(() => this.write(e));
    this.queue = write.catch(() => undefined);
    return write;
  }

  private async loadHead(): Promise<Hex> {
    if (this.last !== null) return this.last;
    let text = "";
    try {
      text = await readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    this.cutShort = text.length > 0 && !text.endsWith("\n");
    this.last = lastHash(text);
    return this.last;
  }

  private async write(e: JournalEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const prev = await this.loadHead();
    const commit = this.opts.commit === undefined ? {} : { commit: this.opts.commit };
    // The row as it will read back from disk, so the hash covers the same JSON types a verifier sees.
    const row = JSON.parse(JSON.stringify({ ts: new Date().toISOString(), ...commit, ...e }, replacer)) as Record<string, unknown>;
    const hash = rowHash(project(row), prev);
    await appendFile(this.file, `${this.cutShort ? "\n" : ""}${JSON.stringify({ ...row, prev, hash })}\n`);
    this.cutShort = false;
    this.last = hash;
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
