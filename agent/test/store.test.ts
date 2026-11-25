import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../src/ledger/store.js";

const dir = () => mkdtemp(join(tmpdir(), "maat-store-"));

describe("Store", () => {
  it("starts empty", async () => {
    const s = await Store.open(await dir());
    expect(s.unpaidUsd6()).toBe(0n);
    expect(s.dailyComputeUsd6(100n, 500_000n)).toBe(500_000n);
    expect(s.txCount(100n)).toBe(0);
  });

  it("tracks compute, payments and the unpaid bill", async () => {
    const s = await Store.open(await dir());
    s.recordCompute(100n, 300_000n);
    s.recordCompute(100n, 200_000n);
    s.recordCompute(101n, 100_000n);
    expect(s.unpaidUsd6()).toBe(600_000n);
    s.recordPaid(450_000n);
    expect(s.unpaidUsd6()).toBe(150_000n);
    s.recordPaid(1_000_000n);
    expect(s.unpaidUsd6()).toBe(0n);
  });

  it("averages the previous 7 recorded days, excluding today", async () => {
    const s = await Store.open(await dir());
    s.recordCompute(90n, 9_000_000n); // older than 7 days before 100: ignored
    s.recordCompute(95n, 400_000n);
    s.recordCompute(99n, 600_000n);
    s.recordCompute(100n, 5_000_000n); // today: ignored
    expect(s.dailyComputeUsd6(100n, 1n)).toBe(500_000n);
  });

  it("remembers refusal logs per key", async () => {
    const s = await Store.open(await dir());
    s.recordRefusalLog({ day: "2026-11-26", reason: "MARKET_CLOSED:holiday" });
    expect(s.hasLoggedRefusal({ day: "2026-11-26", reason: "MARKET_CLOSED:holiday" })).toBe(true);
    expect(s.hasLoggedRefusal({ day: "2026-11-26", reason: "MARKET_CLOSED:overnight" })).toBe(false);
    expect(s.hasLoggedRefusal({ day: "2026-11-26", reason: "FEED_STALE" })).toBe(false);
    expect(s.hasLoggedRefusal({ day: "2026-11-27", reason: "MARKET_CLOSED:holiday" })).toBe(false);
  });

  it("reads the refusals an older state file keyed by UTC day number", async () => {
    const d = await dir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(d, "state.json"), JSON.stringify({ version: 1, compute: {}, paidUsd6: "0", refusals: { "20763": ["MARKET_CLOSED"] }, txByDay: {}, pending: [] }));
    const s = await Store.open(d);
    expect(s.hasLoggedRefusal({ day: "20763", reason: "MARKET_CLOSED" })).toBe(true);
    expect(s.hasLoggedRefusal({ day: "2026-11-06", reason: "MARKET_CLOSED:overnight" })).toBe(false);
  });

  it("persists across reopen", async () => {
    const d = await dir();
    const s = await Store.open(d);
    s.recordCompute(100n, 123n);
    s.recordTx(100n);
    s.recordRefusalLog({ day: "2026-11-25", reason: "FEED_STALE" });
    await s.save();
    const again = await Store.open(d);
    expect(again.unpaidUsd6()).toBe(123n);
    expect(again.txCount(100n)).toBe(1);
    expect(again.hasLoggedRefusal({ day: "2026-11-25", reason: "FEED_STALE" })).toBe(true);
    expect(JSON.parse(await readFile(join(d, "state.json"), "utf8")).version).toBe(1);
  });

  it("refuses a state file from a future version", async () => {
    const d = await dir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(d, "state.json"), JSON.stringify({ version: 2 }));
    await expect(Store.open(d)).rejects.toThrow(/unsupported state version/);
  });

  it("keeps pending transactions across reopen until cleared", async () => {
    const d = await dir();
    const s = await Store.open(d);
    const id = `0x${"aa".repeat(32)}` as const;
    const refusal = { day: "2026-11-26", reason: "MARKET_CLOSED:holiday" };
    s.addPending({ intentId: id, action: "BUY", amount: "300000", gateKind: "log-refusal", preview: "MARKET_CLOSED", day: "100", block: "5", refusal });
    await s.save();
    const again = await Store.open(d);
    expect(again.pending()).toEqual([{ intentId: id, action: "BUY", amount: "300000", gateKind: "log-refusal", preview: "MARKET_CLOSED", day: "100", block: "5", refusal }]);
    again.setPendingHash(id, `0x${"bb".repeat(32)}`);
    expect(again.pending()[0]?.txHash).toBe(`0x${"bb".repeat(32)}`);
    again.clearPending(id);
    expect(again.pending()).toEqual([]);
  });

  it("opens a state file written before the pending list existed", async () => {
    const d = await dir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(d, "state.json"), JSON.stringify({ version: 1, compute: {}, paidUsd6: "0", refusals: {}, txByDay: {} }));
    expect((await Store.open(d)).pending()).toEqual([]);
  });

  it("remembers what became of each probe across reopen, and counts the ones that ran on a UTC day", async () => {
    const d = await dir();
    const s = await Store.open(d);
    expect(s.probeOutcome("2026-11-27T17:58:00Z")).toBeUndefined();
    expect(s.probesRunOn("2026-11-27")).toBe(0);
    s.recordProbe("2026-11-27T14:00:00Z", "missed");
    s.recordProbe("2026-11-27T15:00:00Z", "capped");
    s.recordProbe("2026-11-27T17:58:00Z", "started");
    s.recordProbe("2026-11-27T17:58:00Z", "sent");
    s.recordProbe("2026-11-27T18:01:00Z", "skipped");
    s.recordProbe("2026-11-28T00:00:00Z", "halted");
    await s.save();
    const again = await Store.open(d);
    expect(again.probeOutcome("2026-11-27T17:58:00Z")).toBe("sent");
    expect(again.probeOutcome("2026-11-27T14:00:00Z")).toBe("missed");
    // A missed or capped probe never ran; a started one may have sent before a crash, so it counts.
    expect(again.probesRunOn("2026-11-27")).toBe(2);
    expect(again.probesRunOn("2026-11-28")).toBe(1);
  });

  it("opens a state file written before probes existed", async () => {
    const d = await dir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(d, "state.json"), JSON.stringify({ version: 1, compute: {}, paidUsd6: "0", refusals: {}, txByDay: {}, pending: [] }));
    const s = await Store.open(d);
    expect(s.probeOutcome("2026-11-27T17:58:00Z")).toBeUndefined();
    expect(s.probesRunOn("2026-11-27")).toBe(0);
  });
});
