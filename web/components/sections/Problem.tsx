import type { ReactNode } from "react";
import { PremiumChart } from "@/components/charts/PremiumChart";
import { WeekChart } from "@/components/charts/WeekChart";
import { DataBadge } from "@/components/ui/DataBadge";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { PUBLISHED } from "@/content/gap-index";
import type { RefusalCode } from "@/content/reasons";

interface CardProps {
  tag: string;
  code: RefusalCode;
  title: string;
  body: string;
  children: ReactNode;
}

function ProblemCard({ tag, code, title, body, children }: CardProps) {
  return (
    <article className="card flex flex-col gap-[18px] p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <span className="font-mono text-xs text-ink-2">{tag}</span>
        {/* The trap's plain label in the refuse colour, its code under it, both right-aligned; the tag drops under the
            eyebrow when the two do not fit on one line. */}
        <ReasonTag code={code} tone="refuse" layout="stacked" className="ml-auto items-end text-right text-sm font-medium" />
      </div>
      <h3 className="m-0 text-2xl font-semibold leading-[1.15] tracking-[-0.03em]">{title}</h3>
      {children}
      <p className="m-0 text-[15px] leading-[1.6] text-ink-2">{body}</p>
    </article>
  );
}

/**
 * A B20 token's uiMultiplier as a reader takes it in (spec 2026-11-27 section 4): four decimals, then its change from 1
 * in percent, "1.0005 (+0.05%)" for 1.000537939576369481. The full value stays in the title.
 */
export function splitMultiplierText(value: string): string {
  const m = Number(value);
  const pct = (m - 1) * 100;
  return `${m.toFixed(4)} (${pct < 0 ? "" : "+"}${pct.toFixed(2)}%)`;
}

export function Problem() {
  const m = FACTS.mandate.value;
  const cooldownH = m.multiplierCooldownSec / 3600;
  return (
    <section aria-labelledby="problem-title" className="wrap flex flex-col gap-14 py-20 md:py-32">
      <SectionHeading
        id="problem-title"
        layout="split"
        eyebrow="The problem"
        title="Tokenized stocks trade 24/7. Their prices don't."
        lead="An agent that only reads a DEX price will buy on a Saturday, chase a pool that drifted from fair value, or trade through a stock split. Maat turns each trap into a rule the contract enforces."
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] gap-5">
        <ProblemCard
          tag="01 · MARKET HOURS"
          code="MARKET_CLOSED"
          title="The price feed sleeps every weekend."
          body="The vault reads the NYSE calendar onchain, holidays and early closes included. No session, no trade."
        >
          <WeekChart />
        </ProblemCard>
        <ProblemCard
          tag="02 · PREMIUM"
          code="PREMIUM_TOO_HIGH"
          title="The pool can drift from fair value."
          body={`Each trade compares a ${m.twapWindowSec / 60}-minute Aerodrome TWAP with Chainlink. We measured these premiums in session before setting the limit.`}
        >
          <div className="flex flex-col gap-2">
            {/* The premiums were measured at the fork block, so the chart carries the fork badge (spec 2026-11-27 section 3). */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span data-chart-label="" className="font-mono text-[11px] text-ink-2">
                pool vs Chainlink, in bps · limit {m.maxPremiumBps}
              </span>
              <DataBadge kind="fork" />
            </div>
            <PremiumChart />
          </div>
        </ProblemCard>
        <ProblemCard
          tag="03 · CORPORATE ACTIONS"
          code="MULTIPLIER_COOLDOWN"
          title="A split quietly changes the math."
          body={`When the B20 multiplier moves, the vault records it and pauses that token for ${cooldownH} hours while prices settle.`}
        >
          <div className="flex flex-col gap-2.5 rounded-[14px] bg-surface-soft p-[18px]">
            {/* The multiplier is NVDAc's at the fork block: the fork badge again. */}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="font-mono text-[11px] text-ink-2">NVDAc · split multiplier</span>
              <DataBadge kind="fork" />
            </div>
            <span
              title={`uiMultiplier ${FACTS.nvdaUiMultiplier.value}`}
              className="break-all font-mono text-[clamp(18px,1.8vw,22px)] font-medium tracking-[-0.02em]"
            >
              {splitMultiplierText(FACTS.nvdaUiMultiplier.value)}
            </span>
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="rounded-md bg-refuse-tint px-2 py-[3px] text-refuse">change detected</span>
              <span aria-hidden="true" className="h-px flex-1 bg-line-strong" />
              <span className="text-ink-2">{cooldownH}h pause</span>
            </div>
          </div>
        </ProblemCard>
      </div>
      {/* The weekends measured on Base mainnet: the latest Gap Index edition, by its own title. */}
      <a href="/gap-index" className="-mt-6 self-start text-[15px] font-medium">
        Weekend Gap Index · {PUBLISHED[0]!.title}
        <span aria-hidden="true"> →</span>
      </a>
    </section>
  );
}
