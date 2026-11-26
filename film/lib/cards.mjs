// The stills the capture renders in Chromium: the title and end cards, the receipts cards, the tx cards (lib/tx.mjs)
// and the caption overlays. Each is a full HTML document at the format's viewport; the capture screenshots it.

import { pathToFileURL } from "node:url";
import { FORMATS } from "./formats.mjs";

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "0x3c3a66f7…" as "0x3c3a…1d6a". */
export const shortHex = (hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

/**
 * The fixed lines the film says, word for word, from the culture plan's approved phrase table (one line per slot) and
 * its myth and builder lines. web/test/film-identity.test.ts holds each one to the approved wording.
 */
export const LINES = Object.freeze({
  positioning: "The AI agent that knows when not to trade.",
  mechanism: "Claude proposes. The vault decides.",
  invitation: "Try to talk Maat's agent into a bad trade. The vault has the last word.",
  signOff: "Every trade is weighed.",
  mythShort: "Named for Ma'at, whose feather every heart was weighed against. Here the feather is the mandate.",
  builder: "Built by one developer with Claude Code.",
});

/** The footer any asset that shows a stock token or a trade carries (voice.md, full form). */
export const FOOTER = "Own treasury only. No investment advice. Not offered to US persons.";

/**
 * The mark as an inline SVG: web/brand/src/mark.svg as it is, which the capture reads and passes in. A card is never
 * drawn with a stand-in for it.
 */
function markSvg(mark) {
  const svg = String(mark ?? "").trim();
  if (!/^<svg[\s>][^]*<\/svg>$/.test(svg)) throw new Error("a title or end card needs the mark: pass the contents of web/brand/src/mark.svg");
  return svg;
}

/** @font-face rules for Geist from the web app's installed package, or none (the system font stands in). */
function fontFaces(fontsDir) {
  if (!fontsDir) return "";
  const url = (rel) => pathToFileURL(`${fontsDir}/${rel}`).href;
  return [
    ["Geist", "geist-sans/Geist-Regular.woff2", 400],
    ["Geist", "geist-sans/Geist-Medium.woff2", 500],
    ["Geist", "geist-sans/Geist-SemiBold.woff2", 600],
    ["Geist", "geist-sans/Geist-Bold.woff2", 700],
    ["Geist Mono", "geist-mono/GeistMono-Regular.woff2", 400],
    ["Geist Mono", "geist-mono/GeistMono-Medium.woff2", 500],
  ]
    .map(([family, rel, weight]) => `@font-face{font-family:"${family}";src:url("${url(rel)}") format("woff2");font-weight:${weight};}`)
    .join("\n");
}

const BASE_CSS = `
:root{--bg:#FFFFFF;--soft:#F6F7F9;--line:#E6E8EC;--ink:#0B0D12;--ink2:#5A6170;--ink3:#8A90A0;--accent:#1F3BFF;--tint:#EEF1FF;--refuse:#C2410C;--refuse-tint:#FFF1EA;--chassis:#0B0D12}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%}
body{font-family:"Geist","Segoe UI",system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.mono{font-family:"Geist Mono",ui-monospace,Consolas,monospace}
.frame{position:absolute;inset:0;background:var(--bg);display:flex;flex-direction:column;justify-content:center}
.eyebrow{font-family:"Geist Mono",ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.placeholder{border:3px dashed var(--refuse);background:var(--refuse-tint);border-radius:18px}
.tag{display:inline-block;font-family:"Geist Mono",ui-monospace,monospace;font-weight:500;letter-spacing:.06em;border-radius:8px}
.tag.ph{background:var(--refuse);color:#fff}
.tag.ok{background:var(--tint);color:var(--accent)}
.tag.no{background:var(--refuse);color:#fff}
`;

/** Sizes per format, in CSS px of the format's viewport. */
const SIZE = {
  wide: { pad: 160, h1: 96, h2: 56, body: 30, small: 24, row: 26, gap: 28 },
  tall: { pad: 28, h1: 40, h2: 28, body: 17, small: 13, row: 13, gap: 16 },
};

/** The frame of a card a caption is burned in over: its content centred above CAPTION_BAND. */
function captionedFrame(format) {
  const s = SIZE[format];
  return `.frame{padding:${s.gap}px ${s.pad}px ${CAPTION_BAND[format]}px;justify-content:safe center;gap:${s.gap}px}`;
}

/** A full document at the format's viewport. `transparent` leaves the page clear, for a caption overlay. */
export function documentHtml({ format, body, css = "", transparent = false, fontsDir }) {
  const f = FORMATS[format];
  if (!f) throw new Error(`unknown format ${format}`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>maat film</title><style>
${fontFaces(fontsDir)}
${BASE_CSS}
html,body{width:${f.viewport.width}px;height:${f.viewport.height}px;overflow:hidden;background:${transparent ? "transparent" : "var(--bg)"}}
${css}
</style></head><body>${body}</body></html>`;
}

/** How far above the bottom of the frame the caption box sits, in CSS px of the format's viewport. */
export const CAPTION_BOTTOM = Object.freeze({ wide: 56, tall: 150 });
/**
 * The band at the bottom of a captioned card that its content stays out of, in CSS px: the caption's offset plus room
 * for a caption box of several lines. The capture still measures each card against each of its captions and stops the
 * render when one would cover a row (overlapProblem); web/e2e/film-cards.spec.ts does the same with the longest txs.
 */
export const CAPTION_BAND = Object.freeze({ wide: 240, tall: 290 });
/** CSS px kept clear between a card's content and the top of a caption box. */
export const CAPTION_CLEARANCE = 16;

/** In a card's page: the lowest edge of its content, in CSS px. Runs in the browser (page.evaluate). */
export function contentBottomInPage() {
  return Math.max(0, ...[...document.querySelectorAll(".frame > *")].map((e) => e.getBoundingClientRect().bottom));
}

/** In a caption's page: the top edge of the caption box, in CSS px. Runs in the browser (page.evaluate). */
export function captionTopInPage() {
  return document.querySelector(".cap")?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY;
}

/** Why a caption box would cover a card's content, in one line; null when the two stay CAPTION_CLEARANCE apart. */
export function overlapProblem(where, contentBottom, captionTop) {
  if (contentBottom + CAPTION_CLEARANCE <= captionTop) return null;
  return `${where}: the card's content ends at ${Math.round(contentBottom)} px and the caption box starts at ${Math.round(captionTop)} px; they need ${CAPTION_CLEARANCE} px between them`;
}

/** Why a card's content would run off the frame, in one line; null when it ends CAPTION_CLEARANCE above the bottom edge. */
export function fitProblem(where, contentBottom, frameHeight) {
  if (contentBottom + CAPTION_CLEARANCE <= frameHeight) return null;
  return `${where}: the card's content ends at ${Math.round(contentBottom)} px, within ${CAPTION_CLEARANCE} px of the frame's bottom edge at ${Math.round(frameHeight)} px`;
}

/** The caption overlay: a clear frame with the caption in a dark box near the bottom. */
export function captionHtml({ format, text, fontsDir }) {
  const wide = format === "wide";
  const placeholder = /^Placeholder:/.test(text);
  const body = placeholder ? text.replace(/^Placeholder:\s*/, "") : text;
  const css = `
.cap{position:absolute;left:50%;transform:translateX(-50%);bottom:${CAPTION_BOTTOM[format]}px;max-width:${wide ? 1560 : 500}px;width:max-content;
background:rgba(11,13,18,.9);color:#fff;border-radius:${wide ? 18 : 12}px;padding:${wide ? "22px 34px" : "13px 18px"};
font-size:${wide ? 40 : 21}px;line-height:1.3;font-weight:500;text-align:center;letter-spacing:-.005em}
.cap .tag{font-size:${wide ? 22 : 12}px;padding:${wide ? "4px 10px" : "2px 6px"};margin-right:${wide ? 14 : 8}px;vertical-align:${wide ? "6px" : "3px"}}`;
  return documentHtml({
    format,
    transparent: true,
    fontsDir,
    css,
    body: `<div class="cap">${placeholder ? '<span class="tag ph">PLACEHOLDER</span>' : ""}${esc(body)}</div>`,
  });
}

/** The mark's side on the title and end cards, in CSS px of the format's viewport. */
const MARK_PX = Object.freeze({ wide: 76, tall: 38 });

/** The lockup as the site's header draws it: the mark, then "maat" in Geist Bold. */
function lockupCss(format) {
  const s = SIZE[format];
  return `.lockup{display:flex;align-items:center;gap:${Math.round(MARK_PX[format] / 4)}px;font-weight:700;font-size:${s.h2}px;letter-spacing:-.02em;line-height:1}
.lockup svg{display:block;flex:none;width:${MARK_PX[format]}px;height:${MARK_PX[format]}px}`;
}
const lockupHtml = (mark) => `<div class="lockup">${markSvg(mark)}<span>maat</span></div>`;

/**
 * The film's first frame: the mark, the positioning line and the mechanism line. `mark` is web/brand/src/mark.svg.
 * @param {{ format: string, fontsDir?: string, mark: string }} options
 */
export function titleCardHtml({ format, fontsDir, mark }) {
  const s = SIZE[format];
  const css = `.frame{padding:${s.gap}px ${s.pad}px;gap:${s.gap}px;justify-content:safe center}
${lockupCss(format)}
h1{font-size:${s.h1}px;line-height:1.02;letter-spacing:-.03em;font-weight:600;max-width:${format === "wide" ? 1300 : 480}px}
.mech{font-size:${Math.round(s.body * 1.35)}px;font-weight:500;letter-spacing:-.01em}
p{font-size:${s.body}px;color:var(--ink2)}`;
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame">${lockupHtml(mark)}<h1>${esc(LINES.positioning)}</h1><p class="mech">${esc(LINES.mechanism)}</p><p>A treasury of tokenized stocks on Base, kept to a written mandate.</p></div>`,
  });
}

/** The verified contracts, from the deployments table and its verification note. */
export function deploymentsCardHtml({ format, rows, verifiedNote, fontsDir }) {
  const s = SIZE[format];
  const wide = format === "wide";
  const css = `${captionedFrame(format)}
h2{font-size:${s.h2}px;letter-spacing:-.02em;font-weight:600}
.eyebrow{font-size:${s.small}px}
table{border-collapse:collapse;width:100%;font-size:${s.row}px}
td{padding:${wide ? 18 : 10}px 0;border-top:1px solid var(--line);vertical-align:top}
td.addr{text-align:right;color:var(--ink2)}
p{font-size:${s.small}px;color:var(--ink2);line-height:1.4}`;
  const trs = rows.map((r) => `<tr><td>${esc(r.contract)}</td><td class="addr mono">${esc(shortHex(r.address))}</td></tr>`).join("");
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame"><div class="eyebrow">Base mainnet · deployments/README.md</div><h2>The contracts</h2><table>${trs}</table><p>${esc(verifiedNote)}</p></div>`,
  });
}

/** The README's CI figures, each with its label. */
export function ciCardHtml({ format, figures, fontsDir }) {
  const s = SIZE[format];
  const wide = format === "wide";
  const css = `${captionedFrame(format)}
h2{font-size:${s.h2}px;letter-spacing:-.02em;font-weight:600}
.eyebrow{font-size:${s.small}px}
.grid{display:grid;grid-template-columns:${wide ? "repeat(4,1fr)" : "repeat(2,1fr)"};gap:${s.gap}px}
.n{font-size:${s.h1}px;font-weight:600;letter-spacing:-.03em}
.l{font-size:${s.small}px;color:var(--ink2);margin-top:6px}
p{font-size:${s.small}px;color:var(--ink2)}`;
  const cells = [
    [figures["readme.contractTests"], "contract unit tests"],
    [figures["readme.agentTests"], "agent unit tests"],
    [figures["readme.webUnitTests"], "website unit tests"],
    [figures["readme.e2eTests"], "browser end-to-end tests"],
  ]
    .map(([n, l]) => `<div><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`)
    .join("");
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame"><div class="eyebrow">README · Tested, in numbers</div><h2>CI on main, all passed</h2><div class="grid">${cells}</div><p class="mono">GitHub Actions run ${esc(figures["readme.ciRun"])} · ${esc(figures["readme.ciDateIso"])}</p></div>`,
  });
}

/**
 * The film's last frame: the mark, the sign-off, the short myth line, the builder line, then where to find Maat and
 * the footer. `mark` is web/brand/src/mark.svg.
 * @param {{ format: string, fontsDir?: string, mark: string }} options
 */
export function endCardHtml({ format, fontsDir, mark }) {
  const s = SIZE[format];
  const wide = format === "wide";
  const css = `.frame{padding:${s.gap}px ${s.pad}px;gap:${s.gap}px;align-items:flex-start;justify-content:safe center}
${lockupCss(format)}
h1{font-size:${s.h1}px;line-height:1.02;letter-spacing:-.03em;font-weight:600}
.myth{font-size:${s.body}px;line-height:1.4;color:var(--ink2);max-width:${wide ? 1240 : 484}px}
.builder{font-size:${s.body}px;font-weight:500}
.foot{align-self:stretch;display:flex;flex-direction:column;gap:${Math.round(s.gap / 3)}px;margin-top:${Math.round(s.gap / 2)}px;padding-top:${s.gap}px;border-top:1px solid var(--line)}
.foot p{font-size:${s.small}px;color:var(--ink2)}
small{font-size:${s.small}px;color:var(--ink3)}`;
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame">${lockupHtml(mark)}<h1>${esc(LINES.signOff)}</h1><p class="myth">${esc(LINES.mythShort)}</p><p class="builder">${esc(LINES.builder)}</p><div class="foot"><p class="mono">maatonbase.xyz · github.com/duongnq2798/maat · @maatonbase</p><small>${esc(FOOTER)}</small></div></div>`,
  });
}
