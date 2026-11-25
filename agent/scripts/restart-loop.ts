// Keeps the agent running on the owner's PC. It starts `npm run agent` in agent/ and, each time the agent exits,
// starts it again after a pause that doubles from 10 s up to 15 min, back to 10 s after a run of at least 10 min.
// Every 5 min it reads the heartbeat the agent writes after each round (src/loop/heartbeat.ts); when the last round
// ended more than 90 min ago it prints a STALE line and, on Windows, shows a notification. Ctrl-C stops both.
//   npm run agent:loop                    (from agent/; the agent reads agent/.env itself)
//   npm run agent:loop -- --dry-run       (arguments after -- go to every `npm run agent`)
// The loop reads only MAAT_DATA_DIR from agent/.env, to find the heartbeat (scripts/heartbeat.ts agentDataDir).
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describeAge, describeHeartbeat, heartbeatAgeMs, readHeartbeat, STALE_AFTER_MS, type Heartbeat } from "../src/loop/heartbeat.js";
import { oneLine } from "../src/redact.js";
import { agentDataDir, AGENT_DIR } from "./heartbeat.js";

export const BACKOFF = { firstMs: 10_000, maxMs: 15 * 60_000, healthyRunMs: 10 * 60_000 } as const;
export const CHECK_EVERY_MS = 5 * 60_000;
/** How long a stopping agent may take to finish its round (a receipt wait is 120 s) before it is killed. */
export const STOP_GRACE_MS = 150_000;

/** The part of a ChildProcess the loop uses, so tests can hand it a fake. */
export interface AgentProcess {
  readonly pid?: number | undefined;
  once(event: "exit", cb: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", cb: (e: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface LoopDeps {
  start: () => AgentProcess;
  /** Resolves after `ms`, or early (without throwing) once `signal` aborts. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
  readHeartbeat: () => Promise<Heartbeat | null>;
  notify: (text: string) => void;
  /** Asks a running agent to stop after its round. On Windows, Ctrl-C already reached it through the console. */
  interrupt: (p: AgentProcess) => void;
  /** Aborted when the loop is to stop (Ctrl-C). */
  signal: AbortSignal;
}

/** The pause before restart number `failures` (1, 2, ...) in a row: 10 s, 20 s, 40 s, ... up to 15 min. */
export function backoffMs(failures: number): number {
  return Math.min(BACKOFF.maxMs, BACKOFF.firstMs * 2 ** Math.max(0, failures - 1));
}

/**
 * Whether the agent looks stuck: its last round ended more than STALE_AFTER_MS ago. A heartbeat from before this
 * start counts from the start, so an old file does not raise an alarm while the new agent runs its first round.
 */
export function staleFor(beat: Heartbeat | null, startedAt: number, now: number): number | null {
  const age = beat ? Math.min(now - startedAt, heartbeatAgeMs(beat, now)) : now - startedAt;
  return age > STALE_AFTER_MS ? age : null;
}

/** Runs the agent until `signal` aborts; returns how many times it started it. */
export async function restartLoop(d: LoopDeps): Promise<number> {
  let starts = 0;
  let failures = 0;
  while (!d.signal.aborted) {
    const startedAt = d.now();
    const child = d.start();
    starts++;
    d.log(`restart-loop: agent started (pid ${child.pid ?? "?"}), start ${starts}`);
    const exited = new Promise<string>((ok) => {
      child.once("exit", (code, signal) => ok(signal ? `signal ${signal}` : `code ${code}`));
      child.once("error", (e) => ok(`error ${oneLine(e)}`));
    });
    const watching = new AbortController();
    const watch = watchHeartbeat(d, startedAt, watching.signal);
    const stop = () => {
      d.interrupt(child);
      void d.sleep(STOP_GRACE_MS, watching.signal).then(() => {
        if (!watching.signal.aborted) child.kill("SIGKILL");
      });
    };
    d.signal.addEventListener("abort", stop, { once: true });
    const how = await exited;
    d.signal.removeEventListener("abort", stop);
    watching.abort();
    await watch;
    const ran = d.now() - startedAt;
    if (d.signal.aborted) {
      d.log(`restart-loop: agent exited (${how}) after ${describeAge(ran)}; stopped`);
      break;
    }
    failures = ran >= BACKOFF.healthyRunMs ? 1 : failures + 1;
    const pause = backoffMs(failures);
    d.log(`restart-loop: agent exited (${how}) after ${describeAge(ran)}; restarting in ${describeAge(pause)}`);
    await d.sleep(pause, d.signal);
  }
  return starts;
}

/** Every CHECK_EVERY_MS until `signal` aborts: one STALE line and one notification per stale stretch. */
async function watchHeartbeat(d: LoopDeps, startedAt: number, signal: AbortSignal): Promise<void> {
  let warned = false;
  while (!signal.aborted) {
    await d.sleep(CHECK_EVERY_MS, signal);
    if (signal.aborted) return;
    let beat: Heartbeat | null = null;
    try {
      beat = await d.readHeartbeat();
    } catch (e) {
      d.log(`restart-loop: heartbeat unreadable: ${oneLine(e)}`);
    }
    const now = d.now();
    const age = staleFor(beat, startedAt, now);
    if (age === null) {
      warned = false;
      continue;
    }
    if (warned) continue;
    warned = true;
    const last = beat ? describeHeartbeat(beat, now) : "no heartbeat yet";
    d.log(`restart-loop: STALE: no round has ended for ${describeAge(age)}; ${last}`);
    d.notify(`Maat agent: no round has ended for ${describeAge(age)}. Check the agent window.`);
  }
}

/** `npm run agent -- <args>` in agent/: through npm's own script when this loop runs under npm, else the npm command. */
export function startAgent(args: readonly string[]): AgentProcess {
  const npmCli = process.env.npm_execpath;
  const opts = { cwd: AGENT_DIR, stdio: "inherit" as const };
  if (npmCli && /\.c?js$/.test(npmCli)) return spawn(process.execPath, [npmCli, "run", "agent", "--", ...args], opts);
  // npm is a .cmd file on Windows, which only a shell can start.
  return spawn("npm", ["run", "agent", "--", ...args], { ...opts, shell: process.platform === "win32" });
}

/** A Windows toast through the PowerShell that ships with Windows; elsewhere the STALE line is the warning. */
export function notify(text: string): void {
  if (process.platform !== "win32") return;
  const quoted = `'${text.replaceAll("'", "''")}'`;
  const script = [
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null",
    "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText01)",
    `$x.GetElementsByTagName('text').Item(0).AppendChild($x.CreateTextNode(${quoted})) > $null`,
    "$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))",
  ].join("; ");
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", windowsHide: true }).once("error", () => {});
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--once")) {
    console.error("restart-loop: --once runs one round and exits; run `npm run agent -- --once` without the loop");
    return 2;
  }
  const dataDir = await agentDataDir();
  const ac = new AbortController();
  process.once("SIGINT", () => ac.abort());
  process.once("SIGTERM", () => ac.abort());
  console.log(`restart-loop: watching ${dataDir} for the heartbeat; Ctrl-C stops the agent and this loop`);
  await restartLoop({
    start: () => startAgent(argv),
    sleep: async (ms, signal) => {
      await delay(ms, undefined, { signal }).catch((e: Error) => {
        if (e.name !== "AbortError") throw e;
      });
    },
    now: Date.now,
    log: console.log,
    readHeartbeat: () => readHeartbeat(dataDir),
    notify,
    interrupt: (p) => {
      if (process.platform !== "win32") p.kill("SIGINT");
    },
    signal: ac.signal,
  });
  return 0;
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
