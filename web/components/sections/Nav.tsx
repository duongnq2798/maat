import { Mark } from "@/components/ui/Mark";
import { SITE } from "@/lib/site";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#reasons", label: "Refusals" },
  { href: "#ledger", label: "Ledger" },
  { href: "#mandate", label: "Mandate" },
] as const;

export function Nav() {
  return (
    <nav aria-label="Main" className="wrap flex flex-wrap items-center justify-between gap-3 py-[18px]">
      <a href="#top" aria-label="Maat home" className="flex items-center gap-2.5 text-ink">
        <Mark />
        <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
      </a>
      <div className="flex flex-wrap items-center gap-1">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className="navlink max-[720px]:hidden">
            {l.label}
          </a>
        ))}
        <a href={SITE.repoUrl} className="pill-dark ml-2 px-[18px] py-[11px]">
          View on GitHub
          <span aria-hidden="true"> ↗</span>
        </a>
      </div>
    </nav>
  );
}
