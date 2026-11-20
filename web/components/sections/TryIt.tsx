import { Simulator } from "@/components/Simulator";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { andList, clockLabel, dayLabel, formatInt } from "@/content/format";
import { FEED_AGE_TOKEN } from "@/content/simulator";
import { repoFileUrl } from "@/lib/site";

export function TryIt() {
  const { holidays, earlyCloses } = FACTS.calendar.value;
  const session = FACTS.nyseSessionMin.value;
  const premiums = FACTS.premiumsBps.value;
  const unmeasured = andList(FACTS.basket.value.filter((t) => t !== FEED_AGE_TOKEN));
  const notes = [
    {
      title: "Simulated",
      body: `The market session (NYSE ${clockLabel(session.open)}–${clockLabel(session.close)} ET, weekends, and the holidays the calendar lists: ${andList(
        holidays.map((h) => `${h.name} on ${dayLabel(h.date)}`),
      )}; early closes at ${andList(earlyCloses.map((e) => `${clockLabel(e.closeMin)} on ${dayLabel(e.date)}`))}), the token list, the per-trade and daily caps, the weight and the vault's USDC balance.`,
    },
    {
      title: "Fixed at fork values",
      body: `Measured on Base at block ${formatInt(FACTS.forkBlock.value)}: token not paused, transfer path authorized, an ${FEED_AGE_TOKEN} feed answer ${FACTS.feedAgeSec.value} s old (the ${unmeasured} feeds are assumed fresh), multiplier unchanged, and a pool premium of ${andList(
        FACTS.basket.value.map((t) => `${premiums[t]} bps for ${t}`),
      )}.`,
    },
    {
      title: "Starting point",
      body: `Each day starts with $${FACTS.forkVaultUsd.value} USDC and no stock, as the fork vault did. Holdings are valued at cost; the vault values them at the Chainlink price.`,
    },
  ];

  return (
    <section id="try" aria-labelledby="try-title" className="border-t border-line bg-surface-soft">
      <div className="wrap flex flex-col gap-12 py-20 md:py-32">
        <SectionHeading
          id="try-title"
          layout="split"
          eyebrow="Try it"
          title="Try to make it say no."
          lead="A simulation of the default mandate, running in your browser. Pick a stock, an amount and a moment. The contract is the source of truth."
        />
        <Simulator />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-x-10 gap-y-5 text-sm leading-relaxed text-ink-2">
          {notes.map((n) => (
            <p key={n.title} className="m-0">
              <strong className="font-medium text-ink">{n.title}.</strong> {n.body}
            </p>
          ))}
          {/* Medium weight: inside ink-2 text the accent colour alone does not set a link apart (axe link-in-text-block). */}
          <p className="m-0">
            <strong className="font-medium text-ink">Source of truth.</strong> The contracts decide, not this page. Read{" "}
            <a className="font-medium" href={repoFileUrl("contracts/src/MarketCalendar.sol")}>MarketCalendar.sol</a> and{" "}
            <a className="font-medium" href={repoFileUrl("contracts/src/MandateVault.sol")}>MandateVault.sol</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
