"use client";

import { SourcePlate } from "@/components/instrument/SourcePlate";
import { ReasonTag, type ReasonTagTone } from "@/components/ui/ReasonTag";
import { tickerGloss } from "@/content/b20-nav";
import { billLine } from "@/content/bill";
import { formatInt } from "@/content/format";
import { basescanDecision } from "@/lib/live/basescan";
import { formatAge, formatBlock } from "@/lib/live/format";
import { useNowSec, useVault, type VaultView } from "./VaultDecisions";
import { intentText, type PlateKind, plateOf, type VaultRow } from "./vault-rows";

/** How many Decisions the card lists; /ledger lists them all. */
const LISTED = 3;

/** "2 h 5 min ago" for a live row once the visitor's clock is known; null otherwise. */
function ageOf(view: VaultView, row: VaultRow, now: number | null): string | null {
  if (view.status !== "live" || now === null || row.timestamp === null) return null;
  return `${formatAge(now - row.timestamp)} ago`;
}

/** "block 61,745,836". */
const blockText = (row: VaultRow) => `block ${formatInt(Number(row.block))}`;

/** "Tue 24 Nov 11:59 ET", or the row's block when its time was not read (the loader then labels it "block N"). */
function whenText(row: VaultRow): string {
  return row.timestamp === null ? blockText(row) : `${row.timeLabel} ET`;
}

/** "0x6162…23c8". */
const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

/**
 * What "probe" means where the card first shows it (cold read of 2026-11-28, gap 2). A Decision is labelled "probe" by
 * /ledger's senderLabel (lib/chain/ledger.ts) when its maat:v1 blob has k "probe": one of the owner's MAAT_PROBES
 * instants, sized at agent/src/probes.ts PROBE_USD = 1 (a $1 BUY, or a $1 SELL of a holding), whose text starts "PROBE
 * v1, not a Claude proposal" (PROBE_TEXT_PREFIX). It says "test trade", not "check": the vault's nine rules are its
 * checks, and a "$1 check" reads as a payment (review of PR #120). The label itself stays "probe", since /ledger and
 * /proof count by it.
 */
export const PROBE_GLOSS = "A probe is a $1 test trade the owner scheduled, not a Claude proposal.";

/**
 * Where the card glosses "probe": under the latest Decision when that is a probe, under the list when only an older
 * listed row is, nowhere when none is.
 */
export function probeGlossAt(listed: readonly Pick<VaultRow, "sender">[]): "latest" | "list" | null {
  if (listed[0]?.sender === "probe") return "latest";
  return listed.some((r) => r.sender === "probe") ? "list" : null;
}

/** "Compute bill paid · $1.00 · to the owner's allowlisted address" for a paid bill; null for any other Decision. */
function paidBill(row: VaultRow): string | null {
  return plateOf(row) === "bill" && row.bill !== null ? billLine(row.bill) : null;
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
 * The engine card's verdict plate, by kind (culture plan Q5; test/vault-bill.test.ts holds each text to its contrast).
 * Refused is the loud one, white on solid ink. Allowed is a quiet accent tint, and a paid bill a neutral plate, so
 * neither outshouts a refusal and a bill never reads as a trade or as Allowed.
 */
export const VERDICT_PLATE: Readonly<Record<PlateKind, { box: string; label: string; word: string; tag: ReasonTagTone }>> = {
  refused: { box: "bg-ink text-white", label: "opacity-80", word: "text-white", tag: "verdict" },
  allowed: { box: "border border-accent-soft bg-accent-tint text-ink", label: "text-label", word: "text-accent", tag: "neutral" },
  bill: { box: "border border-line bg-surface-soft text-ink", label: "text-label", word: "text-ink", tag: "neutral" },
};

/** The plate's word: the vault's verdict, or "Paid" for a bill it paid. */
const WORD: Readonly<Record<PlateKind, string>> = { refused: "Refused", allowed: "Allowed", bill: "Paid" };

function Verdict({ row }: { row: VaultRow }) {
  const kind = plateOf(row);
  const p = VERDICT_PLATE[kind];
  return (
    <div
      data-verdict={kind}
      data-reason={row.reason}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-[18px] py-4 ${p.box}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className={`font-mono text-[11px] ${p.label}`}>VAULT DECISION</span>
        <span className={`text-[26px] font-semibold tracking-[-0.03em] ${p.word}`}>{WORD[kind]}</span>
      </div>
      <div className="ml-auto flex flex-col gap-1.5 text-right">
        <ReasonTag code={row.reason} tone={p.tag} layout="stacked" />
        {row.gasUsed === null ? null : <span className={`font-mono text-[11px] ${p.label}`}>gas {formatInt(Number(row.gasUsed))}</span>}
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
 * window), the most recent Decisions each linked to Basescan, what a probe is when one is listed (PROBE_GLOSS), and the
 * way to the full ledger.
 */
export function VaultCard() {
  const view = useVault();
  const now = useNowSec();
  const [latest] = view.decisions;
  const age = latest === undefined ? null : ageOf(view, latest, now);
  const latestBill = latest === undefined ? null : paidBill(latest);
  const latestGloss = latest === undefined || latest.bill !== null ? null : tickerGloss(latest.symbol);
  const listed = view.decisions.slice(0, LISTED);
  const probeAt = probeGlossAt(listed);
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
        <a href="/ledger" className="tap text-[13px] font-medium">
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
            {/* Below the plate's 26 px word, so the verdict is the card's largest text; a bill's line smaller still, never a trade's. */}
            {latestBill === null ? (
              <>
                <span data-latest-line="" className="text-[24px] font-semibold tracking-[-0.03em]">
                  {intentText(latest)}
                </span>
                {/* The first ticker on the page, named (spec 2026-11-27 section 4). */}
                {latestGloss === null ? null : (
                  <span data-ticker-gloss="" className="text-[13px] text-ink-2">
                    {latestGloss}
                  </span>
                )}
              </>
            ) : (
              <span data-latest-line="" className="text-[19px] font-semibold leading-[1.3] tracking-[-0.02em]">
                {latestBill}
              </span>
            )}
            <span data-latest-when="" className="font-mono text-xs text-ink-2">
              {latest.timestamp === null ? blockText(latest) : `${whenText(latest)} · ${blockText(latest)}`}
              {age === null ? null : ` · ${age}`}
              {latest.sender === null ? null : ` · ${latest.sender}`}
            </span>
            {probeAt === "latest" ? (
              <span data-probe-gloss="" className="text-[13px] text-ink-2">
                {PROBE_GLOSS}
              </span>
            ) : null}
          </div>
          <div className="mx-3 mt-4">
            <Verdict row={latest} />
          </div>
          <ol aria-label="Recent decisions" className="m-0 list-none px-3 pb-1 pt-3">
            {listed.map((r) => (
              <li
                key={r.key}
                data-decision={plateOf(r)}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[10px] px-2.5 py-2"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{paidBill(r) ?? intentText(r)}</span>
                  <span className="font-mono text-xs text-ink-2">
                    {whenText(r)}
                    {r.sender === null ? null : <span data-sender="">{` · ${r.sender}`}</span>}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 text-right">
                  <ReasonTag code={r.reason} tone="neutral" layout="inline" className="justify-end text-[13px]" />
                  <a href={basescanDecision(r.txHash)} aria-label={`${shortHash(r.txHash)} on Basescan`} className="tap font-mono text-[11px] font-medium">
                    {shortHash(r.txHash)}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </span>
              </li>
            ))}
          </ol>
          {probeAt === "list" ? (
            <p data-probe-gloss="" className="m-0 px-5 pb-3 text-[13px] leading-normal text-ink-2">
              {PROBE_GLOSS}
            </p>
          ) : null}
        </>
      )}
      <p className="m-0 border-t border-line-soft px-5 py-3 text-[13px] leading-relaxed text-ink-2">
        <Footnote view={view} />
      </p>
    </div>
  );
}
