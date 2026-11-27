"use client";

import { useState } from "react";
import type { Hash, Hex } from "viem";
import { formatInt } from "@/content/format";
import type { RefusalCode } from "@/content/reasons";
import { basescanDecision } from "@/lib/chain/basescan";
import { basescanRefusalNote } from "@/lib/live/basescan";
import { anchorState, etLabel, type DecisionTrail, type MainnetDecision } from "@/lib/chain/ledger";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { verifyRationale, type RationaleCheck } from "@/lib/chain/rationale";
import { reasonDisplay } from "@/lib/chain/reason";
import type { Since } from "@/lib/chain/since";
import { Tape, TapeRow } from "@/components/instrument/Tape";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { BlobView, BuilderCodeLine, SenderLine, UndecodedBlob, type AnchorView } from "./AgentTrail";
import type { JournalView } from "./useJournal";

type Verdict = "all" | "allowed" | "refused";
const PAGE = 25;

const BADGE: Record<RationaleCheck, { text: string; className: string; title: string }> = {
  verified: {
    text: "Hash verified",
    className: "bg-accent-tint text-accent",
    title: "keccak256 of this text equals the rationaleHash the vault recorded.",
  },
  mismatch: {
    text: "Hash mismatch",
    className: "bg-refuse-tint text-refuse",
    title: "The exported text does not hash to the rationaleHash the vault recorded, so it is not shown.",
  },
  missing: {
    text: "Rationale not exported yet",
    className: "bg-surface-soft text-ink-2",
    title: "No text has been exported for this intent yet; the hash onchain still commits to its text.",
  },
};

/** Shown instead of "not exported" while that cannot be known yet. */
const NOT_READ: Record<"checking" | "unavailable", { text: string; className: string; title: string }> = {
  checking: {
    text: "Checking rationale…",
    className: "bg-surface-soft text-ink-2",
    title: "The exported rationale text is looked up once the vault's history has been read.",
  },
  unavailable: {
    text: "Rationale text unavailable",
    className: "bg-surface-soft text-ink-2",
    title: "The exported rationale text could not be read this time; the hash onchain still commits to its text.",
  },
};

/** The rationale text of /data/rationales.json, checked against the hash: the path of a Decision with no blob. */
function ExportedRationale({ d, text, rationaleState }: { d: MainnetDecision; text: string | undefined; rationaleState: LedgerSnapshot["rationaleState"] }) {
  const check = verifyRationale(text, d.rationaleHash);
  const badge = check === "missing" && rationaleState !== "read" ? NOT_READ[rationaleState] : BADGE[check];
  return (
    <div className="flex flex-col gap-1.5">
      <span title={badge.title} className={`self-start rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${badge.className}`}>
        {badge.text}
      </span>
      {check === "verified" ? <blockquote className="border-l-2 border-line pl-3 text-sm text-ink-body">{text}</blockquote> : null}
    </div>
  );
}

/** The anchor of a blob in the journal, from what the page has read of the journal so far. */
function anchorView(d: MainnetDecision, blob: { text: string; j: Hash }, journal: JournalView): AnchorView {
  switch (journal.state) {
    case "idle":
    case "loading":
      return "checking";
    case "absent":
      return "absent";
    case "error":
      return "unreadable";
    case "read": {
      // journal.rows stops at the first line that failed, so "pending" says nothing once the chain is broken.
      const a = anchorState(d.txHash, blob, journal.rows);
      return a === "pending" && journal.failure ? "chain-broken" : a;
    }
  }
}

function Rationale({ d, text, rationaleState, trail, journal }: RowProps) {
  const blob = trail?.call?.blob;
  if (blob?.status === "v1") {
    return <BlobView blob={blob} hashOk={trail!.blobHashOk === true} anchor={anchorView(d, { text: blob.text, j: blob.fields.j }, journal)} />;
  }
  if (blob?.status === "invalid" || blob?.status === "foreign") return <UndecodedBlob blob={blob} hashOk={trail!.blobHashOk === true} />;
  return <ExportedRationale d={d} text={text} rationaleState={rationaleState} />;
}

interface RowProps {
  d: MainnetDecision;
  text: string | undefined;
  rationaleState: LedgerSnapshot["rationaleState"];
  trail: DecisionTrail | undefined;
  txState: LedgerSnapshot["txState"];
  journal: JournalView;
}

/** The quiet mark of a Decision that is new since the viewer's last look. */
function NewMark() {
  return (
    <span data-since-new="" className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
      New<span className="sr-only"> since your last look</span>
    </span>
  );
}

/**
 * "N new since your last look · <when>", or "Nothing new since your last look · <when>". The paragraph is there from
 * the first row on, empty until the count is exact, so a screen reader hears the line politely once it fills; a first
 * visit leaves it empty.
 */
function SinceLine({ since }: { since: Since | null }) {
  const count = since?.count ?? null;
  return (
    <p data-since-line="" aria-live="polite" className={`m-0 flex flex-wrap items-center gap-x-2 text-sm text-ink-2 ${count === null ? "" : "mb-3"}`}>
      {since && count !== null ? (
        <>
          {count > 0 ? <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" /> : null}
          <span>
            {count === 0 ? "Nothing new" : `${formatInt(count)} new`} since your last look ·{" "}
            <time dateTime={new Date(since.at).toISOString()} className="font-mono text-[13px]">
              {etLabel(Math.floor(since.at / 1000))} ET
            </time>
          </span>
        </>
      ) : null}
    </p>
  );
}

function Row(props: RowProps & { isNew: boolean; fresh: boolean; onPrinted: (key: string) => void }) {
  const { d, trail, txState, isNew, fresh, onPrinted } = props;
  const reason = reasonDisplay(d.reason);
  return (
    <TapeRow
      verdict={d.allowed ? "allowed" : "refused"}
      fresh={fresh}
      onPrinted={fresh ? () => onPrinted(d.key) : undefined}
      // border-l-0: the row keeps its look inside the card, without the tape's verdict rule; TapeRow brings the print-in.
      className="grid gap-x-6 gap-y-2 border-b border-l-0 border-line-soft px-5 py-4 md:grid-cols-[150px_minmax(0,1fr)_auto]"
    >
      <div className="flex flex-wrap content-start items-center gap-x-3 gap-y-1.5 font-mono text-[13px] text-ink-2">
        <span>
          {d.timeLabel}
          {d.timestamp !== null ? " ET" : ""}
        </span>
        {isNew ? <NewMark /> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-base font-medium text-ink">
            {d.action} · {d.symbol} · {d.amountLabel}
          </span>
          <span
            className={`inline-block rounded-lg px-2.5 py-1 text-xs font-semibold ${
              d.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"
            }`}
          >
            {d.allowed ? "Allowed" : "Refused"} · {reason.label}
          </span>
          <code className="font-mono text-[11px] text-ink-2">{reason.code}</code>
        </p>
        {d.allowed ? null : <p className="text-sm text-ink-2">{reason.meaning}</p>}
        {d.allowed || d.reason === "OK" ? null : (
          <p data-basescan-note="" className="text-xs text-ink-2">
            {basescanRefusalNote(d.reason)}
          </p>
        )}
        <SenderLine trail={trail} txState={txState} />
        <Rationale {...props} />
        {trail?.call ? <BuilderCodeLine check={trail.builderCode} /> : null}
      </div>
      <div className="flex flex-row flex-wrap gap-x-4 font-mono text-[12px] text-ink-2 md:flex-col md:items-end md:text-right">
        <span>{d.gasUsed === null ? "gas unknown" : `${formatInt(Number(d.gasUsed))} gas`}</span>
        <a href={basescanDecision(d.txHash)} aria-label={`Transaction ${d.txHash.slice(0, 10)}… on Basescan`}>
          Basescan<span aria-hidden="true"> ↗</span>
        </a>
      </div>
    </TapeRow>
  );
}

/**
 * Every Decision event, newest first, filterable by verdict and by the refusal reason picked in the chart. With `since`,
 * the Decisions after the viewer's last look carry a mark and print in once, under a line that counts them.
 */
export function DecisionTimeline({
  decisions,
  rationales,
  rationaleState,
  trails = new Map(),
  txState = "read",
  journal = { state: "idle" },
  reason,
  onReason,
  scanning,
  since = null,
  confirming = null,
}: {
  decisions: readonly MainnetDecision[];
  rationales: ReadonlyMap<Hex, string>;
  rationaleState: LedgerSnapshot["rationaleState"];
  /** Sender label, decoded calldata and Builder Code check by MainnetDecision.key. */
  trails?: ReadonlyMap<string, DecisionTrail>;
  txState?: LedgerSnapshot["txState"];
  /** The agent-journal branch as read so far, for the anchor of each blob. */
  journal?: JournalView;
  reason: RefusalCode | null;
  onReason: (code: RefusalCode | null) => void;
  scanning: boolean;
  /** The Decisions after the viewer's last look (lib/chain/since.ts); null on a first visit. */
  since?: Since | null;
  /** The committed snapshot's block while its Decisions show before Base has confirmed the file; null once Base is read. */
  confirming?: bigint | null;
}) {
  const [verdict, setVerdict] = useState<Verdict>("all");
  const [shown, setShown] = useState(PAGE);
  // New rows whose print-in has ended: a filter or a tab that shows them again never prints them twice.
  const [printed, setPrinted] = useState<ReadonlySet<string>>(() => new Set());
  const onPrinted = (key: string) => setPrinted((s) => (s.has(key) ? s : new Set(s).add(key)));
  const rows = decisions.filter(
    (d) => (reason ? !d.allowed && d.reason === reason : verdict === "all" || d.allowed === (verdict === "allowed")),
  );
  const chip = (on: boolean) =>
    `min-h-11 cursor-pointer rounded-full border px-[18px] py-2.5 text-sm font-medium ${
      on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink hover:border-ink"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SinceLine since={since} />
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter mainnet decisions">
          {(["all", "allowed", "refused"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={!reason && verdict === v}
              onClick={() => {
                onReason(null);
                setVerdict(v);
              }}
              className={chip(!reason && verdict === v)}
            >
              {v === "all" ? "All" : v === "allowed" ? "Allowed" : "Refused"}
            </button>
          ))}
          {reason ? (
            <button type="button" aria-pressed onClick={() => onReason(null)} className={chip(true)}>
              <ReasonTag code={reason} tone="verdict" layout="inline" />
              <span aria-hidden="true"> ×</span>
              <span className="sr-only"> (clear the reason filter)</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="card overflow-hidden">
        {confirming === null ? null : (
          <p data-confirming="" className="border-b border-line px-5 py-3 font-mono text-xs text-ink-2">
            From the committed snapshot of block {formatInt(Number(confirming))} · confirming on Base…
          </p>
        )}
        {rows.length === 0 ? (
          <p className="px-5 py-5 text-sm text-ink-2">{decisions.length === 0 ? "The vault has recorded no decision yet." : "No decision matches this filter."}</p>
        ) : (
          <Tape label="Mainnet decisions">
            {rows.slice(0, shown).map((d) => {
              const isNew = since?.fresh.has(d.key) ?? false;
              return (
                <Row
                  key={d.key}
                  d={d}
                  text={rationales.get(d.intentId)}
                  rationaleState={rationaleState}
                  trail={trails.get(d.key)}
                  txState={txState}
                  journal={journal}
                  isNew={isNew}
                  fresh={isNew && !printed.has(d.key)}
                  onPrinted={onPrinted}
                />
              );
            })}
          </Tape>
        )}
        {rows.length > shown ? (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="w-full border-t border-line px-5 py-3 text-sm font-medium text-ink hover:bg-surface-soft">
            Show {formatInt(Math.min(PAGE, rows.length - shown))} more of {formatInt(rows.length - shown)}
          </button>
        ) : null}
        {scanning ? <p className="border-t border-line px-5 py-3 font-mono text-xs text-ink-2">Still reading older blocks…</p> : null}
      </div>
    </div>
  );
}
