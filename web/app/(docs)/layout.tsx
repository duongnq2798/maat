import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { DocsProvider } from "@/components/docs/DocsProvider";
import { SITE, siteUrl } from "@/lib/site";
import "./docs.css";

// The Geist files of the geist package, with font-display: optional. Its own exports (geist/font/*) use swap, so a
// font that arrived after the first paint moved the page (Lighthouse CLS up to 0.193 on a reference page). With
// optional, a font that is not ready in time is not swapped in on that page.
const geistSans = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "optional",
});

const geistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "optional",
  // As geist/font/mono: no metric-matched fallback, and these monospace faces in its place.
  adjustFontFallback: false,
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Roboto Mono",
    "Menlo",
    "Monaco",
    "Liberation Mono",
    "DejaVu Sans Mono",
    "Courier New",
    "monospace",
  ],
});

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `Docs · ${SITE.name}`, template: `%s · ${SITE.name} Docs` },
  description: SITE.description,
};

/** Root layout for /docs: its own <html>, stylesheet and providers, so nothing here reaches the landing page. */
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <DocsProvider>{children}</DocsProvider>
      </body>
    </html>
  );
}
