// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  docsLinks,
  excerpts,
  factNames,
  foreignCharacters,
  frontmatterOf,
  handTypedFacts,
  headingIds,
  malformedExcerptTitles,
  repoPaths,
} from "@/lib/docs/content-checks";
import { FACT_TEXT_MAP, isFactName } from "@/lib/docs/fact-text";
import { docsFrontmatter } from "@/lib/docs/frontmatter";
import { DOCS_IA } from "@/lib/docs/ia";
import { docsSlug, headingId, urlSlug } from "@/lib/docs/links";
import { SITE } from "@/lib/site";
import { docsPages } from "./helpers/docs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// The content gates (docs spec §8, gates 1, 2, 5, 6 and the excerpt rule) over every page in content/docs.
// A failure names the file, the line and what is wrong: fix the page, not the gate.

const pages = docsPages();
const bySlug = new Map(pages.map((p) => [p.slug, p.source]));
const ia = new Map(DOCS_IA.flatMap((s) => s.pages).map((p) => [p.slug, p]));
const at = (slug: string, f: { line: number; text: string }) => `content/docs/${slug}.mdx:${f.line} ${f.text}`;

/**
 * The IA page a docs link opens, or undefined if it opens none. Fumadocs serves a folder's index.mdx at the folder's
 * URL: /docs/concepts is concepts/index, and /docs/concepts/index is no page at all.
 */
const byUrl = new Map([...ia.keys()].map((slug) => [urlSlug(slug).join("/"), slug]));
const linkedPage = (href: string) => byUrl.get((docsSlug(href) ?? []).join("/"));

describe("a docs link opens the IA page Fumadocs serves at its URL (gate 2)", () => {
  it.each([
    ["/docs", "index"],
    ["/docs/concepts", "concepts/index"],
    ["/docs/concepts#x", "concepts/index"],
    ["/docs/concepts/nine-checks#why-the-order-matters", "concepts/nine-checks"],
    ["/docs/concepts/index", undefined],
    ["/docs/index", undefined],
    ["/docs/concepts/not-a-page", undefined],
  ])("%s", (href, slug) => {
    expect(linkedPage(href)).toBe(slug);
  });
});

const FENCED = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;

/**
 * Every heading id on a page that an earlier heading already has (h2 to h6, outside fenced code), with its line.
 * headingIds() in lib/docs/content-checks.ts returns a set, so it cannot see a repeat; the site gives the second
 * heading a suffixed id, and a link to the plain one then lands on the first.
 */
function repeatedHeadingIds(source: string): { line: number; text: string }[] {
  const seen = new Set<string>();
  const out: { line: number; text: string }[] = [];
  source
    .replace(FENCED, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .forEach((line, i) => {
      const text = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
      if (text === undefined) return;
      const id = headingId(text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"));
      if (seen.has(id)) out.push({ line: i + 1, text: `#${id} is already the id of an earlier heading` });
      seen.add(id);
    });
  return out;
}

describe.each(pages.map((p) => [p.slug, p.source] as const))("content/docs/%s.mdx", (slug, source) => {
  // A page whose frontmatter cannot be parsed must fail its own test, not abort the collection of every page.
  let fm: Record<string, unknown> = {};
  let yamlError: string | undefined;
  try {
    fm = (parse(frontmatterOf(source)) ?? {}) as Record<string, unknown>;
  } catch (e) {
    yamlError = `content/docs/${slug}.mdx frontmatter: ${e instanceof Error ? e.message : String(e)}`;
  }

  it("has valid frontmatter with the IA's title and description (gate 1)", () => {
    expect(yamlError).toBeUndefined();
    const r = docsFrontmatter.safeParse(fm);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    const want = ia.get(slug);
    expect(want, `${slug} is not in lib/docs/ia.ts`).toBeDefined();
    expect({ title: fm.title, description: fm.description }).toEqual({ title: want?.title, description: want?.description });
  });

  it("cites sources that exist and next pages in the IA (gate 1)", () => {
    const sources = (fm.sources ?? []) as string[];
    expect(sources.filter((s) => !existsSync(join(REPO_ROOT, s)))).toEqual([]);
    const next = (fm.next ?? []) as string[];
    expect(next.filter((n) => !ia.has(n))).toEqual([]);
  });

  it("is plain English (gate 6)", () => {
    expect(foreignCharacters(source).map((f) => at(slug, f))).toEqual([]);
  });

  it("renders numbers with <Fact> and only known names (gate 5)", () => {
    expect(handTypedFacts(source, FACT_TEXT_MAP).map((f) => at(slug, f))).toEqual([]);
    expect(factNames(source).filter((f) => !isFactName(f.text)).map((f) => at(slug, f))).toEqual([]);
  });

  it("links to IA pages, to headings that exist, and to repo paths that exist (gate 2)", () => {
    const bad: string[] = [];
    for (const href of docsLinks(source)) {
      const target = linkedPage(href);
      const hash = href.split("#")[1];
      const page = target === undefined ? undefined : bySlug.get(target);
      if (target === undefined) bad.push(`${href}: not a page in lib/docs/ia.ts`);
      // A page in the IA that is not written yet passes; its anchors are checked once it ships.
      else if (hash && page !== undefined && !headingIds(page).has(hash)) bad.push(`${href}: no heading #${hash} on ${target}`);
    }
    for (const p of repoPaths(source, SITE.repoUrl)) if (!existsSync(join(REPO_ROOT, p))) bad.push(`${p}: not in the repo`);
    expect(bad).toEqual([]);
  });

  it("gives every heading its own id (anchor gate)", () => {
    expect(repeatedHeadingIds(source).map((f) => at(slug, f))).toEqual([]);
  });

  it("quotes code exactly (excerpt gate)", () => {
    expect(malformedExcerptTitles(source).map((f) => at(slug, f))).toEqual([]);
    for (const e of excerpts(source)) {
      const lines = readRepo(e.file).replace(/\r\n/g, "\n").split("\n").slice(e.from - 1, e.to).join("\n");
      expect(e.body, `content/docs/${slug}.mdx:${e.line} ${e.file}#L${e.from}-L${e.to}`).toBe(lines);
    }
  });
});
