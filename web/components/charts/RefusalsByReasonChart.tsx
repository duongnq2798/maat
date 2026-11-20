import { formatInt } from "@/content/format";
import type { RefusalCode } from "@/content/reasons";
import { reasonDisplay } from "@/lib/chain/reason";
import { ChartFrame } from "./ChartFrame";

/**
 * Refusals by reason as horizontal bars, most frequent first. Each bar is a toggle that filters the timeline; its
 * label and count are text, so the bars need no separate table.
 */
export function RefusalsByReasonChart({
  reasons,
  selected,
  onSelect,
}: {
  reasons: readonly { code: RefusalCode; count: number }[];
  selected: RefusalCode | null;
  onSelect: (code: RefusalCode | null) => void;
}) {
  const total = reasons.reduce((n, r) => n + r.count, 0);
  const max = Math.max(1, ...reasons.map((r) => r.count));
  const plural = (n: number, one: string) => `${formatInt(n)} ${one}${n === 1 ? "" : "s"}`;

  return (
    <ChartFrame
      title="Refusals by reason"
      note="The reason code each refusal carries onchain. Select one to filter the timeline."
      isEmpty={reasons.length === 0}
      emptyText="No refusals yet."
    >
      <div role="group" aria-label={`Refusals by reason: ${plural(reasons.length, "reason")}, ${plural(total, "refusal")}`} className="flex flex-col gap-0.5">
        {reasons.map((r) => {
          const d = reasonDisplay(r.code);
          const on = selected === r.code;
          return (
            <button
              key={r.code}
              type="button"
              aria-pressed={on}
              title={d.meaning}
              onClick={() => onSelect(on ? null : r.code)}
              className={`grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_2.5rem] items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                on ? "bg-refuse-tint" : ""
              } ${selected && !on ? "opacity-50" : ""}`}
            >
              <span className="font-mono text-xs text-ink [overflow-wrap:anywhere]">
                {d.label}
                {d.label !== d.code ? <span className="ml-1.5 text-ink-3">{d.code}</span> : null}
              </span>
              <span className="relative h-3" aria-hidden="true">
                <span data-mark="refusal" className="absolute inset-y-0 left-0 rounded-r-[4px] bg-refuse" style={{ width: `${(r.count / max) * 100}%` }} />
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-ink">{formatInt(r.count)}</span>
            </button>
          );
        })}
      </div>
    </ChartFrame>
  );
}
