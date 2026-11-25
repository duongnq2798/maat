import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import { relative, resolve, sep } from "node:path";
import { docsData } from "./generated";
import { headingId } from "./links";
import type { MdNode } from "./remark-facts";
import type { SolSurface } from "./sol-surface";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

type Replace = Parameters<typeof replaceSource>;

interface Node extends MdNode {
  depth?: number;
  url?: string;
  title?: string | null;
}

/** The reference pages that document the contracts: the only pages whose code names this plugin links. */
export const LINKED_PAGES = [
  "reference/mandate-vault",
  "reference/events",
  "reference/errors",
  "reference/types",
  "reference/market-calendar",
  "reference/adapters",
] as const;

/** The page that documents each contract's functions, and whether it heads each entry `name (Contract)`. */
const FUNCTION_PAGES: Readonly<Record<string, readonly [page: string, qualify: boolean]>> = {
  MandateVault: ["reference/mandate-vault", false],
  MarketCalendar: ["reference/market-calendar", false],
  ISwapAdapter: ["reference/adapters", true],
  AerodromeSwapAdapter: ["reference/adapters", true],
  ICreditAdapter: ["reference/adapters", true],
  AaveV4CreditAdapter: ["reference/adapters", true],
};

const href = (page: string, heading: string) => `/docs/${page}#${headingId(heading)}`;

/**
 * Where each name that a reference page writes in code links to, by the code's exact text, from contracts.json: a
 * function's entry (`execute`, or `tokens()` written as a call), an event's, an error's, a struct's or an enum's, and the
 * refusal code a Reason member names (OK has none). A name with more than one entry, such as `withdraw` or `NotOwner`,
 * links nowhere, so a link never guesses which one is meant. A name that is also a parameter or a field, such as
 * `mandate`, links only when written as a call.
 */
export function identifierTargets(surface: SolSurface): ReadonlyMap<string, string> {
  const found = new Map<string, Set<string>>();
  const add = (name: string, target: string) => found.set(name, (found.get(name) ?? new Set()).add(target));
  const errorCount = new Map<string, number>();
  for (const c of surface.contracts) for (const e of c.errors) errorCount.set(e.name, (errorCount.get(e.name) ?? 0) + 1);
  for (const c of surface.contracts) {
    const fnPage = FUNCTION_PAGES[c.name];
    if (c.functions.length > 0 && !fnPage) throw new Error(`${c.name} has functions but no reference page in FUNCTION_PAGES`);
    for (const f of c.functions) add(f.name, href(fnPage![0], fnPage![1] ? `${f.name} (${c.name})` : f.name));
    for (const e of c.events) add(e.name, href("reference/events", e.name));
    for (const e of c.errors) add(e.name, href("reference/errors", errorCount.get(e.name)! > 1 ? `${e.name} (${c.name})` : e.name));
  }
  for (const t of [...surface.structs, ...surface.enums]) add(t.name, href("reference/types", t.name));
  for (const r of surface.enums.find((e) => e.name === "Reason")?.members ?? []) if (r !== "OK") add(r, href("concepts/refusal-codes", r));

  const fields = new Set<string>();
  for (const c of surface.contracts) {
    for (const item of [...c.functions, ...c.events, ...c.errors]) for (const p of item.params) fields.add(p.name);
    for (const f of c.functions) for (const p of f.returns) fields.add(p.name);
  }
  for (const s of surface.structs) for (const f of s.fields) fields.add(f.name);
  const functions = new Set(surface.contracts.flatMap((c) => c.functions.map((f) => f.name)));

  const out = new Map<string, string>();
  for (const [name, targets] of found) {
    const [only] = targets;
    if (targets.size !== 1 || !only) continue;
    if (!fields.has(name)) out.set(name, only);
    if (functions.has(name)) out.set(`${name}()`, only);
  }
  return out;
}

const text = (node: Node): string => node.value ?? (node.children ?? []).map(text).join("");

/** The code written anywhere inside a node. */
const codes = (node: Node): string[] =>
  node.type === "inlineCode" ? (node.value ? [node.value] : []) : (node.children ?? []).flatMap((c) => codes(c as Node));

/**
 * Whether a node renders as a link: a Markdown link, a reference-style one (`[x][ref]`), or a JSX tag that is `<a>` or
 * has an `href`, such as a card. A link inside it would nest one anchor in another.
 */
const isLink = (node: Node) =>
  node.type === "link" ||
  node.type === "linkReference" ||
  ((node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") &&
    (node.name === "a" || (node.attributes ?? []).some((a) => a.type === "mdxJsxAttribute" && a.name === "href")));

export interface IdentifierLinkOptions {
  /** The docs MDX files, relative to the working directory like defineDocs' `dir`. */
  docsDir?: string;
}

/**
 * Links a contract name written in code on a reference page, such as `execute` or `NotExecutor`, to its entry: in the
 * HTML page and in the Markdown copies alike. Only the first mention in each H2 section links, and never one in a
 * heading, inside a link (isLink), or in the section of the entry it names. A link to the same page is its anchor
 * alone. The targets come from identifierTargets; test/remark-identifier-links.test.ts checks that each one is a
 * heading of its page. Runs after remarkTestAnchors.
 */
export function remarkIdentifierLinks(options: IdentifierLinkOptions = {}) {
  const docsDir = resolve(options.docsDir ?? "content/docs");
  let targets: ReadonlyMap<string, string> | undefined;
  return (tree: MdNode, file: { path?: string }) => {
    const slug = file.path ? relative(docsDir, resolve(file.path)).split(sep).join("/").replace(/\.mdx$/, "") : "";
    if (!(LINKED_PAGES as readonly string[]).includes(slug)) return;
    targets ??= identifierTargets(docsData.surface);
    const here = `/docs/${slug}#`;
    // The targets linked, or already linked by the page, in this H2 section; and the anchor of the entry it is in.
    let linked = new Set<string>();
    let entry: string | undefined;
    const walk = (parent: Node) => {
      const children = (parent.children ?? []) as Node[];
      for (let i = 0; i < children.length; i++) {
        const node = children[i]!;
        if (node.type === "heading") {
          if ((node.depth ?? 0) <= 2) {
            linked = new Set();
            entry = undefined;
          } else if (node.depth === 3) entry = `${here}${headingId(text(node))}`;
          continue;
        }
        if (isLink(node)) {
          for (const c of codes(node)) if (targets!.has(c)) linked.add(targets!.get(c)!);
          continue;
        }
        const target = node.type === "inlineCode" && node.value ? targets!.get(node.value) : undefined;
        if (target === undefined) {
          walk(node);
          continue;
        }
        if (linked.has(target) || target === entry) continue;
        linked.add(target);
        const url = target.startsWith(here) ? target.slice(here.length - 1) : target;
        const link: Node = { type: "link", url, title: null, children: [node], position: node.position };
        children[i] = link;
        // The Markdown copies are sliced from the authored source, which has the bare code.
        replaceSource(file as Replace[0], link as Replace[1], (s) => `[${s.inner(link as never)}](${url})`);
      }
    };
    walk(tree);
  };
}
