import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import { factFor } from "./fact-text";

interface Point {
  line: number;
  column: number;
  offset?: number;
}

/** The parts of an mdast node this plugin reads; structural, so it needs no mdast types. */
export interface MdNode {
  type: string;
  name?: string | null;
  value?: string;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: MdNode[];
  position?: { start: Point; end: Point };
}

type Replace = Parameters<typeof replaceSource>;

function isFact(node: MdNode): boolean {
  return (node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") && node.name === "Fact";
}

/** The text for one <Fact />, or an error naming the file, the line and the bad name. */
function factText(node: MdNode, path: string | undefined): string {
  const where = `${path ?? "<unknown file>"}${node.position ? `:${node.position.start.line}` : ""}`;
  const name = node.attributes?.find((a) => a.type === "mdxJsxAttribute" && a.name === "name")?.value;
  if (typeof name !== "string") throw new Error(`${where}: <Fact /> needs a literal name, like <Fact name="checksPerTrade" />`);
  try {
    return factFor(name).text;
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
}

/**
 * Replaces every <Fact name="x" /> with the text of FACT_TEXT[x]. It runs before Fumadocs' own plugins, so the page,
 * the search index and the processed Markdown all carry the value. An unknown name fails the build.
 */
export function remarkFacts() {
  return (tree: MdNode, file: { path?: string }) => {
    const walk = (parent: MdNode) => {
      const children = parent.children ?? [];
      for (let i = 0; i < children.length; i++) {
        const node = children[i]!;
        if (!isFact(node)) {
          walk(node);
          continue;
        }
        const text: MdNode = { type: "text", value: factText(node, file.path), position: node.position };
        // A <Fact /> alone on its line parses as a block; a paragraph keeps the tree valid there.
        const next: MdNode = node.type === "mdxJsxFlowElement" ? { type: "paragraph", children: [text], position: node.position } : text;
        children[i] = next;
        // Search records and processed Markdown are sliced from the authored source, which still says <Fact .../>.
        // Registering the text for the tag's range is what makes them print the value.
        replaceSource(file as Replace[0], next as Replace[1], text.value!);
      }
    };
    walk(tree);
  };
}
