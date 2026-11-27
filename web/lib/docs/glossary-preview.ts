import { structure } from "fumadocs-core/mdx-plugins/remark-structure";

/** The glossary page. The docs link a term to its entry there on first use (spec §4.3). */
export const GLOSSARY_URL = "/docs/help/glossary";

/** The entry a link to the glossary points at (`/docs/help/glossary#b20` → "b20"), or null for any other link. */
export function glossaryId(href: string): string | null {
  if (!href.startsWith(`${GLOSSARY_URL}#`)) return null;
  const id = href.slice(GLOSSARY_URL.length + 1);
  return id === "" ? null : id;
}

/**
 * The entry without its last sentence when that sentence is a "See …" pointer to the page that explains the term: the
 * preview's link is the way on. A sentence after the pointer keeps it, and an entry that is only a pointer stays whole.
 */
function withoutPointer(entry: string): string {
  const last = [...entry.matchAll(/(?<=\.)\s+/g)].at(-1);
  if (last === undefined) return entry;
  return entry.slice(last.index + last[0].length).startsWith("See ") ? entry.slice(0, last.index) : entry;
}

/**
 * The preview of every glossary entry, by its anchor, from the glossary's processed Markdown (getText("processed")): the
 * whole entry, with its facts filled in, its links as their text and its code in backticks, less a trailing "See …"
 * pointer. It is never cut to its first sentence, since an entry often gives the term's status last: Builder Code's "the
 * owner registered Maat's code", CDP Server Wallet's "went through it that day". Each H3 is an entry; the
 * letters that group them, and the text above the first, hold no entry.
 */
export function glossaryPreviews(markdown: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string[]>();
  for (const { heading, content } of structure(markdown).contents) {
    if (heading === undefined) continue;
    entries.set(heading, [...(entries.get(heading) ?? []), content]);
  }
  return new Map([...entries].map(([id, parts]) => [id, withoutPointer(parts.join(" ").replace(/\s+/g, " "))]));
}

/** A preview as runs of plain text and inline code, for the page to draw: "a `b` c" → "a ", code "b", " c". */
export function previewRuns(preview: string): readonly { readonly code: boolean; readonly text: string }[] {
  return preview
    .split(/`([^`]+)`/)
    .map((text, i) => ({ code: i % 2 === 1, text }))
    .filter((run) => run.text !== "");
}
