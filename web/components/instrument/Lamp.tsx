import { SMALL_TEXT, type Surface } from "./types";

/** A lamp's state: lit for a pass or a refusal, a ring for a skipped check, unlit while the chain is being read. */
export type LampState = "pass" | "refuse" | "skip" | "reading";

/** The word each state prints (spec 2026-11-23 section 4). The reading state prints none. */
export const LAMP_WORD: Readonly<Record<LampState, string>> = {
  pass: "PASS",
  refuse: "REFUSE",
  skip: "SKIP",
  reading: "",
};

export interface LampProps {
  state: LampState;
  /** The surface the lamp sits on, which sets its word's colour and its unlit core. */
  on?: Surface;
  className?: string;
}

/**
 * A state lamp and its word. Colour is never the only signal: every lit state prints PASS, REFUSE or SKIP. A lamp never
 * prints a ReasonTag; reason codes stay in VerdictLine and the cards that carry them. The lamp itself is the `::before`
 * of `.lamp` in app/globals.css, keyed off data-lamp.
 */
export function Lamp({ state, on = "faceplate", className }: LampProps) {
  const classes = ["lamp inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold", SMALL_TEXT[on], className]
    .filter(Boolean)
    .join(" ");
  return (
    <span data-lamp={state} data-on={on} className={classes}>
      {LAMP_WORD[state]}
    </span>
  );
}
