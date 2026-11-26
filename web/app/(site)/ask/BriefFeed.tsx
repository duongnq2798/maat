import type { BriefAnswer, BriefCounts, FeedItem } from "@/lib/chain/inbox";

/** What each cap the agent journals a skipped brief with means (agent/src/briefs/caps.ts BRIEF_CAPS). */
const CAP_TEXT: Readonly<Record<string, string>> = {
  "llm-per-day": "the agent's daily Claude cap was reached",
  "brief-llm-per-day": "the daily Claude budget for briefs was spent",
  "brief-txs-per-day": "the daily budget of brief-driven transactions was spent",
  "briefs-per-day": "the daily cap on briefs was reached",
  "briefs-per-sender": "its sender's daily cap was reached",
};

/** The agent's answer as one line of text. The reply is the agent's sanitized text, shown as a string child like a brief. */
function answerText(a: BriefAnswer): string {
  const adopted = a.outcome !== "skipped" && a.adopted ? " It adopted this brief into an intent; the vault decides." : "";
  if (a.outcome === "replied") return `Maat replied: ${a.reply}${adopted}`;
  if (a.outcome === "unanswered") return `Sent to Claude, which gave no reply.${adopted}`;
  return `Not sent to Claude: ${CAP_TEXT[a.cap] ?? "a daily cap was reached"}.`;
}

/**
 * The briefs, newest first, each with the agent's answer once the journal has one. Each text reaches React as a string
 * child, which React writes as a text node: no markup, no autolinking, no markdown. Nothing in the feed is a link, not
 * even the sender. The text has already been through plainBriefText, and dir="auto" keeps a right-to-left brief from
 * reordering the text around it.
 */
export function BriefFeed({ items }: { items: readonly FeedItem[] }) {
  if (items.length === 0) return <p className="m-0 text-[15px] text-ink-2">No brief yet.</p>;
  return (
    <ol aria-label="Briefs" className="m-0 flex list-none flex-col p-0">
      {items.map((b) => (
        <li key={b.id} data-brief-id={b.id} className="flex flex-col gap-1.5 border-b border-line py-4 last:border-b-0">
          <span className="font-mono text-[12px] text-ink-2">
            #{b.id} · {b.sender}
          </span>
          <p data-brief-text="" dir="auto" className="m-0 whitespace-pre-wrap text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">
            {b.text}
          </p>
          {b.answer ? (
            <p data-brief-answer={b.answer.outcome} className="m-0 text-[14px] leading-relaxed text-ink-2 [overflow-wrap:anywhere]">
              {answerText(b.answer)}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function Counter({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line py-2.5 sm:border-b-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd data-testid={id} className="m-0 font-mono text-[15px] font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

const NOT_YET = "not available yet";

/**
 * Briefs and distinct wallets, from the inbox's logs; `null` while they are being read. Both count every sender, the
 * team's own wallets included, because the page has no team set to leave out (inbox spec §5 keeps team briefs apart on
 * /proof). Claude persuaded, vault allowed and vault refused have no source on the page yet, so they say so instead of
 * showing a number.
 */
export function BriefCounters({ counts }: { counts: BriefCounts | null }) {
  const n = (v: number | undefined) => (v === undefined ? "…" : v.toLocaleString("en-US"));
  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-1 gap-x-6 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))]">
        <Counter id="count-briefs" label="Briefs, team included" value={n(counts?.briefs)} />
        <Counter id="count-wallets" label="Wallets, team included" value={n(counts?.wallets)} />
        <Counter id="count-persuaded" label="Claude persuaded" value={NOT_YET} />
        <Counter id="count-allowed" label="Vault allowed" value={NOT_YET} />
        <Counter id="count-refused" label="Vault refused" value={NOT_YET} />
      </dl>
      <p className="m-0 text-[13px] leading-normal text-ink-2">
        Briefs and wallets count every sender, the team&apos;s own wallets included. Claude persuaded, vault allowed and vault
        refused are not counted yet.
      </p>
      {counts && counts.hidden > 0 ? (
        <p className="m-0 text-[13px] leading-normal text-ink-2">
          {counts.hidden === 1 ? "1 brief is" : `${counts.hidden} briefs are`} hidden from the feed by the owner; {counts.hidden === 1 ? "it still counts" : "they still count"}.
        </p>
      ) : null}
    </div>
  );
}
