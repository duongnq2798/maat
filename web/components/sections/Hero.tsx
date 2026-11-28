import { type FactKey, Fig } from "@/components/instrument/Fig";
import { Ruler } from "@/components/instrument/Ruler";
import { LiveStrip } from "@/components/live/LiveStrip";
import { FACTS } from "@/content/facts";
import { HERO_AUDIENCE, HERO_CTAS, HERO_DEFINITION, HERO_STEPS } from "@/content/hero";
import { SITE } from "@/lib/site";
import { HeroCard } from "./HeroCard";
import { HeroNote } from "./HeroNote";
import { HeroReason } from "./HeroReason";

/** The spec plate: the pinned labels (spec 2026-11-23 section 3.1), each figure marked with the fact it comes from. */
const SPECS: readonly { label: string; fact: FactKey; value: string; pad: string }[] = [
  { label: "CHECKS PER TRADE", fact: "checksPerTrade", value: String(FACTS.checksPerTrade.value), pad: "pr-4" },
  { label: "TYPED REFUSALS", fact: "refusalCount", value: String(FACTS.refusalCount.value), pad: "border-l border-line px-4" },
  { label: "RULE TIMELOCK", fact: "timelockHours", value: `${FACTS.timelockHours.value}h`, pad: "border-l border-line pl-4" },
];

/** The CTAs' looks, in order: the first solid, the second outlined. */
const CTA_LOOK = ["pill-dark", "pill-line"] as const;

/**
 * The landing's first screen (spec 2026-11-27, landing "explain in 10 seconds", section 1): under the tick ruler, the
 * H1, then what Maat is in one sentence, who it is for (linked to the builders' section), and the three steps of every
 * trade, each linked to How it works. Then the one live line, "Right now, a buy would be: ...", both CTAs (52 px and
 * stacked on phones, 44 px in a row from sm) and the spec plate. On the right, the engine card on its mainnet face holds
 * the vault's latest Decision, dated, and under it the agent's last recorded round. Under both columns, from sm, one
 * full-width row quotes Claude's own reason for the first trade the vault allowed (HeroReason); below sm that row shows
 * in How it works instead (cold read of 2026-11-28, gap 6).
 */
export function Hero() {
  return (
    <header id="top" className="relative overflow-hidden">
      <Ruler className="absolute inset-x-0 top-0" />
      <div aria-hidden="true" className="hero-glow absolute -right-[10%] -top-[10%] hidden h-[120%] w-3/5 lg:block" />
      <div className="wrap relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-10 pb-16 pt-8 sm:pb-24 sm:pt-10 md:gap-14 xl:grid-cols-[minmax(0,1fr)_560px] xl:gap-12">
        <div className="flex min-w-0 flex-col gap-4">
          <h1 className="m-0 text-[clamp(44px,5.4vw,78px)] font-semibold leading-[0.96] tracking-[-0.055em]">
            The AI agent that knows <span className="text-accent">when not to trade.</span>
          </h1>
          <p data-hero-definition="" className="lead max-w-[34em] text-[17px] leading-[1.55] text-ink-body sm:text-[19px]">
            {HERO_DEFINITION}
          </p>
          <p data-hero-audience="" className="-mt-2 max-w-[34em] text-[15px] leading-normal text-ink-2">
            {HERO_AUDIENCE.before}
            <a href={HERO_AUDIENCE.href} className="tap font-medium">
              {HERO_AUDIENCE.link}
            </a>
            {HERO_AUDIENCE.after}
          </p>
          <ol
            data-hero-steps=""
            aria-label="How a trade is weighed"
            className="m-0 grid list-none grid-cols-3 gap-3 border-t border-line p-0"
          >
            {HERO_STEPS.map((step, i) => (
              <li key={step} className="min-w-0">
                <a
                  href="#how"
                  className="flex min-h-11 flex-col gap-1 pt-3 text-[14px] font-medium leading-[1.35] text-ink hover:text-accent sm:text-[15px]"
                >
                  <span aria-hidden="true" className="font-mono text-[11px] font-semibold text-accent">
                    {i + 1}
                  </span>
                  {step}
                </a>
              </li>
            ))}
          </ol>
          <LiveStrip />
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {HERO_CTAS.map((cta, i) => (
              <a key={cta.href} data-hero-cta="" className={`${CTA_LOOK[i]} min-h-[52px] justify-center sm:min-h-11`} href={cta.href}>
                {cta.label}
              </a>
            ))}
          </div>
          {/* Spec 2026-11-27 section 1, word for word: the quickstart runs the vault's tests. */}
          <a href={SITE.quickstartUrl} className="tap self-start text-[15px] font-medium">
            Verify it in 5 minutes
            <span aria-hidden="true"> →</span>
          </a>
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
        <div className="flex min-w-0 flex-col gap-4">
          <HeroCard />
          <HeroNote />
        </div>
        <HeroReason className="max-sm:hidden" />
      </div>
    </header>
  );
}
