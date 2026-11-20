import { formatInt } from "@/content/format";
import { ChartFrame, countTicks, Legend } from "./ChartFrame";

export interface DayCount {
  day: string;
  /** "Thu 26 Nov". */
  label: string;
  allowed: number;
  refused: number;
}

const plural = (n: number, one: string) => `${formatInt(n)} ${one}${n === 1 ? "" : "s"}`;
/** "26 Nov" from "Thu 26 Nov". */
const shortDay = (label: string) => label.replace(/^\S+\s/, "");

/** Stacked columns, one per New York day: allowed decisions at the baseline, refused ones above. */
export function DecisionsPerDayChart({ days }: { days: readonly DayCount[] }) {
  const allowed = days.reduce((n, d) => n + d.allowed, 0);
  const refused = days.reduce((n, d) => n + d.refused, 0);
  const ticks = countTicks(Math.max(0, ...days.map((d) => d.allowed + d.refused)));
  const top = ticks.at(-1)!;
  const pct = (n: number) => `${(n / top) * 100}%`;
  // Label at most five days, counting back from the newest so today always has its label.
  const every = Math.max(1, Math.ceil(days.length / 5));
  const labeled = (i: number) => (days.length - 1 - i) % every === 0;

  return (
    <ChartFrame
      title="Decisions per day"
      note="New York days, from the block time of each Decision event."
      isEmpty={days.length === 0}
      emptyText="No decisions yet."
      legend={
        <Legend
          items={[
            { label: "Allowed", swatch: <span className="h-3 w-3 rounded-[3px] bg-accent" /> },
            { label: "Refused", swatch: <span className="h-3 w-3 rounded-[3px] bg-refuse" /> },
          ]}
        />
      }
      table={{ columns: ["Day", "Allowed", "Refused"], rows: days.map((d) => [d.label, formatInt(d.allowed), formatInt(d.refused)]) }}
    >
      <div role="img" aria-label={`Decisions per day: ${plural(days.length, "day")}, ${formatInt(allowed)} allowed, ${formatInt(refused)} refused`}>
        <div className="flex gap-2" aria-hidden="true">
          <div className="relative h-40 w-6 shrink-0 font-mono text-[10px] tabular-nums text-ink-3">
            {ticks.map((t) => (
              <span key={t} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: pct(t) }}>
                {formatInt(t)}
              </span>
            ))}
          </div>
          <div className="relative h-40 min-w-0 flex-1">
            {ticks.map((t) => (
              <span key={t} className="absolute inset-x-0 h-px bg-grid" style={{ bottom: pct(t) }} />
            ))}
            <div className="absolute inset-0 flex">
              {days.map((d, i) => (
                <div key={d.day} className="group relative flex flex-1 flex-col items-center justify-end hover:bg-surface-soft">
                  {d.refused > 0 ? (
                    <span
                      data-mark="refused"
                      className="w-3/5 max-w-6 rounded-t-[4px] bg-refuse group-hover:opacity-80"
                      style={{ height: pct(d.refused) }}
                    />
                  ) : null}
                  {d.refused > 0 && d.allowed > 0 ? <span className="h-0.5 w-3/5 max-w-6 shrink-0 bg-bg" /> : null}
                  {d.allowed > 0 ? (
                    <span
                      data-mark="allowed"
                      className={`w-3/5 max-w-6 bg-accent group-hover:opacity-80 ${d.refused > 0 ? "" : "rounded-t-[4px]"}`}
                      style={{ height: pct(d.allowed) }}
                    />
                  ) : null}
                  <span
                    className={`pointer-events-none absolute top-0 z-10 hidden whitespace-nowrap rounded-md border border-line bg-bg px-2 py-1 text-xs shadow-sm group-hover:block ${
                      i === 0 ? "left-0" : i === days.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"
                    }`}
                  >
                    <span className="block text-ink-2">{d.label}</span>
                    <span className="block text-ink">
                      <strong className="font-semibold">{formatInt(d.allowed)}</strong> allowed ·{" "}
                      <strong className="font-semibold">{formatInt(d.refused)}</strong> refused
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="ml-8 mt-1 flex font-mono text-[10px] text-ink-3" aria-hidden="true">
          {days.map((d, i) => (
            <span key={d.day} className="flex-1 whitespace-nowrap text-center">
              {labeled(i) ? shortDay(d.label) : ""}
            </span>
          ))}
        </div>
      </div>
    </ChartFrame>
  );
}
