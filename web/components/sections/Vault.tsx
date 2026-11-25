"use client";

import { SourcePlate } from "@/components/instrument/SourcePlate";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { formatInt } from "@/content/format";
import { REASON_LABEL } from "@/content/reasons";
import { basescanTx } from "@/lib/live/basescan";
import { formatAge, formatBlock } from "@/lib/live/format";
import { useNowSec, useVault, type VaultView } from "./VaultDecisions";
import { intentText, type VaultRow } from "./vault-rows";

/** How many Decisions the card lists; /ledger lists them all. */
const LISTED = 3;

/** "2 h 5 min ago" for a live row once the visitor's clock is known; null otherwise. */
function ageOf(view: VaultView, row: VaultRow, now: number | null): string | null {
  if (view.status !== "live" || now === null || row.timestamp === null) return null;
  return `${formatAge(now - row.timestamp)} ago`;
}

/** "0x6162…23c8". */
const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/** "Refused · Market closed", or "Allowed" for a Decision every check passed. */
function verdictText(row: VaultRow): string {
  return row.allowed ? "Allowed" : `Refused · ${REASON_LABEL[row.reason]}`;
}

/**
 * The announcement bar's reading, from sm: how long ago the vault's last Decision was. It shows only once the live read
 * has landed, so neither the static HTML nor a failed read claims an age.
 */
export function VaultBarStatus() {
  const view = useVault();
  const now = useNowSec();
  const latest = view.decisions[0];
  const age = latest === undefined ? null : ageOf(view, latest, now);
  if (age === null) return null;
  return (
    <span data-vault-bar="" className="max-sm:hidden">
      Last Decision {age}.
    </span>
  );
}

/**
 * The hero's first line: the vault's latest Decision on Base mainnet, linked to its transaction on Basescan. Live, it
 * gives the Decision's age; before the read lands, or when it fails, it names the recorded Decision and its time. From
 * sm it keeps to one line, so a long refusal never pushes the CTAs below the first screen: what does not fit ends in an
 * ellipsis (the bar gives the age from sm, the engine card the whole Decision), and the link's name keeps all of it.
 */
export function VaultPlate() {
  const view = useVault();
  const now = useNowSec();
  const latest = view.decisions[0];
  const chip = (
    <span className="shrink-0 rounded-full bg-accent-tint px-2 py-[3px] font-mono text-[11px] font-semibold text-accent">BASE MAINNET</span>
  );
  const frame =
    "inline-flex max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 self-start rounded-[20px] border border-line bg-white py-[7px] pl-2 pr-3.5 text-[13px] text-ink-2 sm:flex-nowrap";
  if (latest === undefined) {
    return (
      <span data-vault-plate={view.status} className={frame}>
        {chip} The vault has made no Decision yet.
      </span>
    );
  }
  const age = ageOf(view, latest, now);
  const label = view.status === "live" ? "Last Decision" : "Recorded Decision";
  const when = age ?? `${latest.timeLabel} ET`;
  return (
    <a
      data-vault-plate={view.status}
      href={basescanTx(latest.txHash)}
      title={`${label}: ${verdictText(latest)} · ${intentText(latest)} · ${when}`}
      className={`${frame} hover:border-line-strong`}
    >
      {chip}{" "}
      <span className="min-w-0 sm:truncate">
        {label}: <span className="font-medium text-ink">{verdictText(latest)}</span> · {intentText(latest)} · {when}
        <span aria-hidden="true"> ↗</span>
      </span>
    </a>
  );
}

function Verdict({ row }: { row: VaultRow }) {
  return (
    <div
      data-verdict={row.allowed ? "allowed" : "refused"}
      data-reason={row.reason}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-[18px] py-4 text-white ${row.allowed ? "bg-accent" : "bg-ink"}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-[11px] opacity-80">VAULT DECISION</span>
        <span className="text-[26px] font-semibold tracking-[-0.03em]">{row.allowed ? "Allowed" : "Refused"}</span>
      </div>
      <div className="ml-auto flex flex-col gap-1.5 text-right">
        <ReasonTag code={row.reason} tone="verdict" layout="stacked" />
        {row.gasUsed === null ? null : <span className="font-mono text-[11px] opacity-80">gas {formatInt(Number(row.gasUsed))}</span>}
      </div>
    </div>
  );
}

function Plate({ view }: { view: VaultView }) {
  if (view.status === "live" && view.head !== null) {
    return <SourcePlate kind="live">{`live · read to block ${formatBlock(BigInt(view.head))}`}</SourcePlate>;
  }
  return <SourcePlate kind="edition">{view.status === "reading" ? "recorded · reading Base…" : "recorded · could not read Base"}</SourcePlate>;
}

function Footnote({ view }: { view: VaultView }) {
  const n = view.decisions.length;
  const decisions = `${formatInt(n)} ${n === 1 ? "Decision" : "Decisions"}`;
  if (view.status === "live") return <>{decisions} on Base mainnet, read from Base by your browser.</>;
  if (view.status === "reading") return <>{decisions} recorded in this build. Reading the vault on Base…</>;
  return (
    <>
      Could not read the vault on Base, so this shows the {decisions} recorded in this build.{" "}
      {view.retry ? (
        <button type="button" onClick={view.retry} className="cursor-pointer border-0 bg-transparent p-0 font-medium text-accent">
          Read again
        </button>
      ) : null}
    </>
  );
}

/**
 * The engine card's mainnet face: the vault's latest Decision in the replay's own grammar (the intent, then the verdict
 * window), the most recent Decisions each linked to Basescan, and the way to the full ledger.
 */
export function VaultCard() {
  const view = useVault();
  const now = useNowSec();
  const [latest] = view.decisions;
  return (
    <div
      data-vault-card={view.status}
      className="card overflow-hidden shadow-[0_1px_0_var(--color-line),0_30px_80px_-30px_color-mix(in_srgb,var(--color-ink)_28%,transparent)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-head px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold">MANDATEVAULT · BASE MAINNET</span>
          <Plate view={view} />
        </div>
        <a href="/ledger" className="text-[13px] font-medium">
          Open the ledger
          <span aria-hidden="true"> →</span>
        </a>
      </div>

      {latest === undefined ? (
        <p className="m-0 px-5 py-6 text-[15px] text-ink-2">The vault has made no Decision yet.</p>
      ) : (
        <>
          <div className="flex min-w-0 flex-col gap-1 px-5 pt-5">
            <span className="font-mono text-[11px] text-ink-2">{view.status === "live" ? "LATEST DECISION" : "LATEST RECORDED DECISION"}</span>
            <span className="text-[30px] font-semibold tracking-[-0.035em]">{intentText(latest)}</span>
            <span className="font-mono text-xs text-ink-2">
              {latest.timeLabel} ET · block {formatInt(Number(latest.block))}
              {ageOf(view, latest, now) === null ? null : ` · ${ageOf(view, latest, now)}`}
            </span>
          </div>
          <div className="mx-3 mt-4">
            <Verdict row={latest} />
          </div>
          <ol aria-label="Recent decisions" className="m-0 list-none px-3 pb-1 pt-3">
            {view.decisions.slice(0, LISTED).map((r) => (
              <li
                key={r.key}
                data-decision={r.allowed ? "allowed" : "refused"}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[10px] px-2.5 py-2"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{intentText(r)}</span>
                  <span className="font-mono text-xs text-ink-2">{r.timeLabel} ET</span>
                </span>
                <span className="flex flex-col items-end gap-1 text-right">
                  <ReasonTag code={r.reason} tone="neutral" layout="inline" className="justify-end text-[13px]" />
                  <a href={basescanTx(r.txHash)} aria-label={`${shortHash(r.txHash)} on Basescan`} className="font-mono text-[11px] font-medium">
                    {shortHash(r.txHash)}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="m-0 border-t border-line-soft px-5 py-3 text-[13px] leading-relaxed text-ink-2">
        <Footnote view={view} />
      </p>
    </div>
  );
}
