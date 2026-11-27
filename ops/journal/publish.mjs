// The journal publisher, started by the owner beside the agent's restart loop. Every 15 minutes it appends the agent's
// new journal rows, projected to the public fields and checked, to the public agent-journal branch, and pushes them
// with the owner's own git login. It never force-pushes. See ops/journal/README.md.
//   node ops/journal/publish.mjs            (from the repository root; Ctrl-C stops it)
//   node ops/journal/publish.mjs --once     (one round, then exit)
// The data folder is --data-dir, else MAAT_DATA_DIR from the environment or agent/.env, else ./data, relative to
// agent/, as the agent finds it. MAAT_HEALTHCHECK_URL, from the environment or agent/.env, is optional: when set, each
// round that pushed or found nothing new ends with one GET to it (lib/healthcheck.mjs). No other key of agent/.env is
// read. Exit code 0: stopped by Ctrl-C, or --once worked. 1: stopped on a condition the owner must look at. 2: bad
// arguments. 3: --once hit a failure that may pass, such as the network.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { PublishRetry, PublishStop } from "./lib/errors.mjs";
import { BRANCH, redact } from "./lib/git.mjs";
import { HEALTHCHECK_ENV, HEALTHCHECK_TIMEOUT_MS, HEALTHY_STATUSES, isHttpUrl, pingHealthcheck } from "./lib/healthcheck.mjs";
import { DEFAULT_REMOTE, publishOnce } from "./lib/publisher.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const AGENT_DIR = join(REPO_ROOT, "agent");
/** The publisher's own checkout of the branch: a folder beside the repository, outside its working tree. */
export const DEFAULT_CHECKOUT = resolve(REPO_ROOT, "..", "maat-agent-journal");
export const INTERVAL_MIN = 15;

export const USAGE = `Usage: node ops/journal/publish.mjs [options]
  --data-dir <dir>      the agent's data folder, relative to agent/ (default: MAAT_DATA_DIR, else ./data)
  --checkout <dir>      the publisher's checkout of the ${BRANCH} branch (default: ${DEFAULT_CHECKOUT})
  --remote <url>        the remote a new checkout pushes to (default: ${DEFAULT_REMOTE})
  --interval-min <n>    minutes between rounds (default: ${INTERVAL_MIN})
  --once                run one round and exit
  --allow-dry-run       publish dry-run rows too (for a rehearsal against a remote of your own, never the public one)
Environment (or agent/.env):
  ${HEALTHCHECK_ENV}  optional; a URL to GET after each round that pushed or found nothing new (never printed)`;

/**
 * The value of `key` in agent/.env, or undefined when the file or the key is missing. Callers ask only for
 * MAAT_DATA_DIR and MAAT_HEALTHCHECK_URL.
 * @param {string} agentDir @param {"MAAT_DATA_DIR" | "MAAT_HEALTHCHECK_URL"} key
 * @returns {string | undefined}
 */
function agentEnvFileValue(agentDir, key) {
  try {
    return parseEnv(readFileSync(join(agentDir, ".env"), "utf8"))[key];
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== "ENOENT") throw e;
    return undefined;
  }
}

/**
 * The agent's data folder as the agent resolves it from agent/: --data-dir, else MAAT_DATA_DIR from the environment,
 * else the MAAT_DATA_DIR line of agent/.env, else ./data.
 * @param {{ flag?: string, env?: Record<string, string | undefined>, agentDir?: string }} o
 */
export function agentDataDir({ flag, env = process.env, agentDir = AGENT_DIR }) {
  if (flag !== undefined) return resolve(agentDir, flag);
  return resolve(agentDir, env.MAAT_DATA_DIR || agentEnvFileValue(agentDir, "MAAT_DATA_DIR") || "./data");
}

/**
 * The healthcheck URL: MAAT_HEALTHCHECK_URL from the environment, else its line of agent/.env, each trimmed first, so a
 * value of only spaces counts as unset; undefined when neither has a value, which means no ping.
 * @param {{ env?: Record<string, string | undefined>, agentDir?: string }} o
 * @returns {string | undefined}
 */
export function healthcheckUrl({ env = process.env, agentDir = AGENT_DIR }) {
  return env[HEALTHCHECK_ENV]?.trim() || agentEnvFileValue(agentDir, HEALTHCHECK_ENV)?.trim() || undefined;
}

/** @param {readonly string[]} argv */
export function parseCli(argv) {
  const { values } = parseArgs({
    args: [...argv],
    strict: true,
    options: {
      "data-dir": { type: "string" },
      checkout: { type: "string" },
      remote: { type: "string" },
      "interval-min": { type: "string" },
      once: { type: "boolean", default: false },
      "allow-dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  const intervalMin = values["interval-min"] === undefined ? INTERVAL_MIN : Number(values["interval-min"]);
  if (!Number.isFinite(intervalMin) || intervalMin <= 0) throw new Error("--interval-min must be a positive number of minutes");
  return {
    dataDir: values["data-dir"],
    checkout: values.checkout === undefined ? DEFAULT_CHECKOUT : resolve(values.checkout),
    remote: values.remote,
    intervalMin,
    once: values.once === true,
    allowDryRun: values["allow-dry-run"] === true,
    help: values.help === true,
  };
}

/** @param {number} ms @param {AbortSignal} signal */
async function sleep(ms, signal) {
  await delay(ms, undefined, { signal }).catch((/** @type {Error} */ e) => {
    if (e.name !== "AbortError") throw e;
  });
}

/**
 * @param {readonly string[]} argv
 * @param {{ publishOnce?: typeof publishOnce, sleep?: typeof sleep, log?: (s: string) => void, err?: (s: string) => void, env?: Record<string, string | undefined>, agentDir?: string, signal?: AbortSignal, fetch?: typeof globalThis.fetch, healthcheckTimeoutMs?: number }} [d]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, d = {}) {
  const log = d.log ?? ((s) => console.log(s));
  const err = d.err ?? ((s) => console.error(s));
  let opts;
  try {
    opts = parseCli(argv);
  } catch (e) {
    err(`journal-publisher: ${e instanceof Error ? e.message : e}`);
    err(USAGE);
    return 2;
  }
  if (opts.help) {
    log(USAGE);
    return 0;
  }
  const signal = d.signal ?? new AbortController().signal;
  const round = d.publishOnce ?? publishOnce;
  const wait = d.sleep ?? sleep;
  const env = d.env ?? process.env;
  const agentDir = d.agentDir ?? AGENT_DIR;
  const journalFile = join(agentDataDir({ flag: opts.dataDir, env, agentDir }), "journal.jsonl");
  const say = (/** @type {string} */ s) => log(`journal-publisher ${new Date().toISOString()} ${s}`);
  const target = opts.remote === undefined ? `the checkout's origin (${DEFAULT_REMOTE} for a new checkout)` : redact(opts.remote);
  say(`publishing ${journalFile} to the ${BRANCH} branch of ${target} through ${opts.checkout}${opts.once ? ", one round" : `, every ${opts.intervalMin} min; Ctrl-C stops it`}`);
  // The URL is never printed: a healthcheck URL is its own token.
  /** @type {string | undefined} */
  let hcUrl;
  try {
    hcUrl = healthcheckUrl({ env, agentDir });
  } catch (e) {
    // agent/.env exists but cannot be read (with --data-dir it was not read before): the ping is optional, so say so
    // with the error's code only and publish without it.
    const code = /** @type {NodeJS.ErrnoException} */ (e)?.code;
    say(`healthcheck: agent/.env could not be read${typeof code === "string" ? ` (${code})` : ""}, so no ping is sent`);
  }
  if (hcUrl !== undefined && !isHttpUrl(hcUrl)) {
    say(`healthcheck: ${HEALTHCHECK_ENV} is set but is not an http or https URL, so no ping is sent`);
    hcUrl = undefined;
  } else if (hcUrl !== undefined) {
    say(`healthcheck: a GET to ${HEALTHCHECK_ENV} after each round that pushes or finds nothing new`);
  }
  for (;;) {
    let healthy = false;
    try {
      const r = await round({ journalFile, checkout: opts.checkout, remote: opts.remote, allowDryRun: opts.allowDryRun });
      say(r.message);
      healthy = HEALTHY_STATUSES.has(r.status);
    } catch (e) {
      if (signal.aborted) return 0;
      if (e instanceof PublishRetry) {
        say(`will try again ${opts.once ? "on the next start" : `in ${opts.intervalMin} min`}: ${e.message}`);
        if (opts.once) return 3;
      } else {
        const why = e instanceof PublishStop ? e.message : `unexpected error: ${redact(e instanceof Error ? e.message : String(e))}`;
        err(`journal-publisher ${new Date().toISOString()} STOPPED: ${why}`);
        err("journal-publisher: it pushes nothing more until you start it again.");
        return 1;
      }
    }
    if (healthy && hcUrl !== undefined) {
      // pingHealthcheck never throws; the catch is a second guard, so a ping can never stop the publisher.
      const failed = await pingHealthcheck(hcUrl, { fetch: d.fetch, timeoutMs: d.healthcheckTimeoutMs ?? HEALTHCHECK_TIMEOUT_MS, signal }).catch(() => "unexpected error");
      if (!signal.aborted) say(failed === null ? "healthcheck ping ok" : `healthcheck ping failed: ${failed}`);
    }
    if (opts.once) return 0;
    await wait(opts.intervalMin * 60_000, signal);
    if (signal.aborted) {
      say("stopped by Ctrl-C");
      return 0;
    }
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  const ac = new AbortController();
  process.once("SIGINT", () => ac.abort());
  process.once("SIGTERM", () => ac.abort());
  process.exitCode = await main(process.argv.slice(2), { signal: ac.signal });
}
