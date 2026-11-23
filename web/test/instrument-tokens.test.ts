// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const lines = css.split("\n");

// The 20 pinned tokens (spec 2026-11-23 section 3.1), byte for byte. tokens.test pins 18 values and brand.test two
// more; this pins the block itself, so nothing is ever added inside it.
const PINNED_BLOCK = [
  "  --color-bg: #FFFFFF;",
  "  --color-surface-soft: #F6F7F9;",
  "  --color-surface-head: #FBFBFC;",
  "  --color-line: #E6E8EC;",
  "  --color-line-soft: #F1F2F5;",
  "  --color-line-strong: #D5D8DF;",
  "  --color-ink: #0B0D12;",
  "  --color-ink-2: #5A6170;",
  "  --color-ink-3: #8A90A0;",
  "  --color-ink-body: #3D4350;",
  "  --color-accent: #1F3BFF;",
  "  --color-accent-tint: #EEF1FF;",
  "  --color-accent-soft: #DCE2FF;",
  "  --color-refuse: #C2410C;",
  "  --color-refuse-tint: #FFF1EA;",
  "  --color-refuse-hatch: #F3B79A;",
  "  --color-code-key: #8EA2FF;",
  "  --color-code-type: #7DD3C0;",
  "  --color-feather: #6E83FF;",
  "  --color-grid: #EEF0F4;",
];

// Spec section 9.2, verbatim.
const ADDED_COLOURS: Record<string, string> = {
  "chassis-2": "#14171F",
  "chassis-line": "#262B36",
  lcd: "#F3F4F6",
  "lcd-2": "#B4BAC6",
  "lcd-ghost": "#1A1E27",
  "pass-lit": "#9DAEFF",
  "refuse-lit": "#FF9B66",
  "lamp-pass": "#4D6BFF",
  "lamp-refuse": "#FF5A1F",
  label: "#4A5160",
  "refuse-ink": "#9A3412",
  tick: "#C9CED8",
};

// Spec section 8.2, verbatim; the curve is written the way .anim-row writes it.
const MOTION: Record<string, string> = {
  "--t-tick": "120ms",
  "--t-flip": "240ms",
  "--t-weigh": "600ms",
  "--t-draw": "900ms",
  "--stagger": "30ms",
  "--ease-instrument": "cubic-bezier(0.2, 0.7, 0.2, 1)",
};

describe("instrument tokens in app/globals.css (spec 2026-11-23 sections 8.2 and 9.2)", () => {
  it("keeps the 20 pinned colour tokens as one block, byte for byte", () => {
    const start = lines.indexOf(PINNED_BLOCK[0]!);
    expect(start).toBeGreaterThan(0);
    expect(lines[start - 1]).toBe("@theme {");
    expect(lines.slice(start, start + PINNED_BLOCK.length)).toEqual(PINNED_BLOCK);
    expect(lines[start + PINNED_BLOCK.length]).toBe("");
  });

  it.each(Object.entries(ADDED_COLOURS))("declares --color-%s: %s once, after the pinned block", (name, hex) => {
    const all = [...css.matchAll(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`, "g"))];
    expect(all).toHaveLength(1);
    expect(all[0]?.[1]).toBe(hex);
    expect(all[0]!.index).toBeGreaterThan(css.indexOf("  --color-grid: #EEF0F4;"));
  });

  it.each(Object.entries(MOTION))("declares %s: %s once", (name, value) => {
    const all = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))];
    expect(all).toHaveLength(1);
    expect(all[0]?.[1]).toBe(value);
  });

  it("leaves Tailwind's ease-out alone", () => {
    expect(css).not.toMatch(/--ease-out\s*:/);
  });

  // Spec section 5.2: until PR #15 merges, instrument has its own line after lib/site.ts, away from the frozen brace
  // line. Once PR #15 has merged, it goes into the brace instead. The brace is found by its shape, so the folders
  // PR #15 adds to it do not break this test.
  it("feeds components/instrument to the landing sheet once: on its own line after lib/site.ts, or in the brace", () => {
    const brace = lines.findIndex((l) => /^@source "\.\.\/components\/\{[^}]+\}";$/.test(l));
    expect(brace).toBeGreaterThanOrEqual(0);
    const folders = /\{([^}]+)\}/.exec(lines[brace]!)![1]!.split(",");
    const own = lines.indexOf('@source "../components/instrument";');
    if (folders.includes("instrument")) {
      expect(own).toBe(-1);
    } else {
      expect(own).toBe(lines.indexOf('@source "../lib/site.ts";') + 1);
      expect(own - brace).toBeGreaterThan(1);
    }
    expect(lines.filter((l) => l.startsWith("@source ") && l.includes("instrument"))).toHaveLength(1);
  });

  it("pads the ThumbBar for a phone's home indicator in the stylesheet only (spec section 5.2)", () => {
    expect(css.match(/safe-area-inset-bottom/g)).toHaveLength(1);
    expect(css).toMatch(/\.thumb-bar\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom\);\s*\}/);
  });
});
