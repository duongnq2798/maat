// The fork block picker of .github/workflows/live-fork.yml. `pick` asks each keyless public Base RPC in turn for its
// head, takes a block MARGIN blocks behind it (or the block the run was asked for), checks that the node serves that
// block's header and state, and writes the RPC and the block for the forge step. One block per run: every live suite
// forks the same state, and the block is also the fuzz seed, so a failed run can be rerun with the same inputs.
// Zero dependencies: Node 24 built-ins only.
import { appendFileSync } from "node:fs";

/** Keyless public endpoints, in the order they are tried. */
export const DEFAULT_RPCS = ["https://mainnet.base.org", "https://base-rpc.publicnode.com"];
/** How far behind the head the fork sits: 300 blocks, a minute at Base's 200 ms blocks, so every node behind a
 * load balancer has it. */
export const MARGIN = 300;
const TIMEOUT_MS = 15_000;
const USAGE = "usage: node .github/scripts/live-fork.mjs pick (env: GITHUB_OUTPUT, optional LIVE_FORK_BLOCK_INPUT, LIVE_FORK_RPCS, GITHUB_STEP_SUMMARY)";

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

/** @param {string} message @returns {string} one `::error` line with `%`, CR and LF escaped */
function errorAnnotation(message) {
  return `::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;
}

/**
 * `pick`: reads LIVE_FORK_BLOCK_INPUT (the workflow_dispatch input; empty for a scheduled run) and LIVE_FORK_RPCS
 * (whitespace-separated, for tests; DEFAULT_RPCS when unset), then appends `rpc`, `block` and `timestamp` to
 * GITHUB_OUTPUT and the summary to GITHUB_STEP_SUMMARY when it is set.
 * @param {string[]} argv @param {NodeJS.ProcessEnv} env @returns {Promise<0 | 1>}
 */
export async function main(argv, env) {
  if (argv.length !== 1 || argv[0] !== "pick") {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (!env.GITHUB_OUTPUT) {
    process.stderr.write("GITHUB_OUTPUT is not set\n");
    return 1;
  }
  const rpcs = env.LIVE_FORK_RPCS?.trim() ? env.LIVE_FORK_RPCS.trim().split(/\s+/) : DEFAULT_RPCS;
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
