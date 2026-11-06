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

  it("remembers refusal logs per day and reason", async () => {
    const s = await Store.open(await dir());
    s.recordRefusalLog(100n, "MARKET_CLOSED");
    expect(s.hasLoggedRefusal(100n, "MARKET_CLOSED")).toBe(true);
    expect(s.hasLoggedRefusal(100n, "FEED_STALE")).toBe(false);
    expect(s.hasLoggedRefusal(101n, "MARKET_CLOSED")).toBe(false);
  });

  it("persists across reopen", async () => {
    const d = await dir();
    const s = await Store.open(d);
    s.recordCompute(100n, 123n);
    s.recordTx(100n);
    s.recordRefusalLog(100n, "FEED_STALE");
    await s.save();
    const again = await Store.open(d);
    expect(again.unpaidUsd6()).toBe(123n);
    expect(again.txCount(100n)).toBe(1);
    expect(again.hasLoggedRefusal(100n, "FEED_STALE")).toBe(true);
    expect(JSON.parse(await readFile(join(d, "state.json"), "utf8")).version).toBe(1);
  });

  it("refuses a state file from a future version", async () => {
    const d = await dir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(d, "state.json"), JSON.stringify({ version: 2 }));
    await expect(Store.open(d)).rejects.toThrow(/unsupported state version/);
  });
});
