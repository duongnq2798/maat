import { prefersReducedMotion } from "./reduced-motion";

/** One character's roll, and the gap between two that roll together (spec 2026-11-23 section 8.3, digit-roll). */
export const ROLL_MS = 240;
export const ROLL_STAGGER_MS = 30;
/** --ease-instrument of app/globals.css, written out: WAAPI takes no var(). */
export const ROLL_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";
/** The new character rises into its cell from below; the number around the cells clips it (.digits in app/globals.css). */
export const ROLL_KEYFRAMES: readonly Keyframe[] = [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }];

function canAnimate(): boolean {
  return typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
}

/**
 * Writes `to` into `cells`, one character per cell, then rolls in each cell whose character differs from `from`, in
 * cell order, ROLL_STAGGER_MS apart. Only a change between two readings of the same length rolls: when `from` and `to`
 * differ in length (a block number that gains a digit), the cells no longer line up, so the text is written and nothing
 * rolls. When `cells` and `to` differ in length nothing is written: the caller renders one cell per character first.
 * Under reduced motion, or where Element.prototype.animate is missing (jsdom), it only writes the text. Returns the
 * animations it started, each finite.
 */
export function rollDigits(cells: readonly HTMLElement[], from: string, to: string): Animation[] {
  const next = [...to];
  if (cells.length !== next.length) return [];
  next.forEach((ch, i) => {
    const cell = cells[i]!;
    if (cell.textContent !== ch) cell.textContent = ch;
  });
  const before = [...from];
  if (before.length !== next.length || prefersReducedMotion() || !canAnimate()) return [];
  const started: Animation[] = [];
  next.forEach((ch, i) => {
    if (before[i] === ch) return;
    const timing: KeyframeAnimationOptions = {
      duration: ROLL_MS,
      delay: started.length * ROLL_STAGGER_MS,
      easing: ROLL_EASING,
      fill: "backwards",
    };
    started.push(cells[i]!.animate([...ROLL_KEYFRAMES], timing));
  });
  return started;
}
