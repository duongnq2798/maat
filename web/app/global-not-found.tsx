import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Mark } from "@/components/ui/Mark";
import { SITE, siteUrl } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: `Page not found · ${SITE.name}`,
  description: "This page does not exist.",
};

/** The way back: the landing, the ledger of every Decision, and the docs. */
const LINKS = [
  { href: "/", label: "Home", className: "pill-dark" },
  { href: "/ledger", label: "Ledger", className: "pill-line" },
  { href: SITE.docsUrl, label: "Docs", className: "pill-line" },
] as const;

/**
 * 404 for any URL no route matches, landing or docs. With two root layouts there is no shared layout to wrap a
 * not-found.tsx, so this page brings its own <html>: the landing's stylesheet and fonts, its white page and its mark,
 * one line, and the links back. It reads no chain and loads no script of its own.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <header className="wrap py-[18px]">
          <a href="/" aria-label="Maat home" className="inline-flex items-center gap-2.5 text-ink">
            <Mark />
            <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
          </a>
        </header>
        <main className="wrap pb-24 pt-16 sm:pt-24">
          <p className="eyebrow m-0">404 · Page not found</p>
          <h1 className="m-0 mt-4 text-[clamp(36px,4.4vw,60px)] font-semibold leading-[1.02] tracking-[-0.045em] text-ink">
            Nothing here to weigh.
          </h1>
          <p className="lead mt-5 max-w-[34rem]">No page lives at this address. Start from the landing, read every Decision on the ledger, or open the docs.</p>
          <ul aria-label="Pages" className="m-0 mt-8 flex list-none flex-wrap gap-3 p-0">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className={l.className}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </main>
      </body>
    </html>
  );
}
