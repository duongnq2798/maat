import { type StructuredData, structure } from "fumadocs-core/mdx-plugins/remark-structure";
import { markdownLines } from "./markdown";

/**
 * The search records of one page, from its processed Markdown: the text behind /md/*.md, which holds what every
 * reference entry, table and diagram prints, so an address or a reason's meaning is found like prose. Code blocks are
 * left out, as in the default index, so a search for a word in a code sample finds nothing.
 *
 * The processed Markdown is written without heading ids (headingIds: false in source.config.ts), so each heading takes
 * its anchor from the page's table of contents, in order, rather than from a slug of its text.
 */
export function searchStructure(markdown: string, toc: readonly { url: string }[], page: string): StructuredData {
  const prose = markdownLines(markdown)
    .filter((line) => !line.inFence)
    .map((line) => line.text)
    .join("\n");
  const data = structure(prose);
  if (data.headings.length !== toc.length) {
    throw new Error(`${page}: the processed Markdown has ${data.headings.length} headings and the table of contents ${toc.length}`);
  }
  const anchors = new Map(data.headings.map((h, i) => [h.id, toc[i]!.url.replace(/^#/, "")]));
  return {
    headings: data.headings.map((h) => ({ ...h, id: anchors.get(h.id)! })),
    contents: data.contents.map((c) => ({ ...c, heading: c.heading === undefined ? undefined : anchors.get(c.heading) })),
  };
}
