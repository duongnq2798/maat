// Tests for live-fork.mjs and the shape of .github/workflows/live-fork.yml. Run with `node --test`, locally and in
// the CI summary job. The RPCs here are local HTTP servers: nothing reaches Base.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RPCS, MARGIN, parseBlock, pickFork, summary } from "./live-fork.mjs";

const SCRIPT = fileURLToPath(new URL("./live-fork.mjs", import.meta.url));
const WORKFLOW = fileURLToPath(new URL("../workflows/live-fork.yml", import.meta.url));
const CI = fileURLToPath(new URL("../workflows/ci.yml", import.meta.url));

/** Every server and directory a test made; the after() hook below closes and removes them. */
const SERVERS = [];
const TEMP_DIRS = [];

after(() => {
  for (const server of SERVERS) server.close();
  for (const dir of TEMP_DIRS) rmSync(dir, { recursive: true, force: true });
});

/** @returns {string} a new empty directory under the OS temp directory */
function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "live-fork-"));
  TEMP_DIRS.push(dir);
  return dir;
}

/**
 * A JSON-RPC endpoint on 127.0.0.1. `answer` gets each call's method and params and returns the HTTP status and body
 * to send, or null to never answer (a hung node). The URL ends in `/<name>` so the tests can tell endpoints apart.
 * @param {string} name
 * @param {(method: string, params: unknown[]) => { status?: number, body: unknown } | null} answer
 * @returns {Promise<{ url: string, calls: string[] }>}
 */
async function fakeRpc(name, answer) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const { method, params, id } = JSON.parse(raw);
      calls.push(method);
      const reply = answer(method, params);
      if (reply === null) return; // hang until the client gives up
      const body = typeof reply.body === "string" ? reply.body : JSON.stringify({ jsonrpc: "2.0", id, ...reply.body });
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(body);
    });
  });
  SERVERS.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/${name}`, calls };
}

/** A node at `head` that serves headers and state for every block up to it. */
function healthy(head, timestamp = 1_795_611_361) {
  return (method, params) => {
    if (method === "eth_blockNumber") return { body: { result: `0x${head.toString(16)}` } };
    if (method === "eth_getBlockByNumber") {
      const n = Number.parseInt(params[0], 16);
      if (n > head) return { body: { result: null } };
      return { body: { result: { number: params[0], timestamp: `0x${(timestamp - (head - n)).toString(16)}` } } };
    }
    if (method === "eth_getBalance") return { body: { result: "0x0" } };
    return { body: { error: { code: -32601, message: "method not found" } } };
  };
}

/**
 * Runs the CLI as the workflow does and returns its exit code, streams and outputs.
 * @param {Record<string, string>} env @returns {Promise<{ status: number | null, stdout: string, stderr: string, output: string, summary: string }>}
 */
async function runCli(args, env) {
  const dir = tempDir();
  const outputFile = path.join(dir, "output");
  const summaryFile = path.join(dir, "summary");
  writeFileSync(outputFile, "");
  writeFileSync(summaryFile, "");
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: outputFile, GITHUB_STEP_SUMMARY: summaryFile, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const status = await new Promise((resolve) => child.on("close", resolve));
  return { status, stdout, stderr, output: readFileSync(outputFile, "utf8"), summary: readFileSync(summaryFile, "utf8") };
}

describe("parseBlock", () => {
  test("reads an empty input as no block, and a decimal block number as a bigint", () => {
    assert.equal(parseBlock(undefined), null);
    assert.equal(parseBlock(""), null);
    assert.equal(parseBlock("  "), null);
    assert.equal(parseBlock("62104931"), 62_104_931n);
    assert.equal(parseBlock(" 62104931 "), 62_104_931n);
  });

  test("refuses anything that is not a positive decimal block number", () => {
    for (const bad of ["0", "-1", "1.5", "0x10", "1e6", "62_104_931", "012", "latest", "1 2"]) {
      assert.throws(() => parseBlock(bad), /not a block number/, bad);
    }
  });
});

describe("pickFork", () => {
  test("pins the block MARGIN blocks behind the head of the first RPC that answers", async () => {
    const a = await fakeRpc("a", healthy(62_104_931));
    const b = await fakeRpc("b", healthy(62_104_940));
    const pick = await pickFork({ rpcs: [a.url, b.url], block: null, timeoutMs: 2_000 });
    assert.equal(pick.rpc, a.url);
    assert.equal(pick.head, 62_104_931n);
    assert.equal(pick.block, 62_104_931n - BigInt(MARGIN));
    assert.equal(pick.timestamp, 1_795_611_361 - MARGIN);
    assert.deepEqual(pick.skipped, []);
    assert.deepEqual(b.calls, []);
    // the node must have the block's header and its state, not only its number
    assert.deepEqual(a.calls, ["eth_blockNumber", "eth_getBlockByNumber", "eth_getBalance"]);
  });

  test("falls back to the next RPC when one is rate-limited, errors or answers no number", async () => {
    const limited = await fakeRpc("limited", () => ({ status: 429, body: "Too Many Requests" }));
    const failing = await fakeRpc("failing", () => ({ body: { error: { code: -32000, message: "upstream down" } } }));
    const garbled = await fakeRpc("garbled", () => ({ body: { result: "soon" } }));
    const good = await fakeRpc("good", healthy(5_000));
    const pick = await pickFork({ rpcs: [limited.url, failing.url, garbled.url, good.url], block: null, timeoutMs: 2_000 });
    assert.equal(pick.rpc, good.url);
    assert.deepEqual(
      pick.skipped.map((s) => s.rpc),
      [limited.url, failing.url, garbled.url],
    );
    assert.match(pick.skipped[0].reason, /HTTP 429/);
    assert.match(pick.skipped[1].reason, /upstream down/);
    assert.match(pick.skipped[2].reason, /not a block number/);
  });

  test("falls back when an RPC has the block's header but not its state", async () => {
    const pruned = await fakeRpc("pruned", (method, params) =>
      method === "eth_getBalance"
        ? { body: { error: { code: -32000, message: "missing trie node" } } }
        : healthy(9_000)(method, params),
    );
    const good = await fakeRpc("good", healthy(9_000));
    const pick = await pickFork({ rpcs: [pruned.url, good.url], block: null, timeoutMs: 2_000 });
    assert.equal(pick.rpc, good.url);
    assert.match(pick.skipped[0].reason, /missing trie node/);
  });

  test("gives up on an RPC that does not answer within the timeout", async () => {
    const hung = await fakeRpc("hung", () => null);
    const good = await fakeRpc("good", healthy(9_000));
    const pick = await pickFork({ rpcs: [hung.url, good.url], block: null, timeoutMs: 200 });
    assert.equal(pick.rpc, good.url);
    assert.match(pick.skipped[0].reason, /did not answer within 200 ms/);
  });

  test("takes a requested block at or below the head", async () => {
    const a = await fakeRpc("a", healthy(62_104_931));
    const pick = await pickFork({ rpcs: [a.url], block: 61_972_742n, timeoutMs: 2_000 });
    assert.equal(pick.block, 61_972_742n);
    assert.equal(pick.timestamp, 1_795_611_361 - (62_104_931 - 61_972_742));
  });

  test("skips an RPC whose head is below the requested block", async () => {
    const behind = await fakeRpc("behind", healthy(100));
    const ahead = await fakeRpc("ahead", healthy(200));
    const pick = await pickFork({ rpcs: [behind.url, ahead.url], block: 150n, timeoutMs: 2_000 });
    assert.equal(pick.rpc, ahead.url);
    assert.match(pick.skipped[0].reason, /head 100 is below block 150/);
  });

  test("fails naming every RPC it tried when none can serve the block", async () => {
    const a = await fakeRpc("a", () => ({ status: 503, body: "unavailable" }));
    const b = await fakeRpc("b", () => ({ status: 429, body: "slow down" }));
    await assert.rejects(pickFork({ rpcs: [a.url, b.url], block: null, timeoutMs: 2_000 }), (error) => {
      assert.match(error.message, /no RPC can serve the fork/);
      assert.ok(error.message.includes(a.url) && error.message.includes(b.url));
      return true;
    });
  });

  test("tries the two keyless public endpoints by default, mainnet.base.org first", () => {
    assert.deepEqual(DEFAULT_RPCS, ["https://mainnet.base.org", "https://base-rpc.publicnode.com"]);
  });
});

describe("summary", () => {
  test("names the block, its UTC time, the RPC, the skipped RPCs and the command that reruns the run", () => {
    const text = summary({
      rpc: "https://base-rpc.publicnode.com",
      head: 62_105_231n,
      block: 62_104_931n,
      timestamp: 1_795_611_361,
      skipped: [{ rpc: "https://mainnet.base.org", reason: "HTTP 429" }],
    });
    assert.match(text, /block 62104931 \(2026-11-25 12:56:01 UTC\)/);
    assert.match(text, /https:\/\/base-rpc\.publicnode\.com/);
    assert.match(text, /skipped https:\/\/mainnet\.base\.org: HTTP 429/);
    assert.ok(
      text.includes(
        'LIVE_FORK_BLOCK=62104931 BASE_RPC_URL=https://base-rpc.publicnode.com forge test --match-path "test/fork/LiveVault*" --fuzz-seed 62104931',
      ),
    );
  });
});

describe("the pick command", () => {
  test("writes rpc, block and timestamp to GITHUB_OUTPUT and the summary to GITHUB_STEP_SUMMARY", async () => {
    const a = await fakeRpc("a", healthy(62_104_931));
    const run = await runCli(["pick"], { LIVE_FORK_RPCS: a.url, LIVE_FORK_BLOCK_INPUT: "" });
    assert.equal(run.status, 0, run.stderr);
    const block = 62_104_931 - MARGIN;
    assert.equal(run.output, `rpc=${a.url}\nblock=${block}\ntimestamp=${1_795_611_361 - MARGIN}\n`);
    assert.match(run.summary, new RegExp(`block ${block} `));
  });

  test("passes a requested block through", async () => {
    const a = await fakeRpc("a", healthy(62_104_931));
    const run = await runCli(["pick"], { LIVE_FORK_RPCS: a.url, LIVE_FORK_BLOCK_INPUT: "62000000" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.output, /^block=62000000$/m);
  });

  test("refuses a malformed requested block before it calls any RPC", async () => {
    const a = await fakeRpc("a", healthy(62_104_931));
    const run = await runCli(["pick"], { LIVE_FORK_RPCS: a.url, LIVE_FORK_BLOCK_INPUT: "0x3b3a" });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^::error::.*not a block number/m);
    assert.equal(run.output, "");
    assert.deepEqual(a.calls, []);
  });

  test("exits 1 with an annotation and writes no output when no RPC answers", async () => {
    const a = await fakeRpc("a", () => ({ status: 500, body: "boom" }));
    const run = await runCli(["pick"], { LIVE_FORK_RPCS: a.url });
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^::error::no RPC can serve the fork/m);
    assert.equal(run.output, "");
  });

  test("prints its usage for anything but pick", async () => {
    const run = await runCli(["choose"], {});
    assert.equal(run.status, 1);
    assert.match(run.stderr, /usage: node \.github\/scripts\/live-fork\.mjs pick/);
  });
});

/**
 * The keys one level under a top-level YAML key, read by indentation; enough for the two workflow files here, which
 * use two-space indentation and no flow mappings at that level.
 * @param {string} yaml @param {string} key @returns {string[]}
 */
function childKeys(yaml, key) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `no top-level ${key}:`);
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const match = /^ {2}([A-Za-z_][\w-]*):/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys;
}

describe("live-fork.yml", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");
  const ci = readFileSync(CI, "utf8");

  test('is named "live fork adversarial" and runs only on its schedule and by hand', () => {
    assert.match(yaml, /^name: live fork adversarial$/m);
    assert.deepEqual(childKeys(yaml, "on"), ["schedule", "workflow_dispatch"]);
    assert.doesNotMatch(yaml, /pull_request|^\s*push:/m);
    assert.match(yaml, /^ {4}- cron: "[^"]+"$/m);
  });

  test("needs no secret and reads the repository only", () => {
    assert.doesNotMatch(yaml, /secrets\./);
    assert.doesNotMatch(yaml, /github\.token|GITHUB_TOKEN/);
    assert.deepEqual(childKeys(yaml, "permissions"), ["contents"]);
    assert.match(yaml, /^permissions:\n {2}contents: read$/m);
    assert.match(yaml, /persist-credentials: false/);
  });

  test("installs the forge that ci.yml pins, with the same action commits", () => {
    for (const action of ["actions/checkout", "foundry-rs/foundry-toolchain"]) {
      const pin = new RegExp(`uses: ${action}@[0-9a-f]{40} # v[\\d.]+`);
      const inCi = pin.exec(ci)?.[0];
      assert.ok(inCi, `ci.yml pins ${action}`);
      assert.ok(yaml.includes(inCi), `live-fork.yml uses ${inCi}`);
    }
    assert.match(ci, /version: v1\.9\.0/);
    assert.match(yaml, /version: v1\.9\.0/);
    assert.match(yaml, /grep -q 6056c58/);
  });

  test("forks the block the pick step chose, with the block as the fuzz seed", () => {
    assert.match(yaml, /run: node "\$GITHUB_WORKSPACE\/\.github\/scripts\/live-fork\.mjs" pick/);
    assert.match(yaml, /LIVE_FORK_BLOCK_INPUT: \$\{\{ inputs\.block \}\}/);
    assert.match(yaml, /LIVE_FORK_BLOCK: \$\{\{ steps\.pick\.outputs\.block \}\}/);
    assert.match(yaml, /BASE_RPC_URL: \$\{\{ steps\.pick\.outputs\.rpc \}\}/);
    // the suites' forge-config comments bound their runs in the default profile, the one a run by hand uses too
    assert.doesNotMatch(yaml, /FOUNDRY_PROFILE/);
    assert.match(yaml, /forge test --match-path "test\/fork\/LiveVault\*" --fuzz-seed "\$LIVE_FORK_BLOCK"/);
    // the workflow_dispatch input reaches the shell only through the environment, never pasted into a script
    assert.doesNotMatch(yaml, /run: .*\$\{\{ inputs\./);
  });

  test("ci.yml still leaves every fork suite, the live ones included, to this workflow", () => {
    assert.match(ci, /forge test --no-match-path "test\/fork\/\*"/);
    assert.doesNotMatch(ci, /LiveVault/);
  });
});
