import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, toBytes, type Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Journal, project, publishedLine, rowHash, verifyJournal, type JournalEntry } from "../src/ledger/journal.js";
import { GENESIS } from "../src/rationale/blob.js";
import { canon } from "../src/rationale/canon.js";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
/** §5.7: the two published lines, copied out of the spec. */
const PUBLISHED = fixture("journal-v1.jsonl").trim().split("\n");
const VECTORS: Record<string, { hex: Hex; hash: Hex }> = JSON.parse(fixture("maat-v1-vectors.json"));
const V1 = Buffer.from(VECTORS.V1!.hex.slice(2), "hex").toString("latin1");

const C = "0123456789abcdef0123456789abcdef01234567";
const R = "1795539542000-a1b2c3d4";
const H1 = "0x892d2dce569c783139f62dec297729642d35ff7e88bccd9d21dcb2defe2b84ff";
const H2 = "0x3a54dfb09811088c8f2ffdecf4666c6e34f721a7e4166f1a6557dc3133ec4f8c";

const RUN: JournalEntry = { kind: "run", runId: R, block: 61_745_836n, day: 20_781n, mode: "dry-run", ok: true, summary: "One buy proposed.", costUsd6: 4210n, suggestions: 1, proposals: 1 };
const INTENT: JournalEntry = {
  kind: "intent",
  runId: R,
  index: 0,
  intentId: keccak256(toBytes("spec-example")),
  action: "BUY",
  symbol: "NVDAc",
  amountUsd6: 5_000_000n,
  rationale: "Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.",
  rationaleHash: VECTORS.V1!.hash,
  blob: V1,
  preview: "OK",
  gate: "dry-run: would execute",
};

const dir = () => mkdtemp(join(tmpdir(), "maat-chain-"));
const lines = async (d: string) => (await readFile(join(d, "journal.jsonl"), "utf8")).trim().split("\n");
const rows = async (d: string) => (await lines(d)).map((l) => JSON.parse(l) as Record<string, unknown>);

/** Appends `e` as if at time `ts`. */
async function at(j: Journal, ts: string, e: JournalEntry) {
  vi.setSystemTime(new Date(ts));
  await j.append(e);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the journal hash chain (spec §3.1)", () => {
  it("§5.7: chains the fixture run and intent rows to the spec's published lines and hashes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const d = await dir();
    const j = new Journal(d, { commit: C });
    expect(await j.head()).toBe(GENESIS);
    await at(j, "2026-11-24T16:59:04.512Z", RUN);
    expect(await j.head()).toBe(H1);
    await at(j, "2026-11-24T16:59:09.007Z", INTENT);
    expect(await j.head()).toBe(H2);
    const local = await rows(d);
    expect(local.map((r) => [r.prev, r.hash])).toEqual([
      [GENESIS, H1],
      [H1, H2],
    ]);
    expect(local.map(publishedLine)).toEqual(PUBLISHED);
    expect(INTENT.kind === "intent" && INTENT.intentId).toBe("0x5ab74fda7322b60dc25dc1ca3f0902cd67e72203319f46b70fd789b4604773d8");
  });

  it("keeps every local field next to prev and hash; the hash covers the public projection only", async () => {
    const d = await dir();
    const j = new Journal(d, { commit: C });
    await j.append({ ...INTENT, previewError: "rpc timeout", note: "calendar unreadable" } as JournalEntry);
    const [row] = await rows(d);
    expect(row).toMatchObject({ rationale: INTENT.kind === "intent" && INTENT.rationale, previewError: "rpc timeout", note: "calendar unreadable", prev: GENESIS });
    const { hash: _own, ...projected } = project(row!);
    expect(projected).not.toHaveProperty("rationale");
    expect(row!.hash).toBe(keccak256(toBytes(canon({ ...projected, prev: GENESIS }))));
    expect(rowHash(project({ ...row!, rationale: "other words", previewError: "x" }), GENESIS)).toBe(row!.hash);
    expect(rowHash(project({ ...row!, amountUsd6: "5000001" }), GENESIS)).not.toBe(row!.hash);
  });

  it("reads the head back from the last line when it starts, and goes on with the chain", async () => {
    const d = await dir();
    await new Journal(d).append(RUN);
    await new Journal(d).append({ kind: "error", runId: "r2", message: "x" });
    const again = new Journal(d);
    const [, second] = await rows(d);
    expect(await again.head()).toBe(second!.hash);
    await again.append({ kind: "skip", runId: "r3", index: 0, symbol: "NVDAc", action: "SUPPLY", error: "credit actions are off" });
    expect((await rows(d)).map((r) => r.prev)).toEqual([GENESIS, (await rows(d))[0]!.hash, second!.hash]);
    expect(verifyJournal(await readFile(join(d, "journal.jsonl"), "utf8"))).toMatchObject({ ok: true, rows: 3, legacy: 0 });
  });

  it("starts the chain at the first row with a hash, after rows older code wrote", async () => {
    const d = await dir();
    await writeFile(join(d, "journal.jsonl"), `${JSON.stringify({ ts: "t0", kind: "error", runId: "old", message: "m" })}\n${JSON.stringify({ ts: "t1", kind: "error", runId: "old" })}\n`);
    const j = new Journal(d);
    expect(await j.head()).toBe(GENESIS);
    await j.append(RUN);
    await j.append(INTENT);
    const all = await rows(d);
    expect(all.map((r) => r.prev)).toEqual([undefined, undefined, GENESIS, all[2]!.hash]);
    expect(verifyJournal(await readFile(join(d, "journal.jsonl"), "utf8"))).toEqual({ ok: true, published: false, rows: 2, legacy: 2, skipped: 0, head: all[3]!.hash });
  });

  it("starts a fresh line after a line a crash cut short, and the chain still verifies", async () => {
    const d = await dir();
    await new Journal(d).append(RUN);
    await writeFile(join(d, "journal.jsonl"), '{"ts":"2026-11-24T17:00:00.000Z","kind":"inte', { flag: "a" });
    const j = new Journal(d);
    await j.append({ kind: "error", runId: "r2", message: "x" });
    const text = await readFile(join(d, "journal.jsonl"), "utf8");
    expect(text.split("\n")).toHaveLength(4);
    expect(verifyJournal(text)).toMatchObject({ ok: true, rows: 2, skipped: 1 });
  });

  it("does not move the head when a write fails, and the next append still chains to the last row written", async () => {
    const d = await dir();
    const j = new Journal(d);
    await j.append(RUN);
    const head = await j.head();
    // A directory where the file should be makes appendFile fail.
    await rm(join(d, "journal.jsonl"));
    await mkdir(join(d, "journal.jsonl"));
    await expect(j.append(INTENT)).rejects.toThrow();
    expect(await j.head()).toBe(head);
  });
});

describe("the public projection (spec §3.2)", () => {
  const common = { ts: "2026-11-24T16:59:04.512Z", runId: "r", commit: C, prev: GENESIS, hash: H1 };

  it("keeps the run fields, sanitizes the summary and turns an llm cap error into capped", () => {
    const run = { ...common, kind: "run", block: "1", day: "2", mode: "live", ok: false, costUsd6: "0", suggestions: 0, proposals: 0 };
    expect(project({ ...run, summary: "see https://x.io now", error: "llm cap: $0.75 of $0.75 spent on UTC day 2; Claude not called" })).toEqual({
      ts: common.ts,
      kind: "run",
      runId: "r",
      commit: C,
      prev: GENESIS,
      hash: H1,
      block: "1",
      day: "2",
      mode: "live",
      ok: false,
      costUsd6: "0",
      suggestions: 0,
      proposals: 0,
      summary: "see [url] now",
      capped: true,
    });
    expect(project({ ...run, summary: "", error: "claude: 529 overloaded" })).not.toHaveProperty("summary");
    expect(project({ ...run, summary: "", error: "claude: 529 overloaded" })).not.toHaveProperty("capped");
    expect(project({ ...run, summary: "", error: "claude: 529 overloaded" })).not.toHaveProperty("error");
  });

  it("leaves out a summary that sanitizer steps 1 to 3 leave empty, so it is never (no text), and hashes the row without it", () => {
    const run = { ...common, kind: "run", block: "1", day: "2", mode: "live", ok: true, costUsd6: "0", suggestions: 0, proposals: 0 };
    for (const summary of ["   ", "\u{1F680}", "\u{200B}", " \t\n "]) {
      const p = project({ ...run, summary });
      expect(p, JSON.stringify(summary)).not.toHaveProperty("summary");
      expect(rowHash(p, GENESIS)).toBe(rowHash(project(run), GENESIS));
    }
    expect(project({ ...run, summary: " ok \u{1F680} " })).toHaveProperty("summary", "ok");
    // The hash the journal publisher's project and rowHash (ops/journal/lib/spec.mjs on feat/journal-publisher) give
    // this row: the publisher recomputes every hash and stops at the first that differs.
    expect(rowHash(project({ ...run, summary: "\u{1F680}" }), GENESIS)).toBe("0xde98d57d900c39a3cb4cf65ced79dcff78e9ca19f20ed50eb75db238872dfe15");
  });

  it("keeps each kind's allowlisted fields and drops every other", () => {
    const priv = { rationale: "raw", previewError: "e", error: "e", message: "m", note: "n", extra: 1 };
    const sent = { ...common, ...priv, kind: "sent", index: 0, intentId: "0x1", action: "BUY", symbol: "NVDAc", amountUsd6: "1", rationaleHash: "0x2", blob: "maat:v1:{}", preview: "OK", gate: "execute", txHash: "0x3", gas: "9" };
    expect(Object.keys(project(sent)).sort()).toEqual(["action", "amountUsd6", "blob", "commit", "gas", "gate", "hash", "index", "intentId", "kind", "prev", "preview", "rationaleHash", "runId", "symbol", "ts", "txHash"]);
    const intent = { ...sent, kind: "intent", gasUsed: "8", decision: { allowed: true, reason: "OK" } };
    expect(Object.keys(project(intent))).toEqual(expect.arrayContaining(["gasUsed", "decision"]));
    expect(project(intent)).not.toHaveProperty("gas");
    const only = (kind: string, keys: string[], row: Record<string, unknown>) =>
      expect(Object.keys(project({ ...common, ...priv, kind, ...row })).sort()).toEqual(["commit", "hash", "kind", "prev", "runId", "ts", ...keys].sort());
    only("reconcile", ["intentId", "action", "txHash", "outcome", "decision"], { intentId: "0x1", action: "BUY", txHash: "0x3", outcome: "applied", decision: { allowed: true, reason: "OK" } });
    only("mismatch", ["intentId", "preview", "decision"], { intentId: "0x1", preview: "OK", decision: { allowed: false, reason: "SWAP_FAILED" } });
    only("housekeeping", ["call", "token", "txHash", "gas", "gasUsed"], { call: "syncMultiplier", token: "0x4", txHash: "0x3", gas: "1", gasUsed: "1" });
    only("skip", ["index", "symbol", "action"], { index: 1, symbol: "NVDAc", action: "SUPPLY" });
    only("error", [], {});
    only("probe", ["at", "expected", "outcome"], { at: "2026-11-27T17:58:00Z", expected: "OK", outcome: "skipped", index: 1 });
  });

  it("leaves a field the row lacks out, and keeps the types on disk", () => {
    const p = project({ kind: "skip", runId: "r", index: 2, symbol: "USDC", action: "BORROW", ts: "t" });
    expect(p).toEqual({ kind: "skip", runId: "r", index: 2, symbol: "USDC", action: "BORROW", ts: "t" });
  });
});

describe("verifyJournal", () => {
  it("verifies the spec's published lines and names the head", () => {
    expect(verifyJournal(PUBLISHED.join("\n") + "\n")).toEqual({ ok: true, published: true, rows: 2, legacy: 0, skipped: 0, head: H2 });
  });

  it("fails a published line that was changed, re-serialized, dropped or moved", () => {
    const [one, two] = PUBLISHED as [string, string];
    expect(verifyJournal(`${one}\n${two.replace('"amountUsd6":"5000000"', '"amountUsd6":"6000000"')}\n`)).toMatchObject({ ok: false, line: 2, problem: expect.stringMatching(/hash/) });
    expect(verifyJournal(`${one}\n${JSON.stringify(JSON.parse(two), null, 1)}\n`)).toMatchObject({ ok: false });
    expect(verifyJournal(`${one}\n${JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(two)).reverse()))}\n`)).toMatchObject({ ok: false, line: 2, problem: expect.stringMatching(/canonical/) });
    expect(verifyJournal(`${two}\n`)).toMatchObject({ ok: false, line: 1, problem: expect.stringMatching(/prev/) });
    expect(verifyJournal(`${two}\n${one}\n`)).toMatchObject({ ok: false, line: 1 });
  });

  it("fails a local row that was tampered with, removed, or written without a hash after the chain started", async () => {
    const d = await dir();
    const j = new Journal(d, { commit: C });
    await j.append(RUN);
    await j.append(INTENT);
    await j.append({ kind: "error", runId: R, message: "halted" });
    const [a, b, c] = await lines(d);
    expect(verifyJournal(`${a}\n${b}\n${c}\n`)).toMatchObject({ ok: true, rows: 3 });
    expect(verifyJournal(`${a}\n${b!.replace('"symbol":"NVDAc"', '"symbol":"AAPLc"')}\n${c}\n`)).toMatchObject({ ok: false, line: 2, problem: expect.stringMatching(/hash/) });
    expect(verifyJournal(`${a}\n${c}\n`)).toMatchObject({ ok: false, line: 2, problem: expect.stringMatching(/prev/) });
    const bare = JSON.stringify({ ...JSON.parse(c!), hash: undefined, prev: undefined });
    expect(verifyJournal(`${a}\n${b}\n${bare}\n`)).toMatchObject({ ok: false, line: 3, problem: expect.stringMatching(/no hash/) });
    // A private field is outside the hash: changing it is not tampering with the public record.
    expect(verifyJournal(`${a}\n${b!.replace('"rationale":"Fixture', '"rationale":"Edited')}\n${c}\n`)).toMatchObject({ ok: true });
  });
});
