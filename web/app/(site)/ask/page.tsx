import type { Metadata } from "next";
import { Footer } from "@/components/sections/Footer";
import { Nav } from "@/components/sections/Nav";
import { docsData } from "@/lib/docs/generated";
import { OG_IMAGE } from "@/lib/og-image";
import { SITE } from "@/lib/site";
import { AskApp } from "./AskApp";
import { askConfig, askIsOpen } from "./config";

const TITLE = `Brief the agent · ${SITE.name}`;
const DESCRIPTION = "Send Maat's AI agent a public brief from your wallet on Base, and ask the live vault, for free, what it would answer to any intent.";

/** The build's deployments table and the owner's switch: /ask asks not to be indexed until it is open. */
const initial = askConfig(docsData.deployments);

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ask" },
  ...(askIsOpen(initial) ? {} : { robots: { index: false, follow: true } }),
  openGraph: { type: "website", url: "/ask", siteName: SITE.name, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", site: SITE.xHandle, creator: SITE.xHandle, title: TITLE, description: DESCRIPTION, images: [OG_IMAGE] },
};

export default function AskPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav onLanding={false} />
      <main id="main" tabIndex={-1} className="outline-none">
        <AskApp initial={initial} />
      </main>
      <Footer />
    </>
  );
}
