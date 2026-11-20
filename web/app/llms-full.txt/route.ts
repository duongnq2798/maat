import { commitMarkdown, currentBuildCommit } from "@/lib/build-info";
import { getPageMarkdown, pagesInSidebarOrder } from "@/lib/docs-source";

// Exported once at build time to out/llms-full.txt: the commit it was built from, then every docs page as Markdown, in
// sidebar order.
export const revalidate = false;

export async function GET() {
  const pages = await Promise.all(pagesInSidebarOrder().map(getPageMarkdown));
  const commit = currentBuildCommit();
  return new Response(`${commit ? `${commitMarkdown(commit)}\n\n` : ""}${pages.join("\n---\n\n")}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
