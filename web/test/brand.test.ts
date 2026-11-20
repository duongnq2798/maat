// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SatoriNode } from "satori";
import { beforeAll, describe, expect, it } from "vitest";
import { MARK, PALETTE } from "@/brand/mark";
import { type BrandFile, ogSvg, pngSize, renderBrand, xBannerSvg } from "@/brand/render";

const WEB = fileURLToPath(new URL("../", import.meta.url));
let files: BrandFile[] = [];
const file = (path: string) => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`not rendered: ${path}`);
  return f;
};

/** Draws an image with satori's node callback and returns a finder for the box of each text it drew. */
async function drawnText(draw: (onNode: (node: SatoriNode) => void) => Promise<string>) {
  const boxes: { text: string; left: number; top: number; right: number; bottom: number }[] = [];
  await draw((n) => {
    if (n.textContent) boxes.push({ text: n.textContent, left: n.left, top: n.top, right: n.left + n.width, bottom: n.top + n.height });
  });
  return (text: string) => {
    const box = boxes.find((b) => b.text === text);
    if (!box) throw new Error(`not drawn: "${text}"; drawn: ${boxes.map((b) => `"${b.text}"`).join(", ")}`);
    return box;
  };
}

beforeAll(async () => {
  files = await renderBrand();
}, 60_000);

describe("brand assets (spec §6)", () => {
  it.each([
    ["brand/out/favicon-32.png", 32, 32],
    ["brand/out/icon-512.png", 512, 512],
    ["brand/out/apple-icon-180.png", 180, 180],
    ["brand/out/og.png", 1200, 630],
    ["brand/out/x-avatar.png", 400, 400],
    ["brand/out/x-banner.png", 1500, 500],
    ["app/icon.png", 512, 512],
    ["app/apple-icon.png", 180, 180],
    ["app/opengraph-image.png", 1200, 630],
  ])("%s is %ix%i", (path, w, h) => {
    expect(pngSize(file(path).data as Buffer)).toEqual({ width: w, height: h });
  });

  it("favicon.ico wraps the 32px PNG", () => {
    const ico = file("app/favicon.ico").data as Buffer;
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)]).toEqual([0, 1, 1]);
    expect(ico.readUInt8(6)).toBe(32);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22, 30)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("SVGs stand alone: same geometry as the site mark, wordmark drawn as paths", () => {
    for (const p of ["brand/src/mark.svg", "brand/src/mark-light.svg"]) {
      const svg = file(p).data as string;
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).toContain(MARK.beam);
      expect(svg).toContain(MARK.feather);
    }
    expect(file("brand/src/lockup.svg").data).not.toContain("<text");
  });

  it("the committed OG alt text has no trailing newline", () => {
    // Reads the file on disk: the in-memory string cannot catch a newline added when it was written.
    expect(readFileSync(join(WEB, "app/opengraph-image.alt.txt"), "utf8")).toBe(
      "Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses: Market closed (MARKET_CLOSED).",
    );
  });

  it("the OG card's verdict names the refusal in plain words, with its code small under it", async () => {
    const at = await drawnText((onNode) => ogSvg(onNode));
    const refused = at("Refused");
    const label = at("Market closed");
    const code = at("MARKET_CLOSED");
    expect(label.left, "the label sits right of Refused").toBeGreaterThan(refused.right);
    // Og(): the card's right edge is 72 px from the image's.
    expect(label.right, "the label stays inside the card").toBeLessThanOrEqual(1200 - 72);
    expect(code.top, "the code sits under the label").toBeGreaterThanOrEqual(label.bottom);
    expect(code.right, "the code lines up with the label's right edge").toBe(label.right);
    expect(code.bottom - code.top, "the code is smaller than the label").toBeLessThan(label.bottom - label.top);
  }, 30_000);

  it("the X banner's failing badge names the refusal in plain words, with its code small beside it", async () => {
    const at = await drawnText((onNode) => xBannerSvg(onNode));
    const label = at("FAIL · Market closed");
    const code = at("MARKET_CLOSED");
    expect(code.left, "the code sits right of the label").toBeGreaterThan(label.right);
    expect(code.bottom - code.top, "the code is smaller than the label").toBeLessThan(label.bottom - label.top);
    // Banner(): the content starts at x = 560, clear of the avatar, and keeps 96 px from the right edge.
    expect(label.left).toBeGreaterThanOrEqual(560);
    expect(code.right).toBeLessThanOrEqual(1500 - 96);
  }, 30_000);

  it("committed SVGs and alt text match a fresh render (run npm run brand after changing the mark)", () => {
    for (const p of [
      "brand/src/mark.svg",
      "brand/src/mark-light.svg",
      "brand/src/lockup.svg",
      "app/opengraph-image.alt.txt",
    ]) {
      expect(readFileSync(join(WEB, p), "utf8"), p).toBe(file(p).data);
    }
  });

  it("PALETTE matches the CSS tokens", () => {
    const css = readFileSync(join(WEB, "app/globals.css"), "utf8");
    const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1]?.toUpperCase();
    const fromCss = {
      paper: token("bg"),
      ink: token("ink"),
      ink2: token("ink-2"),
      line: token("line"),
      lineSoft: token("line-soft"),
      grid: token("grid"),
      accent: token("accent"),
      accentTint: token("accent-tint"),
      refuse: token("refuse"),
      refuseTint: token("refuse-tint"),
      feather: token("feather"),
    };
    // Every PALETTE key is compared, so a key added to PALETTE without a token here fails.
    expect(Object.keys(fromCss).sort()).toEqual(Object.keys(PALETTE).sort());
    expect(fromCss).toEqual(PALETTE);
  });
});
