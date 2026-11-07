import { SITE } from "@/lib/site";

export function AnnouncementBar() {
  return (
    <div className="border-b border-line bg-surface-soft">
      <div className="wrap flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 py-2 text-[13px] text-ink-2 sm:py-2.5">
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <span aria-hidden="true" className="anim-live size-[7px] rounded-full bg-accent" />
          Tested on a Base mainnet fork
        </span>
        {/* Phones get the short form, so the bar stays on one line and the hero starts higher. */}
        <span className="max-sm:hidden">Mainnet launch is next. Every decision below was recorded on that fork.</span>
        <span className="sm:hidden">Mainnet is next.</span>
        <a href={SITE.xUrl} className="font-medium">
          Follow the build
        </a>
      </div>
    </div>
  );
}
