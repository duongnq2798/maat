"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";

export type TrailTab = "decisions" | "rounds";

const TABS: readonly { id: TrailTab; label: string }[] = [
  { id: "decisions", label: "Decisions" },
  { id: "rounds", label: "Rounds" },
];

const pill = (on: boolean) =>
  `inline-flex min-h-11 cursor-pointer items-center rounded-full border px-[18px] text-sm font-medium ${
    on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink hover:border-ink"
  }`;

/**
 * The Decisions tab (the vault's Decision events with their agent trail) and the Rounds tab (the published journal).
 * Both panels stay mounted, so a filter set in one survives a visit to the other. Arrow keys, Home and End move
 * between the tabs, as the WAI-ARIA tabs pattern has it.
 */
export function TrailTabs({ tab, onTab, decisions, rounds }: { tab: TrailTab; onTab: (t: TrailTab) => void; decisions: ReactNode; rounds: ReactNode }) {
  const buttons = useRef<Partial<Record<TrailTab, HTMLButtonElement | null>>>({});
  const at = TABS.findIndex((t) => t.id === tab);
  const select = (i: number) => {
    const next = TABS[(i + TABS.length) % TABS.length]!.id;
    onTab(next);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    select(to);
  };
  const panels: Record<TrailTab, ReactNode> = { decisions, rounds };
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Decisions and rounds" onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              buttons.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`trail-tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls={`trail-panel-${t.id}`}
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => onTab(t.id)}
            className={pill(t.id === tab)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.id} role="tabpanel" id={`trail-panel-${t.id}`} aria-labelledby={`trail-tab-${t.id}`} hidden={t.id !== tab}>
          {panels[t.id]}
        </div>
      ))}
    </div>
  );
}
