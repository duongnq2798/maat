import type { Hash } from "viem";
import type { CountValue, Weighing, WeighingCounts, WeighingLine } from "@/lib/chain/inbox";

/** "0x1234…abcd", for a transaction hash shown as text. */
const shortHash = (h: Hash) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** "journal 2026-11-30.jsonl line 3 · agent commit 0123456": where the reply is, and the code that wrote the row. */
function journalLabel(row: NonNullable<Weighing["reply"]["row"]>): string {
  const commit = row.commit === null ? "no agent commit" : `agent commit ${row.commit === "unknown" ? "unknown" : row.commit.slice(0, 7)}${row.commit.endsWith("-dirty") ? "-dirty" : ""}`;
  return `journal ${row.file} line ${row.line} · ${commit}`;
}

const VERDICT_TONE: Record<Weighing["verdicts"][number]["state"], string> = {
  // A refusal carries at least the weight of an allow: the same size and weight, in the refuse color.
  refused: "font-semibold text-refuse",
  allowed: "font-semibold text-accent",
  none: "text-ink-2",
};

/**
 * The briefs, newest first, each as a weighing: "#N · sender" (with "team" when the sender is in /proof's team set),
 * the brief, what Maat's agent replied (from its journal, with the row and the agent commit), whether Claude was
 * persuaded, and the vault's verdict with its Decision, read from the Decision logs and never from Claude's text. Each
 * text reaches React as a string child, which React writes as a text node: no markup, no autolinking, no markdown.
 * Nothing in the feed is a link, not even the sender or the Decision. The brief has already been through
 * plainBriefText, and dir="auto" keeps a right-to-left brief from reordering the text around it.
 */
export function BriefFeed({ items }: { items: readonly Weighing[] }) {
  if (items.length === 0) return <p className="m-0 text-[15px] text-ink-2">No brief yet.</p>;
  return (
    <ol aria-label="Briefs" className="m-0 flex list-none flex-col p-0">
      {items.map((w) => (
        <li key={w.id} data-brief-id={w.id} className="flex flex-col gap-2 border-b border-line py-5 last:border-b-0">
          <p data-weighing="head" className="m-0 font-mono text-[12px] leading-normal text-ink-2">
            #{w.id} · {w.sender}
            {w.team ? (
              <>
                {" · "}
                <span data-team="" className="rounded-[6px] border border-line px-1.5 py-px text-[11px] font-medium text-ink">
                  team
                </span>
              </>
            ) : null}
          </p>
          <p data-weighing="brief" data-brief-text="" dir="auto" className="m-0 whitespace-pre-wrap text-[16px] leading-relaxed text-ink [overflow-wrap:anywhere]">
            {w.text}
          </p>
          <div className="flex flex-col gap-1.5 border-l-2 border-line pl-3 text-[14px] leading-relaxed">
            <p data-weighing="reply" data-reply={w.reply.state} className="m-0 text-ink-body [overflow-wrap:anywhere]">
              {w.reply.text}
              {w.reply.row ? (
                <span data-journal-row="" className="block font-mono text-[11px] leading-normal text-ink-2">
                  {journalLabel(w.reply.row)}
                </span>
              ) : null}
            </p>
            <p data-weighing="persuaded" data-persuaded={w.persuaded.state} className="m-0 text-ink-body">
              {w.persuaded.text}
            </p>
            {w.verdicts.map((v, i) => (
              <p key={v.decision ? `${v.decision.txHash}` : `none-${i}`} data-weighing="verdict" data-verdict={v.state} className="m-0 text-ink-body [overflow-wrap:anywhere]">
                Vault&apos;s verdict: <span className={VERDICT_TONE[v.state]}>{v.text}</span>
                {v.decision ? (
                  <span data-decision-tx={v.decision.txHash} className="font-mono text-[12px] text-ink-2">
                    {` · Decision ${shortHash(v.decision.txHash)} · block ${v.decision.blockNumber.toLocaleString("en-US")}`}
                  </span>
                ) : null}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** What a counter shows: its number (0 as 0), "…" while its source is read, or why it has none. */
function countText(v: CountValue | null): string {
  if (v === null || "reading" in v) return "…";
  if ("missing" in v) return v.missing;
  return v.value.toLocaleString("en-US");
}

function Counter({ id, label, value }: { id: string; label: string; value: CountValue | null }) {
  const missing = value !== null && "missing" in value;
  return (
    <div className="flex flex-col gap-1 border-b border-line py-2.5 sm:border-b-0">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd data-testid={id} className={`m-0 font-mono font-medium text-ink ${missing ? "text-[13px]" : "text-[15px]"}`}>
        {countText(value)}
      </dd>
    </div>
  );
}

const LABELS: Record<keyof WeighingLine, string> = {
  briefs: "briefs",
  wallets: "wallets",
  persuaded: "Claude persuaded",
  allowed: "Vault allowed",
  refused: "Vault refused",
};

function CounterLine({ name, prefix, line }: { name: string; prefix: "outside" | "team"; line: WeighingLine | null }) {
  const who = prefix === "outside" ? "Outside" : "Team";
  const id = (k: keyof WeighingLine) => (prefix === "outside" ? `count-${k}` : `count-team-${k}`);
  return (
    <div role="group" aria-label={name} className="flex flex-col gap-1">
      <p className="m-0 text-[13px] font-medium text-ink">{name}</p>
      <dl className="m-0 grid grid-cols-2 gap-x-6 sm:grid-cols-5">
        {(Object.keys(LABELS) as (keyof WeighingLine)[]).map((k) => (
          <Counter key={k} id={id(k)} label={k === "briefs" || k === "wallets" ? `${who} ${LABELS[k]}` : LABELS[k]} value={line ? line[k] : null} />
        ))}
      </dl>
    </div>
  );
}

/**
 * The counters, each brief counted once (weighingCounts): the outside line, then the team's own briefs on their own
 * line; `null` while the briefs are being read. Every counter names its source below it, and one whose source is
 * missing says why in place of a number. Zero shows as 0.
 */
export function BriefCounters({ counts }: { counts: WeighingCounts | null }) {
  const journalMissing = counts !== null && "missing" in counts.outside.persuaded && counts.outside.persuaded.missing === "no journal yet";
  return (
    <div className="flex flex-col gap-4">
      <CounterLine name="Outside briefs, by /proof's rule" prefix="outside" line={counts?.outside ?? null} />
      <CounterLine name="Team briefs, counted on their own line" prefix="team" line={counts?.team ?? null} />
      <div className="flex max-w-[720px] flex-col gap-1.5 text-[13px] leading-normal text-ink-2">
        <p className="m-0">
          Outside and team are split by /proof&apos;s team set, traced from Base at the block the briefs were read to; a hidden
          brief still counts. Claude persuaded counts briefs whose row in the agent&apos;s published journal says an intent
          adopted them. Vault allowed and vault refused count briefs that a brief-driven Decision cites, read from the
          vault&apos;s Decision logs: each brief counts once, as allowed when any Decision that cites it was allowed.
        </p>
        {counts ? (
          <p className="m-0">
            {counts.all.briefs.toLocaleString("en-US")} {counts.all.briefs === 1 ? "brief" : "briefs"} from {counts.all.wallets.toLocaleString("en-US")}{" "}
            {counts.all.wallets === 1 ? "wallet" : "wallets"} read from the inbox&apos;s logs, team included.
          </p>
        ) : null}
        {journalMissing ? <p className="m-0">The agent&apos;s journal is not published yet, so Claude persuaded has no source.</p> : null}
        {counts && counts.hidden > 0 ? (
          <p className="m-0">
            {counts.hidden === 1 ? "1 brief is" : `${counts.hidden} briefs are`} hidden from the feed by the owner; {counts.hidden === 1 ? "it still counts" : "they still count"}.
          </p>
        ) : null}
      </div>
    </div>
  );
}
