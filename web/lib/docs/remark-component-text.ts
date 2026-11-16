import { frontmatter } from "fumadocs-core/content/md/frontmatter";
import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import type { Root } from "fumadocs-core/page-tree";
import { loader, type VirtualFile } from "fumadocs-core/source";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { componentText, isDataComponent, type Props } from "./component-text";
import type { MdNode } from "./remark-facts";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

type Replace = Parameters<typeof replaceSource>;
type PropValue = Props[string];

export interface ComponentTextOptions {
  /**
   * The docs MDX files, relative to the working directory like defineDocs' `dir`: a router card links a page only once it
   * exists here, and a section index lists the pages and meta.json files here.
   */
  docsDir?: string;
  /** Overrides the lookup of shipped pages, for tests. */
  exists?: (slug: string) => boolean;
}

/**
 * The page tree of the docs, built by Fumadocs' own loader from the frontmatter and meta.json files under docsDir: the
 * tree the sidebar shows, for the Markdown copies, which are written while the MDX compiles, before lib/docs-source.ts
 * has a tree to give. `onRead` gets the path of each file read.
 */
export function docsTree(docsDir: string, onRead?: (file: string) => void): Root {
  const files: VirtualFile[] = [];
  const read = (file: string) => {
    onRead?.(file);
    return readFileSync(file, "utf8");
  };
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, e.name);
      const path = relative(docsDir, file).split(sep).join("/");
      if (e.isDirectory()) walk(file);
      else if (e.name.endsWith(".mdx")) files.push({ type: "page", path, data: frontmatter(read(file)).data as VirtualFile["data"] });
      else if (e.name === "meta.json") files.push({ type: "meta", path, data: JSON.parse(read(file)) as VirtualFile["data"] });
    }
  };
  walk(docsDir);
  return loader({ baseUrl: "/docs", source: { files } }).getPageTree();
}

const isElement = (node: MdNode) => node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement";

/** The value of an attribute written as {expression}: a string, a boolean or a list of strings, read from the parsed JS. */
function literal(value: unknown): PropValue | undefined {
  const node = value as { type?: string; value?: unknown; elements?: unknown[]; expressions?: unknown[]; quasis?: { value: { cooked: string } }[] } | null;
  if (node?.type === "Literal" && (typeof node.value === "string" || typeof node.value === "boolean")) return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions?.length === 0) return node.quasis?.[0]?.value.cooked;
  if (node?.type === "ArrayExpression" && node.elements) {
    const items = node.elements.map(literal);
    if (items.every((i): i is string => typeof i === "string")) return items;
  }
  return undefined;
}

/** The literal attributes of a tag, or an error naming the file, the line and the attribute. */
function readProps(node: MdNode, where: string): Props {
  const props: Record<string, PropValue> = {};
  for (const a of node.attributes ?? []) {
    if (a.type !== "mdxJsxAttribute" || a.name === undefined) throw new Error(`${where}: <${node.name} /> takes plain attributes only, not {...spread}`);
    const v = a.value as { data?: { estree?: { body?: { type: string; expression?: unknown }[] } } } | string | null | undefined;
    if (v === null || v === undefined) props[a.name] = true;
    else if (typeof v === "string") props[a.name] = v;
    else {
      const statement = v.data?.estree?.body?.[0];
      const value = statement?.type === "ExpressionStatement" ? literal(statement.expression) : undefined;
      if (value === undefined) {
        throw new Error(`${where}: <${node.name} /> needs a literal value for ${a.name}, like ${a.name}="MandateVault"`);
      }
      props[a.name] = value;
    }
  }
  return props;
}

/**
 * Gives every data component (reference entries, tables, diagrams) its text in the Markdown copies of a page: the
 * processed Markdown behind /md/*.md and llms-full.txt. The tree is left as it is, so the HTML page still renders the
 * real component; only the Markdown of the tag's range is registered, with replaceSource, and the search index
 * keeps its own text for the tag. Runs after remarkFacts. An unknown name or a non-literal attribute fails the build.
 */
export function remarkComponentText(options: ComponentTextOptions = {}) {
  const docsDir = options.docsDir ?? "content/docs";
  const exists = options.exists ?? ((slug: string) => existsSync(join(docsDir, `${slug}.mdx`)) || existsSync(join(docsDir, slug, "index.mdx")));
  return (tree: MdNode, file: { path?: string; data?: { _compiler?: { addDependency?: (file: string) => void } } }) => {
    // Read when a section index asks for it, so a page without one reads no other file. Each file read is registered
    // with the bundler through fumadocs-mdx's compiler hook, as Fumadocs' remarkInclude registers an included file, so
    // in next dev a change to another page's title or description, or to a meta.json, recompiles this page's Markdown
    // (its /md copy, its llms-full.txt part and its search text) as well as its HTML.
    const compiler = file.data?._compiler;
    const pageTree = () => docsTree(docsDir, (read) => compiler?.addDependency?.(resolve(read)));
    const walk = (parent: MdNode) => {
      for (const node of parent.children ?? []) {
        if (!isElement(node) || !node.name || !isDataComponent(node.name)) {
          walk(node);
          continue;
        }
        const where = `${file.path ?? "<unknown file>"}${node.position ? `:${node.position.start.line}` : ""}`;
        let text: string;
        try {
          text = componentText(node.name, readProps(node, where), { exists, tree: pageTree });
        } catch (e) {
          const message = (e as Error).message;
          throw new Error(message.startsWith(where) ? message : `${where}: ${message}`);
        }
        // A block in the middle of a paragraph would break it; the HTML check says the same of a block element.
        if (node.type === "mdxJsxTextElement" && text.includes("\n")) {
          throw new Error(`${where}: <${node.name} /> prints several lines, so put it on a line of its own, with blank lines around it`);
        }
        replaceSource(file as Replace[0], node as Replace[1], text);
      }
    };
    walk(tree);
  };
}
