import type { Metadata } from "next";
import { Footer } from "@/components/sections/Footer";
import { Nav } from "@/components/sections/Nav";
import { pageOgImage } from "@/content/page-cards";
import { docsData } from "@/lib/docs/generated";
import { SITE } from "@/lib/site";
import { proofConfig } from "./config";
import { ProofApp } from "./ProofApp";

const TITLE = `Proof · ${SITE.name}`;
const DESCRIPTION = "How Maat counts outside briefs to its AI agent, and the counts, rebuilt from MaatInbox logs on Base by a script anyone can run.";

/** The build's deployments table: the static HTML shows the state the page settles on, before any chain read. */
const initial = proofConfig(docsData.deployments);

// A public page, indexed from the day it ships so the rule is on record before /ask opens; the nav links it later.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/proof" },
  // Its own card (content/page-cards.ts), drawn at build time by app/og/proof.png/route.ts; the landing's image stays the landing's.
  openGraph: { type: "website", url: "/proof", siteName: SITE.name, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [pageOgImage("/proof")] },
  twitter: { card: "summary_large_image", site: SITE.xHandle, creator: SITE.xHandle, title: TITLE, description: DESCRIPTION, images: [pageOgImage("/proof")] },
};

export default function ProofPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <ProofApp initial={initial} />
      </main>
      <Footer />
    </>
  );
}
