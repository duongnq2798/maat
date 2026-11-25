/**
 * The site's one spring (spec 2026-11-23-maat-web-instrument-design.md section 8.2): it shapes the beam's CSS easings
 * and, later, the drag that tips the beam, so the two never disagree. A damped harmonic oscillator pulled toward a
 * target: x'' = -ω²(x - target) - 2ζωx', with damping ratio ζ and natural frequency ω.
 */

/** The needle's damping ratio: the beam swings past and settles. Its overshoot is exp(-πζ/√(1-ζ²)), 23.4%. */
export const NEEDLE_ZETA = 0.42;
/** The settle damping ratio: a small overshoot, 4.6%. */
export const SETTLE_ZETA = 0.7;
/** How long the beam takes to weigh, ms: --t-weigh in app/globals.css (test/springs.test.ts keeps them equal). */
export const WEIGH_MS = 600;

/** A curve ends where the swing's envelope e^(-ζωt)/√(1-ζ²) has fallen to this fraction of the travel. */
export const SETTLE_EPSILON = 0.001;
/** Intervals in a sampled curve: 61 points, one every 10 ms of a 600 ms beam. */
export const CURVE_INTERVALS = 60;
/** Decimals kept per point of a sampled curve. */
export const CURVE_DECIMALS = 3;

export interface Spring {
  /** Damping ratio ζ, between 0 and 1: under-damped, so it overshoots. */
  readonly zeta: number;
  /** Natural frequency ω, in radians per second. */
  readonly omega: number;
}

export interface SpringState {
  /** Position. */
  readonly x: number;
  /** Velocity, per second. */
  readonly v: number;
}

function underdamped(zeta: number): void {
  if (!(zeta > 0 && zeta < 1)) throw new Error(`a damping ratio between 0 and 1 is needed (under-damped), not ${zeta}`);
}

/** ωT: the radians of natural frequency a spring of damping ratio `zeta` takes to settle to SETTLE_EPSILON. */
export function settleRadians(zeta: number): number {
  underdamped(zeta);
  return -Math.log(SETTLE_EPSILON * Math.sqrt(1 - zeta * zeta)) / zeta;
}

/** The spring of damping ratio `zeta` that settles in `durationMs`: the CSS curve of that duration and the drag share it. */
export function springFor(zeta: number, durationMs: number): Spring {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw new Error(`a positive duration is needed, not ${durationMs}`);
  return { zeta, omega: settleRadians(zeta) / (durationMs / 1000) };
}

/** The beam's spring: the needle's damping ratio over WEIGH_MS. */
export const NEEDLE: Spring = springFor(NEEDLE_ZETA, WEIGH_MS);

/** Where a spring released at rest at 0 is after `t` seconds, pulled toward 1: the closed form of the step response. */
export function stepResponse(spring: Spring, t: number): number {
  const { zeta, omega } = spring;
  underdamped(zeta);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
}

/** How far the step response swings past 1, as a fraction of the travel: exp(-πζ/√(1-ζ²)). */
export function overshoot(zeta: number): number {
  underdamped(zeta);
  return Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}

/**
 * The points of a CSS linear() easing for damping ratio `zeta`: the step response at CURVE_INTERVALS + 1 evenly spaced
 * times from release to settle, each rounded to CURVE_DECIMALS. The first point is exactly 0 and the last exactly 1;
 * the points between swing above 1 by about the overshoot. The shape depends on `zeta` alone: the CSS duration stretches it.
 */
export function easingPoints(zeta: number): number[] {
  // Time in units of the settle time, so ω is the settle radians.
  const unit: Spring = { zeta, omega: settleRadians(zeta) };
  const scale = 10 ** CURVE_DECIMALS;
  const points: number[] = [];
  for (let k = 0; k <= CURVE_INTERVALS; k++) {
    if (k === 0) points.push(0);
    else if (k === CURVE_INTERVALS) points.push(1);
    else points.push(Math.round(stepResponse(unit, k / CURVE_INTERVALS) * scale) / scale);
  }
  return points;
}

/** easingPoints as a CSS value: "linear(0, 0.036, …, 1)". */
export function linearEasing(zeta: number): string {
  return `linear(${easingPoints(zeta).join(", ")})`;
}

/**
 * One semi-implicit (symplectic) Euler step of `dt` seconds toward `target`: the velocity first, then the position from
 * the new velocity. The drag runs one step per animation frame; it stays stable while ω·dt is under 2.
 */
export function springStep(state: SpringState, target: number, spring: Spring, dt: number): SpringState {
  const { zeta, omega } = spring;
  const a = -omega * omega * (state.x - target) - 2 * zeta * omega * state.v;
  const v = state.v + a * dt;
  return { x: state.x + v * dt, v };
}
