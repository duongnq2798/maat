import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";

/**
 * The loop as designed, each step's label saying where it stands, as the README's status table and the vault's
 * Decision events show it: x402 revenue was dropped for this season (PR #2, closed unmerged), buys run on Base mainnet,
 * supply and borrow have run only in fork tests (credit actions are off by default), and no bill has been paid on
 * mainnet yet.
 */
const STEPS = [
  { n: "01 · EARN · DROPPED", title: "x402 revenue", body: "Paid safety checks for other agents." },
  {
    n: "02 · BUY · LIVE",
    title: "B20 stocks",
    body: `Equal-weight NVDAc, GOOGLc and AAPLc, rebalanced past a ${FACTS.rebalanceDriftPct.value}% drift, only in session.`,
  },
  { n: "03 · SUPPLY · FORK ONLY", title: "Aave V4", body: "Stocks become collateral on the Equities Hub." },
  { n: "04 · BORROW · FORK ONLY", title: "USDC runway", body: "A loan covers compute, above the health factor floor." },
  { n: "05 · PAY · NOT YET", title: "Its own bill", body: "Claude usage, paid to an allowlisted payee." },
] as const;

export function TreasuryLoop() {
  return (
    <section aria-labelledby="loop-title" className="wrap flex flex-col gap-12 py-20 md:py-32">
      <SectionHeading id="loop-title" eyebrow="The treasury loop" title="One step is live." />
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-3 p-0 text-balance">
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
