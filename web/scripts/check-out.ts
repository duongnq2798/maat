import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  checkDocsIndexes,
  checkDocsPage,
  checkExport,
  checkLandingIsolation,
  checkMarkdownCopies,
  checkSearchIndex,
  SEARCH_INDEX_GZIP_BUDGET,
} from "../lib/check-out";
import { siteUrl } from "../lib/site";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const REQUIRED = [
  "index.html",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "icon.png",
  "apple-icon.png",
  "opengraph-image.png",
  "docs.html",
  "api/search.json",
  "llms.txt",
  "llms-full.txt",
  "md/docs.md",
];

const problems = REQUIRED.filter((f) => !existsSync(join(OUT, f))).map((f) => `missing out/${f}`);
const read = (file: string) => readFileSync(join(OUT, file), "utf8");

const index = join(OUT, "index.html");
if (existsSync(index)) {
  const html = read("index.html");
  problems.push(...checkExport(html));
  problems.push(...checkLandingIsolation(html, (url) => read(url)));
}

// Every docs page: out/docs.html plus out/docs/**/*.html, each with its .md copy for "Copy page as Markdown".
const walk = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : [],
      )
    : [];
const docsFiles = [join(OUT, "docs.html"), ...walk(join(OUT, "docs"))].filter((f) => existsSync(f));
const urlOf = (file: string) => `/${relative(OUT, file).split(sep).join("/").replace(/\.html$/, "")}`;
const known = new Set(docsFiles.map(urlOf));
for (const file of docsFiles) {
  const url = urlOf(file);
  problems.push(...checkDocsPage(readFileSync(file, "utf8"), `out${url}.html`, known));
  const md = `md${url}.md`;
  if (!existsSync(join(OUT, md))) problems.push(`missing out/${md}`);
  // No reference entry, table or diagram may be left as a raw component tag; llms-full.txt joins these same copies.
  else problems.push(...checkMarkdownCopies(read(md), `out/${md}`));
}
// test/docs-ia.test.ts checks that every written page is in the IA; here, that the export has docs at all.
if (docsFiles.length === 0) problems.push("found no docs pages in out/");

// The same absolute URLs the routes write (both read siteUrl() from the same environment).
const INDEXES = ["llms.txt", "llms-full.txt", "sitemap.xml"];
if (INDEXES.every((f) => existsSync(join(OUT, f)))) {
  const urls = [...known].map((url) => new URL(url, siteUrl()).href);
  problems.push(...checkDocsIndexes({ llms: read("llms.txt"), llmsFull: read("llms-full.txt"), sitemap: read("sitemap.xml") }, urls));
}

// The search index: within its gzipped budget, and every result opens an exported page and heading.
let searchGzipped: number | undefined;
if (existsSync(join(OUT, "api/search.json"))) {
  const index = readFileSync(join(OUT, "api/search.json"));
  searchGzipped = gzipSync(index).length;
  const page = (path: string) => (known.has(path) ? read(`${path.slice(1)}.html`) : undefined);
  problems.push(...checkSearchIndex(index.toString("utf8"), searchGzipped, page));
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`out/ is ready to deploy (landing and ${docsFiles.length} docs ${docsFiles.length === 1 ? "page" : "pages"} checked)`);
console.log(`search index: ${searchGzipped} bytes gzipped, budget ${SEARCH_INDEX_GZIP_BUDGET}`);
