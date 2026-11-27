import { basescanDecision } from "@/lib/chain/basescan";
import type { BriefEntry } from "@/lib/chain/ledger";
import { reasonDisplay } from "@/lib/chain/reason";

/**
 * Each inbox brief a Decision adopted, with the Decisions that adopted it. Built from the Decisions' blobs, so it needs
 * no journal; the brief's own text lives in the inbox contract, which this page does not read.
 */
export function BriefMap({ briefs }: { briefs: readonly BriefEntry[] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-ink">Inbox briefs and the Decisions that adopted them</h3>
      <p className="max-w-[720px] text-sm text-ink-body">
        Read from the chain, not from the journal: the brief ids each Decision&apos;s maat:v1 blob names in its q field,
        counted only when the blob&apos;s hash matched the Decision&apos;s rationaleHash. This page shows the ids, not
        the text of the briefs.
      </p>
      {briefs.length === 0 ? (
        <p className="text-sm text-ink-2">No Decision has adopted an inbox brief yet.</p>
      ) : (
        <div className="card overflow-hidden">
          <ol aria-label="Inbox briefs, newest first" className="m-0 list-none p-0">
            {briefs.map((b) => (
              <li key={b.id} className="flex flex-col gap-2 border-b border-line-soft px-5 py-3">
                <span data-brief-id className="font-mono text-[13px] font-semibold text-ink">
                  Brief #{b.id}
                </span>
                {b.decisions.map((d) => {
                  const reason = reasonDisplay(d.reason);
                  return (
                    <p key={d.key} data-adopted className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-mono text-[12px] text-ink-2">
                        {d.timeLabel}
                        {d.timestamp !== null ? " ET" : ""}
                      </span>
                      <span className="font-medium text-ink">
                        {d.action} · {d.symbol} · {d.amountLabel}
                      </span>
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-semibold ${d.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"}`}>
                        {d.allowed ? "Allowed" : "Refused"} · {reason.label}
                      </span>
                      <code className="font-mono text-[11px] text-ink-2">{reason.code}</code>
                      <a href={basescanDecision(d.txHash)} aria-label={`Transaction ${d.txHash.slice(0, 10)}… on Basescan`} className="font-mono text-[12px]">
                        Basescan<span aria-hidden="true"> ↗</span>
                      </a>
                    </p>
                  );
                })}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
