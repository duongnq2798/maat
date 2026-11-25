import { NavBar, NavDock } from "@/components/live/NavDock";
import { Mark } from "@/components/ui/Mark";
import { ASK_OPEN } from "@/content/ask-open";
import { SITE } from "@/lib/site";

// Section anchors on the landing; "Ledger" is its own page, /ledger, the mainnet vault's every Decision. The Gap Index
// is linked from the problem section and the phone menu: one more link here would wrap the docked bar at 1280 px. Ask
// and Proof (below) join them with narrower links, which make that room.
const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#reasons", label: "Refusals" },
  { href: "#try", label: "Try it" },
  { href: "/ledger", label: "Ledger" },
  { href: "#mandate", label: "Mandate" },
] as const;

/** The phone menu (plan 2026-11-25 Move 4): the site's pages, which the section links above do not reach on a phone. */
const MENU = [
  { href: "/ledger", label: "Ledger" },
  { href: "/now", label: "Now" },
  { href: "/gap-index", label: "Gap Index" },
  { href: SITE.docsUrl, label: "Docs" },
] as const;

/**
 * Linked after Mandate in the bar and before Docs in the menu, only once the owner's switch has opened /ask. In the bar
 * they sit before the Menu's <details>, which is hidden from 721 px, so they still come just before Docs.
 */
const ASK_PAGES = [
  { href: "/ask", label: "Ask" },
  { href: "/proof", label: "Proof" },
] as const;

/**
 * The site's top bar, in NavBar: white, and pinned from lg. Off the landing (`onLanding={false}`), its section anchors
 * point back at the landing. On the landing it docks the page's live reading once the hero has scrolled away. Up to
 * 720 px the links give way to a Menu disclosure, a <details>, so it opens without JavaScript. `askOpen` is the owner's
 * switch, content/ask-open.ts: while it is off, the nav links neither /ask nor /proof.
 */
export function Nav({ onLanding = true, askOpen = ASK_OPEN }: { onLanding?: boolean; askOpen?: boolean }) {
  const to = (href: string) => (onLanding || !href.startsWith("#") ? href : `/${href}`);
  // While the switch is off, both lists are the constants above, so the page renders as it did before the switch.
  const bar = askOpen ? [...LINKS, ...ASK_PAGES] : LINKS;
  const menu = askOpen ? [...MENU.slice(0, -1), ...ASK_PAGES, ...MENU.slice(-1)] : MENU;
  // With the two more links, each bar link takes 10 px side padding, not 14, and the pill reads "GitHub", so the docked
  // reading, shown from 1280 px, still has its 340 px on the bar's one row.
  const linkClass = askOpen ? "navlink px-2.5 max-[720px]:hidden" : "navlink max-[720px]:hidden";
  return (
    <NavBar>
      <nav aria-label="Main" className="wrap flex flex-wrap items-center justify-between gap-3 py-[18px]">
        <a href={onLanding ? "#top" : "/"} aria-label="Maat home" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
        </a>
        <div className="flex flex-wrap items-center gap-1">
          {bar.map((l) => (
            <a key={l.href} href={to(l.href)} className={linkClass}>
              {l.label}
            </a>
          ))}
          <details data-phone-menu="" className="relative min-[721px]:hidden">
            <summary className="navlink flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden">
              Menu
              <span aria-hidden="true" className="text-[11px] text-ink-2">
                ▾
              </span>
            </summary>
            <ul
              aria-label="Pages"
              className="absolute left-0 top-full z-40 m-0 mt-2 flex w-48 list-none flex-col gap-0.5 rounded-[14px] border border-line bg-white p-1.5 shadow-[0_18px_40px_-18px_color-mix(in_srgb,var(--color-ink)_35%,transparent)]"
            >
              {menu.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className="block rounded-[10px] px-3 py-2.5 text-[15px] text-ink hover:bg-line-soft">
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          <a href={SITE.docsUrl} className={linkClass}>
            Docs
          </a>
          <a href={SITE.repoUrl} className="pill-dark ml-2 px-[18px] py-[11px]">
            {askOpen ? "GitHub" : "View on GitHub"}
            <span aria-hidden="true"> ↗</span>
          </a>
          {onLanding ? <NavDock /> : null}
        </div>
      </nav>
    </NavBar>
  );
}
