import type { ReactNode } from "react";
import { NAV_TOKENS } from "@/content/b20-nav";
import { formatInt } from "@/content/format";
import { type CompleteWindow, etDateTime, formatHours, gapBps, gapSide, rowsInTabOrder, signedBps, SPOT_NOT_TWAP } from "@/content/gap-index";
import type { TokenRow } from "@/lib/gap/schema";
import { basescanBlock, basescanTx } from "@/lib/live/basescan";
import { GAP_TONE } from "./GapChart";

/** Links off the site (Basescan) open in a new tab. */
const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;

const COLUMNS = [
  { key: "hours", label: "Without a feed update" },
  { key: "swapsWhileFrozen", label: "Swaps meanwhile" },
  { key: "gap", label: "Largest gap" },
  { key: "returnMove", label: "Feed came back" },
  { key: "swapsInWindow", label: "Swaps in window" },
] as const;

/** The columns a freeze fills: a token without one spans them with a single cell. */
const FREEZE_COLUMNS = 4;

/**
 * A link set in a line of text: underlined, since the accent alone does not stand out from the text around it (axe
 * link-in-text-block).
 */
export const INLINE_LINK = "underline decoration-accent/35 underline-offset-[3px] hover:decoration-accent";

export function BlockLink({ block }: { block: number }) {
  return (
    <a href={basescanBlock(BigInt(block))} {...EXTERNAL} className={INLINE_LINK}>
      {formatInt(block)}
    </a>
  );
}

function Cell({ col, children, className = "" }: { col: string; children: ReactNode; className?: string }) {
  return (
    <td data-col={col} className={`px-3 py-3 align-top ${className}`}>
      {children}
    </td>
  );
}

function FreezeCells({ row }: { row: TokenRow }) {
  const f = row.freeze;
  if (!f) {
    return (
      <td data-col={row.feedLive ? "noFreeze" : "notLive"} colSpan={FREEZE_COLUMNS} className="px-3 py-3 align-top text-ink-2">
        {row.feedLive ? "no interval without a feed update was measured" : "feed not live in this window"}
      </td>
    );
  }
  const g = row.largestGap;
  return (
    <>
      <Cell col="hours">
        <span className="block font-mono text-[14px] font-semibold text-ink">{formatHours(f.hours)}</span>
        <span className="block whitespace-nowrap text-[12px] text-ink-2">
          {etDateTime(f.from.ts)} → {etDateTime(f.to.ts)}
        </span>
        <span className="block whitespace-nowrap font-mono text-[12px] text-ink-2">
          blocks <BlockLink block={f.from.block} /> → <BlockLink block={f.to.block} />
        </span>
      </Cell>
      <Cell col="swapsWhileFrozen" className="text-right font-mono text-ink">
        {formatInt(f.swapsWhileFrozen)}
      </Cell>
      <Cell col="gap" className="text-right">
        {g ? (
          <>
            {/* Hued like the chart; the underline marks it as a link whatever its hue. */}
            <a
              href={basescanTx(g.tx)}
              {...EXTERNAL}
              className={`font-mono font-semibold underline decoration-current/40 underline-offset-[3px] hover:decoration-current ${GAP_TONE[gapSide(g)]}`}
            >
              {gapBps(g)}
              <span className="sr-only">, its transaction on Basescan</span>
            </a>
            <span className="block text-[12px] text-ink-2">{gapSide(g) === "at" ? "pool at the held answer" : `pool ${gapSide(g)}`}</span>
          </>
        ) : (
          <span className="text-ink-2">no swap</span>
        )}
      </Cell>
      <Cell col="returnMove" className="text-right font-mono text-ink">
        {signedBps(f.returnMoveBps)}
      </Cell>
    </>
  );
}

/** Every token of one complete window, one row each, in tab order. */
export function WindowTable({ window: w }: { window: CompleteWindow }) {
  return (
    <div className="flex flex-col gap-3">
      {/* relative: the sr-only text in its links is absolutely positioned, so it scrolls with the table instead of widening the page. */}
      <div
        role="region"
        aria-label={`Every token, ${w.closeLabel} to ${w.openLabel}, one row each`}
        tabIndex={0}
        data-window-table
        className="card scroll-x-cue relative overflow-x-auto"
      >
        <table className="w-full min-w-[860px] border-collapse text-left text-[13px] leading-5 tabular-nums">
          <caption className="sr-only">
            Each token from {w.closeLabel} to {w.openLabel}: the longest interval without a feed update and its bounding
            blocks, the swaps meanwhile, the largest gap and its transaction, how far the feed&apos;s answer moved when it
            came back, and the swaps in the window.
          </caption>
          <thead className="bg-surface-head font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">
            <tr className="border-b border-line">
              <th scope="col" className="py-3.5 pl-5 pr-3 align-bottom font-normal">
                Token
              </th>
              {COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-3 py-3.5 align-bottom font-normal ${i === 0 ? "" : "text-right"} ${i === COLUMNS.length - 1 ? "pr-5" : ""}`}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsInTabOrder(w).map((row) => (
              <tr key={row.symbol} data-token={row.symbol} className="border-b border-line-soft last:border-b-0">
                <th scope="row" className="py-3 pl-5 pr-3 text-left align-top font-normal">
                  <span className="block font-semibold text-ink">{row.symbol}</span>
                  <span className="block text-[12px] text-ink-2">{NAV_TOKENS.find((t) => t.symbol === row.symbol)?.name}</span>
                </th>
                <FreezeCells row={row} />
                <Cell col="swapsInWindow" className="pr-5 text-right font-mono text-ink">
                  {formatInt(row.swapsInWindow)}
                </Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m-0 max-w-[820px] text-[13px] leading-relaxed text-ink-2">
        Without a feed update: the longest interval between two feed updates that overlaps the window, from the update
        whose answer held to the next one, with both blocks. Largest gap: {SPOT_NOT_TWAP}, against the answer the feed
        held; each links to its transaction.
      </p>
    </div>
  );
}
