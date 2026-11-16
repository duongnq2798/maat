// @vitest-environment node
import type { SortedResult } from "fumadocs-core/search";
import { describe, expect, it } from "vitest";
import { READER_PATHS } from "@/lib/docs/reader-paths";
import { SEARCH_INDEX_URL, SEARCH_START_PAGES, searchTokenizer, titleFirst } from "@/lib/docs/search";
import { searchStructure } from "@/lib/docs/search-index";
import { docsPages } from "./helpers/docs";

const tokenizer = searchTokenizer();
const tokenize = (text: string) => tokenizer.tokenize(text);

/** A page and its records, as the static client lists them: the page first, then its headings and text. */
function page(url: string, title: string, ...records: string[]): SortedResult[] {
  return [
    { id: url, url, type: "page", content: title },
    ...records.map((content, i): SortedResult => ({ id: `${url}-${i}`, url: `${url}#r${i}`, type: "text", content })),
  ];
}
const pagesOf = (results: SortedResult[]) => results.filter((r) => r.type === "page").map((r) => r.url);

describe("titleFirst", () => {
  const results = [
    ...page("/docs/guides/watch-decisions-onchain", "Watch decisions onchain", "Deploy a vault first."),
    ...page("/docs/security/testing", "How it is tested", "The deploy script is tested on a fork."),
    ...page("/docs/guides/deploy-your-own-vault", "Deploy your own vault", "Dry-run the deploy."),
  ];

  it("puts a page whose title holds the query first, and keeps each page's records under it", () => {
    const ranked = titleFirst(results, "deploy", tokenize);
    expect(pagesOf(ranked)).toEqual(["/docs/guides/deploy-your-own-vault", "/docs/guides/watch-decisions-onchain", "/docs/security/testing"]);
    expect(ranked.slice(0, 2).map((r) => r.content)).toEqual(["Deploy your own vault", "Dry-run the deploy."]);
    expect(ranked).toHaveLength(results.length);
  });

  it("matches the words the way the index does: stemmed, and a word the reader is still typing", () => {
    const splits = [...page("/docs/concepts/mandate", "The mandate", "A split pauses the token."), ...page("/docs/concepts/splits", "Splits and the multiplier")];
    expect(pagesOf(titleFirst(splits, "split", tokenize))[0]).toBe("/docs/concepts/splits");
    expect(pagesOf(titleFirst(splits, "splits", tokenize))[0]).toBe("/docs/concepts/splits");
    expect(pagesOf(titleFirst(splits, "multipliers", tokenize))[0]).toBe("/docs/concepts/splits");
    expect(pagesOf(titleFirst(results, "depl", tokenize))[0]).toBe("/docs/guides/deploy-your-own-vault");
  });

  it("keeps the engine's order among pages whose titles all match", () => {
    const agent = [...page("/docs/reference/agent-scripts", "Agent scripts"), ...page("/docs/x", "Errors"), ...page("/docs/guides/run-the-agent", "Run the agent")];
    expect(pagesOf(titleFirst(agent, "agent", tokenize))).toEqual(["/docs/reference/agent-scripts", "/docs/guides/run-the-agent", "/docs/x"]);
  });

  it("next puts a page whose title holds part of the query and that answers all of it in one record", () => {
    const reason = [
      ...page("/docs/reference/events", "Events", "Refusal codes: every reason a Decision can carry."),
      ...page("/docs/concepts/refusal-codes", "Refusal codes", "It records a Reason (the reason code) in the Decision event."),
    ];
    expect(pagesOf(titleFirst(reason, "reason code", tokenize))).toEqual(["/docs/concepts/refusal-codes", "/docs/reference/events"]);
  });

  it("does not lift a page that shares only a common word with the query", () => {
    const meaning = [
      ...page("/docs/concepts/refusal-codes", "Refusal codes", "The market is closed, or the calendar can't be read."),
      ...page("/docs/concepts/mandate", "The mandate", "The calendar sets the session."),
    ];
    expect(pagesOf(titleFirst(meaning, "the calendar can't be read", tokenize))).toEqual(["/docs/concepts/refusal-codes", "/docs/concepts/mandate"]);
  });

  it("leaves the results alone for a query with no words", () => {
    expect(titleFirst(results, " ", tokenize)).toBe(results);
  });
});

describe("searchStructure", () => {
  const MARKDOWN = [
    "The lede names `MARKET_CLOSED`.",
    "",
    '<Callout type="note" title="Owner only">',
    "",
    "Text inside a callout.",
    "",
    "```bash",
    "cast call codeonlyword",
    "```",
    "",
    "</Callout>",
    "",
    "## Setup",
    "",
    "| Name | Value |",
    "| --- | --- |",
    "| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |",
    "",
    "### Gas",
    "",
    "~~~ts",
    "const alsoCodeOnly = 1;",
    "~~~",
    "",
    "Gas text.",
  ].join("\n");
  const TOC = [
    { title: "Setup", url: "#setup", depth: 2 },
    { title: "Gas", url: "#gas-limits", depth: 3 },
  ];

  it("indexes the text of the processed Markdown, component tables included, and no code", () => {
    const data = searchStructure(MARKDOWN, TOC, "/docs/x");
    const text = data.contents.map((c) => c.content).join("\n");
    expect(text).toContain("The lede names `MARKET_CLOSED`.");
    expect(text).toContain("Text inside a callout.");
    expect(text).toContain("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(text).toContain("Gas text.");
    expect(text).not.toMatch(/codeonlyword|alsoCodeOnly|Callout/);
  });

  it("takes each heading's anchor from the page's table of contents, in order", () => {
    const data = searchStructure(MARKDOWN, TOC, "/docs/x");
    expect(data.headings).toEqual([
      { id: "setup", content: "Setup" },
      { id: "gas-limits", content: "Gas" },
    ]);
    const under = (needle: string) => data.contents.find((c) => c.content.includes(needle))?.heading;
    expect(under("The lede")).toBeUndefined();
    expect(under("0x833589")).toBe("setup");
    expect(under("Gas text.")).toBe("gas-limits");
  });

  it("fails the build when the headings and the table of contents disagree, naming the page", () => {
    expect(() => searchStructure(MARKDOWN, TOC.slice(0, 1), "/docs/x")).toThrow("/docs/x: the processed Markdown has 2 headings and the table of contents 1");
  });
});

describe("the dialog's start pages", () => {
  const titles = new Map(docsPages().map((p) => [p.slug, /^title: "?(.+?)"?$/m.exec(p.source)?.[1]]));

  it("lists each reader's first page, then four pages people look things up in", () => {
    expect(SEARCH_START_PAGES.slice(0, READER_PATHS.length).map((p) => p.url)).toEqual(READER_PATHS.map((p) => `/docs/${p.slug}`));
    expect(SEARCH_START_PAGES[0]).toEqual({ label: "What is Maat", url: "/docs/get-started/what-is-maat" });
    expect(SEARCH_START_PAGES).toHaveLength(READER_PATHS.length + 4);
  });

  it("labels each page with its title, as a result names it, not with a call to action", () => {
    for (const { label, url } of SEARCH_START_PAGES) expect(label, url).toBe(titles.get(url.slice("/docs/".length)));
    expect(SEARCH_START_PAGES.map((p) => p.label)).toContain("Quickstart: verify Maat in five minutes");
  });

  it("names only pages that exist", () => {
    for (const { url } of SEARCH_START_PAGES) expect(titles.has(url.slice("/docs/".length)), url).toBe(true);
  });
});

it("downloads the index from a file with a .json extension, so hosts serve it as JSON", () => {
  expect(SEARCH_INDEX_URL).toBe("/api/search.json");
});
