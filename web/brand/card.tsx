import type { ReactNode } from "react";
import satori, { type SatoriOptions } from "satori";
import { BALANCE, FEATHER_TOP, tickPath } from "../components/instrument/Balance";
import type { CheckMark } from "../content/engine";
import { clip, excerpt, type CardModel } from "../lib/card/model";
import { MARK, PALETTE } from "./mark";
import { dataUri, fonts, Grid, Lockup, png } from "./render";

// The Weighing card (npm run card, lib/card/cli.ts): one vault Decision in one fixed frame, at the two sizes a post
// carries. The layout is satori's, from the repo's own Geist files, so the same model always draws the same image.

export const CARD_LAYOUTS = {
  wide: { width: 1600, height: 900 },
  tall: { width: 1080, height: 1350 },
} as const;
export type CardLayout = keyof typeof CARD_LAYOUTS;

/**
 * The Balance's tick colours, the site's --color-lamp-pass, --color-lamp-refuse and --color-tick (app/globals.css, which
 * test/card-render.test.ts compares): a PNG cannot read CSS variables.
 */
export const TICK_COLOR: Readonly<Record<CheckMark, string>> = { PASS: "#4D6BFF", FAIL: "#FF5A1F", SKIP: "#C9CED8" };

const num = (n: number) => Number(n.toFixed(4));

/**
 * The Balance as components/instrument/Balance.tsx draws it, as a standalone SVG: the post, the two pans and the beam
 * with its nine ticks. A refusal tips the beam by BALANCE.refusedDeg about the pivot and moves each pan by the
 * translate app/globals.css gives it (8 units, the pivot to each end, times the tilt's cosine and sine).
 */
export function balanceSvg(balance: CardModel["balance"]): string {
  const tilt = balance.verdict === "refused" ? BALANCE.refusedDeg : 0;
  const rad = (tilt * Math.PI) / 180;
  const arm = BALANCE.pivot.x - BALANCE.ends.feather.x;
  const dx = num(arm * (1 - Math.cos(rad)));
  const dy = num(-arm * Math.sin(rad));
  const move = (x: number, y: number) => (tilt === 0 ? "" : ` transform="translate(${num(x)} ${num(y)})"`);
  const { feather, order } = BALANCE.ends;
  const box = MARK.order;
  const ink = PALETTE.ink;
  const ticks = balance.ticks
    .map((mark, i) => `<path d="${tickPath(i)}" stroke="${TICK_COLOR[mark]}" stroke-width="${BALANCE.tickWidth}" stroke-linecap="butt"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MARK.size}" height="${MARK.size}" viewBox="0 0 ${MARK.size} ${MARK.size}">` +
    `<path d="${BALANCE.post}" fill="none" stroke="${ink}" stroke-width="${MARK.beamWidth}" stroke-linecap="round"/>` +
    `<g${move(dx, dy)}>` +
    `<path d="M${feather.x} ${feather.y}V${FEATHER_TOP.y}" stroke="${ink}" stroke-width="${num(BALANCE.hangerWidth)}" stroke-linecap="round"/>` +
    `<path d="${MARK.feather}" transform="translate(${feather.x - FEATHER_TOP.x} 0)" fill="${PALETTE.feather}"/>` +
    `</g>` +
    `<g${move(-dx, -dy)}>` +
    `<path d="M${order.x} ${order.y}V${box.y}" stroke="${ink}" stroke-width="${num(BALANCE.hangerWidth)}" stroke-linecap="round"/>` +
    `<rect x="${order.x - box.size / 2}" y="${box.y}" width="${box.size}" height="${box.size}" rx="${box.radius}" fill="${ink}"/>` +
    `</g>` +
    `<g${tilt === 0 ? "" : ` transform="rotate(${tilt} ${BALANCE.pivot.x} ${BALANCE.pivot.y})"`}>` +
    `<path d="${BALANCE.bar}" fill="none" stroke="${ink}" stroke-width="${MARK.beamWidth}" stroke-linecap="round"/>${ticks}` +
    `</g></svg>`
  );
}

/** Sizes and text budgets of one layout. The budgets are characters; the layout test draws the longest cases. */
interface Spec {
  padX: number;
  padTop: number;
  padBottom: number;
  band: number;
  balance: number;
  gap: number;
  title: number;
  /** The largest headline; a long code or bill name is set smaller so it keeps to one line. */
  headline: number;
  /** The plate's inner width, which the headline must fit. */
  plateInner: number;
  verdict: number;
  intent: number;
  body: number;
  small: number;
  rationale: { alone: number; withBrief: number };
  brief: number;
  reply: number;
}

const SPECS: Readonly<Record<CardLayout, Spec>> = {
  wide: {
    padX: 80,
    padTop: 84,
    padBottom: 52,
    band: 52,
    balance: 300,
    gap: 64,
    title: 30,
    headline: 72,
    plateInner: 1600 - 2 * 80 - 300 - 64 - 2 * 28,
    verdict: 28,
    intent: 34,
    body: 24,
    small: 18,
    rationale: { alone: 300, withBrief: 150 },
    brief: 100,
    reply: 80,
  },
  tall: {
    padX: 72,
    padTop: 96,
    padBottom: 60,
    band: 56,
    balance: 280,
    gap: 44,
    title: 30,
    headline: 60,
    plateInner: 1080 - 2 * 72 - 280 - 44 - 2 * 24,
    verdict: 26,
    intent: 36,
    body: 26,
    small: 19,
    rationale: { alone: 420, withBrief: 220 },
    brief: 180,
    reply: 140,
  },
};

/** Geist Mono's advance, in ems; Geist's average letter is narrower than this. */
const MONO_EM = 0.6;
const SANS_EM = 0.56;

/** The headline's size: the layout's largest, or smaller so `text` keeps to one line of the plate. */
export function headlineSize(text: string, mono: boolean, spec: Pick<Spec, "headline" | "plateInner">): number {
  return Math.min(spec.headline, Math.floor(spec.plateInner / (text.length * (mono ? MONO_EM : SANS_EM))));
}

const MONO = "Geist Mono";
const caps = { fontFamily: MONO, fontWeight: 500, letterSpacing: "0.08em", color: PALETTE.ink2 } as const;

function Chip({ children, tone, size }: { children: string; tone: "accent" | "neutral" | "quiet"; size: number }) {
  const colors = tone === "accent" ? { color: PALETTE.accent, backgroundColor: PALETTE.accentTint } : { color: tone === "neutral" ? PALETTE.ink : PALETTE.ink2, backgroundColor: PALETTE.lineSoft };
  return (
    <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: size, padding: "4px 12px", borderRadius: 8, ...colors }}>{children}</span>
  );
}

function Band({ text, height }: { text: string; height: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: PALETTE.ink,
      }}
    >
      <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: Math.round(height * 0.46), letterSpacing: "0.14em", color: PALETTE.paper }}>{text}</span>
    </div>
  );
}

function Header({ m, spec }: { m: CardModel; spec: Spec }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
      <Lockup mark={44} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.small + 4, color: PALETTE.ink }}>{m.dateLine}</span>
        <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.small + 2, color: PALETTE.ink2 }}>{m.timeLine}</span>
      </div>
    </div>
  );
}

const PLATE = {
  refused: { backgroundColor: PALETTE.refuseTint, color: PALETTE.refuse },
  allowed: { backgroundColor: PALETTE.accentTint, color: PALETTE.accent },
  bill: { backgroundColor: PALETTE.lineSoft, color: PALETTE.ink },
} as const;

function Plate({ m, spec, pad }: { m: CardModel; spec: Spec; pad: string }) {
  const mono = m.plate === "refused";
  const tone = PLATE[m.plate];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: pad, borderRadius: 20, backgroundColor: tone.backgroundColor, flexShrink: 0 }}>
      <span
        style={{
          fontFamily: mono ? MONO : "Geist",
          fontWeight: 600,
          fontSize: headlineSize(m.headline, mono, spec),
          letterSpacing: mono ? "0em" : "-0.03em",
          lineHeight: 1.05,
          color: tone.color,
        }}
      >
        {m.headline}
      </span>
      <span style={{ fontWeight: 600, fontSize: spec.verdict, letterSpacing: "-0.01em", color: PALETTE.ink }}>{m.verdict}</span>
    </div>
  );
}

function Intent({ m, spec }: { m: CardModel; spec: Spec }) {
  if (m.bill) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: spec.intent - 6, letterSpacing: "-0.02em", color: PALETTE.ink }}>{m.bill.line}</span>
        <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.small, color: PALETTE.ink2 }}>
          {`intent ${m.intent}${m.bill.payee ? ` · payee ${m.bill.payee}` : ""}`}
        </span>
      </div>
    );
  }
  return <span style={{ fontWeight: 600, fontSize: spec.intent, letterSpacing: "-0.02em", color: PALETTE.ink, flexShrink: 0 }}>{m.intent}</span>;
}

const SENDER_TONE: Readonly<Record<string, "accent" | "neutral" | "quiet">> = {
  "owner, by hand": "neutral",
  agent: "accent",
  probe: "accent",
  "brief-driven": "accent",
};

function Sender({ m, spec }: { m: CardModel; spec: Spec }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexShrink: 0 }}>
      <span style={{ ...caps, fontSize: spec.small - 2 }}>SENT BY</span>
      <Chip tone={SENDER_TONE[m.sender] ?? "quiet"} size={spec.small + 2}>
        {m.sender}
      </Chip>
    </div>
  );
}

function Rationale({ m, spec }: { m: CardModel; spec: Spec }) {
  const r = m.rationale;
  const budget = m.briefs.length > 0 ? spec.rationale.withBrief : spec.rationale.alone;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ ...caps, fontSize: spec.small - 2 }}>RATIONALE</span>
        <Chip tone={r.state === "verified" ? "accent" : "quiet"} size={spec.small}>
          {r.status}
        </Chip>
        {r.state === "verified" ? <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.small - 2, color: PALETTE.ink2 }}>{r.by}</span> : null}
      </div>
      {r.state === "verified" ? (
        <span style={{ fontSize: spec.body, lineHeight: 1.4, color: PALETTE.ink, wordBreak: "break-word" }}>{`“${excerpt(r.text, budget)}”`}</span>
      ) : null}
      <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.small - 2, color: PALETTE.ink2 }}>{`rationaleHash ${m.rationaleHash}`}</span>
    </div>
  );
}

function Briefs({ m, spec }: { m: CardModel; spec: Spec }) {
  const [first, ...more] = m.briefs;
  if (!first) return null;
  const head = more.length === 0 ? first.head : `${first.head} · also ${more.map((b) => `#${b.id}`).join(", ")}`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 18, borderLeft: `3px solid ${PALETTE.line}`, flexShrink: 0 }}>
      <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: spec.small - 1, color: PALETTE.ink2 }}>{head}</span>
      <span style={{ fontSize: spec.body - 2, lineHeight: 1.35, color: first.hasText ? PALETTE.ink : PALETTE.ink2, wordBreak: "break-all" }}>
        {first.hasText ? `“${clip(first.text, spec.brief)}”` : first.text}
      </span>
      <span style={{ fontSize: spec.body - 4, lineHeight: 1.35, color: PALETTE.ink2, wordBreak: "break-all" }}>{`Reply: ${first.hasReply ? clip(first.reply, spec.reply) : first.reply}`}</span>
    </div>
  );
}

function Footer({ m, spec }: { m: CardModel; spec: Spec }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        marginTop: "auto",
        paddingTop: 20,
        borderTop: `1px solid ${PALETTE.line}`,
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontFamily: MONO, fontWeight: 500, fontSize: spec.small, color: PALETTE.ink2 }}>{`${m.block} · ${m.tx}`}</span>
        <span style={{ fontWeight: 500, fontSize: spec.small, color: PALETTE.ink2 }}>{m.footer}</span>
      </div>
      <span style={{ fontWeight: 600, fontSize: spec.title, letterSpacing: "-0.02em", color: PALETTE.ink }}>{m.signOff}</span>
    </div>
  );
}

function Title({ m, spec }: { m: CardModel; spec: Spec }) {
  return <span style={{ fontWeight: 600, fontSize: spec.title, letterSpacing: "-0.02em", color: PALETTE.ink, flexShrink: 0 }}>{m.title}</span>;
}

function BalanceImage({ m, size }: { m: CardModel; size: number }) {
  return <img src={dataUri(balanceSvg(m.balance))} width={size} height={size} />;
}

function Frame({ layout, m, children }: { layout: CardLayout; m: CardModel; children: ReactNode }) {
  const { width, height } = CARD_LAYOUTS[layout];
  const spec = SPECS[layout];
  return (
    <div style={{ width, height, display: "flex", position: "relative", backgroundColor: PALETTE.paper, fontFamily: "Geist", color: PALETTE.ink }}>
      <Grid />
      {m.band ? <Band text={m.band} height={spec.band} /> : null}
      {/* position: relative keeps the column above the absolutely positioned Grid. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          padding: `${spec.padTop}px ${spec.padX}px ${spec.padBottom}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Wide({ m }: { m: CardModel }) {
  const spec = SPECS.wide;
  return (
    <Frame layout="wide" m={m}>
      <Header m={m} spec={spec} />
      <div style={{ display: "flex", gap: spec.gap, marginTop: 36 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, width: spec.balance, flexShrink: 0 }}>
          <Title m={m} spec={spec} />
          <BalanceImage m={m} size={spec.balance} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          <Plate m={m} spec={spec} pad="22px 28px 24px" />
          {/* The intent shares a row with the sender; a long bill line wraps rather than push the chip out. */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", flexShrink: 1, minWidth: 0 }}>
              <Intent m={m} spec={spec} />
            </div>
            <Sender m={m} spec={spec} />
          </div>
          <Rationale m={m} spec={spec} />
          <Briefs m={m} spec={spec} />
        </div>
      </div>
      <Footer m={m} spec={spec} />
    </Frame>
  );
}

function Tall({ m }: { m: CardModel }) {
  const spec = SPECS.tall;
  return (
    <Frame layout="tall" m={m}>
      <Header m={m} spec={spec} />
      <div style={{ display: "flex", gap: spec.gap, marginTop: 44, alignItems: "flex-start" }}>
        <BalanceImage m={m} size={spec.balance} />
        <div style={{ display: "flex", flexDirection: "column", gap: 18, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}>
          <Title m={m} spec={spec} />
          <Plate m={m} spec={spec} pad="20px 24px 22px" />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 26, marginTop: 34 }}>
        <Intent m={m} spec={spec} />
        <Sender m={m} spec={spec} />
        <Rationale m={m} spec={spec} />
        <Briefs m={m} spec={spec} />
      </div>
      <Footer m={m} spec={spec} />
    </Frame>
  );
}

// Read once per process: both sizes, and a test's many cards, share the same font buffers.
let cardFonts: SatoriOptions["fonts"] | undefined;

/** The card as SVG. `onNodeDetected` gets the box of every element, so a test can see what it shows and where. */
export function cardSvg(m: CardModel, layout: CardLayout, onNodeDetected?: SatoriOptions["onNodeDetected"]): Promise<string> {
  cardFonts ??= fonts();
  const { width, height } = CARD_LAYOUTS[layout];
  return satori(layout === "wide" ? <Wide m={m} /> : <Tall m={m} />, { width, height, fonts: cardFonts, onNodeDetected });
}

/** "weighing-1-dfdb6739-1600x900.png". */
export function cardFileName(m: CardModel, layout: CardLayout): string {
  const { width, height } = CARD_LAYOUTS[layout];
  return `${m.stem}-${width}x${height}.png`;
}

/** Both sizes of the card as PNGs, wide first. */
export async function renderCard(m: CardModel): Promise<{ layout: CardLayout; file: string; png: Buffer }[]> {
  const out: { layout: CardLayout; file: string; png: Buffer }[] = [];
  for (const layout of Object.keys(CARD_LAYOUTS) as CardLayout[]) {
    out.push({ layout, file: cardFileName(m, layout), png: png(await cardSvg(m, layout), CARD_LAYOUTS[layout].width) });
  }
  return out;
}
