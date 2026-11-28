import { type FactKey, Fig } from "@/components/instrument/Fig";
import { FACTS } from "@/content/facts";

/** The spec plate: the pinned labels (spec 2026-11-23 section 3.1), each figure marked with the fact it comes from. */
const SPECS: readonly { label: string; fact: FactKey; value: string; pad: string }[] = [
  { label: "CHECKS PER TRADE", fact: "checksPerTrade", value: String(FACTS.checksPerTrade.value), pad: "pr-4" },
  { label: "TYPED REFUSALS", fact: "refusalCount", value: String(FACTS.refusalCount.value), pad: "border-l border-line px-4" },
  { label: "RULE TIMELOCK", fact: "timelockHours", value: `${FACTS.timelockHours.value}h`, pad: "border-l border-line pl-4" },
];

/**
 * The three numbers every answer of the vault rests on: the checks it runs on each trade, the refusals it can name, and
 * how long a rule change waits. Since 2026-11-28 (landing "a calmer first screen", section 1) they close the "On the
 * record" block, under the vault's real answers, instead of the hero, which keeps one live proof and its CTAs. The
 * caller sets its width.
 */
export function SpecPlate({ className = "" }: { className?: string }) {
  return (
    <dl data-spec-plate="" className={`m-0 grid grid-cols-3 border-t border-line ${className}`}>
      {SPECS.map((s) => (
        <div key={s.label} className={`pt-[18px] ${s.pad}`}>
          <dt className="font-mono text-[11px] font-medium tracking-[0.12em] text-label">{s.label}</dt>
          <Fig k={s.fact} as="dd" className="m-0 mt-1.5 text-4xl font-semibold tracking-[-0.04em]">
            {s.value}
          </Fig>
        </div>
      ))}
    </dl>
  );
}
