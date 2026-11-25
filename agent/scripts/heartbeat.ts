// Says how long ago the agent's last round ended, from the heartbeat file it writes to its data dir after every round.
//   npm run agent:heartbeat                                       (from agent/)
//   npm run agent:heartbeat -- --data-dir ./data-dryrun --max-age-min 90
// The data dir is --data-dir, else MAAT_DATA_DIR from the environment or agent/.env (only that key is read), else
// ./data, relative to agent/. Exit code 0: the last round is at most --max-age-min old (default 90). 1: older.
// 2: no heartbeat yet, an unreadable one, or bad arguments. It reads one file and sends nothing.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { describeHeartbeat, heartbeatAgeMs, HEARTBEAT_FILE, readHeartbeat, STALE_AFTER_MS } from "../src/loop/heartbeat.js";
import { oneLine } from "../src/redact.js";

export const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The agent's data dir as the agent resolves it from agent/: the environment wins over agent/.env, as with --env-file. */
export async function agentDataDir(env: NodeJS.ProcessEnv = process.env, agentDir: string = AGENT_DIR): Promise<string> {
  let fromFile: string | undefined;
  try {
    fromFile = parseEnv(await readFile(join(agentDir, ".env"), "utf8")).MAAT_DATA_DIR;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const dir = env.MAAT_DATA_DIR || fromFile || "./data";
  return resolve(agentDir, dir);
}

export async function main(
  argv: readonly string[],
  o: { now?: () => number; env?: NodeJS.ProcessEnv; agentDir?: string; out?: (s: string) => void; err?: (s: string) => void } = {},
): Promise<number> {
  const out = o.out ?? console.log;
  const err = o.err ?? console.error;
  let values: { "data-dir"?: string; "max-age-min"?: string };
  try {
    ({ values } = parseArgs({ args: [...argv], options: { "data-dir": { type: "string" }, "max-age-min": { type: "string" } } }));
  } catch (e) {
    err(`heartbeat: ${oneLine(e)}`);
    return 2;
  }
  const maxMin = values["max-age-min"] === undefined ? STALE_AFTER_MS / 60_000 : Number(values["max-age-min"]);
  if (!Number.isFinite(maxMin) || maxMin <= 0) {
    err(`heartbeat: --max-age-min must be a positive number of minutes`);
    return 2;
  }
  const agentDir = o.agentDir ?? AGENT_DIR;
  const dir = values["data-dir"] !== undefined ? resolve(agentDir, values["data-dir"]) : await agentDataDir(o.env ?? process.env, agentDir);
  let beat;
  try {
    beat = await readHeartbeat(dir);
  } catch (e) {
    err(`heartbeat: ${join(dir, HEARTBEAT_FILE)} is unreadable: ${oneLine(e)}`);
    return 2;
  }
  if (beat === null) {
    err(`heartbeat: no ${HEARTBEAT_FILE} in ${dir} yet; the agent writes it after its first round`);
    return 2;
  }
  const now = (o.now ?? Date.now)();
  const stale = heartbeatAgeMs(beat, now) > maxMin * 60_000;
  out(`${stale ? "STALE" : "OK"}: ${describeHeartbeat(beat, now)} (limit ${maxMin} min, ${dir})`);
  return stale ? 1 : 0;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = await main(process.argv.slice(2));
