import { metaSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { docsFrontmatter } from "./lib/docs/frontmatter";
import { remarkComponentText } from "./lib/docs/remark-component-text";
import { remarkFacts } from "./lib/docs/remark-facts";

const DOCS_DIR = "content/docs";

export const docs = defineDocs({
  dir: DOCS_DIR,
  docs: {
    schema: docsFrontmatter,
    // Exposes page.data.getText("processed"): the Markdown behind llms-full.txt, /md/*.md and the reading time.
    // headingIds: false drops the Fumadocs-only "## Title [#id]" syntax, so it reads as plain Markdown.
    postprocess: { includeProcessedMarkdown: { headingIds: false } },
  },
  meta: { schema: metaSchema },
});

export default defineConfig({
  mdxOptions: {
    // First, before Fumadocs' plugins, so the TOC, the search index and the processed Markdown see the values.
    // remarkComponentText follows: it leaves the tree alone and gives each reference entry, table and diagram its text in
    // the processed Markdown (/md/*.md and llms-full.txt); the HTML still renders the real components.
    remarkPlugins: (plugins) => [remarkFacts, [remarkComponentText, { docsDir: DOCS_DIR }], ...plugins],
    // The default github-light keywords (#D73A49) and github-dark comments (#6A737D) fall below 4.5:1 on the docs
    // code background. The high-contrast pair passes in both themes. defaultColor: false keeps both as CSS variables.
    rehypeCodeOptions: {
      themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
      defaultColor: false,
    },
  },
});
