import { ChartFrame } from "./ChartFrame";

type Standing = "below the floor" | "between the floor and the target" | "above the target";

function standing(hf: number, min: number, target: number): Standing {
  if (hf < min) return "below the floor";
  return hf < target ? "between the floor and the target" : "above the target";
}

/**
 * The credit position's health factor on a meter from 1.0, with the mandate's floor (below it the vault refuses new
 * borrowing and the agent must de-risk) and its target.
 */
export function HealthFactorChart({
  hf,
  min,
  target,
  emptyText = "No debt, so no health factor to watch.",
}: {
  hf: number | null;
  min: number;
  target: number;
  /** What to say when `hf` is null: no debt by default; the page says so when the read failed instead. */
  emptyText?: string;
}) {
  const lo = 1;
  const hi = hf === null ? target * 1.5 : Math.max(target * 1.5, Math.min(hf * 1.1, target * 3));
  const at = (v: number) => `${Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * 100}%`;
  const s = hf === null ? null : standing(hf, min, target);
  const low = s === "below the floor";

  return (
    <ChartFrame
      title="Health factor"
      note="From the credit adapter. Collateral value against debt; Aave liquidates below 1.0."
      isEmpty={hf === null}
      emptyText={emptyText}
    >
      {hf !== null && s !== null ? (
        <>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-3xl font-semibold text-ink">{hf.toFixed(2)}</span>
            <span className={`inline-flex items-center gap-1.5 text-sm ${low ? "text-refuse" : "text-ink-2"}`}>
              {low ? (
                <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full bg-refuse text-[10px] font-bold text-bg">
                  !
                </span>
              ) : null}
              <span>{s}</span>
            </span>
          </p>
          <div role="img" aria-label={`Health factor ${hf.toFixed(2)}: floor ${min.toFixed(2)}, target ${target.toFixed(2)}, ${s}`} className="mt-4">
            <div aria-hidden="true" className="relative pt-5 pb-5">
              <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-ink-2" style={{ left: at(target) }}>
                target {target.toFixed(2)}
              </span>
              <div className="relative h-2 rounded-full bg-line-soft">
                <span className={`absolute inset-y-0 left-0 rounded-full ${low ? "bg-refuse" : "bg-accent"}`} style={{ width: at(hf) }} />
                <span data-mark="min" className="absolute -top-1.5 -bottom-1.5 w-0.5 -translate-x-1/2 bg-ink-2" style={{ left: at(min) }} />
                <span data-mark="target" className="absolute -top-1.5 -bottom-1.5 w-0.5 -translate-x-1/2 bg-ink" style={{ left: at(target) }} />
                <span
                  data-mark="hf"
                  className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-bg ${low ? "bg-refuse" : "bg-accent"}`}
                  style={{ left: at(hf) }}
                />
              </div>
              <span className="absolute bottom-0 -translate-x-1/2 whitespace-nowrap font-mono text-[10px] text-ink-2" style={{ left: at(min) }}>
                floor {min.toFixed(2)}
              </span>
              <span className="absolute bottom-0 left-0 font-mono text-[10px] text-ink-2">1.0</span>
            </div>
          </div>
        </>
      ) : null}
    </ChartFrame>
  );
}
