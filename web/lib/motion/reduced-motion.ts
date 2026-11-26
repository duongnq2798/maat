/** The query the global reduce block of app/globals.css answers. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the visitor asked for reduced motion. True where window.matchMedia is missing (on the server, in jsdom): a
 * page that cannot ask shows the final frame, which is the base style of every part (spec 2026-11-23 section 8.4).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
