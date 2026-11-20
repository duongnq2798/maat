import { ChartFrame, Legend } from "./ChartFrame";

export interface WeightRow {
  symbol: string;
  /** Share of net equity in basis points, or null when a read it depends on failed. */
  weightBps: number | null;
  /** The token's onchain cap in basis points, or null when unknown. */
  maxWeightBps: number | null;
}

const pctLabel = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/** Each stock's weight of net equity against the mandate's target weight and the token's onchain cap. */
export function WeightsChart({ holdings, targetPct }: { holdings: readonly WeightRow[]; targetPct: number }) {
  const largest = Math.max(targetPct, ...holdings.flatMap((h) => [h.weightBps, h.maxWeightBps].filter((v): v is number => v !== null).map((v) => v / 100)));
  const end = Math.min(100, Math.ceil((largest * 1.15) / 10) * 10);
  const step = end <= 50 ? 10 : 25;
  const ticks = Array.from({ length: Math.floor(end / step) + 1 }, (_, i) => i * step);
  const at = (pct: number) => `${(Math.min(pct, end) / end) * 100}%`;
  const targetAt = (Math.min(targetPct, end) / end) * 100;
  const label = holdings.map((h) => `${h.symbol} ${h.weightBps === null ? "unavailable" : pctLabel(h.weightBps)}`).join(", ");

  return (
    <ChartFrame
      title="Holdings against the target"
      note="Stock value (held and supplied) as a share of net equity, the measure the vault checks before a buy."
      isEmpty={holdings.length === 0}
      emptyText="The vault lists no stock yet."
      legend={
        <Legend
          items={[
            { label: "Weight", swatch: <span className="h-2 w-3 rounded-r-[3px] bg-accent" /> },
            { label: `Target ${targetPct}%`, swatch: <span className="h-3 w-0.5 bg-ink" /> },
            { label: "Onchain cap", swatch: <span className="h-3 w-0.5 bg-ink-3" /> },
          ]}
        />
      }
      table={{
        columns: ["Token", "Weight", "Cap"],
        rows: holdings.map((h) => [h.symbol, h.weightBps === null ? "unavailable" : pctLabel(h.weightBps), h.maxWeightBps === null ? "—" : pctLabel(h.maxWeightBps)]),
      }}
    >
      <div role="img" aria-label={`Weight of net equity: ${label}; target ${targetPct}%`}>
        <div aria-hidden="true" className="grid grid-cols-[3.5rem_minmax(0,1fr)_3rem] gap-x-3">
          <span />
          <div className="relative h-4 font-mono text-[10px] text-ink-2">
            <span className={`absolute whitespace-nowrap ${targetAt > 70 ? "-translate-x-full" : targetAt > 15 ? "-translate-x-1/2" : ""}`} style={{ left: `${targetAt}%` }}>
              target {targetPct}%
            </span>
          </div>
          <span />
          {holdings.map((h) => (
            <div key={h.symbol} className="contents">
              <span className="py-2 font-mono text-xs text-ink">{h.symbol}</span>
              <div className="relative">
                {ticks.map((t) => (
                  <span key={t} className="absolute inset-y-0 w-px bg-grid" style={{ left: at(t) }} />
                ))}
                {h.weightBps === null ? (
                  <span className="absolute inset-y-0 left-1 flex items-center text-xs text-ink-3">unavailable</span>
                ) : h.weightBps > 0 ? (
                  <span data-mark="weight" className="absolute left-0 top-1/2 h-3 -translate-y-1/2 rounded-r-[4px] bg-accent" style={{ width: at(h.weightBps / 100) }} />
                ) : null}
                {h.maxWeightBps !== null ? (
                  <span data-mark="cap" className="absolute top-1 bottom-1 w-0.5 -translate-x-1/2 bg-ink-3" style={{ left: at(h.maxWeightBps / 100) }} />
                ) : null}
                <span data-mark="target" className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-ink" style={{ left: `${targetAt}%` }} />
              </div>
              <span className="py-2 text-right font-mono text-xs tabular-nums text-ink">{h.weightBps === null ? "—" : pctLabel(h.weightBps)}</span>
            </div>
          ))}
          <span />
          <div className="relative mt-1 h-3 font-mono text-[10px] tabular-nums text-ink-3">
            {ticks.map((t, i) => (
              <span
                key={t}
                className={`absolute ${i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: at(t) }}
              >
                {t}%
              </span>
            ))}
          </div>
          <span />
        </div>
      </div>
    </ChartFrame>
  );
}
