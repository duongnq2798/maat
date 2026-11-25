import { isDeepStrictEqual } from "node:util";
import { MOMENTS } from "../content/engine";
import { formatHours, PUBLISHED } from "../content/gap-index";
import { DEFAULT_SCENARIO, evaluate, replay } from "../content/simulator";
import { DATA_COMPONENTS } from "./docs/data-components";
import { INDEX_NOTE_START, markdownLines, markdownUrl } from "./docs/markdown";
import { OG_IMAGE_SIZE, ogImageUrl } from "./docs/og";
import { SITE } from "./site";

/** Problems with the exported landing page; an empty list means it is ready to ship. */
export function checkExport(html: string): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };

  need(html.includes('<html lang="en"'), 'missing <html lang="en">');
  need(html.includes(`<title>${SITE.title}</title>`), "title does not match SITE.title");
  need(html.includes(`<meta name="description" content="${SITE.description}"/>`), "meta description does not match SITE.description");
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  need(og !== undefined && /^https?:\/\//.test(og), "og:image is missing or not an absolute URL");
  need(html.includes('<meta name="twitter:card" content="summary_large_image"/>'), "twitter:card is not summary_large_image");
  need(html.includes(`<meta name="twitter:site" content="${SITE.xHandle}"/>`), "twitter:site is not the X handle");

  // Crawlers, link previews and no-JS readers never hydrate: the default moment must be in the HTML itself.
  // The verdict is read from the live region's own card; the text "Refused" alone also matches a ledger filter chip.
  const sat = MOMENTS.sat;
  const verdict = sat.allowed ? "allowed" : "refused";
  need(
    new RegExp(`aria-pressed="true"[^>]*>${sat.toggleLabel}<`).test(html),
    `${sat.toggleLabel} is not the pressed moment in the exported HTML`,
  );
  need(
    new RegExp(`role="status"[^>]*><div[^>]*\\sdata-verdict="${verdict}"[^>]*\\sdata-reason="${sat.reason}"`).test(html),
    `the ${sat.toggleLabel} verdict (${verdict} · ${sat.reason}) is not in the exported HTML`,
  );

  // The simulator opens on the fork's allowed BUY; no-JS readers see that verdict in its own live region.
  const sim = evaluate(replay(DEFAULT_SCENARIO.etDay, DEFAULT_SCENARIO.tape), DEFAULT_SCENARIO.intent);
  const simVerdict = sim.allowed ? "allowed" : "refused";
  const tryAt = html.indexOf(' id="try"');
  need(tryAt >= 0, "the simulator section #try is missing");
  need(
    tryAt >= 0 &&
      new RegExp(`role="status"[^>]*><div[^>]*\\sdata-verdict="${simVerdict}"[^>]*\\sdata-reason="${sim.reason}"`).test(
        html.slice(tryAt),
      ),
    `the simulator's default verdict (${simVerdict} · ${sim.reason}) is not in the exported HTML`,
  );

  // The live strip reads Base in the browser: the export holds its reading state and never a chain value, a live pill or a
  // verdict.
  need(html.includes("Reading Base mainnet"), "the live strip's reading state is not in the exported HTML");
  need(!html.includes(">LIVE<"), "the exported HTML shows a LIVE pill, so a reading was baked into the page");
  need(!html.includes("basescan.org/block/"), "the exported HTML links a Base block, so a reading was baked into the page");
  need(!html.includes("data-verdict-line"), "the exported HTML holds a verdict line, so a reading was baked into the page");

  for (const [, id] of html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)) {
    need(html.includes(` id="${id}"`), `link #${id} has no target`);
  }
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    need((src ?? "").startsWith("/_next/"), `third-party script: ${src}`);
  }
  need(!/fonts\.(googleapis|gstatic)\.com/.test(html), "the page loads Google Fonts at runtime");
  return problems;
}

/** Records `problem` when `ok` is false. Each page's check passes its own, which puts the page's name before it. */
type Need = (ok: boolean, problem: string) => void;

/**
 * The tags a search result and a link preview read, which /now, /gap-index and every docs page must have: a meta
 * description of 50 to 160 characters and an absolute og:image.
 */
function needDescriptionAndOgImage(html: string, need: Need): void {
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
  // An entity such as &#x27; counts as one character.
  const length = description?.replace(/&[^;\s]+;/g, "x").length ?? 0;
  need(length >= 50 && length <= 160, `meta description is ${description === undefined ? "missing" : `${length} characters`}, want 50 to 160`);
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  need(og !== undefined && /^https?:\/\//.test(og), "og:image is missing or not an absolute URL");
}

/** The /now page's h1; its title is this, then the site's name. */
const NOW_HEADING = "Right now on Base";

/**
 * Problems with the exported /now page (out/now.html); an empty list means it is ready to ship. Like the landing's live
 * strip, it reads Base in the browser, so its HTML holds the reading state and never a chain value, a live pill or a
 * verdict: the method, the addresses and the thresholds are not readings and may be there.
 */
export function checkNowPage(html: string): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(`out/now.html: ${problem}`);
  };

  need(html.includes('<html lang="en"'), 'missing <html lang="en">');
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  need(title === `${NOW_HEADING} · ${SITE.name}`, `title "${title ?? ""}" is not "${NOW_HEADING} · ${SITE.name}"`);
  needDescriptionAndOgImage(html, need);
  need(/<link rel="canonical" href="https?:\/\/[^"/]+\/now"/.test(html), "the canonical link is missing, not absolute or not /now");
  need(new RegExp(`<h1[^>]*>${NOW_HEADING}</h1>`).test(html), `the h1 is not "${NOW_HEADING}"`);

  need(html.includes("Reading Base mainnet"), "the board's reading state is not in the exported HTML");
  need(!html.includes(">LIVE<"), "the exported HTML shows a LIVE pill, so a reading was baked into the page");
  need(!html.includes("basescan.org/block/"), "the exported HTML links a Base block, so a reading was baked into the page");
  need(!html.includes("data-verdict-line"), "the exported HTML holds a verdict line, so a reading was baked into the page");

  for (const [, id] of html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)) {
    need(html.includes(` id="${id}"`), `link #${id} has no target`);
  }
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    need((src ?? "").startsWith("/_next/"), `third-party script: ${src}`);
  }
  need(!/fonts\.(googleapis|gstatic)\.com/.test(html), "the page loads Google Fonts at runtime");
  return problems;
}

/** The /gap-index page's h1; its title is this, then the site's name. */
const GAP_INDEX_HEADING = "Weekend Gap Index";

/** The NVDAc hours of the first complete window the page shows, as the page writes them, or null before any. */
function firstNvdaHours(): string | null {
  for (const w of PUBLISHED.flatMap((e) => e.windows)) {
    if (w.status !== "complete") continue;
    const hours = w.tokens.find((t) => t.symbol === "NVDAc")?.freeze?.hours;
    return hours === undefined ? null : formatHours(hours);
  }
  return null;
}

/**
 * Problems with the exported /gap-index page (out/gap-index.html); an empty list means it is ready to ship. Its figures
 * come from the committed edition files at build time, so they must be in the HTML itself, for readers without
 * JavaScript and for crawlers.
 */
export function checkGapIndexPage(html: string): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(`out/gap-index.html: ${problem}`);
  };

  need(html.includes('<html lang="en"'), 'missing <html lang="en">');
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  need(title === `${GAP_INDEX_HEADING} · ${SITE.name}`, `title "${title ?? ""}" is not "${GAP_INDEX_HEADING} · ${SITE.name}"`);
  needDescriptionAndOgImage(html, need);
  need(/<link rel="canonical" href="https?:\/\/[^"/]+\/gap-index"/.test(html), "the canonical link is missing, not absolute or not /gap-index");
  need(new RegExp(`<h1[^>]*>${GAP_INDEX_HEADING}</h1>`).test(html), `the h1 is not "${GAP_INDEX_HEADING}"`);
  // Looked for in the markup alone: the inline scripts carry React's copy of the page, which a reader without
  // JavaScript and a crawler never see.
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const hours = firstNvdaHours();
  need(hours === null || markup.includes(hours), `NVDAc's ${hours} in the first complete window is not in the exported markup`);
  need(!/safe/i.test(html), 'the page says "safe"');

  for (const [, id] of html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)) {
    need(html.includes(` id="${id}"`), `link #${id} has no target`);
  }
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    need((src ?? "").startsWith("/_next/"), `third-party script: ${src}`);
  }
  need(!/fonts\.(googleapis|gstatic)\.com/.test(html), "the page loads Google Fonts at runtime");
  return problems;
}

/**
 * Problems with one exported docs page. `known` holds the URL path of every exported docs page (/docs, /docs/x).
 * `exported` says whether a URL path outside /docs is a file in out/ (/, /llms.txt, /data/abi/x.json).
 */
export function checkDocsPage(html: string, path: string, known: ReadonlySet<string>, exported?: (path: string) => boolean): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(`${path}: ${problem}`);
  };

  need(html.includes('<html lang="en"'), 'missing <html lang="en">');
  // The title template of app/(docs)/layout.tsx; the docs home, out/docs.html, is titled with the docs center's name alone.
  const suffix = ` · ${SITE.name} Docs`;
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  if (path === "out/docs.html") need(title === `${SITE.name} Docs`, `title "${title}" is not "${SITE.name} Docs"`);
  else need(title.endsWith(suffix) && title.length > suffix.length, `title "${title}" does not end with "${suffix}"`);
  needDescriptionAndOgImage(html, need);
  need(/<link rel="canonical" href="https?:\/\/[^"]+"/.test(html), "canonical link is missing or not absolute");
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    need((src ?? "").startsWith("/_next/"), `third-party script: ${src}`);
  }
  need(!/fonts\.(googleapis|gstatic)\.com/.test(html), "the page loads Google Fonts at runtime");
  // MDX puts a block component written without blank lines around it inside a <p>, which breaks hydration.
  need(!/<p(?:\s[^>]*)?>(?:(?!<\/p>)[\s\S])*?<(?:div|figure|table|ul|ol|pre)[\s>]/.test(html), "a block element is inside a paragraph (add blank lines around the MDX component)");
  for (const [, id] of html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)) {
    need(html.includes(` id="${id}"`), `link #${id} has no target`);
  }
  for (const [, href] of html.matchAll(/<a[^>]*\shref="(\/docs[^"#?]*)/g)) {
    need(known.has(href!.replace(/(.)\/$/, "$1")), `link ${href} points to no exported docs page`);
  }
  // Every other link to the site itself: the landing page and the files beside the pages, such as the ABIs.
  if (exported) {
    for (const [, href] of html.matchAll(/<a[^>]*\shref="(\/(?!\/|docs[/"#?])[^"#?]*)/g)) {
      need(exported(href!), `link ${href} points to no exported file`);
    }
  }
  return problems;
}

/**
 * Problems with the link preview of one exported docs page, whose URL path is `pageUrl` (/docs, /docs/x). Its og:image
 * and twitter:image both name the page's own image (lib/docs/og.ts), so a shared link shows this page and no other, and
 * that file is a PNG in out/ of the size the tags give. `read` returns an exported file by its path under out/, or
 * undefined. `path` names the page in each problem.
 */
export function checkOgImage(html: string, pageUrl: string, path: string, read: (path: string) => Buffer | undefined): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(`${path}: ${problem}`);
  };
  const own = ogImageUrl(pageUrl);
  for (const [name, attribute] of [["og:image", "property"], ["twitter:image", "name"]] as const) {
    const url = new RegExp(`<meta ${attribute}="${name}" content="([^"]+)"`).exec(html)?.[1];
    // An absolute URL whose path is the page's own image; checkDocsPage already wants og:image absolute.
    need(url !== undefined && /^https?:\/\/[^/]+(\/[^?#]*)/.exec(url)?.[1] === own, `${name} is ${url ?? "missing"}, not the page's own image ${own}`);
  }
  const { width, height } = OG_IMAGE_SIZE;
  const tag = (name: string) => new RegExp(`<meta property="og:image:${name}" content="([^"]*)"`).exec(html)?.[1] ?? "none";
  const said = `${tag("width")}x${tag("height")}`;
  need(said === `${width}x${height}`, `og:image:width and og:image:height say ${said}, want ${width}x${height}`);
  const file = read(own.slice(1));
  if (file === undefined) need(false, `missing out${own}`);
  else if (file.length < 24 || file.readUInt32BE(0) !== 0x89504e47 || file.readUInt32BE(4) !== 0x0d0a1a0a) need(false, `out${own} is not a PNG`);
  else {
    const size = `${file.readUInt32BE(16)}x${file.readUInt32BE(20)}`;
    need(size === `${width}x${height}`, `out${own} is ${size}, want ${width}x${height}`);
  }
  return problems;
}

/** Strings only the docs bundle contains. One of them in the landing's CSS or JS means docs code leaked in. */
export const DOCS_MARKERS = ["--color-fd-", "nd-docs-layout", "fumadocs", "next-themes", "zbsearch"] as const;

/** Problems with the landing's isolation from the docs. `read` returns the text of an exported file by URL path. */
export function checkLandingIsolation(html: string, read: (url: string) => string): string[] {
  const assets = [
    ...[...html.matchAll(/<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]!),
  ];
  if (assets.length === 0) return ["the landing links no CSS or JS, so isolation cannot be checked"];
  const problems: string[] = [];
  for (const url of assets) {
    const text = read(url.split("?")[0]!);
    for (const marker of DOCS_MARKERS) if (text.includes(marker)) problems.push(`landing asset ${url} contains "${marker}"`);
  }
  return problems;
}

/**
 * Problems with the machine-readable copies of the docs. `urls` holds the absolute URL of every exported docs page;
 * `exported` says whether a URL path is a file in out/. llms.txt gives the status under its summary and links each
 * page's Markdown copy, with the web page after it, and each of its links on the site leads to an exported file and
 * never to a docs web page.
 */
export function checkDocsIndexes(
  files: { llms: string; llmsFull: string; sitemap: string },
  urls: readonly string[],
  exported: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  if (!/^> .+\n\nStatus: \S/m.test(files.llms)) problems.push("llms.txt has no Status line under its summary");
  for (const url of urls) {
    const md = new URL(markdownUrl(new URL(url).pathname), url).href;
    if (!files.llms.includes(`](${md})`)) problems.push(`llms.txt does not link the Markdown copy ${md}`);
    if (!files.llms.includes(`Web page: ${url}\n`)) problems.push(`llms.txt does not give the web page ${url}`);
    if (!files.llmsFull.includes(`URL: ${url}\n`)) problems.push(`llms-full.txt has no page with URL ${url}`);
    if (!files.sitemap.includes(`<loc>${url}</loc>`)) problems.push(`sitemap.xml does not list ${url}`);
  }
  const origin = urls[0] && new URL(urls[0]).origin;
  for (const [, link] of files.llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    const target = new URL(link!);
    if (target.origin !== origin) continue;
    if (!exported(target.pathname)) problems.push(`llms.txt links ${link}, which is not in out/`);
    // A tool reads the Markdown copy, not the HTML with its navigation; "Web page:" names the HTML as text, not a link.
    if (target.pathname === "/docs" || target.pathname.startsWith("/docs/")) {
      problems.push(`llms.txt links the web page ${link}: link its Markdown copy ${new URL(markdownUrl(target.pathname), target).href}`);
    }
  }
  if (files.llmsFull.includes(INDEX_NOTE_START)) problems.push("llms-full.txt repeats the index note of the pages' own Markdown files");
  return problems;
}

/** The header line of a Markdown copy: the paragraph after its URL line. */
const copyFrame = (md: string) => /^URL: [^\n]*\n\n([^\n]*)/m.exec(md)?.[1] ?? "";

/**
 * Problems with the Markdown copy (out/md/...md) of one exported docs page, against the page's HTML: it opens with the
 * index note, gives the status label and review date the page's header shows and no other, and ends with the files of
 * the page's Source of truth box, in its order. `path` names the copy in each problem.
 */
export function checkMarkdownCopy(html: string, md: string, path: string): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(`${path} ${problem}`);
  };
  need(md.startsWith(INDEX_NOTE_START), "does not open with the index note");
  const frame = copyFrame(md);
  const label = /aria-label="Status: ([^"]+)\. What this label means"/.exec(html)?.[1];
  if (label) need(frame.startsWith(`Status: ${label}. `), `does not say "Status: ${label}." after its URL, as its page does`);
  else need(!frame.startsWith("Status: "), "gives a Status line, but its page shows no status label");
  const reviewed = /Last reviewed <time dateTime="([0-9-]+)"/.exec(html)?.[1];
  if (reviewed) need(frame.endsWith(`Last reviewed: ${reviewed}.`), `does not say "Last reviewed: ${reviewed}." after its URL, as its page does`);
  else need(!frame.includes("Last reviewed: "), "gives a review date, but its page shows none");
  const box = /<aside aria-labelledby="source-of-truth"[\s\S]*?<\/aside>/.exec(html)?.[0];
  const listed = md.split("\n## Source of truth\n")[1];
  if (box) {
    const files = [...box.matchAll(/<a href="([^"]+\/blob\/main\/[^"]+)"/g)].map(([, href]) => `](${href})`);
    const links = [...(listed ?? "").matchAll(/\]\([^)\s]+\)/g)].map(([link]) => link);
    need(files.length > 0 && links.join("\n") === files.join("\n"), "does not list the page's Source of truth files");
  } else need(listed === undefined, "lists Source of truth files, but its page has no Source of truth box");
  return problems;
}

/**
 * Problems with the published ABIs: each out/data/abi/<name>.json must hold the JSON its route writes from the committed
 * copy of agent/src/abi/generated.ts. `read` returns an exported file's text by its path under out/, or undefined.
 */
export function checkAbiFiles(expected: Readonly<Record<string, unknown>>, read: (path: string) => string | undefined): string[] {
  const problems: string[] = [];
  for (const [name, file] of Object.entries(expected)) {
    const path = `data/abi/${name}.json`;
    const text = read(path);
    if (text === undefined) {
      problems.push(`missing out/${path}`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      problems.push(`out/${path} is not JSON`);
      continue;
    }
    if (!isDeepStrictEqual(json, file)) problems.push(`out/${path} is not the committed ABI (run npm run docs:gen and build again)`);
  }
  return problems;
}

/** Each generated data file in out/ (keyed by its path, such as data/deployments.json), parsed, equals its source. */
export function checkDataFiles(expected: Readonly<Record<string, unknown>>, read: (path: string) => string | undefined): string[] {
  const problems: string[] = [];
  for (const [path, data] of Object.entries(expected)) {
    const text = read(path);
    if (text === undefined) {
      problems.push(`missing out/${path}`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      problems.push(`out/${path} is not JSON`);
      continue;
    }
    if (!isDeepStrictEqual(json, data)) problems.push(`out/${path} is not its generated source (run npm run docs:gen and build again)`);
  }
  return problems;
}

/**
 * Each text file in out/ (keyed by its path, such as skill.md) is exactly the text of its generated copy, which names
 * its source file in the repo.
 */
export function checkTextFiles(
  expected: Readonly<Record<string, { readonly source: string; readonly text: string }>>,
  read: (path: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  for (const [path, { source, text }] of Object.entries(expected)) {
    const got = read(path);
    if (got === undefined) problems.push(`missing out/${path}`);
    else if (got !== text) problems.push(`out/${path} is not ${source} (run npm run docs:gen and build again)`);
  }
  return problems;
}

type Env = Record<string, string | undefined>;

/** Whether this run checks an export that is about to ship: on CI, or in a Vercel build. */
export function shipsPublicly(env: Env = process.env): boolean {
  return Boolean(env.CI?.trim() || env.VERCEL?.trim());
}

/** Every http://localhost URL in a text, without the punctuation that ends a sentence or closes a quote. */
function localhostUrls(text: string): string[] {
  return [...text.matchAll(/http:\/\/localhost[^\s"'<>()[\]`\\]*/g)].map(([url]) => url.replace(/[.,;:!?]+$/, ""));
}

/** Host names that only ever mean the machine the build ran on. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Problems with exported files that name an http://localhost URL. A build that sets neither NEXT_PUBLIC_SITE_URL nor
 * the Vercel domain falls back to localhost (lib/site.ts), and every absolute link it writes then leads nowhere: llms.txt,
 * the sitemap, the Markdown copies, canonical and Open Graph URLs. `allowed` holds the localhost URLs the docs write in
 * their own text, such as the quickstart's dev server, which stay. One problem per file, with its first such URL.
 * `site` is the site URL the export was built for (siteUrl()). On loopback it is a problem by itself: the fallback is the
 * bare origin http://localhost:3000, the same URL the quickstart writes, so a file whose only leak is that origin, such
 * as the landing page's canonical URL, would pass the file scan alone.
 */
export function checkLocalhost(files: Iterable<{ path: string; text: string }>, allowed: ReadonlySet<string>, site: URL): string[] {
  const fix = "set NEXT_PUBLIC_SITE_URL to the public site and build again";
  const problems: string[] = [];
  if (LOOPBACK_HOSTS.has(site.hostname)) problems.push(`the site URL is ${site.href}: ${fix}`);
  for (const { path, text } of files) {
    const url = localhostUrls(text).find((u) => !allowed.has(u));
    if (url) problems.push(`${path} links ${url}: ${fix}`);
  }
  return problems;
}

/** The localhost URLs that the docs pages write in their text (content/docs/**.mdx), which a public export keeps. */
export function docsLocalhostUrls(mdx: Iterable<string>): Set<string> {
  return new Set([...mdx].flatMap(localhostUrls));
}

/**
 * Gzipped bytes the search index may take. The budget was set at 760,000, 691,009 plus about 10%. A local build of the
 * merge that added the docs on the invariant suite, the malformed-ABI tests and the calendar vectors measured 773,483,
 * so it was raised to that plus about 10%. The CI build of the branch that makes the agent read its Claude key from
 * agent/.env measured 850,415, so it is now that plus about 10%. A bigger index is a choice to make here, not an
 * accident: every reader downloads it before their first result, often on a phone.
 */
export const SEARCH_INDEX_GZIP_BUDGET = 935_000;

/**
 * Problems with the exported search index (out/api/search.json): over its gzipped budget, empty, or with a result
 * that opens a docs page that was not exported, or a heading its page does not have. `page` returns the HTML of an
 * exported docs page by URL path (/docs, /docs/x), or undefined.
 */
export function checkSearchIndex(json: string, gzipped: number, page: (path: string) => string | undefined): string[] {
  const problems: string[] = [];
  if (gzipped > SEARCH_INDEX_GZIP_BUDGET) {
    problems.push(`out/api/search.json is ${gzipped} bytes gzipped, over its budget of ${SEARCH_INDEX_GZIP_BUDGET}`);
  }
  const records = Object.values((JSON.parse(json) as { docs: { docs: Record<string, { url: string }> } }).docs.docs);
  if (records.length === 0) problems.push("out/api/search.json holds no search records");
  for (const url of new Set(records.map((r) => r.url))) {
    const [path = "", id] = url.split("#");
    const html = page(path);
    if (html === undefined) problems.push(`out/api/search.json: result ${url} points to no exported docs page`);
    else if (id !== undefined && !html.includes(` id="${id}"`)) problems.push(`out/api/search.json: result ${url} has no heading with that id on its page`);
  }
  return problems;
}

const DATA_TAG = new RegExp(`<(${DATA_COMPONENTS.join("|")})(?![\\w$])`, "g");

/**
 * Problems with the Markdown copies of the docs (the text of one page, or of all of them): one per data component
 * tag still in the text, outside code fences. Callout, Steps and Step stay, because their tags wrap real text.
 * `path` names the file in each problem, so a leak is not just a line number.
 */
export function checkMarkdownCopies(text: string, path?: string): string[] {
  const problems: string[] = [];
  const where = path ? `${path} ` : "";
  markdownLines(text).forEach(({ text: line, inFence }, i) => {
    if (inFence) return;
    for (const [, name] of line.matchAll(DATA_TAG)) problems.push(`${where}line ${i + 1}: <${name}> was left in the Markdown instead of its text`);
  });
  return problems;
}

/**
 * Problems with out/ledger.html: its static state matches the build's deployments table (the waiting view while no
 * vault is recorded, a connecting line and no chain reading once one is, since the browser reads Base), it has the
 * description and OG image the other pages need, it names its canonical URL, its in-page links have targets, it loads
 * no third-party script or Google Fonts, and the sitemap lists it.
 */
export function checkLedgerPage(opts: { html: string; vaultRecorded: boolean; sitemap: string; url: string }): string[] {
  const { html, vaultRecorded, sitemap, url } = opts;
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(problem);
  };
  const waiting = html.includes("Waiting for the mainnet deploy");
  if (vaultRecorded) {
    need(!waiting, "out/ledger.html shows the waiting state, but a vault is recorded");
    need(html.includes("Connecting to Base"), "out/ledger.html does not show the connecting line, but a vault is recorded");
    need(!html.includes("Reading Base mainnet"), "out/ledger.html has a chain reading in its HTML (Reading Base mainnet)");
    need(!html.includes("basescan.org/tx/"), "out/ledger.html has a chain reading in its HTML (a Basescan transaction link)");
  } else need(waiting, "out/ledger.html does not show the waiting state, but no vault is recorded");
  needDescriptionAndOgImage(html, (ok, problem) => need(ok, `out/ledger.html: ${problem}`));
  need(!/fonts\.(googleapis|gstatic)\.com/.test(html), "out/ledger.html: the page loads Google Fonts at runtime");
  need(/<link rel="canonical" href="[^"]*\/ledger"/.test(html), "out/ledger.html has no canonical URL ending in /ledger");
  for (const [, id] of html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)) {
    need(html.includes(` id="${id}"`), `out/ledger.html: link #${id} has no target`);
  }
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    need((src ?? "").startsWith("/_next/"), `out/ledger.html: third-party script ${src}`);
  }
  need(sitemap.includes(`<loc>${url}</loc>`), `out/sitemap.xml does not list ${url}`);
  return problems;
}

/** The /proof page's h1; its title is this, then the site's name. */
const PROOF_HEADING = "Proof";
/** A sentence of the counting rule, which the page must carry in its markup for readers without JavaScript. */
const PROOF_RULE_MARK = "No line is ever added to another.";
/** The brief lines, by the data-testid of their value; the bounty line comes from a committed list, not the chain. */
const PROOF_BRIEF_LINES = ["outside-briefs", "outside-wallets", "verified", "team-briefs", "hidden-briefs"];

/**
 * Problems with out/proof.html. It is a public page, so it may not ask not to be indexed and the sitemap lists it. Its
 * static state follows the build's deployments table: before a MaatInbox is recorded it says counting starts then and
 * every brief line says "not deployed", with no number and no wallet or brief row; after, it shows the reading state
 * and no count, since the browser reads the logs. Its markup holds the counting rule.
 */
export function checkProofPage(opts: { html: string; inboxRecorded: boolean; sitemap: string; url: string }): string[] {
  const { html, inboxRecorded, sitemap, url } = opts;
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(`out/proof.html${problem.startsWith(" ") ? "" : ": "}${problem}`);
  };
  need(html.includes('<html lang="en"'), 'missing <html lang="en">');
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
  need(title === `${PROOF_HEADING} · ${SITE.name}`, `title "${title ?? ""}" is not "${PROOF_HEADING} · ${SITE.name}"`);
  needDescriptionAndOgImage(html, need);
  need(/<link rel="canonical" href="https?:\/\/[^"/]+\/proof"/.test(html), "the canonical link is missing, not absolute or not /proof");
  need(new RegExp(`<h1[^>]*>${PROOF_HEADING}</h1>`).test(html), `the h1 is not "${PROOF_HEADING}"`);
  need(!/<meta name="robots" content="[^"]*noindex/.test(html), " asks not to be indexed, but /proof is a public page");

  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  need(markup.includes(PROOF_RULE_MARK), " does not hold the counting rule in its markup");
  const values = PROOF_BRIEF_LINES.map((key) => new RegExp(`data-testid="proof-${key}"[^>]*>([^<]*)<`).exec(markup)?.[1]);
  if (inboxRecorded) {
    const reading = markup.includes('data-proof-state="reading"');
    need(reading, " does not show the reading state, but a MaatInbox is recorded");
    if (reading) need(values.every((v) => v === undefined || v === "…"), " has a count in its HTML, read at build time");
  } else {
    const waiting = markup.includes('data-proof-state="not-recorded"') && markup.includes("Counting starts when the inbox is recorded.");
    need(waiting, " does not say counting starts when the inbox is recorded, but no MaatInbox is recorded");
    if (waiting) {
      need(values.every((v) => v === undefined || v === "not deployed"), " shows a brief line other than not deployed, but no MaatInbox is recorded");
      need(!/data-proof-row="(?:outside|team|hidden)"/.test(markup), " lists a wallet or a brief, but no MaatInbox is recorded");
    }
  }

  for (const [, id] of html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)) {
    need(html.includes(` id="${id}"`), `link #${id} has no target`);
  }
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    need((src ?? "").startsWith("/_next/"), `third-party script ${src}`);
  }
  need(!/fonts\.(googleapis|gstatic)\.com/.test(html), "the page loads Google Fonts at runtime");
  if (!sitemap.includes(`<loc>${url}</loc>`)) problems.push(`out/sitemap.xml does not list ${url}`);
  return problems;
}
