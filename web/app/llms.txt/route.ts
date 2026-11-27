import { ASK_SITE_PAGE, askConfig, askIsOpen } from "@/app/(site)/ask/config";
import { pagesInSidebarOrder, source } from "@/lib/docs-source";
import { ABI_NAMES, ABI_NOTE, abiUrl } from "@/lib/docs/abi";
import { docsData } from "@/lib/docs/generated";
import { LLMS_SITE_PAGES, LLMS_STATUS, llmsIndex, markdownUrl } from "@/lib/docs/markdown";
import { SITE, siteUrl } from "@/lib/site";

// Exported once at build time to out/llms.txt: the site's pages that show Maat on Base, every docs page's Markdown copy
// with its description, then the ABIs, as absolute links. /ask is listed only once it is open, as the nav links it.
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
  const open = askIsOpen(askConfig(docsData.deployments));
  const site = [...LLMS_SITE_PAGES, ...(open ? [ASK_SITE_PAGE] : [])].map((p) => ({
    title: p.title,
    url: new URL(p.path, base).href,
    description: p.description,
  }));
  const abis = ABI_NAMES.map((name) => ({ title: `${name} ABI`, url: new URL(abiUrl(name), base).href, description: ABI_NOTE }));
  return new Response(llmsIndex(docs, pages, abis, site), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
