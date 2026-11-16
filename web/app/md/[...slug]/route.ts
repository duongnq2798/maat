import { notFound } from "next/navigation";
import { getPageMarkdown, source } from "@/lib/docs-source";
import { markdownUrl, slugsFromMarkdownPath } from "@/lib/docs/markdown";

// One static .md file per docs page (out/md/docs/concepts/nine-checks.md), fetched by "Copy page as Markdown".
// A separate /md tree, because /docs/x.md would collide with the docs page route.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function GET(_req: Request, { params }: RouteContext<"/md/[...slug]">) {
  const { slug } = await params;
  const slugs = slugsFromMarkdownPath(slug);
  const page = slugs && source.getPage(slugs);
  if (!page) notFound();
  return new Response(await getPageMarkdown(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: markdownUrl(page.url).split("/").slice(2) }));
}
