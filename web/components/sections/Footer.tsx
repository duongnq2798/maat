import { SITE } from "@/lib/site";

const LINKS = [
  { href: SITE.repoUrl, label: "Source on GitHub" },
  { href: SITE.evaluateUrl, label: "Verify in 5 minutes" },
  { href: SITE.forkEvidenceUrl, label: "Fork evidence" },
  { href: SITE.licenseUrl, label: "MIT License" },
  { href: SITE.xUrl, label: SITE.xHandle },
] as const;

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div aria-hidden="true" className="grid-bg absolute inset-0" />
      <div className="wrap relative flex flex-col gap-[72px] pb-12 pt-20 md:pt-32">
        <div className="flex flex-col items-center gap-7 text-center">
          <h2 className="m-0 text-[clamp(56px,8vw,120px)] font-semibold leading-[0.95] tracking-[-0.055em]">
            Watch it <span className="text-accent">say no.</span>
          </h2>
          <p className="lead max-w-[34em]">
            Mainnet goes live with a small treasury. The first weekend and Thanksgiving refusals will be posted as they
            happen.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a className="pill-dark" href={SITE.xUrl}>
              Follow {SITE.xHandle}
            </a>
            <a className="pill-line" href={SITE.repoUrl}>
              Read the code
              <span aria-hidden="true"> ↗</span>
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-line pt-6 text-[13px] text-ink-2">
          <ul aria-label="Project links" className="m-0 flex list-none flex-wrap gap-x-6 gap-y-2 p-0 font-medium">
            {LINKS.map((l) => (
              <li key={l.label}>
                <a href={l.href} className="text-ink hover:text-accent">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap justify-between gap-4">
            <p className="m-0">{SITE.disclaimer}</p>
            <p className="m-0 font-mono">{SITE.tagline}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
