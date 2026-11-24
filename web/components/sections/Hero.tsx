import { DecisionEngine } from "@/components/DecisionEngine";
import { type FactKey, Fig } from "@/components/instrument/Fig";
import { Ruler } from "@/components/instrument/Ruler";
import { LiveStrip } from "@/components/live/LiveStrip";
import { FACTS } from "@/content/facts";
import { SITE } from "@/lib/site";

/** The spec plate: the pinned labels (spec 2026-11-23 section 3.1), each figure marked with the fact it comes from. */
const SPECS: readonly { label: string; fact: FactKey; value: string; pad: string }[] = [
  { label: "CHECKS PER TRADE", fact: "checksPerTrade", value: String(FACTS.checksPerTrade.value), pad: "pr-4" },
  { label: "TYPED REFUSALS", fact: "refusalCount", value: String(FACTS.refusalCount.value), pad: "border-l border-line px-4" },
  { label: "RULE TIMELOCK", fact: "timelockHours", value: `${FACTS.timelockHours.value}h`, pad: "border-l border-line pl-4" },
];

/**
 * The landing's first screen (spec sections 6.1 and 6.2): a tick ruler, the H1, the live Readout, the lead, both CTAs
 * above the fold at 1440x900, and the spec plate; the engine card weighs on the right.
 */
export function Hero() {
  return (
    <header id="top" className="relative overflow-hidden">
      <Ruler className="absolute inset-x-0 top-0" />
      <div aria-hidden="true" className="hero-glow absolute -right-[10%] -top-[10%] h-[120%] w-3/5" />
      <div className="wrap relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-10 pb-16 pt-8 sm:pb-24 sm:pt-10 md:gap-14 xl:grid-cols-[minmax(0,1fr)_560px] xl:gap-12">
        <div className="flex flex-col gap-5">
          <span className="inline-flex items-center gap-2.5 self-start rounded-full border border-line bg-white py-[7px] pl-2 pr-3.5 text-[13px] text-ink-2">
            <span className="rounded-full bg-accent-tint px-2 py-[3px] font-mono text-[11px] font-semibold text-accent">
              AGENTIC
            </span>
            An AI treasury for tokenized stocks on Base
          </span>
          <h1 className="m-0 text-[clamp(44px,5.4vw,78px)] font-semibold leading-[0.96] tracking-[-0.055em]">
            The AI agent that knows <span className="text-accent">when not to trade.</span>
          </h1>
          <LiveStrip />
          <p className="lead max-w-[31em] text-[17px] leading-[1.55] sm:text-[19px]">{SITE.description}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a data-hero-cta="" className="pill-dark min-h-[52px] justify-center sm:min-h-11" href={SITE.quickstartUrl}>
              Verify it in 5 minutes
            </a>
            <a data-hero-cta="" className="pill-line min-h-[52px] justify-center sm:min-h-11" href="#try">
              Try to make it say no
            </a>
          </div>
          <dl className="m-0 mt-2 grid max-w-[560px] grid-cols-3 border-t border-line">
            {SPECS.map((s) => (
              <div key={s.label} className={`pt-[18px] ${s.pad}`}>
                <dt className="font-mono text-[11px] font-medium tracking-[0.12em] text-label">{s.label}</dt>
                <Fig k={s.fact} as="dd" className="m-0 mt-1.5 text-4xl font-semibold tracking-[-0.04em]">
                  {s.value}
                </Fig>
              </div>
            ))}
          </dl>
        </div>
        <DecisionEngine />
      </div>
    </header>
  );
}
