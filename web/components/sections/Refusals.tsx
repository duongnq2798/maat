import { ReasonTag } from "@/components/ui/ReasonTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { HIGHLIGHT_REASON, REASON_GROUPS, REASON_MEANING } from "@/content/reasons";

/**
 * The fork run's refusal keeps its filled red highlight, now on its label. ReasonTag renders the label as its first
 * child and the code as its last, so these child selectors fill the label only and leave the code a muted tag.
 */
const HOT_LABEL =
  "[&>:first-child]:rounded-md [&>:first-child]:bg-refuse [&>:first-child]:px-2 [&>:first-child]:py-[3px] [&>:first-child]:text-white";

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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-start gap-4">
        {REASON_GROUPS.map((g) => (
          <div key={g.title} className="card flex flex-col gap-3.5 p-[22px]">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-base font-semibold tracking-[-0.02em]">{g.title}</h3>
              <span className="font-mono text-xs text-ink-2">{g.codes.length}</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {g.codes.map((code) => {
                const hot = code === HIGHLIGHT_REASON;
                return (
                  <li key={code} data-code={code} data-hot={hot || undefined} className="flex flex-col items-start gap-1">
                    <ReasonTag
                      code={code}
                      tone="neutral"
                      layout="inline"
                      className={hot ? `text-sm font-medium ${HOT_LABEL}` : "text-sm font-medium"}
                    />
                    <span className="text-sm leading-normal text-ink-2">{REASON_MEANING[code]}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
