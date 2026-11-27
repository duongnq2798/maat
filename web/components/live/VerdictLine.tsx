import type { ReactNode } from "react";
import type { Surface } from "@/components/instrument/types";
import { ReasonTag, type ReasonTagLayout } from "@/components/ui/ReasonTag";
import { type RefusalCode, reasonText } from "@/content/reasons";
import { type Headline, headlineText, LEAD, REFUSE, VAULT_NOT_RUN } from "@/lib/live/verdict";
import { STRIP_TAP } from "./LiveStatus";

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
 * can be set at the verdict size while the reasons keep a smaller one. The text stays the same sentence. `grammar`
 * gives another sentence for the same headline, with its own first words and verb: the landing hero's live line. Its
 * `gloss`, the first ticker's "(NVIDIA, a B20 token on Base)", is a span of its own, data-ticker-gloss, so it can be set
 * smaller than the tickers around it. Its `method` words replace "vault checks not run" as the link to the method, in a
 * span of their own with the rest of the sentence, data-verdict-method, a row of its own under the verdict on the
 * hero, on a 44 px line below sm. `tagLayout` is the ReasonTags' layout: "text" lets the words before a tag share its
 * label's line.
 */
export function VerdictLine({
  headline: h,
  tone = "ink",
  className,
  methodHref,
  palette = "faceplate",
  lead = false,
  grammar,
  tagLayout = "inline",
}: {
  headline: Headline;
  tone?: VerdictTone;
  className?: string;
  methodHref?: string;
  palette?: Surface;
  lead?: boolean;
  /**
   * The sentence (buyLineText), its first words and its verb, and optionally the gloss and the method words it holds;
   * headlineText, LEAD and REFUSE when left out.
   */
  grammar?: { text: string; lead: string; verb: string; gloss?: string | null; method?: string };
  tagLayout?: ReasonTagLayout;
}) {
  let rest = grammar?.text ?? headlineText(h);
  const leadWords = grammar?.lead ?? LEAD;
  const verbWord = grammar?.verb ?? REFUSE;
  const parts: ReactNode[] = [];
  if (lead && rest.startsWith(leadWords)) {
    parts.push(
      <span key="lead" data-verdict-lead="">
        {leadWords}
      </span>,
    );
    rest = rest.slice(leadWords.length);
    const verb = ` ${verbWord} `;
    if (h.kind === "mixed" && rest.startsWith(verb)) {
      parts.push(
        " ",
        <span key="verb" data-verdict-word="">
          {verbWord}
        </span>,
      );
      rest = rest.slice(verb.length - 1);
    }
  }
  // The first ticker's gloss comes before any reason: it follows the first ticker the sentence names.
  const gloss = grammar?.gloss ?? null;
  const glossAt = gloss === null ? -1 : rest.indexOf(gloss);
  if (gloss !== null && glossAt >= 0) {
    parts.push(
      rest.slice(0, glossAt),
      <span key="gloss" data-ticker-gloss="">
        {gloss}
      </span>,
    );
    rest = rest.slice(glossAt + gloss.length);
  }
  codes(h).forEach((code, i) => {
    const text = reasonText(code);
    const at = rest.indexOf(text);
    if (at < 0) return;
    parts.push(rest.slice(0, at), <ReasonTag key={i} code={code} tone="neutral" layout={tagLayout} />);
    rest = rest.slice(at + text.length);
  });
  const method = grammar?.method ?? VAULT_NOT_RUN;
  const at = h.kind === "pass-all" && methodHref !== undefined ? rest.lastIndexOf(method) : -1;
  if (at >= 0 && grammar?.method === undefined) {
    parts.push(
      rest.slice(0, at),
      <a key="method" href={methodHref} className="underline underline-offset-2">
        {VAULT_NOT_RUN}
      </a>,
    );
    rest = rest.slice(at + VAULT_NOT_RUN.length);
  } else if (at >= 0) {
    parts.push(
      rest.slice(0, at),
      <span key="method" data-verdict-method="">
        <a href={methodHref} className={`underline underline-offset-2 ${STRIP_TAP}`}>
          {method}
        </a>
        {rest.slice(at + method.length)}
      </span>,
    );
    rest = "";
  }
  parts.push(rest);
  const tones = palette === "chassis" ? CHASSIS_TONE : TONE;
  return (
    <span data-verdict-line={h.kind} data-tone={tone} className={className ? `${tones[tone]} ${className}` : tones[tone]}>
      {parts}
    </span>
  );
}
