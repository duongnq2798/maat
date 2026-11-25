import { notFound } from "next/navigation";
import { commitMarkdown, currentBuildCommit } from "@/lib/build-info";
import { getPageMarkdown, source } from "@/lib/docs-source";
import { markdownUrl, slugsFromMarkdownPath, standaloneMarkdown } from "@/lib/docs/markdown";
import { siteUrl } from "@/lib/site";

// One static .md file per docs page (out/md/docs/concepts/nine-checks.md), fetched by "Copy page as Markdown".
// A separate /md tree, because /docs/x.md would collide with the docs page route. Each file opens with where llms.txt
// and llms-full.txt are, then the commit it was built from when the build knows it; llms-full.txt joins the same pages
// without that note.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function GET(_req: Request, { params }: RouteContext<"/md/[...slug]">) {
  const { slug } = await params;
  const slugs = slugsFromMarkdownPath(slug);
  const page = slugs && source.getPage(slugs);
  if (!page) notFound();
  const commit = currentBuildCommit();
  const built = commit ? commitMarkdown(commit) : undefined;
  return new Response(standaloneMarkdown(await getPageMarkdown(page), siteUrl(), built), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: markdownUrl(page.url).split("/").slice(2) }));
}
