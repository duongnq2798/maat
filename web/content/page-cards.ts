import { SITE } from "../lib/site";

/**
 * The link previews of /now, /ledger, /gap-index and /proof: the image X and other sites show for a shared link to one
 * of those pages, as content/ask-card.ts is /ask's. app/og/<page>.png/route.ts draws each when the site is built
 * (brand/render.tsx renderPageOg), and each page's metadata names its own as og:image and twitter:image. The landing's
 * image, app/opengraph-image.png, stays as it is.
 *
 * A card shows the page's h1 and one line of its lead, word for word (test/page-og.test.ts reads both from the page's
 * source), and no figure, count or verdict: a static image cannot follow the chain, so it claims nothing that could go
 * stale.
 */

/** The pages with a card of their own, in the order the site's pages are listed. */
export const CARD_PAGES = ["/now", "/ledger", "/gap-index", "/proof"] as const;
export type CardPage = (typeof CARD_PAGES)[number];

export interface PageCard {
  /** The page's h1, drawn beside the lockup. */
  readonly heading: string;
  /** One line of the page's lead, split in two: the second part ends the line in the accent, as /ask's card does. */
  readonly line: readonly [string, string];
}

export const PAGE_CARDS: Readonly<Record<CardPage, PageCard>> = {
  // app/(site)/now/page.tsx: its h1, and its lead.
  "/now": {
    heading: "Right now on Base",
    line: ["Read from Base mainnet in your browser, one block at a time.", "Nothing is signed, and this site has no server."],
  },
  // components/ledger/LedgerApp.tsx: its h1, and its lead.
  "/ledger": {
    heading: "Mainnet ledger",
    line: ["Every intent sent to the vault, every answer it gives and what it holds, read from Base by your browser.", "Refusals included."],
  },
  // app/(site)/gap-index/page.tsx: HEADING, its h1, and the first sentence of its lead.
  "/gap-index": {
    heading: "Weekend Gap Index",
    line: [
      "When NYSE is closed, the Chainlink feeds that price B20 stocks on Base hold their last answer,",
      "while the Aerodrome pools that trade those tokens keep running.",
    ],
  },
  // app/(site)/proof/ProofApp.tsx: its h1, and the last sentence of its lead.
  "/proof": {
    heading: "Proof",
    line: ["A script in the repository rebuilds every number from Base logs,", "with no dependency."],
  },
};

/** A card's alt text: what it shows, in reading order. */
export function pageOgAlt(page: CardPage): string {
  const { heading, line } = PAGE_CARDS[page];
  return `Maat's mark and the page's name, ${heading}, then the line: ${line.join(" ")} Below it: ${SITE.tagline}`;
}

/** A page's card as its metadata names it, under /og as the docs pages' images are: lib/docs/og.ts ogImageUrl gives the same URL. */
export function pageOgImage(page: CardPage) {
  return { url: `/og${page}.png`, type: "image/png", width: 1200, height: 630, alt: pageOgAlt(page) };
}
