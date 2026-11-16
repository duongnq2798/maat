// @vitest-environment node
import { describe, expect, it } from "vitest";
import { IA_SLUGS } from "@/lib/docs/ia";
import { SITE, repoFileUrl, siteUrl } from "@/lib/site";
import { readRepo } from "./helpers/solidity";

describe("siteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: " https://maat.example ", VERCEL_PROJECT_PRODUCTION_URL: "x.vercel.app" }).href).toBe(
      "https://maat.example/",
    );
  });

  it("falls back to the Vercel production URL, then localhost", () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "maat-web.vercel.app" }).href).toBe("https://maat-web.vercel.app/");
    expect(siteUrl({}).href).toBe("http://localhost:3000/");
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "   " }).href).toBe("http://localhost:3000/");
  });

  it("fails the build on a malformed URL instead of shipping broken cards", () => {
    expect(() => siteUrl({ NEXT_PUBLIC_SITE_URL: "maat dot xyz" })).toThrow();
  });
});

describe("links into the README", () => {
  // GitHub's heading slug: lowercase, punctuation dropped, spaces to hyphens.
  const slugs = readRepo("README.md")
    .split(/\r?\n/)
    .filter((l) => /^#{1,6} /.test(l))
    .map((l) =>
      l
        .replace(/^#+ /, "")
        .trim()
        .toLowerCase()
        .replace(/[^\w\- ]/g, "")
        .replace(/ /g, "-"),
    );

  it("forkEvidenceUrl points at a README heading", () => {
    expect(SITE.forkEvidenceUrl.startsWith(`${SITE.repoUrl}#`)).toBe(true);
    expect(slugs).toContain(SITE.forkEvidenceUrl.split("#")[1]);
  });

  it("the docs links point at pages in the docs IA", () => {
    expect(SITE.docsUrl).toBe("/docs");
    expect(SITE.quickstartUrl).toBe("/docs/get-started/quickstart");
    expect(IA_SLUGS).toContain(SITE.quickstartUrl.slice("/docs/".length));
  });

  it("the license link points at the LICENSE file at the repo root", () => {
    expect(SITE.licenseUrl).toBe(`${SITE.repoUrl}/blob/main/LICENSE`);
    expect(readRepo("LICENSE")).toMatch(/^MIT License/);
  });
});

describe("disclaimer", () => {
  const NOT_AFFILIATED = "affiliated with or endorsed by Base, Coinbase, Bankr, Anthropic, Chainlink, Aave or Aerodrome.";
  // The README is hard-wrapped, so whitespace is compared as single spaces.
  const flat = (path: string) => readRepo(path).replace(/\s+/g, " ");

  it("keeps the footer's first sentences and names who Maat is not affiliated with", () => {
    expect(SITE.disclaimer).toContain("gives no investment advice, confers no shareholder rights and is not offered to US persons.");
    expect(SITE.disclaimer.endsWith(`Not ${NOT_AFFILIATED}`)).toBe(true);
  });

  it.each(["README.md", "web/content/docs/get-started/what-is-maat.mdx"])("%s says the same", (path) => {
    expect(flat(path).includes(NOT_AFFILIATED), path).toBe(true);
  });
});

describe("links into the source", () => {
  it.each(["contracts/src/MarketCalendar.sol", "contracts/src/MandateVault.sol"])("%s exists and links at main", (path) => {
    expect(repoFileUrl(path)).toBe(`${SITE.repoUrl}/blob/main/${path}`);
    expect(() => readRepo(path)).not.toThrow();
  });
});
