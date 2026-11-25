// @vitest-environment node
import { createStringifier } from "fumadocs-core/mdx-plugins/stringifier";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { componentText } from "@/lib/docs/component-text";
import { docsData } from "@/lib/docs/generated";
import { type MdNode } from "@/lib/docs/remark-facts";
import { type ComponentTextOptions, remarkComponentText } from "@/lib/docs/remark-component-text";
import { findContract } from "@/lib/docs/signatures";

const PATH = "content/docs/reference/mandate-vault.mdx";
const ALL = { exists: () => true };

/** A MDX source with its tree: a node is built for each tag, with the offsets and the line it has in the source. */
function parse(source: string, tags: Record<string, Omit<MdNode, "position">>) {
  const at = (needle: string): MdNode["position"] => {
    const start = source.indexOf(needle);
    if (start < 0) throw new Error(`no ${needle} in the source`);
    const line = source.slice(0, start).split("\n").length;
    return { start: { line, column: 1, offset: start }, end: { line, column: 1, offset: start + needle.length } };
  };
  const nodes = Object.entries(tags).map(([needle, node]) => ({ ...node, position: at(needle) }) as MdNode);
  return { nodes, whole: { start: { line: 1, column: 1, offset: 0 }, end: { line: 1, column: 1, offset: source.length } } };
}

const attr = (name: string, value: unknown = null) => ({ type: "mdxJsxAttribute", name, value });
const flow = (name: string, attributes: MdNode["attributes"] = [], children: MdNode[] = []): Omit<MdNode, "position"> => ({
  type: "mdxJsxFlowElement",
  name,
  attributes,
  children,
});
const inline = (name: string, attributes: MdNode["attributes"] = []): Omit<MdNode, "position"> => ({
  type: "mdxJsxTextElement",
  name,
  attributes,
  children: [],
});

/** Runs the plugin over a tree and prints the Markdown the way Fumadocs' processed Markdown does. */
function run(source: string, root: MdNode, options: ComponentTextOptions = ALL, path: string | undefined = PATH) {
  const file = { path, toString: () => source };
  remarkComponentText(options)(root, file);
  return createStringifier(file as never).stringify(root as never);
}

const EXECUTE = '<Fn contract="MandateVault" name="execute" />';
const FN_TEXT = componentText("Fn", { contract: "MandateVault", name: "execute" }, ALL);

describe("remarkComponentText", () => {
  it("prints the text of a data component in the Markdown, and leaves the tree as it is", () => {
    const source = `Before.\n\n${EXECUTE}\n\nAfter.\n`;
    const { nodes, whole } = parse(source, { [EXECUTE]: flow("Fn", [attr("contract", "MandateVault"), attr("name", "execute")]) });
    const root: MdNode = { type: "root", children: nodes, position: whole };
    const before = JSON.stringify(root);
    expect(run(source, root)).toBe(`Before.\n\n${FN_TEXT}\n\nAfter.\n`);
    // The HTML page renders the real component from this tree.
    expect(JSON.stringify(root)).toBe(before);
  });

  it("finds a component inside a Callout, and leaves the Callout's own text", () => {
    const source = `<Callout>\nRead this.\n\n${EXECUTE}\n</Callout>\n`;
    const { nodes, whole } = parse(source, { [EXECUTE]: flow("Fn", [attr("contract", "MandateVault"), attr("name", "execute")]) });
    const callout: MdNode = { type: "mdxJsxFlowElement", name: "Callout", attributes: [], children: nodes, position: whole };
    const root: MdNode = { type: "root", children: [callout], position: whole };
    expect(run(source, root)).toBe(`<Callout>\nRead this.\n\n${FN_TEXT}\n</Callout>\n`);
  });

  it("prints a badge in the middle of a table cell", () => {
    const badge = '<StatusBadge status="fork-tested" />';
    const source = `| ${badge} | Built and tested. |\n`;
    const { nodes, whole } = parse(source, { [badge]: inline("StatusBadge", [attr("status", "fork-tested")]) });
    const root: MdNode = { type: "root", children: [{ type: "paragraph", children: nodes, position: whole }], position: whole };
    expect(run(source, root)).toBe("| Fork-tested | Built and tested. |\n");
  });

  it("reads a bare flag and a list of strings written as an expression", () => {
    const index = '<FunctionIndex contract="MarketCalendar" qualify />';
    const facts = '<FactTable names={["checksPerTrade"]} />';
    const source = `${index}\n\n${facts}\n`;
    const list = {
      type: "mdxJsxAttributeValueExpression",
      value: '["checksPerTrade"]',
      data: {
        estree: {
          type: "Program",
          body: [
            {
              type: "ExpressionStatement",
              expression: { type: "ArrayExpression", elements: [{ type: "Literal", value: "checksPerTrade" }] },
            },
          ],
        },
      },
    };
    const { nodes, whole } = parse(source, {
      [index]: flow("FunctionIndex", [attr("contract", "MarketCalendar"), attr("qualify")]),
      [facts]: flow("FactTable", [attr("names", list)]),
    });
    const out = run(source, { type: "root", children: nodes, position: whole });
    expect(out).toBe(
      `${componentText("FunctionIndex", { contract: "MarketCalendar", qualify: true }, ALL)}\n\n${componentText("FactTable", { names: ["checksPerTrade"] }, ALL)}\n`,
    );
  });

  it("reads a list of lists, as a grouped FunctionIndex writes its groups", () => {
    const names = findContract(docsData.surface, "MarketCalendar").functions.map((f) => f.name);
    const index = `<FunctionIndex contract="MarketCalendar" groups={[["All", ${JSON.stringify(names)}]]} />`;
    const str = (value: string) => ({ type: "Literal", value });
    const groups = {
      type: "mdxJsxAttributeValueExpression",
      value: `[["All", ${JSON.stringify(names)}]]`,
      data: {
        estree: {
          type: "Program",
          body: [
            {
              type: "ExpressionStatement",
              expression: {
                type: "ArrayExpression",
                elements: [{ type: "ArrayExpression", elements: [str("All"), { type: "ArrayExpression", elements: names.map(str) }] }],
              },
            },
          ],
        },
      },
    };
    const { nodes, whole } = parse(index, { [index]: flow("FunctionIndex", [attr("contract", "MarketCalendar"), attr("groups", groups)]) });
    expect(run(index, { type: "root", children: nodes, position: whole })).toBe(
      componentText("FunctionIndex", { contract: "MarketCalendar", groups: [["All", names]] }, ALL),
    );
  });

  it("asks the page lookup which pages have shipped, for the router cards", () => {
    const cards = "<RouterCards />";
    const { nodes, whole } = parse(cards, { [cards]: flow("RouterCards") });
    const out = run(cards, { type: "root", children: nodes, position: whole }, { exists: (slug) => slug !== "security/model" });
    expect(out).toContain("Security model (coming soon)");
    expect(out).toContain("[What is Maat →](/docs/get-started/what-is-maat)");
  });

  it("by default, links a router card whose page is in content/docs", () => {
    const cards = "<RouterCards />";
    const { nodes, whole } = parse(cards, { [cards]: flow("RouterCards") });
    const out = run(cards, { type: "root", children: nodes, position: whole }, {});
    expect(out).toContain("- **New to Maat**: Know what it is and why it matters. [What is Maat →](/docs/get-started/what-is-maat)");
    expect(out).not.toContain("coming soon");
  });

  it("finds a shipped page as <slug>.mdx or <slug>/index.mdx under docsDir, and leaves the others as 'coming soon'", () => {
    const dir = mkdtempSync(join(tmpdir(), "maat-docs-"));
    try {
      mkdirSync(join(dir, "get-started"), { recursive: true });
      writeFileSync(join(dir, "get-started", "what-is-maat.mdx"), "x");
      mkdirSync(join(dir, "security", "model"), { recursive: true });
      writeFileSync(join(dir, "security", "model", "index.mdx"), "x");
      const cards = "<RouterCards />";
      const { nodes, whole } = parse(cards, { [cards]: flow("RouterCards") });
      const lines = run(cards, { type: "root", children: nodes, position: whole }, { docsDir: dir }).split("\n");
      expect(lines.filter((l) => l.includes("](/docs/"))).toEqual([
        expect.stringContaining("[What is Maat →](/docs/get-started/what-is-maat)"),
        expect.stringContaining("[Security model →](/docs/security/model)"),
      ]);
      expect(lines.filter((l) => l.endsWith("(coming soon)"))).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists a section from the pages and meta.json files under docsDir, as Fumadocs builds the sidebar from them", () => {
    const dir = mkdtempSync(join(tmpdir(), "maat-docs-"));
    try {
      const page = (path: string, title: string, description: string, eol = "\n") =>
        writeFileSync(join(dir, path), ["---", `title: "${title}"`, `description: ${description}`, "---", "", "Body."].join(eol));
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ title: "Docs", pages: ["index", "a"] }));
      page("index.mdx", "Home", "The home.");
      mkdirSync(join(dir, "a"));
      writeFileSync(join(dir, "a", "meta.json"), JSON.stringify({ title: "Section A", pages: ["one", "---Group---", "two", "[Home](/docs)"] }));
      page(join("a", "index.mdx"), "Section A", "What A holds.");
      page(join("a", "one.mdx"), "One: the first", "Page one.");
      // A Windows checkout may have CRLF line endings.
      page(join("a", "two.mdx"), "Two", "Page two.", "\r\n");
      const tags = '<SectionIndex section="a" />\n\n<SectionIndex />\n';
      const { nodes, whole } = parse(tags, {
        '<SectionIndex section="a" />': flow("SectionIndex", [attr("section", "a")]),
        "<SectionIndex />": flow("SectionIndex"),
      });
      expect(run(tags, { type: "root", children: nodes, position: whole }, { docsDir: dir })).toBe(
        [
          "- [One: the first](/docs/a/one): Page one.",
          "",
          "**Group**",
          "",
          "- [Two](/docs/a/two): Page two.",
          "- [Home](/docs): The home.",
          "",
          "- [Section A](/docs/a): What A holds.",
          "",
        ].join("\n"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tells the bundler which files a section index read, so next dev rebuilds its Markdown when another page changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "maat-docs-"));
    try {
      writeFileSync(join(dir, "meta.json"), JSON.stringify({ title: "Docs", pages: ["index", "a"] }));
      writeFileSync(join(dir, "index.mdx"), "---\ntitle: Home\ndescription: The home.\n---\n");
      mkdirSync(join(dir, "a"));
      writeFileSync(join(dir, "a", "meta.json"), JSON.stringify({ title: "A", pages: ["one"] }));
      writeFileSync(join(dir, "a", "index.mdx"), "---\ntitle: A\ndescription: What A holds.\n---\n");
      writeFileSync(join(dir, "a", "one.mdx"), "---\ntitle: One\ndescription: Page one.\n---\n");
      const compile = (source: string, tags: Record<string, Omit<MdNode, "position">>) => {
        const added: string[] = [];
        const { nodes, whole } = parse(source, tags);
        const file = { path: PATH, toString: () => source, data: { _compiler: { addDependency: (f: string) => added.push(f) } } };
        remarkComponentText({ docsDir: dir, exists: () => true })({ type: "root", children: nodes, position: whole }, file);
        return added;
      };
      const all = ["meta.json", "index.mdx", join("a", "meta.json"), join("a", "index.mdx"), join("a", "one.mdx")].map((f) => resolve(dir, f));
      expect(new Set(compile('<SectionIndex section="a" />', { '<SectionIndex section="a" />': flow("SectionIndex", [attr("section", "a")]) }))).toEqual(new Set(all));
      // A page without a section index reads no other file, so it depends on none.
      expect(compile(EXECUTE, { [EXECUTE]: flow("Fn", [attr("contract", "MandateVault"), attr("name", "execute")]) })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("indents a multi-line rendering under its list item, with empty lines for the blank ones", () => {
    const source = `- ${EXECUTE}\n- Second item.\n`;
    const { nodes, whole } = parse(source, { [EXECUTE]: flow("Fn", [attr("contract", "MandateVault"), attr("name", "execute")]) });
    const item: MdNode = { type: "listItem", children: nodes, position: whole };
    const root: MdNode = { type: "root", children: [{ type: "list", children: [item], position: whole }], position: whole };
    const indented = FN_TEXT.replace(/\n(?=.)/g, "\n  ");
    expect(run(source, root)).toBe(`- ${indented}\n- Second item.\n`);
    expect(indented).toContain("\n\n  Who may call");
  });

  it("indents a rendering that follows text inside a list item the same way", () => {
    const source = `1. Call it:\n\n   ${EXECUTE}\n\n2. Done.\n`;
    const { nodes, whole } = parse(source, { [EXECUTE]: flow("Fn", [attr("contract", "MandateVault"), attr("name", "execute")]) });
    const item: MdNode = { type: "listItem", children: nodes, position: whole };
    const root: MdNode = { type: "root", children: [{ type: "list", children: [item], position: whole }], position: whole };
    expect(run(source, root)).toBe(`1. Call it:\n\n   ${FN_TEXT.replace(/\n(?=.)/g, "\n   ")}\n\n2. Done.\n`);
  });

  it("leaves every other tag in the page alone", () => {
    const source = '<Callout type="warn">\nText.\n</Callout>\n';
    const { nodes, whole } = parse(source, { [source.trim()]: flow("Callout", [attr("type", "warn")]) });
    expect(run(source, { type: "root", children: nodes, position: whole })).toBe(source);
  });

  it("fails on an attribute that is not a literal, naming the file and the line", () => {
    const tag = '<Fn contract={vault} name="execute" />';
    const source = `Text.\n\n${tag}\n`;
    const bad = { type: "mdxJsxAttributeValueExpression", value: "vault", data: { estree: { type: "Program", body: [{ type: "ExpressionStatement", expression: { type: "Identifier", name: "vault" } }] } } };
    const { nodes, whole } = parse(source, { [tag]: flow("Fn", [attr("contract", bad), attr("name", "execute")]) });
    expect(() => run(source, { type: "root", children: nodes, position: whole })).toThrow(
      `${PATH}:3: <Fn /> needs a literal value for contract, like contract="MandateVault"`,
    );
  });

  it("fails on a spread, naming the file and the line", () => {
    const tag = "<Fn {...props} />";
    const { nodes, whole } = parse(tag, { [tag]: flow("Fn", [{ type: "mdxJsxExpressionAttribute", value: "...props" }]) });
    expect(() => run(tag, { type: "root", children: nodes, position: whole })).toThrow(`${PATH}:1: <Fn /> takes plain attributes only`);
  });

  it("fails on an unknown entry, naming the file and the line", () => {
    const tag = '<Fn contract="MandateVault" name="nope" />';
    const { nodes, whole } = parse(tag, { [tag]: flow("Fn", [attr("contract", "MandateVault"), attr("name", "nope")]) });
    expect(() => run(tag, { type: "root", children: nodes, position: whole })).toThrow(`${PATH}:1: MandateVault has no function named nope`);
  });

  it("fails on a block component in the middle of a paragraph, where its lines would break the paragraph", () => {
    const tag = '<Fn contract="MandateVault" name="execute" />';
    const source = `Call ${tag} now.\n`;
    const { nodes, whole } = parse(source, { [tag]: inline("Fn", [attr("contract", "MandateVault"), attr("name", "execute")]) });
    const root: MdNode = { type: "root", children: [{ type: "paragraph", children: nodes, position: whole }], position: whole };
    expect(() => run(source, root)).toThrow(`${PATH}:1: <Fn /> prints several lines, so put it on a line of its own`);
  });
});
