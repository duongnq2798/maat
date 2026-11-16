// @vitest-environment node
import defaultMdxComponents from "fumadocs-ui/mdx";
import { describe, expect, it, vi } from "vitest";
import { getMDXComponents } from "@/components/docs/mdx";
import { DATA_COMPONENTS } from "@/lib/docs/data-components";
import { markdownLines } from "@/lib/docs/markdown";
import { docsPages } from "./helpers/docs";

// The leak guard (checkMarkdownCopies) and the plugin that prints component text both read DATA_COMPONENTS. These tests
// tie that list to the two things it must follow, the components the pages use and the components MDX registers,
// so a new component left out of the list fails here instead of shipping as a raw tag in /md and llms-full.txt.

vi.mock("@/lib/docs-source", () => ({ pageExists: () => true }));

/** Components whose tags stay in the Markdown copies: containers wrap real text, and <Fact /> is replaced by remarkFacts. */
const KEPT = ["Callout", "Steps", "Step", "Fact"];

describe("DATA_COMPONENTS", () => {
  it("names every component the docs pages use, apart from the containers and <Fact />", () => {
    const used = new Map<string, string>();
    for (const page of docsPages()) {
      markdownLines(page.source).forEach(({ text, inFence }, i) => {
        if (inFence) return;
        // Inline code may show a tag or a placeholder such as <BASE_RPC_URL>; only real MDX tags count.
        for (const [, name] of text.replace(/`[^`]*`/g, "").matchAll(/<([A-Z]\w*)/g)) used.set(name!, `${page.slug}.mdx:${i + 1}`);
      });
    }
    const unknown = [...used].filter(([name]) => !(DATA_COMPONENTS as readonly string[]).includes(name) && !KEPT.includes(name));
    expect(unknown.map(([name, where]) => `<${name}> in ${where} is not in DATA_COMPONENTS`)).toEqual([]);
    // And no name in the list is dead: every one is used by some page.
    const dead = DATA_COMPONENTS.filter((name) => !used.has(name));
    expect(dead).toEqual([]);
  });

  it("names every component getMDXComponents registers, apart from Fumadocs' defaults and the containers", () => {
    const defaults = new Set(Object.keys(defaultMdxComponents));
    const registered = Object.keys(getMDXComponents()).filter((key) => /^[A-Z]/.test(key) && !defaults.has(key) && !KEPT.includes(key));
    expect(registered.filter((key) => !(DATA_COMPONENTS as readonly string[]).includes(key))).toEqual([]);
    expect(DATA_COMPONENTS.filter((name) => !registered.includes(name))).toEqual([]);
  });
});
