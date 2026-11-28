import { ReasonTag } from "@/components/ui/ReasonTag";
import { HERO_REASON_NEXT, HERO_REASON_TX, heroReason, reasonGloss } from "@/content/hero-reason";
import { etLabel, formatUsd6 } from "@/lib/chain/ledger";
import { basescanDecision } from "@/lib/live/basescan";

const shortTx = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** The figure's own classes; a caller adds the breakpoint that shows it (Hero and HowItWorks). */
const FIGURE =
  "col-span-full m-0 grid gap-x-8 gap-y-3 rounded-[14px] border border-line px-5 py-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:px-7";

/**
 * Claude's own reason for the first trade of Maat's agent that the vault allowed, word for word from that transaction's
 * input (content/hero-reason.ts decodes it at build time). The vault card shows what the vault decided; this shows why
 * Claude proposed it, so a visitor sees both halves of "Claude proposes. The vault decides." on one real trade. Its
 * round line names this trade's own hash and the other buy the vault allowed in that round, linked to Basescan, and a
 * line under the quote glosses its "pp" (cold read of 2026-11-28, gaps 3 and 4). From sm it is the hero's last row,
 * spanning the grid so neither column grows: the trade, its verdict and the round line on the left, the quote on the
 * right. Below sm it shows in How it works instead (gap 6), with `roundLast`: the round line goes after the
 * attribution, so on a phone it does not come between the verdict and Claude's words (review of PR #120). It renders
 * once per breakpoint, so any selector for it must be scoped to #top or #how. A server component: the quote is in the
 * exported HTML, and nothing is read from Base to show it. The text is a string child, so it is text, never markup.
 */
export function HeroReason({ className, roundLast = false }: { className?: string; roundLast?: boolean } = {}) {
  const tx = HERO_REASON_TX;
  const next = HERO_REASON_NEXT;
  const reason = heroReason();
  const gloss = reasonGloss(reason.text);
  const round = (
    <span data-hero-reason-round="" className="text-[13px] leading-normal text-ink-2">
      This trade, <span className="font-mono text-[12px]">{shortTx(tx.txHash)}</span>, was the first of two buys the vault
      allowed in one round; the second was BUY {next.symbol} · {formatUsd6(next.amount)},{" "}
      <a
        href={basescanDecision(next.txHash)}
        aria-label={`${shortTx(next.txHash)} on Basescan`}
        target="_blank"
        rel="noopener noreferrer"
        className="tap font-mono text-[12px] font-medium"
      >
        {shortTx(next.txHash)}
        <span aria-hidden="true"> ↗</span>
      </a>
    </span>
  );
  return (
    <figure data-hero-reason="" className={[FIGURE, className].filter(Boolean).join(" ")}>
      <figcaption className="flex min-w-0 flex-col gap-2">
        <span className="font-mono text-[12px] leading-5 text-ink-2">
          Why Maat&apos;s agent made its first allowed trade · {etLabel(tx.timestamp)} ET
        </span>
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
          BUY {tx.symbol} · {formatUsd6(tx.amount)}
        </span>
        <span className="text-[13px] font-medium text-ink">
          Allowed · <ReasonTag code="OK" layout="text" />
        </span>
        {roundLast ? null : round}
      </figcaption>
      <div className="flex min-w-0 flex-col gap-2.5">
        <blockquote dir="auto" className="m-0 text-[17px] leading-[1.5] text-ink [overflow-wrap:anywhere] sm:text-[19px]">
          &ldquo;{reason.text}&rdquo;
        </blockquote>
        {gloss === null ? null : (
          <p data-hero-reason-gloss="" className="m-0 text-[13px] leading-normal text-ink-2">
            {gloss}
          </p>
        )}
        <p className="m-0 text-[13px] leading-normal text-ink-2">
          Claude&apos;s words (<code className="font-mono text-[12px]">{reason.model}</code>), carried in the
          transaction&apos;s own input. Their keccak256 equals the rationaleHash the vault logged with its Decision.{" "}
          <a href={basescanDecision(tx.txHash)} target="_blank" rel="noopener noreferrer" className="tap font-medium">
            <span className="font-mono text-[12px]">{shortTx(tx.txHash)}</span> on Basescan
            <span aria-hidden="true"> ↗</span>
          </a>{" "}
          ·{" "}
          <a href="/ledger" className="tap font-medium">
            Check the hash on /ledger
            <span aria-hidden="true"> →</span>
          </a>
        </p>
        {roundLast ? round : null}
      </div>
    </figure>
  );
}
