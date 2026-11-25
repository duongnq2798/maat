import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { planAppend, readLocalChain } from "../lib/chain.mjs";
import { PublishStop } from "../lib/errors.mjs";
import { denyHit, project, publishedLine } from "../lib/spec.mjs";
import { chainRows, COMMIT, jsonl } from "./helpers.mjs";

// The agent's own rows for a round with MaatInbox briefs, written by agent/test/briefJournal.test.ts from the agent's
// journal code: the local journal.jsonl and the lines the agent says it publishes.
const agentFixture = (name) => readFileSync(new URL(`../../../agent/test/fixtures/${name}`, import.meta.url), "utf8");
const LOCAL = agentFixture("journal-briefs.local.jsonl");
const PUBLISHED = agentFixture("journal-briefs.jsonl");
const LOGS = JSON.parse(agentFixture("journal-briefs.logs.json"));

const stopOf = (fn) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof PublishStop) return e;
    throw e;
  }
  assert.fail("expected a PublishStop");
};
const brief = (extra = {}) => ({
  ts: "2026-11-28T03:00:00.000Z",
  commit: COMMIT,
  kind: "brief",
  runId: "run-1",
  briefId: 1,
  from: "0x000000000000000000000000000000000000a11c",
  txHash: `0x${"ab".repeat(32)}`,
  logIndex: 0,
  block: "60",
  outcome: "replied",
  reply: "Adopted: a 5 USD NVDAc buy fits the policy.",
  ...extra,
});

describe("brief rows (agent kind brief)", () => {
  it("projects a brief's identity, outcome, cap, adoption and reply, never a note or the brief's text", () => {
    const P = project({ ...brief({ adopted: true, cap: "briefs-per-sender", note: "why", text: "the brief itself" }), prev: "0x00", hash: "0x00" });
    assert.deepEqual(
      Object.keys(P).sort(),
      ["adopted", "block", "briefId", "cap", "commit", "from", "hash", "kind", "logIndex", "outcome", "prev", "reply", "runId", "ts", "txHash"].sort(),
    );
  });

  it("sanitizes a reply to 200 characters, as the agent does, and leaves out one nothing is left of", () => {
    assert.equal(project(brief({ reply: "see https://evil.example now" })).reply, "see [url] now");
    assert.equal(project(brief({ reply: "word ".repeat(60) })).reply.length <= 200, true);
    assert.equal("reply" in project(brief({ reply: "\u{1F680}" })), false);
  });

  it("passes the agent's own brief rows: the same projection, the same lines, and none the deny check stops", () => {
    const local = readLocalChain(LOCAL);
    assert.equal(local.length, PUBLISHED.split("\n").length - 1);
    assert.equal(local.filter((r) => r.row.kind === "brief").length, LOGS.length);
    assert.deepEqual(local.map((r) => `${r.line}\n`).join(""), PUBLISHED);
    for (const r of local) assert.equal(denyHit(r.P, r.line), null, `line ${r.lineNo}`);
    const p = planAppend({ local, files: [] });
    assert.equal(p.appended, local.length);
    assert.equal(p.files.map((f) => f.text).join(""), PUBLISHED);
    for (const b of LOGS) assert.equal(PUBLISHED.includes(b.text), false, `brief ${b.id}'s text`);
  });

  it("still stops, and pushes nothing, at a reply that would publish a hex string, a long token, a URL or a key", () => {
    for (const [reply, pattern] of [
      [`key ${"ab".repeat(32)}`, "HEX_RE"],
      [`token ${"Z".repeat(41)}`, "LONG_RE"],
    ]) {
      // A row written by code that skipped the sanitizer: the projection's own cut keeps the pattern out of the line,
      // so the check is run on a projection that carries it, as a changed spec.mjs would produce.
      const P = { ...project(brief()), reply };
      assert.deepEqual(denyHit(P, publishedLine(P)), { pattern, field: "reply" });
    }
    const leaky = chainRows([brief({ from: "see https://rpc.example.org/v2/fake" })]);
    const e = stopOf(() => planAppend({ local: readLocalChain(jsonl(leaky)), files: [] }));
    assert.match(e.message, /would match URL_RE in field from; nothing is pushed/);
    const key = chainRows([brief({ cap: "sk-fake0123456789abcdefXYZ" })]);
    assert.match(stopOf(() => planAppend({ local: readLocalChain(jsonl(key)), files: [] })).message, /would match KEY_RE in field cap/);
  });
});
