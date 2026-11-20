"use client";

import { useState } from "react";
import type { Hex } from "viem";
import { formatInt } from "@/content/format";
import type { RefusalCode } from "@/content/reasons";
import { basescanTx } from "@/lib/chain/basescan";
import type { MainnetDecision } from "@/lib/chain/ledger";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { verifyRationale, type RationaleCheck } from "@/lib/chain/rationale";
import { reasonDisplay } from "@/lib/chain/reason";
import { ReasonTag } from "@/components/ui/ReasonTag";

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
    title: "The agent's journal has not been exported for this intent; the hash onchain still commits to its text.",
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

function Row({ d, text, rationaleState }: { d: MainnetDecision; text: string | undefined; rationaleState: LedgerSnapshot["rationaleState"] }) {
  const check = verifyRationale(text, d.rationaleHash);
  const badge = check === "missing" && rationaleState !== "read" ? NOT_READ[rationaleState] : BADGE[check];
  const reason = reasonDisplay(d.reason);
  return (
    <li className="grid gap-x-6 gap-y-2 border-b border-line-soft px-5 py-4 md:grid-cols-[150px_minmax(0,1fr)_auto]">
      <div className="font-mono text-[13px] text-ink-2">
        {d.timeLabel}
        {d.timestamp !== null ? " ET" : ""}
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
        <div className="flex flex-col gap-1.5">
          <span title={badge.title} className={`self-start rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold ${badge.className}`}>
            {badge.text}
          </span>
          {check === "verified" ? <blockquote className="border-l-2 border-line pl-3 text-sm text-ink-body">{text}</blockquote> : null}
        </div>
      </div>
      <div className="flex flex-row flex-wrap gap-x-4 font-mono text-[12px] text-ink-2 md:flex-col md:items-end md:text-right">
        <span>{d.gasUsed === null ? "gas unknown" : `${formatInt(Number(d.gasUsed))} gas`}</span>
        <a href={basescanTx(d.txHash)} aria-label={`Transaction ${d.txHash.slice(0, 10)}… on Basescan`}>
          Basescan<span aria-hidden="true"> ↗</span>
        </a>
      </div>
    </li>
  );
}

/** Every Decision event, newest first, filterable by verdict and by the refusal reason picked in the chart. */
export function DecisionTimeline({
  decisions,
  rationales,
  rationaleState,
  reason,
  onReason,
  scanning,
}: {
  decisions: readonly MainnetDecision[];
  rationales: ReadonlyMap<Hex, string>;
  rationaleState: LedgerSnapshot["rationaleState"];
  reason: RefusalCode | null;
  onReason: (code: RefusalCode | null) => void;
  scanning: boolean;
}) {
  const [verdict, setVerdict] = useState<Verdict>("all");
  const [shown, setShown] = useState(PAGE);
  const rows = decisions.filter(
    (d) => (reason ? !d.allowed && d.reason === reason : verdict === "all" || d.allowed === (verdict === "allowed")),
  );
  const chip = (on: boolean) =>
    `min-h-11 cursor-pointer rounded-full border px-[18px] py-2.5 text-sm font-medium ${
      on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink hover:border-ink"
    }`;

  return (
    <div className="flex flex-col gap-4">
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
      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-5 py-5 text-sm text-ink-2">{decisions.length === 0 ? "The vault has recorded no decision yet." : "No decision matches this filter."}</p>
        ) : (
          <ol aria-label="Mainnet decisions" className="m-0 list-none p-0">
            {rows.slice(0, shown).map((d) => (
              <Row key={d.key} d={d} text={rationales.get(d.intentId)} rationaleState={rationaleState} />
            ))}
          </ol>
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
