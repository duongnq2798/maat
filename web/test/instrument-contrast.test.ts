// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const PARTS = new URL("../components/instrument/", import.meta.url);

/** Every --color-* token in app/globals.css, by name: the first declaration wins, as in the pinned tests. */
const TOKENS = new Map<string, string>();
for (const [, name, hex] of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
  if (!TOKENS.has(name!)) TOKENS.set(name!, hex!.toUpperCase());
}

function hex(name: string): string {
  const value = TOKENS.get(name);
  if (value === undefined) throw new Error(`no --color-${name} in app/globals.css`);
  return value;
}

/** WCAG 2.2 relative luminance of an sRGB colour "#RRGGBB". */
function luminance(colour: string): number {
  const n = Number.parseInt(colour.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio of two colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** "small": text at 12 px or less, 7:1 or more. "text": any larger text, 4.5:1 or more (spec section 9.2). */
type Size = "small" | "text";
const MIN: Readonly<Record<Size, number>> = { small: 7, text: 4.5 };

interface Pair {
  fg: string;
  bg: string;
  size: Size;
  use: string;
}

// Every text pair the instrument parts declare (spec section 9.2), by token name.
const PAIRS: readonly Pair[] = [
  { fg: "lcd", bg: "ink", size: "small", use: "readout text on the ink chassis" },
  { fg: "lcd", bg: "chassis-2", size: "small", use: "readout text in a raised window" },
  { fg: "lcd-2", bg: "ink", size: "small", use: "bezel keys, lamp words and plates on the chassis" },
  { fg: "lcd-2", bg: "chassis-2", size: "small", use: "the same in a raised window" },
  { fg: "pass-lit", bg: "ink", size: "small", use: "a lit pass word on the chassis" },
  { fg: "pass-lit", bg: "chassis-2", size: "small", use: "a lit pass word in a raised window" },
  { fg: "refuse-lit", bg: "ink", size: "small", use: "a lit refusal word on the chassis" },
  { fg: "refuse-lit", bg: "chassis-2", size: "small", use: "a lit refusal word in a raised window" },
  { fg: "label", bg: "bg", size: "small", use: "engraved labels, lamp words, plates and meter numbers on the white faceplate" },
  { fg: "label", bg: "surface-soft", size: "small", use: "the same on the surface-soft faceplate of #reasons" },
  { fg: "refuse-ink", bg: "refuse-tint", size: "text", use: "refusal text above 12 px on the refuse tint" },
  { fg: "ink", bg: "bg", size: "text", use: "a lamp's 13 px label words, the ThumbBar's verdict, on the white bar (review of PR #120)" },
];

// The pinned exception: the ReasonTag code keeps ink-2, which e2e/smoke.spec.ts:159 pins, at 11 px: 4.5:1 or more.
const EXCEPTIONS: readonly Pair[] = [
  { fg: "ink-2", bg: "bg", size: "small", use: "the ReasonTag code on white" },
  { fg: "ink-2", bg: "surface-soft", size: "small", use: "the ReasonTag code on surface-soft" },
];
const EXCEPTION_MIN = 4.5;

/** The dark surfaces, and the colours never used as text on them (spec section 9.2). */
const DARK = ["ink", "chassis-2"];
const NEVER_ON_DARK = ["accent", "refuse", "ink-2"];

const name = (p: Pair) => `${p.fg} on ${p.bg} (${p.use})`;

/** The source of every part in components/instrument (none yet is fine: the folder fills up task by task). */
function partSources(): { file: string; text: string }[] {
  if (!existsSync(PARTS)) return [];
  return readdirSync(PARTS)
    .filter((f) => /\.tsx?$/.test(f))
    .map((file) => ({ file, text: readFileSync(new URL(file, PARTS), "utf8") }));
}

describe("instrument contrast (spec 2026-11-23 section 9.2)", () => {
  it("computes the ratios the spec gives", () => {
    const ratio = (fg: string, bg: string) => Number(contrast(hex(fg), hex(bg)).toFixed(2));
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 10);
    expect(ratio("lcd", "ink")).toBe(17.66);
    expect(ratio("lcd-2", "ink")).toBe(9.98);
    expect(ratio("lcd-2", "chassis-2")).toBe(9.2);
    expect(ratio("pass-lit", "ink")).toBe(9.19);
    expect(ratio("refuse-lit", "ink")).toBe(9.38);
    expect(ratio("label", "bg")).toBe(7.96);
    expect(ratio("label", "surface-soft")).toBe(7.43);
    expect(ratio("refuse-ink", "refuse-tint")).toBe(6.62);
    expect(ratio("ink-2", "bg")).toBe(6.22);
    expect(ratio("ink-2", "surface-soft")).toBe(5.8);
    expect(ratio("ink-2", "ink")).toBe(3.13);
    expect(ratio("ink-3", "bg")).toBe(3.19);
    expect(ratio("refuse", "refuse-tint")).toBe(4.69);
  });

  it("names only tokens app/globals.css declares", () => {
    for (const p of [...PAIRS, ...EXCEPTIONS]) {
      expect(TOKENS.has(p.fg), `--color-${p.fg}`).toBe(true);
      expect(TOKENS.has(p.bg), `--color-${p.bg}`).toBe(true);
    }
  });

  it.each(PAIRS.map((p) => [name(p), p] as const))("%s meets its minimum", (_, p) => {
    expect(contrast(hex(p.fg), hex(p.bg))).toBeGreaterThanOrEqual(MIN[p.size]);
  });

  it.each(EXCEPTIONS.map((p) => [name(p), p] as const))("%s is the pinned exception: 4.5:1 or more, under 7:1", (_, p) => {
    const r = contrast(hex(p.fg), hex(p.bg));
    expect(r).toBeGreaterThanOrEqual(EXCEPTION_MIN);
    expect(r).toBeLessThan(MIN.small);
  });

  it("never declares accent or refuse as text on ink, nor ink-2 on ink", () => {
    for (const p of [...PAIRS, ...EXCEPTIONS]) {
      expect(DARK.includes(p.bg) && NEVER_ON_DARK.includes(p.fg), name(p)).toBe(false);
    }
  });

  it("gives every text colour an instrument part uses a declared pair", () => {
    const declared = new Set([...PAIRS, ...EXCEPTIONS].map((p) => p.fg));
    for (const { file, text } of partSources()) {
      for (const [, colour] of text.matchAll(/\btext-([a-z][a-z0-9-]*)/g)) {
        if (TOKENS.has(colour!)) expect(declared.has(colour!), `${file} uses text-${colour}`).toBe(true);
      }
    }
  });

  it("never puts accent, refuse or ink-2 text in a class list that sets a dark surface", () => {
    for (const { file, text } of partSources()) {
      for (const [list] of text.matchAll(/"[^"\n]*"|`[^`\n]*`/g)) {
        if (!/\bbg-(ink|chassis-2)\b/.test(list)) continue;
        expect(list, file).not.toMatch(/\btext-(accent|refuse|ink-2)\b/);
      }
    }
  });
});
