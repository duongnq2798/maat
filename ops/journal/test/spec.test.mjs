import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keccak256 } from "../lib/keccak.mjs";
import { canon, denyHit, GENESIS, isDryRunRow, project, publishedLine, rowHash, sanitize } from "../lib/spec.mjs";
import { JOURNAL_HASHES, JOURNAL_LINES, LOCAL_ROWS, OWNER_HASH, OWNER_TEXT, V1_BLOB, V1_HASH } from "./vectors.mjs";

describe("keccak256", () => {
  it("hashes the empty input and abc to the published Keccak-256 values", () => {
    assert.equal(keccak256(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
    assert.equal(keccak256("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
  });

  it("reproduces the spec's hashes: the owner rationale, the 438-byte V1 blob and both journal lines", () => {
    assert.equal(keccak256(OWNER_TEXT), OWNER_HASH);
    assert.equal(keccak256(V1_BLOB), V1_HASH);
    assert.equal(keccak256(new TextEncoder().encode(V1_BLOB)), V1_HASH);
    const unhashed = JOURNAL_LINES.map((l) => {
      const { hash, ...rest } = JSON.parse(l);
      return canon(rest);
    });
    assert.deepEqual(unhashed.map((s) => keccak256(s)), JOURNAL_HASHES);
  });
});

describe("canon (spec §2.2)", () => {
  it("sorts keys at every level, drops undefined, and writes no whitespace", () => {
    assert.equal(canon({ b: 1, a: { d: [true, null], c: "x" }, z: undefined }), '{"a":{"c":"x","d":[true,null]},"b":1}');
  });

  it("refuses a number that is not a safe integer, and a value JSON has no form for", () => {
    assert.throws(() => canon({ x: 1.5 }), /integers only/);
    assert.throws(() => canon({ x: 2 ** 53 }), /integers only/);
    assert.throws(() => canon({ x: 1n }), /no canonical form/);
  });

  it("gives each spec line back unchanged after a parse", () => {
    for (const line of JOURNAL_LINES) assert.equal(canon(JSON.parse(line)), line);
  });
});

describe("sanitize (spec §2.3 and the §5.8 table)", () => {
  const cases = [
    ["a\tb\r\nc", "a b c"],
    ["  x  ", "x"],
    ["", "(no text)"],
    ["\u{1F680} go", "go"],
    [`key 0x${"ab".repeat(32)} end`, "key [hex] end"],
    ["token sk-fake0123456789abcdefXYZ here", "token [key] here"],
    [`run ${"A".repeat(45)} end`, "run [key] end"],
    ["NVDAc.price and 23.3% and e.g. 1.5bps", "[url] and 23.3% and e.g. 1.5bps"],
    ["mailto me at a@b.io", "mailto me at a@[url]"],
  ];
  for (const [input, out] of cases) {
    it(`${JSON.stringify(input).slice(0, 40)} -> ${out}`, () => assert.equal(sanitize(input, 600), out));
  }

  it("cuts on a space, with ' ...', or to '...' alone", () => {
    assert.equal(sanitize("see www and more", 11), "see www ...");
    assert.equal(sanitize("see www and more", 10), "see ...");
    assert.equal(sanitize("abcdefghijkl", 8), "...");
  });

  it("cuts (no text) too when max is under its 9 characters: step 5 comes after step 4", () => {
    assert.equal(sanitize("", 9), "(no text)");
    assert.equal(sanitize(" ", 7), "(no ...");
    assert.equal(sanitize("", 5), "...");
  });

  it("maps quotes, dashes and line breaks, and strips URLs, as in V2", () => {
    const v2 = "Fixture — premium check.\nSee https://basescan.org/tx/0xabc and www.example.com/x for context; vault says “no”.";
    assert.equal(sanitize(v2, 600), 'Fixture - premium check. See [url] and [url] for context; vault says "no".');
  });
});

describe("project (spec §3.2, the allowlist)", () => {
  const common = { ts: "2026-11-25T00:00:00.000Z", runId: "r1", commit: "unknown", prev: GENESIS, hash: GENESIS };

  it("turns the agent's two rows into the spec's two published lines, with the spec's hashes", () => {
    assert.deepEqual(LOCAL_ROWS.map((r) => publishedLine(project(r))), JOURNAL_LINES);
    assert.deepEqual(LOCAL_ROWS.map((r) => rowHash(project(r))), JOURNAL_HASHES);
  });

  it("never exports rationale, previewError, error, message, note or a field it does not list", () => {
    const secret = "sk-fake0123456789abcdefXYZ at https://rpc.example.org/v2/fake";
    const kinds = ["run", "intent", "sent", "reconcile", "mismatch", "housekeeping", "skip", "error", "probe"];
    for (const kind of kinds) {
      const P = project({ ...common, kind, rationale: secret, previewError: secret, error: secret, message: secret, note: secret, rpc: secret, summary: "ok" });
      for (const k of ["rationale", "previewError", "error", "message", "note", "rpc"]) assert.equal(k in P, false, `${kind}.${k}`);
      assert.equal(JSON.stringify(P).includes("fake"), false, kind);
    }
  });

  it("keeps exactly the fields its kind lists, plus the common ones, and leaves absent fields absent", () => {
    const all = Object.fromEntries(
      ["block", "day", "mode", "ok", "costUsd6", "suggestions", "proposals", "index", "intentId", "action", "symbol", "amountUsd6", "rationaleHash", "blob", "preview", "gate", "txHash", "gasUsed", "decision", "gas", "outcome", "call", "token", "at", "expected"].map((k) => [k, `v-${k}`]),
    );
    const keys = (kind) => Object.keys(project({ ...common, kind, ...all })).sort();
    const base = ["commit", "hash", "kind", "prev", "runId", "ts"];
    const want = (...more) => [...base, ...more].sort();
    assert.deepEqual(keys("run"), want("block", "day", "mode", "ok", "costUsd6", "suggestions", "proposals"));
    assert.deepEqual(keys("intent"), want("index", "intentId", "action", "symbol", "amountUsd6", "rationaleHash", "blob", "preview", "gate", "txHash", "gasUsed", "decision"));
    assert.deepEqual(keys("sent"), want("index", "intentId", "action", "symbol", "amountUsd6", "rationaleHash", "blob", "preview", "gate", "txHash", "gas"));
    assert.deepEqual(keys("reconcile"), want("intentId", "action", "txHash", "outcome", "decision"));
    assert.deepEqual(keys("mismatch"), want("intentId", "preview", "decision"));
    assert.deepEqual(keys("housekeeping"), want("call", "token", "txHash", "gas", "gasUsed"));
    assert.deepEqual(keys("skip"), want("index", "symbol", "action"));
    assert.deepEqual(keys("probe"), want("at", "expected", "outcome"));
    assert.deepEqual(keys("error"), base);
    assert.deepEqual(keys("constructor"), base);
    assert.deepEqual(Object.keys(project({ kind: "skip", index: 0 })).sort(), ["index", "kind"]);
  });

  it("keeps the on-disk JSON types: strings for bigints, numbers, booleans, objects", () => {
    const P = project({ ...common, kind: "reconcile", intentId: "0x01", action: "BUY", outcome: "applied", decision: { allowed: false, reason: "MARKET_CLOSED" } });
    assert.deepEqual(P.decision, { allowed: false, reason: "MARKET_CLOSED" });
    assert.equal(project({ ...common, kind: "run", ok: false, suggestions: 0 }).ok, false);
  });

  it("sanitizes a run's summary, and leaves it out when it is empty", () => {
    const run = (summary) => project({ ...common, kind: "run", summary });
    assert.equal(run("Buy—see https://example.com now").summary, "Buy-see [url] now");
    assert.equal(run("x ".repeat(400)).summary.length <= 600, true);
    assert.equal("summary" in run(""), false);
    assert.equal("summary" in project({ ...common, kind: "run" }), false);
  });

  it("leaves out a summary that nothing is left of after sanitizer steps 1 to 3, never (no text)", () => {
    const run = (summary) => project({ ...common, kind: "run", summary });
    // Only spaces, only emoji, only CJK or Cyrillic text, only control characters: the sanitizer drops every one.
    for (const summary of [" ", " \n\t ", "\u{1F680}", "\u{1F680} \u{1F4C8}", "上涨", "Рост", "\u0000\u007f 　"]) {
      assert.equal("summary" in run(summary), false, JSON.stringify(summary));
    }
    assert.equal(run("\u{1F680} go").summary, "go");
    // The hash covers the projection, so a row whose summary is all emoji hashes as one with no summary at all.
    const base = { ...common, kind: "run", block: "1", day: "20783", mode: "live", ok: true, costUsd6: "1", suggestions: 0, proposals: 0 };
    assert.equal(rowHash(project({ ...base, summary: "\u{1F680}" })), rowHash(project(base)));
    assert.equal(publishedLine(project({ ...base, summary: "\u{1F680}" })).includes("no text"), false);
  });

  it("marks a run that the daily LLM cap stopped as capped, and no other", () => {
    const run = (error) => project({ ...common, kind: "run", ok: false, error });
    assert.equal(run("llm cap: $0.75 of $0.75 spent on UTC day 20782; Claude not called").capped, true);
    assert.equal("capped" in run("halted: rpc down"), false);
    assert.equal("capped" in run(undefined), false);
  });
});

describe("denyHit (spec §3.5)", () => {
  const base = { ts: "2026-11-25T00:00:00.000Z", kind: "skip", runId: "r1", commit: "unknown", prev: GENESIS, hash: GENESIS, index: 0, action: "BUY" };
  const hit = (P) => denyHit(P, publishedLine(P));

  it("passes the spec's lines", () => {
    for (const line of JOURNAL_LINES) assert.equal(denyHit(JSON.parse(line), line), null);
  });

  it("refuses a URL or a key anywhere in the line, and names the field, not the text", () => {
    assert.deepEqual(hit({ ...base, symbol: "see https://rpc.example.org/v2/fake" }), { pattern: "URL_RE", field: "symbol" });
    assert.deepEqual(hit({ ...base, symbol: "www.fake.example" }), { pattern: "URL_RE", field: "symbol" });
    assert.deepEqual(hit({ ...base, action: "sk-fake0123456789abcdefXYZ" }), { pattern: "KEY_RE", field: "action" });
    assert.deepEqual(hit({ ...base, action: "ghp_fake0123456789abcdefghijkl" }), { pattern: "KEY_RE", field: "action" });
    assert.deepEqual(hit({ ...base, action: "-----BEGIN PRIVATE KEY-----" }), { pattern: "KEY_RE", field: "action" });
  });

  it("refuses hex and long tokens in free text (a run's summary, the blob's t), not in hashes", () => {
    const blob = (t) => `maat:v1:${canon({ j: JOURNAL_HASHES[0], t })}`;
    const sent = { ...base, kind: "sent", blob: blob("fine words"), rationaleHash: V1_HASH, txHash: JOURNAL_HASHES[1] };
    assert.equal(hit(sent), null);
    assert.deepEqual(hit({ ...sent, blob: blob(`key ${"ab".repeat(32)}`) }), { pattern: "HEX_RE", field: "blob" });
    assert.deepEqual(hit({ ...sent, blob: blob(`token ${"Z".repeat(41)}`) }), { pattern: "LONG_RE", field: "blob" });
    assert.deepEqual(hit({ ...base, kind: "run", summary: `x ${"Z".repeat(41)}` }), { pattern: "LONG_RE", field: "summary" });
  });
});

describe("isDryRunRow", () => {
  it("is true for a dry-run round, a gated dry-run intent and a skipped housekeeping call, as the agent reads them", () => {
    assert.equal(isDryRunRow({ kind: "run", mode: "dry-run" }), true);
    assert.equal(isDryRunRow({ kind: "intent", gate: "dry-run: would execute" }), true);
    assert.equal(isDryRunRow({ kind: "housekeeping", note: "dry-run" }), true);
    assert.equal(isDryRunRow({ kind: "run", mode: "live" }), false);
    assert.equal(isDryRunRow({ kind: "sent", gate: "live: execute" }), false);
  });
});
