import { Simulator } from "@/components/Simulator";
import { DataBadge } from "@/components/ui/DataBadge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { isoOfDay, WINDOW } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { andList, clockLabel, dayLabel, formatInt } from "@/content/format";
import { FEED_AGE_TOKEN } from "@/content/simulator";
import { repoFileUrl } from "@/lib/site";

export function TryIt() {
  const { holidays, earlyCloses } = FACTS.calendar.value;
  const lastListed = isoOfDay(WINDOW.last);
  const session = FACTS.nyseSessionMin.value;
  const premiums = FACTS.premiumsBps.value;
  const unmeasured = andList(FACTS.basket.value.filter((t) => t !== FEED_AGE_TOKEN));
  // The notes that give a value of the fork test, its block, feed age, premiums and starting balance, carry its badge
  // (spec 2026-11-27, landing "explain in 10 seconds", section 3), as the simulator's own fork rows do.
  const notes: readonly { title: string; body: string; fork?: true }[] = [
    {
      title: "Simulated",
      // A count and an end date: the full list repeats day labels across two years ("Thanksgiving on Thu 26 Nov").
      body: `The market session (NYSE ${clockLabel(session.open)}–${clockLabel(session.close)} ET, weekends, and the ${holidays.length} holidays and ${earlyCloses.length} early closes the calendar lists, up to ${dayLabel(lastListed)} ${lastListed.slice(0, 4)}), the token list, the per-trade and daily caps, the weight and the vault's USDC balance.`,
    },
    {
      title: "Fixed at fork values",
      fork: true,
      body: `Measured on Base at block ${formatInt(FACTS.forkBlock.value)}: token not paused, transfer path authorized, an ${FEED_AGE_TOKEN} feed answer ${FACTS.feedAgeSec.value} s old (the ${unmeasured} feeds are assumed fresh), multiplier unchanged, and a pool premium of ${andList(
        FACTS.basket.value.map((t) => `${premiums[t]} bps for ${t}`),
      )}.`,
    },
    {
      title: "Starting point",
      fork: true,
      body: `Each day starts with $${FACTS.forkVaultUsd.value} USDC and no stock, as the fork vault did. Holdings are valued at cost; the vault values them at the Chainlink price.`,
    },
  ];

  return (
    <section id="try" aria-labelledby="try-title" className="border-y border-line bg-surface-soft">
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
            <p key={n.title} data-try-note={n.title} className="m-0">
              <strong className="font-medium text-ink">{n.title}.</strong>{" "}
              {n.fork ? (
                <>
                  <DataBadge kind="fork" className="align-[1px]" />{" "}
                </>
              ) : null}
              {n.body}
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
