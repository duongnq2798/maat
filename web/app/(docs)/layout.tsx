import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { DocsProvider } from "@/components/docs/DocsProvider";
import { SITE, siteUrl } from "@/lib/site";
import "./docs.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `Docs · ${SITE.name}`, template: `%s · ${SITE.name} Docs` },
  description: SITE.description,
};

/** Root layout for /docs: its own <html>, stylesheet and providers, so nothing here reaches the landing page. */
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <DocsProvider>{children}</DocsProvider>
      </body>
    </html>
  );
}
