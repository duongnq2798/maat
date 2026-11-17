// @vitest-environment node
import type { SortedResult } from "fumadocs-core/search";
import { type AdvancedIndex, initAdvancedSearch } from "fumadocs-core/search/server";
import { describe, expect, it } from "vitest";
import { READER_PATHS } from "@/lib/docs/reader-paths";
import { namesQuery, SEARCH_INDEX_URL, SEARCH_START_PAGES, SEARCH_TOKENIZER, searchTokenizer, titleFirst } from "@/lib/docs/search";
import { docsSearch } from "@/lib/docs/search-client";
import { componentText } from "@/lib/docs/component-text";
import { docsTree } from "@/lib/docs/remark-component-text";
import { searchStructure, sectionIndexLines } from "@/lib/docs/search-index";
import { DOCS_DIR, docsPages } from "./helpers/docs";

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

  it("next puts a page with a heading that names the query, before the pages matched only in their text", () => {
    const vault: SortedResult[] = [
      { id: "/docs/reference/mandate-vault", url: "/docs/reference/mandate-vault", type: "page", content: "MandateVault" },
      { id: "/docs/reference/mandate-vault-0", url: "/docs/reference/mandate-vault#execute", type: "heading", content: "execute" },
    ];
    const execute = [
      ...page("/docs/security/testing", "How it is tested", "Each handler sends an intent to execute."),
      ...vault,
      ...page("/docs/concepts/intents", "Execute an intent", "An intent runs once."),
    ];
    expect(pagesOf(titleFirst(execute, "execute(Intent", tokenize))).toEqual(["/docs/concepts/intents", "/docs/reference/mandate-vault", "/docs/security/testing"]);
  });

  it("leaves the results alone for a query with no words", () => {
    expect(titleFirst(results, " ", tokenize)).toBe(results);
  });
});

describe("namesQuery", () => {
  const named = (query: string, heading: string) => namesQuery(query, tokenize)(heading);

  it("takes the identifier a query writes as code, in any case, and names the heading that is that identifier", () => {
    for (const query of ["execute(Intent", "execute(", "execute()", "MandateVault.execute", "`execute`", "EXECUTE(intent"]) {
      expect(named(query, "execute"), query).toBe(true);
    }
    expect(named("execute(Intent", "`execute`")).toBe(true);
    expect(named("execute(Intent", "execute(Intent calldata intent)")).toBe(true);
  });

  it("does not name a heading that only starts like the identifier, shares its stem or says more", () => {
    for (const heading of ["executor", "Execution", "Executor only", "Execute an intent", "Intent"]) {
      expect(named("execute(Intent", heading), heading).toBe(false);
    }
  });

  it("names a reference entry whose heading adds the contract that shares its name, for a query written as code", () => {
    expect(named("supply(address", "supply (ICreditAdapter)")).toBe(true);
    expect(named("NotOwner(", "NotOwner (MandateVault)")).toBe(true);
    expect(named("supply(address", "supply and borrow (ICreditAdapter)")).toBe(false);
    // Plain words compare the heading as it is written.
    expect(named("supply", "supply (ICreditAdapter)")).toBe(false);
  });

  it("names, for plain words, a heading that holds each of them and nothing else, stemmed as the index stems them", () => {
    expect(named("environment variables", "Environment variable")).toBe(true);
    expect(named("MARKET_CLOSED", "MARKET_CLOSED")).toBe(true);
    expect(named("queuemandate", "queueMandate")).toBe(true);
    // Holding every word is not enough: "agent" is a word of 22 headings on 13 pages, which would all pass the cap.
    expect(named("environment variables", "Set the environment variables")).toBe(false);
    expect(named("environment variables", "Environment")).toBe(false);
  });

  it("names nothing for a query with no words", () => {
    expect(named(" ", "execute")).toBe(false);
    expect(named("(", "(")).toBe(false);
  });
});

describe("the dialog's search", () => {
  /** A page of a synthetic index: its title, its headings (each anchored by its own text) and its text records. */
  const doc = (url: string, title: string, headings: string[], texts: string[]): AdvancedIndex => ({
    id: url,
    url,
    title,
    structuredData: { headings: headings.map((content) => ({ id: content, content })), contents: texts.map((content) => ({ heading: undefined, content })) },
  });
  /**
   * Prose like the invariant suite's: long, and holding both words of "execute(Intent" more than once, so each one
   * outscores the one-word heading and, from four of them on, the per-page cap leaves the heading out of the results.
   */
  const longRecord = (i: number) =>
    `Run ${i} builds an intent the way the agent does, previews the intent and sends it to execute. The vault spends the intent ` +
    `id before any check, so a second execute of that intent is counted apart, and the totals must match what the vault holds.`;

  /** docsSearch over an index built from `pages` the way the build builds it, downloaded from a data: URL. */
  async function searchOver(pages: AdvancedIndex[]) {
    const exported = await initAdvancedSearch({ indexes: pages, tokenizer: SEARCH_TOKENIZER, sort: { enabled: false } }).export();
    return docsSearch(`data:application/json,${encodeURIComponent(JSON.stringify(exported))}`);
  }

  for (const n of [0, 5, 10, 20, 40]) {
    it(`lists the heading that names "execute(Intent" first under its page, and that page first, beside ${n} long records holding both words`, async () => {
      const search = await searchOver([
        doc("/docs/reference/vault", "Vault", ["execute", "executor", "Executor only"], Array.from({ length: n }, (_, i) => longRecord(i))),
        // Pages matched only in their text, whose short records outscore the vault's: the engine lists them first, and
        // from 16 of them on, five results each, they take all of the result limit's 80 places.
        ...Array.from({ length: n }, (_, i) => doc(`/docs/notes/${i}`, `Note ${i}`, [], [1, 2, 3, 4].map((k) => `Execute intent ${i}, step ${k}.`))),
      ]);
      const results = await search("execute(Intent");
      expect(results.filter((r) => r.content === "execute").map((r) => r.url)).toEqual(["/docs/reference/vault#execute"]);
      const vault = results.findIndex((r) => r.id === "/docs/reference/vault");
      expect(results[vault + 1]).toMatchObject({ type: "heading", content: "execute" });
      expect(pagesOf(results)[0]).toBe("/docs/reference/vault");
    });
  }

  it("finds nothing for a name that no heading or prose holds, written as code or not", async () => {
    const search = await searchOver([doc("/docs/concepts/market-hours", "Market hours", ["Holidays"], ["The calendar lists each holiday."])]);
    expect(await search("civilFromDays")).toEqual([]);
    expect(await search("DateLib.civilFromDays(")).toEqual([]);
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

describe("section indexes are not search content", () => {
  const tree = docsTree(DOCS_DIR);
  const lines = sectionIndexLines(tree);
  const text = (section?: string) => componentText("SectionIndex", section === undefined ? {} : { section }, { exists: () => true, tree: () => tree });
  const contents = (data: ReturnType<typeof searchStructure>) => data.contents.map((c) => c.content);

  it("finds a section page by its purpose sentence: its cards repeat the titles and descriptions of pages found on their own", () => {
    for (const section of ["get-started", "concepts", "guides", "reference", "security", "help"]) {
      const data = searchStructure(`One sentence of purpose.\n\n${text(section)}\n`, [], `/docs/${section}`, lines);
      expect(contents(data), section).toEqual(["One sentence of purpose."]);
    }
  });

  it("keeps the rest of the docs home and its headings, without its map of the sections", () => {
    const markdown = `The lead.\n\n## Explore by section\n\n${text()}\n\n## Where to find things\n\n- **Search:** press Ctrl K.\n`;
    const toc = [{ url: "#explore-by-section" }, { url: "#where-to-find-things" }];
    const data = searchStructure(markdown, toc, "/docs", lines);
    expect(data.headings.map((h) => h.content)).toEqual(["Explore by section", "Where to find things"]);
    expect(contents(data)).toEqual(["The lead.", "**Search:** press Ctrl K."]);
  });

  it("leaves out whole lines only, and nothing inside a code fence", () => {
    const card = "- [MarketCalendar](/docs/reference/market-calendar): x";
    const omit = new Set([card]);
    const markdown = ["Before.", "", card, "", "```md", card, "```", "", `${card} and more.`].join("\n");
    expect(contents(searchStructure(markdown, [], "/docs/x", omit))).toEqual(["Before.", "MarketCalendar: x and more."]);
    expect(lines.has("**Contracts**")).toBe(true);
    expect(lines.has("")).toBe(false);
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
