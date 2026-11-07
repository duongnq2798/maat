import { describe, expect, it } from "vitest";
import type { RunReport } from "../src/loop/runOnce.js";
import { IN_SESSION_MS, nextDelayMs, OFF_SESSION_MS, runForever } from "../src/loop/scheduler.js";

const rep = (marketOpen: boolean | null): RunReport => ({ runId: "r", status: "done", marketOpen, sent: [], skipped: 0, proposals: 0 });

describe("scheduler", () => {
  it("uses 15 min in session and 1 h otherwise", () => {
    expect(nextDelayMs(rep(true))).toBe(IN_SESSION_MS);
    expect(nextDelayMs(rep(false))).toBe(OFF_SESSION_MS);
    expect(nextDelayMs(rep(null))).toBe(OFF_SESSION_MS);
    expect(nextDelayMs(null)).toBe(OFF_SESSION_MS);
    expect(IN_SESSION_MS).toBe(15 * 60_000);
  });

  it("runs rounds back to back, survives a failing round, stops on abort", async () => {
    const ac = new AbortController();
    const delays: number[] = [];
    const outcomes = [rep(true), new Error("boom"), rep(false)];
    let i = 0;
    const runs = await runForever({
      signal: ac.signal,
      run: async () => {
        const o = outcomes[i++];
        if (o instanceof Error) throw o;
        return o!;
      },
      sleep: async (ms) => {
        delays.push(ms);
        if (delays.length === 3) ac.abort();
      },
      log: () => {},
    });
    expect(runs).toBe(3);
    expect(delays).toEqual([IN_SESSION_MS, OFF_SESSION_MS, OFF_SESSION_MS]);
  });

  it("does not start a round after abort", async () => {
    const ac = new AbortController();
    ac.abort();
    let called = false;
    expect(await runForever({ signal: ac.signal, run: async () => ((called = true), rep(true)), sleep: async () => {}, log: () => {} })).toBe(0);
    expect(called).toBe(false);
  });
});
