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

/** The lines of a Markdown text, each with whether it is a fence line or inside a fenced code block (``` or ~~~). */
export function markdownLines(markdown: string): { text: string; inFence: boolean }[] {
  let fence: string | null = null;
  return markdown.split("\n").map((text) => {
    const marks = /^[\s>]*(`{3,}|~{3,})/.exec(text)?.[1];
    if (fence === null) {
      fence = marks ?? null;
      return { text, inFence: fence !== null };
    }
    // A fence closes on a line of the same mark, at least as long, with nothing after it.
    const closes = marks !== undefined && marks[0] === fence[0] && marks.length >= fence.length && /^[\s>]*(`+|~+)\s*$/.test(text);
    if (closes) fence = null;
    return { text, inFence: true };
  });
}

/** Links to the site's own pages (`](/docs/x)`, `](/md/docs/x.md)`) made absolute, outside code fences. */
function absoluteSiteLinks(markdown: string, origin: string): string {
  return markdownLines(markdown)
    .map(({ text, inFence }) => (inFence ? text : text.replace(/\]\((\/(?:docs|md))(?=[/#?)\s])/g, `](${origin}$1`)))
    .join("\n");
}

/**
 * A page as one Markdown document: title, absolute URL, description, then the body with facts filled in.
 * Links to the site's own pages in the body become absolute, so a copy read away from the site still leads back.
 */
export function pageMarkdown(page: { title: string; url: string; description?: string; body: string }): string {
  const parts = [`# ${page.title}`, `URL: ${page.url}`];
  if (page.description) parts.push(page.description);
  parts.push(absoluteSiteLinks(page.body.trim(), new URL(page.url).origin));
  return `${parts.join("\n\n")}\n`;
}

/** /llms.txt (llmstxt.org): the docs title and summary, where all of it is as one file, then every page as an absolute link. */
export function llmsIndex(
  docs: { title: string; summary: string; fullUrl: string },
  pages: readonly { title: string; url: string; description?: string }[],
): string {
  const lines = [`# ${docs.title}`, "", `> ${docs.summary}`, "", `Every page as one Markdown file: ${docs.fullUrl}`, "", "## Pages", ""];
  for (const p of pages) lines.push(`- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ""}`);
  return `${lines.join("\n")}\n`;
}
