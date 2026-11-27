"use client";

import { type KeyboardEvent, useRef, useState } from "react";
import { DecisionEngine } from "@/components/DecisionEngine";
import { VaultCard } from "./Vault";

/**
 * The engine card's two faces: the mainnet vault first, then the scripted fork run, named for when it ran and what it was
 * (spec 2026-11-27, landing "explain in 10 seconds", section 3): before mainnet, a fork test.
 */
const TABS = [
  { id: "mainnet", label: "Base mainnet" },
  { id: "fork", label: "Before mainnet (fork test)" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * The hero's right column: a tab row over the engine card. It opens on the mainnet vault; the fork run is one tab away.
 * Both panels are in the HTML, the inactive one hidden, so a reader without JavaScript still gets the mainnet face and
 * the replay's default moment stays in the export. Arrow keys, Home and End move between the tabs.
 */
export function HeroCard() {
  const [tab, setTab] = useState<TabId>("mainnet");
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const last = TABS.length - 1;
    const next =
      e.key === "ArrowRight" ? (at + 1) % TABS.length : e.key === "ArrowLeft" ? (at + last) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next]!.id);
    buttons.current[next]?.focus();
  };

  return (
    <div data-hero-card="" className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label="Decision engine" onKeyDown={onKeyDown} className="flex self-start rounded-full bg-line-soft p-[3px]">
        {TABS.map((t, i) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              ref={(el) => {
                buttons.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`engine-tab-${t.id}`}
              aria-selected={on}
              aria-controls={`engine-panel-${t.id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(t.id)}
              className={`min-h-9 cursor-pointer rounded-full border-0 px-3.5 py-2 text-xs font-medium ${
                on
                  ? "bg-white text-ink shadow-[0_1px_2px_color-mix(in_srgb,var(--color-ink)_12%,transparent)]"
                  : "bg-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {TABS.map((t) => (
        <div key={t.id} role="tabpanel" id={`engine-panel-${t.id}`} aria-labelledby={`engine-tab-${t.id}`} hidden={tab !== t.id}>
          {t.id === "mainnet" ? <VaultCard /> : <DecisionEngine />}
        </div>
      ))}
    </div>
  );
}
