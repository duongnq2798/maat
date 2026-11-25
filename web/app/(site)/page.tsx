import { ThumbBar } from "@/components/instrument/ThumbBar";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
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

// The landing runs exactly one read of Base (spec 2026-11-23 section 3.8): the provider's. The strip, HOLD and the
// ThumbBar's lamp read it.
export default function Page() {
  return (
    <LiveSnapshotProvider>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AnnouncementBar />
      <Nav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <BuiltOn />
        <Problem />
        <HowItWorks />
        <Refusals />
        <TryIt />
        <Ledger />
        <Mandate />
        <TreasuryLoop />
      </main>
      <Footer />
      <ThumbBar />
    </LiveSnapshotProvider>
  );
}
