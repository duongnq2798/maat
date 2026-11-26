import type { SortedResult } from "fumadocs-core/search";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import { create } from "zbsearch";
import { HEADING_SEARCH_PARAMS, namedFirst, SEARCH_PARAMS, searchTokenizer, titleFirst } from "./search";

/**
 * The dialog's search over the index at `from`, which the static client downloads once and searches in the browser:
 * the index's results, with each heading that names the query first under its page (namedFirst), in title-first order.
 * The index was built with this tokenizer's settings (app/api/search.json/route.ts); queries and titles use it too.
 */
export function docsSearch(from: string): (query: string) => Promise<SortedResult[]> {
  const tokenizer = searchTokenizer();
  const tokenize = (text: string) => tokenizer.tokenize(text);
  const initDB = () => create({ schema: { _: "string" }, components: { tokenizer } });
  // One download for both: the static client keeps one index per URL.
  const client = staticClient({ from, initDB, search: SEARCH_PARAMS });
  const headings = staticClient({ from, initDB, search: HEADING_SEARCH_PARAMS });
  return async (query) => {
    const [results, named] = await Promise.all([client.search(query), headings.search(query)]);
    return titleFirst(namedFirst(results, named, query, tokenize), query, tokenize);
  };
}
