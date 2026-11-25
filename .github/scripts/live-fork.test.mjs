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
import {
  DEFAULT_RPCS,
  MARGIN,
  failedContracts,
  forgeArgs,
  mergeReports,
  parseBlock,
  pickFork,
  rpcErrors,
  runSuites,
  summary,
} from "./live-fork.mjs";

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

const INVARIANTS = "test/fork/LiveVaultInvariants.t.sol:LiveVaultInvariants";
const VAULT = "test/fork/LiveVault.t.sol:LiveVaultForkTest";
const BLOB = "test/fork/LiveVaultTrailingRationaleFork.t.sol:LiveVaultTrailingRationaleForkTest";
const REVERTED = "execute reverted for action 2 amount 17611: 0x: 1 != 0";

/**
 * A forge JSON report: `suites` maps each suite key to its tests and their status ("Success", "Failure" or
 * "Skipped").
 * @param {Record<string, Record<string, string>>} suites
 */
function report(suites) {
  return Object.fromEntries(
    Object.entries(suites).map(([key, tests]) => [
      key,
      {
        test_results: Object.fromEntries(
          Object.entries(tests).map(([name, status]) => [name, { status, reason: status === "Failure" ? REVERTED : null }]),
        ),
      },
    ]),
  );
}

const ALL_PASS = report({
  [INVARIANTS]: { "invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed()": "Success" },
  [VAULT]: { "test_compromisedExecutorIsBounded()": "Success" },
  [BLOB]: { "test_blobAtExactly1024Bytes()": "Success" },
});
const INVARIANT_FAILS = report({
  [INVARIANTS]: { "invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed()": "Failure" },
  [VAULT]: { "test_compromisedExecutorIsBounded()": "Success" },
  [BLOB]: { "test_blobAtExactly1024Bytes()": "Success" },
});
const INVARIANTS_ONLY_PASS = report({
  [INVARIANTS]: { "invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed()": "Success" },
});
const INVARIANTS_ONLY_FAIL = report({
  [INVARIANTS]: { "invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed()": "Failure" },
});

/**
 * The line forge v1.9.0 printed, colours included, when one account read of a live fork at block 62130131 failed
 * with an HTTP 502, and the same line without the colours.
 */
const RPC_ERROR_LINE =
  "\u001b[2m2026-11-25T14:25:28.852852Z\u001b[0m \u001b[31mERROR\u001b[0m \u001b[2msharedbackend\u001b[0m\u001b[2m:\u001b[0m Failed to send/recv `basic` \u001b[3merr\u001b[0m\u001b[2m=\u001b[0mfailed to get account for 0x3b0c5FbEff9d32fB6bB706bACc988c88b1871770: HTTP error 502 with body: TypeError: fetch failed \u001b[3maddress\u001b[0m\u001b[2m=\u001b[0m0x3b0c5FbEff9d32fB6bB706bACc988c88b1871770";
const RPC_ERROR_TEXT =
  "2026-11-25T14:25:28.852852Z ERROR sharedbackend: Failed to send/recv `basic` err=failed to get account for 0x3b0c5FbEff9d32fB6bB706bACc988c88b1871770: HTTP error 502 with body: TypeError: fetch failed address=0x3b0c5FbEff9d32fB6bB706bACc988c88b1871770";
/**
 * That run's log, cut down: the read failed (forge printed its error twice), the vault's execute reverted with empty
 * data, and the invariant failed.
 */
const STALLED_LOG = [
  "No files changed, compilation skipped",
  RPC_ERROR_LINE,
  RPC_ERROR_LINE,
  "Ran 1 test for test/fork/LiveVaultInvariants.t.sol:LiveVaultInvariants",
  `[FAIL: ${REVERTED}] invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed() (block: 62130131) (runs: 1, calls: 74, reverts: 0)`,
  "Suite result: FAILED. 0 passed; 1 failed; 0 skipped",
].join("\n");
const CLEAN_FAIL_LOG = [
  "Ran 1 test for test/fork/LiveVaultInvariants.t.sol:LiveVaultInvariants",
  `[FAIL: ${REVERTED}] invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed() (runs: 4, calls: 2048, reverts: 0)`,
  "Suite result: FAILED. 0 passed; 1 failed; 0 skipped",
].join("\n");
const CLEAN_PASS_LOG = "[PASS] invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed() (runs: 4, calls: 2048, reverts: 0)";

/**
 * A stand-in for forge: each call takes the next of `attempts`, writes its report (unless it is null) where
 * `--json-file` says and gives back its exit status and log. `calls` records each call's arguments and environment.
 * @param {{ status: number, output: string, report: object | null }[]} attempts
 */
function fakeForge(attempts) {
  /** @type {{ args: string[], env: Record<string, string> }[]} */
  const calls = [];
  const forge = async (args, env) => {
    const next = attempts[calls.length];
    calls.push({ args, env });
    assert.ok(next, `forge ran ${calls.length} times, more than the ${attempts.length} the test expects`);
    if (next.report !== null) writeFileSync(args[args.indexOf("--json-file") + 1], JSON.stringify(next.report));
    return { status: next.status, output: next.output };
  };
  return { forge, calls };
}

/** The value of one forge flag in an argument list, or undefined when the flag is absent. */
function flag(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

describe("rpcErrors", () => {
  test("finds the lines forge prints when a fork read through the RPC fails, without their colours, each once", () => {
    assert.deepEqual(rpcErrors(STALLED_LOG), [RPC_ERROR_TEXT]);
    // A storage read that failed while the invariant suite set up, at the same block, and the failure reason it
    // gave the test, both as forge printed them (cut short); then the same message for a block hash read.
    const reads = [
      "2026-11-25T14:29:01.319198Z ERROR sharedbackend: Failed to send/recv `storage` err=failed to get storage for 0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b at 105373567186143754050502370496533211543962552640498277541638777992056550836039: MPP HTTP request to https://mainnet.base.org/ failed: HTTP request failed: error sending request: error sending request: client error (SendRequest): connection error: connection reset",
      "[FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get storage for 0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b at 105373567186143754050502370496533211543962552640498277541638777992056550836039: MPP HTTP request to https://mainnet.base.org/ failed: HTTP request failed: error sending request: error sending request: client error (SendRequest): connection error: connection reset] invariant_executeRevertsOnlyWithNotExecutorOrIntentAlreadyUsed() (block: 62130131) (runs: 0, calls: 0, reverts: 0)",
      "ERROR sharedbackend: Failed to send/recv `block_hash` err=failed to get block hash for 62130000: error sending request",
    ];
    assert.deepEqual(rpcErrors(reads.join("\r\n")), reads);
  });

  test("finds none in a log with only passes, failures and console output", () => {
    assert.deepEqual(rpcErrors(CLEAN_FAIL_LOG), []);
    assert.deepEqual(rpcErrors(CLEAN_PASS_LOG), []);
    assert.deepEqual(rpcErrors("  live fork block 62123318\n  storage of the vault: 15 USDC\n"), []);
  });
});

describe("failedContracts and mergeReports", () => {
  test("names each suite with a failed test by its contract, once", () => {
    const twoFail = report({
      [INVARIANTS]: { "invariant_a()": "Failure", "invariant_b()": "Failure" },
      [VAULT]: { "setUp()": "Failure" },
      [BLOB]: { "test_blobAtExactly1024Bytes()": "Success" },
    });
    assert.deepEqual(failedContracts(twoFail), ["LiveVaultInvariants", "LiveVaultForkTest"]);
    assert.deepEqual(failedContracts(ALL_PASS), []);
  });

  test("takes each suite the rerun ran from the rerun, and every other suite from the first attempt", () => {
    const merged = mergeReports(INVARIANT_FAILS, INVARIANTS_ONLY_PASS);
    assert.deepEqual(Object.keys(merged), [INVARIANTS, VAULT, BLOB]);
    assert.deepEqual(merged, ALL_PASS);
    assert.deepEqual(INVARIANT_FAILS[INVARIANTS], INVARIANTS_ONLY_FAIL[INVARIANTS], "the inputs are left as they were");
  });
});

describe("forgeArgs", () => {
  test("runs the live suites at the block, with the block as the fuzz seed, and only the given contracts on a rerun", () => {
    const args = forgeArgs(62_123_318n, "/tmp/live-fork-1.json", null);
    assert.deepEqual(args, [
      "test",
      "--match-path",
      "test/fork/LiveVault*",
      "--fuzz-seed",
      "62123318",
      "-vv",
      "--json-file",
      "/tmp/live-fork-1.json",
    ]);
    const rerun = forgeArgs(62_123_318n, "/tmp/live-fork-2.json", ["LiveVaultInvariants", "LiveVaultForkTest"]);
    assert.deepEqual(rerun.slice(0, args.length - 1), args.slice(0, -1));
    assert.equal(flag(rerun, "--match-contract"), "^(?:LiveVaultInvariants|LiveVaultForkTest)$");
  });
});

describe("runSuites", () => {
  /** Two healthy fake RPCs at head 70,000, and the options every run below shares. */
  async function setup(attempts) {
    const first = await fakeRpc("first", healthy(70_000));
    const other = await fakeRpc("other", healthy(70_000));
    const fake = fakeForge(attempts);
    const options = { forge: fake.forge, rpc: first.url, rpcs: [first.url, other.url], block: 69_700n, dir: tempDir(), timeoutMs: 2_000 };
    return { first, other, fake, options };
  }

  test("passes a clean green run through: one attempt, its report, no annotation", async () => {
    const { fake, options } = await setup([{ status: 0, output: CLEAN_PASS_LOG, report: ALL_PASS }]);
    const result = await runSuites(options);
    assert.equal(result.code, 0);
    assert.deepEqual(result.report, ALL_PASS);
    assert.deepEqual(result.annotations, []);
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].env.BASE_RPC_URL, options.rpc);
    assert.equal(fake.calls[0].env.LIVE_FORK_BLOCK, "69700");
    assert.equal(flag(fake.calls[0].args, "--fuzz-seed"), "69700");
    assert.match(result.summary, /no RPC error/);
  });

  test("fails on a failure with a clean log, without a rerun, and keeps the report for the annotations", async () => {
    const { fake, options } = await setup([{ status: 1, output: CLEAN_FAIL_LOG, report: INVARIANT_FAILS }]);
    const result = await runSuites(options);
    assert.equal(result.code, 1);
    assert.deepEqual(result.report, INVARIANT_FAILS);
    assert.deepEqual(result.annotations, []);
    assert.equal(fake.calls.length, 1);
  });

  test("reruns the failed suites through the other RPC when the failed attempt's log has RPC errors, and passes when the rerun does", async () => {
    const { other, fake, options } = await setup([
      { status: 1, output: STALLED_LOG, report: INVARIANT_FAILS },
      { status: 0, output: CLEAN_PASS_LOG, report: INVARIANTS_ONLY_PASS },
    ]);
    const result = await runSuites(options);
    assert.equal(result.code, 0);
    assert.equal(fake.calls.length, 2);
    const [, rerun] = fake.calls;
    assert.equal(rerun.env.BASE_RPC_URL, other.url);
    assert.equal(rerun.env.LIVE_FORK_BLOCK, "69700");
    assert.equal(flag(rerun.args, "--fuzz-seed"), "69700");
    assert.equal(flag(rerun.args, "--match-contract"), "^(?:LiveVaultInvariants)$");
    assert.notEqual(flag(rerun.args, "--json-file"), flag(fake.calls[0].args, "--json-file"));
    // the rerun checked that the other RPC serves the block before it forked it
    assert.deepEqual(other.calls, ["eth_blockNumber", "eth_getBlockByNumber", "eth_getBalance"]);
    assert.deepEqual(result.report, ALL_PASS);
    assert.equal(result.annotations.length, 1);
    assert.match(result.annotations[0], /^::warning::/);
    assert.match(result.annotations[0], /RPC/);
    assert.match(result.annotations[0], /not a property/);
    assert.match(result.summary, /1 RPC error/);
    assert.ok(result.summary.includes(other.url));
  });

  test("fails on a rerun that fails with a clean log: a property failed", async () => {
    const { fake, options } = await setup([
      { status: 1, output: STALLED_LOG, report: INVARIANT_FAILS },
      { status: 1, output: CLEAN_FAIL_LOG, report: INVARIANTS_ONLY_FAIL },
    ]);
    const result = await runSuites(options);
    assert.equal(result.code, 1);
    assert.equal(fake.calls.length, 2);
    assert.deepEqual(result.report, INVARIANT_FAILS);
    assert.equal(result.annotations.length, 1, "only the warning about the first attempt");
    assert.match(result.annotations[0], /^::warning::/);
  });

  test("fails with no report when the rerun hits RPC errors too: the run gives no verdict on the vault", async () => {
    const { fake, options } = await setup([
      { status: 1, output: STALLED_LOG, report: INVARIANT_FAILS },
      { status: 1, output: STALLED_LOG, report: INVARIANTS_ONLY_FAIL },
    ]);
    const result = await runSuites(options);
    assert.equal(result.code, 1);
    assert.equal(fake.calls.length, 2);
    assert.equal(result.report, null);
    assert.equal(result.annotations.length, 2);
    assert.match(result.annotations[1], /^::error::/);
    assert.match(result.annotations[1], /no verdict/);
  });

  test("warns about RPC errors in a run that still passed, without a rerun", async () => {
    const { fake, options } = await setup([{ status: 0, output: `${RPC_ERROR_LINE}\n${CLEAN_PASS_LOG}`, report: ALL_PASS }]);
    const result = await runSuites(options);
    assert.equal(result.code, 0);
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(result.report, ALL_PASS);
    assert.equal(result.annotations.length, 1);
    assert.match(result.annotations[0], /^::warning::/);
  });

  test("reruns through the same RPC when the other one cannot serve the block", async () => {
    const first = await fakeRpc("first", healthy(70_000));
    const pruned = await fakeRpc("pruned", (method, params) =>
      method === "eth_getBalance" ? { body: { error: { code: -32000, message: "missing trie node" } } } : healthy(70_000)(method, params),
    );
    const fake = fakeForge([
      { status: 1, output: STALLED_LOG, report: INVARIANT_FAILS },
      { status: 0, output: CLEAN_PASS_LOG, report: INVARIANTS_ONLY_PASS },
    ]);
    const result = await runSuites({ forge: fake.forge, rpc: first.url, rpcs: [first.url, pruned.url], block: 69_700n, dir: tempDir(), timeoutMs: 2_000 });
    assert.equal(result.code, 0);
    assert.equal(fake.calls[1].env.BASE_RPC_URL, first.url);
  });

  test("fails with no verdict and no rerun when no RPC can serve the block any more", async () => {
    const down = await fakeRpc("down", () => ({ status: 503, body: "unavailable" }));
    const limited = await fakeRpc("limited", () => ({ status: 429, body: "slow down" }));
    const fake = fakeForge([{ status: 1, output: STALLED_LOG, report: INVARIANT_FAILS }]);
    const result = await runSuites({ forge: fake.forge, rpc: down.url, rpcs: [down.url, limited.url], block: 69_700n, dir: tempDir(), timeoutMs: 2_000 });
    assert.equal(result.code, 1);
    assert.equal(fake.calls.length, 1);
    assert.equal(result.report, null);
    assert.equal(result.annotations.length, 1);
    assert.match(result.annotations[0], /^::error::no verdict: .*no RPC can serve block 69700 for a rerun/);
    assert.match(result.summary, /Result: no verdict: /);
  });

  test("reruns every live suite when the failed attempt wrote no report", async () => {
    const { fake, options } = await setup([
      { status: 1, output: STALLED_LOG, report: null },
      { status: 0, output: CLEAN_PASS_LOG, report: ALL_PASS },
    ]);
    const result = await runSuites(options);
    assert.equal(result.code, 0);
    assert.equal(flag(fake.calls[1].args, "--match-contract"), undefined);
    assert.deepEqual(result.report, ALL_PASS);
  });
});

describe("the test command", () => {
  /** A fake forge executable: a Node script that plays the attempts of `planFile` in turn and records each call. */
  const FAKE_FORGE = [
    'import { readFileSync, writeFileSync } from "node:fs";',
    "const planFile = process.env.FAKE_FORGE_PLAN;",
    "const plan = JSON.parse(readFileSync(planFile, 'utf8'));",
    "const calls = JSON.parse(readFileSync(`${planFile}.calls`, 'utf8'));",
    "const args = process.argv.slice(2);",
    "calls.push({ args, rpc: process.env.BASE_RPC_URL, block: process.env.LIVE_FORK_BLOCK });",
    "writeFileSync(`${planFile}.calls`, JSON.stringify(calls));",
    "const step = plan[calls.length - 1];",
    "writeFileSync(args[args.indexOf('--json-file') + 1], JSON.stringify(step.report));",
    "process.stderr.write(step.output);",
    "process.exitCode = step.status;",
  ].join("\n");

  async function runTestCommand(attempts, env) {
    const dir = tempDir();
    const fake = path.join(dir, "fake-forge.mjs");
    const plan = path.join(dir, "plan.json");
    const reportFile = path.join(dir, "forge.json");
    writeFileSync(fake, FAKE_FORGE);
    writeFileSync(plan, JSON.stringify(attempts));
    writeFileSync(`${plan}.calls`, "[]");
    const run = await runCli(["test", reportFile], {
      LIVE_FORK_FORGE: JSON.stringify([process.execPath, fake]),
      FAKE_FORGE_PLAN: plan,
      ...env,
    });
    const calls = JSON.parse(readFileSync(`${plan}.calls`, "utf8"));
    let written = null;
    try {
      written = JSON.parse(readFileSync(reportFile, "utf8"));
    } catch {
      written = null;
    }
    return { ...run, calls, written };
  }

  test("streams forge's log, reruns a failure that came with RPC errors through the other RPC and writes the merged report", async () => {
    const a = await fakeRpc("a", healthy(70_000));
    const b = await fakeRpc("b", healthy(70_000));
    const run = await runTestCommand(
      [
        { status: 1, output: STALLED_LOG, report: INVARIANT_FAILS },
        { status: 0, output: CLEAN_PASS_LOG, report: INVARIANTS_ONLY_PASS },
      ],
      { BASE_RPC_URL: a.url, LIVE_FORK_BLOCK: "69700", LIVE_FORK_RPCS: `${a.url} ${b.url}` },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.stderr.includes(RPC_ERROR_LINE), "forge's log reaches the job log as forge wrote it");
    assert.deepEqual(
      run.calls.map((c) => [c.rpc, c.block, flag(c.args, "--match-contract") ?? null]),
      [
        [a.url, "69700", null],
        [b.url, "69700", "^(?:LiveVaultInvariants)$"],
      ],
    );
    assert.match(run.stdout, /^::warning::.*RPC/m);
    assert.deepEqual(run.written, ALL_PASS);
    assert.match(run.summary, /1 RPC error/);
  });

  test("writes no report when both attempts hit RPC errors, so the counts step annotates no test", async () => {
    const a = await fakeRpc("a", healthy(70_000));
    const run = await runTestCommand(
      [
        { status: 1, output: STALLED_LOG, report: INVARIANT_FAILS },
        { status: 1, output: STALLED_LOG, report: INVARIANTS_ONLY_FAIL },
      ],
      { BASE_RPC_URL: a.url, LIVE_FORK_BLOCK: "69700", LIVE_FORK_RPCS: a.url },
    );
    assert.equal(run.status, 1);
    assert.match(run.stdout, /^::error::.*no verdict/m);
    assert.equal(run.written, null);
  });

  test("refuses to run without the RPC and block the pick step wrote", async () => {
    const run = await runCli(["test", path.join(tempDir(), "forge.json")], { LIVE_FORK_BLOCK: "69700" });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /BASE_RPC_URL/);
    const noBlock = await runCli(["test", path.join(tempDir(), "forge.json")], { BASE_RPC_URL: "http://127.0.0.1:1/x" });
    assert.equal(noBlock.status, 1);
    assert.match(noBlock.stderr, /LIVE_FORK_BLOCK/);
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
    // live-fork.mjs runs forge (forgeArgs above) and writes the report the counts step reads
    assert.match(yaml, /run: node "\$GITHUB_WORKSPACE\/\.github\/scripts\/live-fork\.mjs" test "\$RUNNER_TEMP\/forge\.json"/);
    assert.match(yaml, /ci-counts\.mjs" extract forge "\$RUNNER_TEMP\/forge\.json" forge/);
    assert.doesNotMatch(yaml, /run: forge test/);
    // the workflow_dispatch input reaches the shell only through the environment, never pasted into a script
    assert.doesNotMatch(yaml, /run: .*\$\{\{ inputs\./);
  });

  test("leaves the job time for a rerun of a run slowed by a stalling RPC", () => {
    const timeout = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(yaml)?.[1]);
    assert.ok(timeout >= 45, `timeout-minutes is ${timeout}`);
  });

  test("ci.yml still leaves every fork suite, the live ones included, to this workflow", () => {
    assert.match(ci, /forge test --no-match-path "test\/fork\/\*"/);
    assert.doesNotMatch(ci, /LiveVault/);
  });
});
