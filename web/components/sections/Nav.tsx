import type { ReactNode } from "react";
import { NavBar, NavDock } from "@/components/live/NavDock";
import { Mark } from "@/components/ui/Mark";
import { ASK_OPEN } from "@/content/ask-open";
import { SITE } from "@/lib/site";

/**
 * Pages first (spec 2026-11-23 section 2, decision 3): the bar and the phone menu list the same pages, and none of the
 * landing's sections. /now and /gap-index are the pages that change from one visit to the next; /ledger is the mainnet
 * vault's every Decision.
 */
const PAGES = [
  { href: "/now", label: "Now" },
  { href: "/gap-index", label: "Gap Index" },
  { href: "/ledger", label: "Ledger" },
] as const;

/** Linked after Ledger, in the bar and in the menu, only once the owner's switch has opened /ask. */
const ASK_PAGES = [
  { href: "/ask", label: "Ask" },
  { href: "/proof", label: "Proof" },
] as const;

const DOCS = { href: SITE.docsUrl, label: "Docs" } as const;

/**
 * The site's top bar, in NavBar: white, and pinned from lg. On the landing (`onLanding`) the home link goes to the top
 * of the page and the bar docks the page's live reading once the hero has scrolled away; elsewhere the home link goes
 * to the landing. Up to 720 px the links give way to a Menu disclosure, a <details>, so it opens without JavaScript; it
 * lists the same pages. `askOpen` is the owner's switch, content/ask-open.ts: while it is off, the nav links neither
 * /ask nor /proof. `plate` goes before the first link: /gap-index, which reads no chain, puts its unlit docked plate there.
 */
export function Nav({ onLanding = true, askOpen = ASK_OPEN, plate }: { onLanding?: boolean; askOpen?: boolean; plate?: ReactNode }) {
  const pages = [...PAGES, ...(askOpen ? ASK_PAGES : []), DOCS];
  return (
    <NavBar>
      <nav aria-label="Main" className="wrap flex flex-wrap items-center justify-between gap-3 py-[18px]">
        <a href={onLanding ? "#top" : "/"} aria-label="Maat home" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
        </a>
        <div className="flex flex-wrap items-center gap-1">
          {plate}
          {pages.map((l) => (
            <a key={l.href} href={l.href} className="navlink max-[720px]:hidden">
              {l.label}
            </a>
          ))}
          <details data-phone-menu="" className="relative min-[721px]:hidden">
            <summary className="navlink flex min-h-11 cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
              Menu
              <span aria-hidden="true" className="text-[11px] text-ink-2">
                ▾
              </span>
            </summary>
            <ul
              aria-label="Pages"
              className="absolute left-0 top-full z-40 m-0 mt-2 flex w-48 list-none flex-col gap-0.5 rounded-[14px] border border-line bg-white p-1.5 shadow-[0_18px_40px_-18px_color-mix(in_srgb,var(--color-ink)_35%,transparent)]"
            >
              {pages.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="flex min-h-11 items-center rounded-[10px] px-3 py-2.5 text-[15px] text-ink hover:bg-line-soft">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <a href={SITE.repoUrl} className="pill-dark ml-2 px-[18px] py-[11px]">
            View on GitHub
            <span aria-hidden="true"> ↗</span>
          </a>
          {onLanding ? <NavDock /> : null}
        </div>
      </nav>
    </NavBar>
  );
}
