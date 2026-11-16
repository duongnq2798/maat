// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenTree } from "fumadocs-core/page-tree";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { docsLinks, frontmatterOf, headingIds } from "@/lib/docs/content-checks";
import { AUDIENCES } from "@/lib/docs/frontmatter";
import { DOCS_IA, IA_SLUGS, type IaSection } from "@/lib/docs/ia";
import { docsSlug, headingId, urlSlug } from "@/lib/docs/links";
import { docsTree } from "@/lib/docs/remark-component-text";
import { DOCS_DIR, docsPages } from "./helpers/docs";

/** The pages written so far. Each content task (7 to 18) appends its slugs; Task 18b checks this is the whole IA. */
const SHIPPED: readonly string[] = [
  "index",
  "get-started/index",
  "concepts/index",
  "guides/index",
  "reference/index",
  "security/index",
  "help/index",
  "get-started/what-is-maat",
  "get-started/how-a-decision-is-made",
  "get-started/quickstart",
  "get-started/read-a-decision",
  "get-started/status",
  "concepts/mandate",
  "concepts/nine-checks",
  "concepts/refusal-codes",
  "concepts/market-hours",
  "concepts/prices-and-premium",
  "concepts/splits-and-multiplier",
  "concepts/credit-and-health-factor",
  "concepts/timelock-and-roles",
  "concepts/treasury-loop",
  "guides/run-the-tests",
  "guides/reproduce-the-fork-run",
  "guides/deploy-your-own-vault",
  "guides/configure-a-mandate",
  "guides/run-the-agent",
  "guides/change-a-rule",
  "guides/pause-withdraw-recover",
  "guides/watch-decisions-onchain",
  "reference/mandate-vault",
  "reference/events",
  "reference/errors",
  "reference/types",
  "reference/market-calendar",
  "reference/adapters",
  "reference/agent-configuration",
  "reference/agent-scripts",
  "reference/base-addresses",
  "reference/default-parameters",
  "security/model",
  "security/threat-model",
  "security/not-claimed",
  "security/testing",
  "security/report-a-vulnerability",
  "help/faq",
  "help/glossary",
  "help/troubleshooting",
  "help/changelog",
];

const written = docsPages().map((p) => p.slug);
const sourceOf = new Map(docsPages().map((p) => [p.slug, p.source]));
const meta = (dir: string) => JSON.parse(readFileSync(join(DOCS_DIR, dir, "meta.json"), "utf8")) as unknown;
const sections = DOCS_IA.filter((s) => s.dir !== "");
const iaPage = new Map(DOCS_IA.flatMap((s) => s.pages).map((p) => [p.slug, p]));

/** A section's own page, content/docs/<dir>/index.mdx: Fumadocs makes it the folder's index. */
const own = (s: IaSection) => `${s.dir}/index`;

/**
 * What meta.json lists for a section: its written pages in IA order, without its own page (Fumadocs finds index.mdx
 * itself, and listing it would make it a plain child, not the folder's link), each group's separator before its first
 * page, and each link to a page of another section after the page it follows.
 */
function metaPages(s: IaSection): string[] {
  return s.pages
    .filter((p) => p.slug !== own(s) && written.includes(p.slug))
    .flatMap((p) => {
      const group = s.groups?.find((g) => g.before === p.slug);
      const links = (s.links ?? []).filter((l) => l.after === p.slug).map((l) => `[${iaPage.get(l.slug)?.title}](/docs/${l.slug})`);
      return [...(group ? [`---${group.title}---`] : []), p.slug.slice(s.dir.length + 1), ...links];
    });
}

/** The page with its fenced code blanked, so a heading or a link inside a code block counts for nothing. */
const outsideFences = (source: string) => source.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, " "));

/** A heading line's level and the id Fumadocs gives it, or undefined for any other line. */
function heading(line: string): { level: number; id: string } | undefined {
  const m = /^(#{2,6})\s+(.+?)\s*#*\s*$/.exec(line);
  return m ? { level: m[1]?.length ?? 0, id: headingId((m[2] ?? "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")) } : undefined;
}

/** The ids of a page's H2 headings, in order. */
const h2Ids = (source: string) =>
  outsideFences(source)
    .split("\n")
    .flatMap((line) => (heading(line)?.level === 2 ? [heading(line)?.id ?? ""] : []));

/** The text under a page's Next steps or Related heading, up to the next heading at its level or above. */
function readingList(source: string): string {
  const out: string[] = [];
  let level: number | undefined;
  for (const line of outsideFences(source).split("\n")) {
    const h = heading(line);
    if (level !== undefined) {
      if (h && h.level <= level) break;
      out.push(line);
    } else if (h && (h.id === "next-steps" || h.id === "related")) level = h.level;
  }
  return out.join("\n");
}

/** The pages a page's frontmatter next names, by IA slug, that its Next steps or Related list does not link. */
function unlistedNext(source: string, next: readonly string[]): string[] {
  const linked = new Set(docsLinks(readingList(source)).map((href) => (docsSlug(href) ?? []).join("/")));
  return next.filter((slug) => !linked.has(urlSlug(slug).join("/")));
}

/** A page's frontmatter and its body, the text after the frontmatter. */
function split(slug: string): { fm: Record<string, unknown>; body: string } {
  const source = sourceOf.get(slug) ?? "";
  return { fm: (parse(frontmatterOf(source)) ?? {}) as Record<string, unknown>, body: source.replace(/^---\n[\s\S]*?\n---\n/, "") };
}

describe("docs pages follow the IA (docs spec §3)", () => {
  it("the IA has unique slugs and descriptions of 50 to 160 characters", () => {
    expect(new Set(IA_SLUGS).size).toBe(IA_SLUGS.length);
    const pages = DOCS_IA.flatMap((s) => s.pages);
    expect(pages.filter((p) => p.description.length < 50 || p.description.length > 160).map((p) => p.slug)).toEqual([]);
  });

  it("every shipped page is written", () => {
    expect(SHIPPED.filter((s) => !written.includes(s))).toEqual([]);
  });

  it("every written page is shipped and in the IA", () => {
    expect(written.filter((s) => !SHIPPED.includes(s))).toEqual([]);
    expect(SHIPPED.filter((s) => !IA_SLUGS.includes(s))).toEqual([]);
  });

  it("the whole IA has shipped", () => {
    expect([...SHIPPED].sort()).toEqual([...IA_SLUGS].sort());
  });

  it("each section's meta.json lists its written pages in IA order, under the IA's groups, with its links", () => {
    for (const s of sections) {
      const pages = metaPages(s);
      if (pages.length === 0) expect(existsSync(join(DOCS_DIR, s.dir)), `${s.dir}/ has no pages yet`).toBe(false);
      else expect(meta(s.dir), `${s.dir}/meta.json`).toEqual({ title: s.title, pages });
    }
  });

  it("a section's sidebar links only pages of other sections, after a page of its own", () => {
    for (const s of sections) {
      for (const l of s.links ?? []) {
        expect(iaPage.has(l.slug), `${s.dir} links ${l.slug}, which is not in the IA`).toBe(true);
        expect(l.slug.startsWith(`${s.dir}/`), `${s.dir} links its own page ${l.slug}`).toBe(false);
        expect(s.pages.some((p) => p.slug === l.after && p.slug !== own(s)), `${s.dir} links after ${l.after}`).toBe(true);
      }
      for (const g of s.groups ?? []) expect(s.pages.some((p) => p.slug === g.before && p.slug !== own(s)), `${s.dir} group ${g.title}`).toBe(true);
    }
  });

  it("each section starts with its own page, an overview titled like its sidebar group: one sentence, then its SectionIndex", () => {
    for (const s of sections) {
      expect(s.pages[0]?.slug, `${s.dir}'s first IA page`).toBe(own(s));
      expect(s.pages[0]?.title).toBe(s.title);
      const { fm, body } = split(own(s));
      expect({ type: fm.type, status: fm.status }, own(s)).toEqual({ type: "overview", status: "fork-tested" });
      const [sentence, rest] = body.replace(/^\n/, "").split("\n\n");
      expect(rest, `${own(s)}.mdx body`).toBe(`<SectionIndex section="${s.dir}" />\n`);
      // One sentence: a single full stop, at its end (the links in it carry none).
      expect(sentence?.match(/[.!?](?=\s|$)/g), `${own(s)}.mdx purpose line`).toEqual(["."]);
      expect(sentence?.endsWith(".")).toBe(true);
    }
  });

  it("a section's own page has no next, so no Next block: its cards already list the pages to read", () => {
    // The one exception to the Next block that spec §4.1 gives every page.
    for (const s of sections) expect(split(own(s)).fm.next, own(s)).toBeUndefined();
  });

  it("no page's first next page sends the reader straight back to it", () => {
    /** Each pair of pages whose first next pages name each other, once. */
    const bounces = (first: ReadonlyMap<string, string | undefined>) =>
      [...first].filter(([slug, to]) => to !== undefined && slug < to && first.get(to) === slug).map(([slug, to]) => `${slug} <-> ${to}`);
    expect(bounces(new Map([["a", "b"], ["b", "a"], ["c", "a"]]))).toEqual(["a <-> b"]);
    expect(bounces(new Map(written.map((slug) => [slug, (split(slug).fm.next as string[] | undefined)?.[0]])))).toEqual([]);
  });

  it("a page with its own Next steps or Related list links there every page its next names, as it shows no Read next", () => {
    // page.tsx skips NextLinks on such a page (listsNextInBody), so a next page missing from the list is linked nowhere.
    const fixture = "## Related\n\n- [A](/docs/concepts/a#x): a.\n- [C](/docs/concepts)\n\n## After\n\n[B](/docs/concepts/b)\n";
    expect(unlistedNext(fixture, ["concepts/a", "concepts/b", "concepts/index"])).toEqual(["concepts/b"]);
    const withList = written.filter((slug) => ["next-steps", "related"].some((id) => headingIds(sourceOf.get(slug) ?? "").has(id)));
    expect(withList.length).toBeGreaterThan(0);
    expect(
      withList.flatMap((slug) => unlistedNext(sourceOf.get(slug) ?? "", (split(slug).fm.next as string[] | undefined) ?? []).map((n) => `${slug}: ${n}`)),
    ).toEqual([]);
  });

  it("a page's own Next steps or Related list ends its body, where a Read next block would be (docs spec §4.2)", () => {
    const withList = written.filter((slug) => ["next-steps", "related"].some((id) => headingIds(sourceOf.get(slug) ?? "").has(id)));
    expect(withList.length).toBeGreaterThan(0);
    expect(withList.filter((slug) => !["next-steps", "related"].includes(h2Ids(sourceOf.get(slug) ?? "").at(-1) ?? ""))).toEqual([]);
  });

  it("a section's own page is written for every reader its pages are written for", () => {
    for (const s of sections) {
      const readers = new Set(s.pages.filter((p) => p.slug !== own(s)).flatMap((p) => split(p.slug).fm.audience as string[]));
      expect(split(own(s)).fm.audience, own(s)).toEqual(AUDIENCES.filter((a) => readers.has(a)));
    }
  });

  it("the docs home maps the sections with SectionIndex, after the decision diagram", () => {
    const { body } = split("index");
    expect(body).toContain("<DecisionLoop />\n\n## Explore by section\n\n<SectionIndex />\n\n");
  });

  it("Fumadocs makes each section's own page the folder's index, so its sidebar title and breadcrumb link to it", () => {
    const folders = docsTree(DOCS_DIR).children.flatMap((n) => (n.type === "folder" ? [n] : []));
    expect(folders.map((f) => ({ name: f.name, index: f.index?.url }))).toEqual(sections.map((s) => ({ name: s.title, index: `/docs/${s.dir}` })));
    // Not also a plain entry in the folder, as it becomes when meta.json lists "index".
    for (const f of folders) expect(f.children.filter((c) => c.type === "page" && c.url === f.index?.url)).toEqual([]);
  });

  it("every IA slug, as frontmatter next names a page, leads to that page's URL, a section's own page included", () => {
    // NextLinks looks a slug up by urlSlug: Fumadocs serves concepts/index.mdx at /docs/concepts, not /docs/concepts/index.
    const urls = flattenTree(docsTree(DOCS_DIR).children).map((p) => p.url);
    const url = (slug: string) => ["/docs", ...urlSlug(slug)].join("/");
    expect(IA_SLUGS.filter((slug) => !urls.includes(url(slug)))).toEqual([]);
    expect(url("concepts/index")).toBe("/docs/concepts");
    expect(url("index")).toBe("/docs");
  });

  it("the root meta.json lists the home page, then each section that has pages", () => {
    const dirs = sections.filter((s) => s.pages.some((p) => written.includes(p.slug))).map((s) => s.dir);
    expect(meta("")).toEqual({ title: DOCS_IA[0]?.title, pages: ["index", ...dirs] });
  });
});
