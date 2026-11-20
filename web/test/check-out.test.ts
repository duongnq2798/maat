import { describe, expect, it } from "vitest";
import {
  checkAbiFiles,
  checkDataFiles,
  checkDocsIndexes,
  checkDocsPage,
  checkExport,
  checkLandingIsolation,
  checkLocalhost,
  checkMarkdownCopies,
  checkMarkdownCopy,
  checkOgImage,
  checkSearchIndex,
  SEARCH_INDEX_GZIP_BUDGET,
  shipsPublicly,
} from "@/lib/check-out";
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

  it("wants the docs home titled with the docs center's name alone, and every other page in the template", () => {
    const home = DOC.replace(`The nine checks · ${SITE.name} Docs`, `${SITE.name} Docs`);
    expect(checkDocsPage(home, "out/docs.html", KNOWN)).toEqual([]);
    expect(checkDocsPage(DOC.replace("The nine checks", "Maat docs"), "out/docs.html", KNOWN).join("\n")).toMatch(/title/);
    expect(checkDocsPage(home, PATH, KNOWN).join("\n")).toMatch(/title/);
  });

  it("names the page in every problem", () => {
    expect(checkDocsPage(DOC.replace(' lang="en"', ""), PATH, KNOWN)[0]).toMatch(/^out\/docs\/concepts\/nine-checks\.html: /);
  });

  it("wants every other root-relative link to lead to an exported file: the landing page, llms.txt, an ABI", () => {
    const files = new Set(["/", "/llms.txt", "/data/abi/MandateVault.json"]);
    const exported = (path: string) => files.has(path);
    const links = '<a href="/">Home</a> <a href="/#ledger">Ledger</a> <a href="/llms.txt">llms.txt</a> <a href="/data/abi/MandateVault.json">ABI (JSON)</a>';
    const html = DOC.replace("</body>", `${links}</body>`);
    expect(checkDocsPage(html, PATH, KNOWN, exported)).toEqual([]);
    expect(checkDocsPage(html.replace("MandateVault.json", "Gone.json"), PATH, KNOWN, exported)).toEqual([
      `${PATH}: link /data/abi/Gone.json points to no exported file`,
    ]);
    // Another host's link is not the export's to check.
    expect(checkDocsPage(DOC.replace("</body>", '<a href="//cdn.example/x">x</a></body>'), PATH, KNOWN, exported)).toEqual([]);
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
  const md = "https://maat.example/md/docs/concepts/nine-checks.md";
  const abi = "https://maat.example/data/abi/MandateVault.json";
  const LLMS = [
    "# Maat docs",
    "",
    "> Understand Maat.",
    "",
    "Status: built and fork-tested. Details: https://maat.example/docs/get-started/status",
    "",
    "## Pages",
    "",
    `- [The nine checks](${md}): The order of the checks. Web page: ${url}`,
    "",
    "## Contract ABIs",
    "",
    `- [MandateVault ABI](${abi}): Built and fork-tested, not deployed.`,
    "",
  ].join("\n");
  const FILES = new Set(["/docs/concepts/nine-checks", "/md/docs/concepts/nine-checks.md", "/data/abi/MandateVault.json"]);
  const exported = (path: string) => FILES.has(path);
  const good = { llms: LLMS, llmsFull: `# The nine checks\n\nURL: ${url}\n\nBody\n`, sitemap: `<url><loc>${url}</loc></url>` };

  it("accepts indexes that list every docs page, llms.txt by its Markdown copy", () => {
    expect(checkDocsIndexes(good, [url], exported)).toEqual([]);
  });

  it("names each index that misses a page", () => {
    expect(checkDocsIndexes({ llms: "", llmsFull: "", sitemap: "" }, [url], exported)).toEqual([
      "llms.txt has no Status line under its summary",
      `llms.txt does not link the Markdown copy ${md}`,
      `llms.txt does not give the web page ${url}`,
      `llms-full.txt has no page with URL ${url}`,
      `sitemap.xml does not list ${url}`,
    ]);
  });

  it("flags an llms.txt that links a page's HTML instead of its Markdown copy", () => {
    const llms = LLMS.replace(`](${md})`, `](${url})`);
    expect(checkDocsIndexes({ ...good, llms }, [url], exported)).toEqual([
      `llms.txt does not link the Markdown copy ${md}`,
      `llms.txt links the web page ${url}: link its Markdown copy ${md}`,
    ]);
  });

  it("flags any llms.txt link to a docs web page, such as the status line's Details link", () => {
    const status = "https://maat.example/docs/get-started/status";
    const llms = LLMS.replace("Details: https://maat.example/docs/get-started/status", `Details: [Status and roadmap](${status}#x).`);
    expect(checkDocsIndexes({ ...good, llms }, [url], (path) => exported(path) || path === "/docs/get-started/status")).toEqual([
      `llms.txt links the web page ${status}#x: link its Markdown copy https://maat.example/md/docs/get-started/status.md`,
    ]);
  });

  it("flags a link in llms.txt that leads to no exported file", () => {
    const llms = LLMS.replace(abi, "https://maat.example/data/abi/Gone.json");
    expect(checkDocsIndexes({ ...good, llms }, [url], exported)).toEqual([
      "llms.txt links https://maat.example/data/abi/Gone.json, which is not in out/",
    ]);
  });

  it("flags llms-full.txt when it repeats the index note that opens each page's own file", () => {
    const llmsFull = `> Index of every page: [llms.txt](https://maat.example/llms.txt).\n\n${good.llmsFull}`;
    expect(checkDocsIndexes({ ...good, llmsFull }, [url], exported)).toEqual(["llms-full.txt repeats the index note of the pages' own Markdown files"]);
  });
});

describe("checkMarkdownCopy", () => {
  const NOTE = "> Index of every page: [llms.txt](https://maat.example/llms.txt). All pages in one file: [llms-full.txt](https://maat.example/llms-full.txt).";
  const src = `${SITE.repoUrl}/blob/main/contracts/src/GuardLib.sol`;
  const LABEL = '<a aria-label="Status: Fork-tested. What this label means" href="/docs/get-started/status#what-the-three-labels-mean">';
  const DATE = 'Last reviewed <time dateTime="2026-11-07">7 Nov 2026</time>';
  const BOX = `<aside aria-labelledby="source-of-truth"><h2 id="source-of-truth">Source of truth</h2><ul><li><a href="${src}">contracts/src/GuardLib.sol</a></li></ul><p>Built from commit <code>abc1234</code>.</p></aside>`;
  const HTML = `<header>${LABEL}${DATE}</header><main>Body</main>${BOX}`;
  const SOURCES = `## Source of truth\n\nThis page is checked against these files. If they disagree, the files win.\n\n- [\`contracts/src/GuardLib.sol\`](${src})\n`;
  const copy = (frame: string | null, sources = SOURCES) =>
    [NOTE, "", "# T", "", "URL: https://maat.example/docs/a", "", ...(frame === null ? [] : [frame, ""]), "D", "", "Body", "", sources].join("\n");
  const MD = copy("Status: Fork-tested. Built and tested; not deployed. Last reviewed: 2026-11-07.");
  const PATH = "out/md/docs/a.md";

  it("accepts a copy that opens with the index note and carries the page's label, review date and sources", () => {
    expect(checkMarkdownCopy(HTML, MD, PATH)).toEqual([]);
  });

  it("accepts a Help page's copy with the date alone, and the home's with neither, as their headers show them", () => {
    expect(checkMarkdownCopy(`<header>${DATE}</header>${BOX}`, copy("Last reviewed: 2026-11-07."), PATH)).toEqual([]);
    expect(checkMarkdownCopy(`<header></header>${BOX}`, copy(null), PATH)).toEqual([]);
  });

  it.each([
    ["no index note", HTML, MD.replace(`${NOTE}\n\n`, ""), "does not open with the index note"],
    ["no label where the page shows one", HTML, copy("Last reviewed: 2026-11-07."), 'does not say "Status: Fork-tested." after its URL, as its page does'],
    ["a label where the page shows none", `<header>${DATE}</header>${BOX}`, MD, "gives a Status line, but its page shows no status label"],
    ["another review date", HTML, MD.replace("2026-11-07.", "2026-11-08."), 'does not say "Last reviewed: 2026-11-07." after its URL, as its page does'],
    ["a review date where the page shows none", `<header></header>${BOX}`, copy("Last reviewed: 2026-11-07."), "gives a review date, but its page shows none"],
    ["no Source of truth", HTML, copy("Status: Fork-tested. Built. Last reviewed: 2026-11-07.", ""), "does not list the page's Source of truth files"],
    ["other source files", HTML, MD.replace(src, src.replace("GuardLib", "PriceLib")), "does not list the page's Source of truth files"],
    ["a Source of truth the page does not have", `<header>${LABEL}${DATE}</header>`, MD, "lists Source of truth files, but its page has no Source of truth box"],
  ])("flags %s", (_name, html, md, problem) => {
    expect(checkMarkdownCopy(html, md, PATH)).toEqual([`${PATH} ${problem}`]);
  });
});

describe("checkOgImage", () => {
  const OWN = "https://maat.example/og/docs/concepts/nine-checks.png";
  const FILE = "og/docs/concepts/nine-checks.png";
  const html = DOC.replace(
    '<meta property="og:image" content="https://maat.example/opengraph-image.png"/>',
    [
      `<meta property="og:image" content="${OWN}"/>`,
      '<meta property="og:image:width" content="1200"/>',
      '<meta property="og:image:height" content="630"/>',
      `<meta name="twitter:image" content="${OWN}"/>`,
    ].join(""),
  );
  /** The first 24 bytes of a PNG: its signature and the IHDR chunk's width and height, all a size check reads. */
  const png = (width: number, height: number) => {
    const head = Buffer.alloc(24);
    head.writeUInt32BE(0x89504e47, 0);
    head.writeUInt32BE(0x0d0a1a0a, 4);
    head.writeUInt32BE(13, 8);
    head.write("IHDR", 12, "latin1");
    head.writeUInt32BE(width, 16);
    head.writeUInt32BE(height, 20);
    return head;
  };
  const read = (path: string) => (path === FILE ? png(1200, 630) : undefined);

  it("accepts a page whose og:image and twitter:image are its own 1200x630 PNG in out/", () => {
    expect(checkOgImage(html, "/docs/concepts/nine-checks", PATH, read)).toEqual([]);
  });

  it.each([
    [
      "the landing's image",
      html.replace(`property="og:image" content="${OWN}"`, 'property="og:image" content="https://maat.example/opengraph-image.png"'),
      read,
      "og:image is https://maat.example/opengraph-image.png, not the page's own image /og/docs/concepts/nine-checks.png",
    ],
    [
      "another page's image",
      html.replace(`property="og:image" content="${OWN}"`, 'property="og:image" content="https://maat.example/og/docs/concepts/refusal-codes.png"'),
      read,
      "og:image is https://maat.example/og/docs/concepts/refusal-codes.png, not the page's own image /og/docs/concepts/nine-checks.png",
    ],
    ["no og:image", html.replace(/<meta property="og:image" [^>]*>/, ""), read, "og:image is missing, not the page's own image /og/docs/concepts/nine-checks.png"],
    [
      "a twitter:image that is the landing's",
      html.replace(`name="twitter:image" content="${OWN}"`, 'name="twitter:image" content="https://maat.example/opengraph-image.png"'),
      read,
      "twitter:image is https://maat.example/opengraph-image.png, not the page's own image /og/docs/concepts/nine-checks.png",
    ],
    [
      "a relative twitter:image",
      html.replace(`name="twitter:image" content="${OWN}"`, 'name="twitter:image" content="/og/docs/concepts/nine-checks.png"'),
      read,
      "twitter:image is /og/docs/concepts/nine-checks.png, not the page's own image /og/docs/concepts/nine-checks.png",
    ],
    ["no twitter:image", html.replace(/<meta name="twitter:image" [^>]*>/, ""), read, "twitter:image is missing, not the page's own image /og/docs/concepts/nine-checks.png"],
    ["a size the tags misstate", html.replace('content="630"', 'content="600"'), read, "og:image:width and og:image:height say 1200x600, want 1200x630"],
    ["a missing file", html, () => undefined, "missing out/og/docs/concepts/nine-checks.png"],
    ["a file that is not a PNG", html, () => Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "out/og/docs/concepts/nine-checks.png is not a PNG"],
    ["an image of another size", html, () => png(1200, 600), "out/og/docs/concepts/nine-checks.png is 1200x600, want 1200x630"],
  ])("flags %s", (_name, page, readFile, problem) => {
    expect(checkOgImage(page, "/docs/concepts/nine-checks", PATH, readFile)).toEqual([`${PATH}: ${problem}`]);
  });

  it("wants the docs home's image at /og/docs.png", () => {
    const home = html.replaceAll(OWN, "https://maat.example/og/docs.png");
    expect(checkOgImage(home, "/docs", "out/docs.html", (path) => (path === "og/docs.png" ? png(1200, 630) : undefined))).toEqual([]);
  });
});

describe("checkAbiFiles", () => {
  const expected = { MandateVault: { source: "S", note: "N", abi: [{ type: "function", name: "execute" }] } };
  const good = `${JSON.stringify(expected.MandateVault, null, 2)}\n`;

  it("accepts each ABI file as its route writes it", () => {
    expect(checkAbiFiles(expected, (path) => (path === "data/abi/MandateVault.json" ? good : undefined))).toEqual([]);
  });

  it.each([
    ["a missing file", () => undefined, "missing out/data/abi/MandateVault.json"],
    ["a file that is not JSON", () => "{", "out/data/abi/MandateVault.json is not JSON"],
    ["another ABI", () => good.replace("execute", "executeAll"), "out/data/abi/MandateVault.json is not the committed ABI (run npm run docs:gen and build again)"],
  ])("flags %s", (_name, read, problem) => {
    expect(checkAbiFiles(expected, read)).toEqual([problem]);
  });
});

describe("checkDataFiles", () => {
  const expected = { "data/deployments.json": { network: "Base mainnet", vault: null } };
  const good = `${JSON.stringify(expected["data/deployments.json"], null, 2)}\n`;

  it("accepts each data file as its route writes it", () => {
    expect(checkDataFiles(expected, (path) => (path === "data/deployments.json" ? good : undefined))).toEqual([]);
  });

  it.each([
    ["a missing file", () => undefined, "missing out/data/deployments.json"],
    ["a file that is not JSON", () => "{", "out/data/deployments.json is not JSON"],
    ["other data", () => good.replace("null", '"0x1"'), "out/data/deployments.json is not its generated source (run npm run docs:gen and build again)"],
  ])("flags %s", (_name, read, problem) => {
    expect(checkDataFiles(expected, read)).toEqual([problem]);
  });
});

describe("checkLocalhost", () => {
  const allowed = new Set(["http://localhost:3000"]);
  const site = new URL("https://maat.example");

  it("accepts files whose only localhost URL is one the docs write in their text", () => {
    const quickstart = '<a href="http://localhost:3000" rel="noreferrer">http://localhost:3000</a>, and `npm run dev` serves the site on http://localhost:3000.';
    expect(checkLocalhost([{ path: "out/docs/get-started/quickstart.html", text: quickstart }], allowed, site)).toEqual([]);
  });

  it("flags each file that holds the fallback base URL, with what to set", () => {
    const files = [
      { path: "out/llms.txt", text: "- [A](http://localhost:3000/md/docs.md): D. Web page: http://localhost:3000/docs\n" },
      { path: "out/sitemap.xml", text: "<loc>http://localhost:3000/docs</loc>" },
      { path: "out/robots.txt", text: "Sitemap: https://maat.example/sitemap.xml" },
    ];
    expect(checkLocalhost(files, allowed, site)).toEqual([
      "out/llms.txt links http://localhost:3000/md/docs.md: set NEXT_PUBLIC_SITE_URL to the public site and build again",
      "out/sitemap.xml links http://localhost:3000/docs: set NEXT_PUBLIC_SITE_URL to the public site and build again",
    ]);
  });

  it("flags a site URL on localhost, so a file whose only leak is the bare origin the docs also write does not pass", () => {
    // The landing page's canonical and og:url are the bare origin, which the quickstart's dev-server address matches.
    const files = [{ path: "out/index.html", text: '<link rel="canonical" href="http://localhost:3000"/><meta property="og:url" content="http://localhost:3000"/>' }];
    expect(checkLocalhost(files, allowed, new URL("http://localhost:3000"))).toEqual([
      "the site URL is http://localhost:3000/: set NEXT_PUBLIC_SITE_URL to the public site and build again",
    ]);
    expect(checkLocalhost([], allowed, new URL("http://127.0.0.1:3000"))).toEqual([
      "the site URL is http://127.0.0.1:3000/: set NEXT_PUBLIC_SITE_URL to the public site and build again",
    ]);
    expect(checkLocalhost([], allowed, site)).toEqual([]);
  });

  it("runs on CI and on Vercel only, where the export is about to ship", () => {
    expect(shipsPublicly({})).toBe(false);
    expect(shipsPublicly({ CI: "" })).toBe(false);
    expect(shipsPublicly({ CI: "true" })).toBe(true);
    expect(shipsPublicly({ VERCEL: "1" })).toBe(true);
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

describe("checkSearchIndex", () => {
  /** An exported index: zbsearch keeps the records under docs.docs, each with the URL a result opens. */
  const index = (...urls: string[]) => JSON.stringify({ type: "advanced", docs: { docs: Object.fromEntries(urls.map((url, i) => [i + 1, { url }])) } });
  const PAGES: Record<string, string> = {
    "/docs": '<h1>Maat docs</h1><h2 id="where-to-find-things">Where</h2>',
    "/docs/concepts/nine-checks": '<h2 id="why">Why the order matters</h2>',
  };
  const page = (path: string) => PAGES[path];

  it("accepts an index within its budget whose results all open an exported page and heading", () => {
    expect(checkSearchIndex(index("/docs", "/docs#where-to-find-things", "/docs/concepts/nine-checks#why"), SEARCH_INDEX_GZIP_BUDGET, page)).toEqual([]);
  });

  it("flags an index over its gzipped budget, with both sizes", () => {
    expect(checkSearchIndex(index("/docs"), SEARCH_INDEX_GZIP_BUDGET + 1, page)).toEqual([
      `out/api/search.json is ${SEARCH_INDEX_GZIP_BUDGET + 1} bytes gzipped, over its budget of ${SEARCH_INDEX_GZIP_BUDGET}`,
    ]);
  });

  it("flags a result that opens a heading its page does not have, once", () => {
    expect(checkSearchIndex(index("/docs/concepts/nine-checks#gone", "/docs/concepts/nine-checks#gone"), 1, page)).toEqual([
      "out/api/search.json: result /docs/concepts/nine-checks#gone has no heading with that id on its page",
    ]);
  });

  it("flags a result that opens a page that was not exported", () => {
    expect(checkSearchIndex(index("/docs/concepts/gone#x"), 1, page)).toEqual(["out/api/search.json: result /docs/concepts/gone#x points to no exported docs page"]);
  });

  it("flags an index with no records", () => {
    expect(checkSearchIndex(index(), 1, page)).toEqual(["out/api/search.json holds no search records"]);
  });
});
