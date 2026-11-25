import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Heartbeat } from "../src/loop/heartbeat.js";
import { BACKOFF, backoffMs, CHECK_EVERY_MS, killTree, main, restartLoop, staleFor, STOP_GRACE_MS, type AgentProcess, type LoopDeps } from "../scripts/restart-loop.js";

const MIN = 60_000;
const flush = () => new Promise<void>((ok) => setImmediate(ok));

/** A stand-in for `npm run agent`: it exits when the test says so. */
class FakeAgent extends EventEmitter implements AgentProcess {
  readonly kills: (NodeJS.Signals | undefined)[] = [];
  constructor(readonly pid: number) {
    super();
  }
  kill(signal?: NodeJS.Signals): boolean {
    this.kills.push(signal);
    return true;
  }
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
  }
}

/** A clock whose sleeps resolve only when the test moves time past them, or when their signal aborts. */
class Clock {
  t = 0;
  private timers: { at: number; fire: () => void }[] = [];
  sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((ok) => {
      if (signal.aborted) return ok();
      const timer = { at: this.t + ms, fire: ok };
      this.timers.push(timer);
      signal.addEventListener("abort", () => ((this.timers = this.timers.filter((x) => x !== timer)), ok()), { once: true });
    });
  /** Moves time forward by `ms`, firing each due sleep in order and letting the loop react to it. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      await flush();
      const next = this.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((x) => x !== next);
      this.t = next.at;
      next.fire();
    }
    this.t = end;
    await flush();
  }
}

function harness(beat: () => Heartbeat | null = () => null, onStart: (c: FakeAgent) => void = () => {}) {
  const clock = new Clock();
  const ac = new AbortController();
  const children: FakeAgent[] = [];
  const lines: string[] = [];
  const notes: string[] = [];
  const interrupted: FakeAgent[] = [];
  const deps: LoopDeps = {
    start: () => {
      const c = new FakeAgent(1000 + children.length);
      children.push(c);
      onStart(c);
      return c;
    },
    sleep: clock.sleep,
    now: () => clock.t,
    log: (l) => lines.push(l),
    readHeartbeat: async () => beat(),
    notify: (n) => notes.push(n),
    interrupt: (p) => interrupted.push(p as FakeAgent),
    forceKill: (p) => p.kill("SIGKILL"),
    signal: ac.signal,
  };
  const done = restartLoop(deps);
  return { clock, ac, children, lines, notes, interrupted, done, last: () => children.at(-1)! };
}

const beatAt = (ms: number): Heartbeat => ({ ts: new Date(ms).toISOString(), pid: 1, status: "done", runId: "r", sent: 0 });

describe("restart loop", () => {
  it("backs off 10 s, 20 s, 40 s ... up to 15 min between quick exits", () => {
    expect(Array.from({ length: 10 }, (_, i) => backoffMs(i + 1) / 1000)).toEqual([10, 20, 40, 80, 160, 320, 640, 900, 900, 900]);
    expect(BACKOFF).toEqual({ firstMs: 10_000, maxMs: 15 * MIN, healthyRunMs: 10 * MIN });
  });

  it("restarts an agent that exits, doubling the pause, and starts over after a run of 10 min", async () => {
    const h = harness();
    await flush();
    for (const ms of [10_000, 20_000, 40_000]) {
      h.last().exit(1);
      await h.clock.advance(ms - 1);
      expect(h.children).toHaveLength(h.lines.filter((l) => l.includes("agent started")).length);
      await h.clock.advance(1);
    }
    expect(h.children).toHaveLength(4);
    await h.clock.advance(10 * MIN); // a healthy run
    h.last().exit(null, "SIGTERM");
    await h.clock.advance(10_000);
    expect(h.children).toHaveLength(5);
    h.ac.abort();
    h.last().exit(0);
    expect(await h.done).toBe(5);
    expect(h.lines.filter((l) => l.includes("restarting in")).map((l) => l.replace(/^.*agent exited /, ""))).toEqual([
      "(code 1) after 0 s; restarting in 10 s",
      "(code 1) after 0 s; restarting in 20 s",
      "(code 1) after 0 s; restarting in 40 s",
      "(signal SIGTERM) after 10 min; restarting in 10 s",
    ]);
    expect(h.lines.at(-1)).toBe("restart-loop: agent exited (code 0) after 0 s; stopped");
  });

  it("treats a failed spawn as an exit and tries again", async () => {
    const h = harness();
    await flush();
    h.last().emit("error", new Error("spawn npm ENOENT\nmore"));
    await h.clock.advance(10_000);
    expect(h.children).toHaveLength(2);
    expect(h.lines).toContain("restart-loop: agent exited (error spawn npm ENOENT) after 0 s; restarting in 10 s");
    h.ac.abort();
    h.last().exit(0);
    await h.done;
  });

  it("on Ctrl-C asks the agent to finish its round, does not restart it, and kills it only after the grace period", async () => {
    const h = harness();
    await flush();
    h.ac.abort();
    await flush();
    expect(h.interrupted).toEqual([h.children[0]]);
    await h.clock.advance(STOP_GRACE_MS - 1);
    expect(h.children[0]!.kills).toEqual([]);
    await h.clock.advance(1);
    expect(h.children[0]!.kills).toEqual(["SIGKILL"]);
    h.last().exit(null, "SIGKILL");
    expect(await h.done).toBe(1);
    expect(h.children).toHaveLength(1);
  });

  it("stops during a pause without starting the agent again", async () => {
    const h = harness();
    await flush();
    h.last().exit(1);
    await h.clock.advance(5_000);
    h.ac.abort();
    expect(await h.done).toBe(1);
  });

  it("warns once per stale stretch when no round has ended for 90 min, and not for a heartbeat older than the start", async () => {
    const old = beatAt(-3 * 60 * MIN); // a file from an earlier run, 3 h before this start
    let beat: Heartbeat | null = old;
    const h = harness(() => beat);
    await flush();
    await h.clock.advance(90 * MIN);
    expect(h.notes).toEqual([]);
    await h.clock.advance(CHECK_EVERY_MS);
    expect(h.notes).toEqual(["Maat agent: no round has ended for 1 h 35 min. Check the agent window."]);
    expect(h.lines.filter((l) => l.includes("STALE"))).toEqual([
      `restart-loop: STALE: no round has ended for 1 h 35 min; last round ended 4 h 35 min ago at ${old.ts}: round r done, sent 0, agent pid 1`,
    ]);
    await h.clock.advance(60 * MIN);
    expect(h.notes).toHaveLength(1);
    beat = beatAt(h.clock.t); // a round ended: the stretch is over
    await h.clock.advance(CHECK_EVERY_MS);
    await h.clock.advance(95 * MIN);
    expect(h.notes).toHaveLength(2);
    h.ac.abort();
    h.last().exit(0);
    await h.done;
  });

  it("alerts when the agent keeps exiting at startup: once after 3 quick exits, once when no round has ended for 90 min", async () => {
    const old = beatAt(-10 * 60 * MIN); // the last round ended 10 h before the loop started
    // Every start fails within a second, as with a config error or a refused data dir.
    const h = harness(() => old, (c) => queueMicrotask(() => c.exit(1)));
    await h.clock.advance(30_000); // starts at 0 s, 10 s and 30 s
    expect(h.children).toHaveLength(3);
    expect(h.notes).toEqual(["Maat agent keeps exiting: 3 starts in a row ended within 10 min (last: code 1). Check the agent window."]);
    expect(h.lines).toContain("restart-loop: FAILING: 3 starts in a row ended within 10 min (last: code 1)");
    await h.clock.advance(90 * MIN - 30_000);
    expect(h.notes).toHaveLength(1);
    await h.clock.advance(CHECK_EVERY_MS); // 95 min after the loop started, across about a dozen starts
    expect(h.children.length).toBeGreaterThan(10);
    expect(h.notes).toEqual([
      "Maat agent keeps exiting: 3 starts in a row ended within 10 min (last: code 1). Check the agent window.",
      "Maat agent: no round has ended for 1 h 35 min. Check the agent window.",
    ]);
    await h.clock.advance(60 * MIN);
    expect(h.notes).toHaveLength(2);
    h.ac.abort();
    await h.done;
  });

  it("alerts on quick exits again only after a run of 10 min has ended the stretch", async () => {
    let quick = true;
    const h = harness(() => null, (c) => quick && queueMicrotask(() => c.exit(1)));
    await h.clock.advance(70_000); // four quick exits: 0 s, 10 s, 30 s, 70 s
    expect(h.children).toHaveLength(4);
    expect(h.notes).toHaveLength(1);
    quick = false;
    await h.clock.advance(80_000); // start 5 (at 150 s) stays up
    expect(h.children).toHaveLength(5);
    await h.clock.advance(10 * MIN);
    quick = true;
    h.last().exit(1); // a healthy run ends: the stretch is over
    await h.clock.advance(10_000 + 20_000); // two quick exits: one short of an alert
    expect(h.notes).toHaveLength(1);
    await h.clock.advance(40_000);
    expect(h.notes).toEqual([
      "Maat agent keeps exiting: 3 starts in a row ended within 10 min (last: code 1). Check the agent window.",
      "Maat agent keeps exiting: 3 starts in a row ended within 10 min (last: code 1). Check the agent window.",
    ]);
    h.ac.abort();
    await h.done;
  });

  it("logs an unreadable heartbeat and counts from the start", async () => {
    const clockless = harness(() => {
      throw new Error("Unexpected end of JSON input");
    });
    await flush();
    await clockless.clock.advance(CHECK_EVERY_MS);
    expect(clockless.lines).toContain("restart-loop: heartbeat unreadable: Unexpected end of JSON input");
    clockless.ac.abort();
    clockless.last().exit(0);
    await clockless.done;
  });

  it("measures staleness from the later of the last round and the loop's start", () => {
    expect(staleFor(null, 0, 90 * MIN)).toBeNull();
    expect(staleFor(null, 0, 90 * MIN + 1)).toBe(90 * MIN + 1);
    expect(staleFor(beatAt(-5 * 60 * MIN), 0, 60 * MIN)).toBeNull();
    expect(staleFor(beatAt(10 * MIN), 0, 101 * MIN)).toBe(91 * MIN);
    expect(staleFor(beatAt(10 * MIN), 0, 99 * MIN)).toBeNull();
  });

  it("restarts a real child process that stands in for the agent", async () => {
    const ac = new AbortController();
    const pauses: number[] = [];
    const lines: string[] = [];
    const untilAborted = (signal: AbortSignal) => new Promise<void>((ok) => (signal.aborted ? ok() : signal.addEventListener("abort", () => ok(), { once: true })));
    const starts = await restartLoop({
      start: () => spawn(process.execPath, ["-e", "process.exit(3)"], { stdio: "ignore" }),
      sleep: (ms, signal) => {
        if (ms === CHECK_EVERY_MS) return untilAborted(signal);
        pauses.push(ms);
        if (pauses.length === 2) ac.abort();
        return Promise.resolve();
      },
      now: Date.now,
      log: (l) => lines.push(l),
      readHeartbeat: async () => null,
      notify: () => {},
      interrupt: () => {},
      forceKill: () => {},
      signal: ac.signal,
    });
    expect(starts).toBe(2);
    expect(pauses).toEqual([10_000, 20_000]);
    expect(lines.filter((l) => l.includes("agent exited (code 3)"))).toHaveLength(2);
  });

  it("force-kills the whole process tree on Windows, where npm's child would outlive a kill of npm", () => {
    const runs: string[][] = [];
    const onError: ((e: Error) => void)[] = [];
    const run = (cmd: string, args: string[]) => (runs.push([cmd, ...args]), { once: (_e: "error", cb: (e: Error) => void) => onError.push(cb) });
    const win = new FakeAgent(4242);
    killTree(win, "win32", run);
    expect(runs).toEqual([["taskkill", "/pid", "4242", "/T", "/F"]]);
    expect(win.kills).toEqual([]);
    onError[0]!(new Error("spawn taskkill ENOENT"));
    expect(win.kills).toEqual(["SIGKILL"]);
    const linux = new FakeAgent(4243);
    killTree(linux, "linux", run);
    expect(runs).toHaveLength(1);
    expect(linux.kills).toEqual(["SIGKILL"]);
  });

  it("refuses --once, which would end after every round", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["--once"])).toBe(2);
      expect(err).toHaveBeenCalledWith(expect.stringMatching(/--once runs one round and exits/));
    } finally {
      err.mockRestore();
    }
  });
});
