import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import { basescanDecision } from "@/lib/chain/basescan";
import type { DecisionTrail, MainnetDecision, SenderLabel } from "@/lib/chain/ledger";
import { reasonDisplay } from "@/lib/chain/reason";
import { basescanRefusalNote } from "@/lib/live/basescan";
import { SenderChip } from "./AgentTrail";

/** Where the Decisions list starts on /ledger; the card's jump link points at it. */
export const DECISIONS_ID = "decisions";

/** The sender of a Decision: its trail's label once its transaction is read, else the one this build records for it. */
function senderOf(d: MainnetDecision, trail: DecisionTrail | undefined): SenderLabel | null {
  if (trail?.label) return trail.label;
  return FACTS.mainnetDecisions.value.find((l) => l.transactionHash.toLowerCase() === d.txHash.toLowerCase())?.sender ?? null;
}

/**
 * The vault's newest Decision, at the top of /ledger so a phone sees it on the first screen, with a jump to the full
 * list, its Basescan link on the Logs tab and, for a refusal, why Basescan says Success.
 */
export function LatestDecision({
  decision: d,
  trail,
  count,
  status,
}: {
  decision: MainnetDecision;
  trail?: DecisionTrail;
  /** How many Decisions the list below holds. */
  count: number;
  /**
   * "confirming" while it comes from the committed snapshot, before Base has confirmed the file; "reading" while the
   * scan of Base has newer blocks to read; "read" once every block to the head is read.
   */
  status: "confirming" | "reading" | "read";
}) {
  const reason = reasonDisplay(d.reason);
  const sender = senderOf(d, trail);
  return (
    <div data-latest-decision={status} className="rounded-xl border border-line bg-bg px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <span className="eyebrow">
          Latest Decision
          {status === "read" ? null : (
            <span className="font-normal normal-case tracking-normal text-ink-2">
              {status === "confirming" ? " · from the committed snapshot, confirming on Base…" : " · reading newer blocks…"}
            </span>
          )}
        </span>
        <a href={`#${DECISIONS_ID}`} className="text-sm font-medium">
          All {formatInt(count)} {count === 1 ? "Decision" : "Decisions"}
          <span aria-hidden="true"> ↓</span>
        </a>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-base font-medium text-ink">
          {d.action} · {d.symbol} · {d.amountLabel}
        </span>
        <span className={`inline-block rounded-lg px-2.5 py-1 text-xs font-semibold ${d.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"}`}>
          {d.allowed ? "Allowed" : "Refused"} · {reason.label}
        </span>
        <code className="font-mono text-[11px] text-ink-2">{reason.code}</code>
        {sender ? <SenderChip label={sender} /> : null}
      </p>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-ink-2">
        <span>
          {d.timeLabel}
          {d.timestamp !== null ? " ET" : ""}
        </span>
        <a href={basescanDecision(d.txHash)} aria-label={`Latest Decision, transaction ${d.txHash.slice(0, 10)}… on Basescan`}>
          Basescan<span aria-hidden="true"> ↗</span>
        </a>
      </p>
      {d.allowed || d.reason === "OK" ? null : <p className="mt-1.5 text-xs text-ink-2">{basescanRefusalNote(d.reason)}</p>}
    </div>
  );
}
