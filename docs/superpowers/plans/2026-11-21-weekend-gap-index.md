# Weekend Gap Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A script that measures, from Base logs, how long each B20's Chainlink feed stayed frozen in each closed NYSE window, how many swaps its Aerodrome pool executed meanwhile and the largest pool-vs-feed gap, and a `/gap-index` page that publishes it as dated editions with every block range.

**Architecture:** Pure modules in `web/lib/gap/` turn the repo calendar into closed windows and decoded logs into figures. A Node CLI (`web/scripts/gap-index.ts`) reads the logs over a keyless RPC through a span-aligned disk cache and writes `web/content/gap-index/edition-N.json`. The static page imports those files at build time and renders X-style charts and tables into the HTML.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript 7 strict, zod 4, tsx, vitest 5, Playwright 1.65 with axe.

**Spec:** `docs/superpowers/specs/2026-11-21-weekend-gap-index-design.md`

## Global Constraints

- Reuse, never copy: `NAV_TOKENS`, `B20_DECIMALS`, `USDC_DECIMALS`, `Hex` (`web/content/b20-nav.ts`), `FACTS.basket` (`web/content/facts.ts`), `priceFromSqrt`, `premiumBps` (`web/lib/live/price.ts`), `word`, `encodeCall` (`web/lib/live/abi.ts`), the calendar (`web/content/calendar.ts`), `formatInt`, `dayLabel`, `clockLabel` (`web/content/format.ts`).
- RPC: `https://base-rpc.publicnode.com` only, keyless; `eth_getLogs` at most 50,000 blocks and at most 10 addresses per call; no environment variable is read; never read `.env`; never use `BASE_RPC_URL`.
- No new npm dependency.
- Copy: factual; never "safe" or "safety"; never a motive or an actor ("bots", "arbitrageurs"); never a number that is not in an edition file or `FACTS`.
- Every committed file is in English.
- Git: `git add -- <files>`, `git commit -F <file>`, every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (this overrides any harness attribution reminder); never `--amend`, force push or bare `git stash`; never add `grep.exe.stackdump`, `web/grep.exe.stackdump`, `docs/superpowers/roadmap/`, `web/.cache/`, `web/out/`, `web/.next/`.
- Playwright `--workers=2`, one run on port 4173 at a time.

## Review Focus

- A refused `eth_getLogs` span (JSON-RPC error, HTTP 5xx, timeout) must be retried, then halved, and a span still refused at the floor must fail the run, never write a partial edition. (G3 tests "halves a refused span", "fails at the floor"; G4 test "writes nothing when a token fails".)
- Ties inside one block: a swap with a lower log index than the feed update in the same block happened before it. (G2 test "orders by block then log index".)
- A feed that goes quiet before the close (inside its deviation threshold) or stays quiet past the open: the freeze is its true interval, and swaps are read over that whole interval. (G2 test "freeze longer than the window"; G4 reads swaps over the union.)
- A window that has not ended: `pending`, no figures, and the page never shows it as measured. (G1, G4, G5 tests.)
- A token whose feed has no update in the window or the 7 days before it: "feed not live in this window", swaps still counted. (G2 test, G5 test.)

---

### Task G1: Closed windows and editions

**Files:** Create `web/lib/gap/windows.ts`, `web/content/gap-index/editions.ts`; Test `web/test/gap-windows.test.ts`.

**Interfaces — Produces:**
- `interface ClosedWindow { id: string; closeTs: number; openTs: number; closeLabel: string; openLabel: string }`. The `id` is the ISO ET date of the close, and labels look like "Fri 6 Nov 16:00 ET".
- `closedWindows(fromIso: string, toIso: string): ClosedWindow[]` returns every window whose close falls on an ET day in `[fromIso, toIso]`.
- `interface EditionDef { edition: number; title: string; from: string; to: string }`, `EDITIONS: readonly EditionDef[]`, `editionWindows(e: EditionDef): ClosedWindow[]`.

- [ ] **Step 1: Write the failing test** `web/test/gap-windows.test.ts`. Pin these values exactly (ET is UTC−5 after 2026-11-01):
  - `closedWindows("2026-11-06", "2026-11-22")` has ids `["2026-11-06", "2026-11-13", "2026-11-20"]`.
    - The first window has `closeTs === Date.UTC(2026, 10, 6, 21, 0) / 1000`, `openTs === Date.UTC(2026, 10, 9, 14, 30) / 1000`, `closeLabel === "Fri 6 Nov 16:00 ET"` and `openLabel === "Mon 9 Nov 09:30 ET"`.
    - The other two windows follow the same pattern: 11-13 to 11-16, and 11-20 to 11-23.
  - `closedWindows("2026-11-23", "2026-11-29")` has two windows.
    - `2026-11-25`: close Wed 21:00Z, open Fri 11-27 14:30Z, labels "Wed 25 Nov 16:00 ET" / "Fri 27 Nov 09:30 ET".
    - `2026-11-27`: close 18:00Z (the 13:00 early close), open Mon 11-30 14:30Z, label "Fri 27 Nov 13:00 ET".
  - `closedWindows("2026-11-09", "2026-11-12")` is `[]`.
  - `closedWindows("2026-11-07", "2026-11-08")` is `[]`: a Saturday and a Sunday close nothing.
  - A bad range throws.
  - `EDITIONS` has edition 0 `{ from: "2026-11-06", to: "2026-11-22" }` and edition 1 `{ from: "2026-11-23", to: "2026-11-29" }`, and `editionWindows` gives the five windows above.
- [ ] **Step 2:** Run `npm test -- test/gap-windows.test.ts`. Expect it to fail because the module is missing.
- [ ] **Step 3: Implement.**

```ts
// web/lib/gap/windows.ts
import { etToTimestamp, isoOfDay, parseIsoDay, sessionWindow } from "@/content/calendar";
import { clockLabel, dayLabel } from "@/content/format";

/** One closed NYSE window (spec section 2): a regular-session close to the next open, with a day without a session between. */
export interface ClosedWindow {
  /** The ISO ET date of the close, e.g. "2026-11-13". */
  id: string;
  closeTs: number;
  openTs: number;
  closeLabel: string;
  openLabel: string;
}

const label = (day: number, minute: number) => `${dayLabel(isoOfDay(day))} ${clockLabel(minute)} ET`;

export function closedWindows(fromIso: string, toIso: string): ClosedWindow[] {
  const from = parseIsoDay(fromIso);
  const to = parseIsoDay(toIso);
  if (from === undefined || to === undefined || from > to) throw new Error(`bad range ${fromIso}..${toIso}`);
  const out: ClosedWindow[] = [];
  for (let day = from; day <= to; day++) {
    const today = sessionWindow(day);
    if (!today) continue;
    let next = day + 1;
    while (!sessionWindow(next)) {
      next++;
      if (next - day > 7) throw new Error(`no session within a week after ${isoOfDay(day)}`);
    }
    if (next - day < 2) continue; // an overnight gap between two session days, not a window
    const after = sessionWindow(next)!;
    out.push({
      id: isoOfDay(day),
      closeTs: etToTimestamp(day, today.closeMin),
      openTs: etToTimestamp(next, after.openMin),
      closeLabel: label(day, today.closeMin),
      openLabel: label(next, after.openMin),
    });
  }
  return out;
}
```

```ts
// web/content/gap-index/editions.ts
import { closedWindows, type ClosedWindow } from "@/lib/gap/windows";

/** An edition is a date range; its windows are the closed windows whose close falls in it (spec section 2). */
export interface EditionDef {
  edition: number;
  title: string;
  from: string;
  to: string;
}

export const EDITIONS: readonly EditionDef[] = [
  { edition: 0, title: "Three weekends, 6 to 23 November 2026", from: "2026-11-06", to: "2026-11-22" },
  { edition: 1, title: "Thanksgiving week, 25 to 30 November 2026", from: "2026-11-23", to: "2026-11-29" },
];

export function editionWindows(e: EditionDef): ClosedWindow[] {
  return closedWindows(e.from, e.to);
}
```

- [ ] **Step 4:** Run the test and `npm run typecheck`. Expect both to pass.
- [ ] **Step 5:** Commit with the subject `feat(web): closed NYSE windows and the gap index editions, from the repo calendar`.

### Task G2: Decode the two logs and measure

**Files:** Create `web/lib/gap/decode.ts`, `web/lib/gap/measure.ts`, `web/test/fixtures/gap-logs.json`; Test `web/test/gap-decode.test.ts`, `web/test/gap-measure.test.ts`.

**Interfaces — Produces:**
- `ANSWER_UPDATED_TOPIC`, `SWAP_TOPIC` (lowercase hex strings).
- `interface RawLog { address: string; topics: string[]; data: string; blockNumber: string; logIndex: string; transactionHash: string; blockTimestamp?: string }`.
- `interface FeedUpdate { block: number; logIndex: number; ts: number; answer: bigint; tx: string; address: string }`. Here `answer` is the indexed `current` (int256, signed), `ts` comes from `blockTimestamp`, and `address` is lowercased.
- `interface Swap { block: number; logIndex: number; ts: number; sqrtPriceX96: bigint; tx: string }`. The `sqrtPriceX96` is data word 2 (uint160).
- `decodeAnswerUpdated(log: RawLog): FeedUpdate` and `decodeSwap(log: RawLog): Swap` both throw on a wrong topic0, short data or a missing `blockTimestamp`.
- `before(a, b)` is `(a.block, a.logIndex) < (b.block, b.logIndex)`; `byPosition` is the matching comparator.
- From `measure.ts`:
  - `BUCKET_SEC = 1800` and `LOOKBACK_SEC = 604800`;
  - `WindowSpan { closeTs; openTs; fromBlock; toBlock }`, `Freeze`, `Gap` and `TokenFigures` as in the code below;
  - `poolPrice8`, `hoursBetween`, `moveBps`, `feedLiveIn`, `findFreeze` and `measureToken`.

- [ ] **Step 1: Fixture.** Write `web/test/fixtures/gap-logs.json` as `{ "swap": <log>, "answerUpdated": <log> }`, using these two real logs, both read on Base mainnet.

```json
{"swap":{"address":"0xf668e21993f0acd7ab00bb1cfbaed0df28a3c8ec","topics":["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67","0x00000000000000000000000008fb33543ad633db94282df364ad80feb8d9fc35","0x00000000000000000000000008fb33543ad633db94282df364ad80feb8d9fc35"],"data":"0x000000000000000000000000000000000000000000000000000000004e60e3b2ffffffffffffffffffffffffffffffffffffffffffffffffffffffffcfe19cd10000000000000000000000000000000000000000c89fddf0644de7d09dc48f7e00000000000000000000000000000000000000000000000000001038f2675aedffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffecf4","blockNumber":"0x366c28a","blockTimestamp":"0x6af77a50","transactionHash":"0x49aeced46d7a654c16b771f94bd7c50099a2809693e486c97c4ee83e105b79eb","logIndex":"0x77"},
 "answerUpdated":{"address":"0xf72b1eb5932800f3d2a5eec5f99e6cd586479675","topics":["0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f","0x00000000000000000000000000000000000000000000000000000003be3c9647","0x0000000000000000000000000000000000000000000000000000000000000510"],"data":"0x000000000000000000000000000000000000000000000000000000006af79ef7","blockNumber":"0x36779cd","blockTimestamp":"0x6af79ef7","transactionHash":"0x384e7077eb2e06ee460f617d37be62c3f73332ce2b100d5b29dfe3a8bd968c61","logIndex":"0x1a"}}
```

- [ ] **Step 2: Write the failing tests.**
  - `gap-decode.test.ts`:
    - the Swap decodes to block 57,066,122 (`0x366c28a`), log index 119, ts `0x6af77a50`, and `sqrtPriceX96 === 0xc89fddf0644de7d09dc48f7en`. Its `poolPrice8` is a positive bigint whose value the test computes once with `priceFromSqrt(…, false, 8, 6)` and pins.
    - the AnswerUpdated decodes to block 57,113,037, log index 26, ts 1794612983 (`0x6af79ef7`, 2026-11-13T23:36:23Z), and answer `16_076_543_559n`.
    - an answer topic with the top bit set decodes as negative;
    - a wrong topic0 throws, short Swap data throws, and a missing `blockTimestamp` throws.
  - `gap-measure.test.ts` uses synthetic `FeedUpdate`/`Swap` builders, with a window of `closeTs = 1_000_000`, `openTs = 1_000_000 + 63.5 * 3600`, `fromBlock = 100` and `toBlock = 200`. Cases:
    1. **Worked shape.** Updates at close−3 h (answer 100_00000000), close+2.6 h (101_00000000, the Fri 18:36 analogue) and close+52 h (103_00000000). The freeze runs from the second update to the third; `hours === 49.4`; `returnMoveBps === 198` (`(103−101)/101` truncated).
    2. **Orders by block then log index.** A swap in the same block as the update that ends the freeze, with a lower log index, counts as while frozen. One with a higher log index does not. One in the start update's block, with a higher log index, counts.
    3. **Freeze longer than the window.** Updates at close−10 h and open+5 h only. The freeze is that interval, `hours === 78.5`, and swaps outside the window block range but inside the freeze count in `swapsWhileFrozen` and not in `swapsInWindow`.
    4. **No swaps.** `swapsInWindow === 0`, `swapsWhileFrozen === 0`, `largestGap === null`, `series.pool` is empty.
    5. **Feed not live.** No update in the window and the last one 8 days before the close: `feedLive === false`, and `freeze`, `swapsWhileFrozen` and `largestGap` are all `null`, but `swapsInWindow` counts.
    6. **The sign.** A pool below the held answer gives `above === false`. Equal prices give `bps === 0` and `above === true`.
    7. **Rounding down.** A pool at held × 1.00019 gives `bps === 1`, not 2. Build the swap from a sqrt price, or test `poolPrice8` separately and inject the price through a helper that inverts it. Simplest: pin `Number(premiumBps(…))` on bigint prices next to `measureToken` on a swap whose `poolPrice8` the test computes first.
    8. **Bucket boundary.** Swaps at close+1799 s and close+1800 s fall in buckets 0 and 1. Two swaps in one bucket contribute the later one (by block, then log index).
    9. **Feed series.** It starts with `[closeTs, answer in force]` and adds each in-window update.
    10. **Ties for the largest gap.** The first swap wins.
- [ ] **Step 3:** Run both tests. Expect them to fail because the modules are missing.
- [ ] **Step 4: Implement.**

```ts
// web/lib/gap/decode.ts
export const ANSWER_UPDATED_TOPIC = "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f";
export const SWAP_TOPIC = "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export interface RawLog { address: string; topics: string[]; data: string; blockNumber: string; logIndex: string; transactionHash: string; blockTimestamp?: string }
export interface Position { block: number; logIndex: number }
export interface FeedUpdate extends Position { ts: number; answer: bigint; tx: string; address: string }
export interface Swap extends Position { ts: number; sqrtPriceX96: bigint; tx: string }

const TWO_255 = 1n << 255n;
const TWO_256 = 1n << 256n;
const num = (hex: string) => Number(BigInt(hex));

function base(log: RawLog, topic: string, what: string): Position & { ts: number; tx: string } {
  if (log.topics[0]?.toLowerCase() !== topic) throw new Error(`not a ${what} log: topic0 ${log.topics[0]}`);
  if (log.blockTimestamp === undefined) throw new Error(`${what} log without blockTimestamp at ${log.blockNumber}`);
  return { block: num(log.blockNumber), logIndex: num(log.logIndex), ts: num(log.blockTimestamp), tx: log.transactionHash.toLowerCase() };
}

export function decodeAnswerUpdated(log: RawLog): FeedUpdate {
  const b = base(log, ANSWER_UPDATED_TOPIC, "AnswerUpdated");
  const topic = log.topics[1];
  if (topic === undefined) throw new Error(`AnswerUpdated without its answer topic at ${log.blockNumber}`);
  const raw = BigInt(topic);
  return { ...b, answer: raw >= TWO_255 ? raw - TWO_256 : raw, address: log.address.toLowerCase() };
}

/** Swap data: amount0, amount1, sqrtPriceX96, liquidity, tick, one 32-byte word each. */
export function decodeSwap(log: RawLog): Swap {
  const b = base(log, SWAP_TOPIC, "Swap");
  if (log.data.length < 2 + 64 * 5) throw new Error(`short Swap data at ${log.blockNumber}`);
  return { ...b, sqrtPriceX96: BigInt(`0x${log.data.slice(2 + 128, 2 + 192)}`) };
}

export const byPosition = (a: Position, b: Position): number => a.block - b.block || a.logIndex - b.logIndex;
export const before = (a: Position, b: Position): boolean => byPosition(a, b) < 0;
```

```ts
// web/lib/gap/measure.ts
import { B20_DECIMALS, USDC_DECIMALS } from "@/content/b20-nav";
import { premiumBps, priceFromSqrt } from "@/lib/live/price";
import { before, byPosition, type FeedUpdate, type Swap } from "./decode";

export const BUCKET_SEC = 1800;
export const LOOKBACK_SEC = 7 * 86_400;

export interface WindowSpan { closeTs: number; openTs: number; fromBlock: number; toBlock: number }
export interface Freeze { from: FeedUpdate; to: FeedUpdate; hours: number; returnMoveBps: number }
export interface Gap { bps: number; above: boolean; block: number; logIndex: number; ts: number; tx: string; pool8: bigint; held8: bigint }
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
```

- [ ] **Step 5:** Run both tests and `npm run typecheck`. Expect both to pass.
- [ ] **Step 6:** Commit with the subject `feat(web): decode AnswerUpdated and Swap logs and measure a closed window per token`.

### Task G3: The log reader and its cache

**Files:** Create `web/lib/gap/rpc.ts`, `web/lib/gap/logs.ts`; Modify the root `.gitignore` (add `web/.cache/`); Test `web/test/gap-rpc.test.ts`, `web/test/gap-logs.test.ts`.

**Interfaces — Produces:**
- `GAP_RPC = "https://base-rpc.publicnode.com"`.
- `interface LogReader { getLogs(q: { address: string | readonly string[]; topic0: string; from: number; to: number }): Promise<RawLog[]>; blockTs(n: number): Promise<number>; blockAt(ts: number): Promise<number>; head(): Promise<{ block: number; ts: number }>; call(to: string, data: string): Promise<string> }`.
- `createLogReader(opts?: { url?: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxSpan?: number; minSpan?: number; timeoutMs?: number }): LogReader`.
- `SPAN = 50_000`.
- `createLogSource(reader: LogReader, opts: { cacheDir: string | null; headBlock: number }): { swaps(pool: string, from: number, to: number): Promise<Swap[]>; updates(aggregators: readonly string[], from: number, to: number): Promise<FeedUpdate[]> }`.

**Behaviour:**
- **`rpc(method, params)`**:
  - a POST with JSON-RPC 2.0;
  - `AbortSignal.timeout(timeoutMs ?? 30_000)`;
  - an HTTP status that is not 2xx, a JSON-RPC `error`, a timeout and a body that is not JSON all throw `RpcRefused` with the method and a short reason.
  - It never logs the URL's query string; the URL has none.
- **`getLogs`** (in `rpc.ts`):
  - It splits `[from, to]` into spans of at most `maxSpan` (default 50,000) blocks.
  - Each span is tried up to 3 times, waiting `sleep(1000 * attempt)` between tries.
  - Still refused and longer than `minSpan` (default 1,000): split in two halves and read each.
  - Still refused at the floor: throw `Error("eth_getLogs refused blocks A-B: <reason>")`.
  - Results come back in (block, log index) order.
  - At most 10 addresses; more throws before any call.
- **`blockTs(n)`**: `eth_getBlockByNumber(hex, false).timestamp`.
- **`blockAt(ts)`**: the first block whose timestamp is ≥ `ts`.
  - It uses a binary search over `[0, head.block]`.
  - It throws when `ts` is after the head's timestamp.
- **`head()`**: `eth_blockNumber`, then that block's timestamp.
- **`call(to, data)`**: `eth_call` at `latest`; it returns the hex result.
- **`createLogSource`** reads whole aligned spans `[k·SPAN, k·SPAN + SPAN − 1]`, clipped to `headBlock`, and filters each to `[from, to]`, so the window reads and the freeze reads share the cache.
  - A span is cached only when its end is at most `headBlock − 1000`.
  - The cache key is `<kind>-<addresses joined by _>-<spanFrom>-<spanTo>.json` under `cacheDir` (`kind` is `swap` or `answer`).
  - It holds the decoded rows, with bigints as hex strings.
  - A cache file that does not parse is re-read and rewritten, never trusted.
  - `cacheDir: null` disables the cache.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` that records each request body and answers from a script, and `sleep: async () => {}`.
  - "splits a long range into spans of at most 50,000 blocks": `[0, 120_000]` makes 3 calls, with the right hex bounds.
  - "retries a refused span, then halves it": the fake refuses `[0, 49_999]` 3 times and answers its halves. Expect 3 + 2 calls on that span, and the results merged in order.
  - "fails at the floor": with `minSpan: 1000`, a span always refused throws a message naming its blocks.
  - "rejects more than 10 addresses".
  - "blockAt finds the first block at or after a timestamp": a fake chain where block n has ts `1000 + floor(n / 5)`, so `blockAt(1003)` is 15. Also pin a timestamp after the head.
  - `gap-logs.test.ts` uses a temporary directory (`fs.mkdtempSync(os.tmpdir())`):
    - a second read of the same range makes no RPC call;
    - a span within 1,000 blocks of the head is never written;
    - a corrupt cache file is replaced;
    - `cacheDir: null` writes nothing;
    - rows are filtered to `[from, to]`.
- [ ] **Step 2:** Run the tests. Expect them to fail because the modules are missing.
- [ ] **Step 3:** Implement `rpc.ts` and `logs.ts` as described above. Add `web/.cache/` to the root `.gitignore`.
- [ ] **Step 4:** Run both tests and `npm run typecheck`. Expect both to pass.
- [ ] **Step 5:** Commit with the subject `feat(web): a keyless log reader that halves refused spans and caches whole spans below the head`.

### Task G4: Schema, CLI, and the first data

**Files:** Create `web/lib/gap/schema.ts`, `web/lib/gap/edition.ts`, `web/scripts/gap-index.ts`; Modify `web/package.json` (`"gap-index": "tsx scripts/gap-index.ts"`); Test `web/test/gap-schema.test.ts`, `web/test/gap-edition.test.ts`, `web/test/gap-edition-files.test.ts`; Data `web/content/gap-index/edition-0.json`.

**Interfaces — Produces:**
- `formatDec8(v: bigint): string`: `16_076_543_559n` gives "160.76543559", and negatives get a leading "-".
- `EditionFileSchema` (zod) and `type EditionFile`, shaped like this:

```ts
{
  edition: number; title: string; from: string; to: string;
  rpc: "https://base-rpc.publicnode.com";
  topics: { answerUpdated: string; swap: string };
  head: { block: number; ts: number };
  windows: Array<
    | { status: "pending"; id: string; closeTs: number; openTs: number; closeLabel: string; openLabel: string }
    | { status: "complete"; id: string; closeTs: number; openTs: number; closeLabel: string; openLabel: string;
        blocks: { from: number; to: number };
        tokens: Array<{
          symbol: string; token: string; pool: string; feed: string; aggregator: string; phase: number;
          feedLive: boolean; swapsInWindow: number;
          freeze: null | { from: Update; to: Update; hours: number; returnMoveBps: number; swapsWhileFrozen: number; swapsRead: { from: number; to: number } };
          largestGap: null | { bps: number; above: boolean; block: number; logIndex: number; ts: number; tx: string; pool: string; held: string };
          series: { pool: [number, string][]; feed: [number, string][] };
        }> }
  >;
}
// Update = { block: number; logIndex: number; ts: number; answer: string; tx: string }
```

  - Integers are `z.number().int().nonnegative()` (`returnMoveBps` may be negative). Prices match `/^-?\d+\.\d{8}$/`. Addresses and hashes are lowercase hex of the right length.
  - A complete window has exactly 13 tokens, in `NAV_TOKENS` order. The object is strict, with no unknown keys.
- `toTokenRow(nav: NavToken, read: { aggregator: string; phase: number }, figures: TokenFigures, swapsRead: { from: number; to: number } | null)`: a schema row.
- `measureEdition(deps: { reader: LogReader; source: LogSourceFactory; log: (line: string) => void }, opts: { edition: number; windows?: string[]; tokens?: string[] }): Promise<EditionFile>`. It sits in `edition.ts` so it can be tested with fakes.

**CLI behaviour** (`web/scripts/gap-index.ts`, a thin wrapper over `measureEdition`):
- **Flags:**
  - `--edition N` is required;
  - `--window <id>` and `--token <SYM>` are repeatable filters and require `--stdout`;
  - `--stdout` prints the JSON and writes nothing;
  - `--no-cache`.
- **Without `--stdout`**, it writes `web/content/gap-index/edition-N.json` (2-space JSON and a final newline) only after the whole edition measured and parsed with the schema.
- **Any error** exits 1 and writes nothing.
- **Progress** goes to stderr, one line per token and window: symbol, window, calls made and seconds.
- **Per token**, it reads `phaseId()` (`0x58303b10`) on the proxy, then `phaseAggregators(p)` (`0xc1597304` + `word(p)`) for `p = 1..phaseId`. The current aggregator is the last one.
- **Per window:**
  - A window is `pending` when `openTs > head.ts`.
  - Otherwise `fromBlock = blockAt(closeTs)` and `toBlock = blockAt(openTs) − 1`. Also `back = blockAt(closeTs − 604800)`, and `ahead` is the first block of `openTs + 604800` (capped at `head.block`).
- **Per complete window and token:**
  - Read updates over `[fromBlock, toBlock]`, with every phase aggregator in one call.
  - Read backwards span by span from `fromBlock − 1` to `back` until one update is found. Read forwards from `toBlock + 1` to `ahead` until one update is found.
  - An update from a non-current aggregator throws "phase changed inside a measured range".
  - A live feed with no update after the window up to `ahead` throws "the feed has not updated since the window; run again later".
  - Swaps are read over `[min(fromBlock, freeze.from.block), max(toBlock, freeze.to.block)]`, or over `[fromBlock, toBlock]` when there is no freeze.
  - Then `measureToken`.
- **Order:** tokens follow `NAV_TOKENS` order and windows follow edition order. Tokens are read one at a time.

- [ ] **Step 1: Write the failing tests.**
  - `gap-schema.test.ts`:
    - `formatDec8` (positive, negative, small values like `5n` → "0.00000005");
    - the schema accepts a minimal pending window and a minimal complete window;
    - it rejects a price with 7 decimals, an unknown key, and 12 tokens.
  - `gap-edition.test.ts`, with a fake `LogReader` over a tiny synthetic chain (2 tokens' worth of `NAV_TOKENS` is not possible, so filter with `tokens: ["NVDAc"]`):
    - a pending window when the head is before its open;
    - the backwards and forwards reads find the bounding updates;
    - a phase-1 log inside the range throws;
    - a feed with no update after the window throws;
    - swaps are read over the freeze union.
  - `gap-edition-files.test.ts`:
    - reads every `web/content/gap-index/edition-*.json`;
    - parses each with the schema;
    - checks that its windows equal `editionWindows(EDITIONS[edition])` (ids, timestamps, labels);
    - runs these cross-checks on each complete token row:
      - `largestGap.block` lies within `[freeze.from.block, freeze.to.block]`;
      - every series point lies in `[closeTs, openTs)`;
      - `swapsWhileFrozen ≤ swapsInWindow` when the freeze lies inside the window's blocks;
      - `feedLive === false` implies `freeze === null`;
      - `largestGap.held === freeze.from.answer`.
    - It passes, vacuously, before any file exists. It must not be skipped: assert the glob ran.
- [ ] **Step 2:** Run the tests. Expect them to fail because the modules are missing.
- [ ] **Step 3:** Implement `schema.ts`, `edition.ts` and the CLI. Add the npm script.
- [ ] **Step 4:** Run the tests and `npm run typecheck`. Expect both to pass.
- [ ] **Step 5: Reproduce the worked example.** Run `npm run -s gap-index -- --edition 0 --window 2026-11-13 --token NVDAc --stdout`. Expect:
  - the freeze from block 57,113,037 (answer "160.76543559") to 58,002,228 (answer "164.86245491"), `hours` 49.4;
  - `returnMoveBps` about +254: whatever the formula gives, recorded as read;
  - the aggregator `0xf72b1eb5932800f3d2a5eec5f99e6cd586479675`, phase 2.

  If a value disagrees with the spec's worked example, stop and report: the spec's numbers were read by hand.
- [ ] **Step 6: The first data.** Run `npm run gap-index -- --edition 0` in the background (about 40 minutes for the two complete windows; the window 2026-11-20 stays `pending` until Mon 2026-11-23 14:30 UTC). Then run `npm test -- test/gap-edition-files.test.ts`.
- [ ] **Step 7:** Commit the code first, with the subject `feat(web): the gap-index CLI writes a checked edition file from Base logs`. Then commit the data, with the subject `data(web): gap index edition 0, windows 2026-11-06 and 2026-11-13`. The data commit's body names the head block and timestamp the run read, and the exact command.

### Task G5: The page

**Files:** Create `web/app/(site)/gap-index/page.tsx`, `web/content/gap-index/index.ts`, `web/components/gap/GapChart.tsx`, `web/components/gap/TokenTabs.tsx` (client), `web/components/gap/WindowTable.tsx`; Modify `web/app/sitemap.ts`, `web/lib/check-out.ts`, `web/scripts/check-out.ts`, `web/app/globals.css` (the `@source` list, if `components/gap` is not covered); Test `web/test/gap-page.test.tsx`, `web/test/check-out.test.ts`.

**Before writing chart code:**
- read the dataviz skill (`C:\Users\eric\.claude\plugins\cache\...\dataviz\SKILL.md`: find it with Glob `**/dataviz/SKILL.md` under `C:\Users\eric\.claude`);
- read the owner's chart note `C:\Users\eric\.claude\projects\E--APP2028-stocks-maxxing-hackathon\memory\feedback-chart-style-x.md`.

**Interfaces:**
- `content/gap-index/index.ts`:
  - imports each `edition-N.json` with `with { type: "json" }` if the repo's other JSON imports do, else plainly;
  - parses each with `EditionFileSchema` at build time, so a bad file fails the build;
  - exports `PUBLISHED: readonly EditionFile[]`, latest first.
- `TokenTabs({ windowId, tabs: { id: string; label: string }[], panels: ReactNode[] })`:
  - Before hydration, and without JavaScript, it renders every panel, each with its own heading, and no tablist.
  - After mount it renders a `role="tablist"` of pill buttons (`role="tab"`, `aria-selected`, `aria-controls`, roving `tabIndex`), with ArrowLeft/ArrowRight/Home/End moving and selecting.
  - Panels get `role="tabpanel"`, `aria-labelledby` and `hidden` when not selected.
  - Tab order: `FACTS.basket` first (NVDAc, GOOGLc, AAPLc), then the rest alphabetically.
- `GapChart({ row, window })` is a server component.
  - **Header (HTML):**
    - the big value is the largest gap: "+123 bps" in accent when above, "−45 bps" in refuse when below, with "pool above the held answer" / "pool below the held answer";
    - under it: hours frozen ("49.40 h frozen"), swaps meanwhile ("25,549 swaps meanwhile"), and the return move ("feed came back +254 bps");
    - a token without a live feed shows "feed not live in this window" and its swaps in window.
  - **SVG:**
    - `viewBox="0 0 1000 300" preserveAspectRatio="none"`;
    - x maps `[closeTs, openTs]` to `[0, 1000]`;
    - y maps `[min, max]` of every plotted price and the held answer, padded 8%, to `[300, 0]`.
    - The pool line is a `path` with `vector-effect="non-scaling-stroke"`, 2 px, coloured like the big value. Under it sits a fill path to the baseline, with a `linearGradient` from the line colour at 0.18 opacity to 0.
    - The feed is a thin muted step line (`currentColor` with `text-ink-2`), dashed where it holds the freeze's answer (x from `max(closeTs, freeze.from.ts)` to `min(openTs, freeze.to.ts)`).
    - A dot marks the last pool point. There are no gridlines, axes or y labels.
    - `role="img"` with `aria-label` stating the header figures and the window.
  - **Under the SVG (HTML):** the close label at the left and the open label at the right.
  - **`<details><summary>Table view</summary>`:** a table of every plotted point (time in ET via `formatEt` from `lib/live/format.ts`, then pool or feed, then the price in USD).
- `WindowTable({ window })`: one row per token in tab order.
  - Columns: token; frozen hours with "blocks A → B" linked to Basescan; swaps while frozen; swaps in window; largest gap linked to `https://basescan.org/tx/<tx>`; return move.
  - "feed not live in this window" spans the freeze columns for such a token.
  - Wrap the table in a focusable horizontal scroll region (`role="region"`, `aria-label`, `tabIndex={0}`), as `/now` does.
- **Page:**
  - its own header and footer, following `app/(site)/now/page.tsx` (read it first and match its header, skip link, metadata pattern and OG image object);
  - title "Weekend Gap Index · Maat", a description, and canonical `/gap-index`;
  - the H1 "Weekend Gap Index" and a lead (spec section 1);
  - editions latest first, then each window:
    - the headline "Fri 13 Nov 16:00 ET → Mon 16 Nov 09:30 ET · blocks 57,066,122 → 58,245,121" with Basescan block links;
    - a complete window shows its chart tabs and table;
    - a pending window shows "Measured after it ends, Mon 23 Nov 09:30 ET" and no figures;
  - the section "How these numbers are read": windows (section 2), what is read (section 3, with both topics and the RPC), the measures (section 4), the exact command `npm run -s gap-index -- --edition 0 --window <id> --token <SYM> --stdout`, "Nothing here is signed, and the site has no server.", and a link to `/now`.
- `checkGapIndexPage(html)` in `lib/check-out.ts` is called for `out/gap-index.html`. It requires:
  - the canonical `/gap-index`;
  - the H1;
  - the first complete window's NVDAc hours string from `PUBLISHED`;
  - no "safe".

- [ ] **Step 1: Write the failing tests.**
  - `gap-page.test.tsx` renders the page (or its sections) from the committed files. It asserts that every token row's hours, swap counts, largest-gap bps and return move appear.
  - Pending windows show no figures, and no "safe" / "safety" appears.
  - Tab keyboard behaviour (ArrowRight, Home, End) works after mount. Before mount every panel is visible.
  - The chart's `aria-label` carries the figures.
  - `check-out.test.ts` covers `checkGapIndexPage` on good and bad HTML.
- [ ] **Step 2:** Run the tests. Expect them to fail.
- [ ] **Step 3:** Implement. Add `/gap-index` to the sitemap. Add the `@source` entry if needed.
- [ ] **Step 4:** Run the tests, `npm run typecheck`, the full `npm test`, and `npm run build && npm run check:out`. Look at `/gap-index` at 375 and 1280 px in the in-app browser.
- [ ] **Step 5:** Commit with the subject `feat(web): /gap-index publishes each closed window per token, charted and tabled, with every block`.

### Task G6: End to end, links and docs

**Files:** Create `web/e2e/gap-index.spec.ts`; Modify `web/components/live/NowBoard.tsx` or wherever `/now`'s method section lives (one link to `/gap-index`), `web/README.md` (one line), `README.md` (one line under the site's pages, if it lists them).

- [ ] **Step 1: Write the spec** `web/e2e/gap-index.spec.ts`.
  - Tabs work with the mouse (click GOOGLc, and its panel shows) and the keyboard (focus the selected tab, then ArrowRight, End and Home).
  - The table view opens.
  - axe finds no violations; follow `e2e/docs-a11y.spec.ts`.
  - At 375 × 812, `measureFit(page)` reports no page overflow.
  - `collectErrors(page)` stays empty.
  - The page makes no network request outside its own origin. Route every non-localhost request and fail on it.
- [ ] **Step 2:** Check the port, then run: `cd web && netstat -ano | grep 4173; npm run build && npx playwright test --workers=2`. Expect every spec, old and new, to pass.
- [ ] **Step 3: Docs.**
  - `web/README.md`: "`/gap-index` (Weekend Gap Index) publishes `content/gap-index/edition-N.json`, written by `npm run gap-index -- --edition N` from Base logs (`lib/gap/`)."
  - `/now`'s method section links `/gap-index`.
  - Run `npm test -- test/readme.test.ts` if it exists.
- [ ] **Step 4:** Commit with the subject `test(web): drive /gap-index end to end and link it from /now and the READMEs`.

---

## Self-review notes

- Spec coverage:

  | Spec section | Task |
  |---|---|
  | 2 | G1 |
  | 3 | G3, G4 |
  | 4 | G2 |
  | 5 | G4 |
  | 6.1 | G1–G4 |
  | 6.2 | G5 |
  | 6.3 | G5 copy rules |
  | 7 | every task |
  | 8 | out of scope |

- Data timing: the branch may carry edition 0 with 2026-11-20 `pending` while it is built, but the PR merges only after `--edition 0` is rerun after Mon 2026-11-23 14:30 UTC with all three windows complete (spec 1); the cache makes the two earlier windows free. Edition 1 runs after Mon 2026-11-30 14:30 UTC; its page import is added in that data change.
- Every gap is the pool's spot price after a swap, not the vault's 30-minute TWAP; the page says so beside every gap (spec 4), and G5's test pins that sentence.
