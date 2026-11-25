import { B20_DECIMALS, USDC_DECIMALS } from "@/content/b20-nav";
import { premiumBps, priceFromSqrt } from "@/lib/live/price";
import { before, byPosition, type FeedUpdate, type Swap } from "./decode";

export const BUCKET_SEC = 1800;
export const LOOKBACK_SEC = 7 * 86_400;

export interface WindowSpan {
  closeTs: number;
  openTs: number;
  fromBlock: number;
  toBlock: number;
}
export interface Freeze {
  from: FeedUpdate;
  to: FeedUpdate;
  hours: number;
  returnMoveBps: number;
}
export interface Gap {
  bps: number;
  above: boolean;
  block: number;
  logIndex: number;
  ts: number;
  tx: string;
  pool8: bigint;
  held8: bigint;
}
export interface TokenFigures {
  feedLive: boolean;
  freeze: Freeze | null;
  swapsInWindow: number;
  swapsWhileFrozen: number | null;
  largestGap: Gap | null;
  series: { pool: [number, bigint][]; feed: [number, bigint][] };
}

/** In every pool token0 is USDC (6 decimals) and token1 the stock (8), so the stock is not token0. */
export const poolPrice8 = (s: Swap): bigint => priceFromSqrt(s.sqrtPriceX96, false, B20_DECIMALS, USDC_DECIMALS);
export const hoursBetween = (fromTs: number, toTs: number): number => Math.round((toTs - fromTs) / 36) / 100;
/** Signed bps, truncated toward zero as Solidity's int division truncates. */
export const moveBps = (held: bigint, next: bigint): number => Number(((next - held) * 10_000n) / held);

export function feedLiveIn(updates: readonly FeedUpdate[], w: { closeTs: number; openTs: number }): boolean {
  return updates.some((u) => u.ts >= w.closeTs - LOOKBACK_SEC && u.ts < w.openTs);
}

/** The longest interval between two consecutive updates that overlaps [closeTs, openTs); the first wins a tie. */
export function findFreeze(updates: readonly FeedUpdate[], w: { closeTs: number; openTs: number }): Freeze | null {
  const sorted = [...updates].sort(byPosition);
  let best: [FeedUpdate, FeedUpdate] | null = null;
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (a.ts >= w.openTs || b.ts <= w.closeTs) continue;
    if (!best || b.ts - a.ts > best[1].ts - best[0].ts) best = [a, b];
  }
  if (!best) return null;
  const [from, to] = best;
  if (from.answer <= 0n) throw new Error(`non-positive held answer at block ${from.block}`);
  return { from, to, hours: hoursBetween(from.ts, to.ts), returnMoveBps: moveBps(from.answer, to.answer) };
}

export function measureToken(input: { window: WindowSpan; updates: readonly FeedUpdate[]; swaps: readonly Swap[] }): TokenFigures {
  const w = input.window;
  const updates = [...input.updates].sort(byPosition);
  const swaps = [...input.swaps].sort(byPosition);
  const inWindow = swaps.filter((s) => s.block >= w.fromBlock && s.block <= w.toBlock);
  const feedLive = feedLiveIn(updates, w);
  const freeze = feedLive ? findFreeze(updates, w) : null;

  let swapsWhileFrozen: number | null = null;
  let largestGap: Gap | null = null;
  if (freeze) {
    const held8 = freeze.from.answer;
    const frozen = swaps.filter((s) => before(freeze.from, s) && before(s, freeze.to));
    swapsWhileFrozen = frozen.length;
    for (const s of frozen) {
      const pool8 = poolPrice8(s);
      const bps = Number(premiumBps(pool8, held8));
      if (!largestGap || bps > largestGap.bps) {
        largestGap = { bps, above: pool8 >= held8, block: s.block, logIndex: s.logIndex, ts: s.ts, tx: s.tx, pool8, held8 };
      }
    }
  }

  const lastInBucket = new Map<number, Swap>();
  for (const s of inWindow) lastInBucket.set(Math.floor((s.ts - w.closeTs) / BUCKET_SEC), s);
  const pool = [...lastInBucket.values()].map((s): [number, bigint] => [s.ts, poolPrice8(s)]);

  const feed: [number, bigint][] = [];
  const inForce = updates.filter((u) => u.block < w.fromBlock).at(-1);
  if (feedLive && inForce) feed.push([w.closeTs, inForce.answer]);
  for (const u of updates) if (u.block >= w.fromBlock && u.block <= w.toBlock) feed.push([u.ts, u.answer]);

  return { feedLive, freeze, swapsInWindow: inWindow.length, swapsWhileFrozen, largestGap, series: { pool, feed } };
}
