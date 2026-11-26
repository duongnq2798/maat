import { describe, expect, it, vi } from "vitest";
import sitemap from "@/app/sitemap";
import { PUBLISHED } from "@/content/gap-index";
import { siteUrl } from "@/lib/site";

// The docs pages come from the generated fumadocs source; one stand-in page is enough to place them after /gap-index.
vi.mock("@/lib/docs-source", () => ({
  pagesInSidebarOrder: () => [{ url: "/docs/overview", data: { lastReviewed: "2026-11-20" } }],
}));

describe("the sitemap", () => {
  const entries = sitemap();
  const base = siteUrl();

  it("lists Right now on Base after the landing and the ledger, as a page that changes on every visit", () => {
    const now = entries.find((e) => e.url === new URL("/now", base).href);
    expect(now).toBeDefined();
    expect(now?.priority).toBe(0.8);
    expect(now?.changeFrequency).toBe("always");
    expect(now?.lastModified).toBeInstanceOf(Date);
    expect(entries.map((e) => e.url)).toEqual([
      base.href,
      new URL("/ledger", base).href,
      new URL("/now", base).href,
      new URL("/gap-index", base).href,
      new URL("/proof", base).href,
      new URL("/docs/overview", base).href,
    ]);
  });

  it("lists /proof, a public page whose counts are read from the inbox's logs on every visit", () => {
    const proof = entries.filter((e) => new URL(e.url).pathname === "/proof");
    expect(proof).toHaveLength(1);
    expect(proof[0]?.changeFrequency).toBe("daily");
    expect(proof[0]?.lastModified).toBeInstanceOf(Date);
  });

  it("lists /now once, with an absolute URL on the site's origin", () => {
    const nows = entries.filter((e) => new URL(e.url).pathname === "/now");
    expect(nows).toHaveLength(1);
    expect(new URL(nows[0]!.url).origin).toBe(base.origin);
  });

  it("lists the Weekend Gap Index, last modified when its latest edition was read from Base", () => {
    const gap = entries.find((e) => e.url === new URL("/gap-index", base).href);
    expect(gap?.changeFrequency).toBe("weekly");
    expect(gap?.priority).toBe(0.8);
    const latest = Math.max(...PUBLISHED.map((e) => e.head.ts));
    expect(gap?.lastModified).toEqual(new Date(latest * 1000));
  });
});
