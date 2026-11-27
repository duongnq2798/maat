import satori, { type SatoriNode } from "satori";
import type { GapCardModel } from "../lib/card/gap";
import { CARD_LAYOUTS, cardFontSet, caps, Chip, FOOTER_CLEARANCE, footerRule, Frame, insideMargins, MONO, SENDER_TONE, type CardLayout, type CardSvgOptions } from "./card";
import { PALETTE } from "./mark";
import { dataUri, Lockup, png } from "./render";

// The Gap Index card (npm run card -- --gap-edition N --window ID, lib/card/cli.ts): one closed window of an edition,
// in the Weighing card's frame (brand/card.tsx), at the same two sizes. The figures are lib/card/gap.ts's, which are
// /gap-index's; only the drawing is the card's own.

/**
 * The pool line's hue by where the pool sat against the held answer. /gap-index draws "below" in --color-refuse
 * (GAP_TONE in components/gap/GapChart.tsx); on an image Maat shares, orange means only a refusal, so it is ink here.
 */
export const GAP_CARD_TONE = { above: PALETTE.accent, below: PALETTE.ink, at: PALETTE.ink } as const;

/** The pool line's hue for the card's token: the accent only for a gap above the held answer. */
const toneOf = (m: GapCardModel) => (m.figure.kind === "gap" ? GAP_CARD_TONE[m.figure.side] : PALETTE.ink);

/** The page's chart viewBox, which lib/card/gap.ts's paths are in. */
const VIEW = { width: 1000, height: 300 } as const;
/** Room kept around the plot inside the chart image, so the end dot and the strokes are never cut. */
const INSET = 10;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** An SVG path of M, L, H, V and Z commands, from the page's viewBox onto a plot `w` by `h` at (INSET, INSET). */
export function scalePath(d: string, w: number, h: number): string {
  const sx = (x: number) => r1(INSET + (x * w) / VIEW.width);
  const sy = (y: number) => r1(INSET + (y * h) / VIEW.height);
  return [...d.matchAll(/([MLHVZ])([^MLHVZ]*)/g)]
    .map(([, cmd, args]) => {
      const n = args!.trim() === "" ? [] : args!.trim().split(/[\s,]+/).map(Number);
      if (cmd === "H") return `H${sx(n[0]!)}`;
      if (cmd === "V") return `V${sy(n[0]!)}`;
      if (cmd === "Z") return "Z";
      const pairs: string[] = [];
      for (let i = 0; i < n.length; i += 2) pairs.push(`${sx(n[i]!)} ${sy(n[i + 1]!)}`);
      return `${cmd}${pairs.join(" ")}`;
    })
    .join("");
}

/**
 * The window's chart as /gap-index draws it, X style, at `width` by `height` pixels: the pool line over a fill that
 * fades out, the feed as a thin step line, dashed while it held its answer, and a dot at the last pool point.
 */
export function gapChartSvg(m: GapCardModel, width: number, height: number): string {
  const geo = m.chart;
  const w = width - 2 * INSET;
  const h = height - 2 * INSET;
  const tone = toneOf(m);
  const parts: string[] = [];
  if (geo) {
    if (geo.fill) {
      parts.push(
        `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity="0.18"/><stop offset="1" stop-color="${tone}" stop-opacity="0"/></linearGradient></defs>`,
        `<path d="${scalePath(geo.fill, w, h)}" fill="url(#fade)" stroke="none"/>`,
      );
    }
    const feed = `fill="none" stroke="${PALETTE.ink2}" stroke-width="2"`;
    if (geo.solid) parts.push(`<path d="${scalePath(geo.solid, w, h)}" ${feed}/>`);
    if (geo.dashed) parts.push(`<path d="${scalePath(geo.dashed, w, h)}" ${feed} stroke-dasharray="9 7"/>`);
    if (geo.line) parts.push(`<path d="${scalePath(geo.line, w, h)}" fill="none" stroke="${tone}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`);
    if (geo.last) {
      const x = r1(INSET + (geo.last[0] * w) / VIEW.width);
      const y = r1(INSET + (geo.last[1] * h) / VIEW.height);
      parts.push(`<circle cx="${x}" cy="${y}" r="8" fill="${PALETTE.paper}"/><circle cx="${x}" cy="${y}" r="5.5" fill="${tone}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** Sizes of one layout. The 1080x1350 card is read across a phone, so no text on it is under 24 px; the wide one's 18. */
interface Spec {
  /** Between the card's blocks. */
  gap: number;
  title: number;
  blocks: number;
  span: number;
  note: number;
  symbol: number;
  name: number;
  label: number;
  value: number;
  side: number;
  prices: number;
  statLabel: number;
  statValue: number;
  /** The chart's ends and keys, and a Decision's time and sender. */
  small: number;
  sentence: number;
  verdict: number;
  source: number;
  footer: number;
  signOff: number;
  /** The chart's heights, tallest first: a card with Decisions to list draws it shorter. */
  charts: readonly number[];
}

const SPECS: Readonly<Record<CardLayout, Spec>> = {
  wide: {
    gap: 24,
    title: 24,
    blocks: 22,
    span: 40,
    note: 24,
    symbol: 30,
    name: 22,
    label: 18,
    value: 80,
    side: 22,
    prices: 18,
    statLabel: 18,
    statValue: 30,
    small: 18,
    sentence: 22,
    verdict: 20,
    source: 22,
    footer: 24,
    signOff: 30,
    charts: [250, 220, 190, 160, 140],
  },
  tall: {
    gap: 20,
    title: 24,
    blocks: 24,
    span: 36,
    note: 26,
    symbol: 30,
    name: 24,
    label: 24,
    value: 76,
    side: 24,
    prices: 24,
    statLabel: 24,
    statValue: 32,
    small: 24,
    sentence: 24,
    verdict: 24,
    source: 24,
    footer: 28,
    signOff: 34,
    charts: [220, 190, 160, 140, 120],
  },
};

/** The wide card's figure column; the chart and the Decisions take the rest. */
const FIGURE_COLUMN = 500;
/** The inner width of each layout: the card's width less the frame's padding (brand/card.tsx SPECS). */
const INNER: Readonly<Record<CardLayout, number>> = { wide: 1600 - 2 * 80, tall: 1080 - 2 * 72 };

/** How much of the card a fit draws: the chart's height and how many of the window's Decisions get a row. */
interface Fit {
  chart: number;
  rows: number;
}

/**
 * The fits a card tries, in order: every Decision's row with the chart at each height, tallest first; then the shortest
 * chart with one row fewer each time, down to none, when the sentence alone says how many there were.
 */
export function gapFits(layout: CardLayout, decisions: number): Fit[] {
  const { charts } = SPECS[layout];
  const shortest = charts.at(-1)!;
  const fits: Fit[] = charts.map((chart) => ({ chart, rows: decisions }));
  for (let rows = Math.min(decisions - 1, 8); rows >= 0; rows--) fits.push({ chart: shortest, rows });
  return fits;
}

function Header({ m, spec }: { m: GapCardModel; spec: Spec }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
      <Lockup mark={44} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.title, color: PALETTE.ink }}>{m.title}</span>
        <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.blocks, color: PALETTE.ink2 }}>{m.blocks}</span>
      </div>
    </div>
  );
}

function Span({ m, spec }: { m: GapCardModel; spec: Spec }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
      <span style={{ fontWeight: 600, fontSize: spec.span, letterSpacing: "-0.03em", lineHeight: 1.15, color: PALETTE.ink }}>{m.span}</span>
      <span style={{ fontWeight: 500, fontSize: spec.note, color: PALETTE.ink2 }}>{m.note}</span>
    </div>
  );
}

function Figure({ m, spec, layout }: { m: GapCardModel; spec: Spec; layout: CardLayout }) {
  const f = m.figure;
  const side = { fontWeight: 500, fontSize: spec.side } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: spec.symbol, letterSpacing: "-0.02em", color: PALETTE.ink }}>{m.symbol}</span>
        {m.name ? <span style={{ fontWeight: 400, fontSize: spec.name, color: PALETTE.ink2 }}>{m.name}</span> : null}
      </div>
      {f.kind === "gap" ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 16 }}>
          <span style={{ ...caps, fontSize: spec.label }}>{f.label.toUpperCase()}</span>
          <span style={{ fontWeight: 600, fontSize: spec.value, letterSpacing: "-0.04em", lineHeight: 1, marginTop: 8, color: toneOf(m) }}>{f.value}</span>
          {/* The side, then when: on one line across the tall card, one under the other in the wide card's column. */}
          <div style={{ display: "flex", flexDirection: layout === "tall" ? "row" : "column", columnGap: 8, rowGap: 2, marginTop: 12 }}>
            <span style={{ ...side, color: PALETTE.ink }}>{f.sideText}</span>
            {layout === "tall" ? <span style={{ ...side, color: PALETTE.ink2 }}>·</span> : null}
            <span style={{ ...side, color: PALETTE.ink2 }}>{f.at}</span>
          </div>
          <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.prices, marginTop: 6, color: PALETTE.ink2 }}>{f.prices}</span>
        </div>
      ) : (
        <span style={{ fontWeight: 600, fontSize: spec.symbol, letterSpacing: "-0.02em", lineHeight: 1.2, marginTop: 16, color: PALETTE.ink2 }}>{f.text}</span>
      )}
    </div>
  );
}

/**
 * The other figures, each label over its value: two to a row in the wide card's figure column, all four in one row
 * across the tall card, spread by their labels' widths so that no label wraps.
 */
function Stats({ m, spec, layout }: { m: GapCardModel; spec: Spec; layout: CardLayout }) {
  const row = layout === "tall";
  return (
    <div style={{ display: "flex", flexWrap: row ? "nowrap" : "wrap", justifyContent: row ? "space-between" : "flex-start", rowGap: 14, flexShrink: 0 }}>
      {m.stats.map((s) => (
        <div key={s.key} style={{ display: "flex", flexDirection: "column", gap: 4, ...(row ? {} : { width: "50%" }) }}>
          <span style={{ fontWeight: 500, fontSize: spec.statLabel, color: PALETTE.ink2 }}>{s.label}</span>
          <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: spec.statValue, color: PALETTE.ink }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}

/** The key line drawn before a legend entry, as the page draws it: solid for the pool, dashed for the feed. */
function keySvg(color: string, dashed: boolean): string {
  const dash = dashed ? ' stroke-dasharray="4 4"' : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="10" viewBox="0 0 28 10"><path d="M2 5H26" stroke="${color}" stroke-width="${dashed ? 2 : 3}" stroke-linecap="round"${dash}/></svg>`;
}

function Chart({ m, spec, width, height }: { m: GapCardModel; spec: Spec; width: number; height: number }) {
  const small = { fontWeight: 500, fontSize: spec.small, color: PALETTE.ink2 } as const;
  if (!m.chart) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height, border: `2px dashed ${PALETTE.line}`, borderRadius: 16, flexShrink: 0 }}>
        <span style={small}>{m.nothingToPlot}</span>
      </div>
    );
  }
  // The pool's key is first when the chart has a pool line (lib/card/gap.ts lists the keys as the page does).
  const poolKey = m.chart.line !== "";
  return (
    <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
      <img src={dataUri(gapChartSvg(m, width, height))} width={width} height={height} />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginTop: 6 }}>
        <span style={{ ...small, fontFamily: MONO }}>{m.ends[0]}</span>
        <span style={{ ...small, fontFamily: MONO }}>{m.ends[1]}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        {m.legend.map((key, i) => {
          const pool = i === 0 && poolKey;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <img src={dataUri(keySvg(pool ? toneOf(m) : PALETTE.ink2, !pool))} width={28} height={10} />
              <span style={small}>{key}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The sentence /gap-index prints for the window's Decisions, which gives their count and ends on where each one is,
 * then a row for each one that fits, in chain order: its time, its sender as /ledger labels it and its verdict. The tall
 * card leaves the sender chip out when every Decision has the same sender, which the sentence names.
 */
function Decisions({ m, spec, rows, layout }: { m: GapCardModel; spec: Spec; rows: number; layout: CardLayout }) {
  const d = m.decisions;
  const shown = d.rows.slice(0, rows);
  const tall = layout === "tall";
  const chips = !tall || new Set(d.rows.map((r) => r.sender)).size > 1;
  return (
    <div style={{ display: "flex", flexDirection: tall ? "row" : "column", alignItems: "flex-start", gap: tall ? 20 : 10, flexShrink: 0 }}>
      <span style={{ ...caps, fontSize: spec.label, flexShrink: 0, marginTop: tall ? 3 : 0 }}>DECISIONS</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
        <span style={{ fontWeight: 500, fontSize: spec.sentence, lineHeight: 1.35, color: PALETTE.ink }}>{d.sentence}</span>
        {shown.map((r, i) => (
          <div key={i} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 16, rowGap: 6 }}>
            <span style={{ fontWeight: 500, fontSize: spec.small, color: PALETTE.ink2 }}>{r.at}</span>
            {chips ? (
              <Chip tone={SENDER_TONE[r.sender] ?? "quiet"} size={spec.small}>
                {r.sender}
              </Chip>
            ) : null}
            <span style={{ fontWeight: 500, fontSize: spec.verdict, color: PALETTE.ink }}>{r.verdict}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceLine({ m, spec }: { m: GapCardModel; spec: Spec }) {
  return <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.source, color: PALETTE.ink2 }}>{m.source}</span>;
}
function FooterLine({ m, spec }: { m: GapCardModel; spec: Spec }) {
  return <span style={{ fontWeight: 500, fontSize: spec.footer, color: PALETTE.ink2 }}>{m.footer}</span>;
}
function SignOff({ m, spec }: { m: GapCardModel; spec: Spec }) {
  return <span style={{ fontWeight: 600, fontSize: spec.signOff, letterSpacing: "-0.02em", color: PALETTE.ink }}>{m.signOff}</span>;
}

function Wide({ m, fit }: { m: GapCardModel; fit: Fit }) {
  const spec = SPECS.wide;
  const column = 56;
  return (
    <Frame layout="wide" band={null}>
      <Header m={m} spec={spec} />
      <div style={{ display: "flex", flexDirection: "column", marginTop: 28 }}>
        <Span m={m} spec={spec} />
      </div>
      <div style={{ display: "flex", gap: column, marginTop: 28, marginBottom: FOOTER_CLEARANCE }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 28, width: FIGURE_COLUMN, flexShrink: 0 }}>
          <Figure m={m} spec={spec} layout="wide" />
          <Stats m={m} spec={spec} layout="wide" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: spec.gap, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          <Chart m={m} spec={spec} width={INNER.wide - FIGURE_COLUMN - column} height={fit.chart} />
          <Decisions m={m} spec={spec} rows={fit.rows} layout="wide" />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", ...footerRule }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SourceLine m={m} spec={spec} />
          <FooterLine m={m} spec={spec} />
        </div>
        <SignOff m={m} spec={spec} />
      </div>
    </Frame>
  );
}

function Tall({ m, fit }: { m: GapCardModel; fit: Fit }) {
  const spec = SPECS.tall;
  return (
    <Frame layout="tall" band={null}>
      <Header m={m} spec={spec} />
      <div style={{ display: "flex", flexDirection: "column", gap: spec.gap, marginTop: 28, marginBottom: FOOTER_CLEARANCE }}>
        <Span m={m} spec={spec} />
        <Figure m={m} spec={spec} layout="tall" />
        <Chart m={m} spec={spec} width={INNER.tall} height={fit.chart} />
        <Stats m={m} spec={spec} layout="tall" />
        <Decisions m={m} spec={spec} rows={fit.rows} layout="tall" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, ...footerRule }}>
        <SourceLine m={m} spec={spec} />
        <FooterLine m={m} spec={spec} />
        <div style={{ display: "flex", marginTop: 8 }}>
          <SignOff m={m} spec={spec} />
        </div>
      </div>
    </Frame>
  );
}

/**
 * The card as SVG, at the first of gapFits whose text keeps inside the margins. Throws when even the shortest chart
 * with no Decision row does not fit, so a card is never drawn without its source, footer and sign-off.
 */
export async function gapCardSvg(m: GapCardModel, layout: CardLayout, options: CardSvgOptions = {}): Promise<string> {
  const { width, height } = CARD_LAYOUTS[layout];
  for (const fit of gapFits(layout, m.decisions.rows.length)) {
    const nodes: SatoriNode[] = [];
    const svg = await satori(layout === "wide" ? <Wide m={m} fit={fit} /> : <Tall m={m} fit={fit} />, {
      width,
      height,
      fonts: cardFontSet(),
      embedFont: options.embedFont ?? true,
      onNodeDetected: (n) => nodes.push(n),
    });
    if (insideMargins(nodes, null, width, height)) {
      if (options.onNodeDetected) for (const n of nodes) options.onNodeDetected(n);
      return svg;
    }
  }
  throw new Error(`the ${width}x${height} card ${m.stem} does not fit its frame, even with the shortest chart and no Decision row`);
}

/** "gap-index-0-2026-11-13-NVDAc-1600x900.png". */
export function gapCardFileName(m: GapCardModel, layout: CardLayout): string {
  const { width, height } = CARD_LAYOUTS[layout];
  return `${m.stem}-${width}x${height}.png`;
}

/** Both sizes of the card as PNGs, wide first. */
export async function renderGapCard(m: GapCardModel): Promise<{ layout: CardLayout; file: string; png: Buffer }[]> {
  const out: { layout: CardLayout; file: string; png: Buffer }[] = [];
  for (const layout of Object.keys(CARD_LAYOUTS) as CardLayout[]) {
    out.push({ layout, file: gapCardFileName(m, layout), png: png(await gapCardSvg(m, layout), CARD_LAYOUTS[layout].width) });
  }
  return out;
}
