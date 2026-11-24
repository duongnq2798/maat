import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import edition from "../content/gap-index/edition-0.json" with { type: "json" };
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors } from "./helpers";

// Spec 2026-11-23 section 11, item 3. Every byte is counted gzipped (level 9) from the static export in out/, which
// `npm run build` writes before this spec runs. Run alone with: npm run e2e -- e2e/weight.spec.ts --project=chromium
const OUT = fileURLToPath(new URL("../out/", import.meta.url));

/** The budgets, in gzipped bytes. */
const BUDGET = { total: 360_000, js: 185_000, css: 18_000 } as const;
/** The two Geist woff2 files the landing preloads, gzipped, measured at P-1 (main at 66bd0d0 gives 140,786). */
const FONT_BASELINE = 140_786;
const FONT_TOLERANCE = 1_000;

interface Asset {
  path: string;
  kind: "js" | "css" | "font";
  bytes: number;
}

const gz = (buf: Buffer) => gzipSync(buf, { level: 9 }).length;
const file = (rel: string) => readFileSync(`${OUT}${rel.replace(/^\//, "")}`);

/**
 * Every /_next/ script, stylesheet and font a page's HTML links, each once. A `noModule` script is left out: it is the
 * legacy polyfill, and no browser that runs the page's module scripts downloads it.
 */
function linked(html: string): Asset[] {
  const assets = new Map<string, Asset>();
  for (const [tag, path] of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="(\/_next\/[^"?#]+)[^"]*"[^>]*>/g)) {
    if (/\snoModule\b/i.test(tag)) continue;
    const kind = path!.endsWith(".js") ? "js" : path!.endsWith(".css") ? "css" : path!.endsWith(".woff2") ? "font" : undefined;
    if (kind === undefined || assets.has(path!)) continue;
    assets.set(path!, { path: path!, kind, bytes: gz(file(path!)) });
  }
  return [...assets.values()];
}

const sum = (assets: readonly Asset[], kind: Asset["kind"]) =>
  assets.filter((a) => a.kind === kind).reduce((n, a) => n + a.bytes, 0);

/**
 * Strings only edition-0.json holds: the transaction hashes of each token's freeze and largest gap, and the first and
 * last pool price of its series. A pending window has no tokens yet, and a token with no pool has no freeze and no gap.
 */
function editionMarkers(): string[] {
  const markers = new Set<string>();
  for (const window of edition.windows) {
    for (const token of window.tokens ?? []) {
      for (const tx of [token.freeze?.from?.tx, token.freeze?.to?.tx, token.largestGap?.tx]) {
        if (tx) markers.add(tx);
      }
      const pool = token.series.pool;
      const first = pool[0];
      const last = pool[pool.length - 1];
      if (first) markers.add(String(first[1]));
      if (last) markers.add(String(last[1]));
    }
  }
  return [...markers];
}

test("the landing stays inside its gzip budgets", () => {
  const html = file("index.html");
  const assets = linked(html.toString("utf8"));
  // Guards: a regex that matches nothing would pass every budget.
  expect(assets.filter((a) => a.kind === "js").length).toBeGreaterThanOrEqual(5);
  expect(assets.filter((a) => a.kind === "css").length).toBeGreaterThanOrEqual(1);
  expect(assets.filter((a) => a.kind === "font")).toHaveLength(2);

  const weight = { html: gz(html), js: sum(assets, "js"), css: sum(assets, "css"), font: sum(assets, "font") };
  const total = weight.html + weight.js + weight.css + weight.font;
  console.log(`landing weight, gzip -9: ${JSON.stringify({ ...weight, total })}`);

  expect.soft(weight.js, "JS").toBeLessThanOrEqual(BUDGET.js);
  expect.soft(weight.css, "CSS").toBeLessThanOrEqual(BUDGET.css);
  expect.soft(Math.abs(weight.font - FONT_BASELINE), `fonts ${weight.font} B against ${FONT_BASELINE} B`).toBeLessThanOrEqual(
    FONT_TOLERANCE,
  );
  expect.soft(total, "total").toBeLessThanOrEqual(BUDGET.total);
});

test("no script that / or /gap-index links holds a string unique to edition-0.json", () => {
  const markers = editionMarkers();
  expect(markers.length).toBeGreaterThan(50);
  // The markers are real: the server-rendered /gap-index writes some of them into its HTML.
  const gapHtml = file("gap-index.html").toString("utf8");
  expect(markers.filter((m) => gapHtml.includes(m)).length).toBeGreaterThan(0);

  const leaks: string[] = [];
  for (const page of ["index.html", "gap-index.html"]) {
    const scripts = linked(file(page).toString("utf8")).filter((a) => a.kind === "js");
    expect(scripts.length, page).toBeGreaterThanOrEqual(5);
    for (const { path } of scripts) {
      const text = file(path).toString("utf8");
      for (const m of markers) if (text.includes(m)) leaks.push(`${page}: ${path} holds ${m}`);
    }
  }
  expect(leaks).toEqual([]);
});

for (const path of ["/", "/gap-index"]) {
  test(`${path} loads no third-party script and logs no console error`, async ({ page }) => {
    await routeLiveRpc(page, "weekend");
    const errors = collectErrors(page);
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await page.goto(path, { waitUntil: "networkidle" });
    const origin = new URL(page.url()).origin;
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((url) => new URL(url).origin !== origin)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
