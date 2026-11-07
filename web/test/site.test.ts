// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SITE, siteUrl } from "@/lib/site";
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

  it.each([
    ["evaluateUrl", SITE.evaluateUrl],
    ["forkEvidenceUrl", SITE.forkEvidenceUrl],
  ])("%s points at a README heading", (_name, url) => {
    expect(url.startsWith(`${SITE.repoUrl}#`)).toBe(true);
    expect(slugs).toContain(url.split("#")[1]);
  });

  it("the license link points at the LICENSE file at the repo root", () => {
    expect(SITE.licenseUrl).toBe(`${SITE.repoUrl}/blob/main/LICENSE`);
    expect(readRepo("LICENSE")).toMatch(/^MIT License/);
  });
});
