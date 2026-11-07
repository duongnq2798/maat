import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Hero } from "@/components/sections/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Nav } from "@/components/sections/Nav";
import { Problem } from "@/components/sections/Problem";

export default function Page() {
  return (
    <>
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
      </main>
    </>
  );
}
