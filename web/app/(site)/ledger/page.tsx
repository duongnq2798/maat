import type { Metadata } from "next";
import { getAddress, isAddress } from "viem";
import { LedgerTable } from "@/components/LedgerTable";
import { HowWeRead } from "@/components/ledger/HowWeRead";
import { LedgerApp } from "@/components/ledger/LedgerApp";
import { VerifyByHand, type VerifyTargets } from "@/components/ledger/VerifyByHand";
import { Footer } from "@/components/sections/Footer";
import { Nav } from "@/components/sections/Nav";
import { DataBadge } from "@/components/ui/DataBadge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getDecisions } from "@/content/decisions";
import { pageOgImage } from "@/content/page-cards";
import { deploymentConfig } from "@/lib/chain/config";
import { docsData } from "@/lib/docs/generated";
import { SITE } from "@/lib/site";

const TITLE = "Mainnet ledger · Maat";
const DESCRIPTION =
  "Every decision Maat's MandateVault makes on Base, allowed or refused, with its treasury and rules, read from the chain in your browser.";

// Its own card (content/page-cards.ts), drawn at build time by app/og/ledger.png/route.ts; the landing's image stays the landing's.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ledger" },
  openGraph: { type: "website", url: "/ledger", siteName: SITE.name, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [pageOgImage("/ledger")] },
  twitter: { card: "summary_large_image", site: SITE.xHandle, creator: SITE.xHandle, title: TITLE, description: DESCRIPTION, images: [pageOgImage("/ledger")] },
};

/** The addresses the verify-by-hand commands read, from the deployments table; null until the vault and calendar are recorded. */
function verifyTargets(): VerifyTargets | null {
  const vault = deploymentConfig(docsData.deployments);
  const calendar = docsData.deployments.find((r) => r.network === "Base mainnet" && r.contract === "MarketCalendar")?.address.trim();
  if (!vault?.deployTx || !calendar || !isAddress(calendar, { strict: false })) return null;
  return { vault: vault.vault, deployTx: vault.deployTx, calendar: getAddress(calendar) };
}

export default function LedgerPage() {
  // The build's deployments table decides the static HTML: the waiting view, or a connecting line once a vault is recorded.
  const initial = deploymentConfig(docsData.deployments) ? "loading" : "waiting";
  const targets = verifyTargets();
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <LedgerApp initial={initial} />
        {targets ? <VerifyByHand targets={targets} /> : null}
        <section id="fork" aria-labelledby="fork-title" className="border-t border-line">
          <div className="wrap flex flex-col gap-8 py-16 md:py-24">
            <LedgerTable
              rows={getDecisions()}
              heading={
                <div className="flex max-w-[720px] flex-col items-start gap-3">
                  <SectionHeading id="fork-title" eyebrow="Before mainnet" title="The fork run" />
                  {/* The fork badge the landing puts on every number of this run (spec 2026-11-27 section 3). */}
                  <DataBadge kind="fork" />
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
