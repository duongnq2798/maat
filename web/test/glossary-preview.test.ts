// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FACT_TEXT, factFor } from "@/lib/docs/fact-text";
import { GLOSSARY_URL, glossaryId, glossaryPreviews, previewRuns } from "@/lib/docs/glossary-preview";
import { headingId } from "@/lib/docs/links";
import { docsPages } from "./helpers/docs";

const pages = docsPages();
const glossarySource = pages.find((p) => p.slug === "help/glossary")?.source ?? "";

/**
 * The glossary as page.data.getText("processed") gives it (lib/docs-source.ts): the body without its frontmatter, with
 * each <Fact /> filled in as remarkFacts fills it. The glossary has no data component, so nothing else changes.
 */
const processed = glossarySource
  .replace(/^---\n[\s\S]*?\n---\n/, "")
  .replace(/<Fact name="([^"]+)" \/>/g, (_, name: string) => factFor(name).text);

/** Each entry of the glossary as written: its anchor, and its text with every link as its text. */
const entries = processed
  .split(/^### /m)
  .slice(1)
  .map((block) => {
    const [title = "", ...body] = block.split("\n");
    const text = body
      .join("\n")
      .split(/^## /m)[0]!
      .trim()
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ");
    return { id: headingId(title), text };
  });

const previews = glossaryPreviews(processed);

/** Every glossary entry the docs pages link to, with a page that links it. */
const linked = new Map<string, string>();
for (const page of pages) {
  for (const [, href = ""] of page.source.matchAll(/\]\((\/docs\/help\/glossary#[^)\s]*)\)|href=["'](\/docs\/help\/glossary#[^"']*)["']/g)) {
    const id = glossaryId(href);
    if (id !== null) linked.set(id, page.slug);
  }
}

/**
 * Words that give a term's status: how far it is built and what it has run against. A preview cut to its first sentence
 * would lose them (Builder Code says "no real code is registered yet" in its second sentence).
 */
const STATUS_WORDS = [
  "registered yet",
  "never run",
  "not built",
  "planned",
  "deployed",
  "not measured",
  "not been observed",
  "fake",
  "meant to",
  "built to",
  "built for",
  "assumes",
  "fork",
] as const;

describe("glossaryId", () => {
  it("names the entry a link to the glossary points at", () => {
    expect(GLOSSARY_URL).toBe("/docs/help/glossary");
    expect(glossaryId("/docs/help/glossary#b20")).toBe("b20");
    expect(glossaryId("/docs/help/glossary#builder-code-erc-8021")).toBe("builder-code-erc-8021");
  });

  it("is null for the glossary page itself and for any other link", () => {
    expect(glossaryId("/docs/help/glossary")).toBeNull();
    expect(glossaryId("/docs/help/glossary#")).toBeNull();
    expect(glossaryId("/docs/concepts/mandate#b20")).toBeNull();
    expect(glossaryId("/docs/help/glossary-x#b20")).toBeNull();
    expect(glossaryId("https://maatonbase.xyz/docs/help/glossary#b20")).toBeNull();
  });
});

describe("glossaryPreviews", () => {
  const MARKDOWN = [
    "The intro, with [a term](/docs/help/glossary#term).",
    "",
    "| Topic | Terms |",
    "| --- | --- |",
    "| Basics | [Term](/docs/help/glossary#term) |",
    "",
    "## T",
    "",
    "### Term (T-1)",
    "",
    "The first sentence names a [link](/docs/concepts/mandate#x) and `code`. The caveat comes later: it is not built. See [The page](/docs/concepts/mandate) and [another](/docs/x).",
    "",
    "### Kept pointer",
    "",
    "See this one is the only sentence, so it stays.",
    "",
    "### Middle pointer",
    "",
    "One sentence. See [the page](/docs/x) for more. A last sentence that is not a pointer.",
    "",
    "### Parenthetical",
    "",
    "An entry that cites its page in brackets ([Timelock and roles](/docs/concepts/timelock-and-roles#the-timelock)).",
  ].join("\n");
  const map = glossaryPreviews(MARKDOWN);

  it("maps each entry's anchor to its whole entry, with links as their text and code in backticks", () => {
    expect([...map.keys()]).toEqual(["term-t-1", "kept-pointer", "middle-pointer", "parenthetical"]);
    expect(map.get("term-t-1")).toBe("The first sentence names a link and `code`. The caveat comes later: it is not built.");
  });

  it("drops only a trailing See sentence, never one in the middle, and never the whole entry", () => {
    expect(map.get("kept-pointer")).toBe("See this one is the only sentence, so it stays.");
    expect(map.get("middle-pointer")).toBe("One sentence. See the page for more. A last sentence that is not a pointer.");
    expect(map.get("parenthetical")).toBe("An entry that cites its page in brackets (Timelock and roles).");
  });

  it("has no preview for the letters that group the entries, or for the text above them", () => {
    expect(map.has("t")).toBe(false);
    expect([...map.values()].join(" ")).not.toContain("intro");
  });
});

describe("previewRuns", () => {
  it("splits a preview into plain text and inline code", () => {
    expect(previewRuns("An `execute` call, `BUY` or `SELL`.")).toEqual([
      { code: false, text: "An " },
      { code: true, text: "execute" },
      { code: false, text: " call, " },
      { code: true, text: "BUY" },
      { code: false, text: " or " },
      { code: true, text: "SELL" },
      { code: false, text: "." },
    ]);
    expect(previewRuns("`MAAT_MODE=live`. Then text.")).toEqual([
      { code: true, text: "MAAT_MODE=live" },
      { code: false, text: ". Then text." },
    ]);
  });
});

describe("the glossary's previews", () => {
  it("has one preview for every entry of the glossary", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect([...previews.keys()].sort()).toEqual(entries.map((e) => e.id).sort());
  });

  it("has a preview for every glossary entry the docs link to", () => {
    expect(linked.size).toBeGreaterThan(0);
    const missing = [...linked].filter(([id]) => !previews.has(id)).map(([id, slug]) => `${slug}.mdx links #${id}, which has no preview`);
    expect(missing).toEqual([]);
  });

  it("keeps the whole entry: everything but a trailing See sentence", () => {
    for (const { id, text } of entries) {
      const preview = previews.get(id) ?? "";
      expect(text.startsWith(preview), id).toBe(true);
      const dropped = text.slice(preview.length).trim();
      expect(dropped === "" || /^See [^]*\.$/.test(dropped), `${id} drops "${dropped}"`).toBe(true);
    }
    // B20's second sentence is the one about the checks the vault runs.
    expect(previews.get("b20")).toBe(
      "The token type behind the tokenized stocks Maat trades on Base (NVDAc, GOOGLc and AAPLc). A B20 token can pause transfers, enforce sender, receiver and executor transfer policies, and publish a uiMultiplier, and the vault reads all three before it trades.",
    );
  });

  it("keeps every status word of its entry", () => {
    for (const word of STATUS_WORDS) expect(entries.some((e) => e.text.toLowerCase().includes(word)), `"${word}" is in no entry`).toBe(true);
    const lost = entries.flatMap(({ id, text }) =>
      STATUS_WORDS.filter((w) => text.toLowerCase().includes(w) && !(previews.get(id) ?? "").toLowerCase().includes(w)).map((w) => `${id}: ${w}`),
    );
    expect(lost).toEqual([]);
    // The caveats that sit after an entry's first sentence.
    expect(previews.get("builder-code-erc-8021")).toContain("no real code is registered yet");
    expect(previews.get("cdp-server-wallet")).toContain("has never run against the real CDP");
    expect(previews.get("x402")).toContain("It is not built");
    expect(previews.get("fork-test")).toContain("not that it has run on mainnet");
  });

  it("fills in facts and leaves no Markdown but inline code", () => {
    expect(previews.get("action")).toContain(`The ${FACT_TEXT.checksPerTrade.text} checks apply to \`BUY\` and \`SELL\``);
    for (const [id, preview] of previews) {
      const text = previewRuns(preview)
        .filter((r) => !r.code)
        .map((r) => r.text)
        .join("");
      expect(text, id).not.toMatch(/[[\]<>*_\\`]|\]\(/);
    }
  });
});
