// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { MARK, PALETTE } from "@/brand/mark";
import { type BrandFile, pngSize, renderBrand } from "@/brand/render";

const WEB = fileURLToPath(new URL("../", import.meta.url));
let files: BrandFile[] = [];
const file = (path: string) => {
  const f = files.find((x) => x.path === path);
  if (!f) throw new Error(`not rendered: ${path}`);
  return f;
};

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
      "Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses with MARKET_CLOSED.",
    );
  });

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
