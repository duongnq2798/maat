import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import Link from "next/link";
import { DocsProvider } from "@/components/docs/DocsProvider";
import { source } from "@/lib/docs-source";
import { SITE, siteUrl } from "@/lib/site";
import "./(docs)/docs.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: `Page not found · ${SITE.name}`,
  description: "This page does not exist.",
};

/** Each top-level docs section with the URL of its first page, in sidebar order. */
function sections() {
  return source.getPageTree().children.flatMap((node) => {
    if (node.type === "page") return [{ name: node.name, url: node.url }];
    if (node.type !== "folder") return [];
    const first = node.index ?? node.children.find((child) => child.type === "page");
    return first && first.type === "page" ? [{ name: node.name, url: first.url }] : [];
  });
}

/**
 * 404 for any URL no route matches, landing or docs. With two root layouts there is no shared layout to wrap a
 * not-found.tsx, so this page brings the docs stylesheet and providers itself (search needs them).
 */
export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <DocsProvider>
          <main className="mx-auto w-full max-w-xl px-4 py-24">
            <p className="font-mono text-sm text-fd-muted-foreground">404</p>
            <h1 className="mt-2 text-3xl font-semibold">This page does not exist.</h1>
            <p className="mt-4 text-fd-muted-foreground">Search the docs, or start from a section.</p>
            <FullSearchTrigger className="mt-6 min-h-11 w-full" />
            <h2 className="mt-10 text-sm font-semibold">Docs sections</h2>
            <ul className="mt-2 grid gap-1">
              {sections().map((s) => (
                <li key={s.url}>
                  <Link href={s.url} className="inline-flex min-h-11 items-center text-fd-primary underline-offset-4 hover:underline">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-10 text-sm">
              <Link href="/" className="inline-flex min-h-11 items-center text-fd-muted-foreground hover:text-fd-foreground">
                Back to the home page
              </Link>
            </p>
          </main>
        </DocsProvider>
      </body>
    </html>
  );
}
