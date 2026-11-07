import { describe, expect, it } from "vitest";
import { checkExport } from "@/lib/check-out";
import { SITE } from "@/lib/site";

const GOOD = [
  '<!DOCTYPE html><html lang="en" class="f"><head>',
  `<title>${SITE.title}</title>`,
  `<meta name="description" content="${SITE.description}"/>`,
  '<meta property="og:image" content="https://maat.example/opengraph-image.png?x"/>',
  '<meta name="twitter:card" content="summary_large_image"/>',
  `<meta name="twitter:site" content="${SITE.xHandle}"/>`,
  '<script src="/_next/static/chunks/main.js" async=""></script>',
  "</head><body>",
  '<a href="#ledger">Open the ledger</a>',
  '<button type="button" aria-pressed="true" class="c">Sat 7 Nov</button>',
  '<div role="status" aria-live="polite" aria-atomic="true" class="s">',
  '<div data-verdict="refused" data-reason="MARKET_CLOSED" class="v"><span>Refused</span><span>MARKET_CLOSED</span></div>',
  "</div>",
  '<section id="ledger"></section>',
  "</body></html>",
].join("");

describe("checkExport", () => {
  it("accepts a page that is ready to ship", () => {
    expect(checkExport(GOOD)).toEqual([]);
  });

  it.each([
    ["a relative og:image", GOOD.replace("https://maat.example/opengraph-image.png?x", "/opengraph-image.png"), /og:image/],
    ["a link without a target", GOOD.replace('href="#ledger"', 'href="#nowhere"'), /#nowhere/],
    ["a third-party script", GOOD.replace("/_next/static/chunks/main.js", "https://cdn.example/x.js"), /third-party script/],
    ["Google Fonts", GOOD.replace("</head>", '<link href="https://fonts.googleapis.com/css2"/></head>'), /Google Fonts/],
    ["Saturday not pressed", GOOD.replace('aria-pressed="true"', 'aria-pressed="false"'), /Sat 7 Nov/],
    ["the wrong verdict in the live region", GOOD.replace('data-verdict="refused"', 'data-verdict="allowed"'), /verdict/],
    ["a verdict outside the live region", GOOD.replace('role="status"', 'role="none"'), /verdict/],
    ["a wrong title", GOOD.replace(SITE.title, "Maat"), /title/],
  ])("flags %s", (_name, html, problem) => {
    expect(checkExport(html).join("\n")).toMatch(problem);
  });
});
