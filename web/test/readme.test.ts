// @vitest-environment node
import { execFileSync } from "node:child_process";
import { pageSchema } from "fumadocs-core/source/schema";
import { describe, expect, it } from "vitest";
import { Callout } from "@/components/docs/Callout";
import { ALLOWED_SYMBOLS } from "@/lib/docs/content-checks";
import { AUDIENCES, DOC_TYPES, docsFrontmatter, STATUSES } from "@/lib/docs/frontmatter";
import { IA_SLUGS } from "@/lib/docs/ia";
import { docsPages } from "./helpers/docs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// web/README.md tells a maintainer the rules the docs tests enforce, and the root README's Documentation table points
// at it. These tests hold to the code the parts of both that name something the code holds: the scripts, the
// frontmatter fields and values, the files docs:gen writes, the environment settings, the symbols a page may use, the
// callout types, the description bounds, the paths and the links. The wording of each rule is checked by reading it.

const lf = (rel: string) => readRepo(rel).replace(/\r\n/g, "\n");
const webReadme = lf("web/README.md");
const rootReadme = lf("README.md");

let trackedPaths: readonly string[] | undefined;
/** Every path the repository tracks, as `git ls-files` lists it: in its exact case, which GitHub's links need. */
const tracked = () =>
  (trackedPaths ??= execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((p) => p !== ""));
/** Whether `path`, from the repository root, is a tracked file or a folder that holds one. */
const isTracked = (path: string) => {
  const p = path.replace(/\/$/, "");
  return p !== "" && tracked().some((t) => t === p || t.startsWith(`${p}/`));
};

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

  it("names the files npm run docs:gen and npm run rationales write, and no other generated file", () => {
    const docsGen = [...readRepo("web/scripts/docs-gen.ts").matchAll(/\$\{OUT\}([\w.-]+\.json)/g)].map((m) => `content/generated/${m[1]}`);
    const rationales = [...readRepo("web/scripts/rationales.ts").matchAll(/new URL\("\.\.\/(content\/generated\/[\w.-]+\.json)"/g)].map((m) => m[1]!);
    expect(docsGen.length).toBeGreaterThan(0);
    expect(rationales).toEqual(["content/generated/rationales.json"]);
    const written = [...docsGen, ...rationales];
    const named = [...new Set(codes(webReadme).filter((c) => c.startsWith("content/generated/") && c.endsWith(".json")))];
    expect(named.sort()).toEqual([...written].sort());
  });

  it("names in code every setting that siteUrl() and check:out read from the environment", () => {
    const read = ["web/lib/site.ts", "web/lib/check-out.ts"].flatMap((file) => [...readRepo(file).matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1] ?? ""));
    expect(read).toContain("NEXT_PUBLIC_SITE_URL");
    const spans = codes(webReadme);
    expect([...new Set(read)].filter((name) => !spans.some((c) => new RegExp(`\\b${name}\\b`).test(c)))).toEqual([]);
  });

  it("names in code only paths the repository tracks, under web/ or the repository root", () => {
    // A path has a slash and no placeholder or wildcard. A docs page named by its path, such as concepts/nine-checks,
    // is not a file, and out/ is the build's output, which check:out checks itself.
    const paths = codes(webReadme).filter(
      (c) => /^[\w@.-]+(\/[\w@.-]+)+\/?$/.test(c) && !IA_SLUGS.includes(c.replace(/\/$/, "")) && !c.startsWith("out/"),
    );
    expect(paths).toContain("lib/docs/ia.ts");
    expect(paths.filter((p) => !isTracked(`web/${p}`) && !isTracked(p))).toEqual([]);
  });

  /** The first cell of the row of "Rules the tests enforce" that opens with `**<name>.**`. */
  const rule = (name: string) =>
    tableRows(under(under(webReadme, "## Docs content"), "### Rules the tests enforce")).find(([r = ""]) => r.startsWith(`**${name}.**`))?.[0] ?? "";

  it("allows in its Characters rule exactly the symbols foreignCharacters lets through", () => {
    expect(codes(rule("Characters"))).toEqual([...ALLOWED_SYMBOLS]);
  });

  it("gives in its Callouts rule exactly the types <Callout> renders", () => {
    const types = [.../type CalloutType = ([^;]+);/.exec(readRepo("web/components/docs/Callout.tsx"))?.[1]?.matchAll(/"(\w+)"/g) ?? []].map((m) => m[1] ?? "");
    expect(types.length).toBeGreaterThan(0);
    // The component's own check, which MDX needs because it does not type-check props, accepts each of them.
    for (const type of types) expect(() => Callout({ type: type as never, title: "T", children: "x" })).not.toThrow();
    expect(codes(rule("Callouts")).filter((c) => /^\w+$/.test(c))).toEqual(types);
  });

  it("gives the description bounds that the IA test and check:out apply", () => {
    const ia = /description\.length < (\d+) \|\| p\.description\.length > (\d+)/.exec(readRepo("web/test/docs-ia.test.ts"));
    const out = /length >= (\d+) && length <= (\d+)/.exec(readRepo("web/lib/check-out.ts"));
    expect(ia?.slice(1)).toEqual(out?.slice(1));
    const stated = [...under(webReadme, "## Docs content").matchAll(/(\d+) to (\d+) characters/g)].map((m) => m.slice(1));
    expect(stated.length).toBeGreaterThan(0);
    expect(stated.filter((bounds) => bounds.join() !== out?.slice(1).join())).toEqual([]);
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
    const specsAndPlans = tracked().filter((p) => /^docs\/superpowers\/(specs|plans)\/[^/]+\.md$/.test(p));
    expect(specsAndPlans).toContain("docs/superpowers/specs/2026-11-07-maat-docs-center-design.md");
    const listed = tableRows(section).flatMap(([doc = ""]) => [...doc.matchAll(/\]\(([^)\s#]+)\)/g)].map((m) => m[1] ?? ""));
    expect(listed).toContain("web/content/docs");
    expect(specsAndPlans.filter((p) => !listed.includes(p))).toEqual([]);
  });

  it("links only files or folders the repository tracks, in their exact case, and headings those files have", () => {
    expect(links).toContain("web/content/docs");
    const bad = links.filter((link) => {
      const [path = "", id] = link.split("#");
      if (!isTracked(path)) return true;
      return id !== undefined && !headingIds(lf(path)).includes(id);
    });
    expect(bad).toEqual([]);
  });

  it("sends a maintainer to the docs rules in web/README.md", () => {
    expect(links).toContain("web/README.md#docs-content");
  });
});

describe("the root README's 5-minute guide", () => {
  it("prints the line check:out prints, with one docs page per page under web/content/docs", () => {
    // check:out counts out/docs.html and every page under out/docs/, and the export writes one per .mdx file.
    const prefix = /console\.log\(`(out\/ is ready to deploy \([^`$]*)\$\{docsFiles\.length\} docs /.exec(readRepo("web/scripts/check-out.ts"))?.[1];
    expect(prefix).toBeDefined();
    const pages = docsPages().length;
    expect(pages).toBeGreaterThan(1);
    expect(rootReadme).toContain(`   ${prefix}${pages} docs pages checked)\n`);
  });
});
