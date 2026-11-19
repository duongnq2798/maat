/**
 * The docs slug an internal link points at (`/docs/concepts/nine-checks#x` → ["concepts", "nine-checks"],
 * `/docs` → []), or null for any other link. The MDX link component uses it to render a link to a page
 * that has not shipped yet as plain text, so the exported site never has a dead docs link.
 */
export function docsSlug(href: string): string[] | null {
  const path = href.split(/[?#]/)[0] ?? "";
  if (path !== "/docs" && !path.startsWith("/docs/")) return null;
  return path.slice("/docs".length).split("/").filter(Boolean);
}

/**
 * The URL slug of a docs page from its IA slug, its path under content/docs: Fumadocs serves a folder's index.mdx at the
 * folder's URL ("concepts/index" → ["concepts"], "index" → []), and any other page at its path.
 */
export function urlSlug(slug: string): string[] {
  const parts = slug.split("/").filter(Boolean);
  return parts.at(-1) === "index" ? parts.slice(0, -1) : parts;
}

/** The id Fumadocs gives a heading (github-slugger rules, for the ASCII headings the docs use). */
export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/ /g, "-");
}
