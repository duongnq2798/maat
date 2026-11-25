// The journal chain on both sides: the agent's local journal.jsonl (spec §3.1) and the day files of the agent-journal
// branch (spec §3.4, checked as the browser verifier of §3.6 checks them), and the plan that appends the one to the
// other. No git and no file system here: publisher.mjs reads and writes.
import { PublishStop } from "./errors.mjs";
import { canon, denyHit, GENESIS, HASH_RE, isDryRunRow, project, publishedLine, rowHash } from "./spec.mjs";

export const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/**
 * @typedef {{ lineNo: number, row: Record<string, unknown>, P: Record<string, unknown>, line: string }} LocalRow
 * @typedef {{ name: string, text: string }} DayFile
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The chained rows of the agent's journal, in order, each with its projection and published line. Rows before the
 * first one with a `hash` were written before the chain existed and are left out; from that row on every row must
 * carry a hash that matches its projection and a `prev` equal to the hash before it (GENESIS for the first). A line
 * that is not a JSON object carries no row and is passed over, as the agent's verifyJournal does: it is a write a crash
 * cut short, after which the agent starts a fresh line, and the next row's prev still names the last whole row, so a
 * row removed behind it still breaks the chain. `onSkip` hears the number of each such line after the chain started.
 * A last line with no line feed is one the agent may still be writing, so it waits for the next round.
 * @param {string} text
 * @param {(lineNo: number) => void} [onSkip]
 * @returns {LocalRow[]}
 */
export function readLocalChain(text, onSkip = () => {}) {
  const complete = text.split("\n").slice(0, -1);
  /** @type {LocalRow[]} */
  const out = [];
  let prev = GENESIS;
  complete.forEach((raw, i) => {
    const lineNo = i + 1;
    if (raw.trim() === "") return;
    /** @type {unknown} */
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      row = undefined;
    }
    const started = out.length > 0;
    if (!isObject(row)) {
      if (started) onSkip(lineNo);
      return;
    }
    if (!Object.hasOwn(row, "hash")) {
      if (!started) return;
      throw new PublishStop(`journal.jsonl line ${lineNo} has no hash, after the chain started at line ${out[0].lineNo}`);
    }
    if (typeof row.hash !== "string" || !HASH_RE.test(row.hash)) throw new PublishStop(`journal.jsonl line ${lineNo}: its hash is not 0x and 64 lowercase hex digits`);
    if (row.prev !== prev) throw new PublishStop(`journal.jsonl line ${lineNo}: its prev is not the hash of the chained row before it${started ? ` (line ${out[out.length - 1].lineNo})` : " (GENESIS for the first)"}`);
    /** @type {Record<string, unknown>} */
    let P;
    let line;
    try {
      P = project(row);
      line = publishedLine(P);
    } catch (e) {
      throw new PublishStop(`journal.jsonl line ${lineNo}: a field has no canonical form (${e instanceof Error ? e.message : "unknown"})`);
    }
    if (rowHash(P) !== row.hash) throw new PublishStop(`journal.jsonl line ${lineNo}: its hash is not keccak256 of its projected fields`);
    out.push({ lineNo, row, P, line });
    prev = row.hash;
  });
  return out;
}

/**
 * Checks the branch's day files, in order, as the browser verifier does: each line is canonical JSON, its hash is
 * keccak256 of its other fields, and its prev is the hash of the line before it (GENESIS for the very first).
 * @param {DayFile[]} files
 * @returns {{ head: string | null, rows: number }}
 */
export function verifyPublished(files) {
  let prev = GENESIS;
  let rows = 0;
  for (const { name, text } of files) {
    if (!DAY_FILE_RE.test(name)) throw new PublishStop(`${name} is not a day file name (YYYY-MM-DD.jsonl)`);
    if (text === "") continue;
    if (!text.endsWith("\n")) throw new PublishStop(`${name} does not end with a line feed`);
    text
      .slice(0, -1)
      .split("\n")
      .forEach((line, i) => {
        const at = `${name} line ${i + 1}`;
        /** @type {unknown} */
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          throw new PublishStop(`${at}: not JSON`);
        }
        if (!isObject(parsed)) throw new PublishStop(`${at}: not a JSON object`);
        let canonical;
        try {
          canonical = canon(parsed);
        } catch {
          canonical = null;
        }
        if (canonical !== line) throw new PublishStop(`${at}: not in canonical form`);
        if (typeof parsed.hash !== "string") throw new PublishStop(`${at}: hash is missing`);
        if (parsed.prev !== prev) throw new PublishStop(`${at}: prev is not the hash of the line before it`);
        if (rowHash(parsed) !== parsed.hash) throw new PublishStop(`${at}: hash is not keccak256 of the line's other fields`);
        prev = parsed.hash;
        rows++;
      });
  }
  return { head: rows === 0 ? null : prev, rows };
}

/**
 * The day file a row goes to: the UTC date of its `ts`.
 * @param {LocalRow} r
 */
function dayFileOf(r) {
  const ms = typeof r.row.ts === "string" ? Date.parse(r.row.ts) : NaN;
  if (!Number.isFinite(ms)) throw new PublishStop(`journal.jsonl line ${r.lineNo}: its ts is not a date`);
  return `${new Date(ms).toISOString().slice(0, 10)}.jsonl`;
}

/**
 * What the next push adds. `files` are the branch's day files in order; the rows the branch does not have yet are
 * those after its head in the local chain. Each goes to the UTC date of its ts, but never to a file earlier than the
 * row before it. Every new line passes the deny check, and the whole result is verified again before it is returned.
 * @param {{ local: LocalRow[], files: DayFile[], allowDryRun?: boolean }} o
 * @returns {{ appended: number, files: DayFile[], changed: string[], index: string, head: string | null, rows: number }}
 */
export function planAppend({ local, files, allowDryRun = false }) {
  let published;
  try {
    published = verifyPublished(files);
  } catch (e) {
    throw new PublishStop(`the published chain on the branch is broken, so nothing is appended to it: ${e instanceof Error ? e.message : e}`);
  }
  let start = 0;
  if (published.head !== null) {
    const k = local.findIndex((r) => r.row.hash === published.head);
    if (k < 0) throw new PublishStop(`the branch's head ${published.head} is not in the local journal: is this the journal the branch was published from?`);
    if (k + 1 !== published.rows) throw new PublishStop(`the branch holds ${published.rows} rows but its head is chained row ${k + 1} of the local journal`);
    start = k + 1;
  }
  const fresh = local.slice(start);
  for (const r of fresh) {
    if (!allowDryRun && isDryRunRow(r.row)) {
      throw new PublishStop(`journal.jsonl line ${r.lineNo} is a dry-run row; a line once pushed stays public, so the publisher reads only the live agent's journal (--allow-dry-run publishes it anyway)`);
    }
    const hit = denyHit(r.P, r.line);
    if (hit !== null) {
      throw new PublishStop(`journal.jsonl line ${r.lineNo}: its published line would match ${hit.pattern}${hit.field === null ? "" : ` in field ${hit.field}`}; nothing is pushed, since skipping it would break the chain`);
    }
  }
  /** @type {Map<string, string>} */
  const text = new Map(files.map((f) => [f.name, f.text]));
  /** @type {string[]} */
  const changed = [];
  let last = files.at(-1)?.name ?? "";
  for (const r of fresh) {
    const day = dayFileOf(r);
    const name = day < last ? last : day;
    last = name;
    text.set(name, (text.get(name) ?? "") + `${r.line}\n`);
    if (!changed.includes(name)) changed.push(name);
  }
  const all = [...text.keys()].sort().map((name) => ({ name, text: /** @type {string} */ (text.get(name)) }));
  const result = verifyPublished(all);
  const expected = fresh.at(-1)?.row.hash ?? published.head;
  if (result.head !== expected || result.rows !== published.rows + fresh.length) {
    throw new PublishStop("the planned day files do not end at the local journal's head; nothing is pushed");
  }
  const index = canon({ days: all.map((f) => f.name), head: result.head, rows: result.rows, v: 1 });
  return { appended: fresh.length, files: all, changed, index, head: result.head, rows: result.rows };
}
