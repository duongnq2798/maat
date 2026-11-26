import type { ReactNode } from "react";
import type { Surface } from "@/components/instrument/types";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { type RefusalCode, reasonText } from "@/content/reasons";
import { type Headline, headlineText, LEAD, REFUSE, VAULT_NOT_RUN } from "@/lib/live/verdict";

export type VerdictTone = "ink" | "muted";

/** The sentence's color, and the tags' labels with it: /now mutes its table cells the same way. */
export const TONE: Record<VerdictTone, string> = {
  ink: "text-ink",
  // A reading that is not live: the whole sentence in the secondary ink, the tag's label included.
  muted: "text-ink-2 [&_[data-reason-tag]>span]:text-ink-2",
};

/**
 * The same tones inside the landing's Readout (spec 2026-11-23 section 5.2): lcd text and pass-lit links on the dark
 * window. A live line's tags keep their two weights, the label in lcd and the code in lcd-2; a muted line is lcd-2
 * throughout.
 */
export const CHASSIS_TONE: Record<VerdictTone, string> = {
  ink: "text-lcd [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd [&_[data-reason-tag]>span+span]:text-lcd-2",
  muted: "text-lcd-2 [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd-2",
};

function codes(h: Headline): RefusalCode[] {
  switch (h.kind) {
    case "refuse-all":
      return [h.reason];
    case "mixed":
      return h.refused.map((r) => r.reason);
    case "pass-all":
      return [];
  }
}

/**
 * The headline sentence of headlineText, word for word, with each "Label (CODE)" shown as its ReasonTag. Splitting the
 * one sentence keeps the strip, /now and the announcement in the same words. The tags are two flex boxes, so a screen
 * reader reads "Market closed MARKET_CLOSED" as part of the sentence; no aria-label is needed. When nothing is refused,
 * the closing "vault checks not run" links `methodHref`, the method that says which checks need a vault. `palette`
 * picks TONE (the faceplate, the default) or CHASSIS_TONE; data-tone says the tone on either. With `lead`, the
 * headline's first words (LEAD) are their own span, data-verdict-lead, so a stylesheet can set them apart from the
 * verdict; in a mixed headline, its verb (REFUSE) right after them is its own span too, data-verdict-word, so the verb
 * can be set at the verdict size while the reasons keep a smaller one. The text stays the same sentence.
 */
export function VerdictLine({
  headline: h,
  tone = "ink",
  className,
  methodHref,
  palette = "faceplate",
  lead = false,
}: {
  headline: Headline;
  tone?: VerdictTone;
  className?: string;
  methodHref?: string;
  palette?: Surface;
  lead?: boolean;
}) {
  let rest = headlineText(h);
  const parts: ReactNode[] = [];
  if (lead && rest.startsWith(LEAD)) {
    parts.push(
      <span key="lead" data-verdict-lead="">
        {LEAD}
      </span>,
    );
    rest = rest.slice(LEAD.length);
    const verb = ` ${REFUSE} `;
    if (h.kind === "mixed" && rest.startsWith(verb)) {
      parts.push(
        " ",
        <span key="verb" data-verdict-word="">
          {REFUSE}
        </span>,
      );
      rest = rest.slice(verb.length - 1);
    }
  }
  codes(h).forEach((code, i) => {
    const text = reasonText(code);
    const at = rest.indexOf(text);
    if (at < 0) return;
    parts.push(rest.slice(0, at), <ReasonTag key={i} code={code} tone="neutral" layout="inline" />);
    rest = rest.slice(at + text.length);
  });
  const at = h.kind === "pass-all" && methodHref !== undefined ? rest.lastIndexOf(VAULT_NOT_RUN) : -1;
  if (at >= 0) {
    parts.push(
      rest.slice(0, at),
      <a key="method" href={methodHref} className="underline underline-offset-2">
        {VAULT_NOT_RUN}
      </a>,
    );
    rest = rest.slice(at + VAULT_NOT_RUN.length);
  }
  parts.push(rest);
  const tones = palette === "chassis" ? CHASSIS_TONE : TONE;
  return (
    <span data-verdict-line={h.kind} data-tone={tone} className={className ? `${tones[tone]} ${className}` : tones[tone]}>
      {parts}
    </span>
  );
}
