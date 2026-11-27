import { ReasonTag } from "@/components/ui/ReasonTag";
import { HERO_REASON_TX, heroReason } from "@/content/hero-reason";
import { etLabel, formatUsd6 } from "@/lib/chain/ledger";
import { basescanDecision } from "@/lib/live/basescan";

const shortTx = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/**
 * The hero's last row, under both columns: Claude's own reason for the first trade of Maat's agent that the vault
 * allowed, word for word from that transaction's input (content/hero-reason.ts decodes it at build time). The vault card
 * shows what the vault decided; this shows why Claude proposed it, so a visitor sees both halves of "Claude proposes.
 * The vault decides." on one real trade. It spans the grid, so neither column grows: the trade and its verdict on the
 * left, the quote on the right, stacked on phones. A server component: the quote is in the exported HTML, and nothing
 * is read from Base to show it. The text is a string child, so it is text, never markup.
 */
export function HeroReason() {
  const tx = HERO_REASON_TX;
  const reason = heroReason();
  return (
    <figure
      data-hero-reason=""
      className="col-span-full m-0 grid gap-x-8 gap-y-3 rounded-[14px] border border-line px-5 py-5 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:px-7"
    >
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
      </figcaption>
      <div className="flex min-w-0 flex-col gap-2.5">
        <blockquote dir="auto" className="m-0 text-[17px] leading-[1.5] text-ink [overflow-wrap:anywhere] sm:text-[19px]">
          &ldquo;{reason.text}&rdquo;
        </blockquote>
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
      </div>
    </figure>
  );
}
