import type { ReactNode } from "react";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { type RefusalCode, reasonText } from "@/content/reasons";
import { type Headline, headlineText } from "@/lib/live/verdict";

export type VerdictTone = "ink" | "muted";

const TONE: Record<VerdictTone, string> = {
  ink: "text-ink",
  // A reading that is not live: the whole sentence in the secondary ink, the tag's label included.
  muted: "text-ink-2 [&_[data-reason-tag]>span]:text-ink-2",
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
 * reader reads "Market closed MARKET_CLOSED" as part of the sentence; no aria-label is needed.
 */
export function VerdictLine({ headline: h, tone = "ink", className }: { headline: Headline; tone?: VerdictTone; className?: string }) {
  let rest = headlineText(h);
  const parts: ReactNode[] = [];
  codes(h).forEach((code, i) => {
    const text = reasonText(code);
    const at = rest.indexOf(text);
    if (at < 0) return;
    parts.push(rest.slice(0, at), <ReasonTag key={i} code={code} tone="neutral" layout="inline" />);
    rest = rest.slice(at + text.length);
  });
  parts.push(rest);
  return (
    <span data-verdict-line={h.kind} data-tone={tone} className={className ? `${TONE[tone]} ${className}` : TONE[tone]}>
      {parts}
    </span>
  );
}
