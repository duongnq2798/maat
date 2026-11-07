/** Where the static Markdown copy of a docs page lives: /docs/concepts/x → /md/docs/concepts/x.md. */
export function markdownUrl(pageUrl: string): string {
  return `/md${pageUrl}.md`;
}

/** The docs slugs behind a /md/[...slug] path, or null when the path is not a docs page's Markdown file. */
export function slugsFromMarkdownPath(segments: readonly string[]): string[] | null {
  const path = segments.join("/");
  if (!path.endsWith(".md")) return null;
  const [root, ...slugs] = path.slice(0, -".md".length).split("/");
  return root === "docs" ? slugs : null;
}

/** Minutes to read, at 200 words a minute, never less than one. */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** A page as one Markdown document: title, absolute URL, description, then the body with facts filled in. */
export function pageMarkdown(page: { title: string; url: string; description?: string; body: string }): string {
  const parts = [`# ${page.title}`, `URL: ${page.url}`];
  if (page.description) parts.push(page.description);
  parts.push(page.body.trim());
  return `${parts.join("\n\n")}\n`;
}
