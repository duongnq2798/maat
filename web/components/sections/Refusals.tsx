import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { RefusalGroups } from "./RefusalGroups";

/**
 * The nineteen typed refusals, in five groups. The groups show by default and "Show all 19" opens the codes (spec
 * 2026-11-27, landing "explain in 10 seconds", section 3); components/sections/RefusalGroups.tsx holds the toggle.
 */
export function Refusals() {
  return (
    <section id="reasons" aria-labelledby="reasons-title" className="wrap flex flex-col gap-12 py-20 md:py-32">
      <SectionHeading
        id="reasons-title"
        layout="split"
        eyebrow="Refusals"
        title={`${numberWord(FACTS.refusalCount.value)} typed ways to say no.`}
        lead="A refusal is not an error log. It is a reason code inside the Decision event, readable by anyone, from a dashboard or another agent."
      />
      <RefusalGroups total={FACTS.refusalCount.value} />
    </section>
  );
}
