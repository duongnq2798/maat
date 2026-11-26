// The stills the capture renders in Chromium: the title and end cards, the receipts cards, the tx cards (lib/tx.mjs)
// and the caption overlays. Each is a full HTML document at the format's viewport; the capture screenshots it.

import { pathToFileURL } from "node:url";
import { FORMATS } from "./formats.mjs";

export const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** "0x3c3a66f7…" as "0x3c3a…1d6a". */
export const shortHex = (hex) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

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

/** The caption overlay: a clear frame with the caption in a dark box near the bottom. */
export function captionHtml({ format, text, fontsDir }) {
  const wide = format === "wide";
  const placeholder = /^Placeholder:/.test(text);
  const body = placeholder ? text.replace(/^Placeholder:\s*/, "") : text;
  const css = `
.cap{position:absolute;left:50%;transform:translateX(-50%);bottom:${wide ? 56 : 150}px;max-width:${wide ? 1560 : 500}px;width:max-content;
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

export function titleCardHtml({ format, fontsDir }) {
  const s = SIZE[format];
  const css = `.frame{padding:0 ${s.pad}px;gap:${s.gap}px}
.mark{display:flex;align-items:center;gap:${s.gap / 2}px;font-weight:700;font-size:${s.h2}px}
.mark i{display:inline-block;width:${s.h2}px;height:${s.h2}px;border-radius:${s.h2 / 5}px;background:var(--ink)}
h1{font-size:${s.h1}px;line-height:1.02;letter-spacing:-.03em;font-weight:600;max-width:${format === "wide" ? 1300 : 480}px}
p{font-size:${s.body}px;color:var(--ink2)}`;
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame"><div class="mark"><i></i>maat</div><h1>The AI agent that knows when not to trade.</h1><p>An AI treasury agent for tokenized stocks on Base. Claude proposes; the onchain vault decides.</p></div>`,
  });
}

/** The verified contracts, from the deployments table and its verification note. */
export function deploymentsCardHtml({ format, rows, verifiedNote, fontsDir }) {
  const s = SIZE[format];
  const wide = format === "wide";
  const css = `.frame{padding:0 ${s.pad}px;gap:${s.gap}px}
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
  const css = `.frame{padding:0 ${s.pad}px;gap:${s.gap}px}
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

export function endCardHtml({ format, fontsDir }) {
  const s = SIZE[format];
  const css = `.frame{padding:0 ${s.pad}px;gap:${s.gap}px;align-items:flex-start}
h1{font-size:${s.h1}px;letter-spacing:-.03em;font-weight:600}
p{font-size:${s.body}px;color:var(--ink2)}
small{font-size:${s.small}px;color:var(--ink3)}`;
  return documentHtml({
    format,
    fontsDir,
    css,
    body: `<div class="frame"><h1>maatonbase.xyz</h1><p class="mono">github.com/duongnq2798/maat · @maatonbase</p><small>Own treasury only. No investment advice. Not offered to US persons.</small></div>`,
  });
}
