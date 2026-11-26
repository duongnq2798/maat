import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import { metadata as gapIndex } from "@/app/(site)/gap-index/page";
import { metadata as ledger } from "@/app/(site)/ledger/page";
import { metadata as now } from "@/app/(site)/now/page";
import { metadata as proof } from "@/app/(site)/proof/page";
import { type CardPage, pageOgImage } from "@/content/page-cards";
import { OG_IMAGE } from "@/lib/og-image";

// Each page names its own card (content/page-cards.ts) as og:image and twitter:image, so a shared link to it previews
// that page and not the landing.

const METADATA: Record<CardPage, Metadata> = { "/now": now, "/ledger": ledger, "/gap-index": gapIndex, "/proof": proof };

describe("the link preview each page names", () => {
  for (const [page, metadata] of Object.entries(METADATA) as [CardPage, Metadata][]) {
    it(`${page} names /og${page}.png in og:image and twitter:image, not the landing's image`, () => {
      const og = metadata.openGraph as { url?: string; images?: unknown[] } | undefined;
      const twitter = metadata.twitter as { card?: string; images?: unknown[] } | undefined;
      expect(og?.url).toBe(page);
      expect(og?.images).toEqual([pageOgImage(page)]);
      expect(twitter?.card).toBe("summary_large_image");
      expect(twitter?.images).toEqual([pageOgImage(page)]);
      expect(pageOgImage(page).url).not.toBe(OG_IMAGE.url);
    });
  }
});
