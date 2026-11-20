import { Mark } from "@/components/ui/Mark";
import { SITE } from "@/lib/site";

// Section anchors on the landing; "Ledger" is its own page, /ledger, with the fork run and the mainnet vault.
const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#reasons", label: "Refusals" },
  { href: "#try", label: "Try it" },
  { href: "/ledger", label: "Ledger" },
  { href: "#mandate", label: "Mandate" },
] as const;

/** The site's top bar. Off the landing (`onLanding={false}`), its section anchors point back at the landing. */
export function Nav({ onLanding = true }: { onLanding?: boolean }) {
  const to = (href: string) => (onLanding || !href.startsWith("#") ? href : `/${href}`);
  return (
    <nav aria-label="Main" className="wrap flex flex-wrap items-center justify-between gap-3 py-[18px]">
      <a href={onLanding ? "#top" : "/"} aria-label="Maat home" className="flex items-center gap-2.5 text-ink">
        <Mark />
        <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
      </a>
      <div className="flex flex-wrap items-center gap-1">
        {LINKS.map((l) => (
          <a key={l.href} href={to(l.href)} className="navlink max-[720px]:hidden">
            {l.label}
          </a>
        ))}
        <a href={SITE.docsUrl} className="navlink">
          Docs
        </a>
        <a href={SITE.repoUrl} className="pill-dark ml-2 px-[18px] py-[11px]">
          View on GitHub
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>
    </nav>
  );
}
