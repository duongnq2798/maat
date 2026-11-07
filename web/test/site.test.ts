import { describe, expect, it } from "vitest";
import { siteUrl } from "@/lib/site";

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
