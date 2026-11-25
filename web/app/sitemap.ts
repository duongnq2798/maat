import type { MetadataRoute } from "next";
import { PUBLISHED } from "@/content/gap-index";
import { pagesInSidebarOrder } from "@/lib/docs-source";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const docs = pagesInSidebarOrder().map((page) => ({
    url: new URL(page.url, base).href,
    lastModified: new Date(`${page.data.lastReviewed}T00:00:00Z`),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
  return [
    { url: base.href, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: new URL("/ledger", base).href, lastModified: new Date(), changeFrequency: "hourly", priority: 0.9 },
    // Right now on Base: a new reading on every visit.
    { url: new URL("/now", base).href, lastModified: new Date(), changeFrequency: "always", priority: 0.8 },
    // The Weekend Gap Index: it changes when an edition is read from Base again.
    {
      url: new URL("/gap-index", base).href,
      lastModified: new Date(Math.max(...PUBLISHED.map((e) => e.head.ts)) * 1000),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    // The counting rule and the outside briefs, counted from the inbox's logs on every visit.
    { url: new URL("/proof", base).href, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    ...docs,
  ];
}
