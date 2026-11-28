"use client";

import { useEffect, useRef, useState } from "react";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { HIGHLIGHT_REASON, REASON_GROUPS, REASON_LABEL, REASON_MEANING } from "@/content/reasons";

/**
 * The highlighted refusal keeps its filled red highlight, on its label. ReasonTag renders the label as its first child
 * and the code as its last, so these child selectors fill the label only and leave the code a muted tag.
 */
const HOT_LABEL =
  "[&>:first-child]:rounded-md [&>:first-child]:bg-refuse [&>:first-child]:px-2 [&>:first-child]:py-[3px] [&>:first-child]:text-white";

/** The id of a group's full list, which the toggle controls. */
const listId = (i: number) => `reasons-codes-${i}`;

/**
 * The Refusals section's five groups (spec 2026-11-27, landing "explain in 10 seconds", section 3). By default each
 * group shows its title, its count and its refusals' plain labels, so a reader takes in all of them in one look; "Show
 * all 19" opens every group's codes, each with what it means. MARKET_CLOSED, the refusal the vault recorded, stays
 * filled in red either way. Both views are in the exported HTML, the closed one hidden, so the page holds every code
 * for search, and a reader without JavaScript still reads every group's labels.
 *
 * The toggle sits above the groups, so opening or closing them never moves it: the codes open under the reader's
 * finger, from the first group's MARKET_CLOSED down.
 */
export function RefusalGroups({ total }: { total: number }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  // Opened from the lower half of the screen, the first codes would start below it: the toggle goes to the top, its
  // focus still on screen, and the first group's codes show under it.
  useEffect(() => {
    if (!opened.current) return;
    opened.current = false;
    const button = toggle.current;
    if (!button) return;
    const { top } = button.getBoundingClientRect();
    // Optional: the unit tests' jsdom has no scrollIntoView.
    if (top < 0 || top > window.innerHeight / 2) button.scrollIntoView?.({ block: "start" });
  }, [open]);
  return (
    <div className="flex flex-col gap-6">
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={REASON_GROUPS.map((_, i) => listId(i)).join(" ")}
        onClick={() => {
          opened.current = !open;
          setOpen(!open);
        }}
        className="pill-line cursor-pointer scroll-mt-4 self-start bg-white"
      >
        {open ? "Show the groups only" : `Show all ${total}`}
      </button>
      <div data-refusals={open ? "all" : "groups"} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-4">
        {REASON_GROUPS.map((g, i) => (
          <div key={g.title} data-group={g.title} className="card flex flex-col gap-3.5 p-[22px]">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-base font-semibold tracking-[-0.02em]">{g.title}</h3>
              <span className="font-mono text-xs text-ink-2">{g.codes.length}</span>
            </div>
            <ul data-labels="" hidden={open} className="m-0 flex list-none flex-wrap gap-2 p-0">
              {g.codes.map((code) => {
                const hot = code === HIGHLIGHT_REASON;
                return (
                  <li
                    key={code}
                    data-label={code}
                    data-hot={hot || undefined}
                    className={`rounded-md px-2 py-[3px] text-sm font-medium ${hot ? "bg-refuse text-white" : "bg-line-soft text-ink"}`}
                  >
                    {REASON_LABEL[code]}
                  </li>
                );
              })}
            </ul>
            <ul id={listId(i)} hidden={!open} className="m-0 flex list-none flex-col gap-3 p-0">
              {g.codes.map((code) => {
                const hot = code === HIGHLIGHT_REASON;
                return (
                  <li key={code} data-code={code} data-hot={hot || undefined} className="flex flex-col items-start gap-1">
                    <ReasonTag
                      code={code}
                      tone="neutral"
                      layout="inline"
                      className={hot ? `text-sm font-medium ${HOT_LABEL}` : "text-sm font-medium"}
                    />
                    <span className="text-sm leading-normal text-ink-2">{REASON_MEANING[code]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
