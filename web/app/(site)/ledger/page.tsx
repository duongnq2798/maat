import type { Metadata } from "next";
import { LedgerTable } from "@/components/LedgerTable";
import { HowWeRead } from "@/components/ledger/HowWeRead";
import { LedgerApp } from "@/components/ledger/LedgerApp";
import { Footer } from "@/components/sections/Footer";
import { Nav } from "@/components/sections/Nav";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getDecisions } from "@/content/decisions";
import { deploymentConfig } from "@/lib/chain/config";
import { docsData } from "@/lib/docs/generated";
import { OG_IMAGE } from "@/lib/og-image";
import { SITE } from "@/lib/site";

const TITLE = "Mainnet ledger · Maat";
const DESCRIPTION =
  "Every decision Maat's MandateVault makes on Base, allowed or refused, with its treasury and rules, read from the chain in your browser.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ledger" },
  openGraph: { type: "website", url: "/ledger", siteName: SITE.name, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", site: SITE.xHandle, creator: SITE.xHandle, title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

export default function LedgerPage() {
  // The build's deployments table decides the static HTML: the waiting view, or a connecting line once a vault is recorded.
  const initial = deploymentConfig(docsData.deployments) ? "loading" : "waiting";
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <LedgerApp initial={initial} />
        <section id="fork" aria-labelledby="fork-title" className="border-t border-line">
          <div className="wrap flex flex-col gap-8 py-16 md:py-24">
            <LedgerTable
              rows={getDecisions()}
              heading={
                <div className="max-w-[720px]">
                  <SectionHeading id="fork-title" eyebrow="Before mainnet" title="The fork run" />
                </div>
              }
            />
            <a href={SITE.forkEvidenceUrl} className="-mt-4 self-start text-sm font-medium">
              How to rerun this fork yourself
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>
        </section>
        <HowWeRead />
      </main>
      <Footer />
    </>
  );
}
