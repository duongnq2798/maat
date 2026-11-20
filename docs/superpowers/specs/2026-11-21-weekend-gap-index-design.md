# The Weekend Gap Index

Date: 2026-11-21. Branch: `feat/weekend-gap-index`. Status: approved by the owner's standing approval of the 2026-11-20 strategy report (Move 5).

## 1. Goal

When NYSE is closed, the Chainlink feeds that price B20 stocks on Base hold their last answer, while the Aerodrome pools that trade those tokens keep running. Maat's vault refuses `MARKET_CLOSED` in those hours. This change measures that stretch from Base logs and publishes it as dated editions:

- **Edition 0** covers the three weekends from Fri 2026-11-06 to Mon 2026-11-23 and ships Mon 11-23, after the last of them ends (09:30 ET, 14:30 UTC). It is published with all three windows measured, so no window that is still open appears with figures.
- **Edition 1** covers Thanksgiving week (Wed 11-25 to Mon 11-30) and ships Mon 11-30.

For each closed window and each of the 13 B20 tokens with a NAV, an edition reports:

- the hours the feed was frozen, with the two blocks that bound the freeze;
- the swaps executed on the token's Aerodrome pool meanwhile;
- the largest gap, in basis points, between the pool's price after a swap and the answer the feed held;
- how far the feed's answer moved when it came back.

Success means a reader can take any number on the page, rerun one command over the block range printed beside it, and get the same number. The wording is factual: it describes the chain, never a person's motive, and never says "safe".

## 2. Closed windows

A closed window runs from one NYSE regular-session close to the next regular-session open, when at least one full calendar day without a session lies between them (a weekend or a holiday). Overnight gaps between two session days are not windows. Session times come from `web/content/calendar.ts`, the repository's tested port of `MarketCalendar.sol` (holidays, the 13:00 early close on 11-27, and New York daylight saving).

| Edition | Window id | Close (ET) | Open (ET) |
|---|---|---|---|
| 0 | 2026-11-06 | Fri 11-06 16:00 | Mon 11-09 09:30 |
| 0 | 2026-11-13 | Fri 11-13 16:00 | Mon 11-16 09:30 |
| 0 | 2026-11-20 | Fri 11-20 16:00 | Mon 11-23 09:30 |
| 1 | 2026-11-25 | Wed 11-25 16:00 | Fri 11-27 09:30 (Thanksgiving on Thu) |
| 1 | 2026-11-27 | Fri 11-27 13:00 (early close) | Mon 11-30 09:30 |

An edition is a date range in `web/content/gap-index/editions.ts`: its windows are the closed windows whose close falls in the range. A window's block range is `[first block with timestamp ≥ close, last block with timestamp < open]`, found by binary search over block headers. A window that has not ended when the script runs is written as `pending`, with no figures. The page says when it closes and that its figures are added after it ends.

## 3. What is read

Everything comes from Base mainnet over `https://base-rpc.publicnode.com`, which is free and keyless. The script uses `eth_getLogs`, `eth_getBlockByNumber`, `eth_blockNumber`, and `eth_call` at `latest` only.

What this endpoint allows, measured:

- logs back to about block 51,000,000 (2026-09-07);
- at most 50,000 blocks and at most 10 addresses per `eth_getLogs` call;
- logs that carry `blockTimestamp`;
- no state reads at old blocks ("Archive requests require a personal token"), so the index uses logs only.

Per token, taken from `web/content/b20-nav.ts` (the same 13 tokens as the live strip):

- **Feed updates.** Read the proxy's `phaseId()` (selector `0x58303b10`) and, for each phase from 1 to it, `phaseAggregators(uint16)` (`0xc1597304`), at `latest`. The current phase's aggregator is the one measured, and the edition records its address and phase. Its `AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)` logs (topic `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f`) are read with every phase's aggregator in the same call:
  - over the window;
  - backwards from the window's start, at most 7 days, until the last update before it;
  - forwards from the window's end, at most 7 days and never past the head, until the first update at or after the open.
  - A log from an aggregator other than the current one, inside what was read, fails the run: a phase change inside a measured range is not handled.
  - Measured: every proxy but ANT is in phase 2, and only the phase-2 aggregators emitted updates in the 100,000 blocks before the first window.
- **Swaps.** Read the pool's `Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)` logs (topic `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`) over the window and over the freeze, whichever reaches further.
  - In every pool, token0 is USDC (6 decimals) and token1 is the stock (8 decimals).

Scale, measured:

- One 50,000-block span on Sat 11-14 (about 2.8 h) held 15,145 swaps across the 13 pools: AAPLc 487, AMZNc 775, ANTc 0, CRCLc 764, GOOGLc 786, INTCc 434, METAc 626, MSFTc 280, MSTRc 4,244, NVDAc 1,192, SNDKc 2,556, SPCXc 2,202, TSLAc 799. That span took 50 s, one pool at a time.
- NVDAc's pool alone had 25,549 swaps between Fri 11-13 16:00 ET and Mon 11-16 09:30 ET (blocks 57,066,122 to 58,245,122).
- So the script asks one pool at a time, keeps what it decoded in a local cache that git ignores, and splits a span in half when the node refuses it.

Base runs about 5 blocks a second, with whole-second timestamps.

## 4. The measures

All prices use 8 decimals, like the feeds. Ordering is always by (block, log index).

- **Pool price after a swap.** Convert `sqrtPriceX96` from the Swap log with `priceFromSqrt(sqrtP, false, 8, 6)` from `web/lib/live/price.ts`, the port of `PriceLib.priceFromSqrt`. This is the spot price after each swap, not the 30-minute TWAP the vault checks; the page says so beside every gap.
- **Answer in force.** The `current` of the last `AnswerUpdated` at or before that swap.
- **Frozen.** The longest interval between two consecutive feed updates that overlaps the window.
  - It starts at the update after which the answer held, and ends at the next update.
  - It is reported in hours to two decimals, with both blocks and timestamps.
  - It can start before the close, when a feed goes quiet because the price stays inside the 0.5% deviation threshold. It can end after the open.
- **Swaps while frozen.** Swap logs strictly after the freeze's start update and strictly before its end update.
- **Swaps in window.** Swap logs in the window's block range.
- **Largest gap while frozen.**
  - Formula: the maximum of `|pool − held| × 10000 / held`, rounded down as `premiumBps` in `web/lib/live/price.ts` (the port of `PriceLib.premiumBps`) rounds.
  - It is taken over the swaps while frozen; the first swap wins a tie.
  - It is reported with its sign (pool above or below the held answer), block, transaction hash, log index, pool price and held answer.
- **Return move.** The signed bps change `(next − held) × 10000 / held`, truncated toward zero, at the update that ended the freeze.
- **Series** (for the chart).
  - The window is cut into 30-minute buckets, starting at its close.
  - Each bucket with a swap contributes the price after its last swap, at that swap's timestamp.
  - Each feed update in the window contributes a point, plus the answer in force at the window's start.

Some tokens have no feed live in a window: no update in the window and none in the 7 days before it. They read "feed not live in this window": freeze, gap and return move are omitted, but their swaps are still counted. ANTc's token was first minted on 2026-11-19, so this applies to it in the first two windows.

Worked example (NVDAc, window 2026-11-13, aggregator 0xf72b1eb5932800f3d2a5eec5f99e6cd586479675):

- The window has 35 AnswerUpdated logs.
- The last update before the freeze was at block 57,113,037, 2026-11-13T23:36:23Z (18:36 ET), with answer 160.76543559.
- The next update was at block 58,002,228, 2026-11-16T01:00:21Z (Sun 20:00 ET), with answer 164.8625.
- So the feed was frozen about 49.40 h, and the return move was about +254 bps.
- `FACTS.feedEdgeMin` in `web/content/facts.ts` says the repo assumes the feeds stop Fri 20:00 ET and resume Sun 20:00 ET, and that this was "not measured in the repository". The index measures it.

## 5. Output

`npm run gap-index -- --edition 0` writes `web/content/gap-index/edition-0.json`. A zod schema in `web/lib/gap/schema.ts` checks the file. It holds:

- the edition number, date range and title;
- the RPC, the two topics, and the head block (number and timestamp) read when the script ran;
- per window: id, close and open (timestamps and ET labels), status (`complete` or `pending`);
- per complete window: the block range, and one row per token with the token, pool, feed proxy, aggregator and phase it read, and the measures of section 4. A row with a freeze also records the block range its swaps were read over.

Blocks, timestamps, log indexes, bps and counts are JSON numbers; 8-decimal prices are decimal strings ("160.76543559"), so no float rounds them.

Every figure carries its blocks. The script is deterministic: run again over the same blocks, it writes the same figures, and only the head block can differ.

The script writes the file only when every selected window and token read without error. To reproduce one figure without the full run, filter: `--window 2026-11-13 --token NVDAc --stdout` prints one row, in a few dozen log calls (a minute or two).

## 6. Surfaces

### 6.1 Code

- `web/lib/gap/` holds pure modules, tested without the network:
  - `windows.ts`: the closed windows, from the calendar;
  - `decode.ts`: the two logs;
  - `measure.ts`: the measures of section 4;
  - `schema.ts`: the edition file.
- `web/lib/gap/rpc.ts`: Node `fetch`, retries with backoff, halving a refused span, `blockAt(timestamp)`, and the cache of decoded logs under `web/.cache/gap-index/` (git-ignored).
- `web/scripts/gap-index.ts`: the CLI, run with `tsx`, plus an `npm run gap-index` script.
- The token list (`web/content/b20-nav.ts`) and the price math (`priceFromSqrt`, `premiumBps` in `web/lib/live/price.ts`) are the live strip's, imported, never copied.

### 6.2 `/gap-index`

A static route `app/(site)/gap-index/page.tsx`, in the sitemap, with its own title, description and canonical. It imports the edition files at build time. The figures are in the HTML, so a reader without JavaScript gets every number.

- **Title "Weekend Gap Index"**, then a lead that says what a closed window is and what is measured (section 1).
- **Editions**, latest first, each with its windows. Each window has three parts.
  - **A headline:** close to open in ET, the block range linked to Basescan, and its status.
  - **An X-style chart, one token at a time.**
    - Pill tabs for the 13 tokens: the basket first (NVDAc, GOOGLc, AAPLc), then the rest alphabetically.
    - The pool price is one line over a fill that fades to transparent.
    - A dashed horizontal line marks the answer the feed held, over the frozen span only.
    - A dot marks the last point.
    - No gridlines and no y labels.
    - A header shows the largest gap while frozen as the big value, then the hours frozen, the swaps meanwhile and the return move.
    - The chart is SVG, with its text in HTML. It has `role="img"` and an accessible name that states the header figures.
    - A table view in `<details>` lists every plotted point.
    - The tabs follow the WAI-ARIA tabs pattern. Without JavaScript, every panel shows.
  - **A table of the 13 tokens:** frozen hours (with the bounding blocks), swaps while frozen, swaps in window, largest gap (linked to its transaction) and return move. A token without a live feed reads "feed not live in this window".
- **"How these numbers are read":** the method (sections 2–4), the exact command, the RPC, and a note that nothing here is signed and the site has no server.
- **Links:** a link to `/now`, and a link to `/gap-index` from `/now`'s method section.

### 6.3 Not on this page

- No forecast.
- No reading of why a pool moved.
- No claim about who traded.
- No "safe".
- The line joins only the points it has. It never fills in buckets with no swap.

## 7. Testing

- **Unit tests (vitest):**
  - The windows of editions 0 and 1 equal the table in section 2, to the second.
  - The decoders reproduce two real logs (one Swap, one AnswerUpdated).
  - `measure.ts` is tested on synthetic sequences:
    - ties within one block, ordered by log index;
    - a freeze that starts before the close and ends after the open;
    - no swaps;
    - a feed that is not live;
    - the sign of the gap;
    - bucket boundaries;
    - rounding down as `premiumBps` does.
  - The log reader, with a fake `fetch`: a refused span is retried, then halved, and a span still refused at the floor fails; the cache is reused and never holds a span near the head; `blockAt` finds the first block at or after a timestamp.
  - Each committed edition file parses with the schema.
  - Cross-checks hold in each file: swaps while frozen ≤ swaps in window when the freeze lies inside the window, the largest gap's block lies inside the freeze, and the series points lie inside the window.
  - The page renders every figure of the committed files and contains no "safe".
- **Export check:** `out/gap-index.html` exists, with its canonical and the figures in the HTML.
- **End to end (Playwright `--workers=2`):**
  - the tabs work with mouse and keyboard;
  - axe finds nothing;
  - there is no horizontal page scroll at 375 px;
  - the table view opens.

## 8. Out of scope

- weeknight closes;
- tokens without a NAV;
- any onchain write;
- running the script in CI. It reads tens of thousands of logs per window; the committed edition files are the record, and CI checks them.
