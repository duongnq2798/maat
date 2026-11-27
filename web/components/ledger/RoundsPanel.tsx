import type { Hash } from "viem";
import { formatInt } from "@/content/format";
import { basescanDecision, basescanTx } from "@/lib/chain/basescan";
import { etLabel, formatUsd6, JOURNAL_BRANCH_URL, JOURNAL_RAW_URL, type BriefEntry, type JournalRow } from "@/lib/chain/ledger";
import { COMMIT_RE } from "@/lib/chain/rationale";
import { CommitRef } from "./AgentTrail";
import { BriefMap } from "./BriefMap";
import type { JournalView } from "./useJournal";

/** How many rows the panel lists, newest first. The chain check covers every row. */
export const ROUNDS_SHOWN = 30;

const TX_RE = /^0x[0-9a-fA-F]{64}$/;
/**
 * The row kinds whose txHash is the agent's execute call to the vault, so the tx holds a Decision: Basescan opens it on
 * the Logs tab, where the Decision log shows a refusal that the tx's own "Success" hides. A housekeeping or brief row's
 * tx is another call, opened on the plain tx page.
 */
const DECISION_KINDS: ReadonlySet<unknown> = new Set(["intent", "sent", "reconcile"]);
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

/** A field of a published row as plain text; the publisher wrote it, so nothing in it is followed as a link. */
function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** A journal `decision` ({ allowed, reason }) as "allowed OK" or "refused MARKET_CLOSED". */
function verdict(v: unknown): string | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return str(v);
  const d = v as { allowed?: unknown; reason?: unknown };
  return [typeof d.allowed === "boolean" ? (d.allowed ? "allowed" : "refused") : null, str(d.reason)].filter(Boolean).join(" ") || null;
}

function usd(v: unknown): string | null {
  return typeof v === "string" && /^\d+$/.test(v) ? formatUsd6(BigInt(v)) : str(v);
}

function when(ts: unknown): string {
  const ms = typeof ts === "string" ? Date.parse(ts) : Number.NaN;
  return Number.isNaN(ms) ? (str(ts) ?? "no time") : `${etLabel(Math.floor(ms / 1000))} ET`;
}

/** The allowlisted fields of a row (spec §3.2) as short phrases. */
function phrases(f: Readonly<Record<string, unknown>>): string[] {
  const parts: (string | null)[] = [];
  const add = (label: string, v: unknown) => {
    const s = label === "decision" ? verdict(v) : str(v);
    if (s !== null) parts.push(`${label} ${s}`);
  };
  switch (f.kind) {
    case "run":
      parts.push(str(f.mode));
      if (typeof f.ok === "boolean") parts.push(f.ok ? "ok" : "not ok");
      // A run row's only trace of its error: the daily LLM cap stopped the round before Claude was called (§3.2).
      if (f.capped === true) parts.push("daily LLM cap reached, Claude not called");
      add("block", f.block);
      add("proposals", f.proposals);
      add("suggestions", f.suggestions);
      parts.push(str(f.summary));
      break;
    case "intent":
    case "sent":
      parts.push([str(f.action), str(f.symbol), usd(f.amountUsd6)].filter(Boolean).join(" ") || null);
      add("preview", f.preview);
      add("gate", f.gate);
      add("decision", f.decision);
      break;
    case "reconcile":
      parts.push(str(f.action));
      add("outcome", f.outcome);
      add("decision", f.decision);
      break;
    case "mismatch":
      add("preview", f.preview);
      add("decision", f.decision);
      break;
    case "housekeeping":
      parts.push(str(f.call));
      add("token", f.token);
      break;
    case "skip":
      parts.push([str(f.action), str(f.symbol)].filter(Boolean).join(" ") || null);
      break;
    default:
      break;
  }
  return parts.filter((p): p is string => p !== null && p !== "");
}

function Row({ row }: { row: JournalRow }) {
  const f = row.fields;
  const tx = typeof f.txHash === "string" && TX_RE.test(f.txHash) ? (f.txHash as Hash) : null;
  const commit = typeof f.commit === "string" && COMMIT_RE.test(f.commit) ? f.commit : null;
  return (
    <li className="grid gap-x-6 gap-y-1 border-b border-line-soft px-5 py-3 md:grid-cols-[150px_minmax(0,1fr)_auto]">
      <span className="font-mono text-[12px] text-ink-2">{when(f.ts)}</span>
      <span className="min-w-0 break-words text-sm text-ink-body">
        <span className="font-mono text-[12px] font-semibold text-ink">{str(f.kind) ?? "row"}</span> {phrases(f).join(" · ")}
      </span>
      <span className="flex flex-row flex-wrap gap-x-3 font-mono text-[11px] text-ink-2 md:flex-col md:items-end md:text-right">
        <span title={`hash ${row.hash}`}>{shortHash(row.hash)}</span>
        {tx ? (
          <a href={DECISION_KINDS.has(f.kind) ? basescanDecision(tx) : basescanTx(tx)} aria-label={`Transaction ${tx.slice(0, 10)}… on Basescan`}>
            Basescan<span aria-hidden="true"> ↗</span>
          </a>
        ) : null}
        {commit ? <CommitRef commit={commit} /> : null}
      </span>
    </li>
  );
}

function Status({ journal, onReload }: { journal: JournalView; onReload: () => void }) {
  const retry = (
    <button type="button" onClick={onReload} className="min-h-11 self-start rounded-full border border-line-strong px-[18px] py-2.5 text-sm font-medium text-ink hover:border-ink">
      Read again
    </button>
  );
  switch (journal.state) {
    case "idle":
    case "loading":
      return <p className="text-sm text-ink-2">Reading the agent-journal branch from GitHub…</p>;
    case "absent":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-base font-medium text-ink">No journal has been published yet.</p>
          <p className="text-sm text-ink-body">
            The agent-journal branch does not exist yet, or holds no journal/index.json: GitHub answered 404 for{" "}
            <code className="break-all font-mono text-[12px]">{JOURNAL_RAW_URL}index.json</code>. The rounds appear here once
            the publisher pushes its first commit to that branch.
          </p>
          {retry}
        </div>
      );
    case "error":
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-refuse">The journal could not be read: {journal.message}.</p>
          {retry}
        </div>
      );
    case "read": {
      const files = `${formatInt(journal.files.length)} day ${journal.files.length === 1 ? "file" : "files"}`;
      const rows = `${formatInt(journal.rows.length)} ${journal.rows.length === 1 ? "row" : "rows"}`;
      return (
        <div className="flex flex-col gap-2">
          {journal.failure ? (
            <p className="text-sm font-medium text-refuse">
              ✗ Chain broken at journal/{journal.failure.file}, line {formatInt(journal.failure.line)}: {journal.failure.problem}. The {rows} before
              it verified.
            </p>
          ) : (
            <p className="text-sm font-medium text-ink">
              <span className="text-accent">✓</span> Chain verified in your browser: {rows} in {files}
              {journal.head ? (
                <>
                  , head <code className="break-all font-mono text-[12px]">{journal.head}</code>
                </>
              ) : null}
              .
            </p>
          )}
          <a href={JOURNAL_BRANCH_URL} className="self-start text-sm font-medium">
            The agent-journal branch on GitHub<span aria-hidden="true"> ↗</span>
          </a>
          {retry}
        </div>
      );
    }
  }
}

/**
 * The Rounds tab: the public journal, its hash chain checked in the browser, and its latest rows; then, when `briefs`
 * is given, the inbox briefs the Decisions adopted.
 */
export function RoundsPanel({ journal, onReload, briefs }: { journal: JournalView; onReload: () => void; briefs?: readonly BriefEntry[] }) {
  const rows = journal.state === "read" ? journal.rows.slice(-ROUNDS_SHOWN).reverse() : [];
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[720px] text-sm text-ink-body">
        Each round the agent runs adds rows to its journal: the round, each intent, each send. A publisher appends a
        redacted copy to the public agent-journal branch, each line holding the hash of the line before it. Your browser fetches every day file from GitHub,
        recomputes every hash and checks every link, so a line changed after it was published breaks the chain here.
      </p>
      <Status journal={journal} onReload={onReload} />
      {rows.length > 0 ? (
        <div className="card overflow-hidden">
          <ol aria-label="Journal rows, newest first" className="m-0 list-none p-0">
            {rows.map((r) => (
              <Row key={`${r.file}:${r.line}`} row={r} />
            ))}
          </ol>
        </div>
      ) : null}
      {briefs ? <BriefMap briefs={briefs} /> : null}
    </div>
  );
}
