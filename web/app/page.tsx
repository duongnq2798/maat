import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Hero } from "@/components/sections/Hero";
import { Nav } from "@/components/sections/Nav";

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
      </main>
    </>
  );
}
