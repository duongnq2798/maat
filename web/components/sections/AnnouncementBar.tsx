import { SITE } from "@/lib/site";
import { VaultBarStatus } from "./Vault";

/** The bar over the nav: the vault is live on Base mainnet and unaudited; from sm, once read, its last Decision's age. */
export function AnnouncementBar() {
  return (
    <div className="border-b border-line bg-surface-soft">
      <div className="wrap flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 py-2 text-[13px] text-ink-2 sm:py-2.5">
        <span className="inline-flex items-center gap-2 font-medium text-ink">
          <span aria-hidden="true" className="anim-live size-[7px] rounded-full bg-accent" />
          Live on Base mainnet
        </span>
        <VaultBarStatus />
        <span>Unaudited.</span>
        <a href={SITE.xUrl} className="tap font-medium">
          Follow the build
        </a>
      </div>
    </div>
  );
}
