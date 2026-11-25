// The two steps of .github/workflows/live-fork.yml that talk to an RPC. `pick` asks each keyless public Base RPC in
// turn for its head, takes a block MARGIN blocks behind it (or the block the run was asked for), checks that the node
// serves that block's header and state, and writes the RPC and the block for the test step. One block per run: every
// live suite forks the same state, and the block is also the fuzz seed, so a failed run can be rerun with the same
// inputs. `test` runs the live suites through that RPC and tells a failed RPC from a failed property: when a failed
// attempt's forge log says a fork read failed, it reruns the failed suites once, at the same block and seed, through
// another RPC that serves the block. Zero dependencies: Node 24 built-ins only.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Keyless public endpoints, in the order they are tried. */
export const DEFAULT_RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
/** How far behind the head the fork sits: 300 blocks, a minute at Base's 200 ms blocks, so every node behind a
 * load balancer has it. */
export const MARGIN = 300;
const TIMEOUT_MS = 15_000;
const USAGE = [
  "usage: node .github/scripts/live-fork.mjs pick (env: GITHUB_OUTPUT, optional LIVE_FORK_BLOCK_INPUT, LIVE_FORK_RPCS, GITHUB_STEP_SUMMARY)",
  "       node .github/scripts/live-fork.mjs test <report.json> (from contracts/; env: BASE_RPC_URL, LIVE_FORK_BLOCK, optional LIVE_FORK_RPCS, LIVE_FORK_FORGE, GITHUB_STEP_SUMMARY)",
].join("\n");
/** The suites every attempt runs, relative to contracts/. */
const MATCH_PATH = "test/fork/LiveVault*";

/** @typedef {{ rpc: string, reason: string }} Skipped */
/** @typedef {{ rpc: string, head: bigint, block: bigint, timestamp: number, skipped: Skipped[] }} Pick */

/**
 * The block a run was asked for: null for an empty input, else a positive decimal block number.
 * @param {string | undefined} text @returns {bigint | null}
 * @throws {Error} for anything else
 */
export function parseBlock(text) {
  const value = (text ?? "").trim();
  if (value === "") return null;
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error(`${JSON.stringify(value)} is not a block number`);
  return BigInt(value);
}

/**
 * One JSON-RPC call. Throws with a short reason on a timeout, an HTTP error, a body that is not JSON or a JSON-RPC
 * error.
 * @param {string} rpc @param {string} method @param {unknown[]} params @param {number} timeoutMs
 * @returns {Promise<unknown>} the call's result
 */
async function call(rpc, method, params, timeoutMs) {
  let response;
  try {
    response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error(`${method} did not answer within ${timeoutMs} ms`);
    throw new Error(`${method}: ${error.cause?.code ?? error.message}`);
  }
  const text = await response.text();
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${method}: the answer is not JSON`);
  }
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

/** @param {unknown} value @param {string} what @returns {bigint} a 0x quantity as a bigint */
function quantity(value, what) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`${what} is not a block number`);
  return BigInt(value);
}

/**
 * Tries each RPC in order and returns the first that serves the block: `block` when given, else MARGIN blocks behind
 * that RPC's head. A node must give the block's header and the state at it (a balance read), since forge reads both.
 * @param {{ rpcs: string[], block: bigint | null, timeoutMs?: number }} options
 * @returns {Promise<Pick>}
 * @throws {Error} naming each RPC and why it was skipped, when none serves the block
 */
export async function pickFork({ rpcs, block, timeoutMs = TIMEOUT_MS }) {
  /** @type {Skipped[]} */
  const skipped = [];
  for (const rpc of rpcs) {
    try {
      const head = quantity(await call(rpc, "eth_blockNumber", [], timeoutMs), "eth_blockNumber's answer");
      const target = block ?? head - BigInt(MARGIN);
      if (target > head) throw new Error(`head ${head} is below block ${target}`);
      const hex = `0x${target.toString(16)}`;
      const header = await call(rpc, "eth_getBlockByNumber", [hex, false], timeoutMs);
      if (header === null || typeof header !== "object") throw new Error(`no header for block ${target}`);
      const timestamp = Number(quantity(header.timestamp, `block ${target}'s timestamp`));
      await call(rpc, "eth_getBalance", ["0x0000000000000000000000000000000000000000", hex], timeoutMs);
      return { rpc, head, block: target, timestamp, skipped };
    } catch (error) {
      skipped.push({ rpc, reason: error.message });
    }
  }
  const reasons = skipped.map((s) => `${s.rpc} (${s.reason})`).join("; ");
  throw new Error(`no RPC can serve the fork: ${reasons}`);
}

/** @param {number} seconds @returns {string} "YYYY-MM-DD HH:MM:SS UTC" */
function utc(seconds) {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

/**
 * The job summary: which block and RPC the run used, which RPCs it skipped and the command that reruns it.
 * @param {Pick} pick @returns {string} Markdown
 */
export function summary(pick) {
  const lines = [
    "## live fork adversarial",
    "",
    `Forked Base at block ${pick.block} (${utc(pick.timestamp)}) through ${pick.rpc}, whose head was ${pick.head}.`,
  ];
  for (const s of pick.skipped) lines.push(`- skipped ${s.rpc}: ${s.reason}`);
  lines.push(
    "",
    "To rerun it from `contracts/`, with the same block and fuzz seed:",
    "",
    "```bash",
    `LIVE_FORK_BLOCK=${pick.block} BASE_RPC_URL=${pick.rpc} forge test --match-path "test/fork/LiveVault*" --fuzz-seed ${pick.block}`,
    "```",
    "",
  );
  return lines.join("\n");
}

/**
 * @param {"error" | "warning"} kind @param {string} message
 * @returns {string} one workflow annotation line with `%`, CR and LF escaped
 */
function annotation(kind, message) {
  return `::${kind}::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;
}

/** @param {string} message @returns {string} one `::error` line */
const errorAnnotation = (message) => annotation("error", message);

/**
 * A forge log line that says a fork read through the RPC failed. Foundry's fork backend logs each failed account,
 * storage or block hash read under the target `sharedbackend` ("Failed to send/recv `storage`"), and the error it gives
 * the EVM ("failed to get storage for ...") can reach a test's failure reason. The call that needed the value reverts
 * with empty data, which the live handlers record as a broken invariant.
 */
const RPC_ERROR =
  /\bsharedbackend\b|Failed to send\/recv|failed to get (?:account|storage|block hash)\b|could not instantiate forked environment/i;
/** The ANSI colour escapes forge writes into its log lines, even to a file. */
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * @param {string} log forge's stdout and stderr
 * @returns {string[]} each line that says a fork read through the RPC failed, trimmed, without ANSI colours and once:
 *   forge prints a read error twice, and a failure reason in its result and again in its list of failing tests
 */
export function rpcErrors(log) {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.replace(ANSI, "").trim())
    .filter((line) => RPC_ERROR.test(line));
  return [...new Set(lines)];
}

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * @param {Record<string, any>} report a `forge test --json-file` report, keyed by `<path>:<Contract>`
 * @returns {string[]} the contract of each suite with a failed test, in report order
 */
export function failedContracts(report) {
  const contracts = [];
  for (const [suite, result] of Object.entries(report)) {
    const tests = isObject(result) && isObject(result.test_results) ? Object.values(result.test_results) : [];
    const contract = suite.slice(suite.lastIndexOf(":") + 1);
    if (tests.some((t) => isObject(t) && t.status === "Failure") && !contracts.includes(contract)) contracts.push(contract);
  }
  return contracts;
}

/**
 * The run's report after a rerun of some suites: each suite the rerun ran comes from the rerun, every other suite from
 * the first attempt.
 * @param {Record<string, any>} first @param {Record<string, any>} rerun @returns {Record<string, any>}
 */
export function mergeReports(first, rerun) {
  return { ...first, ...rerun };
}

/**
 * The arguments of one forge run of the live suites, from contracts/: the block is the fuzz seed, and a rerun names
 * the contracts it runs again.
 * @param {bigint} block @param {string} jsonFile @param {string[] | null} contracts null for every live suite
 * @returns {string[]}
 */
export function forgeArgs(block, jsonFile, contracts) {
  const args = ["test", "--match-path", MATCH_PATH, "--fuzz-seed", String(block), "-vv", "--json-file", jsonFile];
  if (contracts) args.push("--match-contract", `^(?:${contracts.join("|")})$`);
  return args;
}

/** @typedef {{ status: number | null, output: string }} ForgeRun */
/** @typedef {(args: string[], env: Record<string, string>) => Promise<ForgeRun>} Forge */
/**
 * @typedef {{ rpc: string, contracts: string[] | null, status: number | null, errors: string[],
 *   report: Record<string, any> | null }} Attempt
 */
/** @typedef {{ code: 0 | 1, report: Record<string, any> | null, annotations: string[], summary: string }} SuitesResult */

/**
 * One forge run of the live suites through `rpc` at `block`.
 * @param {Forge} forge @param {string} rpc @param {bigint} block @param {string} jsonFile
 * @param {string[] | null} contracts @returns {Promise<Attempt>}
 */
async function attempt(forge, rpc, block, jsonFile, contracts) {
  rmSync(jsonFile, { force: true });
  const run = await forge(forgeArgs(block, jsonFile, contracts), { BASE_RPC_URL: rpc, LIVE_FORK_BLOCK: String(block) });
  let report = null;
  try {
    const parsed = JSON.parse(readFileSync(jsonFile, "utf8"));
    if (isObject(parsed)) report = parsed;
  } catch {
    report = null;
  }
  return { rpc, contracts, status: run.status, errors: rpcErrors(run.output), report };
}

/** @param {number} n @returns {string} "1 RPC error" or "n RPC errors" */
const rpcErrorCount = (n) => (n === 1 ? "1 RPC error" : `${n} RPC errors`);

/** @param {number} n @param {Attempt} a @returns {string} one summary line for attempt n */
function attemptLine(n, a) {
  const suites = a.contracts ? a.contracts.join(", ") : "every live suite";
  const forge = a.status === 0 ? "passed" : `failed (exit ${a.status})`;
  const errors = a.errors.length === 0 ? "no RPC error" : rpcErrorCount(a.errors.length);
  return `- Attempt ${n}, ${suites} through ${a.rpc}: forge ${forge}, with ${errors} in its log.`;
}

/** The RPC error lines a summary quotes, at most. */
const QUOTED_ERRORS = 5;

/**
 * @param {Attempt[]} attempts @param {string} result
 * @returns {string} the Markdown the test step appends to the job summary
 */
function suitesSummary(attempts, result) {
  const lines = ["### Live suites", "", ...attempts.map((a, i) => attemptLine(i + 1, a)), "", result, ""];
  const errors = attempts.flatMap((a) => a.errors);
  if (errors.length > 0) {
    lines.push(`The first RPC errors in the forge logs (${Math.min(errors.length, QUOTED_ERRORS)} of ${errors.length}):`, "");
    lines.push("```text", ...errors.slice(0, QUOTED_ERRORS), "```", "");
  }
  return lines.join("\n");
}

/**
 * Runs the live suites at `block` through `rpc` and decides whose failure a failure is. A failure whose forge log has
 * no RPC error fails the run. A failed attempt whose log has RPC errors is the RPC's failure, not a property's: the
 * suites that failed run once more at the same block and seed, through the first other RPC that serves the block (the
 * same one when none does). The run then passes or fails on that rerun, unless the rerun's log has RPC errors too:
 * that run gives no verdict on the vault, fails, and has no report, so no test is annotated as failed.
 * @param {{ forge: Forge, rpc: string, rpcs: string[], block: bigint, dir: string, timeoutMs?: number }} options
 * @returns {Promise<SuitesResult>}
 */
export async function runSuites({ forge, rpc, rpcs, block, dir, timeoutMs = TIMEOUT_MS }) {
  const first = await attempt(forge, rpc, block, path.join(dir, "live-fork-1.json"), null);
  const firstError = first.errors[0];
  if (first.errors.length === 0) {
    const result =
      first.status === 0
        ? "Result: passed."
        : "Result: failed. The forge log has no RPC error, so the failure is a test's, not the RPC's.";
    return { code: first.status === 0 ? 0 : 1, report: first.report, annotations: [], summary: suitesSummary([first], result) };
  }
  if (first.status === 0) {
    const warning = `the live suites passed, but the forge log has ${rpcErrorCount(first.errors.length)} through ${rpc}: ${firstError}`;
    return {
      code: 0,
      report: first.report,
      annotations: [annotation("warning", warning)],
      summary: suitesSummary([first], "Result: passed, with RPC errors in the log (below)."),
    };
  }
  const failed = first.report ? failedContracts(first.report) : [];
  const contracts = failed.length > 0 ? failed : null;
  const suites = contracts ? contracts.join(", ") : "every live suite";
  let rerunRpc;
  try {
    rerunRpc = (await pickFork({ rpcs: [...rpcs.filter((r) => r !== rpc), rpc], block, timeoutMs })).rpc;
  } catch (error) {
    const message = `no verdict: the live suites failed with ${rpcErrorCount(first.errors.length)} in the forge log, and no RPC can serve block ${block} for a rerun (${error.message})`;
    return {
      code: 1,
      report: null,
      annotations: [annotation("error", message)],
      summary: suitesSummary([first], `Result: ${message}.`),
    };
  }
  const warning = `the live suites failed with ${rpcErrorCount(first.errors.length)} in the forge log through ${rpc} (${firstError}): the RPC failed, not a property. Rerunning ${suites} at block ${block} with the same seed through ${rerunRpc}.`;
  const annotations = [annotation("warning", warning)];
  const second = await attempt(forge, rerunRpc, block, path.join(dir, "live-fork-2.json"), contracts);
  const report = contracts && first.report && second.report ? mergeReports(first.report, second.report) : second.report;
  if (second.status === 0) {
    const result = "Result: passed on the rerun. The first attempt failed with RPC errors in its log, so its failures were the RPC's, not a property's.";
    return { code: 0, report, annotations, summary: suitesSummary([first, second], result) };
  }
  if (second.errors.length === 0) {
    const result = "Result: failed. The rerun failed with no RPC error in its log, so the failure is a test's, not the RPC's.";
    return { code: 1, report, annotations, summary: suitesSummary([first, second], result) };
  }
  const message = `no verdict: both attempts failed with RPC errors in the forge log (${first.errors.length} through ${rpc}, ${second.errors.length} through ${rerunRpc}), so this run says nothing about the vault`;
  annotations.push(annotation("error", message));
  return { code: 1, report: null, annotations, summary: suitesSummary([first, second], `Result: ${message}.`) };
}

/**
 * Runs forge, streaming its stdout and stderr to this process's and keeping a copy for rpcErrors.
 * @param {string[]} command the executable and any arguments before forge's own
 * @param {NodeJS.ProcessEnv} env @returns {Forge}
 */
function spawnForge(command, env) {
  const [file, ...prefix] = command;
  return (args, extra) =>
    new Promise((resolve, reject) => {
      const child = spawn(file, [...prefix, ...args], { env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      for (const [stream, sink] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ]) {
        stream.setEncoding("utf8");
        stream.on("data", (chunk) => {
          sink.write(chunk);
          output += chunk;
        });
      }
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, output }));
    });
}

/**
 * `test <report.json>`, from contracts/: runs the live suites through BASE_RPC_URL at LIVE_FORK_BLOCK (the pick step's
 * outputs), with runSuites deciding on a rerun through the other RPCs of LIVE_FORK_RPCS (DEFAULT_RPCS when unset).
 * Writes the run's forge report to report.json, unless the run gave no verdict, appends the summary to
 * GITHUB_STEP_SUMMARY when it is set, and exits with the run's code. LIVE_FORK_FORGE, a JSON array, replaces the forge
 * command, for tests.
 * @param {string} reportPath @param {NodeJS.ProcessEnv} env @returns {Promise<0 | 1>}
 */
async function testCommand(reportPath, env) {
  if (!env.BASE_RPC_URL) {
    process.stderr.write("BASE_RPC_URL is not set: the pick step gives it\n");
    return 1;
  }
  let block;
  try {
    block = parseBlock(env.LIVE_FORK_BLOCK);
  } catch (error) {
    process.stderr.write(`LIVE_FORK_BLOCK: ${error.message}\n`);
    return 1;
  }
  if (block === null) {
    process.stderr.write("LIVE_FORK_BLOCK is not set: the pick step gives it\n");
    return 1;
  }
  let command = ["forge"];
  if (env.LIVE_FORK_FORGE) {
    command = JSON.parse(env.LIVE_FORK_FORGE);
    if (!Array.isArray(command) || command.length === 0 || !command.every((part) => typeof part === "string")) {
      process.stderr.write("LIVE_FORK_FORGE is not a JSON array of strings\n");
      return 1;
    }
  }
  rmSync(reportPath, { force: true });
  let result;
  try {
    result = await runSuites({
      forge: spawnForge(command, env),
      rpc: env.BASE_RPC_URL,
      rpcs: rpcList(env),
      block,
      dir: path.dirname(path.resolve(reportPath)),
    });
  } catch (error) {
    process.stdout.write(`${errorAnnotation(`could not run forge: ${error.message}`)}\n`);
    return 1;
  }
  for (const line of result.annotations) process.stdout.write(`${line}\n`);
  if (result.report) writeFileSync(reportPath, JSON.stringify(result.report));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, result.summary);
  return result.code;
}

/** @param {NodeJS.ProcessEnv} env @returns {string[]} LIVE_FORK_RPCS, whitespace-separated, or DEFAULT_RPCS */
function rpcList(env) {
  return env.LIVE_FORK_RPCS?.trim() ? env.LIVE_FORK_RPCS.trim().split(/\s+/) : DEFAULT_RPCS;
}

/**
 * `pick`: reads LIVE_FORK_BLOCK_INPUT (the workflow_dispatch input; empty for a scheduled run) and LIVE_FORK_RPCS
 * (whitespace-separated, for tests; DEFAULT_RPCS when unset), then appends `rpc`, `block` and `timestamp` to
 * GITHUB_OUTPUT and the summary to GITHUB_STEP_SUMMARY when it is set. `test`: see testCommand.
 * @param {string[]} argv @param {NodeJS.ProcessEnv} env @returns {Promise<0 | 1>}
 */
export async function main(argv, env) {
  if (argv.length === 2 && argv[0] === "test") return testCommand(argv[1], env);
  if (argv.length !== 1 || argv[0] !== "pick") {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (!env.GITHUB_OUTPUT) {
    process.stderr.write("GITHUB_OUTPUT is not set\n");
    return 1;
  }
  const rpcs = rpcList(env);
  let pick;
  try {
    pick = await pickFork({ rpcs, block: parseBlock(env.LIVE_FORK_BLOCK_INPUT) });
  } catch (error) {
    process.stdout.write(`${errorAnnotation(error.message)}\n`);
    return 1;
  }
  for (const s of pick.skipped) process.stdout.write(`::warning::skipped ${s.rpc}: ${s.reason}\n`);
  process.stdout.write(`block ${pick.block} (${utc(pick.timestamp)}) through ${pick.rpc}\n`);
  appendFileSync(env.GITHUB_OUTPUT, `rpc=${pick.rpc}\nblock=${pick.block}\ntimestamp=${pick.timestamp}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary(pick));
  return 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2), process.env);
