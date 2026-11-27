import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import satori, { type SatoriOptions } from "satori";
import { ASK_INVITATION } from "../content/ask-card";
import { type CardPage, PAGE_CARDS, type PageCard } from "../content/page-cards";
import { REASON_LABEL, type RefusalCode, reasonText } from "../content/reasons";
import { OG_IMAGE_SIZE, type OgCard } from "../lib/docs/og";
import { SITE } from "../lib/site";
import { MARK, PALETTE } from "./mark";

export interface BrandFile {
  /** Relative to web/. */
  path: string;
  data: Buffer | string;
}

// From web/, where npm runs the brand script, the tests and next build. Not new URL(..., import.meta.url): next build
// bundles this file for app/og/[...slug]/route.ts, and Turbopack cannot resolve a folder named that way.
const FONT_DIR = join(process.cwd(), "node_modules/geist/dist/fonts");
/** The refusal the OG card and the X banner show: check 04, the market session, fails. */
const REFUSAL: RefusalCode = "MARKET_CLOSED";
const OG_ALT = `Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses: ${reasonText(REFUSAL)}.`;
/** Wide enough for mark + gap + "maat". Tune by eye in Step 5 so the wordmark ends 4-8 px from the right edge. */
const LOCKUP_WIDTH = 184;

export function fonts(): SatoriOptions["fonts"] {
  const sans = (file: string) => readFileSync(join(FONT_DIR, "geist-sans", file));
  const mono = (file: string) => readFileSync(join(FONT_DIR, "geist-mono", file));
  return [
    { name: "Geist", data: sans("Geist-Regular.ttf"), weight: 400, style: "normal" },
    { name: "Geist", data: sans("Geist-Medium.ttf"), weight: 500, style: "normal" },
    { name: "Geist", data: sans("Geist-SemiBold.ttf"), weight: 600, style: "normal" },
    { name: "Geist Mono", data: mono("GeistMono-Medium.ttf"), weight: 500, style: "normal" },
    { name: "Geist Mono", data: mono("GeistMono-SemiBold.ttf"), weight: 600, style: "normal" },
  ];
}

function svgDoc(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">${body}</svg>`;
}

function glyph(fg: string, feather: string): string {
  const o = MARK.order;
  return (
    `<path d="${MARK.beam}" fill="none" stroke="${fg}" stroke-width="${MARK.beamWidth}" stroke-linecap="round"/>` +
    `<path d="${MARK.feather}" fill="${feather}"/>` +
    `<rect x="${o.x}" y="${o.y}" width="${o.size}" height="${o.size}" rx="${o.radius}" fill="${fg}"/>`
  );
}

/** dark: the site mark. light: outlined tile for white backgrounds. */
export function markSvg(variant: "dark" | "light" = "dark"): string {
  if (variant === "dark") {
    return svgDoc(`<rect width="30" height="30" rx="${MARK.radius}" fill="${PALETTE.ink}"/>${glyph(PALETTE.paper, PALETTE.feather)}`);
  }
  return svgDoc(
    `<rect x="0.75" y="0.75" width="28.5" height="28.5" rx="${MARK.radius - 0.75}" fill="${PALETTE.paper}" stroke="${PALETTE.ink}" stroke-width="1.5"/>${glyph(PALETTE.ink, PALETTE.accent)}`,
  );
}

/** Full-bleed tile for the X avatar and Apple touch icon; those platforms crop or round it themselves. */
export function avatarSvg(): string {
  return svgDoc(
    `<rect width="30" height="30" fill="${PALETTE.ink}"/><g transform="translate(15 15) scale(0.8) translate(-15 -14.5)">${glyph(PALETTE.paper, PALETTE.feather)}</g>`,
  );
}

export const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
export const png = (svg: string, width: number): Buffer =>
  new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();

export function pngSize(buf: Buffer): { width: number; height: number } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** A one-image .ico that embeds the PNG as is (supported by every current browser). */
export function pngToIco(pngData: Buffer, size: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngData.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, pngData]);
}

// ---- satori layouts (every element with more than one child needs display: flex)

export function Grid() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        backgroundImage: `linear-gradient(${PALETTE.grid} 1px, transparent 1px), linear-gradient(90deg, ${PALETTE.grid} 1px, transparent 1px)`,
        backgroundSize: "56px 56px",
      }}
    />
  );
}

export function Lockup({ mark }: { mark: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(mark * 0.33) }}>
      <img src={dataUri(markSvg("dark"))} width={mark} height={mark} />
      <span style={{ fontSize: Math.round(mark * 0.7), fontWeight: 600, letterSpacing: "-0.03em", color: PALETTE.ink }}>
        maat
      </span>
    </div>
  );
}

function CheckRow({ n, label, fail }: { n: string; label: string; fail?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        borderRadius: 12,
        backgroundColor: fail ? PALETTE.refuseTint : PALETTE.paper,
      }}
    >
      <span style={{ fontFamily: "Geist Mono", fontSize: 16, fontWeight: 500, color: PALETTE.ink2 }}>{n}</span>
      <span style={{ flexGrow: 1, fontSize: 20, fontWeight: 500 }}>{label}</span>
      <span
        style={{
          fontFamily: "Geist Mono",
          fontSize: 15,
          fontWeight: 600,
          padding: "5px 10px",
          borderRadius: 8,
          color: fail ? PALETTE.paper : PALETTE.accent,
          backgroundColor: fail ? PALETTE.refuse : PALETTE.accentTint,
        }}
      >
        {fail ? "FAIL" : "PASS"}
      </span>
    </div>
  );
}

function Og() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        position: "relative",
        backgroundColor: PALETTE.paper,
        fontFamily: "Geist",
        color: PALETTE.ink,
      }}
    >
      <Grid />
      {/* position: relative keeps this column above the absolutely positioned Grid (non-positioned boxes paint below positioned ones). */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          width: 720,
        }}
      >
        <Lockup mark={44} />
        <div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1.02 }}>
          <span>The AI agent</span>
          <span>that knows</span>
          <span style={{ color: PALETTE.accent }}>when not to trade.</span>
        </div>
        <span style={{ fontFamily: "Geist Mono", fontSize: 22, fontWeight: 500, color: PALETTE.ink2 }}>{SITE.tagline}</span>
      </div>
      <div
        style={{
          position: "absolute",
          right: 72,
          top: 168,
          width: 380,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 16,
          backgroundColor: PALETTE.paper,
          border: `1px solid ${PALETTE.line}`,
          borderRadius: 24,
          // No negative spread: resvg 2.6.2 panics on it.
          boxShadow: "0 24px 48px rgba(11,13,18,0.14)",
        }}
      >
        <CheckRow n="03" label="Vault policy" />
        <CheckRow n="04" label="Market session" fail />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 6,
            padding: "18px 20px",
            borderRadius: 16,
            backgroundColor: PALETTE.ink,
            color: PALETTE.paper,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontFamily: "Geist Mono", fontSize: 13, fontWeight: 500, opacity: 0.8 }}>VAULT DECISION</span>
            <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.03em" }}>Refused</span>
          </div>
          {/* The plain label first, the onchain code small under it, as the site's stacked ReasonTag shows a refusal. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{REASON_LABEL[REFUSAL]}</span>
            <span style={{ fontFamily: "Geist Mono", fontSize: 13, fontWeight: 500, opacity: 0.8 }}>{REFUSAL}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A check's result. `code`, when given, follows the text in smaller type: the onchain code after its plain label. */
function Badge({ text, code, fail }: { text: string; code?: string; fail?: boolean }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        fontFamily: "Geist Mono",
        fontSize: 20,
        fontWeight: 600,
        padding: "8px 14px",
        borderRadius: 10,
        color: fail ? PALETTE.paper : PALETTE.accent,
        backgroundColor: fail ? PALETTE.refuse : PALETTE.accentTint,
      }}
    >
      <span>{text}</span>
      {code === undefined ? null : <span style={{ fontSize: 14, fontWeight: 500 }}>{code}</span>}
    </span>
  );
}

/**
 * A docs page's link preview (lib/docs/og.ts): the lockup and "Docs", then the page's section, its title and its status
 * label, or the docs home's description, inside the same 64 x 72 px margins as the landing's image. Boxes do not shrink,
 * so a title too long to fit pushes the label past the bottom margin, where test/docs-og.test.ts sees it, instead of
 * overflowing a squeezed box.
 */
function DocsOg({ card }: { card: OgCard }) {
  const status = "status" in card ? card.status : undefined;
  return (
    <div
      style={{
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
        display: "flex",
        position: "relative",
        backgroundColor: PALETTE.paper,
        fontFamily: "Geist",
        color: PALETTE.ink,
      }}
    >
      <Grid />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          // Grows to the whole image: a width or height here would not include the padding.
          flexGrow: 1,
          padding: "64px 72px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
          <Lockup mark={44} />
          <span style={{ fontSize: 31, fontWeight: 500, letterSpacing: "-0.03em", color: PALETTE.ink2 }}>Docs</span>
        </div>
        {"description" in card ? (
          <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.15, flexShrink: 0 }}>
            {card.description}
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20, flexShrink: 0 }}>
            {card.section === undefined ? null : (
              <span style={{ fontFamily: "Geist Mono", fontSize: 26, fontWeight: 500, color: PALETTE.accent }}>{card.section}</span>
            )}
            <span style={{ fontSize: 72, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.05 }}>{card.title}</span>
          </div>
        )}
        {/* A fixed height, so the title sits at the same place on a page with no label. */}
        <div style={{ display: "flex", alignItems: "center", height: 56, flexShrink: 0 }}>
          {status === undefined ? null : (
            <span
              style={{
                fontSize: 24,
                fontWeight: 500,
                padding: "8px 18px",
                borderRadius: 24,
                border: `1px solid ${PALETTE.line}`,
                backgroundColor: PALETTE.lineSoft,
              }}
            >
              {status}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * /ask's link preview (content/ask-card.ts): the lockup, the invitation line with its second sentence in the accent, the
 * mechanism line, and the mark at rest beside them, inside the landing image's 64 x 72 px margins. It shows no verdict
 * and no figure, so it claims no weighing.
 */
function AskOg() {
  const [lure, lastWord] = ASK_INVITATION.split(/(?<=\.) /);
  return (
    <div
      style={{
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
        display: "flex",
        position: "relative",
        backgroundColor: PALETTE.paper,
        fontFamily: "Geist",
        color: PALETTE.ink,
      }}
    >
      <Grid />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          width: 840,
        }}
      >
        <Lockup mark={44} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: 62, fontWeight: 600, letterSpacing: "-0.045em", lineHeight: 1.04 }}>
          <span>{lure}</span>
          <span style={{ color: PALETTE.accent }}>{lastWord}</span>
        </div>
        <span style={{ fontFamily: "Geist Mono", fontSize: 22, fontWeight: 500, color: PALETTE.ink2 }}>Claude proposes. The vault decides.</span>
      </div>
      <div style={{ position: "absolute", right: 72, top: 205, display: "flex" }}>
        <img src={dataUri(markSvg("dark"))} width={220} height={220} />
      </div>
    </div>
  );
}

/**
 * The link preview of /now, /ledger, /gap-index or /proof (content/page-cards.ts), laid out as /ask's: the lockup with
 * the page's h1 beside it, as a docs card names "Docs", the line from the page's lead with its second part in the
 * accent, the tagline, and the mark at rest beside them, inside the landing image's 64 x 72 px margins. The longer a
 * line, the smaller its type, so every line fits its column. It shows no verdict and no figure, so it claims no weighing.
 */
function PageOg({ card }: { card: PageCard }) {
  const length = card.line.join(" ").length;
  const size = length <= 90 ? 58 : length <= 125 ? 50 : 44;
  return (
    <div
      style={{
        width: OG_IMAGE_SIZE.width,
        height: OG_IMAGE_SIZE.height,
        display: "flex",
        position: "relative",
        backgroundColor: PALETTE.paper,
        fontFamily: "Geist",
        color: PALETTE.ink,
      }}
    >
      <Grid />
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          // The content box: the line ends 76 px left of the mark (satori adds the padding to this width).
          width: 760,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Lockup mark={44} />
          <span style={{ fontSize: 31, fontWeight: 500, letterSpacing: "-0.03em", color: PALETTE.ink2 }}>{card.heading}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: size, fontWeight: 600, letterSpacing: "-0.04em", lineHeight: 1.08 }}>
          <span>{card.line[0]}</span>
          <span style={{ color: PALETTE.accent }}>{card.line[1]}</span>
        </div>
        <span style={{ fontFamily: "Geist Mono", fontSize: 22, fontWeight: 500, color: PALETTE.ink2 }}>{SITE.tagline}</span>
      </div>
      <div style={{ position: "absolute", right: 72, top: 205, display: "flex" }}>
        <img src={dataUri(markSvg("dark"))} width={220} height={220} />
      </div>
    </div>
  );
}

/** Content sits right of x = 560 so the avatar never covers it. */
function Banner() {
  return (
    <div
      style={{
        width: 1500,
        height: 500,
        display: "flex",
        position: "relative",
        backgroundColor: PALETTE.paper,
        fontFamily: "Geist",
        color: PALETTE.ink,
      }}
    >
      <Grid />
      <div
        style={{
          position: "absolute",
          left: 560,
          right: 96,
          top: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 28,
        }}
      >
        <span style={{ fontSize: 68, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1 }}>{SITE.tagline}</span>
        <div style={{ display: "flex", gap: 12 }}>
          <Badge text="PASS" />
          <Badge text="PASS" />
          <Badge text={`FAIL · ${REASON_LABEL[REFUSAL]}`} code={REFUSAL} fail />
        </div>
        <span style={{ fontFamily: "Geist Mono", fontSize: 20, fontWeight: 500, color: PALETTE.ink2 }}>
          The AI agent that knows when not to trade.
        </span>
      </div>
    </div>
  );
}

/** The landing's link preview (brand/out/og.png, app/opengraph-image.png) as SVG. `onNodeDetected` gets the box of every element, so a test can see what it shows. */
export function ogSvg(onNodeDetected?: SatoriOptions["onNodeDetected"], f: SatoriOptions["fonts"] = fonts()): Promise<string> {
  return satori(<Og />, { width: 1200, height: 630, fonts: f, onNodeDetected });
}

/** /ask's link preview as SVG, with the same `onNodeDetected` as ogSvg. */
export function askOgSvg(onNodeDetected?: SatoriOptions["onNodeDetected"], f: SatoriOptions["fonts"] = fonts()): Promise<string> {
  return satori(<AskOg />, { ...OG_IMAGE_SIZE, fonts: f, onNodeDetected });
}

/** /ask's link preview as a PNG, drawn when the site is built (app/og/ask.png/route.ts). Never written to brand/out. */
export async function renderAskOg(): Promise<Buffer> {
  return png(await askOgSvg(), OG_IMAGE_SIZE.width);
}

/** The link preview of /now, /ledger, /gap-index or /proof as SVG, with the same `onNodeDetected` as ogSvg. */
export function pageOgSvg(page: CardPage, onNodeDetected?: SatoriOptions["onNodeDetected"], f: SatoriOptions["fonts"] = fonts()): Promise<string> {
  return satori(<PageOg card={PAGE_CARDS[page]} />, { ...OG_IMAGE_SIZE, fonts: f, onNodeDetected });
}

/** A page's link preview as a PNG, drawn when the site is built (app/og/<page>.png/route.ts). Never written to brand/out. */
export async function renderPageOg(page: CardPage): Promise<Buffer> {
  return png(await pageOgSvg(page), OG_IMAGE_SIZE.width);
}

/** The X header (brand/out/x-banner.png) as SVG, with the same `onNodeDetected` as ogSvg. */
export function xBannerSvg(onNodeDetected?: SatoriOptions["onNodeDetected"], f: SatoriOptions["fonts"] = fonts()): Promise<string> {
  return satori(<Banner />, { width: 1500, height: 500, fonts: f, onNodeDetected });
}

export async function renderBrand(): Promise<BrandFile[]> {
  const f = fonts();
  const lockup = await satori(<Lockup mark={60} />, { width: LOCKUP_WIDTH, height: 60, fonts: f });
  const og = png(await ogSvg(undefined, f), 1200);
  const banner = png(await xBannerSvg(undefined, f), 1500);
  const favicon = png(markSvg("dark"), 32);
  const icon = png(markSvg("dark"), 512);
  const apple = png(avatarSvg(), 180);
  const avatar = png(avatarSvg(), 400);

  return [
    { path: "brand/src/mark.svg", data: markSvg("dark") },
    { path: "brand/src/mark-light.svg", data: markSvg("light") },
    { path: "brand/src/lockup.svg", data: lockup },
    { path: "brand/out/favicon-32.png", data: favicon },
    { path: "brand/out/icon-512.png", data: icon },
    { path: "brand/out/apple-icon-180.png", data: apple },
    { path: "brand/out/og.png", data: og },
    { path: "brand/out/x-avatar.png", data: avatar },
    { path: "brand/out/x-banner.png", data: banner },
    { path: "app/icon.png", data: icon },
    { path: "app/apple-icon.png", data: apple },
    { path: "app/favicon.ico", data: pngToIco(favicon, 32) },
    { path: "app/opengraph-image.png", data: og },
    { path: "app/opengraph-image.alt.txt", data: OG_ALT },
  ];
}

// Read once per process: the build draws one image per docs page, and satori keeps each parsed font by its data, so the
// same buffers are parsed once.
let docsOgFonts: SatoriOptions["fonts"] | undefined;

/** The SVG of a docs page's link preview. `onNodeDetected` gets the box of every element, so a test can see what fits. */
export function docsOgSvg(card: OgCard, onNodeDetected?: SatoriOptions["onNodeDetected"]): Promise<string> {
  docsOgFonts ??= fonts();
  return satori(<DocsOg card={card} />, { ...OG_IMAGE_SIZE, fonts: docsOgFonts, onNodeDetected });
}

/** A docs page's link preview as a PNG, drawn when the site is built (app/og/[...slug]/route.ts). */
export async function renderDocsOg(card: OgCard): Promise<Buffer> {
  return png(await docsOgSvg(card), OG_IMAGE_SIZE.width);
}
