import { linearEasing, NEEDLE_ZETA, SETTLE_ZETA } from "./spring";

/** The marked block in app/globals.css that scripts/springs.ts writes: from the start marker to the end marker. */
export const SPRINGS_START = "/* springs:start";
export const SPRINGS_END = "/* springs:end */";
/** Where linear() is missing (spec 2026-11-23 section 8.2), both easings fall back to one overshooting curve. */
export const SPRING_FALLBACK = "cubic-bezier(0.34, 1.4, 0.64, 1)";

/** The springs block, start marker to end marker inclusive, as lib/motion/spring.ts gives it today. LF line ends. */
export function springsBlock(): string {
  return [
    `${SPRINGS_START}: written by \`npx tsx scripts/springs.ts\` from lib/motion/spring.ts; do not edit by hand. */`,
    "@theme {",
    `  --ease-needle: ${linearEasing(NEEDLE_ZETA)};`,
    `  --ease-settle: ${linearEasing(SETTLE_ZETA)};`,
    "}",
    "@supports not (transition-timing-function: linear(0, 1)) {",
    "  :root {",
    `    --ease-needle: ${SPRING_FALLBACK};`,
    `    --ease-settle: ${SPRING_FALLBACK};`,
    "  }",
    "}",
    SPRINGS_END,
  ].join("\n");
}

/** Where the block sits in `css`. Throws unless `css` holds exactly one start marker and, after it, exactly one end marker. */
function blockAt(css: string): { start: number; end: number } {
  const start = css.indexOf(SPRINGS_START);
  const end = css.indexOf(SPRINGS_END);
  const once = start >= 0 && end > start && css.indexOf(SPRINGS_START, start + 1) < 0 && css.indexOf(SPRINGS_END, end + 1) < 0;
  if (!once) throw new Error(`app/globals.css needs exactly one "${SPRINGS_START}" marker followed by exactly one "${SPRINGS_END}"`);
  return { start, end: end + SPRINGS_END.length };
}

/** The springs block as `css` holds it, start marker to end marker inclusive. */
export function currentSpringsBlock(css: string): string {
  const { start, end } = blockAt(css);
  return css.slice(start, end);
}

/** `css` with its springs block rewritten from the model; everything outside the markers is kept byte for byte. */
export function replaceSpringsBlock(css: string): string {
  const { start, end } = blockAt(css);
  return `${css.slice(0, start)}${springsBlock()}${css.slice(end)}`;
}
