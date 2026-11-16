import { describe, expect, it } from "vitest";
import { checkDocsIndexes, checkDocsPage, checkExport, checkLandingIsolation, checkMarkdownCopies } from "@/lib/check-out";
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
  '<section id="try"><div role="status" aria-live="polite" aria-atomic="true" class="s">',
  '<div data-verdict="allowed" data-reason="OK" class="v"></div></div></section>',
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
    ["no simulator section", GOOD.replace('id="try"', 'id="trial"'), /#try is missing/],
    [
      "the wrong simulator verdict",
      GOOD.replace('data-verdict="allowed" data-reason="OK"', 'data-verdict="refused" data-reason="OK"'),
      /simulator's default verdict/,
    ],
  ])("flags %s", (_name, html, problem) => {
    expect(checkExport(html).join("\n")).toMatch(problem);
  });
});

const DOC = [
  '<!DOCTYPE html><html lang="en" class="f"><head>',
  `<title>The nine checks · ${SITE.name} Docs</title>`,
  '<meta name="description" content="The ordered checks the vault runs on every proposed trade, and what each refusal&#x27;s code means."/>',
  '<link rel="canonical" href="https://maat.example/docs/concepts/nine-checks"/>',
  '<meta property="og:image" content="https://maat.example/opengraph-image.png"/>',
  '<script src="/_next/static/chunks/docs.js" async=""></script>',
  "</head><body>",
  '<a href="#why">Why the order matters</a>',
  '<a href="/docs">Docs</a> <a href="/docs/concepts/nine-checks#why">Deep link</a>',
  '<h2 id="why">Why the order matters</h2>',
  "</body></html>",
].join("");
const KNOWN = new Set(["/docs", "/docs/concepts/nine-checks"]);
const PATH = "out/docs/concepts/nine-checks.html";

describe("checkDocsPage", () => {
  it("accepts a docs page that is ready to ship", () => {
    expect(checkDocsPage(DOC, PATH, KNOWN)).toEqual([]);
  });

  it.each([
    ["a missing lang", DOC.replace(' lang="en"', ""), /lang="en"/],
    ["a title outside the docs template", DOC.replace(` · ${SITE.name} Docs`, ""), /title/],
    ["an empty title", DOC.replace("The nine checks · ", " · "), /title/],
    ["no meta description", DOC.replace(/<meta name="description"[^>]*>/, ""), /description is missing/],
    ["a short meta description", DOC.replace(/content="The ordered[^"]*"/, 'content="Too short."'), /10 characters/],
    ["a long meta description", DOC.replace(/content="The ordered[^"]*"/, `content="${"x".repeat(161)}"`), /161 characters/],
    ["no canonical link", DOC.replace(/<link rel="canonical"[^>]*>/, ""), /canonical/],
    ["a relative og:image", DOC.replace("https://maat.example/opengraph-image.png", "/opengraph-image.png"), /og:image/],
    ["a third-party script", DOC.replace("/_next/static/chunks/docs.js", "https://cdn.example/x.js"), /third-party script/],
    ["Google Fonts", DOC.replace("</head>", '<link href="https://fonts.gstatic.com/x"/></head>'), /Google Fonts/],
    ["a block inside a paragraph", DOC.replace("</body>", "<p><div>x</div></p></body>"), /inside a paragraph/],
    ["a block after text inside a paragraph", DOC.replace("</body>", "<p>Intro\n<div>x</div></p></body>"), /inside a paragraph/],
    ["an in-page link without a target", DOC.replace('href="#why"', 'href="#nowhere"'), /#nowhere/],
    ["a link to a docs page that was not exported", DOC.replace('href="/docs"', 'href="/docs/concepts/gone"'), /\/docs\/concepts\/gone/],
  ])("flags %s", (_name, html, problem) => {
    expect(checkDocsPage(html, PATH, KNOWN).join("\n")).toMatch(problem);
  });

  it("does not flag a closed paragraph followed by a block", () => {
    expect(checkDocsPage(DOC.replace("</body>", "<p>a</p><div>b</div></body>"), PATH, KNOWN)).toEqual([]);
  });

  it("names the page in every problem", () => {
    expect(checkDocsPage(DOC.replace(' lang="en"', ""), PATH, KNOWN)[0]).toMatch(/^out\/docs\/concepts\/nine-checks\.html: /);
  });
});

const LANDING = [
  '<html lang="en"><head><link rel="stylesheet" href="/_next/static/chunks/site.css" data-precedence="next"/>',
  '<script src="/_next/static/chunks/site.js" async=""></script></head><body></body></html>',
].join("");
const ASSETS: Record<string, string> = {
  "/_next/static/chunks/site.css": ":root{--color-ink:#0b0d12}",
  "/_next/static/chunks/site.js": "console.log('landing')",
};

describe("checkLandingIsolation", () => {
  it("accepts a landing whose CSS and JS hold no docs code", () => {
    expect(checkLandingIsolation(LANDING, (url) => ASSETS[url] ?? "")).toEqual([]);
  });

  it.each([
    ["the Fumadocs palette in the CSS", "/_next/static/chunks/site.css", ":root{--color-fd-primary:#1f3bff}", /site\.css contains "--color-fd-"/],
    ["the docs layout in the CSS", "/_next/static/chunks/site.css", "#nd-docs-layout{display:grid}", /nd-docs-layout/],
    ["Fumadocs in the JS", "/_next/static/chunks/site.js", "import('fumadocs-ui')", /site\.js contains "fumadocs"/],
    ["the theme script in the JS", "/_next/static/chunks/site.js", "next-themes", /next-themes/],
    ["the search engine in the JS", "/_next/static/chunks/site.js", "zbsearch", /zbsearch/],
  ])("flags %s", (_name, url, text, problem) => {
    expect(checkLandingIsolation(LANDING, (u) => (u === url ? text : (ASSETS[u] ?? ""))).join("\n")).toMatch(problem);
  });

  it("flags a landing with no assets to check", () => {
    expect(checkLandingIsolation("<html></html>", () => "")).toEqual([expect.stringMatching(/cannot be checked/)]);
  });
});

describe("checkDocsIndexes", () => {
  const url = "https://maat.example/docs/concepts/nine-checks";

  it("accepts indexes that list every docs page", () => {
    const files = {
      llms: `- [The nine checks](${url}): The order of the checks.\n`,
      llmsFull: `# The nine checks\n\nURL: ${url}\n\nBody\n`,
      sitemap: `<url><loc>${url}</loc></url>`,
    };
    expect(checkDocsIndexes(files, [url])).toEqual([]);
  });

  it("names each index that misses a page", () => {
    expect(checkDocsIndexes({ llms: "", llmsFull: "", sitemap: "" }, [url])).toEqual([
      `llms.txt does not link ${url}`,
      `llms-full.txt has no page with URL ${url}`,
      `sitemap.xml does not list ${url}`,
    ]);
  });
});

describe("checkMarkdownCopies", () => {
  it("accepts Markdown whose components were turned into text", () => {
    const text = "# T\n\n```solidity\nfunction execute(Intent intent) external\n```\n\nWho may call: Executor only.\n";
    expect(checkMarkdownCopies(text)).toEqual([]);
  });

  it("flags every data component tag left in the text, by line", () => {
    const text = [
      "# T",
      "",
      '<Fn contract="MandateVault" name="execute" />',
      "",
      '| <StatusBadge status="live" /> | Deployed |',
      "<FactTable",
      '  names={["a"]}',
      "/>",
    ].join("\n");
    expect(checkMarkdownCopies(text)).toEqual([
      "line 3: <Fn> was left in the Markdown instead of its text",
      "line 5: <StatusBadge> was left in the Markdown instead of its text",
      "line 6: <FactTable> was left in the Markdown instead of its text",
    ]);
  });

  it("ignores code fences, names that only start like a component, and placeholders", () => {
    const text = [
      "Set <BASE_RPC_URL> and <VAULT_ADDRESS>, then <ReasonName> and <Fnord> and <Fn2>.",
      "",
      "```ts",
      'type X = <Fn contract="x" />;',
      "```",
      "",
      "~~~md",
      "<EnvVar name=\"A\" />",
      "~~~",
    ].join("\n");
    expect(checkMarkdownCopies(text)).toEqual([]);
  });

  it("names the page when it is given one, so a leak is not a line number in a 590 KB file", () => {
    expect(checkMarkdownCopies('# T\n\n<Fn contract="V" name="x" />\n', "out/md/docs/reference/mandate-vault.md")).toEqual([
      "out/md/docs/reference/mandate-vault.md line 3: <Fn> was left in the Markdown instead of its text",
    ]);
  });

  it("leaves the containers of the page alone: a Callout wraps real Markdown text", () => {
    expect(checkMarkdownCopies('<Callout type="warn">\nText.\n</Callout>\n\n<Steps>\n<Step>\nDo it.\n</Step>\n</Steps>\n')).toEqual([]);
  });
});
