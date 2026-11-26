import { NAV_TOKENS } from "@/content/b20-nav";
import { formatInt } from "@/content/format";
import { type CompleteWindow, etDateTime, formatHours, gapBps, gapSide, signedBps, SPOT_NOT_TWAP } from "@/content/gap-index";
import { BUCKET_SEC } from "@/lib/gap/measure";
import type { TokenRow } from "@/lib/gap/schema";

const W = 1000;
const H = 300;
/** The y range is padded by this share of the plotted range on each side. */
const PAD = 0.08;
const r1 = (n: number) => Math.round(n * 10) / 10;

type Pt = readonly [ts: number, price: number];

const toPts = (series: readonly (readonly [number, string])[]): Pt[] =>
  series.map(([ts, p]): Pt => [ts, Number(p)]).sort((a, b) => a[0] - b[0]);

const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

/**
 * The feed's step line from `from` to `to`, starting at `start`: a horizontal run, then a vertical step at each update
 * after `from` (and at `from` itself when `stepAtFrom`), up to and including `to`.
 */
function stepD(pts: Pt[], from: number, to: number, start: number, stepAtFrom: boolean, x: (ts: number) => number, y: (p: number) => number) {
  let d = `M${x(from)} ${y(start)}`;
  for (const [ts, p] of pts) {
    if (ts < from || ts > to || (ts === from && !stepAtFrom)) continue;
    d += `H${x(ts)}V${y(p)}`;
  }
  return `${d}H${x(to)}`;
}

/** The SVG's geometry, or null when there is no point to plot. */
function geometry(row: TokenRow, w: CompleteWindow) {
  const pool = toPts(row.series.pool);
  const feed = toPts(row.series.feed);
  const held = row.freeze ? Number(row.freeze.from.answer) : null;
  const prices = [...pool, ...feed].map(([, p]) => p);
  if (prices.length === 0) return null;
  if (held !== null) prices.push(held);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * PAD || Math.abs(max) * PAD || 1;
  const lo = min - pad;
  const hi = max + pad;
  const x = (ts: number) => r1(((ts - w.closeTs) / (w.openTs - w.closeTs)) * W);
  const y = (p: number) => r1(H - ((p - lo) / (hi - lo)) * H);

  const line = pool.map(([ts, p], i) => `${i === 0 ? "M" : "L"}${x(ts)} ${y(p)}`).join("");
  const first = pool[0];
  const last = pool[pool.length - 1];
  const fill = first && last ? `${line}L${x(last[0])} ${H}L${x(first[0])} ${H}Z` : "";

  // The feed: solid where it updates, dashed where it holds the freeze's answer, clipped to the window.
  let solid = "";
  let dashed = "";
  const start = feed[0];
  if (start) {
    if (row.freeze && held !== null) {
      const a = Math.max(w.closeTs, row.freeze.from.ts);
      const b = Math.min(w.openTs, row.freeze.to.ts);
      const atClose = feed.filter(([ts]) => ts <= w.closeTs).pop() ?? start;
      if (a > w.closeTs) solid += stepD(feed, Math.max(w.closeTs, start[0]), a, atClose[1], false, x, y);
      dashed = `M${x(a)} ${y(held)}H${x(b)}`;
      if (b < w.openTs) solid += stepD(feed, b, w.openTs, held, true, x, y);
    } else {
      solid = stepD(feed, start[0], w.openTs, start[1], false, x, y);
    }
  }
  return { line, fill, solid, dashed, last: last ? ([x(last[0]), y(last[1])] as const) : null };
}

/** The hue of a gap, for the chart and the table: the accent above the held answer, refuse below, ink at it. */
export const GAP_TONE = { above: "text-accent", below: "text-refuse", at: "text-ink" } as const;

function tone(row: TokenRow): string {
  return row.largestGap ? GAP_TONE[gapSide(row.largestGap)] : "text-ink";
}

/**
 * The figures the header shows, as one sentence for the chart's accessible name. A freeze has a largest gap exactly
 * when a swap fell in it (lib/gap/measure.ts), so without one the sentence says "no swap meanwhile" once, and no count.
 */
function summary(row: TokenRow, w: CompleteWindow): string {
  const head = `${row.symbol}, ${w.closeLabel} to ${w.openLabel}.`;
  const f = row.freeze;
  if (!f) {
    const why = row.feedLive ? "no interval without a feed update was measured" : "feed not live in this window";
    return `${head} ${why[0]!.toUpperCase()}${why.slice(1)}; ${plural(row.swapsInWindow, "swap", "swaps")} in window.`;
  }
  const g = row.largestGap;
  const back = `feed came back ${signedBps(f.returnMoveBps)}.`;
  if (!g) return `${head} ${formatHours(f.hours)} held without an update, no swap meanwhile, ${back}`;
  return `${head} Largest gap ${gapBps(g)}, pool ${gapSide(g)} the held answer. ${gapPrices(g)}. ${formatHours(f.hours)} held without an update, ${plural(f.swapsWhileFrozen, "swap", "swaps")} meanwhile, ${back}`;
}

/** The two prices a largest gap compares, as the edition holds them, 8 decimals each. */
export const gapPrices = (g: { pool: string; held: string }) => `pool ${g.pool} vs held ${g.held}`;

function Header({ row }: { row: TokenRow }) {
  const name = NAV_TOKENS.find((t) => t.symbol === row.symbol)?.name;
  const f = row.freeze;
  const g = row.largestGap;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="m-0 flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-ink">
        {row.symbol}
        {name ? <span className="text-[13px] font-normal text-ink-2">{name}</span> : null}
      </h4>
      {!f ? (
        <p className="m-0 mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink-2">
          {row.feedLive ? "no interval without a feed update was measured" : "feed not live in this window"}
        </p>
      ) : g ? (
        <>
          <span className="mt-2 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">Largest gap</span>
          <p data-gap-value className={`m-0 text-[clamp(40px,7vw,56px)] font-semibold leading-none tracking-[-0.04em] ${tone(row)}`}>
            {gapBps(g)}
          </p>
          <p className="m-0 mt-1 text-[14px] text-ink-body">
            pool {gapSide(g)} the held answer
            <span className="text-ink-2"> · {etDateTime(g.ts)}</span>
          </p>
          <p data-gap-prices className="m-0 font-mono text-[12px] text-ink-2">
            {gapPrices(g)}
          </p>
        </>
      ) : (
        // A freeze without a largest gap had no swap: said here once, so the list below gives no count.
        <p data-gap-value className="m-0 mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink-2">
          no swap meanwhile
        </p>
      )}
      <ul className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[14px] text-ink-2">
        {f ? (
          <>
            <li>
              <strong className="font-semibold text-ink">{formatHours(f.hours)}</strong> held without an update
            </li>
            {g ? (
              <li>
                <strong className="font-semibold text-ink">{formatInt(f.swapsWhileFrozen)}</strong>{" "}
                {f.swapsWhileFrozen === 1 ? "swap" : "swaps"} meanwhile
              </li>
            ) : null}
            <li>
              feed came back <strong className="font-semibold text-ink">{signedBps(f.returnMoveBps)}</strong>
            </li>
          </>
        ) : (
          <li>
            <strong className="font-semibold text-ink">{formatInt(row.swapsInWindow)}</strong>{" "}
            {row.swapsInWindow === 1 ? "swap" : "swaps"} in window
          </li>
        )}
      </ul>
    </div>
  );
}

/** A short key line for the legend, drawn like the series it names. */
function Key({ dashed, className }: { dashed?: boolean; className: string }) {
  return (
    <svg aria-hidden="true" width="20" height="8" viewBox="0 0 20 8" className={`shrink-0 ${className}`}>
      <path d="M1 4H19" stroke="currentColor" strokeWidth={dashed ? 1.5 : 2} strokeLinecap="round" strokeDasharray={dashed ? "3 3" : undefined} />
    </svg>
  );
}

const HTML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Text made safe to put in HTML markup, in an element or a quoted attribute: & < > " and ' become entities. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/** The table view's rows as markup, every value escaped: Time, Series, Price (USD). */
function rowsHtml(points: readonly { ts: number; series: string; price: string }[]): string {
  return points
    .map((p) => `<tr><td>${escapeHtml(etDateTime(p.ts))}</td><td>${escapeHtml(p.series)}</td><td>${escapeHtml(p.price)}</td></tr>`)
    .join("");
}

function TableView({ row, w }: { row: TokenRow; w: CompleteWindow }) {
  const points = [
    ...row.series.feed.map(([ts, p]) => ({ ts, series: "feed", price: p })),
    ...row.series.pool.map(([ts, p]) => ({ ts, series: "pool", price: p })),
  ].sort((a, b) => a.ts - b.ts);
  return (
    <details className="group text-[13px]">
      <summary className="w-fit cursor-pointer rounded-full py-1 font-medium text-ink hover:text-accent">Table view</summary>
      <div
        role="region"
        aria-label={`${row.symbol}: every plotted point, ${w.closeLabel} to ${w.openLabel}`}
        tabIndex={0}
        className="relative mt-3 max-h-[320px] overflow-y-auto rounded-xl border border-line"
      >
        <table className="w-full border-collapse text-left text-[12px] tabular-nums">
          <caption className="sr-only">
            Every point the {row.symbol} chart plots: the pool price after the last swap of each bucket, and each feed
            answer, in time order.
          </caption>
          <thead className="sticky top-0 bg-surface-head font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">
            <tr className="border-b border-line">
              <th scope="col" className="py-2 pl-3 pr-2 font-normal">
                Time
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                Series
              </th>
              <th scope="col" className="py-2 pl-2 pr-3 text-right font-normal">
                Price (USD)
              </th>
            </tr>
          </thead>
          {/* The rows are one HTML string, styled from the tbody: a chart lists over a hundred points, the page holds 26
              charts, and as elements they would weigh on the page and on its React payload twice over. */}
          <tbody
            className="text-ink-2 [&_td]:px-2 [&_td]:py-1.5 [&_td:first-child]:pl-3 [&_td:first-child]:text-ink-body [&_td:last-child]:pr-3 [&_td:last-child]:text-right [&_td:last-child]:font-mono [&_td:last-child]:text-ink [&>tr]:border-b [&>tr]:border-line-soft [&>tr:last-child]:border-b-0"
            dangerouslySetInnerHTML={{ __html: rowsHtml(points) }}
          />
        </table>
      </div>
    </details>
  );
}

/**
 * One token over one closed window, X style: the largest gap as the big value, the pool price as one line over a fill
 * that fades out, the feed as a thin step line, dashed where it held its answer, and a dot at the last pool point.
 */
export function GapChart({ row, window: w }: { row: TokenRow; window: CompleteWindow }) {
  const geo = geometry(row, w);
  const gradient = `gap-fill-${w.id}-${row.symbol}`;
  const color = tone(row);
  return (
    <div data-gap-chart={row.symbol} className="card flex min-w-0 flex-col gap-5 p-5 sm:p-7">
      <Header row={row} />
      {geo ? (
        <div className="flex flex-col gap-2">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={summary(row, w)}
            className={`block h-[180px] w-full overflow-visible sm:h-[240px] ${color}`}
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.18" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {geo.fill ? <path data-series="fill" d={geo.fill} fill={`url(#${gradient})`} stroke="none" /> : null}
            <g className="text-ink-2" fill="none" stroke="currentColor" strokeWidth={1.25}>
              {geo.solid ? <path data-series="feed" d={geo.solid} vectorEffect="non-scaling-stroke" /> : null}
              {geo.dashed ? <path data-series="held" d={geo.dashed} strokeDasharray="6 5" vectorEffect="non-scaling-stroke" /> : null}
            </g>
            {geo.line ? (
              <path
                data-series="pool"
                d={geo.line}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
            {geo.last ? (
              // A zero-length path with round caps and a non-scaling stroke stays a round dot in a stretched viewBox.
              <g data-series="last" strokeLinecap="round">
                <path d={`M${geo.last[0]} ${geo.last[1]}h0`} stroke="var(--color-bg)" strokeWidth="14" vectorEffect="non-scaling-stroke" />
                <path d={`M${geo.last[0]} ${geo.last[1]}h0`} stroke="currentColor" strokeWidth="9" vectorEffect="non-scaling-stroke" />
              </g>
            ) : null}
          </svg>
          <div data-window-ends className="flex justify-between gap-4 font-mono text-[11px] text-ink-2">
            <span>{w.closeLabel}</span>
            <span className="text-right">{w.openLabel}</span>
          </div>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 text-[12px] text-ink-2 sm:flex-row sm:flex-wrap sm:gap-x-5">
            {geo.line ? (
              <li className="flex items-center gap-2">
                <Key className={color} />
                Pool price after the last swap of each {BUCKET_SEC / 60}-minute bucket
              </li>
            ) : null}
            {geo.solid || geo.dashed ? (
              <li className="flex items-center gap-2">
                <Key dashed className="text-ink-2" />
                Feed answer, dashed while held without an update
              </li>
            ) : null}
          </ul>
        </div>
      ) : (
        <p className="m-0 flex h-[120px] items-center justify-center rounded-xl border border-dashed border-line-strong px-4 text-center text-[13px] text-ink-2">
          Nothing to plot: no swap and no feed update in this window.
        </p>
      )}
      {row.largestGap ? (
        <p className="m-0 text-[13px] leading-relaxed text-ink-2">
          The gap compares {SPOT_NOT_TWAP}, with the answer the feed held.
        </p>
      ) : null}
      {geo ? <TableView row={row} w={w} /> : null}
    </div>
  );
}
