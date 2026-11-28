"use client";

import { type ReactNode, useState } from "react";
import { decisionLabel, type DecisionRow, gasLabel, intentLabel } from "@/content/decisions";
import { formatInt } from "@/content/format";
import { REASON_MEANING } from "@/content/reasons";

type Filter = "all" | "allowed" | "refused";

const FILTERS: readonly { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "allowed", label: "Allowed" },
  { id: "refused", label: "Refused" },
];

const EMPTY: Record<Filter, string> = {
  all: "No decisions yet.",
  allowed: "No allowed decisions yet.",
  refused: "No refused decisions yet.",
};

function rowKey(r: DecisionRow): string {
  return r.txHash ?? `${r.timeLabel}|${intentLabel(r)}`;
}

/**
 * The row's own note. Rows read from mainnet may carry none; then a refused row shows what its code means and an
 * allowed row shows nothing. The vault sets allowed only with OK, so a refused row's reason is a refusal code; the
 * `!== "OK"` test says so to the compiler, which narrows the reason to RefusalCode, the key type of REASON_MEANING.
 */
function noteOf(r: DecisionRow): string | undefined {
  if (r.note !== undefined) return r.note;
  return !r.allowed && r.reason !== "OK" ? REASON_MEANING[r.reason] : undefined;
}

export function LedgerTable({ rows, heading }: { rows: readonly DecisionRow[]; heading: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const shown = rows.filter((r) => filter === "all" || r.allowed === (filter === "allowed"));
  const fork = rows.find((r) => r.source === "base-fork");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        {heading}
        <div role="group" aria-label="Filter decisions" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(f.id)}
                className={`min-h-11 cursor-pointer rounded-full border px-[18px] py-2.5 text-sm font-medium ${
                  on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink hover:border-ink"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* From 640 px, the table. Below it a table of 820 px would hide its DECISION column off the screen, so a phone
          reads one card per decision instead, its verdict whole on screen (spec 2026-11-27, landing "explain in 10
          seconds", section 4). */}
      <div role="region" aria-label="Decision ledger" tabIndex={0} data-scroll-x className="card scroll-x-cue hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[150px]" />
            <col className="w-[22%]" />
            <col className="w-[25%]" />
            <col />
            <col className="w-[130px]" />
          </colgroup>
          <thead className="bg-surface-head font-mono text-[11px] tracking-[0.06em] text-ink-2">
            <tr className="border-b border-line">
              <th scope="col" className="py-3.5 pl-6 pr-2 font-normal">TIME (ET)</th>
              <th scope="col" className="px-2 py-3.5 font-normal">INTENT</th>
              <th scope="col" className="px-2 py-3.5 font-normal">DECISION</th>
              <th scope="col" className="px-2 py-3.5 font-normal">NOTE</th>
              <th scope="col" className="py-3.5 pl-2 pr-6 font-normal">GAS USED</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-[18px] text-sm text-ink-2">
                  {EMPTY[filter]}
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr key={rowKey(r)} className="border-b border-line-soft">
                  <td className="py-[18px] pl-6 pr-2 font-mono text-[13px] text-ink-2">{r.timeLabel}</td>
                  <td className="px-2 py-[18px] text-base font-medium">{intentLabel(r)}</td>
                  <td className="px-2 py-[18px]">
                    {/* The code sits beside the badge, as a tag, and wraps under it when the column is narrow. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`inline-block rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                          r.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"
                        }`}
                      >
                        {decisionLabel(r)}
                      </span>
                      <code className="font-mono text-[11px] text-ink-2">{r.reason}</code>
                    </div>
                  </td>
                  <td className="px-2 py-[18px] text-sm leading-normal text-ink-2">{noteOf(r)}</td>
                  <td className="py-[18px] pl-2 pr-6 font-mono text-[13px]">{gasLabel(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ol data-ledger-cards="" aria-label="Decisions" className="m-0 flex list-none flex-col gap-3 p-0 sm:hidden">
        {shown.length === 0 ? (
          <li className="card px-5 py-4 text-sm text-ink-2">{EMPTY[filter]}</li>
        ) : (
          shown.map((r) => (
            <li key={rowKey(r)} data-allowed={r.allowed} className="card flex flex-col gap-2.5 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-base font-medium">{intentLabel(r)}</span>
                <span className="font-mono text-xs text-ink-2">{r.timeLabel} ET</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  data-card-verdict=""
                  className={`inline-block rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                    r.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"
                  }`}
                >
                  {decisionLabel(r)}
                </span>
                <code className="font-mono text-[11px] text-ink-2">{r.reason}</code>
              </div>
              {noteOf(r) ? <p className="m-0 text-sm leading-normal text-ink-2">{noteOf(r)}</p> : null}
              <span className="font-mono text-xs text-ink-2">gas used {gasLabel(r)}</span>
            </li>
          ))
        )}
      </ol>

      {fork ? (
        <p className="m-0 font-mono text-xs text-ink-2">
          Recorded by the agent loop on a fork of Base mainnet at block {formatInt(fork.block)}, against the real B20
          tokens, Aerodrome pools and the Aave V4 Equities Hub. The vault&apos;s mainnet decisions, each linked to Basescan,
          are in the mainnet ledger above.
        </p>
      ) : null}
    </>
  );
}
