import { commandParts } from "@/components/gap/Command";
import { chartGeometry, FEED_KEY, gapPrices, NOTHING_TO_PLOT, POOL_KEY } from "@/components/gap/GapChart";
import { COLUMNS } from "@/components/gap/WindowTable";
import { NAV_TOKENS } from "@/content/b20-nav";
import { formatInt } from "@/content/format";
import {
  closureNote,
  type CompleteWindow,
  decisionsSentence,
  etDateTime,
  formatHours,
  gapBps,
  gapSide,
  rowsInTabOrder,
  signedBps,
} from "@/content/gap-index";
import { reasonText } from "@/content/reasons";
import type { SenderLabel } from "@/lib/chain/ledger";
import type { Sender } from "@/lib/gap/decisions";
import type { EditionFile, TokenRow } from "@/lib/gap/schema";
import { LABEL } from "@/lib/gap/vault";
import { SIGN_OFF } from "./model";

// The Gap Index card (npm run card -- --gap-edition N --window ID): one closed window of a committed edition file, in
// the Weighing card's frame. Every figure, label and path is the one /gap-index prints for that window and token, from
// the page's own functions (content/gap-index, components/gap/**); test/card-gap-model.test.tsx holds them equal.

/** The footer voice.md requires on a data image that shows a stock token. Every Gap Index card shows one. */
export const GAP_FOOTER = "Data, not a signal. Not offered to US persons.";

/** Where an edition's file is committed, as the card's source line names it. */
export const editionPath = (edition: number) => `web/content/gap-index/edition-${edition}.json`;

/** /ledger's chip for each sender a window's Decision can have; unlabelled is not a direct execute call to the vault. */
const LEDGER_LABEL: Readonly<Record<Sender, SenderLabel | "sender not labeled">> = {
  ...(Object.fromEntries(Object.entries(LABEL).map(([label, sender]) => [sender, label])) as Record<Exclude<Sender, "unlabelled">, SenderLabel>),
  unlabelled: "sender not labeled",
};

/** The figure set largest: a token's largest gap, or what the page prints instead when there is none. */
export type GapFigure =
  | {
      kind: "gap";
      label: "Largest gap";
      /** "+356 bps", "−490 bps", with a true minus. */
      value: string;
      side: "above" | "below" | "at";
      /** "pool above the held answer": the chart header prints it, then " · " and `at`. */
      sideText: string;
      /** When the pool printed that gap: "Sun 15 Nov 19:03 ET". */
      at: string;
      /** "pool 190.12345678 vs held 186.00000000". */
      prices: string;
    }
  | { kind: "text"; text: string };

export interface GapCardModel {
  edition: number;
  windowId: string;
  symbol: string;
  /** The token's name in content/b20-nav.ts, as the chart's heading prints it beside the symbol. */
  name: string | null;
  /** "Gap Index · edition 0 · window 2026-11-13". */
  title: string;
  /** "blocks 57,066,122 → 58,245,121", the window's blocks as its headline prints them. */
  blocks: string;
  /** "Fri 13 Nov 16:00 ET → Mon 16 Nov 09:30 ET". */
  span: string;
  /** What closed it: "Thanksgiving, Thu 26 Nov · 41.50 h closed", or for a plain weekend "The weekend · 65.50 h closed". */
  note: string;
  figure: GapFigure;
  /** The table's other columns this token fills, with the table's headers: a token without an interval fills only the last. */
  stats: { key: (typeof COLUMNS)[number]["key"]; label: string; value: string }[];
  /** The page's chart paths in its 1000x300 viewBox, or null when there is no point to plot. */
  chart: ReturnType<typeof chartGeometry>;
  /** The chart's two ends: the window's close and open. */
  ends: [string, string];
  /** The chart's keys, as the page lists them for the series it draws. */
  legend: string[];
  nothingToPlot: string;
  decisions: {
    /** False when the window's edition does not count the vault's Decisions. */
    counted: boolean;
    sentence: string;
    /** Each Decision in chain order: its time in ET, its verdict and its sender as /ledger labels it. */
    rows: { at: string; verdict: string; sender: string }[];
  };
  /** The command that reproduces this row of the edition. */
  command: string;
  /** "web/content/gap-index/edition-0.json · head block 61,273,559". */
  source: string;
  footer: string;
  signOff: string;
  /** File name stem: "gap-index-0-2026-11-13-NVDAc". */
  stem: string;
}

/** The figure the chart's header sets largest, as GapChart's Header writes it. */
function figureOf(row: TokenRow): GapFigure {
  const f = row.freeze;
  const g = row.largestGap;
  if (!f) return { kind: "text", text: row.feedLive ? "no interval without a feed update was measured" : "feed not live in this window" };
  if (!g) return { kind: "text", text: "no swap meanwhile" };
  const side = gapSide(g);
  return { kind: "gap", label: "Largest gap", value: gapBps(g), side, sideText: `pool ${side} the held answer`, at: etDateTime(g.ts), prices: gapPrices(g) };
}

/** The values of the table's cells for this token, as WindowTable writes them. */
function statsOf(row: TokenRow): GapCardModel["stats"] {
  const label = (key: (typeof COLUMNS)[number]["key"]) => COLUMNS.find((c) => c.key === key)!.label;
  const inWindow = { key: "swapsInWindow" as const, label: label("swapsInWindow"), value: formatInt(row.swapsInWindow) };
  const f = row.freeze;
  if (!f) return [inWindow];
  return [
    { key: "hours", label: label("hours"), value: formatHours(f.hours) },
    { key: "swapsWhileFrozen", label: label("swapsWhileFrozen"), value: formatInt(f.swapsWhileFrozen) },
    { key: "returnMove", label: label("returnMove"), value: signedBps(f.returnMoveBps) },
    inWindow,
  ];
}

/**
 * What closed the window: the note /gap-index prints under its heading, or, for a plain weekend, where the page prints
 * none (closureNote returns null only then), the same words for the weekend and its hours.
 */
function noteOf(w: CompleteWindow): string {
  return closureNote(w) ?? `The weekend · ${formatHours((w.openTs - w.closeTs) / 3600)} closed`;
}

function decisionsOf(edition: number, w: CompleteWindow): GapCardModel["decisions"] {
  const d = w.decisions;
  if (!d) return { counted: false, sentence: `Edition ${edition} does not count the vault's Decisions.`, rows: [] };
  // GapWindow adds where each one is, once there is one.
  const sentence = d.count > 0 ? `${decisionsSentence(d)} Each one is on the ledger.` : decisionsSentence(d);
  return {
    counted: true,
    sentence,
    rows: d.list.map((x) => ({ at: etDateTime(x.ts), verdict: `${x.allowed ? "Allowed" : "Refused"} · ${reasonText(x.reason)}`, sender: LEDGER_LABEL[x.sender] })),
  };
}

/**
 * The card of one window of `file`, for `symbol`, or without one for the token /gap-index shows first in that window's
 * tabs. Throws, naming what the file holds, for a window it does not hold, a pending window and a token not in it.
 */
export function gapCardModel(file: EditionFile, windowId: string, symbol?: string): GapCardModel {
  const e = file.edition;
  const w = file.windows.find((x) => x.id === windowId);
  if (!w) throw new Error(`edition ${e} has no window ${windowId}: its windows are ${file.windows.map((x) => x.id).join(", ")}`);
  if (w.status !== "complete") throw new Error(`window ${w.id} of edition ${e} is pending: it is measured after it ends, ${w.openLabel}`);
  const rows = rowsInTabOrder(w);
  const row = symbol === undefined ? rows[0] : rows.find((r) => r.symbol === symbol);
  if (!row) throw new Error(`window ${w.id} of edition ${e} has no token ${symbol}: its tokens are ${rows.map((r) => r.symbol).join(", ")}`);
  const chart = chartGeometry(row, w);
  return {
    edition: e,
    windowId: w.id,
    symbol: row.symbol,
    name: NAV_TOKENS.find((t) => t.symbol === row.symbol)?.name ?? null,
    title: `Gap Index · edition ${e} · window ${w.id}`,
    blocks: `blocks ${formatInt(w.blocks.from)} → ${formatInt(w.blocks.to)}`,
    span: `${w.closeLabel} → ${w.openLabel}`,
    note: noteOf(w),
    figure: figureOf(row),
    stats: statsOf(row),
    chart,
    ends: [w.closeLabel, w.openLabel],
    legend: chart ? [...(chart.line ? [POOL_KEY] : []), ...(chart.solid || chart.dashed ? [FEED_KEY] : [])] : [],
    nothingToPlot: NOTHING_TO_PLOT,
    decisions: decisionsOf(e, w),
    command: commandParts(e, w.id, row.symbol).join(" "),
    source: `${editionPath(e)} · head block ${formatInt(file.head.block)}`,
    footer: GAP_FOOTER,
    signOff: SIGN_OFF,
    stem: `gap-index-${e}-${w.id}-${row.symbol}`,
  };
}
