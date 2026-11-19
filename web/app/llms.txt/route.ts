import { pagesInSidebarOrder, source } from "@/lib/docs-source";
import { ABI_NAMES, ABI_NOTE, abiUrl } from "@/lib/docs/abi";
import { LLMS_STATUS, llmsIndex, markdownUrl } from "@/lib/docs/markdown";
import { SITE, siteUrl } from "@/lib/site";

// Exported once at build time to out/llms.txt: every docs page's Markdown copy with its description, then the ABIs, as
// absolute links.
export const revalidate = false;

export function GET() {
  const base = siteUrl();
  const pages = pagesInSidebarOrder().map((page) => ({
    title: page.data.title,
    url: new URL(page.url, base).href,
    description: page.data.description,
  }));
  // The docs center's own summary, the one its home page gives; SITE.description is the landing page's pitch.
  const home = source.getPage([]);
  if (!home?.data.description) throw new Error("the docs home (content/docs/index.mdx) has no description for llms.txt");
  const docs = {
    title: `${SITE.name} docs`,
    summary: home.data.description,
    // Like every other link in llms.txt, Details opens the page's Markdown copy, not its web page.
    status: `${LLMS_STATUS} Details: [Status and roadmap](${new URL(markdownUrl("/docs/get-started/status"), base).href}).`,
    fullUrl: new URL("/llms-full.txt", base).href,
  };
  const abis = ABI_NAMES.map((name) => ({ title: `${name} ABI`, url: new URL(abiUrl(name), base).href, description: ABI_NOTE }));
  return new Response(llmsIndex(docs, pages, abis), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
