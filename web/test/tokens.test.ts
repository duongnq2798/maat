// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// Spec §2.1, verbatim.
const SPEC_TOKENS: Record<string, string> = {
  bg: "#FFFFFF",
  "surface-soft": "#F6F7F9",
  "surface-head": "#FBFBFC",
  line: "#E6E8EC",
  "line-soft": "#F1F2F5",
  "line-strong": "#D5D8DF",
  ink: "#0B0D12",
  "ink-2": "#5A6170",
  "ink-3": "#8A90A0",
  "ink-body": "#3D4350",
  accent: "#1F3BFF",
  "accent-tint": "#EEF1FF",
  "accent-soft": "#DCE2FF",
  refuse: "#C2410C",
  "refuse-tint": "#FFF1EA",
  "refuse-hatch": "#F3B79A",
  "code-key": "#8EA2FF",
  "code-type": "#7DD3C0",
};

describe("design tokens (spec §2.1)", () => {
  it.each(Object.entries(SPEC_TOKENS))("--color-%s is %s", (name, hex) => {
    const m = new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`).exec(css);
    expect(m?.[1]?.toUpperCase()).toBe(hex);
  });

  it("maps the fonts to Geist", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-geist-sans\)/);
    expect(css).toMatch(/--font-mono:\s*var\(--font-geist-mono\)/);
  });

  it("uses a 16px gutter under 720px", () => {
    expect(css).toMatch(/@media \(max-width: 720px\)\s*\{\s*\.wrap\s*\{\s*padding-inline:\s*16px;/);
  });
});

describe("motion (spec §2.3)", () => {
  it("reduced motion switches every animation off", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation:\s*none\s*!important/);
  });

  it("never parks content at opacity 0 outside @keyframes", () => {
    const outsideKeyframes = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
    expect(outsideKeyframes).not.toMatch(/opacity:\s*0\s*[;}]/);
  });
});
