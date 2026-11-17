// @vitest-environment node
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pageSchema } from "fumadocs-core/source/schema";
import { describe, expect, it } from "vitest";
import { AUDIENCES, DOC_TYPES, docsFrontmatter, STATUSES } from "@/lib/docs/frontmatter";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// web/README.md tells a maintainer the rules the docs tests enforce, and the root README's Documentation table points
// at it. These tests hold both to the code they describe, so a rule cannot change in one place only.

const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const webReadme = lf("web/README.md");
const rootReadme = lf("README.md");

/** The lines under the heading line `heading` ("## Docs content"), up to the next heading of its level or above. */
function under(md: string, heading: string): string {
  const level = /^#+/.exec(heading)?.[0].length ?? 0;
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `));
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && (/^#+ /.exec(l)?.[0].length ?? Infinity) - 1 <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** The body rows of the first table in `text`, each as its trimmed cells. */
function tableRows(text: string): string[][] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("|"));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && !l.startsWith("|"));
  // The header row and the separator under it.
  return lines.slice(start + 2, end < 0 ? undefined : end).map((l) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim()));
}

/** The inline code spans in `text`. */
const codes = (text: string) => [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");

/** GitHub's id for a heading: lowercase, punctuation dropped, spaces to hyphens. */
const githubId = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, "")
    .replace(/ /g, "-");
const headingIds = (md: string) => md.split("\n").flatMap((l) => (/^#{1,6} /.test(l) ? [githubId(l.replace(/^#+ /, ""))] : []));

describe("web/README.md", () => {
  it("lists every script of web/package.json in its command table, and no other", () => {
    const scripts = Object.keys((JSON.parse(readRepo("web/package.json")) as { scripts: Record<string, string> }).scripts);
    const listed = tableRows(under(webReadme, "## Commands")).flatMap(([command = ""]) => {
      const run = /^`npm (?:run (\S+)|(test))`$/.exec(command);
      return run ? [run[1] ?? run[2] ?? ""] : [];
    });
    expect([...listed].sort()).toEqual([...scripts].sort());
  });

  it("gives a rule for each frontmatter field a docs page uses, with the values docsFrontmatter accepts", () => {
    // Fumadocs' own optional page fields (icon, full and the like) are left out: no docs page uses them.
    const fumadocsOnly = Object.keys(pageSchema.shape).filter((k) => k !== "title" && k !== "description");
    const fields = Object.keys(docsFrontmatter.shape).filter((k) => !fumadocsOnly.includes(k));
    const rows = tableRows(under(under(webReadme, "## Docs content"), "### Frontmatter"));
    expect(rows.flatMap(([field = ""]) => codes(field))).toEqual(fields);
    const values = (field: string) => codes(rows.find(([f = ""]) => codes(f).includes(field))?.[1] ?? "");
    expect(values("type")).toEqual([...DOC_TYPES]);
    expect(values("audience")).toEqual([...AUDIENCES]);
    expect(values("status")).toEqual([...STATUSES]);
  });

  it("names the files npm run docs:gen writes, and no other generated file", () => {
    const written = [...readRepo("web/scripts/docs-gen.ts").matchAll(/\$\{OUT\}([\w.-]+\.json)/g)].map((m) => `content/generated/${m[1]}`);
    expect(written.length).toBeGreaterThan(0);
    const named = [...new Set(codes(webReadme).filter((c) => c.startsWith("content/generated/") && c.endsWith(".json")))];
    expect(named.sort()).toEqual([...written].sort());
  });

  it("names in code every setting that siteUrl() and check:out read from the environment", () => {
    const read = ["web/lib/site.ts", "web/lib/check-out.ts"].flatMap((file) => [...readRepo(file).matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1] ?? ""));
    expect(read).toContain("NEXT_PUBLIC_SITE_URL");
    const spans = codes(webReadme);
    expect([...new Set(read)].filter((name) => !spans.some((c) => new RegExp(`\\b${name}\\b`).test(c)))).toEqual([]);
  });

  it("names in code only paths that exist, under web/ or the repository root", () => {
    // A path has a slash, no placeholder or wildcard, and starts with a folder of web/ or of the repository; a docs path
    // such as concepts/nine-checks does not. out/ is the build's output, which check:out checks itself.
    const top = (c: string) => c.split("/")[0] ?? "";
    const paths = codes(webReadme).filter(
      (c) =>
        /^[\w@.-]+(\/[\w@.-]+)+\/?$/.test(c) &&
        top(c) !== "out" &&
        (existsSync(join(REPO_ROOT, "web", top(c))) || existsSync(join(REPO_ROOT, top(c)))),
    );
    expect(paths).toContain("lib/docs/ia.ts");
    expect(paths.filter((p) => !existsSync(join(REPO_ROOT, "web", p)) && !existsSync(join(REPO_ROOT, p)))).toEqual([]);
  });

  it("links only to headings it has", () => {
    const anchors = [...webReadme.matchAll(/\]\(#([^)\s]+)\)/g)].map((m) => m[1] ?? "");
    expect(anchors).toContain("docs-content");
    expect(anchors.filter((id) => !headingIds(webReadme).includes(id))).toEqual([]);
  });
});

describe("the root README's Documentation section", () => {
  const section = under(rootReadme, "## Documentation");
  const links = [...section.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] ?? "").filter((l) => !/^[a-z]+:/.test(l));

  it("lists the docs center, and every spec and plan the repository tracks", () => {
    const tracked = execFileSync("git", ["ls-files", "docs/superpowers/specs", "docs/superpowers/plans"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((p) => /^docs\/superpowers\/(specs|plans)\/[^/]+\.md$/.test(p));
    expect(tracked).toContain("docs/superpowers/specs/2026-11-07-maat-docs-center-design.md");
    const listed = tableRows(section).flatMap(([doc = ""]) => [...doc.matchAll(/\]\(([^)\s#]+)\)/g)].map((m) => m[1] ?? ""));
    expect(listed).toContain("web/content/docs");
    expect(tracked.filter((p) => !listed.includes(p))).toEqual([]);
  });

  it("links only files that exist, and headings those files have", () => {
    const bad = links.filter((link) => {
      const [path = "", id] = link.split("#");
      if (!existsSync(join(REPO_ROOT, path))) return true;
      return id !== undefined && !headingIds(lf(path)).includes(id);
    });
    expect(bad).toEqual([]);
  });

  it("sends a maintainer to the docs rules in web/README.md", () => {
    expect(links).toContain("web/README.md#docs-content");
  });
});
