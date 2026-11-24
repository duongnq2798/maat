"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import { BALANCE, Balance } from "@/components/instrument/Balance";
import { factAttr } from "@/components/instrument/Fig";
import { SourcePlate } from "@/components/instrument/SourcePlate";
import type { TipDrag } from "@/components/instrument/useTipDrag";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { type CheckMark, MOMENT_ORDER, type MomentId, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import { prefersReducedMotion } from "@/lib/motion/reduced-motion";

const MARK_STYLE: Record<CheckMark, string> = {
  PASS: "bg-accent-tint text-accent",
  FAIL: "bg-refuse text-white",
  SKIP: "bg-line-soft text-ink-2",
};

/** Where the beam's intro starts: level, or at the refused angle (BALANCE.refusedDeg). */
export type Tilt = "level" | "refused";

const tiltOf = (id: MomentId): Tilt => (MOMENTS[id].allowed ? "level" : "refused");

/**
 * The angle the beam's intro starts from when the visitor moves from `prev` to `next`: where `prev` left the beam, so
 * Sat → Thu swings level from -6° and Thu → Sat tips from level. The first paint (no `prev`) and a replay of the same
 * moment start level, so the beam tips again (spec 2026-11-23 section 6.1).
 */
export function tiltFrom(prev: MomentId | null, next: MomentId): Tilt {
  return prev === null || prev === next ? "level" : tiltOf(prev);
}

export function DecisionEngine() {
  const [state, setState] = useState<{ moment: MomentId; run: number; from: Tilt }>({ moment: "sat", run: 0, from: "level" });
  const [dragged, setDragged] = useState(false);
  const drag = useRef<TipDrag | null>(null);
  const pressed = useRef(false);
  const moment = MOMENTS[state.moment];

  // A drag never outlives the card.
  useEffect(
    () => () => {
      drag.current?.stop();
    },
    [],
  );

  // Every click bumps `run`, which remounts the weighing, the rows and the verdict card so their animations replay. A
  // choice ends a drag first.
  const choose = (id: MomentId) => {
    drag.current?.stop();
    setState((s) => ({ moment: id, run: s.run + 1, from: tiltFrom(s.moment, id) }));
  };

  // Drag-to-tip (spec 2026-11-23 section 6.1): the integrator loads on the first press, never with the page. A drag
  // starts for the primary button only, one at a time, and never under reduced motion.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current !== null || prefersReducedMotion()) return;
    const zone = e.currentTarget;
    const svg = zone.querySelector<SVGSVGElement>("svg.balance");
    if (svg === null) return;
    pressed.current = true;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      // No pointer capture here, or the pointer is already gone: the drag still listens on the zone.
    }
    const { pointerId, clientX } = e;
    const restDeg = moment.allowed ? 0 : BALANCE.refusedDeg;
    void import("@/components/instrument/useTipDrag").then(({ beginTipDrag }) => {
      if (!pressed.current || drag.current !== null || !zone.isConnected) return;
      drag.current = beginTipDrag({
        svg,
        zone,
        pointerId,
        startX: clientX,
        restDeg,
        onEnd: () => {
          drag.current = null;
        },
      });
      setDragged(true);
    });
  };
  const onPointerUp = () => {
    pressed.current = false;
  };

  return (
    <div className="card overflow-hidden shadow-[0_1px_0_var(--color-line),0_30px_80px_-30px_color-mix(in_srgb,var(--color-ink)_28%,transparent)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-head px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold">DECISION ENGINE</span>
          <SourcePlate kind="replay" data-fact={factAttr("forkBlock")}>
            {`replay · Base fork · block ${formatInt(FACTS.forkBlock.value)}`}
          </SourcePlate>
        </div>
        <div role="group" aria-label="Choose a moment" className="flex rounded-full bg-line-soft p-[3px]">
          {MOMENT_ORDER.map((id) => {
            const on = state.moment === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => choose(id)}
                className={`min-h-9 cursor-pointer rounded-full border-0 px-3.5 py-2 text-xs font-medium ${
                  on
                    ? "bg-white text-ink shadow-[0_1px_2px_color-mix(in_srgb,var(--color-ink)_12%,transparent)]"
                    : "bg-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {MOMENTS[id].toggleLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* The weighing: the Balance and the order it weighs. The Balance is aria-hidden; the words are in the HTML. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 pt-5">
        <div
          key={`weighing-${state.run}`}
          data-weighing=""
          data-tilt-from={state.from}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="weighing flex shrink-0 cursor-grab touch-pan-y flex-col items-center gap-1"
        >
          <Balance verdict={moment.allowed ? "allowed" : "refused"} checks={moment.checks.map((c) => c.mark)} />
          <span aria-hidden="true" data-label={moment.intent} className="balance-label font-mono text-[10px] text-label" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-ink-2">INTENT · SCRIPTED FORK RUN</span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">{moment.intent}</span>
          <span className="font-mono text-xs text-ink-2">{moment.when}</span>
        </div>
      </div>
      {dragged ? <p className="m-0 px-5 pt-2 font-mono text-[11px] text-label">Only the nine checks move this beam.</p> : null}

      {/* The live region itself never remounts; only its child does. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="mx-3 mt-4">
        <div
          key={`verdict-${state.run}`}
          data-verdict={moment.allowed ? "allowed" : "refused"}
          data-reason={moment.reason}
          className={`anim-stamp flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-[18px] py-4 text-white ${
            moment.allowed ? "bg-accent" : "bg-ink"
          }`}
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] opacity-80">VAULT DECISION</span>
            <span className="text-[26px] font-semibold tracking-[-0.03em]">{moment.allowed ? "Allowed" : "Refused"}</span>
          </div>
          <div className="ml-auto flex flex-col gap-1.5 text-right">
            <ReasonTag code={moment.reason} tone="verdict" layout="stacked" />
            <span className="font-mono text-[11px] opacity-80">{moment.outcome}</span>
          </div>
        </div>
      </div>

      {/* The grounds: nine channel rows of 36 px. */}
      <ol key={`checks-${state.run}`} aria-label="Mandate checks" className="m-0 list-none px-3 pb-3 pt-3">
        {moment.checks.map((c, i) => (
          <li
            key={c.label}
            data-mark={c.mark}
            style={{ animationDelay: `${(0.12 + 0.16 * i).toFixed(2)}s` }}
            className={`anim-row grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-3 rounded-[10px] px-2.5 py-2 ${
              c.mark === "FAIL" ? "bg-refuse-tint" : ""
            }`}
          >
            <span aria-hidden="true" className="font-mono text-[11px] text-ink-2">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className={`text-sm font-medium ${c.mark === "SKIP" ? "text-ink-2" : ""}`}>{c.label}</span>
              <span className="font-mono text-xs text-ink-2">{c.detail}</span>
            </span>
            <span className={`rounded-md py-0.5 text-center font-mono text-[11px] leading-4 font-semibold ${MARK_STYLE[c.mark]}`}>
              {c.mark}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
