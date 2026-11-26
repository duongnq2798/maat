import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { PublishRetry, PublishStop } from "../lib/errors.mjs";
import { agentDataDir, DEFAULT_CHECKOUT, INTERVAL_MIN, main, parseCli, REPO_ROOT } from "../publish.mjs";

describe("agentDataDir: the data folder, found as the agent and its restart loop find it", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "maat-agent-"));
  const withEnvFile = (text) => writeFileSync(join(agentDir, ".env"), text);

  it("is ./data under agent/ when nothing names one", () => {
    assert.equal(agentDataDir({ env: {}, agentDir }), resolve(agentDir, "data"));
  });

  it("reads only MAAT_DATA_DIR from agent/.env, lets the environment win over it and --data-dir win over both", () => {
    withEnvFile("ANTHROPIC_API_KEY=sk-ant-fake-not-read\nMAAT_DATA_DIR=./data-live\n");
    assert.equal(agentDataDir({ env: {}, agentDir }), resolve(agentDir, "data-live"));
    assert.equal(agentDataDir({ env: { MAAT_DATA_DIR: "./data-env" }, agentDir }), resolve(agentDir, "data-env"));
    assert.equal(agentDataDir({ flag: "./data-flag", env: { MAAT_DATA_DIR: "./data-env" }, agentDir }), resolve(agentDir, "data-flag"));
    const abs = resolve(tmpdir(), "maat-live");
    assert.equal(agentDataDir({ flag: abs, env: {}, agentDir }), abs);
    rmSync(agentDir, { recursive: true, force: true });
  });
});

describe("parseCli", () => {
  it("defaults to a round every 15 minutes, a checkout beside the repository and no remote override", () => {
    assert.equal(INTERVAL_MIN, 15);
    assert.equal(DEFAULT_CHECKOUT, resolve(REPO_ROOT, "..", "maat-agent-journal"));
    assert.deepEqual(parseCli([]), { dataDir: undefined, checkout: DEFAULT_CHECKOUT, remote: undefined, intervalMin: 15, once: false, allowDryRun: false, help: false });
  });

  it("reads every option, and refuses an unknown one or an interval that is not a positive number", () => {
    const o = parseCli(["--data-dir", "./d", "--checkout", "c", "--remote", "r.git", "--interval-min", "5", "--once", "--allow-dry-run"]);
    assert.deepEqual(o, { dataDir: "./d", checkout: resolve("c"), remote: "r.git", intervalMin: 5, once: true, allowDryRun: true, help: false });
    assert.throws(() => parseCli(["--force"]), /Unknown option/);
    assert.throws(() => parseCli(["--interval-min", "0"]), /positive/);
    assert.throws(() => parseCli(["--interval-min", "soon"]), /positive/);
  });
});

describe("main: the loop", () => {
  /** Runs main with a fake round and a fake sleep; `rounds` say what each round does. */
  async function drive(argv, rounds, { abortAfterSleeps = Infinity } = {}) {
    const out = [];
    const err = [];
    const calls = [];
    const sleeps = [];
    const ac = new AbortController();
    const code = await main(argv, {
      env: {},
      agentDir: resolve(tmpdir(), "maat-agent-none"),
      signal: ac.signal,
      log: (s) => out.push(s),
      err: (s) => err.push(s),
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= abortAfterSleeps) ac.abort();
      },
      publishOnce: async (o) => {
        calls.push(o);
        const next = rounds.shift();
        if (next === undefined) {
          ac.abort();
          throw new PublishRetry("no more rounds in this test");
        }
        return next();
      },
    });
    return { code, out, err, calls, sleeps };
  }
  const ok = (message) => () => ({ status: "pushed", appended: 1, rows: 1, head: null, message });

  it("runs a round at once, then one every interval, and Ctrl-C ends it with code 0", async () => {
    const r = await drive([], [ok("first"), ok("second")], { abortAfterSleeps: 2 });
    assert.equal(r.code, 0);
    assert.equal(r.calls.length, 2);
    assert.deepEqual(r.sleeps, [15 * 60_000, 15 * 60_000]);
    assert.match(r.out[0], /publishing .*journal\.jsonl to the agent-journal branch .*every 15 min; Ctrl-C stops it/);
    assert.equal(r.calls[0].journalFile, join(resolve(tmpdir(), "maat-agent-none"), "data", "journal.jsonl"));
    assert.ok(r.out.some((l) => l.endsWith(" first")) && r.out.some((l) => l.endsWith(" second")));
  });

  it("keeps going after a round that may pass, such as a network failure", async () => {
    const r = await drive([], [() => { throw new PublishRetry("git push failed: Could not resolve host"); }, ok("caught up")], { abortAfterSleeps: 2 });
    assert.equal(r.code, 0);
    assert.ok(r.out.some((l) => /will try again in 15 min: git push failed/.test(l)));
    assert.ok(r.out.some((l) => l.endsWith(" caught up")));
  });

  it("stops with code 1 and a STOPPED line on a condition the owner must look at", async () => {
    const r = await drive([], [() => { throw new PublishStop("the remote rejected the push as a non-fast-forward"); }, ok("never")]);
    assert.equal(r.code, 1);
    assert.equal(r.calls.length, 1);
    assert.match(r.err[0], /STOPPED: the remote rejected the push as a non-fast-forward/);
  });

  it("stops on an unexpected error too, with its first line and no credentials", async () => {
    const r = await drive([], [() => { throw new Error("EACCES at https://user:fake-token@example.invalid/x\nmore"); }]);
    assert.equal(r.code, 1);
    assert.match(r.err[0], /STOPPED: unexpected error: EACCES/);
    assert.equal(r.err.join("\n").includes("fake-token"), false);
  });

  it("--once runs one round: code 0 when it worked, 3 when it should be tried again, 1 when it stopped", async () => {
    assert.equal((await drive(["--once"], [ok("done")])).code, 0);
    assert.equal((await drive(["--once"], [() => { throw new PublishRetry("offline"); }])).code, 3);
    assert.equal((await drive(["--once"], [() => { throw new PublishStop("broken"); }])).code, 1);
  });

  it("refuses bad arguments with code 2 and the usage", async () => {
    const r = await drive(["--push-everything"], []);
    assert.equal(r.code, 2);
    assert.match(r.err.join("\n"), /Usage: node ops\/journal\/publish\.mjs/);
    assert.equal(r.calls.length, 0);
  });
});
