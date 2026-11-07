import { LedgerTable } from "@/components/LedgerTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getDecisions } from "@/content/decisions";

export function Ledger() {
  return (
    <section id="ledger" aria-labelledby="ledger-title" className="border-t border-line">
      <div className="wrap flex flex-col gap-8 py-32">
        <LedgerTable
          rows={getDecisions()}
          heading={
            <div className="max-w-[720px]">
              <SectionHeading id="ledger-title" eyebrow="The decision ledger" title="Every answer is public. Especially no." />
            </div>
          }
        />
      </div>
    </section>
  );
}
