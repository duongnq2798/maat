import { describe, expect, it } from "vitest";
import type { RunReport } from "../src/loop/runOnce.js";
import { RoundLock } from "../src/loop/lock.js";
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

  it("logs a failed round as one redacted line: no stack, URL, key or secret", async () => {
    const ac = new AbortController();
    const lines: string[] = [];
    const rpc = "https://base-mainnet.example.org/v2/fakeKey0123456789abcdef";
    process.env.MAAT_SCHED_TEST_RPC_URL = rpc;
    try {
      await runForever({
        signal: ac.signal,
        run: async () => {
          const e = new TypeError(`fetch to ${rpc} failed for fakeKey0123456789abcdef\nURL: ${rpc}\nRequest body: {"method":"eth_call"}`);
          throw e;
        },
        sleep: async () => ac.abort(),
        log: (m) => lines.push(m),
      });
    } finally {
      delete process.env.MAAT_SCHED_TEST_RPC_URL;
    }
    expect(lines).toEqual(["round failed: TypeError: fetch to [redacted] failed for [redacted]"]);
  });

  it("logs a halted round's reason on its line", async () => {
    const ac = new AbortController();
    const lines: string[] = [];
    await runForever({
      signal: ac.signal,
      run: async () => ({ ...rep(false), status: "halted", haltReason: "daily tx cap 20 reached" }),
      sleep: async () => ac.abort(),
      log: (m) => lines.push(m),
    });
    expect(lines).toEqual(["round r: halted, sent 0, skipped 0 (daily tx cap 20 reached)"]);
  });

  it("puts the error of the round's run line on its line, so a failed Claude call does not read as a clean round", async () => {
    const lines: string[] = [];
    const errors = [
      'claude: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      "claude: request to https://api.anthropic.com/v1/messages failed for sk-ant-fake-key-in-an-error\nat a stack line",
    ];
    for (const error of errors) {
      const ac = new AbortController();
      await runForever({
        signal: ac.signal,
        run: async () => ({ ...rep(false), error }),
        sleep: async () => ac.abort(),
        log: (m) => lines.push(m),
      });
    }
    const ac = new AbortController();
    await runForever({
      signal: ac.signal,
      run: async () => ({ ...rep(false), status: "halted", haltReason: "daily tx cap 20 reached", error: "invalid proposal JSON: x" }),
      sleep: async () => ac.abort(),
      log: (m) => lines.push(m),
    });
    expect(lines).toEqual([
      'round r: done, sent 0, skipped 0; error: claude: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      "round r: done, sent 0, skipped 0; error: claude: request to [url] failed for [redacted]",
      "round r: halted, sent 0, skipped 0 (daily tx cap 20 reached); error: invalid proposal JSON: x",
    ]);
  });

  it("calls afterRound after every round, failed ones too, and survives its failure", async () => {
    const ac = new AbortController();
    const seen: { status: string | null; error: string | null }[] = [];
    const lines: string[] = [];
    const outcomes = [rep(true), new Error("boom\nat stack line")];
    let i = 0;
    await runForever({
      signal: ac.signal,
      run: async () => {
        const o = outcomes[i++];
        if (o instanceof Error) throw o;
        return o!;
      },
      afterRound: async ({ report, error }) => {
        seen.push({ status: report?.status ?? null, error });
        if (seen.length === 2) throw new Error("disk full");
      },
      sleep: async () => {
        if (i === 2) ac.abort();
      },
      log: (m) => lines.push(m),
    });
    expect(seen).toEqual([
      { status: "done", error: null },
      { status: null, error: "boom" },
    ]);
    expect(lines).toEqual(["round r: done, sent 0, skipped 0", "round failed: boom", "after round: disk full"]);
  });

  it("does not start a round after abort", async () => {
    const ac = new AbortController();
    ac.abort();
    let called = false;
    expect(await runForever({ signal: ac.signal, run: async () => ((called = true), rep(true)), sleep: async () => {}, log: () => {} })).toBe(0);
    expect(called).toBe(false);
  });
});

describe("runForever with a round lock", () => {
  it("takes the lock for each round, so a probe waiting on it runs between rounds, never during one", async () => {
    const ac = new AbortController();
    const lock = new RoundLock();
    const order: string[] = [];
    let probe: Promise<void> | null = null;
    let rounds = 0;
    await runForever({
      signal: ac.signal,
      lock,
      run: async () => {
        order.push(`round ${++rounds} start`);
        if (rounds === 1) probe = lock.run(async () => void order.push("probe"));
        await new Promise((r) => setTimeout(r, 0));
        order.push(`round ${rounds} end`);
        return rep(true);
      },
      sleep: async () => {
        await new Promise((r) => setTimeout(r, 0));
        if (rounds === 2) ac.abort();
      },
      log: () => {},
    });
    await probe;
    expect(order).toEqual(["round 1 start", "round 1 end", "probe", "round 2 start", "round 2 end"]);
  });
});
