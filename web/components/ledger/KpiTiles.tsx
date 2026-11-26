import { formatInt } from "@/content/format";
import { formatUsd6, type Summary } from "@/lib/chain/ledger";
import type { Treasury } from "@/lib/chain/treasury";

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-bg px-5 py-4">
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="text-2xl font-semibold text-ink">{value}</dd>
      {sub ? <dd className="text-xs text-ink-2">{sub}</dd> : null}
    </div>
  );
}

/** Headline numbers: decisions from the events, equity from the treasury read, flows from the events. */
export function KpiTiles({ summary, treasury }: { summary: Summary; treasury: Treasury | null }) {
  const equity = treasury?.equityUsd6;
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3">
      <Tile
        label="Decisions"
        value={formatInt(summary.allowed + summary.refused)}
        sub={`${formatInt(summary.allowed)} allowed · ${formatInt(summary.refused)} refused`}
      />
      <Tile label="Net equity" value={equity?.ok ? formatUsd6(equity.value) : "unavailable"} sub="USDC + stocks held and supplied − debt" />
      <Tile label="Revenue received" value={formatUsd6(summary.revenueUsd6)} sub="RevenueReceived events" />
      <Tile label="Expenses paid" value={formatUsd6(summary.expensesUsd6)} sub="allowed PAY_EXPENSE decisions" />
    </dl>
  );
}
