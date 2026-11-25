import { loadConfig } from "./config.js";
import { ignoredAnthropicEnv, ignoredAnthropicKey } from "./llm/proposer.js";
import { heartbeatOf, writeHeartbeat } from "./loop/heartbeat.js";
import { acquireLock } from "./loop/lock.js";
import { runOnce } from "./loop/runOnce.js";
import { runForever } from "./loop/scheduler.js";
import { oneLine } from "./redact.js";
import { buildRuntime } from "./runtime.js";
import { usdc6ToUsd } from "./units.js";

const args = new Set(process.argv.slice(2));
const usd = (usd6: bigint) => `$${usdc6ToUsd(usd6).toFixed(2)}`;

async function main(): Promise<void> {
  const cfg = loadConfig();
  for (const line of [ignoredAnthropicEnv(), ignoredAnthropicKey()]) if (line) console.warn(line);
  // Lock before building the runtime: a second process must not even open the Store or connect to CDP.
  const release = await acquireLock(cfg.dataDir);
  try {
    const deps = await buildRuntime(cfg, { forceDryRun: args.has("--dry-run") });
    const credit = deps.policy?.creditActions ? "on" : "off";
    console.log(
      `maat agent: mode=${deps.mode} vault=${cfg.vault} executor=${cfg.executor} data=${cfg.dataDir} credit=${credit} llm-cap=${usd(deps.maxLlmUsd6PerDay)}/day bill-min=${usd(deps.billMinUsd6)}`,
    );
    if (args.has("--once")) {
      const r = await runOnce(deps);
      console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    } else {
      const ac = new AbortController();
      process.once("SIGINT", () => ac.abort());
      process.once("SIGTERM", () => ac.abort());
      await runForever({
        run: () => runOnce(deps),
        signal: ac.signal,
        // The restart loop (scripts/restart-loop.ts) reads it to tell a live agent from a stuck or sleeping PC.
        afterRound: (r) => writeHeartbeat(cfg.dataDir, heartbeatOf(r, new Date(), process.pid)),
      });
    }
  } finally {
    await release();
  }
}

// One redacted line instead of a stack: the restart loop prints this on every start that fails.
await main().catch((e: unknown) => {
  console.error(`maat agent stopped: ${oneLine(e)}`);
  process.exitCode = 1;
});
