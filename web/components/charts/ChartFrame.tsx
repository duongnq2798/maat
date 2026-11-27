import type { ReactNode } from "react";

export interface ChartTable {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

/**
 * A ledger chart's card: title, an optional note, then either the empty sentence or the chart, its key and a table
 * view (every value the marks show, reachable without hovering).
 */
export function ChartFrame({
  title,
  note,
  isEmpty,
  emptyText,
  legend,
  table,
  children,
}: {
  title: string;
  note?: ReactNode;
  isEmpty: boolean;
  emptyText: string;
  legend?: ReactNode;
  table?: ChartTable;
  children?: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col rounded-xl border border-line bg-bg p-5">
      <figcaption>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {note ? <p className="mt-1 text-xs text-ink-2">{note}</p> : null}
      </figcaption>
      {isEmpty ? (
        <p className="mt-6 text-sm text-ink-2">{emptyText}</p>
      ) : (
        <>
          {legend ? <div className="mt-3">{legend}</div> : null}
          <div className="mt-4">{children}</div>
          {table ? (
            <details className="mt-4 text-xs">
              <summary className="tap cursor-pointer text-ink-2 hover:text-ink">Show as table</summary>
              <table className="mt-2 w-full border-collapse font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-line text-left text-ink-2">
                    {table.columns.map((c, i) => (
                      <th key={c} scope="col" className={`py-1 font-normal ${i > 0 ? "text-right" : ""}`}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r[0]} className="border-b border-line-soft text-ink">
                      {r.map((cell, i) =>
                        i === 0 ? (
                          <th key={i} scope="row" className="py-1 text-left font-normal">
                            {cell}
                          </th>
                        ) : (
                          <td key={i} className="py-1 text-right">
                            {cell}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </>
      )}
    </figure>
  );
}

/** A chart key: a swatch shaped like the mark, then its name in text ink. */
export function Legend({ items }: { items: readonly { label: string; swatch: ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="flex h-3 w-3 items-center justify-center">
            {it.swatch}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Clean axis ticks from 0 to at least `max`: steps of 1, 2 or 5 × 10^n, at most five ticks. */
export function countTicks(max: number): number[] {
  const top = Math.max(1, max);
  const steps = [1, 2, 5].flatMap((m) => [1, 10, 100, 1000, 10_000].map((p) => m * p)).sort((a, b) => a - b);
  const step = steps.find((s) => Math.ceil(top / s) <= 4) ?? steps.at(-1)!;
  const end = Math.ceil(top / step) * step;
  return Array.from({ length: end / step + 1 }, (_, i) => i * step);
}
