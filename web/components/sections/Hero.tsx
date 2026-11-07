import { DecisionEngine } from "@/components/DecisionEngine";
import { FACTS } from "@/content/facts";
import { SITE } from "@/lib/site";

const STATS = [
  { label: "CHECKS PER TRADE", value: String(FACTS.checksPerTrade.value), pad: "pr-4" },
  { label: "TYPED REFUSALS", value: String(FACTS.refusalCount.value), pad: "border-l border-line px-4" },
  { label: "RULE TIMELOCK", value: `${FACTS.timelockHours.value}h`, pad: "border-l border-line pl-4" },
] as const;

export function Hero() {
  return (
    <header id="top" className="relative overflow-hidden">
      <div aria-hidden="true" className="grid-bg absolute inset-0" />
      <div aria-hidden="true" className="hero-glow absolute -right-[10%] -top-[10%] h-[120%] w-3/5" />
      <div className="wrap relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-center gap-10 pb-16 pt-10 sm:pb-[104px] sm:pt-[72px] md:gap-14">
        <div className="flex flex-col gap-5 sm:gap-7">
          <span className="inline-flex items-center gap-2.5 self-start rounded-full border border-line bg-white py-[7px] pl-2 pr-3.5 text-[13px] text-ink-2">
            <span className="rounded-full bg-accent-tint px-2 py-[3px] font-mono text-[11px] font-semibold text-accent">
              AGENTIC
            </span>
            An AI treasury for tokenized stocks on Base
          </span>
          <h1 className="m-0 text-[clamp(42px,6.2vw,86px)] font-semibold leading-[0.98] tracking-[-0.05em]">
            The AI agent that knows <span className="text-accent">when not to trade.</span>
          </h1>
          <p className="lead max-w-[31em] text-[17px] sm:text-[20px]">{SITE.description}</p>
          <div className="flex flex-wrap gap-3">
            <a className="pill-dark" href={SITE.evaluateUrl}>
              Verify it in 5 minutes
              <span aria-hidden="true"> ↗</span>
            </a>
            <a className="pill-line" href="#try">
              Try to make it say no
            </a>
          </div>
          <dl className="m-0 mt-2 grid max-w-[560px] grid-cols-3 border-t border-line">
            {STATS.map((s) => (
              <div key={s.label} className={`pt-[18px] ${s.pad}`}>
                <dt className="font-mono text-xs text-ink-2">{s.label}</dt>
                <dd className="m-0 mt-1.5 text-4xl font-semibold tracking-[-0.04em]">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <DecisionEngine />
      </div>
    </header>
  );
}
