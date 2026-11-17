import { SITE } from "../site";
import { type DocStatus, STATUS_LABEL, STATUS_MEANING } from "./frontmatter";

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

/**
 * Root-relative links (`](/docs/x)`, `](/)`, `](/#ledger)`, `href="/llms.txt"`) and links to a heading on the same page
 * (`](#x)`) made absolute, outside code fences. Read away from the site, a root-relative link points at no page, and a
 * bare `](#x)` points at no page once the pages are joined into llms-full.txt. `//host` links name their own host.
 */
function absoluteSiteLinks(markdown: string, pageUrl: string): string {
  const origin = new URL(pageUrl).origin;
  return markdownLines(markdown)
    .map(({ text, inFence }) =>
      inFence
        ? text
        : text
            .replace(/\]\(\/(?!\/)/g, `](${origin}/`)
            .replace(/(\shref=["'])\/(?!\/)/g, `$1${origin}/`)
            .replace(/\]\(#/g, `](${pageUrl}#`),
    )
    .join("\n");
}

/** The sentence above the files of the Source of truth box (components/docs/SourceOfTruth.tsx) and of each Markdown copy. */
export const SOURCES_LEAD = "This page is checked against these files. If they disagree, the files win.";

/**
 * A page as one Markdown document: title, absolute URL, the status label and review date its header shows, the
 * description, the body with facts filled in, then its Source of truth files. Links to the site's own pages in the body
 * become absolute, so a copy read away from the site still leads back. `status` and `lastReviewed` are left out where
 * the page's header shows none (lib/docs-source.ts), so a copy claims no more than its page.
 */
export function pageMarkdown(page: {
  title: string;
  url: string;
  description?: string;
  status?: DocStatus;
  /** ISO date, YYYY-MM-DD. */
  lastReviewed?: string;
  /** Repo paths, linked on main as the Source of truth box links them. */
  sources?: readonly string[];
  body: string;
}): string {
  const parts = [`# ${page.title}`, `URL: ${page.url}`];
  const frame = [
    page.status && `Status: ${STATUS_LABEL[page.status]}. ${STATUS_MEANING[page.status]}`,
    page.lastReviewed && `Last reviewed: ${page.lastReviewed}.`,
  ].filter(Boolean);
  if (frame.length > 0) parts.push(frame.join(" "));
  if (page.description) parts.push(page.description);
  parts.push(absoluteSiteLinks(page.body.trim(), page.url));
  if (page.sources && page.sources.length > 0) {
    parts.push("## Source of truth", SOURCES_LEAD, page.sources.map((path) => `- [\`${path}\`](${SITE.repoUrl}/blob/main/${path})`).join("\n"));
  }
  return `${parts.join("\n\n")}\n`;
}

/**
 * What exists today, the status line llms.txt gives under its summary, in the words of the docs home's "Today" paragraph
 * (content/docs/index.mdx). test/docs-page.test.tsx checks each of its clauses against that paragraph.
 */
export const LLMS_STATUS =
  "built and fork-tested. Nothing is deployed to Base mainnet, the contracts are unaudited, and the real Claude API and CDP wallet have not run in any Maat test.";

/** The line that opens each page's own Markdown file: where the index and the other pages are. */
export const INDEX_NOTE_START = "> Index of every page: ";

/**
 * A page's own .md file: its Markdown under a note that says where llms.txt and llms-full.txt are, so a reader that lands
 * on one page can find the rest, then, when the build knows its commit, the "Built from commit" line the page's footer
 * and Source of truth box show (`built`). llms-full.txt joins the pages without the note, since it is the rest.
 */
export function standaloneMarkdown(markdown: string, base: URL, built?: string): string {
  const llms = new URL("/llms.txt", base).href;
  const full = new URL("/llms-full.txt", base).href;
  const note = `${INDEX_NOTE_START}[llms.txt](${llms}). All pages in one file: [llms-full.txt](${full}).`;
  return `${note}\n\n${built ? `${built}\n\n` : ""}${markdown}`;
}

/**
 * /llms.txt (llmstxt.org): the docs title, summary and status, where all of it is as one file, then every page as an
 * absolute link to its Markdown copy, with its web page after the description, then the other files for tools.
 */
export function llmsIndex(
  docs: { title: string; summary: string; status: string; fullUrl: string },
  pages: readonly { title: string; url: string; description?: string }[],
  abis: readonly { title: string; url: string; description: string }[],
): string {
  const lines = [`# ${docs.title}`, "", `> ${docs.summary}`, "", `Status: ${docs.status}`, "", `Every page as one Markdown file: ${docs.fullUrl}`, "", "## Pages", ""];
  for (const p of pages) {
    const md = new URL(markdownUrl(new URL(p.url).pathname), p.url).href;
    lines.push(`- [${p.title}](${md}): ${p.description ? `${p.description} ` : ""}Web page: ${p.url}`);
  }
  lines.push("", "## Contract ABIs", "");
  for (const a of abis) lines.push(`- [${a.title}](${a.url}): ${a.description}`);
  return `${lines.join("\n")}\n`;
}
