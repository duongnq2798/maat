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
