// @vitest-environment node
import { createStringifier } from "fumadocs-core/mdx-plugins/stringifier";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { headingIds } from "@/lib/docs/content-checks";
import { docsData } from "@/lib/docs/generated";
import type { MdNode } from "@/lib/docs/remark-facts";
import { identifierTargets, LINKED_PAGES, remarkIdentifierLinks } from "@/lib/docs/remark-identifier-links";

const TARGETS = identifierTargets(docsData.surface);

/** A docs page's MDX, read relative to web/ as the build reads it. */
const page = (slug: string) => readFileSync(join("content/docs", `${slug}.mdx`), "utf8");

/** Text, code, or code inside a Markdown link, a reference-style link (`[x][ref]`) or a JSX tag with an href. */
type Inline = string | { code: string } | { code: string; link: string } | { code: string; ref: string } | { code: string; jsx: string; href: string };
type Block = { h: 2 | 3; text: Inline[] } | { p: Inline[] };

/** A page's source and its tree as remark-mdx would parse it, with the offsets each node has in the source. */
function doc(blocks: Block[]) {
  let source = "";
  const at = (start: number, end: number) => ({ start: { line: 1, column: start + 1, offset: start }, end: { line: 1, column: end + 1, offset: end } });
  const inline = (part: Inline): MdNode => {
    const start = source.length;
    if (typeof part === "string") {
      source += part;
      return { type: "text", value: part, position: at(start, source.length) };
    }
    if ("jsx" in part) {
      const open = `<${part.jsx} href="${part.href}">`;
      source += `${open}\`${part.code}\`</${part.jsx}>`;
      const code: MdNode = { type: "inlineCode", value: part.code, position: at(start + open.length, start + open.length + 2 + part.code.length) };
      const attributes = [{ type: "mdxJsxAttribute", name: "href", value: part.href }];
      return { type: "mdxJsxTextElement", name: part.jsx, attributes, children: [code], position: at(start, source.length) };
    }
    if ("ref" in part) {
      source += `[\`${part.code}\`][${part.ref}]`;
      const code: MdNode = { type: "inlineCode", value: part.code, position: at(start + 1, start + 3 + part.code.length) };
      const reference = { identifier: part.ref, label: part.ref, referenceType: "full" };
      return { type: "linkReference", ...reference, children: [code], position: at(start, source.length) } as MdNode;
    }
    source += "link" in part ? `[\`${part.code}\`](${part.link})` : `\`${part.code}\``;
    if (!("link" in part)) return { type: "inlineCode", value: part.code, position: at(start, source.length) };
    const code: MdNode = { type: "inlineCode", value: part.code, position: at(start + 1, start + 3 + part.code.length) };
    return { type: "link", url: part.link, children: [code], position: at(start, source.length) } as MdNode;
  };
  const children = blocks.map((b): MdNode => {
    if (source) source += "\n\n";
    const start = source.length;
    if ("h" in b) source += `${"#".repeat(b.h)} `;
    const parts = ("h" in b ? b.text : b.p).map(inline);
    const position = at(start, source.length);
    return "h" in b ? ({ type: "heading", depth: b.h, children: parts, position } as MdNode) : { type: "paragraph", children: parts, position };
  });
  return { source, root: { type: "root", children, position: at(0, source.length) } as MdNode };
}

/** Runs the plugin as if on `path`, then prints the Markdown the way Fumadocs' processed Markdown does. */
function run(blocks: Block[], path = "content/docs/reference/mandate-vault.mdx") {
  const { source, root } = doc(blocks);
  const file = { path, toString: () => source };
  remarkIdentifierLinks()(root, file);
  return { root, markdown: createStringifier(file as never).stringify(root as never) };
}

/** Every link in a tree, as [code, url]. */
function links(node: MdNode): [string, string][] {
  const own = node.type === "link" ? [[node.children?.[0]?.value ?? "", (node as MdNode & { url: string }).url] as [string, string]] : [];
  return [...own, ...(node.children ?? []).flatMap(links)];
}

const code = (c: string) => ({ code: c });

describe("identifierTargets", () => {
  it("points every name at a heading that its page has", () => {
    expect(TARGETS.size).toBeGreaterThan(0);
    const ids = new Map<string, Set<string>>();
    for (const [name, href] of TARGETS) {
      const [path = "", id = ""] = href.split("#");
      const slug = path.replace(/^\/docs\//, "");
      if (!ids.has(slug)) ids.set(slug, headingIds(page(slug)));
      expect(ids.get(slug), `${name} -> ${href}`).toContain(id);
    }
  });

  it("links the vault's functions, the events, the errors, the types and every refusal code but OK", () => {
    expect(TARGETS.get("execute")).toBe("/docs/reference/mandate-vault#execute");
    expect(TARGETS.get("tokens()")).toBe("/docs/reference/mandate-vault#tokens");
    expect(TARGETS.get("GRACE_PERIOD")).toBe("/docs/reference/mandate-vault#grace_period");
    expect(TARGETS.get("Decision")).toBe("/docs/reference/events#decision");
    expect(TARGETS.get("NotExecutor")).toBe("/docs/reference/errors#notexecutor");
    expect(TARGETS.get("InvalidConfig")).toBe("/docs/reference/errors#invalidconfig");
    expect(TARGETS.get("TokenConfig")).toBe("/docs/reference/types#tokenconfig");
    expect(TARGETS.get("SessionMode")).toBe("/docs/reference/types#sessionmode");
    expect(TARGETS.get("addHoliday")).toBe("/docs/reference/market-calendar#addholiday");
    expect(TARGETS.get("spoke")).toBe("/docs/reference/adapters#spoke-aavev4creditadapter");
    const reasons = docsData.surface.enums.find((e) => e.name === "Reason")!.members;
    for (const r of reasons.filter((m) => m !== "OK")) expect(TARGETS.get(r), r).toBe(`/docs/concepts/refusal-codes#${r.toLowerCase()}`);
    expect(TARGETS.has("OK")).toBe(false);
  });

  it("leaves out a name that has more than one entry, so no link guesses which one is meant", () => {
    const pairs = ["supply", "borrow", "repay", "supportsToken", "suppliedOf", "debt", "healthFactor", "hasPosition", "vault", "swapExactIn"];
    const errors = ["LengthMismatch", "ZeroAddress", "NotVault", "HealthFactorTooLow", "UnsupportedToken", "TransferFailed", "NotOwner"];
    for (const name of [...errors, "withdraw", "usdc", "owner", ...pairs]) {
      expect(TARGETS.has(name), name).toBe(false);
      expect(TARGETS.has(`${name}()`), `${name}()`).toBe(false);
    }
  });

  it("links a name that is also a parameter or a field only when written as a call", () => {
    for (const name of ["mandate", "mandateHash", "paused", "policyHash", "executor"]) {
      expect(TARGETS.has(name), name).toBe(false);
      expect(TARGETS.get(`${name}()`)).toBe(`/docs/reference/mandate-vault#${name.toLowerCase()}`);
    }
  });

  it("links no setting of the agent", () => {
    for (const v of docsData.agent.env) expect(TARGETS.has(v.name), v.name).toBe(false);
  });
});

describe("remarkIdentifierLinks", () => {
  it("links the first mention of a name in each section, on the page itself by its anchor, in the HTML and the Markdown", () => {
    const { root, markdown } = run([
      { p: ["Only ", code("execute"), " moves funds, and ", code("execute"), " emits a ", code("Decision"), "."] },
      { h: 2, text: ["Views"] },
      { p: [code("execute"), " again, and ", code("tokens()"), "."] },
    ]);
    expect(links(root)).toEqual([
      ["execute", "#execute"],
      ["Decision", "/docs/reference/events#decision"],
      ["execute", "#execute"],
      ["tokens()", "#tokens"],
    ]);
    expect(markdown).toBe(
      "Only [`execute`](#execute) moves funds, and `execute` emits a [`Decision`](/docs/reference/events#decision).\n\n" +
        "## Views\n\n[`execute`](#execute) again, and [`tokens()`](#tokens).",
    );
  });

  it("does not link in a heading, in an entry's own section, or a name the page already links in that section", () => {
    const { root } = run([
      { h: 2, text: ["Anyone"] },
      { h: 3, text: ["previewIntent"] },
      { p: [code("previewIntent"), " returns what ", { code: "execute", link: "/docs/reference/mandate-vault#execute" }, " would, and ", code("execute"), " acts."] },
      { h: 3, text: ["notifyRevenue"] },
      { p: [code("previewIntent"), " and ", code("notifyRevenue"), "."] },
      { h: 3, text: [code("syncMultiplier")] },
    ]);
    expect(links(root)).toEqual([
      ["execute", "/docs/reference/mandate-vault#execute"],
      ["previewIntent", "#previewintent"],
    ]);
  });

  it("never links inside a reference-style link, an <a> or a tag with an href, and counts the name there as linked", () => {
    const { root, markdown } = run([
      {
        p: [
          { code: "execute", ref: "vault" },
          ", ",
          { code: "Decision", jsx: "a", href: "/docs/reference/events#decision" },
          " and ",
          { code: "NotExecutor", jsx: "Card", href: "/docs/reference/errors#notexecutor" },
          ".",
        ],
      },
      { p: [code("execute"), ", ", code("Decision"), ", ", code("NotExecutor"), " and ", code("IntentAlreadyUsed"), "."] },
    ]);
    expect(links(root)).toEqual([["IntentAlreadyUsed", "/docs/reference/errors#intentalreadyused"]]);
    expect(markdown).toBe(
      '[`execute`][vault], <a href="/docs/reference/events#decision">`Decision`</a> and ' +
        '<Card href="/docs/reference/errors#notexecutor">`NotExecutor`</Card>.\n\n' +
        "`execute`, `Decision`, `NotExecutor` and [`IntentAlreadyUsed`](/docs/reference/errors#intentalreadyused).",
    );
  });

  it("leaves a name with two entries, a refusal code OK and any other code as they are", () => {
    const { root, markdown } = run([{ p: [code("withdraw"), ", ", code("NotOwner"), ", ", code("OK"), ", ", code("allowed = false"), " and ", code("SWAP_FAILED")] }]);
    expect(links(root)).toEqual([["SWAP_FAILED", "/docs/concepts/refusal-codes#swap_failed"]]);
    expect(markdown).toBe("`withdraw`, `NotOwner`, `OK`, `allowed = false` and [`SWAP_FAILED`](/docs/concepts/refusal-codes#swap_failed)");
  });

  it("links from every reference page that documents the contracts, and from no other page", () => {
    expect([...LINKED_PAGES].sort()).toEqual(
      ["reference/adapters", "reference/errors", "reference/events", "reference/market-calendar", "reference/mandate-vault", "reference/types"].sort(),
    );
    const blocks: Block[] = [{ p: [code("execute")] }];
    expect(links(run(blocks, "content/docs/reference/events.mdx").root)).toEqual([["execute", "/docs/reference/mandate-vault#execute"]]);
    for (const path of ["content/docs/concepts/nine-checks.mdx", "content/docs/guides/watch-decisions-onchain.mdx", "content/docs/security/model.mdx"]) {
      expect(links(run(blocks, path).root), path).toEqual([]);
    }
  });
});
