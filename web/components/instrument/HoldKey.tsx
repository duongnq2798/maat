"use client";

import { useLive } from "@/components/live/LiveSnapshotProvider";

/**
 * A bezel key on the Readout (spec 2026-11-23 sections 4 and 6.1): 24 px tall, mono, engraved, with a 44 px target from
 * `.readout-key::before` in app/globals.css and a 1 px press. lcd-2 at rest, lcd on hover, pass-lit while pressed. The
 * strip's Read again key shares it.
 */
export const KEY_CLASS =
  "readout-key min-h-6 cursor-pointer rounded-md border border-chassis-line bg-transparent px-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-lcd-2 hover:text-lcd aria-pressed:border-pass-lit aria-pressed:text-pass-lit aria-disabled:cursor-wait focus-visible:outline-pass-lit";

/**
 * Pause (WCAG 2.2.2): while pressed, the page's one reading is held. No read starts, no timer runs, and the strip stays
 * as it is, until it is pressed again. It reads the page's LiveSnapshotProvider, never a loop of its own. The word
 * stays "Pause" in the DOM; CSS uppercases it. It was "Hold" until the landing's plain-words pass (spec 2026-11-27,
 * section 4).
 */
export function HoldKey({ className }: { className?: string }) {
  const { hold, setHold } = useLive();
  return (
    <button
      type="button"
      data-hold-key=""
      aria-pressed={hold}
      onClick={() => setHold(!hold)}
      className={className ? `${KEY_CLASS} ${className}` : KEY_CLASS}
    >
      Pause
    </button>
  );
}
