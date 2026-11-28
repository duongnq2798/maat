import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_EVERY_MS, restartLoop, STOP_GRACE_MS } from "../scripts/restart-loop.js";
import { acquireLock, RoundLock } from "../src/loop/lock.js";
import type { ProbeReport } from "../src/loop/probeRound.js";
import { runProbes } from "../src/loop/probeRound.js";
import type { RunReport } from "../src/loop/runOnce.js";
import { runForever } from "../src/loop/scheduler.js";

// The data-dir lock (acquireLock) across a restart, with what main.ts runs under it: the rounds and probes that share
// one RoundLock, and the restart loop (scripts/restart-loop.ts) that starts the agent again after it exits.

const AGENT_DIR = join(import.meta.dirname, "..");
const HOLDER = join(import.meta.dirname, "fixtures", "lock-holder.ts");
const lockOf = (d: string) => join(d, "agent.lock");
const untilAborted = (signal: AbortSignal) =>
  new Promise<void>((ok) => (signal.aborted ? ok() : signal.addEventListener("abort", () => ok(), { once: true })));

/** A real process that takes the lock as main.ts does (test/fixtures/lock-holder.ts). */
interface Holder {
  proc: ChildProcess;
  /** "locked" once it holds the lock; "closed" when it exited without it. */
  settled: Promise<"locked" | "closed">;
  closed: Promise<number | null>;
  out: () => string;
  err: () => string;
}

function holder(dir: string): Holder {
  const proc = spawn(process.execPath, ["--import", "tsx", HOLDER, dir], { cwd: AGENT_DIR, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  proc.stdout!.setEncoding("utf8");
  proc.stderr!.setEncoding("utf8");
  proc.stderr!.on("data", (s: string) => (err += s));
  const closed = new Promise<number | null>((ok) => proc.once("close", (code) => ok(code)));
  const settled = new Promise<"locked" | "closed">((ok) => {
    proc.stdout!.on("data", (s: string) => {
      out += s;
      if (out.includes("locked ")) ok("locked");
    });
    void closed.then(() => ok("closed"));
  });
  return { proc, settled, closed, out: () => out, err: () => err };
}

/** Kills `h` without letting it release the lock, as a crash or taskkill /F would, and waits for it to be gone. */
async function kill(h: Holder): Promise<void> {
  h.proc.kill("SIGKILL");
  await h.closed;
}

/** restartLoop on real holders: pauses end at once (or when `gate` says), the heartbeat watch waits for the stop. */
function loopDeps(start: () => ChildProcess, ac: AbortController, gate: () => Promise<unknown> = () => Promise.resolve()) {
  const lines: string[] = [];
  const notes: string[] = [];
  const pauses: number[] = [];
  const deps = {
    start,
    sleep: (ms: number, signal: AbortSignal) => {
      if (ms === CHECK_EVERY_MS || ms === STOP_GRACE_MS) return untilAborted(signal);
      pauses.push(ms);
      return gate().then(() => undefined);
    },
    now: Date.now,
    log: (l: string) => lines.push(l),
    readHeartbeat: async () => null,
    notify: (n: string) => notes.push(n),
    interrupt: (p: { kill(signal?: NodeJS.Signals): boolean }) => void p.kill("SIGKILL"),
    forceKill: () => {},
    signal: ac.signal,
  };
  return { deps, lines, notes, pauses };
}

const report = (n: number): RunReport => ({ runId: `r${n}`, status: "done", marketOpen: true, sent: [], skipped: 0, proposals: 0 });

describe("the lock a restarted agent finds", () => {
  it("is taken over when it names this pid, then rounds and probes take turns under it and a second start is refused", async () => {
    // A restart that hands the new agent its predecessor's pid, as a container restart often does.
    const d = await mkdtemp(join(tmpdir(), "maat-lock-restart-"));
    await writeFile(lockOf(d), `${process.pid} ${hostname()}`);
    const release = await acquireLock(d);
    expect(await readFile(lockOf(d), "utf8")).toBe(`${process.pid} ${hostname()}`);

    // What main.ts runs under the lock: runForever and runProbes on one RoundLock.
    const ac = new AbortController();
    const lock = new RoundLock();
    let inside = 0;
    let most = 0;
    const order: string[] = [];
    const turn = async (name: string) => {
      most = Math.max(most, ++inside);
      order.push(`${name} start`);
      // A second agent starting now, in this process or another one on this host, must not get the lock.
      await expect(acquireLock(d)).rejects.toThrow(`another agent (pid ${process.pid}) is running`);
      order.push(`${name} end`);
      inside--;
    };
    let rounds = 0;
    const due = [Date.now() - 2, Date.now() - 1];
    const [ran, fired] = await Promise.all([
      runForever({
        run: async () => (await turn(`round ${++rounds}`), report(rounds)),
        signal: ac.signal,
        lock,
        sleep: async () => {
          await new Promise((r) => setTimeout(r, 0));
          if (rounds === 3) ac.abort();
        },
        log: () => {},
      }),
      runProbes({
        due,
        fire: async (at) => (await turn(`probe ${due.indexOf(at) + 1}`), { ...report(0), at: String(at), outcome: "sent" } as ProbeReport),
        lock,
        signal: ac.signal,
        log: () => {},
      }),
    ]);
    expect([ran, fired]).toEqual([3, 2]);
    expect(most).toBe(1);
    expect(order.filter((l) => l.endsWith("start"))).toHaveLength(5);
    // Each turn ends before the next one starts.
    for (let i = 0; i < order.length; i += 2) expect(order[i + 1]).toBe(order[i]!.replace(/start$/, "end"));
    expect(existsSync(lockOf(d))).toBe(true);

    await release();
    expect(existsSync(lockOf(d))).toBe(false);
    await (await acquireLock(d))();
  });
});

describe("the lock across restarts by the restart loop", { timeout: 60_000 }, () => {
  it("is taken over by the next start after the agent was killed holding it", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-restart-"));
    const ac = new AbortController();
    const started: Holder[] = [];
    const named: string[] = [];
    const { deps, lines } = loopDeps(() => {
      const h = holder(d);
      started.push(h);
      void h.settled.then(async (s) => {
        named.push(await readFile(lockOf(d), "utf8"));
        if (started.length === 1 && s === "locked") await kill(h);
        else ac.abort();
      });
      return h.proc;
    }, ac);

    expect(await restartLoop(deps)).toBe(2);
    const [first, second] = started as [Holder, Holder];
    expect(await first.settled).toBe("locked");
    expect(await second.settled).toBe("locked");
    expect(second.err()).toBe("");
    expect(named).toEqual([`${first.proc.pid} ${hostname()}`, `${second.proc.pid} ${hostname()}`]);
    expect(lines[1]).toMatch(/^restart-loop: agent exited \(signal SIGKILL\) after \d+ s; restarting in 10 s$/);
  });

  it("is refused at a start while the last agent still runs, and taken over at the first start after it has gone", async () => {
    // On Windows a kill of `npm run agent` alone can leave the agent under it running and holding the lock.
    const d = await mkdtemp(join(tmpdir(), "maat-lock-restart-"));
    const orphan = holder(d);
    expect(await orphan.settled).toBe("locked");
    const ac = new AbortController();
    const started: Holder[] = [];
    let heldBy = "";
    let gate: Promise<unknown> = Promise.resolve();
    const { deps, lines } = loopDeps(
      () => {
        const h = holder(d);
        started.push(h);
        if (started.length === 1) {
          // The pause after the refused start lasts until the orphan has gone.
          gate = h.closed.then(async () => {
            heldBy = await readFile(lockOf(d), "utf8");
            await kill(orphan);
          });
        } else void h.settled.then(() => ac.abort());
        return h.proc;
      },
      ac,
      () => gate,
    );

    expect(await restartLoop(deps)).toBe(2);
    const [refused, next] = started as [Holder, Holder];
    expect(await refused.settled).toBe("closed");
    expect(await refused.closed).toBe(1);
    expect(refused.err()).toContain(`maat agent stopped: another agent (pid ${orphan.proc.pid}) is running; lock `);
    expect(heldBy).toBe(`${orphan.proc.pid} ${hostname()}`);
    expect(lines[1]).toMatch(/^restart-loop: agent exited \(code 1\) after \d+ s; restarting in 10 s$/);
    expect(await next.settled).toBe("locked");
    expect(await readFile(lockOf(d), "utf8")).toBe(`${next.proc.pid} ${hostname()}`);
  });

  it("is refused at every start when another host wrote it, and the loop says FAILING after three", async () => {
    // A second container on the same volume, or a crashed one replaced under another host name.
    const d = await mkdtemp(join(tmpdir(), "maat-lock-restart-"));
    await writeFile(lockOf(d), "7 maat-vps-2");
    const ac = new AbortController();
    const started: Holder[] = [];
    const { deps, lines, notes, pauses } = loopDeps(
      () => {
        const h = holder(d);
        started.push(h);
        return h.proc;
      },
      ac,
      async () => {
        if (pauses.length === 3) ac.abort();
      },
    );

    expect(await restartLoop(deps)).toBe(3);
    for (const h of started) {
      expect(await h.closed).toBe(1);
      expect(h.err()).toContain("maat agent stopped: another agent (pid 7 on maat-vps-2) may be running; delete ");
      expect(h.err()).toContain("if no other container uses this data dir");
    }
    expect(pauses).toEqual([10_000, 20_000, 40_000]);
    expect(lines.filter((l) => l.startsWith("restart-loop: FAILING: 3 starts in a row ended within 10 min"))).toHaveLength(1);
    expect(notes).toHaveLength(1);
    expect(await readFile(lockOf(d), "utf8")).toBe("7 maat-vps-2");
  });
});
