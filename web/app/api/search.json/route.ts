import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/docs-source";
import { SEARCH_TOKENIZER } from "@/lib/docs/search";
import { searchStructure } from "@/lib/docs/search-index";

// Exported once at build time to out/api/search.json; the docs search dialog downloads it and searches in the browser.
// The .json extension lets hosts serve it as JSON, and compress it. Sorting is off: no search sorts by a field, and its
// tables would make the file about 40% larger.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source, {
  buildIndex: async (page) => ({
    id: page.url,
    url: page.url,
    title: page.data.title,
    description: page.data.description,
    structuredData: searchStructure(await page.data.getText("processed"), page.data.toc, page.url),
  }),
  tokenizer: SEARCH_TOKENIZER,
  sort: { enabled: false },
});
