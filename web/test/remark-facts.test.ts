// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FACT_TEXT } from "@/lib/docs/fact-text";
import { type MdNode, remarkFacts } from "@/lib/docs/remark-facts";

const at = (line: number, start: number, end: number) => ({
  start: { line, column: 1, offset: start },
  end: { line, column: 1, offset: end },
});

const fact = (type: "mdxJsxTextElement" | "mdxJsxFlowElement", value: unknown, line = 3): MdNode => ({
  type,
  name: "Fact",
  attributes: [{ type: "mdxJsxAttribute", name: "name", value }],
  children: [],
  position: at(line, 10, 40),
});

/** A paragraph with a fact in its text, a list item holding a fact on its own line, and an unrelated JSX element. */
function tree(inText: MdNode, ownLine: MdNode): MdNode {
  return {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "Every trade passes " }, inText, { type: "text", value: " checks." }] },
      { type: "list", children: [{ type: "listItem", children: [ownLine] }] },
      { type: "mdxJsxFlowElement", name: "Callout", attributes: [], children: [] },
    ],
  };
}

const run = (root: MdNode, path = "content/docs/concepts/nine-checks.mdx") => remarkFacts()(root, { path });

describe("remarkFacts", () => {
  it("replaces <Fact /> in text and on its own line with the fact text", () => {
    const root = tree(fact("mdxJsxTextElement", "checksPerTrade"), fact("mdxJsxFlowElement", "timelockHours"));
    run(root);
    const [para, list, callout] = root.children!;
    expect(para!.children!.map((n) => n.value).join("")).toBe(`Every trade passes ${FACT_TEXT.checksPerTrade.text} checks.`);
    expect(para!.children![1]).toMatchObject({ type: "text", value: "9", position: at(3, 10, 40) });
    // A fact on its own line becomes a paragraph, so the list item still holds flow content.
    expect(list!.children![0]!.children![0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "24 hours" }],
    });
    expect(callout).toMatchObject({ type: "mdxJsxFlowElement", name: "Callout" });
  });

  it("fails on an unknown name, naming the file, the line and the name", () => {
    const root = tree(fact("mdxJsxTextElement", "nope", 7), fact("mdxJsxFlowElement", "timelockHours"));
    expect(() => run(root)).toThrow('content/docs/concepts/nine-checks.mdx:7: <Fact name="nope" /> is not in FACT_TEXT');
  });

  it("fails on a name that is not a string literal", () => {
    const root = tree(fact("mdxJsxTextElement", { type: "mdxJsxAttributeValueExpression", value: "x" }), fact("mdxJsxFlowElement", "gas.buy"));
    expect(() => run(root)).toThrow(/nine-checks\.mdx:3: <Fact \/> needs a literal name/);
  });
});
