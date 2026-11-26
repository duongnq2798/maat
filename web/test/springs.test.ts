// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEEDLE_ZETA, overshoot, SETTLE_ZETA, WEIGH_MS } from "@/lib/motion/spring";
import { currentSpringsBlock, replaceSpringsBlock, SPRING_FALLBACK, springsBlock } from "@/lib/motion/springs-css";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const block = currentSpringsBlock(css);

/** The points of a linear() easing the springs block declares for `name`. */
function points(name: string): number[] {
  const value = new RegExp(`^  ${name}: linear\\(([^)]*)\\);$`, "m").exec(block)?.[1];
  if (value === undefined) throw new Error(`no ${name}: linear(...) in the springs block`);
  return value.split(", ").map(Number);
}

// Spec section 8.2: damping ratio .42 gives 23.4% overshoot and .7 gives 4.6%, the exact exp(-πζ/√(1-ζ²)).
// Spec section 13: each curve's sampled peak is within 1 point of its target.
const CURVES = [
  ["--ease-needle", NEEDLE_ZETA, 23.4],
  ["--ease-settle", SETTLE_ZETA, 4.6],
] as const;

describe("the springs block of app/globals.css (spec 2026-11-23 section 8.2)", () => {
  it("is byte for byte what scripts/springs.ts writes from lib/motion/spring.ts (run npx tsx scripts/springs.ts)", () => {
    expect(block).toBe(springsBlock());
    expect(replaceSpringsBlock(css)).toBe(css);
  });

  it.each(CURVES)("%s (damping ratio %s) runs 0 to 1 and overshoots within 1 point of %s percent", (name, zeta, target) => {
    const p = points(name);
    expect(p[0]).toBe(0);
    expect(p.at(-1)).toBe(1);
    const peak = (Math.max(...p) - 1) * 100;
    expect(Math.abs(peak - target)).toBeLessThanOrEqual(1);
    expect(overshoot(zeta) * 100).toBeCloseTo(target, 1);
  });

  it("falls back to one cubic-bezier for both where linear() is missing", () => {
    expect(block).toContain(
      [
        "@supports not (transition-timing-function: linear(0, 1)) {",
        "  :root {",
        `    --ease-needle: ${SPRING_FALLBACK};`,
        `    --ease-settle: ${SPRING_FALLBACK};`,
        "  }",
        "}",
      ].join("\n"),
    );
    expect(SPRING_FALLBACK).toBe("cubic-bezier(0.34, 1.4, 0.64, 1)");
  });

  it("times the beam as the drag does: --t-weigh is WEIGH_MS", () => {
    expect(css).toContain(`  --t-weigh: ${WEIGH_MS}ms;`);
  });
});
