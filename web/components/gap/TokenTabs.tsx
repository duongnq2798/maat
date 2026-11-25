"use client";

import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";

interface Props {
  /** The window's id, so the ids of two windows' tabs never collide. */
  windowId: string;
  /** The tablist's accessible name: "Tokens, window closing Fri 13 Nov 16:00 ET". */
  label: string;
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

const ROW = "flex flex-wrap gap-2";
const PILL = "inline-flex min-h-9 items-center rounded-full border px-3.5 font-mono text-[13px] font-medium";
const pill = (on: boolean) => `${PILL} ${on ? "border-ink bg-ink text-bg" : "border-line-strong bg-bg text-ink"}`;

/**
 * One panel at a time behind pill tabs, in one tree before and after hydration, so no panel remounts.
 *
 * Before hydration the first slot is an inert preview of the pill row and every panel is in the HTML, without `hidden`;
 * globals.css shows only the first one, so the page does not move when the tablist takes the preview's place. Without
 * JavaScript, the page's noscript style hides the preview and shows every panel, one after another.
 */
export function TokenTabs({ windowId, label, tabs, panels }: Props) {
  const [mounted, setMounted] = useState(false);
  const [selected, setSelected] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => setMounted(true), []);

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
    <div data-token-tabs={mounted ? "tabs" : "all"} className="flex flex-col gap-4">
      {mounted ? (
        <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={ROW}>
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
                className={`${pill(on)} cursor-pointer tick-colour ${on ? "" : "hover:border-ink"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div data-tabs-preview aria-hidden="true" className={ROW}>
          {tabs.map((t, i) => (
            <span key={t.id} className={pill(i === 0)}>
              {t.label}
            </span>
          ))}
        </div>
      )}
      {panels.map((panel, i) => {
        const t = tabs[i]!;
        const tab = mounted
          ? { role: "tabpanel", id: panelId(t.id), "aria-labelledby": tabId(t.id), hidden: i !== selected, tabIndex: 0 }
          : {};
        return (
          <div key={t.id} data-panel {...tab} className="rounded-[20px] outline-offset-4">
            {panel}
          </div>
        );
      })}
    </div>
  );
}
