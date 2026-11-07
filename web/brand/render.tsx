import { Resvg } from "@resvg/resvg-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import satori, { type SatoriOptions } from "satori";
import { SITE } from "../lib/site";
import { MARK, PALETTE } from "./mark";

export interface BrandFile {
  /** Relative to web/. */
  path: string;
  data: Buffer | string;
}

const FONT_DIR = fileURLToPath(new URL("../node_modules/geist/dist/fonts/", import.meta.url));
const OG_ALT = "Maat: the AI agent that knows when not to trade. A Saturday trade refused with MARKET_CLOSED.";
/** Wide enough for mark + gap + "maat". Tune by eye in Step 5 so the wordmark ends 4-8 px from the right edge. */
const LOCKUP_WIDTH = 184;

function fonts(): SatoriOptions["fonts"] {
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

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const png = (svg: string, width: number): Buffer =>
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

function Grid() {
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

function Lockup({ mark }: { mark: number }) {
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
          <span style={{ fontFamily: "Geist Mono", fontSize: 18, fontWeight: 600 }}>MARKET_CLOSED</span>
        </div>
      </div>
    </div>
  );
}

function Badge({ text, fail }: { text: string; fail?: boolean }) {
  return (
    <span
      style={{
        fontFamily: "Geist Mono",
        fontSize: 20,
        fontWeight: 600,
        padding: "8px 14px",
        borderRadius: 10,
        color: fail ? PALETTE.paper : PALETTE.accent,
        backgroundColor: fail ? PALETTE.refuse : PALETTE.accentTint,
      }}
    >
      {text}
    </span>
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
          <Badge text="FAIL · MARKET_CLOSED" fail />
        </div>
        <span style={{ fontFamily: "Geist Mono", fontSize: 20, fontWeight: 500, color: PALETTE.ink2 }}>
          The AI agent that knows when not to trade.
        </span>
      </div>
    </div>
  );
}

export async function renderBrand(): Promise<BrandFile[]> {
  const f = fonts();
  const lockup = await satori(<Lockup mark={60} />, { width: LOCKUP_WIDTH, height: 60, fonts: f });
  const og = png(await satori(<Og />, { width: 1200, height: 630, fonts: f }), 1200);
  const banner = png(await satori(<Banner />, { width: 1500, height: 500, fonts: f }), 1500);
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
