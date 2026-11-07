import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { HIGHLIGHT_REASON, REASON_GROUPS } from "@/content/reasons";

export function Refusals() {
  return (
    <section id="reasons" aria-labelledby="reasons-title" className="wrap flex flex-col gap-12 py-32">
      <SectionHeading
        id="reasons-title"
        layout="split"
        eyebrow="Refusals"
        title={`${numberWord(FACTS.refusalCount.value)} typed ways to say no.`}
        lead="A refusal is not an error log. It is a reason code inside the Decision event, readable by anyone, from a dashboard or another agent."
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,210px),1fr))] gap-4">
        {REASON_GROUPS.map((g) => (
          <div key={g.title} className="card flex flex-col gap-3.5 p-[22px]">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="m-0 text-base font-semibold tracking-[-0.02em]">{g.title}</h3>
              <span className="font-mono text-xs text-ink-2">{g.codes.length}</span>
            </div>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {g.codes.map((code) => {
                const hot = code === HIGHLIGHT_REASON;
                return (
                  <li
                    key={code}
                    data-hot={hot || undefined}
                    className={`rounded-md px-2 py-[5px] font-mono text-[11px] ${
                      hot ? "bg-refuse text-white" : "border border-line bg-surface-soft text-ink-body"
                    }`}
                  >
                    {code}
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
