// @vitest-environment node
import { keccak256, toBytes, type Hash } from "viem";
import { describe, expect, it } from "vitest";
import { readJournal, verifyJournal, type JournalRead } from "@/lib/chain/ledger";
import { canon } from "@/lib/chain/rationale";
import { latestNote } from "@/lib/live/journal-note";
import { JOURNAL_HASHES, JOURNAL_LINES } from "./helpers/maat-v1";

// The tile "Latest note from Maat's agent" on /now (culture plan Move 8b): the newest run summary of the public
// agent-journal branch, verbatim, or nothing at all.

const file = (...lines: string[]) => lines.map((l) => `${l}\n`).join("");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** A published line (spec §3.1): hash = keccak256(canon({ ...fields, prev })), line = canon({ ...fields, prev, hash }). */
function publish(fields: Record<string, unknown>, prev: Hash): { line: string; hash: Hash } {
  const hash = keccak256(toBytes(canon({ ...fields, prev })));
  return { line: canon({ ...fields, prev, hash }), hash };
}

const run = (over: Record<string, unknown>) => ({
  kind: "run",
  ts: "2026-11-26T15:00:00.000Z",
  runId: "1795705200000-c0ffee00",
  commit: COMMIT,
  block: "61990000",
  day: "20783",
  mode: "live",
  ok: true,
  costUsd6: "3100",
  suggestions: 0,
  proposals: 0,
  ...over,
});

/** A read journal of `texts` (day file → text), as readJournal returns it once every file was fetched. */
function read(texts: Record<string, string>): JournalRead {
  const files = Object.keys(texts);
  return { state: "read", files, ...verifyJournal(files.map((name) => ({ name, text: texts[name]! }))) };
}

describe("latestNote", () => {
  it("is null while the branch does not exist, when it could not be read, and when it holds no run summary", () => {
    expect(latestNote({ state: "absent" })).toBeNull();
    expect(latestNote({ state: "error", message: "GitHub answered HTTP 500 for journal/index.json" })).toBeNull();
    expect(latestNote(read({}))).toBeNull();
    expect(latestNote(read({ "2026-11-24.jsonl": "" }))).toBeNull();
    // A round the daily LLM cap stopped has no summary (spec §3.2), and neither has any other kind of row.
    const capped = publish(run({ capped: true }), `0x${"0".repeat(64)}`);
    const skip = publish({ kind: "skip", ts: "2026-11-26T15:00:01.000Z", runId: "1795705200000-c0ffee00", commit: COMMIT, index: 0, symbol: "NVDAc", action: "BUY" }, capped.hash);
    const noSummary = read({ "2026-11-26.jsonl": file(capped.line, skip.line) });
    expect(noSummary.state === "read" && [noSummary.rows.length, noSummary.failure]).toEqual([2, null]);
    expect(latestNote(noSummary)).toBeNull();
  });

  it("reads the spec's run line: its summary verbatim, its time in ET, its commit and where it sits", () => {
    const note = latestNote(read({ "2026-11-24.jsonl": file(...JOURNAL_LINES) }));
    expect(note).toEqual({
      summary: "One buy proposed.",
      ts: Date.parse("2026-11-24T16:59:04.512Z") / 1000,
      when: "Tue 24 Nov 11:59 ET",
      commit: COMMIT,
      mode: "dry-run",
      file: "2026-11-24.jsonl",
      line: 1,
    });
  });

  it("takes the newest run row with a summary, across day files, and skips a newer one with none", () => {
    const later = publish(run({ summary: "NYSE is closed for Thanksgiving & I proposed nothing <today>." }), JOURNAL_HASHES[1]!);
    const capped = publish(run({ ts: "2026-11-26T15:15:00.000Z", runId: "1795706100000-c0ffee01", capped: true }), later.hash);
    const note = latestNote(read({ "2026-11-24.jsonl": file(...JOURNAL_LINES), "2026-11-26.jsonl": file(later.line, capped.line) }));
    expect(note).toEqual({
      summary: "NYSE is closed for Thanksgiving & I proposed nothing <today>.",
      ts: Date.parse("2026-11-26T15:00:00.000Z") / 1000,
      when: "Thu 26 Nov 10:00 ET",
      commit: COMMIT,
      mode: "live",
      file: "2026-11-26.jsonl",
      line: 1,
    });
  });

  it("shows nothing once the chain is broken anywhere: the newest note it can vouch for may not be the newest", () => {
    const later = publish(run({ summary: "Nothing proposed." }), JOURNAL_HASHES[1]!);
    const tampered = later.line.replace("Nothing proposed.", "Everything proposed.");
    const r = read({ "2026-11-24.jsonl": file(...JOURNAL_LINES), "2026-11-26.jsonl": file(tampered) });
    expect(r.state === "read" && r.failure).toMatchObject({ file: "2026-11-26.jsonl", line: 1 });
    expect(latestNote(r)).toBeNull();
  });

  it("keeps a commit only when it is a commit the spec allows, and skips a row whose time is not a time", () => {
    const odd = publish(run({ summary: "Odd commit.", commit: "main" }), JOURNAL_HASHES[1]!);
    expect(latestNote(read({ "2026-11-24.jsonl": file(...JOURNAL_LINES), "2026-11-26.jsonl": file(odd.line) }))).toMatchObject({
      summary: "Odd commit.",
      commit: null,
    });
    const noTime = publish(run({ summary: "No time.", ts: "yesterday" }), JOURNAL_HASHES[1]!);
    expect(latestNote(read({ "2026-11-24.jsonl": file(...JOURNAL_LINES), "2026-11-26.jsonl": file(noTime.line) }))).toMatchObject({
      summary: "One buy proposed.",
    });
  });

  it("is null for the branch as it is today: GitHub answers 404 for journal/index.json", async () => {
    const fetch404 = (async () => new Response("404: Not Found", { status: 404 })) as typeof fetch;
    expect(latestNote(await readJournal(fetch404))).toBeNull();
  });
});
