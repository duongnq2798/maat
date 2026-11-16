import { getPageMarkdown, pagesInSidebarOrder } from "@/lib/docs-source";

// Exported once at build time to out/llms-full.txt: every docs page as Markdown, in sidebar order.
export const revalidate = false;

export async function GET() {
  const pages = await Promise.all(pagesInSidebarOrder().map(getPageMarkdown));
  return new Response(pages.join("\n---\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
