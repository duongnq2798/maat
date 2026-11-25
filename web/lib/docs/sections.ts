import { flattenTree, type Folder, type Item, type Node, type Root } from "fumadocs-core/page-tree";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

// What a section index lists, read from the docs page tree: the same tree as the sidebar on the HTML page
// (source.getPageTree()), and the same builder over content/docs for the Markdown copies (docsTree in
// remark-component-text.ts). Nothing is listed by hand, so the cards cannot drift from the sidebar.

/** One card: a page with its frontmatter description, or a section of the docs home with its own page's. */
export interface SectionCard {
  readonly title: string;
  readonly url: string;
  readonly description?: string;
}

/** The cards under one sidebar separator ("---Contracts---" in meta.json); the cards before the first one have no name. */
export interface SectionGroup {
  readonly name?: string;
  readonly cards: readonly SectionCard[];
}

/** The URL of a folder's own page: /docs for the docs home, /docs/<section> for a section's index.mdx. */
export function sectionUrl(section: string): string {
  return section === "" ? "/docs" : `/docs/${section}`;
}

/** A tree label as text. The docs tree is built from frontmatter and meta.json, so every label is a string. */
function label(value: unknown, what: string): string {
  if (typeof value !== "string") throw new Error(`${what} has a name that is not plain text`);
  return value;
}

function findFolder(nodes: readonly Node[], url: string): Folder | undefined {
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    if (node.index?.url === url) return node;
    const inner = findFolder(node.children, url);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * The entries of one docs folder in sidebar order, grouped by its separators. A page is a card with its title and
 * description. A link item in meta.json ("[Refusal codes](/docs/concepts/refusal-codes)") carries no description of its
 * own, so it takes the description of the page it points at. A folder, as the sections are on the docs home, is a card
 * for its own index page. The folder's own page is left out. Section "" is the docs root, whose entries are the sections.
 */
export function sectionIndex(tree: Root, section: string): SectionGroup[] {
  const url = sectionUrl(section);
  const nodes = section === "" ? tree.children : findFolder(tree.children, url)?.children;
  if (!nodes) throw new Error(`no docs folder has its own page at ${url}: add content/docs/${section}/index.mdx`);

  const pages = flattenTree(tree.children);
  const describe = (to: string) => pages.find((p) => p.url === to && p.description !== undefined)?.description;
  const card = (page: Item, title: string): SectionCard => {
    const description = page.description ?? describe(page.url);
    return description === undefined ? { title, url: page.url } : { title, url: page.url, description: label(description, title) };
  };

  const groups: { name?: string; cards: SectionCard[] }[] = [{ cards: [] }];
  for (const node of nodes) {
    if (node.type === "separator") {
      groups.push(node.name === undefined ? { cards: [] } : { name: label(node.name, "a separator"), cards: [] });
    } else if (node.type === "folder") {
      const name = label(node.name, "a docs folder");
      if (!node.index) throw new Error(`the docs folder ${name} has no index.mdx, so it has no page to link`);
      groups.at(-1)!.cards.push(card(node.index, name));
    } else if (node.url !== url) {
      groups.at(-1)!.cards.push(card(node, label(node.name, node.url)));
    }
  }
  return groups.filter((g) => g.cards.length > 0);
}
