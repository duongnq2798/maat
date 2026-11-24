/** The surface a part sits on: the white faceplate, or a dark chassis window (spec 2026-11-23 section 9.2). */
export type Surface = "faceplate" | "chassis";

/**
 * Small text (12 px or less) on each surface, at 7:1 or more: label on the faceplate (7.96:1 on white, 7.43:1 on
 * surface-soft) and lcd-2 on the chassis (9.98:1 on ink, 9.20:1 on chassis-2). test/instrument-contrast.test.ts checks
 * both pairs.
 */
export const SMALL_TEXT: Readonly<Record<Surface, string>> = {
  faceplate: "text-label",
  chassis: "text-lcd-2",
};

/** A weighed trade's outcome, as data-verdict carries it on the Balance and the Tape. */
export type Verdict = "allowed" | "refused";
