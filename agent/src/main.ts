import { inboxSetup } from "./briefs/inbox.js";
import { loadConfig } from "./config.js";
import { ignoredAnthropicEnv, ignoredAnthropicKey } from "./llm/proposer.js";
import { heartbeatOf, writeHeartbeat } from "./loop/heartbeat.js";
import { acquireLock, RoundLock } from "./loop/lock.js";
import { probeStartup, runProbe, runProbes } from "./loop/probeRound.js";
import { runOnce } from "./loop/runOnce.js";
import { abortableSleep, runForever } from "./loop/scheduler.js";
import { oneLine } from "./redact.js";
import { buildRuntime, startLine } from "./runtime.js";

const args = new Set(process.argv.slice(2));

async function main(): Promise<void> {
  const cfg = loadConfig();
  for (const line of [ignoredAnthropicEnv(), ignoredAnthropicKey()]) if (line) console.warn(line);
  // Lock before building the runtime: a second process must not even open the Store or connect to CDP.
  const release = await acquireLock(cfg.dataDir);
  try {
    // MaatInbox briefs: read only when deployments/README.md records the inbox with its deploy tx.
    const inbox = inboxSetup();
    const deps = await buildRuntime(cfg, { forceDryRun: args.has("--dry-run"), inbox: inbox.record });
    console.log(startLine(cfg, deps));
    console.log(inbox.line);
    if (args.has("--once")) {
      const r = await runOnce(deps);
      console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    } else {
      const ac = new AbortController();
      process.once("SIGINT", () => ac.abort());
      process.once("SIGTERM", () => ac.abort());
      // MAAT_PROBES: a bad entry is reported and left out, never a reason not to start.
      const probes = await probeStartup(cfg.probes, deps, Date.now());
      for (const p of probes.problems) console.warn(`MAAT_PROBES: ${p}`);
      for (const line of probes.lines) console.log(line);
      // Rounds and probes take turns on one lock, so a probe never runs inside a round.
      const lock = new RoundLock();
      await Promise.all([
        runForever({
          run: () => runOnce(deps),
          signal: ac.signal,
          lock,
          // The restart loop (scripts/restart-loop.ts) reads it to tell a live agent from a stuck or sleeping PC.
          afterRound: (r) => writeHeartbeat(cfg.dataDir, heartbeatOf(r, new Date(), process.pid)),
        }),
        // A stop also ends a probe's pause before a retry, and the probe then sends nothing.
        runProbes({ due: probes.due, fire: (at) => runProbe(deps, at, Date.now, abortableSleep, ac.signal), lock, signal: ac.signal }),
      ]);
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
