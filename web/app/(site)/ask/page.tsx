import type { Metadata } from "next";
import { Footer } from "@/components/sections/Footer";
import { Nav } from "@/components/sections/Nav";
import { ASK_OG_IMAGE } from "@/content/ask-card";
import { docsData } from "@/lib/docs/generated";
import { SITE } from "@/lib/site";
import { AskApp } from "./AskApp";
import { askConfig, askIsOpen } from "./config";

const TITLE = `Brief the agent · ${SITE.name}`;
const DESCRIPTION = "Send Maat's agent a public brief from your wallet on Base, and ask the live vault, for free, what it would answer to any intent.";

/** The build's deployments table and the owner's switch: /ask asks not to be indexed until it is open. */
const initial = askConfig(docsData.deployments);

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ask" },
  ...(askIsOpen(initial) ? {} : { robots: { index: false, follow: true } }),
  // Its own card (content/ask-card.ts), drawn at build time by app/og/ask.png/route.ts; the landing's image stays the landing's.
  openGraph: { type: "website", url: "/ask", siteName: SITE.name, title: TITLE, description: DESCRIPTION, locale: "en_US", images: [ASK_OG_IMAGE] },
  twitter: { card: "summary_large_image", site: SITE.xHandle, creator: SITE.xHandle, title: TITLE, description: DESCRIPTION, images: [ASK_OG_IMAGE] },
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
