"use client";

import { useState } from "react";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { type CheckMark, MOMENT_ORDER, type MomentId, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";

const MARK_STYLE: Record<CheckMark, string> = {
  PASS: "bg-accent-tint text-accent",
  FAIL: "bg-refuse text-white",
  SKIP: "bg-line-soft text-ink-2",
};

export function DecisionEngine() {
  const [state, setState] = useState<{ moment: MomentId; run: number }>({ moment: "sat", run: 0 });
  const moment = MOMENTS[state.moment];
  // Every click bumps `run`, which remounts the rows and the verdict card so their animations replay.
  const choose = (id: MomentId) => setState((s) => ({ moment: id, run: s.run + 1 }));

  return (
    <div className="card overflow-hidden shadow-[0_1px_0_var(--color-line),0_30px_80px_-30px_color-mix(in_srgb,var(--color-ink)_28%,transparent)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-head px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold">DECISION ENGINE</span>
          <span className="font-mono text-[11px] text-ink-2">
            replay · Base fork · block {formatInt(FACTS.forkBlock.value)}
          </span>
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

      <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-2 pt-5">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[11px] text-ink-2">INTENT · SCRIPTED FORK RUN</span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">{moment.intent}</span>
        </div>
        <span className="font-mono text-xs text-ink-2">{moment.when}</span>
      </div>

      <ol key={`checks-${state.run}`} aria-label="Mandate checks" className="m-0 list-none px-3 pb-3 pt-2">
        {moment.checks.map((c, i) => (
          <li
            key={c.label}
            data-mark={c.mark}
            style={{ animationDelay: `${(0.12 + 0.16 * i).toFixed(2)}s` }}
            className={`anim-row grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-3 rounded-[10px] px-2.5 py-[9px] ${
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
            <span className={`rounded-md py-1 text-center font-mono text-[11px] font-semibold ${MARK_STYLE[c.mark]}`}>
              {c.mark}
            </span>
          </li>
        ))}
      </ol>

      {/* The live region itself never remounts; only its child does. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="mx-3 mb-3">
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
          <div className="flex flex-col gap-1.5 text-right">
            <ReasonTag code={moment.reason} tone="verdict" layout="stacked" />
            <span className="font-mono text-[11px] opacity-80">{moment.outcome}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
