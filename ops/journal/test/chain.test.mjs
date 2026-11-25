import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { planAppend, readLocalChain, verifyPublished } from "../lib/chain.mjs";
import { PublishStop } from "../lib/errors.mjs";
import { canon, GENESIS } from "../lib/spec.mjs";
import { chainRows, jsonl, liveRun } from "./helpers.mjs";
import { JOURNAL_HASHES, JOURNAL_LINES, LOCAL_ROWS } from "./vectors.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const lines = (...ls) => ls.map((l) => `${l}\n`).join("");
/** The PublishStop `fn` throws; fails the test when it throws nothing or something else. */
function stopOf(fn) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof PublishStop, `expected a PublishStop, got ${e}`);
    return e;
  }
  assert.fail("expected a PublishStop");
}

const PRE_CHAIN = { ts: "2026-11-24T16:44:00.000Z", kind: "error", runId: "r0", message: "halted: request to https://rpc.example.org/v2/fake-key failed" };

describe("readLocalChain", () => {
  it("skips the rows written before the chain started and gives each chained row its published line", () => {
    const local = readLocalChain(jsonl([PRE_CHAIN, ...LOCAL_ROWS]));
    assert.deepEqual(local.map((r) => r.line), JOURNAL_LINES);
    assert.deepEqual(local.map((r) => r.lineNo), [2, 3]);
  });

  it("ignores a last line with no line feed yet (the agent may be writing it) and blank lines", () => {
    const text = `${jsonl(LOCAL_ROWS.slice(0, 1))}\n${JSON.stringify(LOCAL_ROWS[1]).slice(0, 40)}`;
    assert.equal(readLocalChain(text).length, 1);
    assert.equal(readLocalChain("").length, 0);
  });

  it("refuses a broken chain: an edited field, a removed row, a row with no hash after the start, a bad first prev", () => {
    const [a, b] = LOCAL_ROWS;
    const edited = stopOf(() => readLocalChain(jsonl([{ ...a, summary: "Two buys proposed." }, b])));
    assert.match(edited.message, /line 1\b.*hash/);
    const removed = stopOf(() => readLocalChain(jsonl([b])));
    assert.match(removed.message, /line 1\b.*prev/);
    const unhashed = stopOf(() => readLocalChain(jsonl([a, { ...b, hash: undefined }])));
    assert.match(unhashed.message, /line 2\b.*no hash/);
    const torn = stopOf(() => readLocalChain(`${jsonl([a])}{"kind":\n`));
    assert.match(torn.message, /line 2\b.*not a JSON object/);
    const badHash = stopOf(() => readLocalChain(jsonl([{ ...a, hash: "0xABC" }])));
    assert.match(badHash.message, /line 1\b.*hash/);
  });

  it("names the line, never the text, of a row it refuses", () => {
    const leaky = chainRows([{ ts: "2026-11-25T00:00:00.000Z", kind: "skip", runId: "r1", symbol: "sk-fake0123456789abcdefXYZ", index: 0, action: "BUY" }]);
    const e = stopOf(() => readLocalChain(jsonl([{ ...leaky[0], index: 1 }])));
    assert.equal(e.message.includes("fake"), false);
  });
});

describe("verifyPublished (spec §3.6 steps 1 to 3)", () => {
  it("verifies the spec's two lines and returns the head and the row count", () => {
    assert.deepEqual(verifyPublished([{ name: "2026-11-24.jsonl", text: lines(...JOURNAL_LINES) }]), { head: JOURNAL_HASHES[1], rows: 2 });
    assert.deepEqual(verifyPublished([]), { head: null, rows: 0 });
  });

  it("chains across day files in order", () => {
    const files = [
      { name: "2026-11-24.jsonl", text: lines(JOURNAL_LINES[0]) },
      { name: "2026-11-25.jsonl", text: lines(JOURNAL_LINES[1]) },
    ];
    assert.deepEqual(verifyPublished(files), { head: JOURNAL_HASHES[1], rows: 2 });
  });

  it("refuses an edited line, a removed line, a line not in canonical form and a file with no final line feed", () => {
    const edited = JOURNAL_LINES[0].replace("One buy proposed.", "Two buys proposed.");
    assert.match(stopOf(() => verifyPublished([{ name: "2026-11-24.jsonl", text: lines(edited, JOURNAL_LINES[1]) }])).message, /2026-11-24\.jsonl line 1: hash/);
    assert.match(stopOf(() => verifyPublished([{ name: "2026-11-24.jsonl", text: lines(JOURNAL_LINES[1]) }])).message, /line 1: prev/);
    const spaced = JOURNAL_LINES[0].replace('{"block":', '{ "block":');
    assert.match(stopOf(() => verifyPublished([{ name: "2026-11-24.jsonl", text: lines(spaced) }])).message, /canonical/);
    assert.match(stopOf(() => verifyPublished([{ name: "2026-11-24.jsonl", text: JOURNAL_LINES[0] }])).message, /line feed/);
  });
});

describe("planAppend", () => {
  const day1 = chainRows([liveRun("2026-11-26T14:00:00.000Z", "r1"), liveRun("2026-11-26T14:15:00.000Z", "r2")]);
  const day2 = chainRows([liveRun("2026-11-27T00:01:00.000Z", "r3"), liveRun("2026-11-27T00:16:00.000Z", "r4")], day1[1].hash);
  const plan = (rows, files = [], opts = {}) => planAppend({ local: readLocalChain(jsonl(rows)), files, ...opts });

  it("publishes every chained row on the first push, one file per UTC day, with an index that matches the files", () => {
    const p = plan([...day1, ...day2]);
    assert.equal(p.appended, 4);
    assert.deepEqual(p.files.map((f) => f.name), ["2026-11-26.jsonl", "2026-11-27.jsonl"]);
    assert.deepEqual(p.changed, ["2026-11-26.jsonl", "2026-11-27.jsonl"]);
    assert.equal(p.files[0].text.split("\n").length - 1, 2);
    assert.equal(p.index, `${canon({ days: ["2026-11-26.jsonl", "2026-11-27.jsonl"], head: day2[1].hash, rows: 4, v: 1 })}\n`);
  });

  it("never appends a row the branch already has: a second plan over the same journal appends nothing", () => {
    const first = plan(day1);
    const again = plan(day1, first.files);
    assert.equal(again.appended, 0);
    assert.deepEqual(again.changed, []);
    assert.deepEqual(again.files, first.files);
  });

  it("appends only the rows after the branch's head, and keeps the index consistent push after push", () => {
    const first = plan(day1.slice(0, 1));
    const second = plan([...day1, day2[0]], first.files);
    assert.equal(second.appended, 2);
    assert.deepEqual(second.changed, ["2026-11-26.jsonl", "2026-11-27.jsonl"]);
    assert.ok(second.files[0].text.startsWith(first.files[0].text));
    const third = plan([...day1, ...day2], second.files);
    assert.equal(third.appended, 1);
    assert.deepEqual(third.changed, ["2026-11-27.jsonl"]);
    for (const p of [first, second, third]) {
      const index = JSON.parse(p.index);
      const all = p.files.flatMap((f) => f.text.split("\n").slice(0, -1));
      assert.deepEqual(index.days, p.files.map((f) => f.name));
      assert.equal(index.rows, all.length);
      assert.equal(index.head, JSON.parse(all.at(-1)).hash);
      assert.equal(index.v, 1);
      assert.deepEqual(verifyPublished(p.files), { head: index.head, rows: index.rows });
    }
  });

  it("puts a row whose clock went back into the last day file, never an earlier one", () => {
    const rows = chainRows([liveRun("2026-11-27T00:01:00.000Z", "r1"), liveRun("2026-11-26T23:59:00.000Z", "r2")]);
    assert.deepEqual(plan(rows).files.map((f) => f.name), ["2026-11-27.jsonl"]);
  });

  it("stops when the branch's head is not in the local journal: another journal, or a shorter one", () => {
    const other = chainRows([liveRun("2026-11-26T14:00:00.000Z", "x1")]);
    const theirs = plan(other).files;
    assert.match(stopOf(() => plan(day1, theirs)).message, /head .* is not in the local journal/);
    const padded = [{ name: "2026-11-26.jsonl", text: plan(day1).files[0].text }];
    const shorter = chainRows([liveRun("2026-11-26T14:00:00.000Z", "r1")]);
    assert.match(stopOf(() => plan(shorter, padded)).message, /not in the local journal/);
  });

  it("stops on a broken chain on the branch and pushes nothing", () => {
    const published = plan(day1).files;
    const broken = [{ name: published[0].name, text: published[0].text.replace("Held:", "Sold:") }];
    assert.match(stopOf(() => plan([...day1, ...day2], broken)).message, /branch .*hash/);
  });

  it("refuses a row with a URL, key or token pattern, names its line and pattern, and never prints it", () => {
    const leak = (extra) => chainRows([liveRun("2026-11-26T14:30:00.000Z", "r9", extra)], day1[1].hash);
    const url = stopOf(() => plan([...day1, ...leak({ mode: "live https://rpc.example.org/v2/fake-key" })]));
    assert.match(url.message, /line 3\b.*URL_RE.*mode/);
    const key = stopOf(() => plan([...day1, ...leak({ block: "sk-fake0123456789abcdefXYZ" })]));
    assert.match(key.message, /line 3\b.*KEY_RE.*block/);
    for (const e of [url, key]) assert.equal(/fake|rpc\.example/.test(e.message), false);
  });

  it("refuses dry-run rows unless asked to allow them", () => {
    const dry = chainRows([liveRun("2026-11-26T14:00:00.000Z", "d1", { mode: "dry-run" })]);
    assert.match(stopOf(() => plan(dry)).message, /dry-run/);
    assert.equal(plan(dry, [], { allowDryRun: true }).appended, 1);
  });

  it("writes the spec's journal (the fixture) as exactly the published fixture files", () => {
    const p = planAppend({ local: readLocalChain(fixture("journal.jsonl")), files: [], allowDryRun: true });
    const index = JSON.parse(fixture("published/index.json"));
    assert.deepEqual(p.files.map((f) => f.name), index.days);
    for (const f of p.files) assert.equal(f.text, fixture(`published/${f.name}`));
    assert.equal(p.index, fixture("published/index.json"));
    assert.deepEqual(p.files[0].text.split("\n").slice(0, 2), JOURNAL_LINES);
    assert.equal(p.files.some((f) => /fake|"rationale":|"note":|"message":|"error":/.test(f.text)), false);
    assert.equal(GENESIS, JSON.parse(JOURNAL_LINES[0]).prev);
  });
});
