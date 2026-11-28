import { SITE } from "@/lib/site";
import { VaultBarStatus } from "./Vault";

/**
 * A phrase at its two lengths, both in the HTML: CSS shows `short` below sm and `long` from sm, so the bar is one row
 * on a phone with no JavaScript and no shift (PR #123 review, finding 37: the long line took three rows at 360 px).
 */
function Fit({ short, long }: { short: string; long: string }) {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="max-sm:hidden">{long}</span>
    </>
  );
}

/** The phone line's separator. From sm the items stand apart by their gap alone. */
function Dot() {
  return (
    <span aria-hidden="true" className="sm:hidden">
      ·
    </span>
  );
}

/**
 * The bar over the nav: the vault is live on Base mainnet, unaudited and kept small on purpose; from sm, once read, its
 * last Decision's age. Below sm it reads "Live on Base · Unaudited · Follow →", one row at 360 px.
 */
export function AnnouncementBar() {
  return (
    <div data-announcement-bar="" className="relative z-40 border-b border-line bg-surface-soft">
      <div className="wrap flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 py-2 text-[13px] text-ink-2 sm:gap-x-4 sm:py-2.5">
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <span aria-hidden="true" className="anim-live size-[7px] rounded-full bg-accent" />
          <Fit short="Live on Base" long="Live on Base mainnet" />
        </span>
        <Dot />
        <VaultBarStatus />
        <Fit short="Unaudited" long="Unaudited · small treasury on purpose" />
        <Dot />
        {/* One name at every width; it contains the phone's "Follow" (WCAG 2.5.3). */}
        <a href={SITE.xUrl} aria-label="Follow the build" className="tap font-medium">
          <Fit short="Follow →" long="Follow the build" />
        </a>
      </div>
    </div>
  );
}
