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
  /** The words to print in place of the state's own (ThumbBar's "Refused · Market closed", "Market checks pass"). */
  word?: string;
  /**
   * The word's type: "small", the instrument's 11 px mono (the default), or "label", 13 px semibold sans in ink, for
   * words that answer a 13 px label (ThumbBar's "A buy right now:"; review of PR #120).
   */
  size?: "small" | "label";
}

/**
 * A state lamp and its word. Colour is never the only signal: every lit lamp prints a word, PASS, REFUSE or SKIP by
 * default, or the words its caller gives (`word`). A lamp never prints a ReasonTag or a reason code: its own words name
 * no reason, a caller's may name one by its label (ThumbBar's "Refused · Market closed"), and the codes stay in
 * VerdictLine and the cards that carry them. The lamp itself is the `::before` of `.lamp` in app/globals.css, keyed off
 * data-lamp.
 */
export function Lamp({ state, on = "faceplate", className, word, size = "small" }: LampProps) {
  const type = size === "label" ? "text-[13px] font-semibold text-ink" : `font-mono text-[11px] font-semibold ${SMALL_TEXT[on]}`;
  const classes = ["lamp inline-flex items-center gap-1.5", type, className].filter(Boolean).join(" ");
  return (
    <span data-lamp={state} data-on={on} className={classes}>
      {word ?? LAMP_WORD[state]}
    </span>
  );
}
