import { notFound } from "next/navigation";
import { renderDocsOg } from "@/brand/render";
import { getPageOgCard, source } from "@/lib/docs-source";
import { ogImageUrl, slugsFromOgPath } from "@/lib/docs/og";

// One static PNG per docs page (out/og/docs/concepts/nine-checks.png), drawn with satori when the site is built: the
// image a link to the page shows on X and other sites, with the page's section, title and status label as ogCard
// (lib/docs/og.ts) gives them, or the docs home's description. A separate /og tree, as /md is, because /docs/x.png
// would collide with the docs page route.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function GET(_req: Request, { params }: RouteContext<"/og/[...slug]">) {
  const { slug } = await params;
  const slugs = slugsFromOgPath(slug);
  const page = slugs && source.getPage(slugs);
  if (!page) notFound();
  return new Response(new Uint8Array(await renderDocsOg(getPageOgCard(page))), {
    headers: { "Content-Type": "image/png" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: ogImageUrl(page.url).split("/").slice(2) }));
}
