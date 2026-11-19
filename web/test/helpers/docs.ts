import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { REPO_ROOT } from "./solidity";

export const DOCS_DIR = join(REPO_ROOT, "web/content/docs");

export interface DocsPage {
  /** Path under content/docs without .mdx, with forward slashes: "concepts/nine-checks". */
  readonly slug: string;
  /** The MDX source with LF line endings, whatever the checkout uses. */
  readonly source: string;
}

/** Every .mdx page under content/docs, sorted by slug. */
export function docsPages(dir = DOCS_DIR): DocsPage[] {
  const out: DocsPage[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".mdx")) {
        const slug = relative(dir, p).split(sep).join("/").replace(/\.mdx$/, "");
        out.push({ slug, source: readFileSync(p, "utf8").replace(/\r\n/g, "\n") });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
