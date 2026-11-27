import { REASON_LABEL, type ReasonCode } from "@/content/reasons";

/** The background the tag sits on (spec 2026-11-20 section 4). Each label and code must keep 4.5:1 contrast on it. */
export type ReasonTagTone = "verdict" | "refuse" | "neutral";
/**
 * "stacked": the label over the code. "inline": the code after the label, wrapping under it only when out of room.
 * "text": the label and the code as running text, a space between them, so the words before the tag stay on the
 * label's line and only the code wraps when out of room.
 */
export type ReasonTagLayout = "stacked" | "inline" | "text";

export interface ReasonTagProps {
  code: ReasonCode;
  tone?: ReasonTagTone;
  layout?: ReasonTagLayout;
  /** Added to the root: the label's size, weight and alignment come from here or the parent. */
  className?: string;
}

const TONE: Record<ReasonTagTone, { label: string; code: string }> = {
  // On the ink or accent verdict box: both inherit its white; the code takes the opacity of the box's small labels.
  verdict: { label: "font-semibold", code: "opacity-80" },
  refuse: { label: "text-refuse", code: "text-refuse" },
  neutral: { label: "text-ink", code: "text-ink-2" },
};

const LAYOUT: Record<ReasonTagLayout, string> = {
  stacked: "inline-flex flex-col gap-0.5",
  inline: "inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5",
  text: "",
};

/**
 * A reason as a person reads it: the plain label (REASON_LABEL), then the onchain code in small mono type. In the
 * stacked and inline layouts no separator sits between them in the text: both are flex boxes, so the two are separate
 * boxes and assistive tech reads them as two words. The text layout is not a box, so a space separates them there.
 * Nothing is aria-hidden: the code is part of the accessible text.
 */
export function ReasonTag({ code, tone = "neutral", layout = "stacked", className }: ReasonTagProps) {
  const t = TONE[tone];
  const classes = [LAYOUT[layout], className].filter(Boolean).join(" ");
  return (
    <span data-reason-tag={code} className={classes === "" ? undefined : classes}>
      <span className={t.label}>{REASON_LABEL[code]}</span>
      {layout === "text" ? " " : null}
      <span className={`font-mono text-[11px] ${t.code}`}>{code}</span>
    </span>
  );
}
