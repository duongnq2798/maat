import { InvalidInputRpcError, RpcRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { firstInLogWindows, isRangeError, MAX_LOG_RANGE, MIN_LOG_RANGE, type BlockWindow } from "../src/chain/logWindows.js";

/** mainnet.base.org's refusal of a wider eth_getLogs, as web/lib/chain/scan.ts quotes it. */
const BASE_ORG_RANGE = "eth_getLogs is limited to a 200 range";

/** Every window asked for, finding nothing. */
async function all(from: bigint, to: bigint, size?: bigint): Promise<BlockWindow[]> {
  const seen: BlockWindow[] = [];
  await firstInLogWindows(from, to, async (w) => void seen.push(w), size, size === undefined ? undefined : 1n);
  return seen;
}

/** A reader that refuses any window wider than `cap` blocks with `message`, and finds `hit` in the window holding it. */
function capped(cap: bigint, o: { hit?: bigint; message?: string } = {}) {
  const asked: BlockWindow[] = [];
  const read = async (w: BlockWindow) => {
    asked.push(w);
    if (w.toBlock - w.fromBlock + 1n > cap) throw new Error(o.message ?? BASE_ORG_RANGE);
    return o.hit !== undefined && w.fromBlock <= o.hit && o.hit <= w.toBlock ? o.hit : undefined;
  };
  const sizes = () => asked.map((w) => w.toBlock - w.fromBlock + 1n);
  return { asked, read, sizes };
}

describe("firstInLogWindows", () => {
  it("asks for at most 9,000 blocks, and halves down to mainnet.base.org's 200", () => {
    expect(MAX_LOG_RANGE).toBe(9_000n);
    expect(MIN_LOG_RANGE).toBe(200n);
  });

  it("gives one window when the range fits, bounds inclusive", async () => {
    expect(await all(100n, 100n)).toEqual([{ fromBlock: 100n, toBlock: 100n }]);
    expect(await all(100n, 9_099n)).toEqual([{ fromBlock: 100n, toBlock: 9_099n }]);
  });

  it("starts a new window after exactly 9,000 blocks", async () => {
    expect(await all(100n, 9_100n)).toEqual([
      { fromBlock: 100n, toBlock: 9_099n },
      { fromBlock: 9_100n, toBlock: 9_100n },
    ]);
  });

  it("covers a long range in order, with no gap and no overlap", async () => {
    const w = await all(53_556_127n, 53_600_000n);
    expect(w[0]?.fromBlock).toBe(53_556_127n);
    expect(w.at(-1)?.toBlock).toBe(53_600_000n);
    w.forEach((x, i) => {
      expect(x.toBlock - x.fromBlock + 1n).toBeLessThanOrEqual(MAX_LOG_RANGE);
      if (i > 0) expect(x.fromBlock).toBe(w[i - 1]!.toBlock + 1n);
    });
    expect(w).toHaveLength(5); // 43,874 blocks
  });

  it("takes a smaller size", async () => {
    expect(await all(0n, 4n, 2n)).toEqual([
      { fromBlock: 0n, toBlock: 1n },
      { fromBlock: 2n, toBlock: 3n },
      { fromBlock: 4n, toBlock: 4n },
    ]);
  });

  it("gives nothing for an empty range and refuses a window below one block or under its floor", async () => {
    expect(await all(101n, 100n)).toEqual([]);
    await expect(firstInLogWindows(0n, 10n, async () => undefined, 0n, 0n)).rejects.toThrow(/at least one block/);
    await expect(firstInLogWindows(0n, 10n, async () => undefined, 100n, 200n)).rejects.toThrow(/size >= min/);
  });

  it("stops at the first window that finds the value", async () => {
    const r = capped(MAX_LOG_RANGE, { hit: 9_500n });
    expect(await firstInLogWindows(100n, 40_000n, r.read)).toBe(9_500n);
    expect(r.asked).toEqual([
      { fromBlock: 100n, toBlock: 9_099n },
      { fromBlock: 9_100n, toBlock: 18_099n },
    ]);
  });

  it("halves the window on a range error down to 200 blocks, and keeps 200 for the rest of the range", async () => {
    const r = capped(200n);
    expect(await firstInLogWindows(1_000n, 1_599n, r.read)).toBeUndefined();
    expect(r.sizes()).toEqual([600n, 600n, 600n, 600n, 562n, 281n, 200n, 200n, 200n]);
    expect(r.asked.slice(-3)).toEqual([
      { fromBlock: 1_000n, toBlock: 1_199n },
      { fromBlock: 1_200n, toBlock: 1_399n },
      { fromBlock: 1_400n, toBlock: 1_599n },
    ]);
  });

  it("tries 9,000, 4,500, 2,250, 1,125, 562, 281 and then 200 blocks against a 200-block cap", async () => {
    const r = capped(200n, { hit: 1_150n });
    expect(await firstInLogWindows(1_000n, 50_000n, r.read)).toBe(1_150n);
    expect(r.sizes()).toEqual([9_000n, 4_500n, 2_250n, 1_125n, 562n, 281n, 200n]);
  });

  it("stops halving at the first size the RPC accepts", async () => {
    const r = capped(3_000n);
    await firstInLogWindows(0n, 6_749n, r.read);
    expect(r.sizes()).toEqual([6_750n, 4_500n, 2_250n, 2_250n, 2_250n]);
    expect(r.asked.slice(2)).toEqual([
      { fromBlock: 0n, toBlock: 2_249n },
      { fromBlock: 2_250n, toBlock: 4_499n },
      { fromBlock: 4_500n, toBlock: 6_749n },
    ]);
  });

  it("throws a range error that a 200-block window still gets", async () => {
    const r = capped(100n);
    await expect(firstInLogWindows(0n, 10_000n, r.read)).rejects.toThrow(BASE_ORG_RANGE);
    expect(r.sizes().at(-1)).toBe(200n);
  });

  it("throws any other error at once, without shrinking the window", async () => {
    const asked: BlockWindow[] = [];
    const read = async (w: BlockWindow) => {
      asked.push(w);
      throw new Error("fetch failed");
    };
    await expect(firstInLogWindows(0n, 20_000n, read)).rejects.toThrow("fetch failed");
    expect(asked).toEqual([{ fromBlock: 0n, toBlock: 8_999n }]);
  });
});

describe("isRangeError", () => {
  it("knows mainnet.base.org's and publicnode's range refusals", () => {
    expect(isRangeError(new Error(BASE_ORG_RANGE))).toBe(true);
    expect(isRangeError(new Error("exceed maximum block range: 50000"))).toBe(true);
  });

  it("finds the refusal in a viem error's details and causes", () => {
    const rpc = new RpcRequestError({ body: { method: "eth_getLogs" }, error: { code: -32000, message: BASE_ORG_RANGE }, url: "http://127.0.0.1:1" });
    expect(isRangeError(rpc)).toBe(true);
    expect(isRangeError(new InvalidInputRpcError(rpc))).toBe(true);
    expect(isRangeError(new Error("request failed", { cause: new Error(BASE_ORG_RANGE) }))).toBe(true);
  });

  it("does not take a rate limit or anything else for a range error", () => {
    expect(isRangeError(new Error("limited to 25 per second"))).toBe(false);
    expect(isRangeError(new Error("fetch failed"))).toBe(false);
    expect(isRangeError(BASE_ORG_RANGE)).toBe(false);
    expect(isRangeError(null)).toBe(false);
  });
});
