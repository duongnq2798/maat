// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SatoriNode } from "satori";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/og/ask.png/route";
import { askOgSvg, pngSize, renderAskOg } from "@/brand/render";
import { ASK_INVITATION, ASK_OG_ALT, ASK_OG_IMAGE } from "@/content/ask-card";

// The /ask link preview (culture plan, Move 1): a static card drawn when the site is built, with the invitation line and
// the mark. The landing's image stays byte for byte as it is.

const WEB = fileURLToPath(new URL("../", import.meta.url));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(join(WEB, path))).digest("hex");

describe("the landing's link preview", () => {
  it("is byte for byte the og.png of main before /ask had its own card", () => {
    // sha256 of web/brand/out/og.png at 5bb8aad (origin/main on 2026-11-26), where app/opengraph-image.png is a copy of it.
    const OG_SHA256 = "19abf09479c039daaf91810b5ac423c5957cfc82da858ecac19c67038c7182f0";
    expect(sha256("brand/out/og.png")).toBe(OG_SHA256);
    expect(sha256("app/opengraph-image.png")).toBe(OG_SHA256);
  });
});

describe("the /ask card", () => {
  it("carries the invitation line of the culture plan, word for word", () => {
    expect(ASK_INVITATION).toBe("Try to talk Maat's agent into a bad trade. The vault has the last word.");
    expect(ASK_OG_ALT).toContain(ASK_INVITATION);
    expect(ASK_OG_IMAGE).toEqual({ url: "/og/ask.png", type: "image/png", width: 1200, height: 630, alt: ASK_OG_ALT });
  });

  it("draws the invitation and the mark inside the landing image's margins", async () => {
    const texts: { text: string; left: number; top: number; right: number; bottom: number }[] = [];
    let marks = 0;
    const svg = await askOgSvg((n: SatoriNode) => {
      if (n.textContent) texts.push({ text: n.textContent, left: n.left, top: n.top, right: n.left + n.width, bottom: n.top + n.height });
      if (n.type === "img") marks += 1;
    });
    expect(svg.startsWith("<svg")).toBe(true);
    const drawn = texts.map((t) => t.text).join(" ");
    for (const part of ["Try to talk Maat's agent into a bad trade.", "The vault has the last word.", "maat"]) expect(drawn).toContain(part);
    // The lockup's mark, and the large mark at rest beside the line.
    expect(marks).toBe(2);
    for (const t of texts) {
      expect(t.left, t.text).toBeGreaterThanOrEqual(72);
      expect(t.right, t.text).toBeLessThanOrEqual(1200 - 72);
      expect(t.top, t.text).toBeGreaterThanOrEqual(64);
      expect(t.bottom, t.text).toBeLessThanOrEqual(630 - 64);
    }
    // No verdict and no figure: the card shows no weighing, so it claims none.
    expect(drawn).not.toMatch(/Refused|Allowed|MARKET_CLOSED|\d/);
  }, 30_000);

  it("renders to a 1200 x 630 PNG, which its static route serves", async () => {
    expect(pngSize(await renderAskOg())).toEqual({ width: 1200, height: 630 });
    const res = await GET();
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(pngSize(Buffer.from(await res.arrayBuffer()))).toEqual({ width: 1200, height: 630 });
  }, 30_000);
});
