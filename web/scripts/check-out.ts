import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  checkAbiFiles,
  checkDataFiles,
  checkDocsIndexes,
  checkDocsPage,
  checkExport,
  checkGapIndexPage,
  checkLandingIsolation,
  checkLedgerPage,
  checkLocalhost,
  checkMarkdownCopies,
  checkMarkdownCopy,
  checkNowPage,
  checkOgImage,
  checkSearchIndex,
  checkTextFiles,
  docsLocalhostUrls,
  SEARCH_INDEX_GZIP_BUDGET,
  shipsPublicly,
} from "../lib/check-out";
import rationales from "../content/generated/rationales.json";
import skill from "../content/generated/skill.json";
import { reasonsFile } from "../content/reasons";
import { deploymentConfig, deploymentsFile } from "../lib/chain/config";
import { ABI_NAMES, abiFile } from "../lib/docs/abi";
import { docsData } from "../lib/docs/generated";
import { siteUrl } from "../lib/site";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const DOCS_CONTENT = fileURLToPath(new URL("../content/docs/", import.meta.url));
const REQUIRED = [
  "index.html",
  "404.html",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico",
  "icon.png",
  "apple-icon.png",
  "opengraph-image.png",
  "now.html",
  "gap-index.html",
  "docs.html",
  "ledger.html",
  "api/search.json",
  "llms.txt",
  "llms-full.txt",
  "md/docs.md",
  "skill.md",
  "reasons.json",
];

const problems = REQUIRED.filter((f) => !existsSync(join(OUT, f))).map((f) => `missing out/${f}`);
const read = (file: string) => readFileSync(join(OUT, file), "utf8");
const isFile = (file: string) => existsSync(file) && statSync(file).isFile();
// A URL path the static host can answer from out/: a file (/llms.txt), a page (/docs/x is docs/x.html), or / itself.
const exported = (path: string) => {
  const file = join(OUT, decodeURIComponent(path));
  return isFile(file) || isFile(`${file}.html`) || isFile(join(file, "index.html"));
};

const index = join(OUT, "index.html");
if (existsSync(index)) {
  const html = read("index.html");
  problems.push(...checkExport(html));
  problems.push(...checkLandingIsolation(html, (url) => read(url)));
}

// The mainnet ledger: its static state follows the deployments table the build read, and the sitemap lists it.
if (existsSync(join(OUT, "ledger.html")) && existsSync(join(OUT, "sitemap.xml"))) {
  problems.push(
    ...checkLedgerPage({
      html: read("ledger.html"),
      vaultRecorded: deploymentConfig(docsData.deployments) !== null,
      sitemap: read("sitemap.xml"),
      url: new URL("/ledger", siteUrl()).href,
    }),
  );
}

// /now reads Base in the browser too: its export holds the reading state and no chain value. The sitemap lists it.
if (existsSync(join(OUT, "now.html"))) problems.push(...checkNowPage(read("now.html")));
const nowUrl = new URL("/now", siteUrl()).href;
if (existsSync(join(OUT, "sitemap.xml")) && !read("sitemap.xml").includes(`<loc>${nowUrl}</loc>`)) {
  problems.push(`sitemap.xml does not list ${nowUrl}`);
}

// /gap-index is built from the committed edition files, so its figures are in the HTML itself. The sitemap lists it.
if (existsSync(join(OUT, "gap-index.html"))) problems.push(...checkGapIndexPage(read("gap-index.html")));
const gapUrl = new URL("/gap-index", siteUrl()).href;
if (existsSync(join(OUT, "sitemap.xml")) && !read("sitemap.xml").includes(`<loc>${gapUrl}</loc>`)) {
  problems.push(`sitemap.xml does not list ${gapUrl}`);
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
  const html = readFileSync(file, "utf8");
  problems.push(...checkDocsPage(html, `out${url}.html`, known, exported));
  // Its own link preview image, out/og/docs/....png, which a link shared on X shows.
  problems.push(...checkOgImage(html, url, `out${url}.html`, (path) => (isFile(join(OUT, path)) ? readFileSync(join(OUT, path)) : undefined)));
  const md = `md${url}.md`;
  if (!existsSync(join(OUT, md))) problems.push(`missing out/${md}`);
  else {
    // No reference entry, table or diagram may be left as a raw component tag; llms-full.txt joins these same copies.
    problems.push(...checkMarkdownCopies(read(md), `out/${md}`));
    // The copy says what its page's header and Source of truth box say, so a page pasted elsewhere keeps its status.
    problems.push(...checkMarkdownCopy(html, read(md), `out/${md}`));
  }
}
// test/docs-ia.test.ts checks that every written page is in the IA; here, that the export has docs at all.
if (docsFiles.length === 0) problems.push("found no docs pages in out/");

// The same absolute URLs the routes write (both read siteUrl() from the same environment).
const INDEXES = ["llms.txt", "llms-full.txt", "sitemap.xml"];
if (INDEXES.every((f) => existsSync(join(OUT, f)))) {
  const urls = [...known].map((url) => new URL(url, siteUrl()).href);
  problems.push(...checkDocsIndexes({ llms: read("llms.txt"), llmsFull: read("llms-full.txt"), sitemap: read("sitemap.xml") }, urls, exported));
}

// The ABIs at /data/abi/*.json, each as its route writes it from content/generated/abi.json.
problems.push(
  ...checkAbiFiles(Object.fromEntries(ABI_NAMES.map((name) => [name, abiFile(name)])), (path) =>
    isFile(join(OUT, path)) ? read(path) : undefined,
  ),
);

// The ledger page's data, each as its route writes it from the generated sources.
problems.push(
  ...checkDataFiles({ "data/deployments.json": deploymentsFile(docsData.deployments), "data/rationales.json": rationales }, (path) =>
    isFile(join(OUT, path)) ? read(path) : undefined,
  ),
);

// The market-guard skill's SKILL.md at /skill.md, as its route writes it from content/generated/skill.json.
problems.push(...checkTextFiles({ "skill.md": skill }, (path) => (isFile(join(OUT, path)) ? read(path) : undefined)));

// Every refusal reason at /reasons.json, as its route writes it from content/reasons.ts.
problems.push(...checkDataFiles({ "reasons.json": reasonsFile(siteUrl()) }, (path) => (isFile(join(OUT, path)) ? read(path) : undefined)));

// On CI and on Vercel the export is about to ship, so no file may still link the localhost fallback of siteUrl().
if (shipsPublicly()) {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
  const allowed = docsLocalhostUrls(files(DOCS_CONTENT).filter((f) => f.endsWith(".mdx")).map((f) => readFileSync(f, "utf8")));
  const exportedFiles = existsSync(OUT) ? files(OUT) : [];
  problems.push(
    ...checkLocalhost(
      exportedFiles.map((f) => ({ path: `out/${relative(OUT, f).split(sep).join("/")}`, text: readFileSync(f, "utf8") })),
      allowed,
      siteUrl(),
    ),
  );
}

// The search index: within its gzipped budget, and every result opens an exported page and heading.
let searchGzipped: number | undefined;
if (existsSync(join(OUT, "api/search.json"))) {
  const searchIndex = readFileSync(join(OUT, "api/search.json"));
  searchGzipped = gzipSync(searchIndex).length;
  const page = (path: string) => (known.has(path) ? read(`${path.slice(1)}.html`) : undefined);
  problems.push(...checkSearchIndex(searchIndex.toString("utf8"), searchGzipped, page));
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`out/ is ready to deploy (landing, /now, /gap-index, /ledger and ${docsFiles.length} docs ${docsFiles.length === 1 ? "page" : "pages"} checked)`);
console.log(`search index: ${searchGzipped} bytes gzipped, budget ${SEARCH_INDEX_GZIP_BUDGET}`);
