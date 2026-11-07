import { MOMENTS } from "../content/engine";
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

  for (const [, id] of html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)) {
    need(html.includes(` id="${id}"`), `link #${id} has no target`);
  }
  for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    need((src ?? "").startsWith("/_next/"), `third-party script: ${src}`);
  }
  need(!/fonts\.(googleapis|gstatic)\.com/.test(html), "the page loads Google Fonts at runtime");
  return problems;
}

/** Problems with one exported docs page. `known` holds the URL path of every exported docs page (/docs, /docs/x). */
export function checkDocsPage(html: string, path: string, known: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, problem: string) => {
    if (!ok) problems.push(`${path}: ${problem}`);
  };

  need(html.includes('<html lang="en"'), 'missing <html lang="en">');
  // The title template of app/(docs)/layout.tsx.
  const suffix = ` · ${SITE.name} Docs`;
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  need(title.endsWith(suffix) && title.length > suffix.length, `title "${title}" does not end with "${suffix}"`);
  const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1];
  // An entity such as &#x27; counts as one character.
  const length = description?.replace(/&[^;\s]+;/g, "x").length ?? 0;
  need(length >= 50 && length <= 160, `meta description is ${description === undefined ? "missing" : `${length} characters`}, want 50 to 160`);
  need(/<link rel="canonical" href="https?:\/\/[^"]+"/.test(html), "canonical link is missing or not absolute");
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  need(og !== undefined && /^https?:\/\//.test(og), "og:image is missing or not an absolute URL");
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

/** Problems with the machine-readable copies of the docs. `urls` holds the absolute URL of every exported docs page. */
export function checkDocsIndexes(files: { llms: string; llmsFull: string; sitemap: string }, urls: readonly string[]): string[] {
  const problems: string[] = [];
  for (const url of urls) {
    if (!files.llms.includes(`](${url})`)) problems.push(`llms.txt does not link ${url}`);
    if (!files.llmsFull.includes(`URL: ${url}\n`)) problems.push(`llms-full.txt has no page with URL ${url}`);
    if (!files.sitemap.includes(`<loc>${url}</loc>`)) problems.push(`sitemap.xml does not list ${url}`);
  }
  return problems;
}
