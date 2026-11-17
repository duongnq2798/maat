import { loader } from "fumadocs-core/source";
import { flattenTree } from "fumadocs-core/page-tree";
import { docs } from "@/.source/server";
import { headerFrame } from "@/lib/docs/frontmatter";
import { pageMarkdown } from "@/lib/docs/markdown";
import { siteUrl } from "@/lib/site";

/** The docs page tree and page lookup, built from content/docs by fumadocs-mdx. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

/** Every docs page in sidebar order, the order a reader pages through them. */
export function pagesInSidebarOrder(): DocsPage[] {
  return flattenTree(source.getPageTree().children).flatMap((item) => source.getNodePage(item) ?? []);
}

/**
 * The page as Markdown with absolute links back to the site, for /md/*.md and llms-full.txt. Its header line gives what
 * the page's header gives (headerFrame): the docs home shows no status label and no review date, and the Help pages
 * show the date without a label. check:out compares each copy with its exported page.
 */
export async function getPageMarkdown(page: DocsPage): Promise<string> {
  const frame = headerFrame(page);
  return pageMarkdown({
    title: page.data.title,
    url: new URL(page.url, siteUrl()).href,
    description: page.data.description,
    status: frame?.status,
    lastReviewed: frame?.lastReviewed,
    sources: page.data.sources,
    body: await page.data.getText("processed"),
  });
}

/** Whether a docs page exists, by slug ("concepts/nine-checks"; "" or "index" for the home page). */
export function pageExists(slug: string): boolean {
  const parts = slug === "index" ? [] : slug.split("/").filter(Boolean);
  return source.getPage(parts) !== undefined;
}
