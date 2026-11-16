import type { TOCItemType } from "fumadocs-core/toc";
import Link from "next/link";
import { source } from "@/lib/docs-source";
import { urlSlug } from "@/lib/docs/links";

/** Whether a page's body has its own reading list, a "Next steps" or "Related" section, and so needs no Read next block. */
export function listsNextInBody(toc: readonly TOCItemType[]): boolean {
  return toc.some((item) => item.url === "#next-steps" || item.url === "#related");
}

/**
 * The pages to read next, from frontmatter `next`, by IA slug ("concepts/index" is the Concepts page). A page that is in
 * the IA but not written yet is left out until it ships; test/docs-content.test.ts fails on a slug that is not in the IA at all.
 */
export function NextLinks({ slugs }: { slugs: readonly string[] }) {
  const pages = slugs.flatMap((slug) => source.getPage(urlSlug(slug)) ?? []);
  if (pages.length === 0) return null;
  return (
    <nav aria-labelledby="read-next" className="not-prose mt-10">
      <h2 id="read-next" className="text-sm font-semibold">
        Read next
      </h2>
      <ul className="mt-2 grid gap-2">
        {pages.map((page) => (
          <li key={page.url}>
            <Link
              href={page.url}
              className="flex min-h-11 flex-col rounded-lg border border-fd-border p-3 text-sm transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              <span className="font-medium">{page.data.title}</span>
              {page.data.description && <span className="text-fd-muted-foreground">{page.data.description}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
