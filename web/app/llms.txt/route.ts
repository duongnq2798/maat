import { pagesInSidebarOrder } from "@/lib/docs-source";
import { llmsIndex } from "@/lib/docs/markdown";
import { SITE, siteUrl } from "@/lib/site";

// Exported once at build time to out/llms.txt: every docs page with its description, as absolute links.
export const revalidate = false;

export function GET() {
  const base = siteUrl();
  const pages = pagesInSidebarOrder().map((page) => ({
    title: page.data.title,
    url: new URL(page.url, base).href,
    description: page.data.description,
  }));
  const docs = { title: `${SITE.name} docs`, summary: SITE.description, fullUrl: new URL("/llms-full.txt", base).href };
  return new Response(llmsIndex(docs, pages), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
