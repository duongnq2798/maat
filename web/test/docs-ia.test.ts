// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { frontmatterOf } from "@/lib/docs/content-checks";
import { AUDIENCES } from "@/lib/docs/frontmatter";
import { DOCS_IA, IA_SLUGS, type IaSection } from "@/lib/docs/ia";
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

  it("the root meta.json lists the home page, then each section that has pages", () => {
    const dirs = sections.filter((s) => s.pages.some((p) => written.includes(p.slug))).map((s) => s.dir);
    expect(meta("")).toEqual({ title: DOCS_IA[0]?.title, pages: ["index", ...dirs] });
  });
});
