// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { FeedUpdate, Swap } from "@/lib/gap/decode";
import { BUCKET_SEC, findFreeze, hoursBetween, LOOKBACK_SEC, measureToken, moveBps, poolPrice8, type WindowSpan } from "@/lib/gap/measure";
import { premiumBps } from "@/lib/live/price";

const CLOSE = 1_000_000;
const OPEN = CLOSE + 63.5 * 3600;
const W: WindowSpan = { closeTs: CLOSE, openTs: OPEN, fromBlock: 100, toBlock: 200 };
const H = 3600;

const upd = (block: number, logIndex: number, ts: number, whole: number): FeedUpdate => ({
  block,
  logIndex,
  ts,
  answer: BigInt(whole) * 100_000_000n,
  tx: `0xu${block}-${logIndex}`,
  address: "0xfeed",
});

const isqrt = (n: bigint): bigint => {
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};
/** A sqrt price at which the pool (USDC token0, stock token1) reads about `price8`. */
const sqrtFor = (price8: bigint): bigint => isqrt(((1n << 192n) * 10n ** 10n) / price8);

const swap = (block: number, logIndex: number, ts: number, price8 = 100n * 100_000_000n): Swap => ({
  block,
  logIndex,
  ts,
  sqrtPriceX96: sqrtFor(price8),
  tx: `0xs${block}-${logIndex}`,
});

const P100 = 100n * 100_000_000n;

describe("pure helpers", () => {
  it("poolPrice8 reads a sqrt price near the intended price", () => {
    const p = poolPrice8(swap(1, 0, 0, P100));
    expect(premiumBps(p, P100)).toBe(0n);
  });
  it("hoursBetween rounds to two decimals", () => {
    expect(hoursBetween(0, 49.4 * H)).toBe(49.4);
    expect(hoursBetween(0, 1)).toBe(0);
  });
  it("moveBps truncates toward zero", () => {
    expect(moveBps(101n, 103n)).toBe(198);
    expect(moveBps(103n, 101n)).toBe(-194);
  });
});

describe("measureToken", () => {
  it("1. worked shape", () => {
    const updates = [upd(90, 0, CLOSE - 3 * H, 100), upd(110, 0, CLOSE + 2.6 * H, 101), upd(190, 0, CLOSE + 52 * H, 103)];
    const f = measureToken({ window: W, updates, swaps: [] });
    expect(f.feedLive).toBe(true);
    expect(f.freeze!.from).toBe(updates[1]);
    expect(f.freeze!.to).toBe(updates[2]);
    expect(f.freeze!.hours).toBe(49.4);
    expect(f.freeze!.returnMoveBps).toBe(198);
  });

  it("2. orders by block then log index", () => {
    const updates = [upd(110, 5, CLOSE + 2 * H, 100), upd(150, 10, CLOSE + 30 * H, 101)];
    const swaps = [
      swap(150, 11, CLOSE + 30 * H), // after the end update: not frozen
      swap(150, 9, CLOSE + 30 * H), // before it: frozen
      swap(110, 6, CLOSE + 2 * H), // after the start update: frozen
      swap(110, 4, CLOSE + 2 * H), // before the start update: not frozen
      swap(110, 5, CLOSE + 2 * H), // the update's own position: not strictly after
    ];
    const f = measureToken({ window: W, updates, swaps });
    expect(f.swapsWhileFrozen).toBe(2);
    expect(f.swapsInWindow).toBe(5);
  });

  it("3. freeze longer than the window", () => {
    const updates = [upd(90, 0, CLOSE - 10 * H, 100), upd(250, 0, OPEN + 5 * H, 101)];
    const swaps = [swap(95, 0, CLOSE - H), swap(150, 0, CLOSE + 5 * H), swap(210, 0, OPEN + H), swap(260, 0, OPEN + 6 * H)];
    const f = measureToken({ window: W, updates, swaps });
    expect(f.freeze!.hours).toBe(78.5);
    expect(f.swapsWhileFrozen).toBe(3);
    expect(f.swapsInWindow).toBe(1);
  });

  it("4. no swaps", () => {
    const f = measureToken({ window: W, updates: [upd(90, 0, CLOSE - H, 100), upd(190, 0, CLOSE + 50 * H, 101)], swaps: [] });
    expect(f.swapsInWindow).toBe(0);
    expect(f.swapsWhileFrozen).toBe(0);
    expect(f.largestGap).toBeNull();
    expect(f.series.pool).toEqual([]);
  });

  it("5. feed not live", () => {
    const f = measureToken({
      window: W,
      updates: [upd(10, 0, CLOSE - 8 * 86_400, 100)],
      swaps: [swap(150, 0, CLOSE + H), swap(151, 0, CLOSE + 2 * H)],
    });
    expect(f.feedLive).toBe(false);
    expect(f.freeze).toBeNull();
    expect(f.swapsWhileFrozen).toBeNull();
    expect(f.largestGap).toBeNull();
    expect(f.swapsInWindow).toBe(2);
    expect(LOOKBACK_SEC).toBe(7 * 86_400);
  });

  it("6. the sign", () => {
    const updates = [upd(105, 0, CLOSE + H, 100), upd(190, 0, CLOSE + 50 * H, 101)];
    const s = swap(150, 0, CLOSE + 10 * H);
    const p = poolPrice8(s);
    const below = measureToken({ window: W, updates: [{ ...updates[0]!, answer: p * 2n }, updates[1]!], swaps: [s] });
    expect(below.largestGap!.above).toBe(false);
    expect(below.largestGap!.bps).toBe(5000);
    const equal = measureToken({ window: W, updates: [{ ...updates[0]!, answer: p }, updates[1]!], swaps: [s] });
    expect(equal.largestGap!.bps).toBe(0);
    expect(equal.largestGap!.above).toBe(true);
    expect(equal.largestGap!.pool8).toBe(p);
    expect(equal.largestGap!.held8).toBe(p);
  });

  it("7. rounding down", () => {
    const s = swap(150, 0, CLOSE + 10 * H);
    const p = poolPrice8(s);
    const held = (p * 100_000n) / 100_015n; // true ratio about 1.5 bps
    const truth = Number(p - held) / Number(held) * 10_000;
    expect(truth).toBeGreaterThan(1);
    expect(truth).toBeLessThan(2);
    const f = measureToken({
      window: W,
      updates: [{ ...upd(105, 0, CLOSE + H, 1), answer: held }, upd(190, 0, CLOSE + 50 * H, 101)],
      swaps: [s],
    });
    expect(f.largestGap!.bps).toBe(1);
  });

  it("8. bucket boundary and last-in-bucket", () => {
    const a = swap(120, 0, CLOSE + 1799, 100n * 100_000_000n);
    const b = swap(121, 0, CLOSE + 1800, 101n * 100_000_000n);
    const c = swap(122, 3, CLOSE + 1801, 102n * 100_000_000n);
    const d = swap(122, 2, CLOSE + 1802, 103n * 100_000_000n);
    const f = measureToken({ window: W, updates: [], swaps: [d, c, b, a] });
    expect(BUCKET_SEC).toBe(1800);
    expect(f.series.pool).toEqual([
      [a.ts, poolPrice8(a)],
      [c.ts, poolPrice8(c)], // c is later than d by log index
    ]);
  });

  it("9. feed series", () => {
    const before = upd(90, 0, CLOSE - 3 * H, 100);
    const inside = upd(120, 0, CLOSE + 1000, 101);
    const after = upd(300, 0, CLOSE + 70 * H, 102);
    const f = measureToken({ window: W, updates: [after, inside, before], swaps: [] });
    expect(f.series.feed).toEqual([
      [CLOSE, before.answer],
      [inside.ts, inside.answer],
    ]);
  });

  it("10. ties for the largest gap go to the first swap", () => {
    const updates = [upd(105, 0, CLOSE + H, 90), upd(190, 0, CLOSE + 50 * H, 101)];
    const first = swap(130, 1, CLOSE + 5 * H);
    const second = swap(130, 2, CLOSE + 6 * H);
    const f = measureToken({ window: W, updates, swaps: [second, first] });
    expect(f.largestGap!.logIndex).toBe(1);
  });

  it("a single update gives no freeze", () => {
    const f = measureToken({ window: W, updates: [upd(90, 0, CLOSE - H, 100)], swaps: [swap(150, 0, CLOSE + H)] });
    expect(f.feedLive).toBe(true);
    expect(f.freeze).toBeNull();
    expect(f.swapsWhileFrozen).toBeNull();
    expect(f.largestGap).toBeNull();
    expect(f.series.feed).toEqual([[CLOSE, upd(90, 0, 0, 100).answer]]);
  });

  it("a non-positive held answer throws", () => {
    const bad = { ...upd(105, 0, CLOSE + H, 1), answer: 0n };
    expect(() => findFreeze([bad, upd(190, 0, CLOSE + 50 * H, 1)], W)).toThrow();
  });

  it("the first of two equal freezes wins", () => {
    const u = [upd(10, 0, CLOSE - H, 1), upd(20, 0, CLOSE + H, 2), upd(30, 0, CLOSE + 3 * H, 3)];
    expect(findFreeze(u, W)!.from).toBe(u[0]);
  });
});
