import type { SortedResult } from "fumadocs-core/search";
import { components, type Tokenizer } from "zbsearch";
import { READER_PATHS } from "./reader-paths";

/** Where the build writes the search index (app/api/search.json/route.ts) and the dialog downloads it. */
export const SEARCH_INDEX_URL = "/api/search.json";

/**
 * One tokenizer for the index and for what the reader types: English words, stemmed, so "splits" finds "split" and
 * "environment variables" finds "environment variable". The build and the dialog must agree, or a stemmed index misses
 * unstemmed queries.
 */
export const SEARCH_TOKENIZER = { language: "english", stemming: true } as const;

/** A tokenizer with the index's settings, for the dialog's database and its title-first order. */
export function searchTokenizer(): Tokenizer {
  return components.tokenizer.createTokenizer({ ...SEARCH_TOKENIZER });
}

/**
 * At most four records per page instead of Fumadocs' eight, in 80 results instead of 60, so about eighteen pages reach
 * the title-first order, not seven, and a function's heading is still among its page's records.
 */
export const SEARCH_PARAMS = { limit: 80, groupBy: { properties: ["page_id"], maxResult: 4 } };

/** What the dialog lists before anything is typed: each reader's first page, then four pages people look things up in. */
export const SEARCH_START_PAGES: readonly { label: string; url: string }[] = [
  ...READER_PATHS.map((p) => ({ label: p.cta, url: `/docs/${p.slug}` })),
  { label: "Refusal codes", url: "/docs/concepts/refusal-codes" },
  { label: "MandateVault", url: "/docs/reference/mandate-vault" },
  { label: "Agent configuration", url: "/docs/reference/agent-configuration" },
  { label: "Troubleshooting", url: "/docs/help/troubleshooting" },
];

/**
 * The results with the pages named for the query first: a page whose title holds every word of the query, then one
 * whose title holds some of them and that has a record holding all of them, then the rest. The engine's order is kept
 * within each group, and each page keeps its records under it. A title word matches a query word it starts with, the
 * way the index matches the word a reader is still typing.
 */
export function titleFirst(results: SortedResult[], query: string, tokenize: (text: string) => string[]): SortedResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return results;
  const holds = (text: string) => {
    const words = tokenize(text);
    return (term: string) => words.some((w) => w.startsWith(term));
  };
  const pages: SortedResult[][] = [];
  for (const result of results) {
    if (result.type === "page" || pages.length === 0) pages.push([result]);
    else pages.at(-1)!.push(result);
  }
  const rank = ([page, ...records]: SortedResult[]) => {
    const inTitle = holds(page!.content);
    if (terms.every(inTitle)) return 0;
    if (terms.some(inTitle) && records.some((r) => terms.every(holds(r.content)))) return 1;
    return 2;
  };
  const ranked = pages.map((records) => ({ records, rank: rank(records) }));
  // Array.prototype.sort is stable, so equal ranks keep the engine's order.
  return ranked.sort((a, b) => a.rank - b.rank).flatMap((p) => p.records);
}
