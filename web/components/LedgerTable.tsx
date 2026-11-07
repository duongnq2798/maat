"use client";

import { type ReactNode, useState } from "react";
import { decisionLabel, type DecisionRow, gasLabel, intentLabel } from "@/content/decisions";
import { formatInt } from "@/content/format";

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

      <div role="region" aria-label="Decision ledger" tabIndex={0} data-scroll-x className="card overflow-x-auto">
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
                  <td className="px-2 text-base font-medium">{intentLabel(r)}</td>
                  <td className="px-2">
                    <span
                      className={`inline-block rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold ${
                        r.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"
                      }`}
                    >
                      {decisionLabel(r)}
                    </span>
                  </td>
                  <td className="px-2 text-sm leading-normal text-ink-2">{r.note}</td>
                  <td className="py-[18px] pl-2 pr-6 font-mono text-[13px]">{gasLabel(r)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {fork ? (
        <p className="m-0 font-mono text-xs text-ink-2">
          Recorded by the agent loop on a fork of Base mainnet at block {formatInt(fork.block)}, against the real B20
          tokens, Aerodrome pools and the Aave V4 Equities Hub. Mainnet rows will link to Basescan.
        </p>
      ) : null}
    </>
  );
}
