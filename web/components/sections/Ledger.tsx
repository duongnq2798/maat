import { LedgerTable } from "@/components/LedgerTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getDecisions } from "@/content/decisions";
import { SITE } from "@/lib/site";

export function Ledger() {
  return (
    <section id="ledger" aria-labelledby="ledger-title" className="border-t border-line">
      <div className="wrap flex flex-col gap-8 py-20 md:py-32">
        <LedgerTable
          rows={getDecisions()}
          heading={
            <div className="max-w-[720px]">
              <SectionHeading id="ledger-title" eyebrow="The decision ledger" title="Every answer is public. Especially no." />
            </div>
          }
        />
        <a href={SITE.forkEvidenceUrl} className="-mt-4 self-start text-sm font-medium">
          How to rerun this fork yourself
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>
    </section>
  );
}
