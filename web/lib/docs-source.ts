import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";
import { pageMarkdown } from "@/lib/docs/markdown";
import { siteUrl } from "@/lib/site";

/** The docs page tree and page lookup, built from content/docs by fumadocs-mdx. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

/** The page as Markdown with absolute links back to the site, for /md/*.md and llms-full.txt. */
export async function getPageMarkdown(page: DocsPage): Promise<string> {
  return pageMarkdown({
    title: page.data.title,
    url: new URL(page.url, siteUrl()).href,
    description: page.data.description,
    body: await page.data.getText("processed"),
  });
}

/** Whether a docs page exists, by slug ("concepts/nine-checks"; "" or "index" for the home page). */
export function pageExists(slug: string): boolean {
  const parts = slug === "index" ? [] : slug.split("/").filter(Boolean);
  return source.getPage(parts) !== undefined;
}
