// @vitest-environment node
import { keccak256, toBytes, type Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import { anchorState, JOURNAL_RAW_URL, readJournal, verifyJournal } from "@/lib/chain/ledger";
import { canon, GENESIS } from "@/lib/chain/rationale";
import { JOURNAL_HASHES, JOURNAL_LINES, VECTORS } from "./helpers/maat-v1";

const TX: Hash = `0x${"ab".repeat(32)}`;
const file = (...lines: string[]) => lines.map((l) => `${l}\n`).join("");

/** A published line (spec §3.1): hash = keccak256(canon({ ...fields, prev })), line = canon({ ...fields, prev, hash }). */
function publish(fields: Record<string, unknown>, prev: Hash): { line: string; hash: Hash } {
  const hash = keccak256(toBytes(canon({ ...fields, prev })));
  return { line: canon({ ...fields, prev, hash }), hash };
}

/** A `sent` row for TX carrying V1, chained after the spec's two lines. */
function sentRow(over: Record<string, unknown> = {}) {
  return publish(
    {
      kind: "sent",
      ts: "2026-11-24T16:59:12.000Z",
      runId: "1795539542000-a1b2c3d4",
      commit: "0123456789abcdef0123456789abcdef01234567",
      index: 0,
      intentId: "0x5ab74fda7322b60dc25dc1ca3f0902cd67e72203319f46b70fd789b4604773d8",
      action: "BUY",
      symbol: "NVDAc",
      amountUsd6: "5000000",
      rationaleHash: VECTORS.V1.hash,
      blob: VECTORS.V1.blob,
      preview: "OK",
      gate: "live: execute",
      txHash: TX,
      gas: "300000",
      ...over,
    },
    JOURNAL_HASHES[1]!,
  );
}

const V1_ANCHOR = { text: VECTORS.V1.blob, j: JSON.parse(VECTORS.V1.blob.slice(8)).j as Hash };

describe("verifyJournal (§3.6)", () => {
  it("verifies the spec's two lines, which chain from GENESIS, with the hashes the spec gives", () => {
    const chain = verifyJournal([{ name: "2026-11-24.jsonl", text: file(...JOURNAL_LINES) }]);
    expect(chain.failure).toBeNull();
    expect(chain.rows.map((r) => r.hash)).toEqual(JOURNAL_HASHES);
    expect(chain.rows[0]!.prev).toBe(GENESIS);
    expect(chain.rows[1]!.prev).toBe(JOURNAL_HASHES[0]);
    expect(chain.head).toBe(JOURNAL_HASHES[1]);
    expect(chain.rows[1]!.fields).toMatchObject({ kind: "intent", blob: VECTORS.V1.blob, rationaleHash: VECTORS.V1.hash });
  });

  it("anchors V1's j in the first line: the blob commits to the journal before it", () => {
    expect(V1_ANCHOR.j).toBe(JOURNAL_HASHES[0]);
  });

  it("chains across day files in order and skips an empty file", () => {
    const chain = verifyJournal([
      { name: "2026-11-24.jsonl", text: file(JOURNAL_LINES[0]!) },
      { name: "2026-11-25.jsonl", text: "" },
      { name: "2026-11-26.jsonl", text: file(JOURNAL_LINES[1]!) },
    ]);
    expect(chain.failure).toBeNull();
    expect(chain.rows.map((r) => [r.file, r.line])).toEqual([
      ["2026-11-24.jsonl", 1],
      ["2026-11-26.jsonl", 1],
    ]);
  });

  it("stops at an edited line: its hash no longer matches its fields", () => {
    const edited = JOURNAL_LINES[0]!.replace("One buy proposed.", "Two buys proposed.");
    const chain = verifyJournal([{ name: "d.jsonl", text: file(edited, JOURNAL_LINES[1]!) }]);
    expect(chain.failure).toEqual({ file: "d.jsonl", line: 1, problem: "hash is not keccak256 of the line's other fields" });
    expect(chain.rows).toEqual([]);
    expect(chain.head).toBeNull();
  });

  it("stops at a removed line: the next line's prev points at a hash the page did not see", () => {
    const chain = verifyJournal([{ name: "d.jsonl", text: file(JOURNAL_LINES[1]!) }]);
    expect(chain.failure).toMatchObject({ line: 1, problem: expect.stringMatching(/prev is not the hash of the line before it \(GENESIS\)/) });
  });

  it("reports the rows that verified before a failure, and the head among them", () => {
    const chain = verifyJournal([{ name: "d.jsonl", text: file(JOURNAL_LINES[0]!, JOURNAL_LINES[0]!) }]);
    expect(chain.rows).toHaveLength(1);
    expect(chain.head).toBe(JOURNAL_HASHES[0]);
    expect(chain.failure).toMatchObject({ file: "d.jsonl", line: 2 });
  });

  it("rejects a line that is not canonical, not JSON, has no hash, or does not end in a line feed", () => {
    const spaced = JOURNAL_LINES[0]!.replace('{"block":', '{ "block":');
    expect(verifyJournal([{ name: "a", text: file(spaced) }]).failure?.problem).toBe("the line is not in canonical form");
    expect(verifyJournal([{ name: "a", text: file("not json") }]).failure?.problem).toBe("the line is not JSON");
    expect(verifyJournal([{ name: "a", text: file("[1]") }]).failure?.problem).toBe("the line is not a JSON object");
    expect(verifyJournal([{ name: "a", text: file(canon({ kind: "run", prev: GENESIS })) }]).failure?.problem).toMatch(/^hash is missing/);
    expect(verifyJournal([{ name: "a", text: file(canon({ hash: GENESIS, kind: "run" })) }]).failure?.problem).toMatch(/^prev is missing/);
    const unterminated = verifyJournal([{ name: "a", text: `${JOURNAL_LINES[0]}\n${JOURNAL_LINES[1]}` }]);
    expect(unterminated.rows).toHaveLength(1);
    expect(unterminated.failure).toEqual({ file: "a", line: 2, problem: "the line does not end with a line feed" });
  });
});

describe("anchorState (§3.6 step 4)", () => {
  const rowsWith = (...extra: string[]) => verifyJournal([{ name: "d.jsonl", text: file(...JOURNAL_LINES, ...extra) }]).rows;

  it("is pending while no sent or reconcile row names the transaction", () => {
    expect(anchorState(TX, V1_ANCHOR, rowsWith())).toBe("pending");
  });

  it("is anchored when a sent row names it, carries the onchain blob, and j is an earlier row's hash", () => {
    const rows = rowsWith(sentRow().line);
    expect(rows).toHaveLength(3);
    expect(anchorState(TX, V1_ANCHOR, rows)).toBe("anchored");
    expect(anchorState(TX.toUpperCase().replace("0X", "0x") as Hash, V1_ANCHOR, rows)).toBe("anchored");
  });

  it("is broken when the sent row's blob is another blob, or j names no earlier row", () => {
    expect(anchorState(TX, V1_ANCHOR, rowsWith(sentRow({ blob: VECTORS.V2.blob }).line))).toBe("broken");
    expect(anchorState(TX, { ...V1_ANCHOR, j: `0x${"cd".repeat(32)}` }, rowsWith(sentRow().line))).toBe("broken");
  });

  it("accepts a reconcile row, which carries no blob", () => {
    const reconcile = publish({ kind: "reconcile", ts: "2026-11-24T17:00:00.000Z", runId: "r2", intentId: "0x01", action: "BUY", txHash: TX, outcome: "applied" }, JOURNAL_HASHES[1]!);
    expect(anchorState(TX, V1_ANCHOR, rowsWith(reconcile.line))).toBe("anchored");
  });

  it("accepts GENESIS as j only when no row precedes the found one: the journal was empty when the blob was built", () => {
    const fields = { kind: "reconcile", ts: "2026-11-24T17:00:00.000Z", runId: "r2", intentId: "0x01", action: "BUY", txHash: TX, outcome: "applied" };
    const first = publish(fields, GENESIS);
    const alone = verifyJournal([{ name: "d.jsonl", text: file(first.line) }]).rows;
    expect(alone).toHaveLength(1);
    expect(anchorState(TX, { ...V1_ANCHOR, j: GENESIS }, alone)).toBe("anchored");
    // After the spec's two lines, a GENESIS j contradicts the rows before the reconcile row.
    const reconcile = publish(fields, JOURNAL_HASHES[1]!);
    expect(anchorState(TX, { ...V1_ANCHOR, j: GENESIS }, rowsWith(reconcile.line))).toBe("broken");
  });
});

describe("readJournal (§3.4, §3.6 step 1)", () => {
  const responses = (map: Record<string, Response | (() => Response)>) =>
    vi.fn(async (url: string | URL | Request) => {
      const key = String(url).slice(JOURNAL_RAW_URL.length);
      const r = map[key];
      if (!r) return new Response("404: Not Found", { status: 404 });
      return typeof r === "function" ? r() : r;
    }) as unknown as typeof fetch;
  const index = (days: unknown) => new Response(canon({ days, head: JOURNAL_HASHES[1], rows: 2, v: 1 }));

  it("reads the branch from raw.githubusercontent.com", () => {
    expect(JOURNAL_RAW_URL).toBe("https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/");
  });

  it("says the branch is absent when GitHub answers 404 for index.json", async () => {
    expect(await readJournal(responses({}))).toEqual({ state: "absent" });
  });

  it("reads index.json, then every day file it lists, and verifies the chain", async () => {
    const fetchImpl = responses({ "index.json": index(["2026-11-24.jsonl"]), "2026-11-24.jsonl": new Response(file(...JOURNAL_LINES)) });
    const r = await readJournal(fetchImpl);
    expect(r).toMatchObject({ state: "read", files: ["2026-11-24.jsonl"], head: JOURNAL_HASHES[1], failure: null });
    expect(r.state === "read" && r.rows).toHaveLength(2);
  });

  it("accepts days listed as dates, and checks the files whatever index.json claims about the head", async () => {
    const lying = new Response(canon({ days: ["2026-11-24"], head: GENESIS, rows: 99, v: 1 }));
    const r = await readJournal(responses({ "index.json": lying, "2026-11-24.jsonl": new Response(file(...JOURNAL_LINES)) }));
    expect(r).toMatchObject({ state: "read", head: JOURNAL_HASHES[1] });
  });

  it("reports an HTTP error, an index it cannot read, a listed file that is missing, and a network failure", async () => {
    expect(await readJournal(responses({ "index.json": new Response("x", { status: 500 }) }))).toEqual({ state: "error", message: "GitHub answered HTTP 500 for journal/index.json" });
    expect(await readJournal(responses({ "index.json": new Response("{") }))).toMatchObject({ state: "error", message: "journal/index.json is not JSON" });
    expect(await readJournal(responses({ "index.json": new Response(canon({ days: [], v: 2 })) }))).toMatchObject({ state: "error" });
    expect(await readJournal(responses({ "index.json": index(["../secrets"]) }))).toMatchObject({ state: "error", message: expect.stringMatching(/not a day file/) });
    expect(await readJournal(responses({ "index.json": index(["2026-11-24.jsonl"]) }))).toMatchObject({
      state: "error",
      message: "GitHub answered HTTP 404 for journal/2026-11-24.jsonl, which index.json lists",
    });
    const down = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    expect(await readJournal(down)).toEqual({ state: "error", message: "raw.githubusercontent.com could not be reached for journal/index.json" });
  });
});
