"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

interface Props {
  /** The window's id, so the ids of two windows' tabs never collide. */
  windowId: string;
  tabs: readonly { id: string; label: string }[];
  /** One panel per tab, in the same order; each carries its own heading. */
  panels: readonly ReactNode[];
}

/** The keys of the WAI-ARIA tabs pattern, with automatic activation: moving selects. */
const MOVES: Readonly<Record<string, (at: number, count: number) => number>> = {
  ArrowRight: (at, n) => (at + 1) % n,
  ArrowLeft: (at, n) => (at - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/**
 * One panel at a time behind pill tabs. Before hydration, and without JavaScript, every panel shows, one after
 * another, so a reader without scripts still gets every chart and every figure.
 */
export function TokenTabs({ windowId, tabs, panels }: Props) {
  const [mounted, setMounted] = useState(false);
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div data-token-tabs="all" className="flex flex-col gap-6">
        {panels.map((panel, i) => (
          <div key={tabs[i]?.id ?? i}>{panel}</div>
        ))}
      </div>
    );
  }

  const tabId = (id: string) => `gap-tab-${windowId}-${id}`;
  const panelId = (id: string) => `gap-panel-${windowId}-${id}`;
  const select = (i: number) => {
    setSelected(i);
    buttons.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[e.key];
    if (!move) return;
    e.preventDefault();
    select(move(selected, tabs.length));
  };

  return (
    <div data-token-tabs="tabs" className="flex flex-col gap-4">
      <div role="tablist" aria-label={`Tokens in the window of ${windowId}`} onKeyDown={onKeyDown} className="flex flex-wrap gap-2">
        {tabs.map((t, i) => {
          const on = i === selected;
          return (
            <button
              key={t.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={tabId(t.id)}
              aria-selected={on}
              aria-controls={panelId(t.id)}
              tabIndex={on ? 0 : -1}
              onClick={() => select(i)}
              className={`inline-flex min-h-9 cursor-pointer items-center rounded-full border px-3.5 font-mono text-[13px] font-medium transition-colors ${
                on ? "border-ink bg-ink text-bg" : "border-line-strong bg-bg text-ink hover:border-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {panels.map((panel, i) => {
        const t = tabs[i]!;
        return (
          <div
            key={t.id}
            role="tabpanel"
            id={panelId(t.id)}
            aria-labelledby={tabId(t.id)}
            hidden={i !== selected}
            tabIndex={0}
            className="rounded-[20px] outline-offset-4"
          >
            {panel}
          </div>
        );
      })}
    </div>
  );
}
