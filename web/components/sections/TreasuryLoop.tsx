import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";

const STEPS = [
  {
    n: "01 · EARN",
    title: "x402 revenue",
    body: `Planned: other agents pay ${FACTS.x402Price.value} to ask whether a stock trade is safe right now, and the USDC lands in the vault.`,
  },
  {
    n: "02 · BUY",
    title: "B20 stocks",
    body: `Equal-weight NVDAc, GOOGLc and AAPLc, rebalanced past a ${FACTS.rebalanceDriftPct.value}% drift, only in session.`,
  },
  { n: "03 · SUPPLY", title: "Aave V4", body: "Stocks become collateral on the Equities Hub." },
  { n: "04 · BORROW", title: "USDC runway", body: "A small loan covers compute, never below the target health factor." },
  { n: "05 · PAY", title: "Its own bill", body: "It pays its Claude bill in USDC to an allowlisted payee." },
] as const;

export function TreasuryLoop() {
  return (
    <section aria-labelledby="loop-title" className="wrap flex flex-col gap-12 py-20 md:py-32">
      <SectionHeading id="loop-title" eyebrow="The treasury loop" title="An agent that pays its own way." />
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3 p-0">
        {STEPS.map((s) => (
          <li key={s.n} className="card flex min-h-[190px] flex-col gap-2.5 p-[22px]">
            <span className="font-mono text-xs font-semibold text-accent">{s.n}</span>
            <h3 className="m-0 text-xl font-semibold tracking-[-0.03em]">{s.title}</h3>
            <p className="m-0 text-sm leading-[1.55] text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
