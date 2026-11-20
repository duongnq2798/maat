// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isRangeError, planChunks, scanLogs, type BlockRange } from "@/lib/chain/scan";

const r = (from: number, to: number): BlockRange => ({ from: BigInt(from), to: BigInt(to) });
const span = (x: BlockRange) => Number(x.to - x.from + 1n);

describe("planChunks", () => {
  it("splits newest first, clipping the oldest chunk at `from`", () => {
    expect(planChunks(0n, 120_000n, 50_000n)).toEqual([r(70_001, 120_000), r(20_001, 70_000), r(0, 20_000)]);
  });

  it("returns one chunk for a short range and none for an empty one", () => {
    expect(planChunks(10n, 20n, 50_000n)).toEqual([r(10, 20)]);
    expect(planChunks(21n, 20n, 50_000n)).toEqual([]);
  });
});

describe("isRangeError", () => {
  it.each([
    "exceed maximum block range: 50000",
    "eth_getLogs is limited to a 200 range",
    "ranges over 100 blocks are not supported on free plan",
    "eth_getLogs is limited to 0 - 50 blocks range",
    "You can make eth_getLogs requests with up to a 10 block range",
  ])("recognizes %j", (message) => {
    expect(isRangeError(new Error(message))).toBe(true);
  });

  it("finds the message in viem's details and cause", () => {
    expect(isRangeError({ message: "RPC Request failed.", details: "exceed maximum block range: 50000" })).toBe(true);
    expect(isRangeError({ message: "x", cause: new Error("eth_getLogs is limited to a 200 range") })).toBe(true);
  });

  it("is false for a rate limit or a network error", () => {
    expect(isRangeError(new Error("request limit reached"))).toBe(false);
    expect(isRangeError(new Error("Requests are limited to 25 per second"))).toBe(false);
    expect(isRangeError(new TypeError("Failed to fetch"))).toBe(false);
  });
});

describe("scanLogs", () => {
  it("returns every chunk's logs, newest chunk first, and reports each chunk", async () => {
    const seen: BlockRange[] = [];
    const out = await scanLogs({
      from: 0n,
      to: 120_000n,
      getLogs: async (x) => [`${x.from}-${x.to}`],
      onChunk: (c) => seen.push({ from: c.from, to: c.to }),
      concurrency: 1,
    });
    expect(out.logs).toEqual(["70001-120000", "20001-70000", "0-20000"]);
    expect(out.scanned).toEqual(r(0, 120_000));
    expect(out.failed).toEqual([]);
    expect(seen).toEqual([r(70_001, 120_000), r(20_001, 70_000), r(0, 20_000)]);
  });

  it("halves a chunk on a range error until the RPC accepts it", async () => {
    const calls: BlockRange[] = [];
    const out = await scanLogs({
      from: 0n,
      to: 99_999n,
      getLogs: async (x) => {
        calls.push(x);
        if (span(x) > 25_000) throw new Error("exceed maximum block range: 25000");
        return [span(x)];
      },
    });
    expect(out.logs).toEqual([25_000, 25_000, 25_000, 25_000]);
    expect(out.scanned).toEqual(r(0, 99_999));
    expect(calls.filter((c) => span(c) <= 25_000)).toHaveLength(4);
  });

  it("gives up on a range below the minimum span and reports what it scanned above it", async () => {
    const out = await scanLogs({
      from: 0n,
      to: 119_999n,
      span: 40_000n,
      minSpan: 10_000n,
      concurrency: 1,
      getLogs: async (x) => {
        if (x.from < 40_000n) throw new Error("eth_getLogs is limited to a 200 range");
        return [x.from];
      },
    });
    expect(out.scanned).toEqual(r(40_000, 119_999));
    expect(out.failed.length).toBeGreaterThan(0);
    expect(out.failed.every((f) => f.to < 40_000n)).toBe(true);
  });

  it("retries a non-range error once, then counts the chunk as failed without halving it", async () => {
    const calls: BlockRange[] = [];
    const out = await scanLogs({
      from: 0n,
      to: 49_999n,
      getLogs: async (x) => {
        calls.push(x);
        throw new Error("request limit reached");
      },
    });
    expect(calls).toEqual([r(0, 49_999), r(0, 49_999)]);
    expect(out.failed).toEqual([r(0, 49_999)]);
    expect(out.scanned).toBeNull();
  });

  it("succeeds when the retry succeeds", async () => {
    let n = 0;
    const out = await scanLogs({
      from: 0n,
      to: 9n,
      getLogs: async () => {
        n += 1;
        if (n === 1) throw new Error("request limit reached");
        return ["ok"];
      },
    });
    expect(out.logs).toEqual(["ok"]);
    expect(out.scanned).toEqual(r(0, 9));
  });

  it("never has more calls in flight than its concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    await scanLogs({
      from: 0n,
      to: 499_999n,
      concurrency: 2,
      getLogs: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((res) => setTimeout(res, 2));
        inFlight -= 1;
        return [];
      },
    });
    expect(peak).toBe(2);
  });

  it("keeps the scanned range contiguous from the top when a middle chunk fails", async () => {
    const out = await scanLogs({
      from: 0n,
      to: 149_999n,
      concurrency: 3,
      getLogs: async (x) => {
        if (x.from === 50_000n) throw new TypeError("Failed to fetch");
        return [x.from];
      },
    });
    expect(out.scanned).toEqual(r(100_000, 149_999));
    expect(out.failed).toEqual([r(50_000, 99_999)]);
    // Logs of the chunk below the gap are still returned.
    expect(out.logs).toEqual([100_000n, 0n]);
  });

  it("stops taking chunks once maxFailed chunks have failed, so a dead RPC is not hammered", async () => {
    let calls = 0;
    const out = await scanLogs({
      from: 0n,
      to: 999_999n,
      concurrency: 1,
      maxFailed: 2,
      getLogs: async () => {
        calls += 1;
        throw new TypeError("Failed to fetch");
      },
    });
    expect(out.failed).toHaveLength(2);
    expect(out.stopped).toBe(true);
    expect(calls).toBe(4);
    expect(out.scanned).toBeNull();
  });

  it("is not stopped when it finishes", async () => {
    expect((await scanLogs({ from: 0n, to: 9n, getLogs: async () => [] })).stopped).toBe(false);
  });

  it("stops on abort and makes no new call", async () => {
    const controller = new AbortController();
    let calls = 0;
    const run = scanLogs({
      from: 0n,
      to: 499_999n,
      concurrency: 1,
      signal: controller.signal,
      getLogs: async () => {
        calls += 1;
        if (calls === 2) controller.abort();
        return [];
      },
    });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(2);
  });
});
