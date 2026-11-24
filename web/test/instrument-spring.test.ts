// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CURVE_INTERVALS,
  easingPoints,
  linearEasing,
  NEEDLE,
  NEEDLE_ZETA,
  overshoot,
  SETTLE_EPSILON,
  SETTLE_ZETA,
  settleRadians,
  type SpringState,
  springFor,
  springStep,
  stepResponse,
  WEIGH_MS,
} from "@/lib/motion/spring";
import { replaceSpringsBlock, SPRINGS_END, SPRINGS_START, springsBlock } from "@/lib/motion/springs-css";

/** Runs the integrator from rest at 0 toward `target` for `seconds`, `dt` per step; returns every position. */
function integrate(target: number, dt: number, seconds: number): number[] {
  let s: SpringState = { x: 0, v: 0 };
  const xs: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    s = springStep(s, target, NEEDLE, dt);
    xs.push(s.x);
  }
  return xs;
}

describe("the spring model (lib/motion/spring.ts)", () => {
  it("gives the beam's spring its settle time: ω from the needle's damping ratio and WEIGH_MS", () => {
    expect(NEEDLE.zeta).toBe(NEEDLE_ZETA);
    expect(NEEDLE.omega).toBeCloseTo(settleRadians(NEEDLE_ZETA) / (WEIGH_MS / 1000), 12);
    expect(NEEDLE.omega).toBeCloseTo(27.797, 3);
    expect(stepResponse(NEEDLE, 0)).toBe(0);
    expect(Math.abs(stepResponse(NEEDLE, WEIGH_MS / 1000) - 1)).toBeLessThanOrEqual(SETTLE_EPSILON);
  });

  it.each([NEEDLE_ZETA, SETTLE_ZETA])("samples ζ %s as 61 points from exactly 0 to exactly 1, 3 decimals each", (zeta) => {
    const p = easingPoints(zeta);
    expect(p).toHaveLength(CURVE_INTERVALS + 1);
    expect(p[0]).toBe(0);
    expect(p.at(-1)).toBe(1);
    for (const v of p) expect(Math.round(v * 1000) / 1000).toBe(v);
    expect(Math.max(...p) - 1).toBeLessThanOrEqual(overshoot(zeta) + 0.0005);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(0);
    expect(linearEasing(zeta)).toBe(`linear(${p.join(", ")})`);
  });

  it("gives the needle about 23% and the settle about 5% of overshoot", () => {
    expect(overshoot(NEEDLE_ZETA)).toBeCloseTo(0.2337, 4);
    expect(overshoot(SETTLE_ZETA)).toBeCloseTo(0.046, 4);
  });

  it("refuses a spring that does not overshoot, and a duration that is not positive", () => {
    for (const zeta of [0, 1, 1.2, -0.1, Number.NaN]) expect(() => settleRadians(zeta), String(zeta)).toThrow(/between 0 and 1/);
    for (const ms of [0, -600, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => springFor(NEEDLE_ZETA, ms), String(ms)).toThrow(/positive/);
  });
});

describe("the integrator step (springStep)", () => {
  it("tracks the closed form at 0.5 ms steps and settles at the target", () => {
    const dt = 0.0005;
    const xs = integrate(1, dt, WEIGH_MS / 1000);
    const worst = Math.max(...xs.map((x, i) => Math.abs(x - stepResponse(NEEDLE, (i + 1) * dt))));
    expect(worst).toBeLessThan(0.01);
    expect(Math.abs(xs.at(-1)! - 1)).toBeLessThan(0.005);
    expect(Math.abs(Math.max(...xs) - 1 - overshoot(NEEDLE_ZETA))).toBeLessThan(0.005);
  });

  it("stays stable at 60 frames a second and comes to rest", () => {
    const xs = integrate(1, 1 / 60, 2);
    expect(xs.every(Number.isFinite)).toBe(true);
    expect(Math.abs(xs.at(-1)! - 1)).toBeLessThan(0.001);
  });

  it("is linear in the target: toward -6 degrees it moves -6 times as far as toward 1", () => {
    const unit = integrate(1, 1 / 60, 1);
    const tilt = integrate(-6, 1 / 60, 1);
    tilt.forEach((x, i) => expect(x).toBeCloseTo(-6 * unit[i]!, 10));
  });

  it("holds still at the target", () => {
    expect(springStep({ x: -6, v: 0 }, -6, NEEDLE, 1 / 60)).toEqual({ x: -6, v: 0 });
  });
});

describe("the springs block (lib/motion/springs-css.ts)", () => {
  const file = (block: string) => `a {}\n${block}\nb {}\n`;

  it("rewrites only what lies between the markers, and a second run changes nothing", () => {
    const stale = file(`${SPRINGS_START}: old */\n@theme {\n  --ease-needle: linear(0, 1);\n}\n${SPRINGS_END}`);
    const once = replaceSpringsBlock(stale);
    expect(once).toBe(file(springsBlock()));
    expect(replaceSpringsBlock(once)).toBe(once);
  });

  it("refuses a file with a missing, doubled or reversed marker rather than guess", () => {
    const b = springsBlock();
    for (const bad of [
      "a {}\n",
      file(b.replace(SPRINGS_END, "")),
      file(b.replace(SPRINGS_START, "/*")),
      file(`${b}\n${b}`),
      file(`${SPRINGS_END}\n${SPRINGS_START} */`),
    ]) {
      expect(() => replaceSpringsBlock(bad)).toThrow(/exactly one/);
    }
  });

  it("writes LF line ends only", () => {
    expect(springsBlock()).not.toContain("\r");
  });
});
