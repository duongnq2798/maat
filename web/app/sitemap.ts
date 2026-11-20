import type { MetadataRoute } from "next";
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
    ...docs,
  ];
}
