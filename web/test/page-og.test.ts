// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SatoriNode } from "satori";
import { describe, expect, it } from "vitest";
import { GET as GET_GAP_INDEX } from "@/app/og/gap-index.png/route";
import { GET as GET_LEDGER } from "@/app/og/ledger.png/route";
import { GET as GET_NOW } from "@/app/og/now.png/route";
import { GET as GET_PROOF } from "@/app/og/proof.png/route";
import { pageOgSvg, pngSize, renderPageOg } from "@/brand/render";
import { CARD_PAGES, type CardPage, PAGE_CARDS, pageOgAlt, pageOgImage } from "@/content/page-cards";
import { ogImageUrl } from "@/lib/docs/og";
import { SITE } from "@/lib/site";

// The link previews of /now, /ledger, /gap-index and /proof (culture plan 6.3, "branded edges"): static cards drawn when
// the site is built, each with its page's h1, a line of its lead and the mark. The landing's image stays byte for byte
// as it is.

const WEB = fileURLToPath(new URL("../", import.meta.url));
const read = (path: string) => readFileSync(join(WEB, path), "utf8").split("\r\n").join("\n");
const sha256 = (path: string) => createHash("sha256").update(readFileSync(join(WEB, path))).digest("hex");

/** The file that renders each page's h1 and its lead. */
const SOURCE: Record<CardPage, string> = {
  "/now": "app/(site)/now/page.tsx",
  "/ledger": "components/ledger/LedgerApp.tsx",
  "/gap-index": "app/(site)/gap-index/page.tsx",
  "/proof": "app/(site)/proof/ProofApp.tsx",
};

const ROUTES: Record<CardPage, () => Promise<Response>> = {
  "/now": GET_NOW,
  "/ledger": GET_LEDGER,
  "/gap-index": GET_GAP_INDEX,
  "/proof": GET_PROOF,
};

/** JSX text as the browser shows it: no tags, no {" "}, entities decoded, whitespace collapsed. */
const plain = (jsx: string) =>
  jsx
    .replace(/\{" "\}/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** The page's h1 and its lead, from its source; an h1 of {NAME} is the string constant NAME. */
function pageText(page: CardPage): { h1: string; lead: string } {
  const src = read(SOURCE[page]);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(src)?.[1]?.trim();
  const lead = /<p className="lead">([\s\S]*?)<\/p>/.exec(src)?.[1];
  if (h1 === undefined || lead === undefined) throw new Error(`${SOURCE[page]} has no h1 or no lead`);
  const name = /^\{(\w+)\}$/.exec(h1)?.[1];
  const constant = name === undefined ? h1 : new RegExp(`const ${name} = "([^"]+)";`).exec(src)?.[1];
  if (constant === undefined) throw new Error(`${SOURCE[page]} has no const ${name}`);
  return { h1: plain(constant), lead: plain(lead) };
}

describe("the landing's link preview", () => {
  it("is byte for byte the og.png of main before these pages had their own cards", () => {
    // sha256 of web/brand/out/og.png at 5bb8aad (origin/main on 2026-11-26), where app/opengraph-image.png is a copy of it.
    const OG_SHA256 = "19abf09479c039daaf91810b5ac423c5957cfc82da858ecac19c67038c7182f0";
    expect(sha256("brand/out/og.png")).toBe(OG_SHA256);
    expect(sha256("app/opengraph-image.png")).toBe(OG_SHA256);
  });
});

describe("the page cards", () => {
  it("cover /now, /ledger, /gap-index and /proof", () => {
    expect([...CARD_PAGES]).toEqual(["/now", "/ledger", "/gap-index", "/proof"]);
    expect(Object.keys(PAGE_CARDS).sort()).toEqual([...CARD_PAGES].sort());
  });

  for (const page of CARD_PAGES) {
    describe(page, () => {
      it("quotes the page's h1 and a line of its lead word for word", () => {
        const card = PAGE_CARDS[page];
        const { h1, lead } = pageText(page);
        expect(card.heading).toBe(h1);
        expect(lead).toContain(card.line.join(" "));
        // The line ends a sentence, so the card never cuts the page's words mid-thought.
        expect(card.line[1]).toMatch(/\.$/);
      });

      it("is a 1200 x 630 PNG at /og<page>.png, with alt text that reads the card in order", () => {
        const card = PAGE_CARDS[page];
        const alt = pageOgAlt(page);
        expect(pageOgImage(page)).toEqual({ url: ogImageUrl(page), type: "image/png", width: 1200, height: 630, alt });
        expect(ogImageUrl(page)).toBe(`/og${page}.png`);
        const order = [card.heading, card.line.join(" "), SITE.tagline].map((part) => alt.indexOf(part));
        expect(order.every((i) => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
      });

      it("draws the lockup, the h1, the line and the tagline inside the landing image's margins, and the mark beside them", async () => {
        const card = PAGE_CARDS[page];
        const texts: { text: string; left: number; top: number; right: number; bottom: number }[] = [];
        const marks: { left: number; top: number; right: number; bottom: number }[] = [];
        const svg = await pageOgSvg(page, (n: SatoriNode) => {
          const box = { left: n.left, top: n.top, right: n.left + n.width, bottom: n.top + n.height };
          if (n.textContent) texts.push({ text: n.textContent, ...box });
          if (n.type === "img") marks.push(box);
        });
        expect(svg.startsWith("<svg")).toBe(true);
        const drawn = texts.map((t) => t.text).join(" ");
        for (const part of ["maat", card.heading, ...card.line, SITE.tagline]) expect(drawn).toContain(part);
        // The lockup's mark, and the large mark at rest beside the line.
        expect(marks).toHaveLength(2);
        const big = marks.reduce((a, b) => (b.right - b.left > a.right - a.left ? b : a));
        for (const t of texts) {
          expect(t.left, t.text).toBeGreaterThanOrEqual(72);
          expect(t.right, t.text).toBeLessThanOrEqual(1200 - 72);
          expect(t.top, t.text).toBeGreaterThanOrEqual(64);
          expect(t.bottom, t.text).toBeLessThanOrEqual(630 - 64);
          // No text runs under the large mark.
          expect(t.right <= big.left - 32 || t.bottom <= big.top || t.top >= big.bottom, t.text).toBe(true);
        }
        expect(big.right).toBeLessThanOrEqual(1200 - 72);
        // No verdict and no figure: a static card cannot follow the chain, so it claims none. "B20", the tokens' name, is
        // the one digit a line may carry.
        expect(drawn).not.toMatch(/Refused|Allowed|MARKET_CLOSED|PASS|FAIL/);
        expect(drawn.replace(/\bB20\b/g, "")).not.toMatch(/\d/);
      }, 30_000);

      it("renders to a 1200 x 630 PNG, which its static route serves", async () => {
        expect(pngSize(await renderPageOg(page))).toEqual({ width: 1200, height: 630 });
        const res = await ROUTES[page]();
        expect(res.headers.get("content-type")).toBe("image/png");
        expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
      }, 30_000);
    });
  }
});
