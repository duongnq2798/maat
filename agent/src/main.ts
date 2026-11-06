import { loadConfig } from "./config.js";
import { acquireLock } from "./loop/lock.js";
import { runOnce } from "./loop/runOnce.js";
import { runForever } from "./loop/scheduler.js";
import { buildRuntime } from "./runtime.js";

const args = new Set(process.argv.slice(2));
const cfg = loadConfig();
const deps = await buildRuntime(cfg, { forceDryRun: args.has("--dry-run") });
console.log(`maat agent: mode=${deps.mode} vault=${cfg.vault} executor=${cfg.executor} data=${cfg.dataDir}`);
const release = await acquireLock(cfg.dataDir);
try {
  if (args.has("--once")) {
    const r = await runOnce(deps);
    console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } else {
    const ac = new AbortController();
    process.once("SIGINT", () => ac.abort());
    process.once("SIGTERM", () => ac.abort());
    await runForever({ run: () => runOnce(deps), signal: ac.signal });
  }
} finally {
  await release();
}
