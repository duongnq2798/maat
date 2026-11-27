import { ThumbBar } from "@/components/instrument/ThumbBar";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { AgentBuilders } from "@/components/sections/AgentBuilders";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Film } from "@/components/sections/Film";
import { Footer } from "@/components/sections/Footer";
import { Hero } from "@/components/sections/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Ledger } from "@/components/sections/Ledger";
import { Mandate } from "@/components/sections/Mandate";
import { Nav } from "@/components/sections/Nav";
import { Problem } from "@/components/sections/Problem";
import { Refusals } from "@/components/sections/Refusals";
import { TreasuryLoop } from "@/components/sections/TreasuryLoop";
import { TryIt } from "@/components/sections/TryIt";
import { VaultDecisionsProvider } from "@/components/sections/VaultDecisions";

// The landing reads Base twice, each once for the whole page. LiveSnapshotProvider reads the market (spec 2026-11-23
// section 3.8): the strip, its Pause key and the ThumbBar's lamp read it. VaultDecisionsProvider reads the mainnet
// vault's Decisions with /ledger's loader once the page has hydrated: the bar and the engine card read it.
export default function Page() {
  return (
    <LiveSnapshotProvider>
      <VaultDecisionsProvider>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <AnnouncementBar />
        <Nav />
        <main id="main" tabIndex={-1} className="outline-none">
          <Hero />
          <Film />
          <BuiltOn />
          <Problem />
          <HowItWorks />
          <Refusals />
          <TryIt />
          <Ledger />
          <Mandate />
          <TreasuryLoop />
          <AgentBuilders />
        </main>
        <Footer onLanding />
        <ThumbBar />
      </VaultDecisionsProvider>
    </LiveSnapshotProvider>
  );
}
