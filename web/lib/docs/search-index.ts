import { type StructuredData, structure } from "fumadocs-core/mdx-plugins/remark-structure";
import type { Node, Root } from "fumadocs-core/page-tree";
import { componentText } from "./component-text";
import { markdownLines } from "./markdown";

/**
 * The search records of one page, from its processed Markdown: the text behind /md/*.md, which holds what every
 * reference entry, table and diagram prints, so an address or a reason's meaning is found like prose. Code blocks are
 * left out, as in the default index, so a search for a word in a code sample finds nothing. So is every line in `omit`
 * outside a code block: on the docs home and the section pages, every line that any section index prints.
 *
 * The processed Markdown is written without heading ids (headingIds: false in source.config.ts), so each heading takes
 * its anchor from the page's table of contents, in order, rather than from a slug of its text.
 */
export function searchStructure(
  markdown: string,
  toc: readonly { url: string }[],
  page: string,
  omit: ReadonlySet<string> = new Set(),
): StructuredData {
  const prose = markdownLines(markdown)
    .filter((line) => !line.inFence && !omit.has(line.text))
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

/**
 * Every line a section index prints in the processed Markdown, a card or a group's name, for the docs home's map and
 * for each folder with its own page. A card repeats a page's title and description, which that page's own search
 * records already hold, so indexing it would list the section page a second time for the same words; a section page
 * is found by its title, its description and its purpose sentence.
 */
export function sectionIndexLines(tree: Root): ReadonlySet<string> {
  const sections = [""];
  const walk = (nodes: readonly Node[]) => {
    for (const node of nodes) {
      if (node.type !== "folder") continue;
      if (node.index) sections.push(node.index.url.replace(/^\/docs\/?/, ""));
      walk(node.children);
    }
  };
  walk(tree.children);
  const lines = sections.flatMap((section) => componentText("SectionIndex", { section }, { exists: () => true, tree: () => tree }).split("\n"));
  return new Set(lines.filter((line) => line !== ""));
}
