import type { SortedResult } from "fumadocs-core/search";
import { components, type Tokenizer } from "zbsearch";

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
 * the title-first order, not seven.
 */
export const SEARCH_PARAMS = { limit: 80, groupBy: { properties: ["page_id"], maxResult: 4 } };

/**
 * The dialog's second search: the headings alone, with no per-page cap or result limit, so namedFirst finds a heading
 * that names the query however many longer records hold the same words. `type` is a string field, so the filter
 * matches its word.
 */
export const HEADING_SEARCH_PARAMS = { limit: Infinity, where: { type: "heading" }, groupBy: { properties: ["page_id"], maxResult: Infinity } };

/**
 * What the dialog lists before anything is typed: each reader's first page, in the order of READER_PATHS, then four
 * pages people look things up in. Each is labelled with its page title, as a result names it, not with the home page's
 * call to action; test/search.test.ts checks the order and every title.
 */
export const SEARCH_START_PAGES: readonly { label: string; url: string }[] = [
  { label: "What is Maat", url: "/docs/get-started/what-is-maat" },
  { label: "Read a decision", url: "/docs/get-started/read-a-decision" },
  { label: "Quickstart: verify Maat in five minutes", url: "/docs/get-started/quickstart" },
  { label: "Deploy your own vault", url: "/docs/guides/deploy-your-own-vault" },
  { label: "Security model", url: "/docs/security/model" },
  { label: "Refusal codes", url: "/docs/concepts/refusal-codes" },
  { label: "MandateVault", url: "/docs/reference/mandate-vault" },
  { label: "Agent configuration", url: "/docs/reference/agent-configuration" },
  { label: "Troubleshooting", url: "/docs/help/troubleshooting" },
];

/**
 * The results with the pages named for the query first: a page whose title holds every word of the query, then one
 * whose title holds some of them and that has a record holding all of them, then one with a heading that names the
 * query (namesQuery), then the rest. The engine's order is kept within each group, and each page keeps its records
 * under it. A title word matches a query word it starts with, the way the index matches the word a reader is still
 * typing.
 */
export function titleFirst(results: SortedResult[], query: string, tokenize: (text: string) => string[]): SortedResult[] {
  const terms = tokenize(query);
  if (terms.length === 0) return results;
  const holds = (text: string) => {
    const words = tokenize(text);
    return (term: string) => words.some((w) => w.startsWith(term));
  };
  const names = namesQuery(query, tokenize);
  const rank = ([page, ...records]: SortedResult[]) => {
    const inTitle = holds(page!.content);
    if (terms.every(inTitle)) return 0;
    if (terms.some(inTitle) && records.some((r) => terms.every(holds(r.content)))) return 1;
    if (records.some((r) => r.type === "heading" && names(r.content))) return 2;
    return 3;
  };
  const ranked = byPage(results).map((records) => ({ records, rank: rank(records) }));
  // Array.prototype.sort is stable, so equal ranks keep the engine's order.
  return ranked.sort((a, b) => a.rank - b.rank).flatMap((p) => p.records);
}

// An identifier, maybe after a qualifier ("MandateVault.") and in backticks, maybe followed by a call's "(" and more.
const CODE_NAME = /^`?(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)`?(?:\(.*)?$/;
// The contract a reference heading adds after a name that two contracts share: "supply (ICreditAdapter)".
const CONTRACT = /\s+\([^()]*\)$/;

/**
 * Whether a heading names the query exactly. A query written as code, an identifier with a call's "(", a qualifier's
 * "." or backticks ("execute(Intent", "MandateVault.execute", "`execute`"), names the heading that is that identifier,
 * in any case and maybe with its own backticks, its parameters or its contract: "execute", "supply (ICreditAdapter)",
 * not "executor", "Execution" or "Execute an intent". Plain words name a heading made of exactly those words, stemmed as
 * the index stems them: "environment variables" names "Environment variable", not "Set the environment variables".
 */
export function namesQuery(query: string, tokenize: (text: string) => string[]): (heading: string) => boolean {
  const code = CODE_NAME.exec(query.trim());
  if (code && /[`.(]/.test(query)) {
    const name = code[1]!.toLowerCase();
    return (heading) => CODE_NAME.exec(heading.trim().replace(CONTRACT, ""))?.[1]?.toLowerCase() === name;
  }
  const terms = new Set(tokenize(query));
  return (heading) => {
    const words = new Set(tokenize(heading));
    return terms.size > 0 && words.size === terms.size && [...words].every((w) => terms.has(w));
  };
}

/** The results split into pages: each page's own result, then its records. */
function byPage(results: SortedResult[]): SortedResult[][] {
  const pages: SortedResult[][] = [];
  for (const result of results) {
    if (result.type === "page" || pages.length === 0) pages.push([result]);
    else pages.at(-1)!.push(result);
  }
  return pages;
}

/**
 * The results with each heading that names the query (namesQuery) first under its page. `headings` is the dialog's
 * search of the headings alone (HEADING_SEARCH_PARAMS), which no per-page cap or result limit cuts: a heading the cap
 * left out comes back, and a page the limit left out comes back after the rest with those headings, for titleFirst to
 * place.
 */
export function namedFirst(results: SortedResult[], headings: SortedResult[], query: string, tokenize: (text: string) => string[]): SortedResult[] {
  const names = namesQuery(query, tokenize);
  const named = new Map<string, SortedResult[]>();
  for (const [page, ...records] of byPage(headings)) {
    const found = records.filter((r) => r.type === "heading" && names(r.content));
    if (found.length > 0) named.set(page!.id, [page!, ...found]);
  }
  if (named.size === 0) return results;
  const pages = byPage(results).map(([page, ...records]) => {
    const [, ...first] = named.get(page!.id) ?? [];
    named.delete(page!.id);
    return [page!, ...first, ...records.filter((r) => !first.some((f) => f.id === r.id))];
  });
  return [...pages, ...named.values()].flat();
}
