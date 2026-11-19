# Maat Docs Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a documentation center at `maatonbase.xyz/docs`: 42 pages for five kinds of reader, built
only from what the contracts, the agent and the fork tests prove, with gates that fail the tests when a
page drifts from the code.

**Architecture:** Fumadocs runs inside the existing `web/` Next.js static export. The landing page and the
docs get separate root layouts through route groups, so the docs' styles, providers and theme never load
on `/`. Reference data (functions, events, errors, types, Base addresses, agent settings) is generated from
the Solidity and agent sources into committed JSON by `npm run docs:gen`; numbers render from `FACTS`
through `<Fact>`. Vitest gates check frontmatter, language, facts, links, excerpts, coverage and sync;
`check:out` and Playwright check the exported site.

**Tech Stack:** Next.js 16.4.5 (static export), React 19.3.1, Tailwind CSS 4.3.5, TypeScript 7.0.2,
Fumadocs (fumadocs-core 16.18.1, fumadocs-ui 16.18.1, fumadocs-mdx 15.5.0), zod 4.6.7, yaml 2.9.1
(tests), @axe-core/playwright 4.14.0, Vitest 5.1.0, Playwright 1.65.0, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-07-maat-docs-center-design.md` (approved 2026-11-07). Read it
before any task; it is the authority where this plan is unclear.

## Global Constraints

- Static export stays: `output: "export"` in `web/next.config.ts`; no route needs a server at request time.
- No third-party scripts, no analytics, no cookies, no external origins requested at runtime (fonts are
  self-hosted by `geist`). `npm run check:out` enforces it for `/` and every docs page.
- Landing isolation: the landing page's HTML and CSS must not change beyond the added "Docs" links
  (Task 21), and its first-load JavaScript may grow by at most 1024 B gzip (the measured cost of a second
  root layout is about 876 B; see the decision record). The landing CSS is built from an allow-list of
  source paths, so docs classes cannot reach it. Task 1 records the baseline and the comparison tool,
  Task 6 adds the export and e2e checks, the phase checkpoints and Task 22 compare again.
- Versions are pinned exactly (`npm install --save-exact`), as for the rest of `web/`.
- Plain English everywhere: content, file names, code comments, commit messages, PR text. Docs prose in
  `web/content/docs` is basic Latin plus `·` `≤` `≥` `→` `↗` `−`. Commit messages describe what a change
  does for the reader or the code, nothing else.
- Document only what exists. No pages for an API, SDK, webhooks, authentication, rate limits or
  enterprise deployment. Planned work appears only on Status and roadmap, labelled Planned.
- Status labels: `fork-tested` (exercised on a Base mainnet fork, not deployed), `live` (only after the
  owner deploys; none today), `planned`. Every page in this plan is `fork-tested`.
- Numbers are never typed into prose: `<Fact name="…" />` (from `FACTS`) or generated data with a sync test.
  No test counts on any page.
- No invented outputs: command output is copied from a real run and labelled; placeholders look like
  `<VAULT_ADDRESS>`.
- Safety: never run `forge script ... --broadcast`, `cast send`, `cast wallet`, or
  `agent/scripts/cdp-setup.ts`; never use a private key; never call the paid Claude API (no
  `smoke-claude.ts`, no agent dry run). Never print or commit `BASE_RPC_URL`; fork tests that need it are
  optional and read it from `contracts/.env` without echoing it.
- Commits: one per task at least, message describes the effect, ends with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, open a PR or merge without the
  owner's approval.
- Each phase ends green on `npm run verify` and `npm run e2e` in `web/` (the Phase 1 and Phase 2
  checkpoints after Tasks 10 and 16, and Task 22).
- Quality bar (spec §1): 360 px to 1920 px with no horizontal page scroll; search answers a reason code,
  a function name or a setting in its first result; Lighthouse mobile on `/docs` and one long page:
  Performance ≥ 90, Accessibility 100, Best Practices ≥ 95, SEO 100; zero serious or critical axe
  violations.
- Work in `web/` unless a step says otherwise. Shell: Git Bash on Windows; use forward slashes.

## Review Focus

The inputs and conditions most likely to break the docs for a real reader that no single task's own
tests would catch. Each line names the test that now pins it and the task that owns it.

1. **A reader who chose dark on `/docs` and then opens `/`** expects the landing page exactly as it is
   (light, unchanged). The theme lives in `localStorage` and a script on the docs root layout only.
   Pinned by `e2e/docs.spec.ts` "dark docs do not reach the landing page" (Task 6).
2. **A deep link loaded cold** (`/docs/reference/mandate-vault#queuemandate` pasted into a new tab, on the
   static host) expects the page, scrolled to the heading, not a 404 or the docs home. Pinned by
   `e2e/docs.spec.ts` "a deep link to a function, loaded cold, scrolls to it" (Task 13) and, for a concept
   heading, "a deep link loaded cold scrolls to its heading" (Task 8).
3. **Search when the index cannot load** (offline after first paint, a blocked request) expects a clear
   error state and a way to retry, not an endless spinner; **search with no match** expects the designed
   empty state. Pinned by `e2e/docs.spec.ts` "an index that cannot load shows the error state, not a
   spinner" and "a query with no match shows the empty state" (Task 2).
4. **A long page on a 360 px phone** (wide tables, long signatures, long code lines) expects the page
   itself never to scroll sideways; tables and code scroll inside their own box. Pinned by
   `e2e/docs.spec.ts` "fits {width}px: no page scroll, no console errors" at five widths (Task 6, with the
   nine checks added in Task 8 and the MandateVault reference in Task 13).
5. **A Windows checkout with CRLF line endings** expects the same generated data and the same content
   gate results as LF. Pinned by `test/docs-gen.test.ts` "gives the same surface for CRLF and LF
   checkouts" (Task 11) and the CRLF normalization in every gate that reads a file (Task 6).

## Spike decision record

Spec §9 asks for the spike's decision in the plan. Two throwaway spikes built this plan's code against
the real `web/` app (outside the repo) and every step below was run there first.

- **Fumadocs, not the fallback.** Both spikes passed: the docs build into the static export with dark
  mode, a static search index (`/api/search`, loaded on first search only) and the Signal colors; the
  landing page stays isolated; `check:out` passes. The spec §7 fallback is not needed.
- **Route groups.** `app/(site)` holds the landing page and `app/(docs)` the docs, each with its own root
  layout, so the docs' CSS, providers and theme script never load on `/`. The docs layout lives at
  `app/(docs)/docs/layout.tsx`, not at spec §7's `app/docs/...` path; the URLs are the same.
- **404.** Two root layouts cannot share `not-found.tsx`, so the 404 is `app/global-not-found.tsx` behind
  `experimental.globalNotFound`, bringing its own docs styles and provider (Task 2).
- **Landing CSS by allow-list.** `app/globals.css` reads `@import "tailwindcss" source(none)` and lists
  only the landing's own source paths. A deny-list would have to name every docs path added later; the
  allow-list fails safe, because a new file feeds the landing CSS only when someone adds it (Task 1,
  Step 6).
- **Landing JavaScript: +876 B gzip, accepted.** With a second root layout Next splits its own router
  code into different chunks. A control build measured the same growth with and without
  `global-not-found`, and none of it is docs code. The limit is 1024 B, enforced by the comparison tool.
- **Docs-only facts live in `DOCS_FACTS`** (`content/docs-facts.ts`), not `FACTS`, so the landing bundle
  does not carry them (about 600 B gzip). `FACT_TEXT` reads both (Task 3).
- **The Windows export fix.** On Windows, Next 16.4.5 writes the docs' segment prefetch files into nested
  folders; `scripts/fix-export-segments.mjs` moves them where the client looks. On Vercel it finds
  nothing to fix (Task 1, Step 11).
- **Code highlighting** uses the GitHub high-contrast themes, because the default pair falls below 4.5:1
  on the docs code background.
- **`llms.txt` uses absolute links** built from `siteUrl()`, as the llmstxt.org format expects (Task 19).
- **The landing's Open Graph image URL loses its cache-busting query**, because `app/(site)/layout.tsx`
  names the image itself. The image and the tags are otherwise the same; the comparison tool ignores
  that query.

---

## Phase 1: foundation and learning path

### Task 1: Fumadocs inside the app, with the landing page untouched

Fumadocs joins the existing Next.js static export. The landing page moves into the `(site)` route group and
the docs get their own root layout in `(docs)`, so the docs' stylesheet, providers and theme script never
load on `/`. The landing stylesheet switches to an allow-list of landing files, so no docs, test or Markdown
word can become a landing utility. A seed page proves the pipeline end to end. The landing page must look
exactly as before: Step 1 records it and Step 15 compares.

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (Fumadocs, zod, `@types/mdx`; the build script)
- Move: `web/app/layout.tsx` → `web/app/(site)/layout.tsx`, `web/app/page.tsx` → `web/app/(site)/page.tsx`
- Modify: `web/app/(site)/layout.tsx` (stylesheet path, explicit OG image)
- Modify: `web/test/page.test.tsx` (import path)
- Modify: `web/app/globals.css` (allow-list sources)
- Modify: `web/next.config.ts`
- Create: `web/source.config.ts`, `web/lib/docs/frontmatter.ts`, `web/test/docs-frontmatter.test.ts`
- Create: `web/lib/docs-source.ts`
- Create: `web/app/(docs)/layout.tsx`, `web/app/(docs)/docs.css`, `web/app/(docs)/docs/layout.tsx`,
  `web/app/(docs)/docs/[[...slug]]/page.tsx`
- Create: `web/components/docs/DocsProvider.tsx`, `web/components/docs/mdx.tsx`
- Create: `web/content/docs/index.mdx`, `web/content/docs/meta.json`
- Create: `web/scripts/fix-export-segments.mjs`
- Modify: `.gitignore` (repo root: `web/.source/`)

**Interfaces:**
- Consumes: `SITE`, `siteUrl()` (`web/lib/site.ts`); `Mark` (`web/components/ui/Mark.tsx`).
- Produces: `docsFrontmatter`, `DocsFrontmatter`, `DOC_TYPES`, `AUDIENCES`, `STATUSES`, `DocStatus`,
  `Audience`, `STATUS_LABEL`, `AUDIENCE_LABEL` (`@/lib/docs/frontmatter`; relative imports only, because
  `source.config.ts` loads it outside Next); `source`, `type DocsPage` (`@/lib/docs-source`);
  `getMDXComponents(components?)` (`@/components/docs/mdx`); `DocsProvider` (`@/components/docs/DocsProvider`).
  Task 3 registers its remark plugin in `source.config.ts`; Task 4 replaces the page renderer; Task 2
  replaces `DocsProvider` and adds the 404.

- [ ] **Step 1: Record the landing baseline.** From the repo root, on this branch before any change:

```bash
cd web && npm ci && NEXT_TELEMETRY_DISABLED=1 npm run build
rm -rf ../.superpowers/docs-baseline && mkdir -p ../.superpowers/docs-baseline
cp -r out ../.superpowers/docs-baseline/out
```

`.superpowers/` is git-ignored. Save this comparison tool as `.superpowers/docs-baseline/landing-compare.mjs`
(it is never committed; Task 22 runs it again):

```js
// Compares the exported landing page (index.html) of two static exports: first-load JavaScript, CSS rules and
// HTML. Usage: node landing-compare.mjs <baseline out/> <new out/>. Exits 1 when the landing changed in a way
// a reader could see. Asset file names (content hashes) are ignored.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const [baseDir, newDir] = process.argv.slice(2);
if (!baseDir || !newDir) {
  console.error("usage: node landing-compare.mjs <baseline out/> <new out/>");
  process.exit(2);
}

const html = (dir) => readFileSync(join(dir, "index.html"), "utf8");
const file = (dir, url) => readFileSync(join(dir, url.split("?")[0]));

function scripts(dir) {
  const page = html(dir);
  const urls = new Set([...page.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]));
  for (const [tag] of page.matchAll(/<link[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (href && (/as="script"/.test(tag) || /rel="modulepreload"/.test(tag))) urls.add(href);
  }
  return [...urls].reduce((sum, url) => sum + gzipSync(file(dir, url), { level: 9 }).length, 0);
}

function cssRules(dir) {
  const page = html(dir);
  const urls = [...new Set([...page.matchAll(/href="(\/_next\/static\/[^"]+\.css)"/g)].map((m) => m[1]))];
  const text = urls.map((url) => file(dir, url).toString("utf8")).join("").replace(/\n/g, "");
  const counts = new Map();
  for (const rule of text.split("}")) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return counts;
}

function classesInHtml(page) {
  const used = new Set();
  for (const m of page.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) used.add(c);
  for (const m of page.matchAll(/className\\?":\\?"([^"\\]*)/g)) for (const c of m[1].split(/\s+/)) used.add(c);
  return used;
}

/** The class names a CSS rule targets, unescaped (".md\:grid" → "md:grid"). */
function classesInRule(rule) {
  const selector = rule.slice(0, Math.max(0, rule.lastIndexOf("{")));
  return [...selector.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
}

/**
 * The page a reader and a crawler see: the markup and meta tags, without Next's scripts, its React payload and
 * its asset links, whose names and number change with the build. The OG image URL loses its cache-busting
 * query when the landing names the image itself (app/(site)/layout.tsx), so that query is dropped too.
 */
const normalize = (page) =>
  page
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
    .replace(/<link[^>]*href="\/_next\/static\/[^"]*"[^>]*>/g, "")
    .replace(/(opengraph-image\.png)\?[^"]*/g, "$1");

/** The tags (with the text that follows each) found more often in one page than the other, so a reader can judge a change. */
function htmlDifference(x, y) {
  const parts = (page) =>
    page.split("<").filter(Boolean).reduce((m, p) => m.set(`<${p}`.slice(0, 160), (m.get(`<${p}`.slice(0, 160)) ?? 0) + 1), new Map());
  const a = parts(x);
  const b = parts(y);
  const more = (p, q) => [...p].filter(([k, n]) => (q.get(k) ?? 0) < n).map(([k]) => k);
  return { onlyInBaseline: more(a, b), onlyInNew: more(b, a) };
}

const baseJs = scripts(baseDir);
const newJs = scripts(newDir);
const a = cssRules(baseDir);
const b = cssRules(newDir);
const onlyIn = (x, y) => [...x].filter(([k, n]) => (y.get(k) ?? 0) < n).map(([k]) => k);
const used = classesInHtml(html(newDir));
const removed = onlyIn(a, b).map((rule) => ({ rule: rule.slice(0, 100), classes: classesInRule(rule) }));
const removedButUsed = removed.filter((r) => r.classes.some((c) => used.has(c)));
const added = onlyIn(b, a).map((rule) => rule.slice(0, 100));
const htmlSame = normalize(html(baseDir)) === normalize(html(newDir));

const report = {
  js: { baselineGzip: baseJs, newGzip: newJs, deltaGzip: newJs - baseJs },
  css: { rulesOnlyInBaseline: removed.length, rulesOnlyInNew: added, removedRulesTheLandingStillUses: removedButUsed },
  removedRules: removed,
  htmlIdenticalApartFromAssetNames: htmlSame,
  htmlDifference: htmlSame ? null : htmlDifference(normalize(html(baseDir)), normalize(html(newDir))),
};
console.log(JSON.stringify(report, null, 2));

// What a reader could see: a rule the page still uses went missing, a new rule that is not Tailwind's
// @layer properties bookkeeping, or different HTML. More than 1 KB of extra gzip JavaScript is flagged too.
const addedVisible = added.filter((rule) => !rule.startsWith("@layer properties"));
const problems = [
  ...removedButUsed.map((r) => `removed CSS the landing uses: ${r.rule}`),
  ...addedVisible.map((rule) => `new CSS on the landing: ${rule}`),
  ...(htmlSame ? [] : ["landing HTML changed"]),
  ...(newJs - baseJs > 1024 ? [`first-load JS grew by ${newJs - baseJs} B gzip (limit 1024)`] : []),
];
if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log("landing unchanged for a reader");
```

Run it against itself: `node ../.superpowers/docs-baseline/landing-compare.mjs ../.superpowers/docs-baseline/out out`.
Expected: `landing unchanged for a reader`.

- [ ] **Step 2: Install the docs dependencies.**

```bash
cd web
npm install --save-exact fumadocs-core@16.18.1 fumadocs-ui@16.18.1 fumadocs-mdx@15.5.0 zod@4.6.7
npm install --save-dev --save-exact @types/mdx@2.0.14
```

- [ ] **Step 3: Write the failing frontmatter test** `web/test/docs-frontmatter.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { docsFrontmatter, STATUS_LABEL } from "@/lib/docs/frontmatter";

const GOOD = {
  title: "The nine checks",
  description: "The ordered checks the vault runs on every proposed trade.",
  type: "concept",
  audience: ["newcomer"],
  status: "fork-tested",
  lastReviewed: "2026-11-07",
};

describe("docsFrontmatter", () => {
  it("accepts a page and fills the defaults", () => {
    expect(docsFrontmatter.parse(GOOD)).toMatchObject({ sources: [], next: [] });
    expect(docsFrontmatter.parse({ ...GOOD, next: ["concepts/nine-checks"] }).next).toEqual(["concepts/nine-checks"]);
  });

  it.each([
    ["an unknown type", { type: "tutorial" }],
    ["no audience", { audience: [] }],
    ["an unknown status", { status: "beta" }],
    ["a date that is not ISO", { lastReviewed: "7 Nov 2026" }],
    ["an empty next", { next: [] }],
    ["four next pages", { next: ["a", "b", "c", "d"] }],
    ["a next URL instead of a slug", { next: ["/docs/concepts/nine-checks"] }],
  ])("rejects %s", (_name, patch) => {
    expect(docsFrontmatter.safeParse({ ...GOOD, ...patch }).success).toBe(false);
  });

  it("labels every status", () => {
    expect(STATUS_LABEL["fork-tested"]).toBe("Fork-tested");
    expect(STATUS_LABEL.live).toBe("Live on mainnet");
  });
});
```

Run: `cd web && npx vitest run test/docs-frontmatter.test.ts`
Expected: FAIL: `Failed to resolve import "@/lib/docs/frontmatter"`.

- [ ] **Step 4: Write the schema** `web/lib/docs/frontmatter.ts`:

```ts
import { pageSchema } from "fumadocs-core/source/schema";
import { z } from "zod";

// Relative imports only: source.config.ts loads this file through the fumadocs-mdx bundler, outside Next.

export const DOC_TYPES = ["concept", "guide", "reference", "help", "overview"] as const;
export const AUDIENCES = ["newcomer", "watcher", "developer", "builder", "evaluator"] as const;
export const STATUSES = ["fork-tested", "live", "planned"] as const;

export type DocStatus = (typeof STATUSES)[number];
export type Audience = (typeof AUDIENCES)[number];

/** A docs page path below /docs, like concepts/nine-checks. */
const slug = z.string().regex(/^[a-z0-9-]+(\/[a-z0-9-]+)*$/, "use a docs path like concepts/nine-checks");

/** Docs frontmatter: the Fumadocs page fields plus what the docs center tracks per page. */
export const docsFrontmatter = pageSchema.extend({
  type: z.enum(DOC_TYPES),
  audience: z.array(z.enum(AUDIENCES)).min(1),
  status: z.enum(STATUSES),
  // YAML 1.2 keeps an unquoted 2026-11-07 a string, so quoted and unquoted dates both pass.
  lastReviewed: z.iso.date(),
  /** Repo paths the page is checked against, linked in its "Source of truth" box. */
  sources: z.array(z.string().min(1)).default([]),
  /** Pages to read next, in order. */
  next: z.array(slug).min(1).max(3).default([]),
});

export type DocsFrontmatter = z.infer<typeof docsFrontmatter>;

export const STATUS_LABEL: Record<DocStatus, string> = {
  "fork-tested": "Fork-tested",
  live: "Live on mainnet",
  planned: "Planned",
};

export const AUDIENCE_LABEL: Record<Audience, string> = {
  newcomer: "Newcomer",
  watcher: "Watcher",
  developer: "Developer",
  builder: "Builder",
  evaluator: "Evaluator",
};
```

Run: `cd web && npx vitest run test/docs-frontmatter.test.ts`. Expected: PASS (9 tests).

- [ ] **Step 5: Move the landing page into its route group.**

```bash
cd web
mkdir -p "app/(site)"
git mv app/layout.tsx "app/(site)/layout.tsx"
git mv app/page.tsx "app/(site)/page.tsx"
```

Replace `web/app/(site)/layout.tsx` with the version below. Only two things change: the stylesheet import
is now `../globals.css`, and the landing names its OG image itself (the file-based image at
`app/opengraph-image.png` sits above both root layouts, where Next no longer applies it to `/`).

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { SITE, siteUrl } from "@/lib/site";
import "../globals.css";

// app/opengraph-image.png sits above both root layouts. Next applies a file-based OG image only at its own
// segment, and the openGraph object below would replace it, so the landing names the image itself.
// (A metadata image inside a route group gets a hashed URL, so the file stays at the app root.)
const ogImage = {
  url: "/opengraph-image.png",
  type: "image/png",
  width: 1200,
  height: 630,
  alt: readFileSync(join(process.cwd(), "app/opengraph-image.alt.txt"), "utf8"),
};

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: SITE.title,
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    locale: "en_US",
    images: [ogImage],
  },
  twitter: {
    card: "summary_large_image",
    site: SITE.xHandle,
    creator: SITE.xHandle,
    title: SITE.title,
    description: SITE.description,
    images: [ogImage],
  },
};

export const viewport: Viewport = { themeColor: "white" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

In `web/test/page.test.tsx`, change `import Page from "@/app/page";` to `import Page from "@/app/(site)/page";`.

- [ ] **Step 6: Make the landing stylesheet an allow-list.** In `web/app/globals.css`, replace the first
  line, `@import "tailwindcss";`, with:

```css
@import "tailwindcss" source(none);

/* Only the landing page's own files feed this stylesheet. The docs have app/(docs)/docs.css, and tests,
   scripts and Markdown stay out too, so a plain word in their prose never becomes a landing utility.
   A new landing folder under components/ must be added here. */
@source "./(site)";
@source "../components/*.tsx";
@source "../components/{charts,sections,ui}";
@source "../content/*.ts";
@source "../lib/site.ts";
```

Measured in the spike: the landing CSS loses exactly four utilities the page never used (`static`,
`container`, `table`, `transform`, which leaked in from words in tests and the README) and their
`@property` rules; the landing HTML uses the same 263 classes as before.

- [ ] **Step 7: Wire Fumadocs into Next.** Replace `web/next.config.ts` with:

```ts
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

// W1 ships as a static site (spec §5.1). W2 drops `output: "export"` when the ledger reads mainnet server-side.
const config: NextConfig = {
  output: "export",
};

export default createMDX()(config);
```

Create `web/source.config.ts`:

```ts
import { metaSchema } from "fumadocs-core/source/schema";
import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { docsFrontmatter } from "./lib/docs/frontmatter";

export const docs = defineDocs({
  dir: "content/docs",
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
    // The default github-light keywords (#D73A49) and github-dark comments (#6A737D) fall below 4.5:1 on the docs
    // code background. The high-contrast pair passes in both themes. defaultColor: false keeps both as CSS variables.
    rehypeCodeOptions: {
      themes: { light: "github-light-high-contrast", dark: "github-dark-high-contrast" },
      defaultColor: false,
    },
  },
});
```

Create `web/lib/docs-source.ts`:

```ts
import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";

/** The docs page tree and page lookup, built from content/docs by fumadocs-mdx. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;
```

Add `web/.source/` (generated by fumadocs-mdx on every `next typegen`, `next dev` and `next build`) on its
own line to the repo root `.gitignore`, under the existing web entries.

- [ ] **Step 8: Write the docs root layout and providers.** `web/app/(docs)/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { DocsProvider } from "@/components/docs/DocsProvider";
import { SITE, siteUrl } from "@/lib/site";
import "./docs.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: `Docs · ${SITE.name}`, template: `%s · ${SITE.name} Docs` },
  description: SITE.description,
};

/** Root layout for /docs: its own <html>, stylesheet and providers, so nothing here reaches the landing page. */
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <DocsProvider>{children}</DocsProvider>
      </body>
    </html>
  );
}
```

`web/components/docs/DocsProvider.tsx` (search is off until Task 2 adds its index and dialog):

```tsx
"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";

/**
 * Fumadocs providers for /docs only: a light-by-default theme the reader can switch. Search arrives with its
 * index in the next task. hotKey: false turns off Fumadocs' single-key "d" theme toggle, easy to hit by accident.
 */
export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ enabled: false }} theme={{ defaultTheme: "light", enableSystem: false, hotKey: false }}>
      {children}
    </RootProvider>
  );
}
```

`web/app/(docs)/docs.css` (Signal tokens on the Fumadocs color slots, light and dark; only docs files feed it):

```css
/* Docs stylesheet. Loaded by app/(docs)/layout.tsx and the 404; the landing page keeps app/globals.css. */
@import "tailwindcss" source(none);
@import "fumadocs-ui/css/neutral.css";
@import "fumadocs-ui/css/preset.css";

/* Only docs files feed this stylesheet. Fumadocs UI lists its own classes with @source inline(). */
@source "./";
@source "../../components/docs";
@source "../../content/docs";
/* The 404 page (app/global-not-found.tsx) uses this stylesheet too. */
@source "../global-not-found.tsx";

/* Signal tokens (app/globals.css) mapped onto the Fumadocs color slots. Light is the default. */
@theme {
  --color-fd-background: #ffffff;
  --color-fd-foreground: #0b0d12;
  --color-fd-muted: #f6f7f9;
  --color-fd-muted-foreground: #5a6170;
  --color-fd-popover: #ffffff;
  --color-fd-popover-foreground: #0b0d12;
  --color-fd-card: #fbfbfc;
  --color-fd-card-foreground: #0b0d12;
  --color-fd-border: #e6e8ec;
  --color-fd-primary: #1f3bff;
  --color-fd-primary-foreground: #ffffff;
  --color-fd-secondary: #f1f2f5;
  --color-fd-secondary-foreground: #0b0d12;
  --color-fd-accent: #eef1ff;
  --color-fd-accent-foreground: #0b0d12;
  --color-fd-ring: #1f3bff;

  --font-sans: var(--font-geist-sans), system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}

/* Signal dark: same hues, ink as the canvas, the lighter feather blue as the accent for AA contrast. */
.dark {
  --color-fd-background: #0b0d12;
  --color-fd-foreground: #e9ebf0;
  --color-fd-muted: #151821;
  --color-fd-muted-foreground: #a0a6b4;
  --color-fd-popover: #12151c;
  --color-fd-popover-foreground: #e9ebf0;
  --color-fd-card: #11141b;
  --color-fd-card-foreground: #e9ebf0;
  --color-fd-border: #262a35;
  --color-fd-primary: #8ea2ff;
  --color-fd-primary-foreground: #0b0d12;
  --color-fd-secondary: #1a1e28;
  --color-fd-secondary-foreground: #e9ebf0;
  --color-fd-accent: #1b2147;
  --color-fd-accent-foreground: #e9ebf0;
  --color-fd-ring: #6e83ff;
}

/* neutral.css tints the dark sidebar with grey; keep it on the Signal dark scale. */
.dark #nd-sidebar {
  --color-fd-muted: #151821;
  --color-fd-secondary: #1a1e28;
  --color-fd-muted-foreground: #a0a6b4;
}
```

`web/app/(docs)/docs/layout.tsx` (header with the Maat mark, "Maat Docs", GitHub and X; sidebar by section;
the theme toggle sits in the sidebar footer on desktop and in the drawer on phones):

```tsx
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { Mark } from "@/components/ui/Mark";
import { source } from "@/lib/docs-source";
import { SITE } from "@/lib/site";

/** The docs header (logo, search, GitHub, X), the sidebar by section and the theme toggle in its footer. */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{
        title: (
          <>
            <Mark size={24} />
            <span>{SITE.name} Docs</span>
          </>
        ),
        url: "/docs",
      }}
      githubUrl={SITE.repoUrl}
      links={[
        { text: "Home", url: "/" },
        { text: SITE.xHandle, url: SITE.xUrl, external: true },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
```

- [ ] **Step 9: Write the page renderer and the MDX components.**
  `web/app/(docs)/docs/[[...slug]]/page.tsx` (Task 4 replaces it with the full page anatomy):

```tsx
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/docs/mdx";
import { source } from "@/lib/docs-source";
import { SITE } from "@/lib/site";

// Static export: every docs URL comes from generateStaticParams, nothing is rendered on request.
export const dynamicParams = false;

export default async function Page({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const { body: MDX, toc, full, title, description } = page.data;
  return (
    <DocsPage toc={toc} full={full}>
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription>{description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const { title, description } = page.data;
  // This openGraph object replaces the file-based image from app/opengraph-image.png, so name it here.
  const images = { url: "/opengraph-image.png", width: 1200, height: 630 };
  return {
    title,
    description,
    alternates: { canonical: page.url },
    openGraph: { type: "article", url: page.url, siteName: SITE.name, title, description, images },
    twitter: { card: "summary_large_image", site: SITE.xHandle, title, description, images },
  };
}
```

`web/components/docs/mdx.tsx`:

```tsx
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/** Components available in every docs MDX page. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, ...components };
}
```

- [ ] **Step 10: Write the seed page.** `web/content/docs/index.mdx` (Task 7 replaces its body; the title
  and description are already the IA's):

```mdx
---
title: Maat docs
description: Understand Maat, verify every claim against the code, run it, and run your own vault. Pick the path that fits why you came.
type: overview
audience: [newcomer, watcher, developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
---

Maat is an AI agent that proposes trades in tokenized stocks. A vault on Base weighs every proposal
against an onchain mandate and refuses anything that fails a check.
```

`web/content/docs/meta.json`:

```json
{
  "title": "Maat docs",
  "pages": ["index"]
}
```

- [ ] **Step 11: Fix the Windows export.** Next 16.4.5 writes the docs' segment prefetch files into nested
  folders when it builds on Windows, so the client's prefetch gets a 404 and logs a console error. Create
  `web/scripts/fix-export-segments.mjs`:

```js
// Fixes the segment prefetch files of a static export built on Windows. A no-op anywhere else.
//
// Why: in Next 16.4.5, export/index.js collects each page's segment files with collectSegmentPaths(), which names
// them with path.relative(). On Windows that returns backslashes ("!KGRvY3Mp\docs\$oc$slug\__PAGE__"), and
// convertSegmentPathToStaticExportFilename() only turns "/" into ".". The file lands in nested folders,
// out/docs/__next.!KGRvY3Mp/docs/$oc$slug/__PAGE__.txt, while the client prefetches the dot-joined name,
// out/docs/__next.!KGRvY3Mp.docs.$oc$slug.__PAGE__.txt, gets a 404 and logs an error. Builds on Linux (Vercel)
// write the dot-joined names directly, so there is nothing to fix there.
//
// What: every folder named __next.* holds misnamed files; copy each one to its dot-joined name next to the folder.
// Running it again finds the copies in place and changes nothing.
//
// Usage: node scripts/fix-export-segments.mjs <outDir>
import { copyFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const out = process.argv[2];
if (!out || !existsSync(out)) {
  console.error("usage: node scripts/fix-export-segments.mjs <outDir>");
  process.exit(1);
}

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));

let copied = 0;
let present = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "_next") continue;
    const path = join(dir, entry.name);
    if (!entry.name.startsWith("__next.")) {
      walk(path);
      continue;
    }
    for (const file of files(path)) {
      const flat = join(dir, relative(dir, file).split(sep).join("."));
      if (existsSync(flat) && readFileSync(flat).equals(readFileSync(file))) {
        present++;
        continue;
      }
      copyFileSync(file, flat);
      copied++;
      console.log(`fix-export-segments: ${relative(out, file)} -> ${relative(out, flat)}`);
    }
  }
}

walk(out);
console.log(
  copied + present === 0
    ? "fix-export-segments: no misnamed segment files, nothing to do"
    : `fix-export-segments: copied ${copied}, already in place ${present}`,
);
```

In `web/package.json`, change the build script to
`"build": "next build && node scripts/fix-export-segments.mjs out",`. On Linux (Vercel) it finds nothing to
fix.

- [ ] **Step 12: Typecheck and run the unit tests.**
  Run: `cd web && npm run typecheck && npm test`
  Expected: no type errors (`next typegen` generates `.source/` first); every test PASS, including
  `test/page.test.tsx` from its new import.

- [ ] **Step 13: Build and check the export.**
  Run: `cd web && NEXT_TELEMETRY_DISABLED=1 npm run build && npm run check:out`
  Expected: the build lists `/docs`; `out/docs.html` exists; `out/ is ready to deploy`.

- [ ] **Step 14: Run the landing e2e.**
  Run: `cd web && npx playwright test e2e/smoke.spec.ts`
  Expected: PASS at every width.

- [ ] **Step 15: Compare the landing page with the baseline.**
  Run: `cd web && node ../.superpowers/docs-baseline/landing-compare.mjs ../.superpowers/docs-baseline/out out`
  Expected: `landing unchanged for a reader`. The report shows the four removed utilities from Step 6 under
  `removedRules`, nothing under `removedRulesTheLandingStillUses`, and `deltaGzip` near 876: Next splits
  its own router code into different chunks once the app has a second root layout (measured in the spike;
  none of it is docs code, which Task 6's export check proves). Anything else is a regression: find it
  before you continue.

- [ ] **Step 16: Look at it.** Serve `out/` (`npx serve -L -n out`) and open `/docs` at 1440 px and 360 px:
  the Signal colors, the mark in the header, the drawer on phones. Open `/` and confirm it looks as before.

- [ ] **Step 17: Commit.**

```bash
git add .gitignore web/package.json web/package-lock.json web/next.config.ts web/source.config.ts web/app web/lib/docs-source.ts web/lib/docs/frontmatter.ts web/test/docs-frontmatter.test.ts web/test/page.test.tsx web/components/docs web/content/docs web/scripts/fix-export-segments.mjs
git commit -m "feat(web): serve docs from their own root layout, leaving the landing page as it was"
```

### Task 2: Search and the 404 page

Ctrl/Cmd+K search over a static index exported at build time and searched in the browser, with designed
loading, empty and error states, and a 404 page (landing and docs URLs alike) that offers the search and
the list of sections. The search code loads on first use, not with the page.

**Files:**
- Create: `web/app/api/search/route.ts`
- Create: `web/components/docs/SearchDialog.tsx`
- Modify: `web/components/docs/DocsProvider.tsx`
- Create: `web/app/global-not-found.tsx`
- Modify: `web/next.config.ts` (`experimental.globalNotFound`)
- Create: `web/e2e/docs.spec.ts`

**Interfaces:**
- Consumes: `source` (Task 1), `DocsProvider` (Task 1), `SITE`, `siteUrl()`.
- Produces: `out/api/search` (the static index); `e2e/docs.spec.ts`, which Tasks 4, 6, 8, 13 and 14 extend;
  the `openSearch(page)` helper in it.

- [ ] **Step 1: Write the failing end-to-end tests** `web/e2e/docs.spec.ts`. They cover the search states
  (Review Focus 3) and the 404:

```ts
import { expect, type Page, test } from "@playwright/test";

/** Opens search the way a reader does. Playwright sends "K" for "Control+K"; a real Ctrl+K sends "k", which Fumadocs matches. */
async function openSearch(page: Page) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("search", () => {
  test("Ctrl+K opens it and \"maat\" finds the docs home", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await dialog.getByRole("option", { name: /Maat docs/ }).first().click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("a query with no match shows the empty state", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("zzzzqqq");
    await expect(dialog.getByRole("status").filter({ hasText: "No results" })).toHaveText(
      'No results for "zzzzqqq". Try a reason code like MARKET_CLOSED.',
    );
  });

  test("a slow index shows the loading state, then the results", async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("status").filter({ hasText: "Searching..." })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });

  test("an index that cannot load shows the error state, not a spinner", async ({ page }) => {
    await page.route("**/api/search**", (route) => route.abort());
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("alert")).toContainText("Search is unavailable. Check your connection and try again.");
    await expect(dialog.getByText("Searching...")).toHaveCount(0);

    // Back online: "Try again" downloads the index again and the results come back.
    await page.unroute("**/api/search**");
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });
});

test("the 404 page offers search and the docs sections", async ({ page }) => {
  for (const path of ["/does-not-exist", "/docs/does-not-exist"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist.");
    await expect(page.getByRole("link", { name: "Maat docs" })).toHaveAttribute("href", "/docs");
  }
  await page.locator("button[data-search-full]").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("maat");
  await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
});
```

Run: `cd web && npm run build && npx playwright test e2e/docs.spec.ts`
Expected: FAIL: Ctrl+K opens no dialog, and `/does-not-exist` shows Next's plain 404 without the heading.

- [ ] **Step 2: Export the index.** `web/app/api/search/route.ts`:

```ts
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/docs-source";

// Exported once at build time to out/api/search; the docs search dialog downloads it and searches in the browser.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
```

- [ ] **Step 3: Write the dialog** `web/components/docs/SearchDialog.tsx`. The list body is custom so the
  states can say something useful: Fumadocs' own error line cannot be changed, and its static client keeps
  a failed download for the same URL, so "Try again" asks under a new query string.

```tsx
"use client";

import { useStaticSearch } from "fumadocs-core/search/client/orama-static";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  useSearch,
} from "fumadocs-ui/components/dialog/search";
import type { SharedProps } from "fumadocs-ui/contexts/search";
import { useState } from "react";

const status = "px-3 py-10 text-center text-sm text-fd-muted-foreground";

function NoResults() {
  const { query } = useSearch();
  return (
    <p role="status" className={status}>
      No results for &quot;{query}&quot;. Try a reason code like MARKET_CLOSED.
    </p>
  );
}

/**
 * The list body: results, or one clear state. The static client caches a failed index download for its URL,
 * so "Try again" asks for the index under a new query string.
 */
function Results({ onRetry }: { onRetry: () => void }) {
  const { search, isLoading, data, error } = useSearch();
  if (error && !data) {
    return (
      <div role="alert" className={status}>
        <p>Search is unavailable. Check your connection and try again.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-11 items-center rounded-md border border-fd-border px-3 font-medium text-fd-foreground hover:bg-fd-accent md:min-h-9"
        >
          Try again
        </button>
      </div>
    );
  }
  if (isLoading && !data && search) {
    return (
      <p role="status" className={status}>
        Searching...
      </p>
    );
  }
  return <SearchDialogList Empty={() => <NoResults />} />;
}

/** Ctrl/Cmd+K search over the index exported to /api/search at build time; runs entirely in the browser. */
export default function DocsSearchDialog(props: SharedProps) {
  const [attempt, setAttempt] = useState(0);
  const search = useStaticSearch({ from: attempt === 0 ? "/api/search" : `/api/search?attempt=${attempt}` });
  return (
    <SearchDialog {...search} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <Results onRetry={() => setAttempt((n) => n + 1)} />
      </SearchDialogContent>
    </SearchDialog>
  );
}
```

Replace `web/components/docs/DocsProvider.tsx` with:

```tsx
"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Loaded on first use, so the search code stays out of the docs first load.
const SearchDialog = dynamic(() => import("./SearchDialog"), { ssr: false });

/**
 * Fumadocs providers for /docs only: static search, and a light-by-default theme the reader can switch.
 * hotKey: false turns off Fumadocs' single-key "d" theme toggle, easy to hit by accident.
 */
export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog }} theme={{ defaultTheme: "light", enableSystem: false, hotKey: false }}>
      {children}
    </RootProvider>
  );
}
```

- [ ] **Step 4: Write the 404.** With two root layouts there is no shared layout for a `not-found.tsx`, so
  the 404 is a global one that brings the docs stylesheet and providers itself. `web/app/global-not-found.tsx`:

```tsx
import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { FullSearchTrigger } from "fumadocs-ui/layouts/shared/slots/search-trigger";
import Link from "next/link";
import { DocsProvider } from "@/components/docs/DocsProvider";
import { source } from "@/lib/docs-source";
import { SITE, siteUrl } from "@/lib/site";
import "./(docs)/docs.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: `Page not found · ${SITE.name}`,
  description: "This page does not exist.",
};

/** Each top-level docs section with the URL of its first page, in sidebar order. */
function sections() {
  return source.getPageTree().children.flatMap((node) => {
    if (node.type === "page") return [{ name: node.name, url: node.url }];
    if (node.type !== "folder") return [];
    const first = node.index ?? node.children.find((child) => child.type === "page");
    return first && first.type === "page" ? [{ name: node.name, url: first.url }] : [];
  });
}

/**
 * 404 for any URL no route matches, landing or docs. With two root layouts there is no shared layout to wrap a
 * not-found.tsx, so this page brings the docs stylesheet and providers itself (search needs them).
 */
export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <DocsProvider>
          <main className="mx-auto w-full max-w-xl px-4 py-24">
            <p className="font-mono text-sm text-fd-muted-foreground">404</p>
            <h1 className="mt-2 text-3xl font-semibold">This page does not exist.</h1>
            <p className="mt-4 text-fd-muted-foreground">Search the docs, or start from a section.</p>
            <FullSearchTrigger className="mt-6 min-h-11 w-full" />
            <h2 className="mt-10 text-sm font-semibold">Docs sections</h2>
            <ul className="mt-2 grid gap-1">
              {sections().map((s) => (
                <li key={s.url}>
                  <Link href={s.url} className="inline-flex min-h-11 items-center text-fd-primary underline-offset-4 hover:underline">
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-10 text-sm">
              <Link href="/" className="inline-flex min-h-11 items-center text-fd-muted-foreground hover:text-fd-foreground">
                Back to the home page
              </Link>
            </p>
          </main>
        </DocsProvider>
      </body>
    </html>
  );
}
```

In `web/next.config.ts`, add the flag inside `config`, after `output: "export",`:

```ts
  // Two root layouts, (site) and (docs), so the 404 for unmatched URLs comes from app/global-not-found.tsx.
  experimental: { globalNotFound: true },
```

- [ ] **Step 5: Run the tests.**
  Run: `cd web && npm run typecheck && npm run build && npx playwright test e2e/docs.spec.ts`
  Expected: PASS (5 tests). A 404 page logs one console error for its own 404 response; that is expected
  and these tests do not collect console errors.

- [ ] **Step 6: Check the search stays off the first load.** Run `cd web && npm run check:out`, then open
  `/docs` with the browser's network panel: `/api/search` is requested only after Ctrl+K.

- [ ] **Step 7: Commit.**

```bash
git add web/app/api/search/route.ts web/components/docs/SearchDialog.tsx web/components/docs/DocsProvider.tsx web/app/global-not-found.tsx web/next.config.ts web/e2e/docs.spec.ts
git commit -m "feat(web): add docs search with loading, empty and error states, and a 404 with search"
```

### Task 3: Facts the docs cite, rendered at build time

Docs pages never type a number: they write `<Fact name="timelockHours" />`. This task adds the numbers only
the docs need to `DOCS_FACTS` (each with a parity test against the contract or agent source, like the
landing page's `FACTS`), a `FACT_TEXT` table that formats each value with its unit, and a remark plugin that
replaces every `<Fact />` with its text while the MDX compiles. Because the value is plain text by the time
Fumadocs indexes the page, search, `llms-full.txt` and "Copy page as Markdown" all see "24 hours", not an
empty tag. An unknown name fails the build and names the file.

`DOCS_FACTS` lives in its own module, `web/content/docs-facts.ts`, not in `FACTS`: the landing page imports
`FACTS`, so every entry added there would ship in the landing page's JavaScript (measured: about 600 B
gzip for these fifteen).

**Files:**
- Create: `web/content/docs-facts.ts`
- Create: `web/test/docs-facts.test.ts`
- Create: `web/lib/docs/fact-text.ts`
- Create: `web/test/fact-text.test.ts`
- Create: `web/lib/docs/remark-facts.ts`
- Create: `web/test/remark-facts.test.ts`
- Modify: `web/source.config.ts` (register the plugin)
- Modify: `web/components/docs/mdx.tsx` (a guard for a `<Fact />` the plugin missed)
- Modify: `web/content/docs/index.mdx` (one sentence with a fact)

**Interfaces:**
- Consumes: `FACTS`, `type Fact` (`web/content/facts.ts`, unchanged), `formatInt`, `clockLabel`
  (`web/content/format.ts`).
- Produces: `DOCS_FACTS` (`web/content/docs-facts.ts`); `ALL_FACTS` (`FACTS` plus `DOCS_FACTS`), `FACT_TEXT`,
  `type FactName`, `isFactName(name): name is FactName`, `factFor(name): { text: string; source: string }`
  (throws on an unknown name), `FACT_TEXT_MAP` (`Record<string, string>`, used by the facts lint in Task 6)
  from `web/lib/docs/fact-text.ts`; `remarkFacts` from `web/lib/docs/remark-facts.ts`.
  `lib/docs/fact-text.ts` uses relative imports because `source.config.ts` is bundled outside the `@/` alias.

- [ ] **Step 1: Write the failing parity tests** `web/test/docs-facts.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DOCS_FACTS } from "@/content/docs-facts";
import { FACTS } from "@/content/facts";
import { constantValue, readRepo, solidityNumber } from "./helpers/solidity";

describe("facts the docs cite (docs spec §2.4)", () => {
  const vault = readRepo("contracts/src/MandateVault.sol");
  const calendar = readRepo("contracts/src/MarketCalendar.sol");
  const config = readRepo("agent/src/config.ts");
  /** The constructor body only: the public addHoliday/setEarlyClose wrappers call the same helpers. */
  const ctor = /constructor\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(calendar)?.[1] ?? "";
  const zodDefault = (name: string) => {
    const v = new RegExp(`\\b${name}: field\\([^\\n]*\\.default\\(([\\d.]+)\\)\\)`).exec(config)?.[1];
    if (v === undefined) throw new Error(`no numeric default for ${name} in agent/src/config.ts`);
    return Number(v);
  };
  const tsConst = (file: string, name: string) => solidityNumber(constantValue(readRepo(file), name));

  it("adds no key FACTS already has", () => {
    expect(Object.keys(DOCS_FACTS).filter((k) => Object.hasOwn(FACTS, k))).toEqual([]);
  });

  it("timelock grace period and the de-risk window cap", () => {
    expect(solidityNumber(constantValue(vault, "GRACE_PERIOD"))).toBe(DOCS_FACTS.gracePeriodDays.value * 86_400);
    expect(solidityNumber(constantValue(vault, "MAX_DERISK_WINDOW"))).toBe(DOCS_FACTS.maxDeriskWindowHours.value * 3600);
  });

  it("calendar preload: holidays, early closes and their close time", () => {
    expect(ctor).not.toBe("");
    expect([...ctor.matchAll(/_addHoliday\(/g)]).toHaveLength(DOCS_FACTS.calendarPreload.value.holidays);
    const closes = [...ctor.matchAll(/_setEarlyClose\([^)]*,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    expect(closes).toHaveLength(DOCS_FACTS.calendarPreload.value.earlyCloses);
    expect(new Set(closes)).toEqual(new Set([DOCS_FACTS.earlyCloseMin.value]));
  });

  it("agent settings defaults", () => {
    expect(zodDefault("MAAT_MAX_TX_PER_DAY")).toBe(DOCS_FACTS.maxTxPerDay.value);
    expect(zodDefault("MAAT_DEFAULT_DAILY_COMPUTE_USD")).toBe(DOCS_FACTS.dailyComputeUsd.value);
  });

  it("Claude proposal limits", () => {
    expect(tsConst("agent/src/llm/schema.ts", "MAX_INTENTS")).toBe(DOCS_FACTS.maxIntents.value);
    expect(tsConst("agent/src/llm/schema.ts", "MAX_RATIONALE_CHARS")).toBe(DOCS_FACTS.maxRationaleChars.value);
  });

  it("gas cap and execute floor", () => {
    expect(tsConst("agent/src/exec/calls.ts", "MAX_GAS")).toBe(DOCS_FACTS.maxGas.value);
    expect(tsConst("agent/src/exec/calls.ts", "EXECUTE_GAS_FLOOR")).toBe(DOCS_FACTS.executeGasFloor.value);
  });

  it("policy: cash reserve and runway", () => {
    const policy = readRepo("agent/src/policy.ts");
    const param = (name: string) =>
      Number(new RegExp(`DEFAULT_POLICY[^;]*\\b${name}:\\s*([\\d_]+)`).exec(policy)?.[1]?.replaceAll("_", ""));
    expect(param("cashReserveBps") / 100).toBe(DOCS_FACTS.cashReservePct.value);
    expect(param("runwayDays")).toBe(DOCS_FACTS.runwayDays.value);
  });

  it("off-session cadence and the smallest bill", () => {
    const minutes = /OFF_SESSION_MS\s*=\s*(\d+)\s*\*\s*60_000/.exec(readRepo("agent/src/loop/scheduler.ts"))?.[1];
    expect(Number(minutes)).toBe(DOCS_FACTS.offSessionMinutes.value);
    expect(tsConst("agent/src/loop/runOnce.ts", "BILL_MIN_USD6") / 1e6).toBe(DOCS_FACTS.billMinUsd.value);
  });

  it("treasury size is the design spec's constraint", () => {
    const spec = readRepo("docs/superpowers/specs/2026-11-06-mandate-treasury-design.md");
    const m = /small mainnet amounts \(\$(\d+)[–-](\d+)\)/.exec(spec);
    expect(m && { min: Number(m[1]), max: Number(m[2]) }).toEqual(DOCS_FACTS.treasuryUsd.value);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**
  Run: `cd web && npx vitest run test/docs-facts.test.ts`
  Expected: FAIL: `Failed to resolve import "@/content/docs-facts"`.

- [ ] **Step 3: Write the facts** `web/content/docs-facts.ts`:

```ts
import type { Fact } from "./facts";

const fact = <T>(value: T, source: string): Fact<T> => ({ value, source });
const SPEC = "docs/superpowers/specs/2026-11-06-mandate-treasury-design.md";

/**
 * Numbers only the docs center cites (docs spec §2.4). They live apart from FACTS so the landing page's
 * bundle does not carry them. test/docs-facts.test.ts checks each one against the file it names.
 */
export const DOCS_FACTS = {
  gracePeriodDays: fact(7, "contracts/src/MandateVault.sol GRACE_PERIOD = 7 days, the window to apply a queued change"),
  maxDeriskWindowHours: fact(
    12,
    "contracts/src/MandateVault.sol MAX_DERISK_WINDOW = 12 hours, the longest deriskWindow a mandate may set",
  ),
  earlyCloseMin: fact(780, "contracts/src/MarketCalendar.sol constructor: _setEarlyClose(..., 780), a 13:00 ET close"),
  calendarPreload: fact(
    { holidays: 3, earlyCloses: 2 },
    "contracts/src/MarketCalendar.sol constructor: _addHoliday and _setEarlyClose calls",
  ),
  maxTxPerDay: fact(40, "agent/src/config.ts MAAT_MAX_TX_PER_DAY default"),
  dailyComputeUsd: fact(0.5, "agent/src/config.ts MAAT_DEFAULT_DAILY_COMPUTE_USD default"),
  maxIntents: fact(6, "agent/src/llm/schema.ts MAX_INTENTS, intents per Claude proposal"),
  maxRationaleChars: fact(600, "agent/src/llm/schema.ts MAX_RATIONALE_CHARS, characters per intent rationale"),
  maxGas: fact(3_000_000, "agent/src/exec/calls.ts MAX_GAS, the gas limit cap on every transaction the agent sends"),
  executeGasFloor: fact(2_500_000, "agent/src/exec/calls.ts EXECUTE_GAS_FLOOR, the minimum gas limit for execute"),
  cashReservePct: fact(30, "agent/src/policy.ts DEFAULT_POLICY.cashReserveBps = 3000"),
  runwayDays: fact(7, "agent/src/policy.ts DEFAULT_POLICY.runwayDays, days of compute cost kept as cash"),
  offSessionMinutes: fact(60, "agent/src/loop/scheduler.ts OFF_SESSION_MS, agent loop cadence outside the session"),
  billMinUsd: fact(0.1, "agent/src/loop/runOnce.ts BILL_MIN_USD6 = 100_000n, the smallest compute bill the agent pays"),
  treasuryUsd: fact({ min: 20, max: 200 }, `${SPEC} §1 Constraints: small mainnet amounts, $20 to $200`),
} as const;
```

- [ ] **Step 4: Run the parity tests and the existing facts tests.**
  Run: `cd web && npx vitest run test/docs-facts.test.ts test/facts.test.ts`
  Expected: PASS. If a value does not match, the source changed: fix the fact, never the test.

- [ ] **Step 5: Write the failing `FACT_TEXT` test** `web/test/fact-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { ALL_FACTS, FACT_TEXT, factFor, isFactName } from "@/lib/docs/fact-text";

describe("FACT_TEXT", () => {
  it("formats values with their units", () => {
    const text = (n: keyof typeof FACT_TEXT) => FACT_TEXT[n].text;
    expect(text("forkBlock")).toBe("53,551,627");
    expect(text("mandate.perTradeCapUsd")).toBe("$50");
    expect(text("mandate.maxWeightBps")).toBe("4,000 bps");
    expect(text("mandate.multiplierCooldownSec")).toBe("24 hours");
    expect(text("mandate.deriskWindowSec")).toBe("8 hours");
    expect(text("mandate.targetHealthFactor")).toBe("2.0");
    expect(text("premiumsBps.NVDAc")).toBe("53 bps");
    expect(text("earlyClose")).toBe("13:00 ET");
    expect(text("billMinUsd")).toBe("$0.10");
    expect(text("dailyComputeUsd")).toBe("$0.50");
    expect(text("treasuryUsd")).toBe("$20 to $200");
    expect(text("maxGas")).toBe("3,000,000");
  });

  it("points every entry at a fact that exists", () => {
    for (const [name, f] of Object.entries(FACT_TEXT)) expect(Object.keys(ALL_FACTS), name).toContain(f.from);
  });

  it("factFor returns the text with its source, and names a bad key", () => {
    expect(factFor("timelockHours")).toEqual({ text: "24 hours", source: FACTS.timelockHours.source });
    expect(isFactName("gas.buy")).toBe(true);
    expect(isFactName("gas.sell")).toBe(false);
    expect(() => factFor("gas.sell")).toThrow('<Fact name="gas.sell" /> is not in FACT_TEXT');
  });
});
```

- [ ] **Step 6: Run it and see it fail.**
  Run: `cd web && npx vitest run test/fact-text.test.ts`
  Expected: FAIL: `Failed to resolve import "@/lib/docs/fact-text"`.

- [ ] **Step 7: Write** `web/lib/docs/fact-text.ts`:

```ts
import { DOCS_FACTS } from "../../content/docs-facts";
import { FACTS } from "../../content/facts";
import { clockLabel, formatInt } from "../../content/format";

/** Every number the docs may cite: the landing page's FACTS plus the docs-only DOCS_FACTS. */
export const ALL_FACTS = { ...FACTS, ...DOCS_FACTS };
const F = ALL_FACTS;

type FactKey = keyof typeof ALL_FACTS;

interface FactText {
  /** What the page shows, units included. */
  readonly text: string;
  /** The ALL_FACTS entry it comes from; its `source` is the tooltip and the default-parameters citation. */
  readonly from: FactKey;
}

const t = (text: string, from: FactKey): FactText => ({ text, from });
const usd = (n: number) => `$${n < 1 ? n.toFixed(2) : formatInt(n)}`;
const bps = (n: number) => `${formatInt(n)} bps`;
const m = F.mandate.value;
const gas = F.gas.value;
const prem = F.premiumsBps.value;

/**
 * Every value a docs page may show with <Fact name="…" />, as text. A dotted name reads one field of a
 * structured fact. Adding a number to the docs means adding it here, and to DOCS_FACTS
 * (content/docs-facts.ts) with a parity test in test/docs-facts.test.ts.
 */
export const FACT_TEXT = {
  checksPerTrade: t(String(F.checksPerTrade.value), "checksPerTrade"),
  refusalCount: t(String(F.refusalCount.value), "refusalCount"),
  timelockHours: t(`${F.timelockHours.value} hours`, "timelockHours"),
  gracePeriodDays: t(`${F.gracePeriodDays.value} days`, "gracePeriodDays"),
  forkBlock: t(formatInt(F.forkBlock.value), "forkBlock"),
  forkDay: t(F.forkDay.value, "forkDay"),
  forkTimeEt: t(`${F.forkTimeEt.value} ET`, "forkTimeEt"),
  weekendOffsetDays: t(String(F.weekendOffsetDays.value), "weekendOffsetDays"),
  feedAgeSec: t(`${F.feedAgeSec.value} s`, "feedAgeSec"),
  nvdaUiMultiplier: t(F.nvdaUiMultiplier.value, "nvdaUiMultiplier"),
  "premiumsBps.NVDAc": t(bps(prem.NVDAc), "premiumsBps"),
  "premiumsBps.GOOGLc": t(bps(prem.GOOGLc), "premiumsBps"),
  "premiumsBps.AAPLc": t(bps(prem.AAPLc), "premiumsBps"),
  "mandate.sessionMode": t(m.sessionMode, "mandate"),
  "mandate.maxStalenessSec": t(`${formatInt(m.maxStalenessSec)} s`, "mandate"),
  "mandate.maxPremiumBps": t(bps(m.maxPremiumBps), "mandate"),
  "mandate.maxSlippageBps": t(bps(m.maxSlippageBps), "mandate"),
  "mandate.twapWindowSec": t(`${formatInt(m.twapWindowSec)} s`, "mandate"),
  "mandate.multiplierCooldownSec": t(`${m.multiplierCooldownSec / 3600} hours`, "mandate"),
  "mandate.perTradeCapUsd": t(usd(m.perTradeCapUsd), "mandate"),
  "mandate.dailyCapUsd": t(usd(m.dailyCapUsd), "mandate"),
  "mandate.maxWeightBps": t(bps(m.maxWeightBps), "mandate"),
  "mandate.minHealthFactor": t(m.minHealthFactor.toFixed(1), "mandate"),
  "mandate.targetHealthFactor": t(m.targetHealthFactor.toFixed(1), "mandate"),
  "mandate.deriskWindowSec": t(`${m.deriskWindowSec / 3600} hours`, "mandate"),
  maxDeriskWindowHours: t(`${F.maxDeriskWindowHours.value} hours`, "maxDeriskWindowHours"),
  "gas.buy": t(formatInt(gas.buy), "gas"),
  "gas.supply": t(formatInt(gas.supply), "gas"),
  "gas.borrow": t(formatInt(gas.borrow), "gas"),
  "gas.refusalLog": t(formatInt(gas.refusalLog), "gas"),
  nyseOpen: t(`${clockLabel(F.nyseSessionMin.value.open)} ET`, "nyseSessionMin"),
  nyseClose: t(`${clockLabel(F.nyseSessionMin.value.close)} ET`, "nyseSessionMin"),
  feedEdge: t(`${clockLabel(F.feedEdgeMin.value)} ET`, "feedEdgeMin"),
  earlyClose: t(`${clockLabel(F.earlyCloseMin.value)} ET`, "earlyCloseMin"),
  "calendarPreload.holidays": t(String(F.calendarPreload.value.holidays), "calendarPreload"),
  "calendarPreload.earlyCloses": t(String(F.calendarPreload.value.earlyCloses), "calendarPreload"),
  loopMinutes: t(`${F.loopMinutes.value} minutes`, "loopMinutes"),
  offSessionMinutes: t(`${F.offSessionMinutes.value} minutes`, "offSessionMinutes"),
  rebalanceDriftPct: t(`${F.rebalanceDriftPct.value} percentage points`, "rebalanceDriftPct"),
  targetWeightPct: t(`${F.targetWeightPct.value}%`, "targetWeightPct"),
  cashReservePct: t(`${F.cashReservePct.value}%`, "cashReservePct"),
  runwayDays: t(`${F.runwayDays.value} days`, "runwayDays"),
  billMinUsd: t(usd(F.billMinUsd.value), "billMinUsd"),
  maxTxPerDay: t(String(F.maxTxPerDay.value), "maxTxPerDay"),
  dailyComputeUsd: t(usd(F.dailyComputeUsd.value), "dailyComputeUsd"),
  maxIntents: t(String(F.maxIntents.value), "maxIntents"),
  maxRationaleChars: t(String(F.maxRationaleChars.value), "maxRationaleChars"),
  maxGas: t(formatInt(F.maxGas.value), "maxGas"),
  executeGasFloor: t(formatInt(F.executeGasFloor.value), "executeGasFloor"),
  treasuryUsd: t(`${usd(F.treasuryUsd.value.min)} to ${usd(F.treasuryUsd.value.max)}`, "treasuryUsd"),
  x402Price: t(F.x402Price.value, "x402Price"),
  solidityVersion: t(F.solidityVersion.value, "solidityVersion"),
} as const satisfies Record<string, FactText>;

export type FactName = keyof typeof FACT_TEXT;

export function isFactName(name: string): name is FactName {
  return Object.hasOwn(FACT_TEXT, name);
}

/** The text and source for a name, or an error that names the bad key (the build fails on a typo). */
export function factFor(name: string): { text: string; source: string } {
  if (!isFactName(name)) throw new Error(`<Fact name="${name}" /> is not in FACT_TEXT (lib/docs/fact-text.ts)`);
  const f = FACT_TEXT[name];
  return { text: f.text, source: F[f.from].source };
}

/** name → text, the shape the facts lint in lib/docs/content-checks.ts takes. */
export const FACT_TEXT_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FACT_TEXT).map(([k, v]) => [k, v.text]),
);
```

- [ ] **Step 8: Run it.**
  Run: `cd web && npx vitest run test/fact-text.test.ts`
  Expected: PASS (3 tests).

- [ ] **Step 9: Write the failing plugin test** `web/test/remark-facts.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FACT_TEXT } from "@/lib/docs/fact-text";
import { type MdNode, remarkFacts } from "@/lib/docs/remark-facts";

const at = (line: number, start: number, end: number) => ({
  start: { line, column: 1, offset: start },
  end: { line, column: 1, offset: end },
});

const fact = (type: "mdxJsxTextElement" | "mdxJsxFlowElement", value: unknown, line = 3): MdNode => ({
  type,
  name: "Fact",
  attributes: [{ type: "mdxJsxAttribute", name: "name", value }],
  children: [],
  position: at(line, 10, 40),
});

/** A paragraph with a fact in its text, a list item holding a fact on its own line, and an unrelated JSX element. */
function tree(inText: MdNode, ownLine: MdNode): MdNode {
  return {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "Every trade passes " }, inText, { type: "text", value: " checks." }] },
      { type: "list", children: [{ type: "listItem", children: [ownLine] }] },
      { type: "mdxJsxFlowElement", name: "Callout", attributes: [], children: [] },
    ],
  };
}

const run = (root: MdNode, path = "content/docs/concepts/nine-checks.mdx") => remarkFacts()(root, { path });

describe("remarkFacts", () => {
  it("replaces <Fact /> in text and on its own line with the fact text", () => {
    const root = tree(fact("mdxJsxTextElement", "checksPerTrade"), fact("mdxJsxFlowElement", "timelockHours"));
    run(root);
    const [para, list, callout] = root.children!;
    expect(para!.children!.map((n) => n.value).join("")).toBe(`Every trade passes ${FACT_TEXT.checksPerTrade.text} checks.`);
    expect(para!.children![1]).toMatchObject({ type: "text", value: "9", position: at(3, 10, 40) });
    // A fact on its own line becomes a paragraph, so the list item still holds flow content.
    expect(list!.children![0]!.children![0]).toMatchObject({
      type: "paragraph",
      children: [{ type: "text", value: "24 hours" }],
    });
    expect(callout).toMatchObject({ type: "mdxJsxFlowElement", name: "Callout" });
  });

  it("fails on an unknown name, naming the file, the line and the name", () => {
    const root = tree(fact("mdxJsxTextElement", "nope", 7), fact("mdxJsxFlowElement", "timelockHours"));
    expect(() => run(root)).toThrow('content/docs/concepts/nine-checks.mdx:7: <Fact name="nope" /> is not in FACT_TEXT');
  });

  it("fails on a name that is not a string literal", () => {
    const root = tree(fact("mdxJsxTextElement", { type: "mdxJsxAttributeValueExpression", value: "x" }), fact("mdxJsxFlowElement", "gas.buy"));
    expect(() => run(root)).toThrow(/nine-checks\.mdx:3: <Fact \/> needs a literal name/);
  });
});
```

- [ ] **Step 10: Run it and see it fail.**
  Run: `cd web && npx vitest run test/remark-facts.test.ts`
  Expected: FAIL: `Failed to resolve import "@/lib/docs/remark-facts"`.

- [ ] **Step 11: Write the plugin** `web/lib/docs/remark-facts.ts`:

```ts
import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";
import { factFor } from "./fact-text";

interface Point {
  line: number;
  column: number;
  offset?: number;
}

/** The parts of an mdast node this plugin reads; structural, so it needs no mdast types. */
export interface MdNode {
  type: string;
  name?: string | null;
  value?: string;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: MdNode[];
  position?: { start: Point; end: Point };
}

type Replace = Parameters<typeof replaceSource>;

function isFact(node: MdNode): boolean {
  return (node.type === "mdxJsxTextElement" || node.type === "mdxJsxFlowElement") && node.name === "Fact";
}

/** The text for one <Fact />, or an error naming the file, the line and the bad name. */
function factText(node: MdNode, path: string | undefined): string {
  const where = `${path ?? "<unknown file>"}${node.position ? `:${node.position.start.line}` : ""}`;
  const name = node.attributes?.find((a) => a.type === "mdxJsxAttribute" && a.name === "name")?.value;
  if (typeof name !== "string") throw new Error(`${where}: <Fact /> needs a literal name, like <Fact name="checksPerTrade" />`);
  try {
    return factFor(name).text;
  } catch (e) {
    throw new Error(`${where}: ${(e as Error).message}`);
  }
}

/**
 * Replaces every <Fact name="x" /> with the text of FACT_TEXT[x]. It runs before Fumadocs' own plugins, so the page,
 * the search index and the processed Markdown all carry the value. An unknown name fails the build.
 */
export function remarkFacts() {
  return (tree: MdNode, file: { path?: string }) => {
    const walk = (parent: MdNode) => {
      const children = parent.children ?? [];
      for (let i = 0; i < children.length; i++) {
        const node = children[i]!;
        if (!isFact(node)) {
          walk(node);
          continue;
        }
        const text: MdNode = { type: "text", value: factText(node, file.path), position: node.position };
        // A <Fact /> alone on its line parses as a block; a paragraph keeps the tree valid there.
        const next: MdNode = node.type === "mdxJsxFlowElement" ? { type: "paragraph", children: [text], position: node.position } : text;
        children[i] = next;
        // Search records and processed Markdown are sliced from the authored source, which still says <Fact .../>.
        // Registering the text for the tag's range is what makes them print the value.
        replaceSource(file as Replace[0], next as Replace[1], text.value!);
      }
    };
    walk(tree);
  };
}
```

- [ ] **Step 12: Register it.** In `web/source.config.ts`, add the import after the frontmatter import:

```ts
import { remarkFacts } from "./lib/docs/remark-facts";
```

and add this as the first entry of `mdxOptions`, before `rehypeCodeOptions`:

```ts
    // First, before Fumadocs' plugins, so the TOC, the search index and the processed Markdown see the values.
    remarkPlugins: (plugins) => [remarkFacts, ...plugins],
```

Replace `web/components/docs/mdx.tsx` with the version that fails loudly if a `<Fact />` ever reaches
render (Task 5 adds the other components to this file):

```tsx
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

// <Fact /> is replaced with text at build time (lib/docs/remark-facts.ts). Reaching render means that plugin did not run.
function Fact({ name }: { name?: string }): never {
  throw new Error(`<Fact name="${name ?? ""}" /> reached render: remarkFacts is missing from source.config.ts`);
}

/** Components available in every docs MDX page. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return { ...defaultMdxComponents, Fact, ...components };
}
```

Append this paragraph to `web/content/docs/index.mdx`, after the existing one, with a blank line between:

```mdx
Every trade it proposes passes <Fact name="checksPerTrade" /> checks before any funds move.
```

- [ ] **Step 13: Prove the facts reach the index.** Run:
  `cd web && npx vitest run test/remark-facts.test.ts && npm run build && grep -o "passes 9 checks" out/api/search | head -1`
  Expected: tests PASS, the build succeeds, and grep prints `passes 9 checks`.
  Then prove a typo fails: add `<Fact name="nope" />` to `content/docs/index.mdx`, run `npm run build`,
  expect it to fail with a message naming `index.mdx` and `nope`; remove the line again.

- [ ] **Step 14: Check the landing bundle did not grow.**
  Run: `cd web && node ../.superpowers/docs-baseline/landing-compare.mjs ../.superpowers/docs-baseline/out out`
  Expected: `landing unchanged for a reader`, with `deltaGzip` the same as in Task 1 Step 15.

- [ ] **Step 15: Typecheck and commit.**

```bash
cd web && npm run typecheck
git add web/content/docs-facts.ts web/test/docs-facts.test.ts web/lib/docs/fact-text.ts web/test/fact-text.test.ts web/lib/docs/remark-facts.ts web/test/remark-facts.test.ts web/source.config.ts web/components/docs/mdx.tsx web/content/docs/index.mdx
git commit -m "feat(web): render docs numbers from the facts at build time, with parity tests"
```

### Task 4: Page anatomy: header, source of truth, next pages, feedback and Copy as Markdown

Every docs page gets the same frame (spec §4.1): a breadcrumb, the title and lede, a row with the status
badge, the audience, the reading time and the review date; then the body; then "Source of truth" (the repo
files the page is checked against), the pages to read next, Fumadocs' previous and next cards, and a footer
with "Was this page helpful?" (a prefilled GitHub issue, nothing tracked), "Edit on GitHub" and "Copy page
as Markdown". Each page also gets a static Markdown copy at `/md/docs/<slug>.md`, which the copy button
fetches.

**Files:**
- Create: `web/lib/docs/markdown.ts`
- Create: `web/test/docs-page.test.tsx`
- Modify: `web/lib/docs-source.ts` (`getPageMarkdown`)
- Create: `web/app/md/[...slug]/route.ts`
- Create: `web/components/docs/StatusBadge.tsx`, `web/components/docs/PageHeader.tsx`,
  `web/components/docs/SourceOfTruth.tsx`, `web/components/docs/NextLinks.tsx`,
  `web/components/docs/PageFooter.tsx`, `web/components/docs/CopyMarkdown.tsx`
- Modify: `web/app/(docs)/docs/[[...slug]]/page.tsx`
- Modify: `web/e2e/docs.spec.ts`

**Interfaces:**
- Consumes: `source`, `DocsPage` (Task 1); `docsFrontmatter` fields `status`, `audience`, `lastReviewed`,
  `sources`, `next`, `STATUS_LABEL`, `AUDIENCE_LABEL` (Task 1); `SITE`, `siteUrl()`; `FACT_TEXT` (Task 3).
- Produces: `markdownUrl(pageUrl)`, `slugsFromMarkdownPath(segments)`, `readingMinutes(markdown)`,
  `pageMarkdown({ title, url, description?, body })` (`@/lib/docs/markdown`); `getPageMarkdown(page)`
  (`@/lib/docs-source`); `StatusBadge({ status })` (Task 5 registers it for MDX); `feedbackHref(title,
  pageUrl, helpful)` (`@/components/docs/PageFooter`); `out/md/docs.md` and one `out/md/docs/<slug>.md`
  per page (Task 6's export check requires them).

`NextLinks` leaves out a `next` page that is in the IA but not written yet, the same way the MDX link
component treats links (Task 5), so a page can name its successors before they ship. Task 6's content gate
fails on a `next` slug that is not in the IA at all.

- [ ] **Step 1: Write the failing unit tests** `web/test/docs-page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { feedbackHref } from "@/components/docs/PageFooter";
import { StatusBadge } from "@/components/docs/StatusBadge";
import { markdownUrl, pageMarkdown, readingMinutes, slugsFromMarkdownPath } from "@/lib/docs/markdown";
import { SITE } from "@/lib/site";

describe("docs Markdown helpers", () => {
  it("maps a page URL to its Markdown file and back", () => {
    expect(markdownUrl("/docs")).toBe("/md/docs.md");
    expect(markdownUrl("/docs/concepts/nine-checks")).toBe("/md/docs/concepts/nine-checks.md");
    expect(slugsFromMarkdownPath(["docs.md"])).toEqual([]);
    expect(slugsFromMarkdownPath(["docs", "concepts", "nine-checks.md"])).toEqual(["concepts", "nine-checks"]);
    expect(slugsFromMarkdownPath(["docs", "concepts", "nine-checks"])).toBeNull();
    expect(slugsFromMarkdownPath(["other.md"])).toBeNull();
  });

  it("counts reading time at 200 words a minute, at least one", () => {
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes("word ".repeat(200))).toBe(1);
    expect(readingMinutes("word ".repeat(201))).toBe(2);
    expect(readingMinutes("``` - | word")).toBe(1);
  });

  it("puts the title, URL and description above the body", () => {
    expect(pageMarkdown({ title: "T", url: "https://x/docs", description: "D", body: "Body\n" })).toBe(
      "# T\n\nURL: https://x/docs\n\nD\n\nBody\n",
    );
  });
});

describe("page footer feedback", () => {
  it("opens a prefilled GitHub issue that names the page and the answer", () => {
    const url = new URL(feedbackHref("The nine checks", "https://maatonbase.xyz/docs/concepts/nine-checks", false));
    expect(`${url.origin}${url.pathname}`).toBe(`${SITE.repoUrl}/issues/new`);
    expect(url.searchParams.get("title")).toBe("Docs feedback: The nine checks (not helpful)");
    expect(url.searchParams.get("body")).toBe(
      "Page: https://maatonbase.xyz/docs/concepts/nine-checks\n\nWhat was missing or wrong?\n",
    );
    expect(new URL(feedbackHref("T", "https://x", true)).searchParams.get("title")).toBe("Docs feedback: T (helpful)");
  });
});

describe("StatusBadge", () => {
  it("says the status in words, so it reads the same without color", () => {
    render(<StatusBadge status="fork-tested" />);
    expect(screen.getByText("Fork-tested").closest("[data-status]")).toHaveAttribute("data-status", "fork-tested");
  });
});
```

Run: `cd web && npx vitest run test/docs-page.test.tsx`
Expected: FAIL: `Failed to resolve import "@/components/docs/PageFooter"`.

- [ ] **Step 2: Write the Markdown helpers** `web/lib/docs/markdown.ts`:

```ts
/** Where the static Markdown copy of a docs page lives: /docs/concepts/x → /md/docs/concepts/x.md. */
export function markdownUrl(pageUrl: string): string {
  return `/md${pageUrl}.md`;
}

/** The docs slugs behind a /md/[...slug] path, or null when the path is not a docs page's Markdown file. */
export function slugsFromMarkdownPath(segments: readonly string[]): string[] | null {
  const path = segments.join("/");
  if (!path.endsWith(".md")) return null;
  const [root, ...slugs] = path.slice(0, -".md".length).split("/");
  return root === "docs" ? slugs : null;
}

/** Minutes to read, at 200 words a minute, never less than one. */
export function readingMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return Math.max(1, Math.ceil(words / 200));
}

/** A page as one Markdown document: title, absolute URL, description, then the body with facts filled in. */
export function pageMarkdown(page: { title: string; url: string; description?: string; body: string }): string {
  const parts = [`# ${page.title}`, `URL: ${page.url}`];
  if (page.description) parts.push(page.description);
  parts.push(page.body.trim());
  return `${parts.join("\n\n")}\n`;
}
```

- [ ] **Step 3: Write the components.** `web/components/docs/StatusBadge.tsx`:

```tsx
import { type DocStatus, STATUS_LABEL } from "@/lib/docs/frontmatter";

// The dot carries the hue; the label carries the meaning, so the badge reads the same without color.
const DOT: Record<DocStatus, string> = {
  "fork-tested": "bg-fd-warning",
  live: "bg-fd-success",
  planned: "bg-fd-muted-foreground",
};

/** Whether what a page describes is live on mainnet, tested on a fork only, or planned. */
export function StatusBadge({ status }: { status: DocStatus }) {
  return (
    <span
      data-status={status}
      className="not-prose inline-flex items-center gap-1.5 rounded-full border border-fd-border bg-fd-secondary px-2.5 py-0.5 text-xs font-medium text-fd-secondary-foreground"
    >
      <span aria-hidden className={`size-1.5 rounded-full ${DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}
```

`web/components/docs/PageHeader.tsx` (the breadcrumb is built here, with a "Docs" root and `nav`
semantics, so Fumadocs' own breadcrumb is turned off in the page):

```tsx
import { getBreadcrumbItems } from "fumadocs-core/breadcrumb";
import { DocsDescription, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { source } from "@/lib/docs-source";
import { AUDIENCE_LABEL, type Audience, type DocStatus } from "@/lib/docs/frontmatter";
import { StatusBadge } from "./StatusBadge";

interface PageHeaderProps {
  url: string;
  title: string;
  description?: string;
  status: DocStatus;
  audience: readonly Audience[];
  readingMinutes: number;
  /** ISO date, YYYY-MM-DD. */
  lastReviewed: string;
}

const reviewed = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Docs / folder / page. A folder without an index page is plain text; the current page is not a link. */
function Breadcrumbs({ url }: { url: string }) {
  const trail = getBreadcrumbItems(url, source.getPageTree(), { includePage: true }).filter((item) => item.url !== "/docs");
  const items: { name: ReactNode; url?: string }[] = [{ name: "Docs", url: "/docs" }, ...trail];
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-sm text-fd-muted-foreground">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li aria-hidden className="select-none">
                /
              </li>
            )}
            <li>
              {i === items.length - 1 ? (
                <span aria-current="page" className="font-medium text-fd-foreground">
                  {item.name}
                </span>
              ) : item.url ? (
                <Link href={item.url} className="inline-flex min-h-11 items-center hover:text-fd-foreground md:min-h-0">
                  {item.name}
                </Link>
              ) : (
                <span>{item.name}</span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

/** Breadcrumb, H1, lede, then status, audience, reading time and review date in one row. */
export function PageHeader({ url, title, description, status, audience, readingMinutes, lastReviewed }: PageHeaderProps) {
  return (
    <header>
      <Breadcrumbs url={url} />
      <DocsTitle>{title}</DocsTitle>
      <DocsDescription className="mt-2 mb-4">{description}</DocsDescription>
      <div className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-fd-muted-foreground">
        <StatusBadge status={status} />
        <ul aria-label="Written for" className="flex flex-wrap gap-1.5">
          {audience.map((a) => (
            <li key={a} className="rounded-full border border-fd-border px-2.5 py-0.5 text-xs">
              {AUDIENCE_LABEL[a]}
            </li>
          ))}
        </ul>
        <span>{readingMinutes} min read</span>
        <span>
          Last reviewed <time dateTime={lastReviewed}>{reviewed.format(new Date(`${lastReviewed}T00:00:00Z`))}</time>
        </span>
      </div>
    </header>
  );
}
```

`web/components/docs/SourceOfTruth.tsx`:

```tsx
import { SITE } from "@/lib/site";

/** The repo files a page is checked against, so a reader can verify every claim where it is defined. */
export function SourceOfTruth({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) return null;
  return (
    <aside aria-labelledby="source-of-truth" className="not-prose mt-10 rounded-xl border border-fd-border bg-fd-card p-4 text-sm">
      <h2 id="source-of-truth" className="font-semibold text-fd-card-foreground">
        Source of truth
      </h2>
      <p className="mt-1 text-fd-muted-foreground">This page is checked against these files. If they disagree, the files win.</p>
      <ul className="mt-2">
        {sources.map((path) => (
          <li key={path}>
            <a
              href={`${SITE.repoUrl}/blob/main/${path}`}
              className="inline-flex min-h-11 items-center font-mono text-xs break-all text-fd-primary underline-offset-4 hover:underline md:min-h-8"
            >
              {path}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

`web/components/docs/NextLinks.tsx`:

```tsx
import Link from "next/link";
import { source } from "@/lib/docs-source";

/**
 * The pages to read next, from frontmatter `next`. A page that is in the IA but not written yet is left out
 * until it ships; test/docs-content.test.ts fails on a slug that is not in the IA at all.
 */
export function NextLinks({ slugs }: { slugs: readonly string[] }) {
  const pages = slugs.flatMap((slug) => source.getPage(slug.split("/")) ?? []);
  if (pages.length === 0) return null;
  return (
    <nav aria-labelledby="read-next" className="not-prose mt-10">
      <h2 id="read-next" className="text-sm font-semibold">
        Next
      </h2>
      <ul className="mt-2 grid gap-2">
        {pages.map((page) => (
          <li key={page.url}>
            <Link
              href={page.url}
              className="flex min-h-11 flex-col rounded-lg border border-fd-border p-3 text-sm transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              <span className="font-medium">{page.data.title}</span>
              {page.data.description && <span className="text-fd-muted-foreground">{page.data.description}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`web/components/docs/CopyMarkdown.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

type State = "idle" | "copying" | "copied" | "error";

const LABEL: Record<State, string> = {
  idle: "Copy page as Markdown",
  copying: "Copying...",
  copied: "Copied",
  error: "Copy failed. Try again",
};

/** Copies the page's static Markdown file (/md/...md) to the clipboard. */
export function CopyMarkdown({ href, className }: { href: string; className?: string }) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    window.clearTimeout(timer.current);
    setState("copying");
    try {
      // The fetch goes inside the ClipboardItem: Safari only allows the write while the click is still current.
      const blob = fetch(href).then(async (res) => {
        if (!res.ok) throw new Error(`${href}: HTTP ${res.status}`);
        return new Blob([await res.text()], { type: "text/plain" });
      });
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      setState("copied");
    } catch {
      setState("error");
    }
    timer.current = window.setTimeout(() => setState("idle"), 2500);
  }

  return (
    <button type="button" onClick={copy} disabled={state === "copying"} data-state={state} className={className}>
      <span aria-live="polite">{LABEL[state]}</span>
    </button>
  );
}
```

`web/components/docs/PageFooter.tsx`:

```tsx
import { SITE } from "@/lib/site";
import { CopyMarkdown } from "./CopyMarkdown";

const action =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary px-3 text-sm font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:ring-2 focus-visible:ring-fd-ring focus-visible:outline-none disabled:opacity-60 md:min-h-9";

interface PageFooterProps {
  title: string;
  /** Absolute URL of the page, quoted in the feedback issue. */
  pageUrl: string;
  /** Path of the MDX file below content/docs. */
  filePath: string;
  markdownHref: string;
}

/** A prefilled GitHub issue: the reader decides whether to send it, and nothing is tracked. */
export function feedbackHref(title: string, pageUrl: string, helpful: boolean): string {
  const params = new URLSearchParams({
    title: `Docs feedback: ${title} (${helpful ? "helpful" : "not helpful"})`,
    body: `Page: ${pageUrl}\n\n${helpful ? "What helped?" : "What was missing or wrong?"}\n`,
  });
  return `${SITE.repoUrl}/issues/new?${params}`;
}

/** Feedback, edit and copy actions under every docs page. */
export function PageFooter({ title, pageUrl, filePath, markdownHref }: PageFooterProps) {
  return (
    <div className="not-prose mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-fd-border pt-6 text-sm">
      <div role="group" aria-labelledby="page-helpful" className="flex flex-wrap items-center gap-2">
        <span id="page-helpful" className="text-fd-muted-foreground">
          Was this page helpful?
        </span>
        <a className={action} href={feedbackHref(title, pageUrl, true)} target="_blank" rel="noreferrer">
          Yes
        </a>
        <a className={action} href={feedbackHref(title, pageUrl, false)} target="_blank" rel="noreferrer">
          No
        </a>
      </div>
      <div className="flex flex-wrap gap-2">
        <a className={action} href={`${SITE.repoUrl}/edit/main/web/content/docs/${filePath}`} target="_blank" rel="noreferrer">
          Edit on GitHub
        </a>
        <CopyMarkdown href={markdownHref} className={action} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the unit tests.**
  Run: `cd web && npx vitest run test/docs-page.test.tsx`
  Expected: PASS (5 tests).

- [ ] **Step 5: Add the Markdown copy of each page.** Replace `web/lib/docs-source.ts` with:

```ts
import { loader } from "fumadocs-core/source";
import { docs } from "@/.source/server";
import { pageMarkdown } from "@/lib/docs/markdown";
import { siteUrl } from "@/lib/site";

/** The docs page tree and page lookup, built from content/docs by fumadocs-mdx. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

/** The page as Markdown with absolute links back to the site, for /md/*.md and llms-full.txt. */
export async function getPageMarkdown(page: DocsPage): Promise<string> {
  return pageMarkdown({
    title: page.data.title,
    url: new URL(page.url, siteUrl()).href,
    description: page.data.description,
    body: await page.data.getText("processed"),
  });
}
```

Create `web/app/md/[...slug]/route.ts` (a separate `/md` tree, because `/docs/x.md` would collide with the
page route):

```ts
import { notFound } from "next/navigation";
import { getPageMarkdown, source } from "@/lib/docs-source";
import { markdownUrl, slugsFromMarkdownPath } from "@/lib/docs/markdown";

// One static .md file per docs page (out/md/docs/concepts/nine-checks.md), fetched by "Copy page as Markdown".
// A separate /md tree, because /docs/x.md would collide with the docs page route.
export const dynamic = "force-static";
export const dynamicParams = false;

export async function GET(_req: Request, { params }: RouteContext<"/md/[...slug]">) {
  const { slug } = await params;
  const slugs = slugsFromMarkdownPath(slug);
  const page = slugs && source.getPage(slugs);
  if (!page) notFound();
  return new Response(await getPageMarkdown(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({ slug: markdownUrl(page.url).split("/").slice(2) }));
}
```

- [ ] **Step 6: Use the frame on every page.** Replace `web/app/(docs)/docs/[[...slug]]/page.tsx` with:

```tsx
import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getMDXComponents } from "@/components/docs/mdx";
import { NextLinks } from "@/components/docs/NextLinks";
import { PageFooter } from "@/components/docs/PageFooter";
import { PageHeader } from "@/components/docs/PageHeader";
import { SourceOfTruth } from "@/components/docs/SourceOfTruth";
import { source } from "@/lib/docs-source";
import { markdownUrl, readingMinutes } from "@/lib/docs/markdown";
import { SITE, siteUrl } from "@/lib/site";

// Static export: every docs URL comes from generateStaticParams, nothing is rendered on request.
export const dynamicParams = false;

export default async function Page({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const { body: MDX, toc, full, title, description, status, audience, lastReviewed, sources, next } = page.data;
  const markdown = await page.data.getText("processed");
  return (
    <DocsPage
      toc={toc}
      full={full}
      // PageHeader renders the breadcrumb with a Docs root and nav semantics.
      breadcrumb={{ enabled: false }}
      // Fumadocs' previous/next by sidebar order, then the feedback, edit and copy row.
      footer={{
        children: (
          <PageFooter
            title={title}
            pageUrl={new URL(page.url, siteUrl()).href}
            filePath={page.path}
            markdownHref={markdownUrl(page.url)}
          />
        ),
      }}
    >
      <PageHeader
        url={page.url}
        title={title}
        description={description}
        status={status}
        audience={audience}
        readingMinutes={readingMinutes(markdown)}
        lastReviewed={lastReviewed}
      />
      <DocsBody>
        <MDX components={getMDXComponents()} />
      </DocsBody>
      <SourceOfTruth sources={sources} />
      <NextLinks slugs={next} />
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();
  const { title, description } = page.data;
  // This openGraph object replaces the file-based image from app/opengraph-image.png, so name it here.
  const images = { url: "/opengraph-image.png", width: 1200, height: 630 };
  return {
    title,
    description,
    alternates: { canonical: page.url },
    openGraph: { type: "article", url: page.url, siteName: SITE.name, title, description, images },
    twitter: { card: "summary_large_image", site: SITE.xHandle, title, description, images },
  };
}
```

- [ ] **Step 7: Write the failing copy tests.** Replace `web/e2e/docs.spec.ts` with this version: Task 2's
  tests, plus the `FACT_TEXT` import and the two copy tests at the end.

```ts
import { expect, type Page, test } from "@playwright/test";
import { FACT_TEXT } from "../lib/docs/fact-text";

/** Opens search the way a reader does. Playwright sends "K" for "Control+K"; a real Ctrl+K sends "k", which Fumadocs matches. */
async function openSearch(page: Page) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("search", () => {
  test("Ctrl+K opens it and \"maat\" finds the docs home", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await dialog.getByRole("option", { name: /Maat docs/ }).first().click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("a query with no match shows the empty state", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("zzzzqqq");
    await expect(dialog.getByRole("status").filter({ hasText: "No results" })).toHaveText(
      'No results for "zzzzqqq". Try a reason code like MARKET_CLOSED.',
    );
  });

  test("a slow index shows the loading state, then the results", async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("status").filter({ hasText: "Searching..." })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });

  test("an index that cannot load shows the error state, not a spinner", async ({ page }) => {
    await page.route("**/api/search**", (route) => route.abort());
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("alert")).toContainText("Search is unavailable. Check your connection and try again.");
    await expect(dialog.getByText("Searching...")).toHaveCount(0);

    // Back online: "Try again" downloads the index again and the results come back.
    await page.unroute("**/api/search**");
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });
});

test("the 404 page offers search and the docs sections", async ({ page }) => {
  for (const path of ["/does-not-exist", "/docs/does-not-exist"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist.");
    await expect(page.getByRole("link", { name: "Maat docs" })).toHaveAttribute("href", "/docs");
  }
  await page.locator("button[data-search-full]").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("maat");
  await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
});

test.describe("copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Copy page as Markdown copies the page with its facts filled in", async ({ page }) => {
    // networkidle: the button only works once the page has hydrated.
    await page.goto("/docs", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy page as Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    // The Windows clipboard stores line breaks as CRLF.
    const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    expect(text).toMatch(/^# Maat docs\n\nURL: https?:\/\/[^\n]+\/docs\n/);
    expect(text).toContain(`passes ${FACT_TEXT.checksPerTrade.text} checks`);
    expect(text).not.toContain("<Fact");
  });

  test("Copy page as Markdown says so when the file cannot load", async ({ page }) => {
    await page.route("**/md/**", (route) => route.abort());
    await page.goto("/docs", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy page as Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copy failed. Try again" })).toBeVisible();
  });
});
```

- [ ] **Step 8: Build and run everything.**
  Run: `cd web && npm run typecheck && npm test && npm run build && npm run check:out && npx playwright test e2e/docs.spec.ts`
  Expected: all PASS (7 end-to-end tests); `out/md/docs.md` starts with `# Maat docs` and contains
  `passes 9 checks`, not `<Fact`.

- [ ] **Step 9: Look at it.** Serve `out/` and open `/docs` at 1440 px and 360 px, light and dark: the
  breadcrumb, the badge row wrapping on a phone, "Source of truth" linking to `README.md` on GitHub, every
  footer button at least 44 px tall on a phone. Click "No" and check the GitHub issue form opens with the
  page title and URL filled in (close the tab; do not submit it).

- [ ] **Step 10: Commit.**

```bash
git add web/lib/docs/markdown.ts web/test/docs-page.test.tsx web/lib/docs-source.ts web/app web/components/docs web/e2e/docs.spec.ts
git commit -m "feat(web): give every docs page its header, sources, next pages, feedback and a Markdown copy"
```

### Task 5: MDX components and diagrams

The components every content page uses: callouts, steps, the tables shared with the landing page's data
(refusal codes, the default mandate, the fork ledger, the `Decision` event), the docs home router, and
five diagrams. Every number comes from `FACTS` through `factFor`, and every diagram is real text (a
labelled list or grid), so it needs no separate text alternative and reads the same in search.

Links: a page may link to an IA page that is written in a later task. The MDX link component renders such
a link as plain text until the page exists, so no build of the site ever ships a dead docs link; the
router card for an unwritten page says "(coming soon)". Task 6's gates still check every link against
the IA.

**Files:**
- Create: `web/lib/docs/links.ts`
- Create: `web/components/docs/Callout.tsx`
- Create: `web/components/docs/content.tsx`
- Create: `web/components/docs/diagrams.tsx`
- Create: `web/test/docs-components.test.tsx`
- Modify: `web/lib/docs-source.ts` (add `pageExists`)
- Modify: `web/components/docs/mdx.tsx`

**Interfaces:**
- Consumes: `factFor` (Task 3); `FACTS`, `mandateRows`, `getDecisions`, `intentLabel`, `decisionLabel`,
  `gasLabel`, `REASONS`, `REASON_GROUPS`, `REASON_MEANING` (`web/content/*`, existing); `source`
  (`web/lib/docs-source.ts`, Task 1); `StatusBadge` (Task 4).
- Produces: `docsSlug(href): string[] | null` and `headingId(text): string` (`@/lib/docs/links`; Task 6
  and Task 12 use both); `pageExists(slug: string): boolean` (`@/lib/docs-source`); MDX components
  `<Callout type="note" | "warning" | "fork" title?>`, `<Steps>`, `<Step>`, `<ReasonTable />`,
  `<MandateTable />`, `<EventSignature name="Decision" />`, `<ForkLedger />`, `<RouterCards />`,
  `<DecisionLoop />`, `<Architecture />`, `<TimelockFlow />`, `<TreasuryLoop />`, `<MarketWeek />`,
  `<StatusBadge status="…" />`; `Flow`, `FlowStep`, `marketWeek()`, `READER_PATHS`.

- [ ] **Step 1: Write the failing tests** `web/test/docs-components.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventSignature, ForkLedger, MandateTable, READER_PATHS, ReasonTable, RouterCards } from "@/components/docs/content";
import { Architecture, DecisionLoop, marketWeek, MarketWeek, TimelockFlow, TreasuryLoop } from "@/components/docs/diagrams";
import { getDecisions } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { REASONS } from "@/content/reasons";
import { docsSlug } from "@/lib/docs/links";

describe("data tables", () => {
  it("ReasonTable lists every refusal with its enum id and a link to its entry", () => {
    render(<ReasonTable />);
    const rows = within(screen.getByRole("region", { name: "Refusal codes" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + REASONS.length);
    const closed = screen.getByRole("link", { name: "MARKET_CLOSED" });
    expect(closed).toHaveAttribute("href", "/docs/concepts/refusal-codes#market_closed");
    expect(closed.closest("tr")).toHaveTextContent(`MARKET_CLOSED${REASONS.indexOf("MARKET_CLOSED") + 1}Market`);
  });

  it("MandateTable shows the landing page's mandate rows", () => {
    render(<MandateTable />);
    const rows = within(screen.getByRole("region", { name: "Default mandate" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + mandateRows(FACTS.mandate.value).length);
    expect(screen.getByText("$50")).toBeInTheDocument();
  });

  it("EventSignature prints the Decision event and refuses any other", () => {
    render(<EventSignature name="Decision" />);
    expect(screen.getByText(/bytes32 indexed intentId,/)).toBeInTheDocument();
    expect(() => EventSignature({ name: "Paused" })).toThrow("only Decision is in FACTS");
  });

  it("ForkLedger has one row per fork decision and names the fork block", () => {
    render(<ForkLedger />);
    const rows = within(screen.getByRole("region", { name: "Decisions from the fork run" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + getDecisions().length);
    expect(screen.getByText("REFUSED · MARKET_CLOSED")).toBeInTheDocument();
    expect(screen.getByText(/block 53,551,627/)).toBeInTheDocument();
  });
});

describe("RouterCards", () => {
  it("links each reader to their first page", () => {
    render(<RouterCards exists={() => true} />);
    expect(screen.getAllByRole("link")).toHaveLength(READER_PATHS.length);
    expect(screen.getByRole("link", { name: "Verify it in five minutes →" })).toHaveAttribute("href", "/docs/get-started/quickstart");
  });

  it("shows a page that has not shipped without a link", () => {
    render(<RouterCards exists={(slug) => !slug.startsWith("security/")} />);
    expect(screen.getAllByRole("link")).toHaveLength(READER_PATHS.length - 1);
    expect(screen.getByText("Security model (coming soon)")).toBeInTheDocument();
  });
});

describe("diagrams", () => {
  it.each([
    ["DecisionLoop", <DecisionLoop key="d" />, "How one round of the agent loop reaches a decision", 4],
    ["Architecture", <Architecture key="a" />, "Who does what, from Claude to the Base protocols", 5],
    ["TimelockFlow", <TimelockFlow key="t" />, "How a rule change goes through the timelock", 4],
    ["TreasuryLoop", <TreasuryLoop key="l" />, "The treasury loop the agent runs", 4],
  ])("%s is a labelled list of steps", (_name, node, label, steps) => {
    render(node);
    expect(within(screen.getByRole("list", { name: label })).getAllByRole("listitem")).toHaveLength(steps);
  });

  it("diagram numbers come from FACTS", () => {
    render(
      <>
        <DecisionLoop />
        <TimelockFlow />
      </>,
    );
    expect(screen.getByText("9 checks run in the contract. A Decision event records the verdict.")).toBeInTheDocument();
    expect(screen.getByText("Nothing can apply it for 24 hours.")).toBeInTheDocument();
    expect(screen.getByText(/every 15 minutes in session and every 60 minutes outside/)).toBeInTheDocument();
  });

  it("marketWeek follows MarketCalendar.isOpen: weekdays for REGULAR, Sunday to Friday at the feed edge for 24/5", () => {
    const { open, close } = FACTS.nyseSessionMin.value;
    const edge = FACTS.feedEdgeMin.value;
    const w = marketWeek();
    expect(w.REGULAR).toEqual([[[open, close]], [[open, close]], [[open, close]], [[open, close]], [[open, close]], [], []]);
    expect(w.FEED_24_5).toEqual([[[0, 1440]], [[0, 1440]], [[0, 1440]], [[0, 1440]], [[0, edge]], [], [[edge, 1440]]]);
  });

  it("MarketWeek states each session in words", () => {
    render(<MarketWeek />);
    expect(screen.getByText(/is open Monday to Friday, 09:30 ET to 16:00 ET\./)).toBeInTheDocument();
    expect(screen.getByText(/is open Sunday 20:00 ET to Friday 20:00 ET, around the clock\./)).toBeInTheDocument();
  });
});

describe("docsSlug", () => {
  it.each([
    ["/docs", []],
    ["/docs/concepts/nine-checks", ["concepts", "nine-checks"]],
    ["/docs/concepts/nine-checks#why-the-order-matters", ["concepts", "nine-checks"]],
    ["/docs/help/faq?x=1", ["help", "faq"]],
    ["/", null],
    ["/docsx", null],
    ["https://github.com/duongnq2798/maat", null],
    ["#anchor", null],
  ])("%s", (href, slug) => {
    expect(docsSlug(href)).toEqual(slug);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**
  Run: `cd web && npx vitest run test/docs-components.test.tsx`
  Expected: FAIL: `Failed to resolve import "@/components/docs/content"`.

- [ ] **Step 3: Write the link helpers** `web/lib/docs/links.ts`:

```ts
/**
 * The docs slug an internal link points at (`/docs/concepts/nine-checks#x` → ["concepts", "nine-checks"],
 * `/docs` → []), or null for any other link. The MDX link component uses it to render a link to a page
 * that has not shipped yet as plain text, so the exported site never has a dead docs link.
 */
export function docsSlug(href: string): string[] | null {
  const path = href.split(/[?#]/)[0] ?? "";
  if (path !== "/docs" && !path.startsWith("/docs/")) return null;
  return path.slice("/docs".length).split("/").filter(Boolean);
}

/** The id Fumadocs gives a heading (github-slugger rules, for the ASCII headings the docs use). */
export function headingId(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_ -]/g, "").replace(/ /g, "-");
}
```

- [ ] **Step 4: Write the shared tables and the router** `web/components/docs/content.tsx`:

```tsx
import type { ReactNode } from "react";
import { decisionLabel, gasLabel, getDecisions, intentLabel } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { REASON_GROUPS, REASON_MEANING, REASONS, type RefusalCode } from "@/content/reasons";
import { factFor } from "@/lib/docs/fact-text";

// Tables and cards the docs share with the landing page's data, so a page and the site never disagree.

/** A table that scrolls inside its own focusable region on small screens, never the page. */
function ScrollTable({ label, caption, children }: { label: string; caption?: string; children: ReactNode }) {
  return (
    <figure className="my-6">
      {/* tabIndex: a scrollable region must be reachable by keyboard (axe rule scrollable-region-focusable). */}
      <div className="relative overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
        <table className="my-0">{children}</table>
      </div>
      {caption ? <figcaption className="mt-2 text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

const GROUP_OF = new Map<RefusalCode, string>(REASON_GROUPS.flatMap((g) => g.codes.map((c) => [c, g.title] as const)));

/** Every refusal code with its enum id (OK is 0), its group and what it means. */
export function ReasonTable() {
  return (
    <ScrollTable label="Refusal codes">
      <thead>
        <tr>
          <th>Code</th>
          <th>Id</th>
          <th>Group</th>
          <th>Meaning</th>
        </tr>
      </thead>
      <tbody>
        {REASONS.map((code, i) => (
          <tr key={code}>
            <td>
              <a href={`/docs/concepts/refusal-codes#${code.toLowerCase()}`}><code>{code}</code></a>
            </td>
            <td>{i + 1}</td>
            <td>{GROUP_OF.get(code)}</td>
            <td>{REASON_MEANING[code]}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** The default mandate, the same rows the landing page shows. */
export function MandateTable() {
  return (
    <ScrollTable label="Default mandate" caption="Set in contracts/script/MaatConfig.sol and deployed by contracts/script/Deploy.s.sol.">
      <thead>
        <tr>
          <th>Setting</th>
          <th>Field</th>
          <th>Default</th>
        </tr>
      </thead>
      <tbody>
        {mandateRows(FACTS.mandate.value).map((r) => (
          <tr key={r.k}>
            <td>{r.label}</td>
            <td><code>{r.k}</code></td>
            <td>{r.v}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** The Decision event as declared in contracts/src/IMandateVaultEvents.sol (parity-tested in test/facts.test.ts). */
export function EventSignature({ name }: { name: string }) {
  if (name !== "Decision") throw new Error(`<EventSignature name="${name}" />: only Decision is in FACTS; use <EventEntry> on reference pages`);
  const params = FACTS.decisionEvent.value.map((p) => [p.type, p.indexed ? "indexed" : "", p.name].filter(Boolean).join(" "));
  return (
    <pre className="not-prose my-4 overflow-x-auto rounded-lg border border-fd-border bg-fd-muted px-4 py-3 font-mono text-[13px] leading-6 text-fd-foreground">
      <code>{`event Decision(\n  ${params.join(",\n  ")}\n)`}</code>
    </pre>
  );
}

/** The decisions the agent made in the fork run, as the landing page's ledger shows them. */
export function ForkLedger() {
  return (
    <ScrollTable
      label="Decisions from the fork run"
      caption={`Base mainnet fork at block ${factFor("forkBlock").text}, recorded by agent/test/integration/agent.fork.test.ts.`}
    >
      <thead>
        <tr>
          <th>Time (ET)</th>
          <th>Intent</th>
          <th>Decision</th>
          <th>Gas</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {getDecisions().map((r) => (
          <tr key={`${r.timeLabel} ${intentLabel(r)}`}>
            <td>{r.timeLabel}</td>
            <td>{intentLabel(r)}</td>
            <td><code>{decisionLabel(r)}</code></td>
            <td>{gasLabel(r)}</td>
            <td>{r.note}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

export interface ReaderPath {
  readonly reader: string;
  readonly want: string;
  /** Docs slug of the first page, as in content/docs. */
  readonly slug: string;
  readonly cta: string;
}

/** One path per reader in the docs spec §1, each naming its first page. */
export const READER_PATHS: readonly ReaderPath[] = [
  { reader: "New to Maat", want: "Know what it is and why it matters.", slug: "get-started/what-is-maat", cta: "What is Maat" },
  { reader: "Watching the agent", want: "Understand a decision you saw on X or on the site.", slug: "get-started/read-a-decision", cta: "Read a decision" },
  { reader: "Developer or judge", want: "Verify the claims and read the code.", slug: "get-started/quickstart", cta: "Verify it in five minutes" },
  { reader: "Builder", want: "Run your own vault and agent.", slug: "guides/deploy-your-own-vault", cta: "Deploy your own vault" },
  { reader: "Evaluator or partner", want: "Decide whether to trust it or build on it.", slug: "security/model", cta: "Security model" },
];

/** The docs home router. A path whose page has not shipped yet shows without a link, never as a dead one. */
export function RouterCards({ exists }: { exists: (slug: string) => boolean }) {
  return (
    <ul aria-label="Where to start" className="not-prose my-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {READER_PATHS.map((p) => {
        const live = exists(p.slug);
        return (
          <li key={p.slug} className="relative rounded-xl border border-fd-border bg-fd-card p-4 transition-colors hover:bg-fd-accent">
            <p className="text-xs font-medium uppercase tracking-wide text-fd-muted-foreground">{p.reader}</p>
            <p className="mt-1 text-sm text-fd-card-foreground">{p.want}</p>
            {live ? (
              <a href={`/docs/${p.slug}`} className="mt-3 inline-flex min-h-11 items-center font-medium text-fd-primary after:absolute after:inset-0">
                {p.cta} →
              </a>
            ) : (
              <p className="mt-3 flex min-h-11 items-center font-medium text-fd-muted-foreground">{p.cta} (coming soon)</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Write the diagrams** `web/components/docs/diagrams.tsx`:

```tsx
import { FACTS } from "@/content/facts";
import { factFor } from "@/lib/docs/fact-text";

// Docs diagrams. Each one is real text in an ordered list or a labelled grid, so it reads the same to a
// screen reader, to search and to a reader on a 360 px phone; numbers come from FACTS through factFor.

const f = (name: Parameters<typeof factFor>[0]) => factFor(name).text;

export interface FlowStep {
  readonly title: string;
  readonly detail: string;
}

/** Numbered steps left to right (top to bottom on small screens), with arrows between them. */
export function Flow({ label, steps, caption }: { label: string; steps: readonly FlowStep[]; caption?: string }) {
  return (
    <figure className="not-prose my-8">
      <ol aria-label={label} className="grid gap-4 md:auto-cols-fr md:grid-flow-col">
        {steps.map((s, i) => (
          <li key={s.title} className="relative rounded-xl border border-fd-border bg-fd-card p-4">
            <span className="font-mono text-xs text-fd-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
            <p className="mt-1 font-medium text-fd-card-foreground">{s.title}</p>
            <p className="mt-1 text-sm leading-6 text-fd-muted-foreground">{s.detail}</p>
            {i < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute -bottom-4 left-1/2 z-10 -translate-x-1/2 text-fd-primary md:-right-4 md:bottom-auto md:left-auto md:top-1/2 md:-translate-y-1/2 md:translate-x-0"
              >
                <span className="md:hidden">↓</span>
                <span className="hidden md:inline">→</span>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {caption ? <figcaption className="mt-3 text-sm text-fd-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}

export function DecisionLoop() {
  return (
    <Flow
      label="How one round of the agent loop reaches a decision"
      steps={[
        { title: "Read the vault", detail: "Balances, prices, the mandate and the market, all at one block." },
        { title: "Policy, then Claude", detail: "Rules suggest trades. Claude proposes intents, each with a rationale." },
        { title: "Preview, then send", detail: "Each intent is previewed first, so the agent spends gas only on calls worth sending." },
        {
          title: "The vault decides",
          detail: `${f("checksPerTrade")} checks run in the contract. A Decision event records the verdict.`,
        },
      ]}
      caption={`The agent runs this every ${f("loopMinutes")} in session and every ${f("offSessionMinutes")} outside. Only the vault's checks are trusted.`}
    />
  );
}

export function Architecture() {
  return (
    <Flow
      label="Who does what, from Claude to the Base protocols"
      steps={[
        { title: "Claude", detail: "Proposes intents as JSON that must match a schema." },
        { title: "Agent", detail: "Validates, previews and sends only vault calls, with the Builder Code." },
        { title: "CDP wallet", detail: "Signs only zero-value transactions to the vault, on Base." },
        { title: "MandateVault", detail: "Runs the checks and records every decision." },
        { title: "Base protocols", detail: "Aerodrome swaps, Aave V4 credit, Chainlink prices." },
      ]}
      caption="Only the vault moves funds, and it runs every check itself. A stolen agent key faces the same rules."
    />
  );
}

export function TimelockFlow() {
  return (
    <Flow
      label="How a rule change goes through the timelock"
      steps={[
        { title: "Queue", detail: "The owner queues the new values. An event records their hash." },
        { title: "Wait", detail: `Nothing can apply it for ${f("timelockHours")}.` },
        { title: "Apply or cancel", detail: `Apply the exact queued values within ${f("gracePeriodDays")}, or cancel.` },
        { title: "Or expire", detail: "After that window, applying reverts and the change must be queued again." },
      ]}
      caption="Pausing, rotating the executor and withdrawing to the owner are instant. Changing a rule never is."
    />
  );
}

export function TreasuryLoop() {
  return (
    <Flow
      label="The treasury loop the agent runs"
      steps={[
        {
          title: "Buy",
          detail: `An equal-weight stock basket with ${f("cashReservePct")} kept in USDC, rebalanced past a drift of ${f("rebalanceDriftPct")}.`,
        },
        { title: "Supply", detail: "Idle stock goes to Aave V4 as collateral." },
        {
          title: "Borrow",
          detail: `USDC, when cash covers less than ${f("runwayDays")} of compute. Only in session, and only if the projected health factor stays at or above ${f("mandate.minHealthFactor")}.`,
        },
        { title: "Pay", detail: "Its own Claude bill in USDC, to an allowlisted payee, at any hour." },
      ]}
      caption="Earning from x402 safety checks is planned and not built."
    />
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
type Segment = readonly [start: number, end: number];
const DAY_MIN = 1440;

/** Minutes after midnight ET when each session mode is open, Monday first. Holidays and early closes not shown. */
export function marketWeek(): Record<"REGULAR" | "FEED_24_5", readonly (readonly Segment[])[]> {
  const { open, close } = FACTS.nyseSessionMin.value;
  const edge = FACTS.feedEdgeMin.value;
  const weekday = (d: number) => d < 5;
  return {
    REGULAR: DAYS.map((_, d) => (weekday(d) ? [[open, close] as const] : [])),
    // Chainlink equity feeds run from Sunday at the feed edge to Friday at the feed edge.
    FEED_24_5: DAYS.map((_, d) =>
      d < 4 ? [[0, DAY_MIN] as const] : d === 4 ? [[0, edge] as const] : d === 6 ? [[edge, DAY_MIN] as const] : [],
    ),
  };
}

export function MarketWeek() {
  const week = marketWeek();
  const rows = [
    { mode: "REGULAR", text: `Monday to Friday, ${f("nyseOpen")} to ${f("nyseClose")}.`, days: week.REGULAR },
    { mode: "FEED_24_5", text: `Sunday ${f("feedEdge")} to Friday ${f("feedEdge")}, around the clock.`, days: week.FEED_24_5 },
  ];
  return (
    <figure className="not-prose my-8 rounded-xl border border-fd-border bg-fd-card p-4">
      <div aria-hidden="true" className="grid grid-cols-[5.5rem_repeat(7,1fr)] gap-1 text-center text-xs text-fd-muted-foreground">
        <span />
        {DAYS.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.mode} className="mt-3">
          <div aria-hidden="true" className="grid grid-cols-[5.5rem_repeat(7,1fr)] items-center gap-1">
            <span className="font-mono text-xs text-fd-card-foreground">{r.mode}</span>
            {r.days.map((segments, d) => (
              <span key={DAYS[d]} className="relative h-3 rounded-sm bg-fd-muted" data-open-segments={segments.length}>
                {segments.map(([start, end]) => (
                  <span
                    key={start}
                    className="absolute inset-y-0 rounded-sm bg-fd-primary"
                    style={{ left: `${(start / DAY_MIN) * 100}%`, width: `${((end - start) / DAY_MIN) * 100}%` }}
                  />
                ))}
              </span>
            ))}
          </div>
          <p className="mt-1 text-sm text-fd-muted-foreground">
            <span className="font-mono text-fd-card-foreground">{r.mode}</span> is open {r.text}
          </p>
        </div>
      ))}
      <figcaption className="mt-3 text-sm text-fd-muted-foreground">
        New York time, one bar per day from midnight to midnight. Holidays and early closes are not shown.
      </figcaption>
    </figure>
  );
}
```

- [ ] **Step 6: Run the tests.**
  Run: `cd web && npx vitest run test/docs-components.test.tsx`
  Expected: PASS (21 tests).

- [ ] **Step 7: Write the callout** `web/components/docs/Callout.tsx`:

```tsx
import { Callout as FumadocsCallout } from "fumadocs-ui/components/callout";
import type { CSSProperties, ReactNode } from "react";

type CalloutType = "note" | "warning" | "fork";

interface CalloutProps {
  type?: CalloutType;
  title?: ReactNode;
  children: ReactNode;
}

function ForkIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="-me-0.5 size-5 shrink-0 text-(--callout-color)"
    >
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9" />
      <path d="M12 12v3" />
    </svg>
  );
}

/**
 * The docs callout: note (information), warning, or fork (true on a mainnet fork, not yet on mainnet).
 * MDX props are not type-checked, so an unknown type fails the build instead of rendering as a note.
 */
export function Callout({ type = "note", title, children }: CalloutProps) {
  if (type === "fork") {
    return (
      <FumadocsCallout
        type="info"
        data-callout="fork"
        icon={<ForkIcon />}
        title={title ?? "Fork only"}
        style={{ "--callout-color": "var(--color-fd-primary)" } as CSSProperties}
      >
        {children}
      </FumadocsCallout>
    );
  }
  if (type !== "note" && type !== "warning") throw new Error(`<Callout type="${String(type)}"> must be note, warning or fork`);
  return (
    <FumadocsCallout type={type === "note" ? "info" : "warning"} data-callout={type} title={title}>
      {children}
    </FumadocsCallout>
  );
}
```

- [ ] **Step 8: Add `pageExists` and register everything for MDX.** Append to `web/lib/docs-source.ts`:

```ts
/** Whether a docs page exists, by slug ("concepts/nine-checks"; "" or "index" for the home page). */
export function pageExists(slug: string): boolean {
  const parts = slug === "index" ? [] : slug.split("/").filter(Boolean);
  return source.getPage(parts) !== undefined;
}
```

Replace `web/components/docs/mdx.tsx` with:

```tsx
import { Step, Steps } from "fumadocs-ui/components/steps";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import type { ComponentProps } from "react";
import { pageExists } from "@/lib/docs-source";
import { docsSlug } from "@/lib/docs/links";
import { Callout } from "./Callout";
import { EventSignature, ForkLedger, MandateTable, ReasonTable, RouterCards } from "./content";
import { Architecture, DecisionLoop, MarketWeek, TimelockFlow, TreasuryLoop } from "./diagrams";
import { StatusBadge } from "./StatusBadge";

// <Fact /> is replaced with text at build time (lib/docs/remark-facts.ts). Reaching render means that plugin did not run.
function Fact({ name }: { name?: string }): never {
  throw new Error(`<Fact name="${name ?? ""}" /> reached render: remarkFacts is missing from source.config.ts`);
}

const BaseLink = defaultMdxComponents.a;

/**
 * A link to a docs page that is in the IA but not written yet renders as plain text until the page ships, so
 * no build ever ships a dead docs link. test/docs-content.test.ts still fails on a link outside the IA.
 */
function DocsLink(props: ComponentProps<"a">) {
  const slug = props.href ? docsSlug(props.href) : null;
  if (slug && !pageExists(slug.join("/"))) return <span>{props.children}</span>;
  return <BaseLink {...props} />;
}

/** Components available in every docs MDX page. */
export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    a: DocsLink,
    Fact,
    Callout,
    Steps,
    Step,
    StatusBadge,
    ReasonTable,
    MandateTable,
    EventSignature,
    ForkLedger,
    RouterCards: () => <RouterCards exists={pageExists} />,
    DecisionLoop,
    Architecture,
    TimelockFlow,
    TreasuryLoop,
    MarketWeek,
    ...components,
  };
}
```

- [ ] **Step 9: See them on a page.** Add these lines to the end of `web/content/docs/index.mdx`, run
  `npm run build`, serve `out/` (`npx serve -L -n out`) and look at `/docs` at 1440 px and 360 px in light
  and dark: every diagram readable, arrows between steps, the market week bars inside their cells, the
  tables scrolling inside their box at 360 px, and the router showing "(coming soon)" for pages not
  written yet. Then remove the lines again.

```mdx
<RouterCards />
<DecisionLoop />
<Architecture />
<TimelockFlow />
<TreasuryLoop />
<MarketWeek />
<ReasonTable />
<MandateTable />
<ForkLedger />
<EventSignature name="Decision" />
<Callout type="fork" title="Fork only">Ran on a Base mainnet fork.</Callout>
<Steps><Step>One</Step><Step>Two</Step></Steps>
A link to [a page not written yet](/docs/security/model) renders as text.
```

- [ ] **Step 10: Typecheck and commit.**

```bash
cd web && npm run typecheck
git add web/lib/docs/links.ts web/components/docs/Callout.tsx web/components/docs/content.tsx web/components/docs/diagrams.tsx web/test/docs-components.test.tsx web/lib/docs-source.ts web/components/docs/mdx.tsx
git commit -m "feat(web): add docs callouts, steps, shared data tables, the reader router and diagrams"
```

### Task 6: Quality gates

The gates that keep every page true (spec §8): frontmatter (gate 1), links (gate 2), facts (gate 5),
language (gate 6), the excerpt rule, the export check over every docs page (gate 7), and the end-to-end
checks (gate 8). Gates 3 and 4 arrive with the data they check (Tasks 11, 13 and 14); gate 9 is Task 20.
After this task, every content task is "write the page, run the gates".

**Files:**
- Modify: `web/package.json` (devDependency `yaml`)
- Create: `web/lib/docs/content-checks.ts`, `web/test/content-checks.test.ts`
- Create: `web/lib/docs/ia.ts`
- Create: `web/test/helpers/docs.ts`, `web/test/docs-ia.test.ts`, `web/test/docs-content.test.ts`
- Modify: `web/lib/check-out.ts`, `web/scripts/check-out.ts`, `web/test/check-out.test.ts`
- Create: `web/e2e/docs.spec.ts`

**Interfaces:**
- Consumes: `docsFrontmatter` (`@/lib/docs/frontmatter`, Task 1); `FACT_TEXT_MAP`, `isFactName` (Task 3);
  `docsSlug`, `headingId` (`@/lib/docs/links`, Task 5); `SITE`; `REPO_ROOT`, `readRepo`
  (`test/helpers/solidity.ts`, existing).
- Produces: `DOCS_IA`, `IA_SLUGS`, types `IaSection`, `IaPage` (`@/lib/docs/ia`); `SHIPPED` in
  `web/test/docs-ia.test.ts`, which every content task extends; `docsPages()`, `DOCS_DIR`
  (`test/helpers/docs.ts`); `checkDocsPage`, `checkLandingIsolation` (`@/lib/check-out`).

- [ ] **Step 1: Add the YAML parser** (tests only; the build parses frontmatter through Fumadocs).
  Run: `cd web && npm install --save-dev --save-exact yaml@2.9.1`

- [ ] **Step 2: Write the failing unit tests for the checks** `web/test/content-checks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  docsLinks,
  excerpts,
  factNames,
  foreignCharacters,
  frontmatterOf,
  handTypedFacts,
  headingIds,
  isDistinctive,
  prose,
  repoPaths,
} from "@/lib/docs/content-checks";

const PAGE = [
  "---",
  "title: The nine checks",
  "---",
  "",
  "Prose with `inline code` and <Fact name=\"forkBlock\" /> here.",
  "",
  "```text",
  "│ trace … 53,551,627",
  "```",
  "",
  "## Why the order matters",
].join("\n");

describe("frontmatterOf and prose", () => {
  it("reads the frontmatter block", () => {
    expect(frontmatterOf(PAGE)).toBe("title: The nine checks");
    expect(frontmatterOf("no frontmatter")).toBe("");
  });

  it("blanks frontmatter, fences, inline code and JSX but keeps every line", () => {
    const p = prose(PAGE);
    expect(p.split("\n")).toHaveLength(PAGE.split("\n").length);
    expect(p).not.toMatch(/title:|inline code|Fact|trace/);
    expect(p).toMatch(/Prose with/);
  });
});

describe("foreignCharacters", () => {
  it("flags accented letters, em dashes and curly quotes in prose and frontmatter", () => {
    const found = foreignCharacters("---\ntitle: Café\n---\nIt’s here — now.\n");
    expect(found).toEqual([
      { line: 2, text: "é" },
      { line: 4, text: "’" },
      { line: 4, text: "—" },
    ]);
  });

  it("allows the listed symbols and exempts fenced code", () => {
    expect(foreignCharacters("$20 ≤ $50 · up → down ≥ ↗ −1\n")).toEqual([]);
    expect(foreignCharacters(PAGE)).toEqual([]);
    expect(foreignCharacters("Counts as … in prose.")).toEqual([{ line: 1, text: "…" }]);
  });
});

describe("handTypedFacts", () => {
  const facts = { forkBlock: "53,551,627", "mandate.perTradeCapUsd": "$50", "premiumsBps.NVDAc": "53 bps", timelockHours: "24 hours" };

  it("only lints distinctive values", () => {
    expect(isDistinctive("53,551,627")).toBe(true);
    expect(isDistinctive("$50")).toBe(true);
    expect(isDistinctive("53 bps")).toBe(true);
    expect(isDistinctive("24 hours")).toBe(false);
    expect(isDistinctive("2026-11-07")).toBe(false);
  });

  it("flags a typed copy, with or without separators", () => {
    expect(handTypedFacts("The fork block is 53,551,627.", facts)).toEqual([{ line: 1, text: 'forkBlock: "53,551,627"' }]);
    expect(handTypedFacts("Block 53551627 it is.", facts)).toEqual([{ line: 1, text: 'forkBlock: "53551627"' }]);
    expect(handTypedFacts("A cap of $50.", facts)).toEqual([{ line: 1, text: 'mandate.perTradeCapUsd: "$50"' }]);
  });

  it("ignores code, JSX, longer numbers and non-distinctive facts", () => {
    expect(handTypedFacts(PAGE, facts)).toEqual([]);
    expect(handTypedFacts("A $500 trade waits 24 hours.", facts)).toEqual([]);
  });
});

describe("page parts", () => {
  it("factNames lists every <Fact> outside code", () => {
    expect(factNames('A <Fact name="timelockHours" /> wait.\n`<Fact name="x" />`\n')).toEqual([{ line: 1, text: "timelockHours" }]);
  });

  it("docsLinks finds markdown and JSX links", () => {
    expect(docsLinks('[a](/docs/concepts/mandate#fields) <a href="/docs/help/faq">b</a> [c](https://x.dev)')).toEqual([
      "/docs/concepts/mandate#fields",
      "/docs/help/faq",
    ]);
  });

  it("repoPaths finds blob and tree links without line anchors", () => {
    const src = "[v](https://github.com/o/r/blob/main/contracts/src/MandateVault.sol#L10) [t](https://github.com/o/r/tree/main/agent)";
    expect(repoPaths(src, "https://github.com/o/r")).toEqual(["contracts/src/MandateVault.sol", "agent"]);
  });

  it("headingIds gives the ids Fumadocs will use, skipping code", () => {
    const ids = headingIds("## Why the order matters\n### `queueMandate`\n### [Read](/docs) more\n```md\n## Not a heading\n```\n");
    expect([...ids]).toEqual(["why-the-order-matters", "queuemandate", "read-more"]);
  });

  it("excerpts reads the file, the line range and the body", () => {
    const src = 'Intro\n\n```solidity title="contracts/src/GuardLib.sol#L44-L45"\n    a;\n    b;\n```\n';
    expect(excerpts(src)).toEqual([{ line: 3, file: "contracts/src/GuardLib.sol", from: 44, to: 45, body: "    a;\n    b;" }]);
  });
});
```

- [ ] **Step 3: Run them and see them fail.**
  Run: `cd web && npx vitest run test/content-checks.test.ts`
  Expected: FAIL: `Failed to resolve import "@/lib/docs/content-checks"`.

- [ ] **Step 4: Write the checks** `web/lib/docs/content-checks.ts`:

```ts
import { headingId } from "./links";

/** Pure checks over docs MDX source. test/docs-content.test.ts runs them on every page in content/docs. */

/** Symbols the docs may use beyond printable ASCII (spec §8 gate 6). */
export const ALLOWED_SYMBOLS: ReadonlySet<string> = new Set(["·", "≤", "≥", "→", "↗", "−"]);

export interface Finding {
  readonly line: number;
  readonly text: string;
}

const blank = (m: string) => m.replace(/[^\n]/g, " ");
const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;

/** The frontmatter block without its `---` lines, or "" when the page has none. */
export function frontmatterOf(source: string): string {
  return /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1] ?? "";
}

/**
 * Characters outside printable ASCII (plus tab and newline) that are not in ALLOWED_SYMBOLS, in prose and
 * frontmatter. Fenced code is exempt: it holds real program output, which may draw boxes or print "…".
 */
export function foreignCharacters(source: string): Finding[] {
  const out: Finding[] = [];
  source
    .replace(FENCE, blank)
    .split("\n")
    .forEach((line, i) => {
      for (const ch of line) {
        const code = ch.codePointAt(0) ?? 0;
        const ascii = code === 9 || code === 13 || (code >= 32 && code <= 126);
        if (!ascii && !ALLOWED_SYMBOLS.has(ch)) out.push({ line: i + 1, text: ch });
      }
    });
  return out;
}

/** The source with frontmatter, fenced code blocks, inline code and JSX tags blanked, keeping line numbers. */
export function prose(source: string): string {
  return source
    .replace(/^---\n[\s\S]*?\n---\n/, blank)
    .replace(FENCE, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/<[A-Za-z][^>]*>/g, blank);
}

/** Variants a hand-typed copy of `text` could take: as shown, and with digit group separators removed. */
function variants(text: string): string[] {
  const plain = text.replace(/(\d)[,_](?=\d{3})/g, "$1");
  return [...new Set([text, plain])];
}

/** A fact is distinctive enough to lint when it has three or more digits, a dollar amount or a bps value. */
export function isDistinctive(text: string): boolean {
  // Dates are left out: milestone and review dates are not facts.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return /\d{3,}|\d,\d{3}|\$\d|\bbps\b/.test(text);
}

/** Prose lines that spell out a distinctive fact instead of rendering it with <Fact>. */
export function handTypedFacts(source: string, facts: Readonly<Record<string, string>>): Finding[] {
  const lines = prose(source).split("\n");
  const out: Finding[] = [];
  for (const [name, text] of Object.entries(facts)) {
    if (!isDistinctive(text)) continue;
    for (const v of variants(text)) {
      const re = new RegExp(`(^|[^\\w.,])${v.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&")}(?![\\w]|[.,]\\d)`);
      lines.forEach((l, i) => {
        if (re.test(l)) out.push({ line: i + 1, text: `${name}: "${v}"` });
      });
    }
  }
  return out;
}

/** Every `<Fact name="…" />` name on the page, outside code. */
export function factNames(source: string): Finding[] {
  const lines = source.replace(FENCE, blank).replace(/`[^`\n]*`/g, blank).split("\n");
  return lines.flatMap((l, i) => [...l.matchAll(/<Fact\s+name="([^"]*)"/g)].map((m) => ({ line: i + 1, text: m[1] ?? "" })));
}

/** Every docs-internal href in markdown links and JSX href attributes, e.g. "/docs/concepts/mandate#fields". */
export function docsLinks(source: string): string[] {
  const md = [...source.matchAll(/\]\((\/docs[^)\s]*)\)/g)].map((m) => m[1] ?? "");
  const jsx = [...source.matchAll(/href=["'](\/docs[^"']*)["']/g)].map((m) => m[1] ?? "");
  return [...md, ...jsx];
}

/** Repo paths linked as `<repoUrl>/blob/main/<path>` or `/tree/main/<path>`, without any #L anchor. */
export function repoPaths(source: string, repoUrl: string): string[] {
  const esc = repoUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...source.matchAll(new RegExp(`${esc}/(?:blob|tree)/main/([^)\\s"'#?]+)`, "g"))].map((m) => m[1] ?? "");
}

/** The ids Fumadocs gives the page's headings (h2 to h6), outside code blocks. */
export function headingIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const line of source.replace(FENCE, blank).split("\n")) {
    const text = /^#{2,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1];
    if (text !== undefined) ids.add(headingId(text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")));
  }
  return ids;
}

export interface Excerpt {
  /** Line of the opening fence in the page. */
  readonly line: number;
  readonly file: string;
  readonly from: number;
  readonly to: number;
  readonly body: string;
}

/** Fenced blocks titled with a repo path and a line range: ```solidity title="contracts/src/GuardLib.sol#L44-L62". */
export function excerpts(source: string): Excerpt[] {
  const out: Excerpt[] = [];
  const re = /^(```|~~~)[^\n]*title="([^"#]+)#L(\d+)-L(\d+)"[^\n]*\n([\s\S]*?)^\1[^\n]*$/gm;
  for (const m of source.matchAll(re)) {
    out.push({
      line: source.slice(0, m.index).split("\n").length,
      file: m[2] ?? "",
      from: Number(m[3]),
      to: Number(m[4]),
      body: (m[5] ?? "").replace(/\n$/, ""),
    });
  }
  return out;
}
```

- [ ] **Step 5: Run them.** `cd web && npx vitest run test/content-checks.test.ts`. Expected: PASS (12 tests).

- [ ] **Step 6: Write the IA** `web/lib/docs/ia.ts`. Titles and descriptions are final: every page brief in
  Tasks 7 to 18 uses exactly these.

```ts
/**
 * The docs center's pages in sidebar order (docs spec §3), with the exact title and description each page's
 * frontmatter must use. test/docs-ia.test.ts checks content/docs against it; nothing reads it at runtime.
 */
export interface IaPage {
  /** Path under content/docs without .mdx, e.g. "concepts/nine-checks"; the home page is "index". */
  readonly slug: string;
  readonly title: string;
  /** 50 to 160 characters (spec §5.1). */
  readonly description: string;
}

export interface IaSection {
  /** Folder under content/docs; "" for the home page. */
  readonly dir: string;
  /** The sidebar group title, as in the folder's meta.json. */
  readonly title: string;
  readonly pages: readonly IaPage[];
}

const page = (slug: string, title: string, description: string): IaPage => ({ slug, title, description });

export const DOCS_IA: readonly IaSection[] = [
  {
    dir: "",
    title: "Maat docs",
    pages: [
      page(
        "index",
        "Maat docs",
        "Understand Maat, verify every claim against the code, run it, and run your own vault. Pick the path that fits why you came.",
      ),
    ],
  },
  {
    dir: "get-started",
    title: "Get started",
    pages: [
      page(
        "get-started/what-is-maat",
        "What is Maat",
        "The problem with agents that trade tokenized stocks around the clock, and how a mandate onchain decides every trade they propose.",
      ),
      page(
        "get-started/how-a-decision-is-made",
        "How a decision is made",
        "Follow one trade from vault state to the Decision event: the policy, Claude's proposal, the preview, the send and the nine checks.",
      ),
      page(
        "get-started/quickstart",
        "Quickstart: verify Maat in five minutes",
        "Clone the repo and run the refusal test, the contract suites, the agent tests and the site build offline. No wallet, RPC or API key.",
      ),
      page(
        "get-started/read-a-decision",
        "Read a decision",
        "What each field of a Decision event means, how to read a refusal, and how to match a ledger row to its transaction and rationale.",
      ),
      page(
        "get-started/status",
        "Status and roadmap",
        "What is built and fork-tested today, what is next before mainnet, and what is planned but not built, with what each step needs.",
      ),
    ],
  },
  {
    dir: "concepts",
    title: "Concepts",
    pages: [
      page(
        "concepts/mandate",
        "The mandate",
        "Every field of the onchain mandate: what it limits, its default value and unit, why that value, and which check reads it.",
      ),
      page(
        "concepts/nine-checks",
        "The nine checks",
        "The order in which the vault checks a trade, what each check reads, and the reason code it returns when it fails.",
      ),
      page(
        "concepts/refusal-codes",
        "Refusal codes",
        "All refusal reasons the vault can record: what each means, which actions can return it, where it is raised and how the agent reacts.",
      ),
      page(
        "concepts/market-hours",
        "Market hours",
        "How the onchain calendar decides the NYSE session in New York time, with daylight saving, holidays, early closes and the feed edge.",
      ),
      page(
        "concepts/prices-and-premium",
        "Prices and premium",
        "How the vault reads Chainlink equity feeds and the Aerodrome pool TWAP, measures the premium between them and rejects stale prices.",
      ),
      page(
        "concepts/splits-and-multiplier",
        "Splits and the multiplier",
        "Why a change to a B20 token's uiMultiplier pauses trading in it, how the vault detects one, and why unreadable values fail closed.",
      ),
      page(
        "concepts/credit-and-health-factor",
        "Credit and the health factor",
        "How the vault supplies stock to Aave V4, borrows USDC against it, and keeps the health factor above its floor before weekends.",
      ),
      page(
        "concepts/timelock-and-roles",
        "Timelock and roles",
        "Who can do what: owner, executor and payees. How rule changes are queued, applied or cancelled, and what a leaked key can do.",
      ),
      page(
        "concepts/treasury-loop",
        "The treasury loop",
        "How the agent keeps its basket, supplies idle stock, borrows for runway and pays its own compute bill, and what is still planned.",
      ),
    ],
  },
  {
    dir: "guides",
    title: "Guides",
    pages: [
      page(
        "guides/run-the-tests",
        "Run the tests",
        "Run the contract unit and fork suites, the agent unit and fork tests, and the website checks, with what each one needs to run.",
      ),
      page(
        "guides/reproduce-the-fork-run",
        "Reproduce the fork run",
        "Rerun the end-to-end agent test on a Base mainnet fork and read its decisions, its trace and the gas log it writes.",
      ),
      page(
        "guides/deploy-your-own-vault",
        "Deploy your own vault",
        "Deploy a vault with the default mandate: dry-run it on a fork first, then broadcast to Base mainnet from your own wallet.",
      ),
      page(
        "guides/configure-a-mandate",
        "Configure a mandate",
        "Change the limits, tokens and payees before you deploy, and understand the validation errors the vault raises for a bad config.",
      ),
      page(
        "guides/run-the-agent",
        "Run the agent",
        "Configure and start the agent loop: dry-run and live modes, its settings, the CDP wallet, the Builder Code and its daily limits.",
      ),
      page(
        "guides/change-a-rule",
        "Change a rule",
        "Queue a mandate, token or payee change, wait out the timelock, then apply or cancel it and check the new policy hash.",
      ),
      page(
        "guides/pause-withdraw-recover",
        "Pause, withdraw and recover",
        "The emergency playbook: pause the vault, rotate the executor, withdraw funds and unwind a credit position, step by step.",
      ),
      page(
        "guides/watch-decisions-onchain",
        "Watch decisions onchain",
        "Read Decision events from a vault with cast or viem, decode the action and reason, and match them to the agent's journal.",
      ),
    ],
  },
  {
    dir: "reference",
    title: "Reference",
    pages: [
      page(
        "reference/mandate-vault",
        "MandateVault",
        "Every external and public function of MandateVault: its signature, who may call it, what it changes, and how it reverts or refuses.",
      ),
      page(
        "reference/events",
        "Events",
        "Every event the vault, the calendar and the adapters emit, with each parameter and when the event is emitted.",
      ),
      page(
        "reference/errors",
        "Errors",
        "Every custom error in Maat's contracts and adapters, with its parameters and the condition that raises it.",
      ),
      page(
        "reference/types",
        "Types",
        "The Intent, Mandate and TokenConfig structs and the Action, Reason and SessionMode enums, field by field and member by member.",
      ),
      page(
        "reference/market-calendar",
        "MarketCalendar",
        "The calendar contract's functions, the holidays and early closes it ships with, and the rule that it can only get stricter.",
      ),
      page(
        "reference/adapters",
        "Adapters",
        "The swap and credit adapter interfaces, and the Aerodrome Slipstream and Aave V4 adapters that implement them for Base.",
      ),
      page(
        "reference/agent-configuration",
        "Agent configuration",
        "Every environment variable the agent reads: whether it is required, its default, and what it changes in the loop.",
      ),
      page(
        "reference/agent-scripts",
        "Agent scripts",
        "The npm scripts in the agent package: what each runs, the modes they take, what they need and how they exit.",
      ),
      page(
        "reference/base-addresses",
        "Base addresses",
        "The Base mainnet tokens, Chainlink feeds, Aerodrome pools and Aave V4 contracts Maat uses, with links to Basescan.",
      ),
      page(
        "reference/default-parameters",
        "Default parameters",
        "Every default the vault, the calendar and the agent ship with, with its unit and the source file that sets it.",
      ),
    ],
  },
  {
    dir: "security",
    title: "Security",
    pages: [
      page(
        "security/model",
        "Security model",
        "What the vault enforces, in which code, and why neither Claude nor a stolen executor key can get around it.",
      ),
      page(
        "security/threat-model",
        "Threat model",
        "The assets, the actors and what each one could do with a leaked key, from the owner to the Claude API key, and the mitigations.",
      ),
      page(
        "security/not-claimed",
        "What Maat does not claim",
        "No audit, no mainnet deployment yet, and the known limitations: what can still go wrong and what is out of scope.",
      ),
      page(
        "security/testing",
        "How it is tested",
        "How each guarantee is tested: contract unit and fork suites, agent tests, parity tests between the site and the code.",
      ),
      page(
        "security/report-a-vulnerability",
        "Report a vulnerability",
        "How to report a security problem in Maat privately, what to include, and what to expect after you report it.",
      ),
    ],
  },
  {
    dir: "help",
    title: "Help",
    pages: [
      page(
        "help/faq",
        "FAQ",
        "Short answers to the questions people ask about Maat, from what it is to how it is tested, each linking to the page that proves it.",
      ),
      page(
        "help/troubleshooting",
        "Troubleshooting",
        "Fixes for problems that happened while building and testing Maat: line endings, Foundry versions, fork RPCs, submodules and gas.",
      ),
      page(
        "help/glossary",
        "Glossary",
        "Plain definitions of every term the docs use, from B20 and uiMultiplier to TWAP, health factor, Builder Code and the feed edge.",
      ),
      page(
        "help/changelog",
        "Changelog",
        "Maat's milestones, newest first: what each one added, when, and where to read the code and the spec behind it.",
      ),
    ],
  },
];

/** Every page slug, in sidebar order. */
export const IA_SLUGS: readonly string[] = DOCS_IA.flatMap((s) => s.pages.map((p) => p.slug));
```

- [ ] **Step 7: Write the page gates.** `web/test/helpers/docs.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { REPO_ROOT } from "./solidity";

export const DOCS_DIR = join(REPO_ROOT, "web/content/docs");

export interface DocsPage {
  /** Path under content/docs without .mdx, with forward slashes: "concepts/nine-checks". */
  readonly slug: string;
  /** The MDX source with LF line endings, whatever the checkout uses. */
  readonly source: string;
}

/** Every .mdx page under content/docs, sorted by slug. */
export function docsPages(dir = DOCS_DIR): DocsPage[] {
  const out: DocsPage[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".mdx")) {
        const slug = relative(dir, p).split(sep).join("/").replace(/\.mdx$/, "");
        out.push({ slug, source: readFileSync(p, "utf8").replace(/\r\n/g, "\n") });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}
```

`web/test/docs-ia.test.ts` (`SHIPPED` starts with the seed home page; content tasks append to it):

```ts
// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_IA, IA_SLUGS } from "@/lib/docs/ia";
import { DOCS_DIR, docsPages } from "./helpers/docs";

/** The pages written so far. Each content task (7 to 18) appends its slugs; Task 18b checks this is the whole IA. */
const SHIPPED: readonly string[] = ["index"];

const written = docsPages().map((p) => p.slug);
const meta = (dir: string) => JSON.parse(readFileSync(join(DOCS_DIR, dir, "meta.json"), "utf8")) as unknown;
const sections = DOCS_IA.filter((s) => s.dir !== "");

describe("docs pages follow the IA (docs spec §3)", () => {
  it("the IA has unique slugs and descriptions of 50 to 160 characters", () => {
    expect(new Set(IA_SLUGS).size).toBe(IA_SLUGS.length);
    const pages = DOCS_IA.flatMap((s) => s.pages);
    expect(pages.filter((p) => p.description.length < 50 || p.description.length > 160).map((p) => p.slug)).toEqual([]);
  });

  it("every shipped page is written", () => {
    expect(SHIPPED.filter((s) => !written.includes(s))).toEqual([]);
  });

  it("every written page is shipped and in the IA", () => {
    expect(written.filter((s) => !SHIPPED.includes(s))).toEqual([]);
    expect(SHIPPED.filter((s) => !IA_SLUGS.includes(s))).toEqual([]);
  });

  it("each section's meta.json lists its written pages in IA order", () => {
    for (const s of sections) {
      const pages = s.pages.filter((p) => written.includes(p.slug)).map((p) => p.slug.slice(s.dir.length + 1));
      if (pages.length === 0) expect(existsSync(join(DOCS_DIR, s.dir)), `${s.dir}/ has no pages yet`).toBe(false);
      else expect(meta(s.dir), `${s.dir}/meta.json`).toEqual({ title: s.title, pages });
    }
  });

  it("the root meta.json lists the home page, then each section that has pages", () => {
    const dirs = sections.filter((s) => s.pages.some((p) => written.includes(p.slug))).map((s) => s.dir);
    expect(meta("")).toEqual({ title: DOCS_IA[0]?.title, pages: ["index", ...dirs] });
  });
});
```

`web/test/docs-content.test.ts`:

```ts
// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  docsLinks,
  excerpts,
  factNames,
  foreignCharacters,
  frontmatterOf,
  handTypedFacts,
  headingIds,
  repoPaths,
} from "@/lib/docs/content-checks";
import { FACT_TEXT_MAP, isFactName } from "@/lib/docs/fact-text";
import { docsFrontmatter } from "@/lib/docs/frontmatter";
import { DOCS_IA } from "@/lib/docs/ia";
import { docsSlug } from "@/lib/docs/links";
import { SITE } from "@/lib/site";
import { docsPages } from "./helpers/docs";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// The content gates (docs spec §8, gates 1, 2, 5, 6 and the excerpt rule) over every page in content/docs.
// A failure names the file, the line and what is wrong: fix the page, not the gate.

const pages = docsPages();
const bySlug = new Map(pages.map((p) => [p.slug, p.source]));
const ia = new Map(DOCS_IA.flatMap((s) => s.pages).map((p) => [p.slug, p]));
const at = (slug: string, f: { line: number; text: string }) => `content/docs/${slug}.mdx:${f.line} ${f.text}`;

describe.each(pages.map((p) => [p.slug, p.source] as const))("content/docs/%s.mdx", (slug, source) => {
  const fm = (parse(frontmatterOf(source)) ?? {}) as Record<string, unknown>;

  it("has valid frontmatter with the IA's title and description (gate 1)", () => {
    const r = docsFrontmatter.safeParse(fm);
    expect(r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)).toEqual([]);
    const want = ia.get(slug);
    expect(want, `${slug} is not in lib/docs/ia.ts`).toBeDefined();
    expect({ title: fm.title, description: fm.description }).toEqual({ title: want?.title, description: want?.description });
  });

  it("cites sources that exist and next pages in the IA (gate 1)", () => {
    const sources = (fm.sources ?? []) as string[];
    expect(sources.filter((s) => !existsSync(join(REPO_ROOT, s)))).toEqual([]);
    const next = (fm.next ?? []) as string[];
    expect(next.filter((n) => !ia.has(n))).toEqual([]);
  });

  it("is plain English (gate 6)", () => {
    expect(foreignCharacters(source).map((f) => at(slug, f))).toEqual([]);
  });

  it("renders numbers with <Fact> and only known names (gate 5)", () => {
    expect(handTypedFacts(source, FACT_TEXT_MAP).map((f) => at(slug, f))).toEqual([]);
    expect(factNames(source).filter((f) => !isFactName(f.text)).map((f) => at(slug, f))).toEqual([]);
  });

  it("links to IA pages, to headings that exist, and to repo paths that exist (gate 2)", () => {
    const bad: string[] = [];
    for (const href of docsLinks(source)) {
      const target = (docsSlug(href) ?? []).join("/") || "index";
      const hash = href.split("#")[1];
      const page = bySlug.get(target);
      if (!ia.has(target)) bad.push(`${href}: not a page in lib/docs/ia.ts`);
      // A page in the IA that is not written yet passes; its anchors are checked once it ships.
      else if (hash && page !== undefined && !headingIds(page).has(hash)) bad.push(`${href}: no heading #${hash} on ${target}`);
    }
    for (const p of repoPaths(source, SITE.repoUrl)) if (!existsSync(join(REPO_ROOT, p))) bad.push(`${p}: not in the repo`);
    expect(bad).toEqual([]);
  });

  it("quotes code exactly (excerpt gate)", () => {
    for (const e of excerpts(source)) {
      const lines = readRepo(e.file).replace(/\r\n/g, "\n").split("\n").slice(e.from - 1, e.to).join("\n");
      expect(e.body, `content/docs/${slug}.mdx:${e.line} ${e.file}#L${e.from}-L${e.to}`).toBe(lines);
    }
  });
});
```

- [ ] **Step 8: Run the page gates on the seed page.**
  Run: `cd web && npx vitest run test/docs-ia.test.ts test/docs-content.test.ts`
  Expected: PASS. The seed `content/docs/index.mdx` from Task 1 already uses the IA's title and
  description for `index`.

- [ ] **Step 9: Prove each gate bites.** Add each line below to `content/docs/index.mdx` on its own, run
  `npx vitest run test/docs-content.test.ts`, check the failure names `index.mdx`, the line and the rule,
  then remove the line:
  - `The fork block was 53,551,627.` → renders numbers with `<Fact>`, `forkBlock: "53,551,627"`
  - `It is safe — mostly.` → plain English, `—`
  - `See [the vault](/docs/reference/vault).` → `/docs/reference/vault: not a page in lib/docs/ia.ts`
  - `See [the checks](/docs#nowhere).` → `no heading #nowhere on index`
  - `<Fact name="nope" />` → `index.mdx:<line> nope`
  Also change `description:` to `Too short.` and expect the frontmatter test to fail on `description`.

- [ ] **Step 10: Write the failing export-check tests.** Replace `web/test/check-out.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { checkDocsPage, checkExport, checkLandingIsolation } from "@/lib/check-out";
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
    ["an in-page link without a target", DOC.replace('href="#why"', 'href="#nowhere"'), /#nowhere/],
    ["a link to a docs page that was not exported", DOC.replace('href="/docs"', 'href="/docs/concepts/gone"'), /\/docs\/concepts\/gone/],
  ])("flags %s", (_name, html, problem) => {
    expect(checkDocsPage(html, PATH, KNOWN).join("\n")).toMatch(problem);
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
```

Run: `cd web && npx vitest run test/check-out.test.ts`. Expected: FAIL: `checkDocsPage` is not exported.

- [ ] **Step 11: Extend the export check.** Replace `web/lib/check-out.ts` with:

```ts
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
```

and `web/scripts/check-out.ts` with:

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocsPage, checkExport, checkLandingIsolation } from "../lib/check-out";

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
  "api/search",
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
  if (!existsSync(join(OUT, `md${url}.md`))) problems.push(`missing out/md${url}.md`);
}
// test/docs-ia.test.ts checks that every written page is in the IA; here, that the export has docs at all.
if (docsFiles.length === 0) problems.push("found no docs pages in out/");

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`out/ is ready to deploy (landing and ${docsFiles.length} docs ${docsFiles.length === 1 ? "page" : "pages"} checked)`);
```

Run: `cd web && npx vitest run test/check-out.test.ts && npm run build && npm run check:out`
Expected: PASS, then `out/ is ready to deploy (landing and 1 docs page checked)`. Task 19 adds `llms.txt`,
`llms-full.txt` and the sitemap entries to this script.

- [ ] **Step 12: Write the end-to-end checks.** Replace `web/e2e/docs.spec.ts` with this version: the tests
  from Tasks 2 and 4, plus every width from 360 px to 1920 px with no page scroll and no console errors
  (gate 8, Review Focus 4), the theme toggle, the dark theme staying off the landing page (Review Focus 1)
  and the drawer by keyboard. `PAGES` grows as the long pages ship (Tasks 8 and 13).

```ts
import { expect, type Page, test } from "@playwright/test";
import { FACT_TEXT } from "../lib/docs/fact-text";

const WIDTHS = [360, 768, 1024, 1440, 1920] as const;
/** Pages checked at every width: the docs home, then the longest pages as they ship (Tasks 8 and 13). */
const PAGES: string[] = ["/docs"];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

for (const width of WIDTHS) {
  for (const path of PAGES) {
    test(`${path} fits ${width}px: no page scroll, no console errors`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.screenshot({ path: `test-results/screens/docs${path.replace(/\//g, "-")}-${width}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
  }
}

/** Opens search the way a reader does. Playwright sends "K" for "Control+K"; a real Ctrl+K sends "k", which Fumadocs matches. */
async function openSearch(page: Page) {
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("search", () => {
  test("Ctrl+K opens it and \"maat\" finds the docs home", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await dialog.getByRole("option", { name: /Maat docs/ }).first().click();
    await expect(page).toHaveURL(/\/docs$/);
  });

  test("a query with no match shows the empty state", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("zzzzqqq");
    await expect(dialog.getByRole("status").filter({ hasText: "No results" })).toHaveText(
      'No results for "zzzzqqq". Try a reason code like MARKET_CLOSED.',
    );
  });

  test("a slow index shows the loading state, then the results", async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("status").filter({ hasText: "Searching..." })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });

  test("an index that cannot load shows the error state, not a spinner", async ({ page }) => {
    await page.route("**/api/search**", (route) => route.abort());
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("maat");
    await expect(dialog.getByRole("alert")).toContainText("Search is unavailable. Check your connection and try again.");
    await expect(dialog.getByText("Searching...")).toHaveCount(0);

    // Back online: "Try again" downloads the index again and the results come back.
    await page.unroute("**/api/search**");
    await dialog.getByRole("button", { name: "Try again" }).click();
    await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
  });
});

test("the 404 page offers search and the docs sections", async ({ page }) => {
  for (const path of ["/does-not-exist", "/docs/does-not-exist"]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page does not exist.");
    await expect(page.getByRole("link", { name: "Maat docs" })).toHaveAttribute("href", "/docs");
  }
  await page.locator("button[data-search-full]").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").fill("maat");
  await expect(dialog.getByRole("option", { name: /Maat docs/ }).first()).toBeVisible();
});

test.describe("copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Copy page as Markdown copies the page with its facts filled in", async ({ page }) => {
    // networkidle: the button only works once the page has hydrated.
    await page.goto("/docs", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy page as Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
    // The Windows clipboard stores line breaks as CRLF.
    const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    expect(text).toMatch(/^# Maat docs\n\nURL: https?:\/\/[^\n]+\/docs\n/);
    expect(text).toContain(`passes ${FACT_TEXT.checksPerTrade.text} checks`);
    expect(text).not.toContain("<Fact");
  });

  test("Copy page as Markdown says so when the file cannot load", async ({ page }) => {
    await page.route("**/md/**", (route) => route.abort());
    await page.goto("/docs", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Copy page as Markdown" }).click();
    await expect(page.getByRole("button", { name: "Copy failed. Try again" })).toBeVisible();
  });
});

test("the theme toggles and persists across a reload", async ({ page }) => {
  await page.goto("/docs");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);
  await page.locator("[data-theme-toggle]").first().click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);
  // A single "d" keypress must not flip the theme back (Fumadocs' hotkey is off).
  await page.locator("body").press("d");
  await expect(html).toHaveClass(/\bdark\b/);
});

test("dark docs do not reach the landing page", async ({ page }) => {
  await page.goto("/docs");
  await page.locator("[data-theme-toggle]").first().click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
});

test("at 360px the sidebar drawer opens and closes by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/docs");
  // The drawer has its own copy of the button; the one in the page header opens it.
  const header = page.locator("#nd-subnav");
  const open = header.getByRole("button", { name: "Open Sidebar" });
  const drawer = page.locator("#nd-sidebar-mobile");
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(drawer).toHaveAttribute("data-state", "open");
  await expect(drawer.getByRole("link", { name: "Maat docs" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveAttribute("data-state", "closed");
  // Focus goes back to the button that opened the drawer.
  await expect(header.getByRole("button", { name: "Open Sidebar" })).toBeFocused();
});
```

- [ ] **Step 13: Run every check.**
  Run: `cd web && npm run verify && npm run e2e`
  Expected: all PASS: 15 tests in `e2e/docs.spec.ts` and every test in `e2e/smoke.spec.ts` for the landing page.

- [ ] **Step 14: Commit.**

```bash
git add web/package.json web/package-lock.json web/lib/docs/content-checks.ts web/test/content-checks.test.ts web/lib/docs/ia.ts web/test/helpers/docs.ts web/test/docs-ia.test.ts web/test/docs-content.test.ts web/lib/check-out.ts web/scripts/check-out.ts web/test/check-out.test.ts web/e2e/docs.spec.ts
git commit -m "test(web): gate docs frontmatter, language, facts, links, excerpts, the export and the browser"
```

### How every content task works

Content tasks (7, 8, 9, 10, 13, 14, 15, 16, 17, 18) share one procedure. The page briefs below are the
requirements: the exact frontmatter, the H2 outline, what the page must show, and where the facts come
from. Write the prose yourself, from the listed sources only. Read each source before you write about it.

**Rules for every page (the gates in Task 6 enforce the ones marked ✔):**

- ✔ Frontmatter exactly as given in the brief (title, description, type, audience, status, lastReviewed,
  sources, next). Do not change a description; it was length-checked.
- ✔ Plain English in basic Latin. Allowed extra symbols: `·` `≤` `≥` `→` `↗` `−`. No em dash, no curly
  quotes, no accented letters. Use a colon, a comma or parentheses where you would reach for an em dash.
- ✔ A distinctive number (three or more digits, a dollar amount, a bps value) never appears as typed text
  outside code blocks: render it with `<Fact name="…" />`. Small numbers that are facts (the 24-hour
  timelock, the 9 checks, the 19 refusals, the 1.5 floor) also use `<Fact>`, even though the lint cannot
  catch them. If a number you need has no `FACT_TEXT` entry, stop and add it first: the value and its
  source in `content/docs-facts.ts` (`DOCS_FACTS`, never `content/facts.ts`, which the landing page
  bundles), its text in `lib/docs/fact-text.ts`, and a parity test in `test/docs-facts.test.ts` (Task 3
  shows the pattern).
- ✔ Every `/docs/...` link resolves to a page, and every `#anchor` to a heading on it.
- No test counts anywhere ("220 tests passed" goes stale). Show the command and a trimmed real output
  with counts replaced by `…`, labelled with what produced it: "Trimmed output from the run at commit
  `<short sha>`" where `<short sha>` is `git rev-parse --short HEAD` when you copy it, or "from
  README.md, How to evaluate Maat in 5 minutes" when copied from there.
- Command output is copied, never typed from memory. Placeholders look like placeholders:
  `<VAULT_ADDRESS>`, `<BASE_RPC_URL>`, `<OWNER_ADDRESS>`. Never paste a real RPC URL.
- Commands that broadcast or sign (`forge script ... --broadcast`, `cast send`, `cast wallet`) may be
  documented for the owner, inside a `<Callout type="warning" title="Owner only">`, copied from
  `deployments/README.md`. Never run them.
- Open with one paragraph that says what the reader will get (the description is already shown as the
  lede by the layout; the paragraph adds the why). Then the template for the page's `type` (spec §4.2).
- Define a term on first use and link it to its glossary entry: `[TWAP](/docs/help/glossary#twap)`.
  ✔ A link to a page in the IA that is not written yet passes until that page ships; from then on its
  anchors are checked too (Task 6). A link to anything outside the IA always fails.
- Every page has at least one concrete artifact: a table, a diagram, a command, an example or a short
  code excerpt. ✔ An excerpt is a fenced block whose title names the file and lines, copied exactly:
  ` ```solidity title="contracts/src/GuardLib.sol#L44-L62" `. The excerpt gate (Task 6) compares it with
  those lines of the file, so an excerpt that drifts from the code fails the tests. Keep excerpts to at
  most 20 lines.
- Status label: every page below is `fork-tested`. Nothing is `live` until the owner deploys. Planned
  work appears only on Status and roadmap, in a `<Callout type="note" title="Planned">`.

**Steps for each content task:**

- [ ] **Step 1: Pin the pages in the IA test.** Append the task's slugs to `SHIPPED` in
  `web/test/docs-ia.test.ts` (the list is in the brief heading of each page).
- [ ] **Step 2: Run the IA test and see it fail.**
  Run: `cd web && npx vitest run test/docs-ia.test.ts`
  Expected: FAIL, naming each new slug as missing from `content/docs`.
- [ ] **Step 3: Write the pages and the section's `meta.json`** from the briefs.
- [ ] **Step 4: Run the content gates.**
  Run: `cd web && npx vitest run test/docs-ia.test.ts test/docs-content.test.ts`
  Expected: PASS. A failure names the file, the line and the rule; fix the page, not the gate.
- [ ] **Step 5: Build and check the export.**
  Run: `cd web && NEXT_TELEMETRY_DISABLED=1 npm run build && npm run check:out`
  Expected: build succeeds; `out/ is ready to deploy`.
- [ ] **Step 6: Read every new page in the browser** at 1440 px and 360 px (`npx serve -L -n out`, then
  open `http://localhost:3000/docs/...`). Check the table of contents, the code blocks and that no table
  pushes the page wider than the screen.
- [ ] **Step 7: Commit.**

```bash
git add web/content/docs web/test/docs-ia.test.ts
git commit -m "docs(web): add the <section> pages to the docs center"
```

(Add `web/content/docs-facts.ts web/lib/docs/fact-text.ts web/test/docs-facts.test.ts` when Step 3 needed a new
fact. End every commit message with the `Co-Authored-By` line from Global Constraints.)

---

### Task 7: Docs home and Get started

**Files:**
- Create: `web/content/docs/index.mdx` (replaces the Task 1 seed page)
- Create: `web/content/docs/get-started/meta.json`
- Create: `web/content/docs/get-started/{what-is-maat,how-a-decision-is-made,quickstart,read-a-decision,status}.mdx`
- Modify: `web/test/docs-ia.test.ts` (`SHIPPED`)

**Interfaces:**
- Consumes: `<Fact>` (Task 3), `<Callout>`, `<Steps>`/`<Step>`, `<DecisionLoop>`, `<Architecture>`,
  `<ReasonTable>`, `<RouterCards>` (Task 5), frontmatter schema (Task 1).
- Produces: pages other tasks link to: `/docs/get-started/quickstart`, `/docs/get-started/status`.

`web/content/docs/get-started/meta.json`:

```json
{
  "title": "Get started",
  "pages": ["what-is-maat", "how-a-decision-is-made", "quickstart", "read-a-decision", "status"]
}
```

#### `index` (docs home)

```yaml
---
title: Maat docs
description: Understand Maat, verify every claim against the code, run it, and run your own vault. Pick the path that fits why you came.
type: overview
audience: [newcomer, watcher, developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
next: [get-started/what-is-maat, get-started/quickstart]
---
```

One screen, in this order:
1. Two sentences: Maat is an AI agent that trades tokenized stocks on Base from its own treasury; Claude
   proposes every move and an onchain mandate decides, with every verdict recorded. The second sentence
   must contain the words `passes <Fact name="checksPerTrade" /> checks` (for example "Every trade it
   proposes passes <Fact name="checksPerTrade" /> checks before any funds move."): the Copy as Markdown
   test from Task 4 reads that phrase on this page.
2. `<RouterCards />` (the five reader paths, Task 5).
3. `<DecisionLoop />` with its caption.
4. A short "Where to find things" list: search (Ctrl K), [GitHub](SITE.repoUrl), [@maatonbase on X](SITE.xUrl),
   [Status and roadmap](/docs/get-started/status).

#### `get-started/what-is-maat`

```yaml
---
title: What is Maat
description: The problem with agents that trade tokenized stocks around the clock, and how a mandate onchain decides every trade they propose.
type: overview
audience: [newcomer, watcher, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - contracts/src/MandateVault.sol
  - contracts/src/GuardLib.sol
  - docs/superpowers/specs/2026-11-06-mandate-treasury-design.md
next: [get-started/how-a-decision-is-made, get-started/quickstart, concepts/nine-checks]
---
```

H2 outline: `The problem` · `The answer: the agent proposes, the mandate decides` · `What exists today` ·
`Who it is for` · `What it is not`.
Must show: the hazard table from README "The problem" (hazard, what goes wrong, reason code), rendered as
a markdown table; the treasury size (`<Fact name="treasuryUsd" />`); the one-sentence answer; a three-row
"exists today / next / planned" summary that links to Status and roadmap. "What it is not": not
investment advice, no shareholder rights, not offered to US persons (from `SITE.disclaimer`), no API or
SDK to integrate today.
Sources to read: README "The problem", "Why it is different", "What Maat does"; product spec §1 and §2.

#### `get-started/how-a-decision-is-made`

```yaml
---
title: How a decision is made
description: Follow one trade from vault state to the Decision event: the policy, Claude's proposal, the preview, the send and the nine checks.
type: concept
audience: [newcomer, watcher, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - agent/src/loop/runOnce.ts
  - agent/src/llm/schema.ts
  - agent/src/exec/sender.ts
  - contracts/src/MandateVault.sol
  - contracts/src/IMandateVaultEvents.sol
next: [concepts/nine-checks, get-started/read-a-decision, concepts/refusal-codes]
---
```

H2 outline: `The loop in four steps` · `Step 1: read the vault` · `Step 2: the policy and Claude` ·
`Step 3: preview and send` · `Step 4: the vault decides` · `Worked example: the Saturday buy` ·
`What none of the agent's steps can do`.
Must show: `<Architecture />`; the proposal limits (`<Fact name="maxIntents" />`,
`<Fact name="maxRationaleChars" />`); that `rationaleHash` is `keccak256` of the rationale; that
Claude's schema cannot express `PAY_EXPENSE`; the worked example from the fork run: Thursday
`<Fact name="forkTimeEt" />` BUY allowed, clock moved `<Fact name="weekendOffsetDays" />` days, BUY
refused with `MARKET_CLOSED`, gas `<Fact name="gas.refusalLog" />`, with a link to
[Reproduce the fork run](/docs/guides/reproduce-the-fork-run).
Sources to read: README "How a decision is made", "The agent runtime"; `runOnce.ts`; `schema.ts`.

#### `get-started/quickstart`

```yaml
---
title: "Quickstart: verify Maat in five minutes"
description: Clone the repo and run the refusal test, the contract suites, the agent tests and the site build offline. No wallet, RPC or API key.
type: guide
audience: [developer, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - contracts/test/MandateVault.t.sol
  - contracts/foundry.toml
next: [guides/run-the-tests, guides/reproduce-the-fork-run, security/testing]
---
```

Guide template. Prerequisites table: git, Foundry 1.8.4 or newer (why: `hardfork = "base:Cobalt"`), Node 24
with npm, bash (Git Bash on Windows). Time: about five minutes on a fresh clone.
`<Steps>` with five `<Step>`s, commands copied from README "How to evaluate Maat in 5 minutes":
1. Clone and init the two direct submodules (not `--recursive`).
2. `forge test --match-test test_refusalIsLoggedNotReverted -vvvv`, with the README's trimmed trace and the
   paragraph explaining it: `reason: 6` is `MARKET_CLOSED`, `execute` returned normally, the intent id is
   spent.
3. Contract unit suites (`forge test --no-match-path "test/fork/*"`), output with counts as `…`.
4. Agent tests (`npm ci && npm test` in `agent/`), output with counts as `…`.
5. Site tests and build (`npm ci`, `npm test`, `npm run build`, `npm run check:out` in `web/`), ending in
   `out/ is ready to deploy`.
Then `Check it worked` (all suites report 0 failed; the trace shows `allowed: false, reason: 6`),
`Optional: the fork tests` (needs a Base archive RPC as `<BASE_RPC_URL>`, link to Run the tests), and
`Common mistakes` (Foundry too old; `--recursive` on Windows hits the path limit; CRLF line endings, link
to [Troubleshooting](/docs/help/troubleshooting)).

#### `get-started/read-a-decision`

```yaml
---
title: Read a decision
description: What each field of a Decision event means, how to read a refusal, and how to match a ledger row to its transaction and rationale.
type: concept
audience: [watcher, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/IMandateVaultEvents.sol
  - contracts/src/Types.sol
  - web/content/decisions.ts
  - agent/src/ledger/journal.ts
next: [concepts/refusal-codes, guides/watch-decisions-onchain]
---
```

H2 outline: `The Decision event` · `Field by field` · `Reading a refusal` · `From a ledger row to its
reasoning` · `What a decision does not tell you`.
Must show: `<EventSignature name="Decision" />` (Task 5; renders `FACTS.decisionEvent`), a table of the
seven fields (name, type, indexed, meaning), the `Action` and `Reason` numbering (link to Types reference
and Refusal codes), the four fork-run rows as an example (render with `<ForkLedger />`, Task 5, which
reads `getDecisions()`), and that `rationaleHash` matches a journal line in `data/journal.jsonl`, which
only the agent's operator holds. Gas and the Builder Code are on the transaction, not in the event.

#### `get-started/status`

```yaml
---
title: Status and roadmap
description: What is built and fork-tested today, what is next before mainnet, and what is planned but not built, with what each step needs.
type: overview
audience: [newcomer, evaluator, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - deployments/README.md
  - docs/superpowers/specs/2026-11-07-maat-web-design.md
next: [security/not-claimed, guides/deploy-your-own-vault]
---
```

H2 outline: `What the three labels mean` · `Built and fork-tested` · `Next: mainnet` · `Planned, not built` ·
`How this page stays honest`.
Must show: the label legend (Fork-tested, Live on mainnet, Planned) using `<StatusBadge>`; a table from
README "Status" without test counts (component, status, where); "Next: mainnet" as the owner's checklist
(deploy, fund, executor to the CDP wallet, first real `Decision`), linking to Deploy your own vault; the
roadmap list from README "Roadmap" inside `<Callout type="note" title="Planned">`; the x402 price as
`<Fact name="x402Price" />` per check, planned.

---

### Task 8: Concepts, part 1

**Files:**
- Create: `web/content/docs/concepts/meta.json`
- Create: `web/content/docs/concepts/{mandate,nine-checks,refusal-codes,market-hours,prices-and-premium}.mdx`
- Modify: `web/test/docs-ia.test.ts`

**Interfaces:**
- Consumes: `<MandateTable>`, `<ReasonTable>`, `<MarketWeek>`, `<Fact>`, `<Callout>` (Tasks 3, 5).

`web/content/docs/concepts/meta.json` (Task 9 appends its four pages; the IA test checks the order):

```json
{
  "title": "Concepts",
  "pages": ["mandate", "nine-checks", "refusal-codes", "market-hours", "prices-and-premium"]
}
```

#### `concepts/mandate`

```yaml
---
title: The mandate
description: "Every field of the onchain mandate: what it limits, its default value and unit, why that value, and which check reads it."
type: concept
audience: [developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/Types.sol
  - contracts/script/MaatConfig.sol
  - contracts/script/Deploy.s.sol
  - contracts/src/MandateVault.sol
next: [concepts/nine-checks, guides/configure-a-mandate, concepts/timelock-and-roles]
---
```

H2 outline: `What the mandate is` · `The default mandate` · `Field by field` · `Per-token settings` ·
`Why these values` · `Changing it`.
Must show: `<MandateTable />`; one H3 per `Mandate` field and per `TokenConfig` field (`### sessionMode`,
…, `### maxWeightBps`) with meaning, unit, which check reads it, and the address fields (`calendar`,
`swapAdapter`, `creditAdapter`; `address(0)` disables credit); "Why these values": the measured premiums
(`<Fact name="premiumsBps.NVDAc" />` and the others) are why `maxPremiumBps` is
`<Fact name="mandate.maxPremiumBps" />`, and the de-risk window ends at the feed edge; changes only through
the timelock (`<Fact name="timelockHours" />`).

#### `concepts/nine-checks`

Write this page from the full MDX below (it is the model for the voice of every concept page).

````mdx
---
title: The nine checks
description: The order in which the vault checks a trade, what each check reads, and the reason code it returns when it fails.
type: concept
audience: [developer, evaluator, watcher]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MandateVault.sol
  - contracts/src/GuardLib.sol
  - contracts/src/lib/PriceLib.sol
  - contracts/test/MandateVault.t.sol
  - contracts/test/GuardLib.t.sol
next: [concepts/refusal-codes, concepts/market-hours, security/model]
---

Every `BUY` and `SELL` passes <Fact name="checksPerTrade" /> checks inside the vault, in a fixed order.
The first one that fails decides the [refusal code](/docs/concepts/refusal-codes), the vault records it
in a `Decision` event, and no funds move. Nothing the agent sends can skip a check: the vault runs them
itself, on every call to `execute`.

## The order

| # | Check | Refuses with | Where |
| --- | --- | --- | --- |
| · | The vault is not paused (every action except `REPAY`) | `VAULT_PAUSED` | `MandateVault._check` |
| 1 | The token is in the mandate | `TOKEN_NOT_ALLOWED` | `MandateVault._check` |
| 2 | The token's transfers are not paused | `TOKEN_PAUSED` | `GuardLib.tokenPaused` |
| 3 | Every leg of the transfer passes the B20 policy registry | `POLICY_BLOCKED` | `GuardLib.transferPathAuthorized` |
| 4 | The market is open for the mandate's session | `MARKET_CLOSED` | `GuardLib.marketOpen` |
| 5 | The oracle answer is positive and fresh | `FEED_STALE`, `BAD_PRICE` | `PriceLib.readFeed` |
| 6 | The token's multiplier is stable | `MULTIPLIER_COOLDOWN` | `GuardLib.multiplierBlocked` |
| 7 | The pool TWAP is close to the oracle | `PREMIUM_TOO_HIGH`, `BAD_PRICE` | `PriceLib.premiumBps` |
| · | The amount is non-zero and covered by the balance | `INSUFFICIENT_BALANCE` | `MandateVault._check` |
| 8 | The notional fits the per-trade and daily caps | `SIZE_LIMIT` | `MandateVault._withinCaps` |
| 9 | After a `BUY`, the stock's weight stays under its cap | `CONCENTRATION` | `MandateVault._weightAfterBuyBps` |

The market checks live in one function. (Copy the current lines 44 to 62 of `GuardLib.sol` into the
block below; the excerpt gate compares them with the file.)

```solidity title="contracts/src/GuardLib.sol#L44-L62"
    function checkMarket(MarketCheck memory c) internal view returns (Reason, uint256) {
```

## Why the order matters

Market reasons come first, so a refusal names the outside condition that blocked the trade, not a side
effect of it. On a Saturday the vault reports `MARKET_CLOSED`, not `FEED_STALE`, even though the feed
is also old by then. The balance check runs after the market checks for the same reason: an empty vault
on a holiday still reports the holiday.

## Each check

### 1. Token allowed
… (one H3 per check: what it reads, what makes it fail, the test that shows it, from the README table
"The nine checks". Keep each to three or four sentences.)

## After the checks pass

The vault swaps with a minimum output it computes itself from the oracle price and `maxSlippageBps`,
whatever `minOut` the agent sent. A swap or transfer that fails is recorded as `SWAP_FAILED` or
`TRANSFER_FAILED`, and `execute` still does not revert.

## Other actions

`PAY_EXPENSE`, `SUPPLY`, `WITHDRAW_COLLATERAL`, `BORROW` and `REPAY` run their own subsets.
… (the README paragraph "Other actions", split into a table: action, checks, works when closed?, works
when paused?)

## What the checks do not do

They do not judge whether a trade is a good idea. A trade inside every limit is allowed, even a bad one;
the limits bound how much a bad trade can cost. See [the threat model](/docs/security/threat-model).
````

Replace each "… (…)" instruction with the content it describes before you commit; the content gate
rejects a line that starts with `…` outside a code block.

#### `concepts/refusal-codes`

```yaml
---
title: Refusal codes
description: All refusal reasons the vault can record: what each means, which actions can return it, where it is raised and how the agent reacts.
type: reference
audience: [watcher, developer, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/Types.sol
  - contracts/src/MandateVault.sol
  - contracts/src/GuardLib.sol
  - agent/src/refusals.ts
  - web/content/reasons.ts
next: [get-started/read-a-decision, concepts/nine-checks]
---
```

H2 outline: `All codes` · `By group` (one H3 per group from `REASON_GROUPS`) · `How the agent reacts` ·
`Why the list only grows`.
Must show: `<ReasonTable />` (code, id, meaning, group); one H3 per code under its group
(`### MARKET_CLOSED`, …) so search finds it first, each with which actions can return it and where in the
code; "How the agent reacts" from `agent/src/refusals.ts` (which reasons it logs onchain once per UTC day,
which it only journals); "Why the list only grows": the enum is append-only (comment in `Types.sol`), so
an id never changes meaning; the count is `<Fact name="refusalCount" />`.

#### `concepts/market-hours`

```yaml
---
title: Market hours
description: How the onchain calendar decides the NYSE session in New York time, with daylight saving, holidays, early closes and the feed edge.
type: concept
audience: [developer, evaluator, watcher]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MarketCalendar.sol
  - contracts/src/lib/DateLib.sol
  - contracts/test/MarketCalendar.t.sol
next: [reference/market-calendar, concepts/credit-and-health-factor]
---
```

H2 outline: `Two session modes` · `New York time, onchain` · `Holidays and early closes` · `The feed edge` ·
`What happens if a holiday is missing`.
Must show: `<MarketWeek />` (Task 5); `REGULAR` open `<Fact name="nyseOpen" />` to `<Fact name="nyseClose" />`;
`FEED_24_5` from Sunday to Friday `<Fact name="feedEdge" />`; daylight saving computed onchain (`etOffsetSeconds`);
the preloaded holidays and early closes (`<Fact name="calendarPreload.holidays" />`, `<Fact name="calendarPreload.earlyCloses" />`,
early close at `<Fact name="earlyClose" />`); the calendar can only get stricter; the known limitation
from README (a missed holiday leaves only the staleness check).

#### `concepts/prices-and-premium`

```yaml
---
title: Prices and premium
description: How the vault reads Chainlink equity feeds and the Aerodrome pool TWAP, measures the premium between them and rejects stale prices.
type: concept
audience: [developer, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/lib/PriceLib.sol
  - contracts/src/GuardLib.sol
  - contracts/script/MaatConfig.sol
  - contracts/test/PriceLib.t.sol
  - contracts/test/fork/PriceLibFork.t.sol
next: [concepts/splits-and-multiplier, reference/base-addresses]
---
```

H2 outline: `Two prices` · `Staleness` · `The TWAP` · `Premium in basis points` · `Measured premiums` ·
`Slippage floor` · `Assumptions`.
Must show: the formula for the premium as `PriceLib` computes it (a titled excerpt of `premiumBps`), units
(bps, `<Fact name="mandate.twapWindowSec" />` window, `<Fact name="mandate.maxStalenessSec" />` staleness);
a table of the three measured premiums with `<Fact>`; the feed age at the fork block
(`<Fact name="feedAgeSec" />`); the assumption that the feed includes the multiplier (README "Known
limitations").

#### End-to-end checks for Task 8

The nine checks and the refusal codes are the first long pages, and the first that search must answer
(spec §1: a reason code in the first result). Between Steps 5 and 6 of the procedure:

- [ ] **Add the pages to the width checks.** In `web/e2e/docs.spec.ts`, change
  `const PAGES: string[] = ["/docs"];` to `const PAGES: string[] = ["/docs", "/docs/concepts/nine-checks"];`.
- [ ] **Append the concept page tests** to `web/e2e/docs.spec.ts`:

```ts
test.describe("concept pages", () => {
  test("\"nine\" lists The nine checks first", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("nine");
    await expect(dialog.getByRole("option").first()).toContainText("The nine checks");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/concepts\/nine-checks$/);
  });

  test("a reason code finds its entry first", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("MARKET_CLOSED");
    await expect(dialog.getByRole("option").first()).toContainText(/Refusal codes|MARKET_CLOSED/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/concepts\/refusal-codes(#market_closed)?$/);
  });

  test("a deep link loaded cold scrolls to its heading", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/docs/concepts/nine-checks#why-the-order-matters");
    await expect(page.locator("#why-the-order-matters")).toBeInViewport();
    await context.close();
  });

  test.describe("copy", () => {
    test.use({ permissions: ["clipboard-read", "clipboard-write"] });

    test("the copy button on a code block copies the code", async ({ page }) => {
      await page.goto("/docs/concepts/nine-checks", { waitUntil: "networkidle" });
      const figure = page.locator("figure").filter({ has: page.locator("pre", { hasText: "function checkMarket" }) });
      await figure.hover();
      await figure.getByRole("button", { name: /copy/i }).click();
      const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
      expect(text.trim()).toMatch(/^function checkMarket\(MarketCheck memory c\)/);
    });
  });
});
```

- [ ] **Run them.** `cd web && npx playwright test e2e/docs.spec.ts`. Expected: PASS. If another page
  comes first for `MARKET_CLOSED`, the refusal codes page is not answering the query: check that
  `### MARKET_CLOSED` is its own heading there and that the page title and description say "refusal".
  Never loosen the test.

Add `web/e2e/docs.spec.ts` to the commit in Step 7.

### Task 9: Concepts, part 2

**Files:**
- Create: `web/content/docs/concepts/{splits-and-multiplier,credit-and-health-factor,timelock-and-roles,treasury-loop}.mdx`
- Modify: `web/content/docs/concepts/meta.json` (append the four slugs in this order), `web/test/docs-ia.test.ts`

**Interfaces:**
- Consumes: `<TimelockFlow>`, `<TreasuryLoop>`, `<Fact>`, `<Callout>` (Tasks 3, 5).

#### `concepts/splits-and-multiplier`

```yaml
---
title: Splits and the multiplier
description: Why a change to a B20 token's uiMultiplier pauses trading in it, how the vault detects one, and why unreadable values fail closed.
type: concept
audience: [developer, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/GuardLib.sol
  - contracts/src/MandateVault.sol
  - contracts/src/interfaces/IB20Asset.sol
  - contracts/test/GuardLib.t.sol
next: [concepts/prices-and-premium, reference/mandate-vault]
---
```

H2 outline: `What the multiplier is` · `Why a change is dangerous` · `How the vault notices` · `The cooldown` ·
`Scheduled changes` · `Fail closed` · `Anyone can sync`.
Must show: `uiMultiplier` as a WAD number and the fork-block value (`<Fact name="nvdaUiMultiplier" />`);
the snapshot (`lastMultiplier`, `multiplierChangedAt`) and the `MultiplierChangeDetected` event;
`<Fact name="mandate.multiplierCooldownSec" />` cooldown; `effectiveAt` for a scheduled change; a reverting
read counts as blocked; `syncMultiplier` is open to anyone and only records state.

#### `concepts/credit-and-health-factor`

```yaml
---
title: Credit and the health factor
description: How the vault supplies stock to Aave V4, borrows USDC against it, and keeps the health factor above its floor before weekends.
type: concept
audience: [developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/adapters/AaveV4CreditAdapter.sol
  - contracts/src/adapters/ICreditAdapter.sol
  - contracts/src/MandateVault.sol
  - contracts/test/MandateVaultCredit.t.sol
  - contracts/test/fork/MandateVaultCreditFork.t.sol
next: [reference/adapters, guides/pause-withdraw-recover]
---
```

H2 outline: `The four credit actions` · `Health factor` · `The floor and the target` · `The de-risk window` ·
`What still works when the market is closed` · `Repay while paused` · `The adapter holds the position`.
Must show: a table of `SUPPLY`, `WITHDRAW_COLLATERAL`, `BORROW`, `REPAY` (what each checks, when each
works); `<Fact name="mandate.minHealthFactor" />` floor and `<Fact name="mandate.targetHealthFactor" />`
target; the window of `<Fact name="mandate.deriskWindowSec" />` before `<Fact name="feedEdge" />` on a
Friday or before a holiday, capped at `<Fact name="maxDeriskWindowHours" />` by the vault; the adapter's
own post-action check (`HealthFactorTooLow`); the fork evidence (supply and borrow gas with `<Fact>`).

#### `concepts/timelock-and-roles`

```yaml
---
title: Timelock and roles
description: "Who can do what: owner, executor and payees. How rule changes are queued, applied or cancelled, and what a leaked key can do."
type: concept
audience: [developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MandateVault.sol
  - contracts/test/MandateVaultAdmin.t.sol
  - contracts/test/fork/MandateVaultFork.t.sol
next: [guides/change-a-rule, security/threat-model]
---
```

H2 outline: `Three roles` · `What only the owner can do` · `What the executor can do` · `The timelock` ·
`Change hashes` · `Escape hatches` · `If a key leaks`.
Must show: `<TimelockFlow />`; a three-row role table (owner, executor, anyone: what each may call, by
group, with a link to [MandateVault](/docs/reference/mandate-vault) for the per-function list); queue → wait `<Fact name="timelockHours" />` → apply within `<Fact name="gracePeriodDays" />`
or expire; `cancelChange`; the change-hash functions; `setPaused`, `setExecutor`, `withdraw` are instant;
the leaked-executor table from README "Safety architecture" and the fork test
`test_compromisedExecutorIsBounded`.

#### `concepts/treasury-loop`

```yaml
---
title: The treasury loop
description: How the agent keeps its basket, supplies idle stock, borrows for runway and pays its own compute bill, and what is still planned.
type: concept
audience: [newcomer, watcher, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - agent/src/policy.ts
  - agent/src/loop/runOnce.ts
  - agent/src/loop/scheduler.ts
  - web/components/sections/TreasuryLoop.tsx
next: [guides/run-the-agent, concepts/credit-and-health-factor]
---
```

H2 outline: `Five steps` · `The basket` · `Runway and borrowing` · `Paying its own bill` · `Cadence` ·
`Planned: earning`.
Must show: `<TreasuryLoop />`; cash reserve `<Fact name="cashReservePct" />`, target weight
`<Fact name="targetWeightPct" />`, rebalance at `<Fact name="rebalanceDriftPct" />` drift; runway of
`<Fact name="runwayDays" />` of compute; the bill is paid once at least `<Fact name="billMinUsd" />` is owed;
cadence `<Fact name="loopMinutes" />` in session and `<Fact name="offSessionMinutes" />` outside;
`<Callout type="note" title="Planned">` for x402 revenue (`<Fact name="x402Price" />` per check).

---

### Task 10: Glossary and FAQ

**Files:**
- Create: `web/content/docs/help/meta.json`, `web/content/docs/help/{glossary,faq}.mdx`
- Modify: `web/test/docs-ia.test.ts`

`web/content/docs/help/meta.json` (Task 18 adds `troubleshooting` and `changelog`):

```json
{ "title": "Help", "pages": ["faq", "glossary"] }
```

#### `help/glossary`

```yaml
---
title: Glossary
description: Plain definitions of every term the docs use, from B20 and uiMultiplier to TWAP, health factor, Builder Code and the feed edge.
type: help
audience: [newcomer, watcher, developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - contracts/src/Types.sol
next: [get-started/what-is-maat, help/faq]
---
```

One H2 per letter that has terms, one H3 per term, alphabetical. Each H3's text is the term exactly as
other pages link it, so the anchor matches: `### TWAP` → `#twap`, `### Health factor` → `#health-factor`.
Terms (at least): Action, Aerodrome Slipstream, Aave V4, B20, Basis point (bps), Builder Code (ERC-8021),
CDP Server Wallet, Chainlink equity feed, Decision, De-risk window, Dry run, Executor, Fail closed,
Feed edge, Fork test, Health factor, Intent, Mandate, Mandate hash, Owner, Payee, Policy hash, Premium,
Preview, Reason, Refusal, Session mode, Slippage floor, Staleness, Timelock, TWAP, uiMultiplier, WAD,
x402. Each definition is one to three sentences and links to the concept page that explains it.
Before you commit, grep every page for `/docs/help/glossary#` and make sure each anchor has a term.

#### `help/faq`

```yaml
---
title: FAQ
description: Short answers to the questions people ask about Maat, from what it is to how it is tested, each linking to the page that proves it.
type: help
audience: [newcomer, watcher, developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
next: [get-started/quickstart, security/not-claimed]
---
```

H2 groups: `About Maat` · `Watching the agent` · `For developers` · `For builders` · `Trust and safety`.
Each question is an H3 phrased as the reader would ask it; each answer is two to four sentences and ends
with a link to the page that proves it. Include at least: Is Maat live? (no, fork-tested; Status) · Can
Claude move funds on its own? · What happens on a Saturday? · Why refuse instead of revert? · What if
the executor key is stolen? · Does it give investment advice? (no; disclaimer) · Can I run my own vault? ·
Is there an API or SDK? (no; what exists instead) · Has it been audited? (no) · How do I know the numbers
on the site are real? (facts and parity tests) · What does the agent cost to run? (dry run calls Claude:
about one cent per round, from README; render with plain words, not a dollar figure).


#### Phase 1 checkpoint

The learning path is complete. Before Task 11:

- [ ] **Run everything.** `cd web && npm run verify && npm run e2e`
  Expected: all PASS, with `out/ is ready to deploy (landing and 17 docs pages checked)`.
- [ ] **Check the landing page again.**
  `cd web && node ../.superpowers/docs-baseline/landing-compare.mjs ../.superpowers/docs-baseline/out out`
  Expected: `landing unchanged for a reader`, with `deltaGzip` near Task 1's figure (about 876).
- [ ] Nothing to commit unless a step needed a fix; commit a fix with a message that says what it fixes.

## Phase 2: build and reference

### Task 11: Generated reference data (`npm run docs:gen`)

The reference pages describe every public function, event, error and type, every Base address and every
agent setting. Typing those by hand would drift, so a script parses the sources into committed JSON, and
a test fails when the JSON is stale or when the parser disagrees with the ABI that `forge` compiled.

**Files:**
- Create: `web/lib/docs/sol-surface.ts` (parser, pure)
- Create: `web/lib/docs/docs-data.ts` (reads the repo, builds everything docs-gen writes)
- Create: `web/lib/docs/generated.ts` (typed access to the committed JSON, for components)
- Create: `web/scripts/docs-gen.ts` (CLI)
- Create: `web/content/generated/{contracts,base-addresses,agent}.json` (generated, committed)
- Create: `web/test/docs-gen.test.ts`
- Modify: `web/package.json` (`docs:gen` script)

**Interfaces:**
- Produces: `buildSurface(sources: readonly SolSource[]): SolSurface`; types `SolSurface`, `SolContract`,
  `SolFunction` (`name`, `kind: "function" | "getter"`, `visibility`, `params`, `returns`, `mutability`,
  `access`, `notice`), `SolEvent`, `SolError`, `SolEnum`, `SolStruct`, `SolParam`;
  `generateDocsData(root: string): DocsData` with `DocsData = { surface, addresses: BaseConstant[],
  agent: AgentData }`; `serialize(value): string`; `docsData: DocsData` from `@/lib/docs/generated`.
  Tasks 12, 13 and 14 use `docsData`.

The parser was written for this repo's forge-fmt sources and verified against them before this plan was
written: its output matches the compiled ABI of `MandateVault`, `MarketCalendar` and `ICreditAdapter`
exactly, and is identical for CRLF and LF checkouts.

- [ ] **Step 1: Write the failing test** `web/test/docs-gen.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateDocsData, parseAgentEnv, parseBaseAddresses, serialize } from "@/lib/docs/docs-data";
import { buildSurface, type SolContract } from "@/lib/docs/sol-surface";
import { readRepo, REPO_ROOT } from "./helpers/solidity";

const one = (text: string, name: string): SolContract => {
  const c = buildSurface([{ file: "contracts/src/X.sol", text }]).contracts.find((k) => k.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};

describe("buildSurface", () => {
  it("keeps external and public functions with their access, mutability, params, returns and notice", () => {
    const c = one(
      `contract V {
    address public immutable owner;
    modifier onlyOwner() { if (msg.sender != owner) revert(); _; }
    /// @notice Pauses it.
    /// @dev Not shown.
    function setPaused(bool p) external onlyOwner { paused = p; }
    function run(Intent calldata intent) external returns (bool allowed, Reason reason) {
        if (msg.sender != executor) revert NotExecutor();
    }
    function hash(Mandate memory m) public pure returns (bytes32) { return 0; }
    function _internal() internal view returns (uint256) { return 1; }
}`,
      "V",
    );
    expect(c.functions.map((f) => [f.name, f.kind, f.visibility, f.access, f.mutability])).toEqual([
      ["hash", "function", "public", "anyone", "pure"],
      ["owner", "getter", "public", "anyone", "view"],
      ["run", "function", "external", "executor", "nonpayable"],
      ["setPaused", "function", "external", "owner", "nonpayable"],
    ]);
    const run = c.functions.find((f) => f.name === "run");
    expect(run?.params).toEqual([{ type: "Intent", name: "intent" }]);
    expect(run?.returns).toEqual([
      { type: "bool", name: "allowed" },
      { type: "Reason", name: "reason" },
    ]);
    expect(c.functions.find((f) => f.name === "setPaused")?.notice).toBe("Pauses it.");
  });

  it("turns public mappings, arrays and constants into getters, and reads `=>` as a type, not an initializer", () => {
    const c = one(
      `contract S {
    uint256 public constant TIMELOCK = 24 hours;
    mapping(uint256 utcDay => uint256) public spentOnDay;
    mapping(address => mapping(address => bool)) public allowed;
    address[] public list;
    uint256 internal hidden;
}`,
      "S",
    );
    expect(c.functions.map((f) => [f.name, f.params.map((p) => `${p.type} ${p.name}`.trim()), f.returns[0]?.type])).toEqual([
      ["allowed", ["address", "address"], "bool"],
      ["list", ["uint256"], "address"],
      ["spentOnDay", ["uint256 utcDay"], "uint256"],
      ["TIMELOCK", [], "uint256"],
    ]);
  });

  it("gives a contract the events of the interfaces it inherits and the errors of the libraries it uses", () => {
    const s = buildSurface([
      { file: "contracts/src/E.sol", text: "interface IE {\n    event Done(bytes32 indexed id, bool ok);\n}" },
      { file: "contracts/src/L.sol", text: "library L {\n    error TransferFailed(address token);\n    function f() internal {}\n}" },
      { file: "contracts/src/V.sol", text: "contract V is IE {\n    using L for address;\n    error NotOwner();\n}" },
    ]);
    const v = s.contracts.find((c) => c.name === "V");
    expect(v?.events).toEqual([
      { name: "Done", notice: "", params: [{ type: "bytes32", name: "id", indexed: true }, { type: "bool", name: "ok" }] },
    ]);
    expect(v?.errors.map((e) => e.name)).toEqual(["NotOwner", "TransferFailed"]);
    expect(s.contracts.map((c) => c.name)).toEqual(["IE", "V"]); // libraries are not listed
  });

  it("reads file-level enums and structs, ignoring comments", () => {
    const s = buildSurface([
      {
        file: "contracts/src/Types.sol",
        text: "enum Side {\n    BUY, // first\n    SELL\n}\n/// @notice An order.\nstruct Order {\n    Side side;\n    uint256 amount; // raw\n}",
      },
    ]);
    expect(s.enums).toEqual([{ name: "Side", file: "contracts/src/Types.sol", members: ["BUY", "SELL"] }]);
    expect(s.structs).toEqual([
      {
        name: "Order",
        file: "contracts/src/Types.sol",
        notice: "An order.",
        fields: [
          { type: "Side", name: "side" },
          { type: "uint256", name: "amount" },
        ],
      },
    ]);
  });

  it("gives the same surface for CRLF and LF checkouts", () => {
    const lf = { file: "contracts/src/V.sol", text: "contract V {\n    /// @notice Hi.\n    function f(uint256 a) external view returns (uint256) {}\n}" };
    const crlf = { ...lf, text: lf.text.replace(/\n/g, "\r\n") };
    expect(buildSurface([crlf])).toEqual(buildSurface([lf]));
  });
});

/** The ABI the agent compiled from the same sources (agent/src/abi/generated.ts, written by forge). */
function agentAbi(name: string): { type: string; name?: string; stateMutability?: string; inputs?: { indexed?: boolean }[] }[] {
  const src = readRepo("agent/src/abi/generated.ts");
  const start = src.indexOf(`export const ${name} = `);
  if (start < 0) throw new Error(`${name} not in agent/src/abi/generated.ts`);
  const json = src.slice(start + `export const ${name} = `.length, src.indexOf(" as const;", start));
  return JSON.parse(json);
}

describe("parity with the compiled ABI", () => {
  const data = generateDocsData(REPO_ROOT);
  it.each([
    ["MandateVault", "mandateVaultAbi"],
    ["MarketCalendar", "marketCalendarAbi"],
    ["ICreditAdapter", "creditAdapterAbi"],
  ])("%s has exactly the ABI's functions, events and errors", (contract, abiName) => {
    const c = data.surface.contracts.find((k) => k.name === contract);
    if (!c) throw new Error(`${contract} missing from the generated surface`);
    const flags = (ps: readonly { indexed?: boolean }[]) => ps.map((p) => (p.indexed ? "i" : "-")).join("");
    const ours = [
      ...c.functions.map((f) => `function ${f.name}/${f.params.length} ${f.mutability}`),
      ...c.events.map((e) => `event ${e.name}/${e.params.length} ${flags(e.params)}`),
      ...c.errors.map((e) => `error ${e.name}/${e.params.length}`),
    ].sort();
    const abi = agentAbi(abiName)
      .filter((e) => e.type !== "constructor")
      .map((e) => {
        const n = `${e.type} ${e.name}/${e.inputs?.length ?? 0}`;
        if (e.type === "function") return `${n} ${e.stateMutability}`;
        return e.type === "event" ? `${n} ${flags(e.inputs ?? [])}` : n;
      })
      .sort();
    expect(ours).toEqual(abi);
  });
});

describe("committed data is current", () => {
  const data = generateDocsData(REPO_ROOT);
  it.each([
    ["web/content/generated/contracts.json", data.surface],
    ["web/content/generated/base-addresses.json", data.addresses],
    ["web/content/generated/agent.json", data.agent],
  ] as const)("%s matches the sources (run `npm run docs:gen` in web/ if this fails)", (file, value) => {
    expect(readRepo(file).replace(/\r\n/g, "\n")).toBe(serialize(value));
  });
});

describe("parseAgentEnv", () => {
  const config = [
    "const schema = z",
    "  .object({",
    '    BASE_RPC_URL: field(z.string({ error: "BASE_RPC_URL is required" }).pipe(z.url())),',
    '    MAAT_VAULT: address("MAAT_VAULT"),',
    '    MAAT_MODE: field(z.enum(["dry-run", "live"]).default("dry-run")),',
    "    MAAT_BUILDER_CODE: field(z.string().min(1).optional()),",
    "    MAAT_MAX_TX_PER_DAY: field(z.coerce.number().int().positive().default(40)),",
    "  })",
  ].join("\n");
  const example = [
    "# RPC for Base mainnet.",
    "BASE_RPC_URL=https://mainnet.base.org",
    "MAAT_VAULT=0x0000000000000000000000000000000000000000",
    "# dry-run (default) or live.",
    "MAAT_MODE=dry-run",
    "MAAT_BUILDER_CODE=",
    "MAAT_MAX_TX_PER_DAY=40",
    "# Anthropic API key (the SDK reads it).",
    "ANTHROPIC_API_KEY=",
  ].join("\r\n");

  it("joins each example key with its comment and how config.ts treats it", () => {
    expect(parseAgentEnv(example, config).map((v) => [v.name, v.readBy, v.default, v.required, v.note])).toEqual([
      ["BASE_RPC_URL", "agent", null, true, "RPC for Base mainnet."],
      ["MAAT_VAULT", "agent", null, true, ""],
      ["MAAT_MODE", "agent", "dry-run", false, "dry-run (default) or live."],
      ["MAAT_BUILDER_CODE", "agent", null, false, ""],
      ["MAAT_MAX_TX_PER_DAY", "agent", "40", false, ""],
      ["ANTHROPIC_API_KEY", "sdk", null, false, "Anthropic API key (the SDK reads it)."],
    ]);
  });

  it("every key config.ts validates is in agent/.env.example", () => {
    const source = readRepo("agent/src/config.ts");
    const validated = [...source.matchAll(/^\s{4}([A-Z0-9_]+): /gm)].map((m) => m[1]);
    const documented = generateDocsData(REPO_ROOT).agent.env.map((v) => v.name);
    expect(validated.length).toBeGreaterThan(0);
    for (const name of validated) expect(documented, name).toContain(name);
  });
});

describe("parseBaseAddresses", () => {
  it("reads every constant with the note above it", () => {
    const parsed = parseBaseAddresses(
      "library B {\n    /// Pools, token0 = USDC.\n    address internal constant POOL = 0xAbC;\n    uint256 internal constant BLOCK = 53_551_627;\n}",
    );
    expect(parsed).toEqual([
      { name: "POOL", type: "address", value: "0xAbC", note: "Pools, token0 = USDC." },
      { name: "BLOCK", type: "uint256", value: "53_551_627", note: "" },
    ]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**
  Run: `cd web && npx vitest run test/docs-gen.test.ts`
  Expected: FAIL: `Failed to resolve import "@/lib/docs/docs-data"`.

- [ ] **Step 3: Write the parser** `web/lib/docs/sol-surface.ts`:

```ts
/**
 * The public surface of the Solidity sources: contracts, their external and public functions (including the
 * getters Solidity generates for public state), events, errors, enums and structs. Built for this repo's
 * forge-fmt formatted sources, and cross-checked against the agent's compiled ABI by test/docs-gen.test.ts.
 */

export interface SolParam {
  readonly type: string;
  readonly name: string;
  readonly indexed?: boolean;
}

export type Mutability = "nonpayable" | "payable" | "view" | "pure";

export interface SolFunction {
  readonly name: string;
  /** "function" for declared functions, "getter" for public state variables and constants. */
  readonly kind: "function" | "getter";
  /** As declared; getters are always public. */
  readonly visibility: "external" | "public";
  readonly params: readonly SolParam[];
  readonly returns: readonly SolParam[];
  readonly mutability: Mutability;
  /** Who may call it: "anyone", or the role a modifier or first-line check enforces ("owner", "executor", "vault"). */
  readonly access: string;
  readonly notice: string;
}

export interface SolEvent {
  readonly name: string;
  readonly params: readonly SolParam[];
  readonly notice: string;
}

export interface SolError {
  readonly name: string;
  readonly params: readonly SolParam[];
  readonly notice: string;
}

export interface SolEnum {
  readonly name: string;
  readonly file: string;
  readonly members: readonly string[];
}

export interface SolStruct {
  readonly name: string;
  readonly file: string;
  readonly fields: readonly SolParam[];
  readonly notice: string;
}

export interface SolContract {
  readonly name: string;
  readonly kind: "contract" | "interface" | "library";
  /** Repo-relative path of the defining file. */
  readonly file: string;
  readonly notice: string;
  readonly functions: readonly SolFunction[];
  readonly events: readonly SolEvent[];
  readonly errors: readonly SolError[];
}

export interface SolSurface {
  readonly contracts: readonly SolContract[];
  readonly enums: readonly SolEnum[];
  readonly structs: readonly SolStruct[];
}

export interface SolSource {
  /** Repo-relative path, e.g. "contracts/src/MandateVault.sol". */
  readonly file: string;
  readonly text: string;
}

/** Same length as the input, comments replaced by spaces, so offsets still line up with the original. */
function blankComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
}

/** The `///` lines (and the single-line text of `/** *\/` blocks) directly above `offset`, without NatSpec tags. */
function natspecAbove(original: string, offset: number): string {
  const lines = original.slice(0, offset).split("\n");
  lines.pop(); // the declaration's own line
  const doc: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (!line.startsWith("///")) break;
    doc.unshift(line.slice(3).trim());
  }
  return doc
    .filter((l) => !l.startsWith("@dev") && !l.startsWith("@param") && !l.startsWith("@return"))
    .map((l) => l.replace(/^@(notice|title)\s+/, ""))
    .join(" ")
    .trim();
}

/** Index of the bracket that closes the one at `open`. */
function matching(src: string, open: number, pair: "()" | "{}"): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === pair[0]) depth++;
    else if (src[i] === pair[1] && --depth === 0) return i;
  }
  throw new Error(`unbalanced ${pair} at offset ${open}`);
}

/** Split on commas that are not inside parentheses (mapping types contain none here, but tuples might). */
function splitTop(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const LOCATIONS = new Set(["memory", "calldata", "storage"]);

function params(list: string): SolParam[] {
  return splitTop(list).map((p) => {
    const words = p.split(/\s+/).filter((w) => !LOCATIONS.has(w));
    const indexed = words.includes("indexed");
    const rest = words.filter((w) => w !== "indexed");
    const type = rest[0] ?? "";
    const name = rest.length > 1 ? (rest[rest.length - 1] ?? "") : "";
    return indexed ? { type, name, indexed } : { type, name };
  });
}

interface Decl {
  /** Text before the body or the terminating semicolon, whitespace collapsed. */
  readonly head: string;
  /** Body text between braces, if the declaration has one. */
  readonly body?: string;
  readonly offset: number;
}

/** Top-level declarations inside a contract body (or a whole file): whatever ends in `;` or a `{...}` block. */
function declarations(code: string, start: number, end: number): Decl[] {
  const out: Decl[] = [];
  let headStart = start;
  for (let i = start; i < end; i++) {
    const ch = code[i];
    if (ch === "{") {
      const close = matching(code, i, "{}");
      out.push({ head: code.slice(headStart, i), body: code.slice(i + 1, close), offset: headStart });
      i = close;
      headStart = close + 1;
    } else if (ch === ";") {
      out.push({ head: code.slice(headStart, i), offset: headStart });
      headStart = i + 1;
    }
  }
  return out.map((d) => {
    const lead = d.head.length - d.head.trimStart().length;
    return { ...d, head: d.head.replace(/\s+/g, " ").trim(), offset: d.offset + lead };
  });
}

const VISIBILITY = new Set(["external", "public", "internal", "private"]);
const MUTABILITY = new Set(["view", "pure", "payable"]);
const NOT_MODIFIERS = new Set([...VISIBILITY, ...MUTABILITY, "virtual", "override", "returns"]);

/** Role named by a modifier such as onlyOwner, or by a first statement `if (msg.sender != owner) revert ...`. */
function accessOf(modifiers: readonly string[], body: string | undefined): string {
  const only = modifiers.find((m) => /^only[A-Z]/.test(m));
  if (only) return only.slice(4, 5).toLowerCase() + only.slice(5);
  const first = /^\s*if\s*\(\s*msg\.sender\s*!=\s*(\w+)\s*\)\s*revert/.exec(body ?? "");
  return first?.[1] ?? "anyone";
}

function parseFunction(d: Decl, notice: string): SolFunction | undefined {
  const m = /^function (\w+)\s*\(/.exec(d.head);
  if (!m?.[1]) return undefined;
  const open = d.head.indexOf("(");
  const close = matching(d.head, open, "()");
  const tail = d.head.slice(close + 1);
  const retAt = tail.search(/\breturns\s*\(/);
  const words = (retAt >= 0 ? tail.slice(0, retAt) : tail).split(/\s+/).filter(Boolean);
  const visibility = words.find((w) => VISIBILITY.has(w));
  if (visibility !== "external" && visibility !== "public") return undefined;
  let returns: SolParam[] = [];
  if (retAt >= 0) {
    const rOpen = tail.indexOf("(", retAt);
    returns = params(tail.slice(rOpen + 1, matching(tail, rOpen, "()")));
  }
  const modifiers = words.filter((w) => !NOT_MODIFIERS.has(w) && /^\w+$/.test(w));
  return {
    name: m[1],
    kind: "function",
    visibility,
    params: params(d.head.slice(open + 1, close)),
    returns,
    mutability: (words.find((w) => MUTABILITY.has(w)) as Mutability | undefined) ?? "nonpayable",
    access: accessOf(modifiers, d.body),
    notice,
  };
}

/** `mapping(address => mapping(uint256 day => uint256))` → keys [address, uint256], value uint256. */
function unwrapMapping(type: string): { keys: SolParam[]; value: string } {
  const keys: SolParam[] = [];
  let t = type.trim();
  while (t.startsWith("mapping")) {
    const open = t.indexOf("(");
    const inner = t.slice(open + 1, matching(t, open, "()"));
    const arrow = inner.indexOf("=>");
    const [keyType = "", keyName = ""] = inner.slice(0, arrow).trim().split(/\s+/);
    keys.push({ type: keyType, name: keyName });
    t = inner.slice(arrow + 2).trim();
    // A named value (`=> uint256 amount`) keeps only its type.
    if (!t.startsWith("mapping")) t = t.split(/\s+/)[0] ?? t;
  }
  return { keys, value: t };
}

function parseGetter(d: Decl, notice: string): SolFunction | undefined {
  if (d.body !== undefined || !/\bpublic\b/.test(d.head)) return undefined;
  if (/^(function|event|error|modifier|constructor|using|struct|enum)\b/.test(d.head)) return undefined;
  // The initializer's `=`, not the `=>` of a mapping type.
  const lhs = d.head.split(/=(?!>)/)[0]?.trim() ?? "";
  const nameMatch = /(\w+)$/.exec(lhs);
  if (!nameMatch?.[1]) return undefined;
  const typePart = lhs
    .slice(0, lhs.length - nameMatch[1].length)
    .replace(/\b(public|constant|immutable)\b/g, "")
    .trim();
  const { keys, value } = unwrapMapping(typePart);
  const arrays = value.match(/\[\]/g)?.length ?? 0;
  const indexParams = Array.from({ length: arrays }, () => ({ type: "uint256", name: "" }));
  return {
    name: nameMatch[1],
    kind: "getter",
    visibility: "public",
    params: [...keys, ...indexParams],
    returns: [{ type: value.replace(/\[\]/g, ""), name: "" }],
    // Solidity reports getters of constants as view too.
    mutability: "view",
    access: "anyone",
    notice,
  };
}

function parseSignature(d: Decl, keyword: "event" | "error", notice: string) {
  const m = new RegExp(`^${keyword} (\\w+)\\s*\\(`).exec(d.head);
  if (!m?.[1]) return undefined;
  const open = d.head.indexOf("(");
  return { name: m[1], params: params(d.head.slice(open + 1, matching(d.head, open, "()"))), notice };
}

interface RawContract extends SolContract {
  readonly bases: readonly string[];
  readonly libraries: readonly string[];
}

function parseFile(src: SolSource, enums: SolEnum[], structs: SolStruct[]): RawContract[] {
  const code = blankComments(src.text);
  const out: RawContract[] = [];
  const collectTypes = (decls: Decl[]) => {
    for (const d of decls) {
      const e = /^enum (\w+)$/.exec(d.head);
      if (e?.[1] && d.body !== undefined) {
        enums.push({ name: e[1], file: src.file, members: d.body.split(",").map((s) => s.trim()).filter(Boolean) });
      }
      const s = /^struct (\w+)$/.exec(d.head);
      if (s?.[1] && d.body !== undefined) {
        const fields = declarations(d.body, 0, d.body.length).map((f) => params(f.head)[0]!);
        structs.push({ name: s[1], file: src.file, fields, notice: natspecAbove(src.text, d.offset) });
      }
    }
  };
  const fileDecls = declarations(code, 0, code.length);
  collectTypes(fileDecls);
  for (const d of fileDecls) {
    const m = /^(?:abstract )?(contract|interface|library) (\w+)(?: is (.+))?$/.exec(d.head);
    if (!m?.[1] || !m[2] || d.body === undefined) continue;
    const bodyStart = code.indexOf("{", d.offset) + 1;
    const decls = declarations(code, bodyStart, bodyStart + d.body.length);
    if (m[1] !== "library") collectTypes(decls);
    const notice = (d2: Decl) => natspecAbove(src.text, d2.offset);
    const functions: SolFunction[] = [];
    const events: SolEvent[] = [];
    const errors: SolError[] = [];
    const libraries: string[] = [];
    for (const x of decls) {
      const fn = parseFunction(x, notice(x)) ?? parseGetter(x, notice(x));
      if (fn) functions.push(fn);
      const ev = parseSignature(x, "event", notice(x));
      if (ev) events.push(ev);
      const er = parseSignature(x, "error", notice(x));
      if (er) errors.push(er);
      const lib = /^using (\w+) for /.exec(x.head);
      if (lib?.[1]) libraries.push(lib[1]);
    }
    out.push({
      name: m[2],
      kind: m[1] as SolContract["kind"],
      file: src.file,
      notice: natspecAbove(src.text, d.offset),
      functions,
      events,
      errors,
      bases: m[3] ? m[3].split(",").map((b) => b.trim()) : [],
      libraries,
    });
  }
  return out;
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/**
 * Parse every source, then give each contract what the ABI would show: the events, errors and functions of
 * the interfaces it inherits, and the errors of the libraries it attaches with `using`. Library internals and
 * internal functions are left out. Output is sorted by name so it is stable across edits that only reorder.
 */
export function buildSurface(sources: readonly SolSource[]): SolSurface {
  const enums: SolEnum[] = [];
  const structs: SolStruct[] = [];
  const raw = sources.flatMap((s) => parseFile(s, enums, structs));
  const find = (name: string) => raw.find((c) => c.name === name);

  const resolve = (c: RawContract, seen = new Set<string>()): Omit<SolContract, "name" | "kind" | "file" | "notice"> => {
    const functions = new Map(c.functions.map((f) => [f.name, f]));
    const events = new Map(c.events.map((e) => [e.name, e]));
    const errors = new Map(c.errors.map((e) => [e.name, e]));
    for (const baseName of c.bases) {
      const base = find(baseName);
      if (!base || seen.has(baseName)) continue;
      const r = resolve(base, new Set([...seen, baseName]));
      // The derived contract's own declaration (with its access and notice) wins over the interface's.
      for (const f of r.functions) if (!functions.has(f.name)) functions.set(f.name, f);
      for (const e of r.events) if (!events.has(e.name)) events.set(e.name, e);
      for (const e of r.errors) if (!errors.has(e.name)) errors.set(e.name, e);
    }
    for (const libName of c.libraries) {
      for (const e of find(libName)?.errors ?? []) if (!errors.has(e.name)) errors.set(e.name, e);
    }
    return {
      functions: [...functions.values()].sort(byName),
      events: [...events.values()].sort(byName),
      errors: [...errors.values()].sort(byName),
    };
  };

  const contracts = raw
    .filter((c) => c.kind !== "library")
    .map((c) => ({ name: c.name, kind: c.kind, file: c.file, notice: c.notice, ...resolve(c) }))
    .sort(byName);
  return { contracts, enums: enums.sort(byName), structs: structs.sort(byName) };
}
```

- [ ] **Step 4: Write the repo reader** `web/lib/docs/docs-data.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildSurface, type SolSource, type SolSurface } from "./sol-surface";

/** Maat's own contracts and interfaces; third-party interfaces (Aave, Chainlink, B20, ERC-20) are left out. */
export const DOCUMENTED_CONTRACTS = [
  "MandateVault",
  "IMandateVaultEvents",
  "MarketCalendar",
  "ISwapAdapter",
  "AerodromeSwapAdapter",
  "ICreditAdapter",
  "AaveV4CreditAdapter",
] as const;

const TYPES_FILE = "contracts/src/Types.sol";
const ADDRESSES_FILE = "contracts/script/BaseAddresses.sol";

export interface BaseConstant {
  readonly name: string;
  readonly type: "address" | "uint256";
  readonly value: string;
  readonly note: string;
}

export interface AgentEnvVar {
  readonly name: string;
  /** The value in agent/.env.example: an example or an empty placeholder, never a secret. */
  readonly example: string;
  /** The `#` comment lines directly above it in agent/.env.example. */
  readonly note: string;
  /** "agent" when agent/src/config.ts validates it; "sdk" when a library (Anthropic, CDP) reads it itself. */
  readonly readBy: "agent" | "sdk";
  /** The default config.ts applies when it is unset or empty, as written in the source. */
  readonly default: string | null;
  /** config.ts rejects a missing value in every mode. */
  readonly required: boolean;
}

export interface AgentScript {
  readonly name: string;
  readonly command: string;
}

export interface AgentData {
  readonly env: readonly AgentEnvVar[];
  /** `npm run <name>` scripts in agent/package.json. */
  readonly scripts: readonly AgentScript[];
  /** Files in agent/scripts, run with tsx or by an npm script. */
  readonly scriptFiles: readonly string[];
}

export interface DocsData {
  readonly surface: SolSurface;
  readonly addresses: readonly BaseConstant[];
  readonly agent: AgentData;
}

/** agent/.env.example joined with how agent/src/config.ts treats each key. */
export function parseAgentEnv(envExample: string, configSource: string): AgentEnvVar[] {
  const out: AgentEnvVar[] = [];
  let note: string[] = [];
  for (const raw of envExample.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#")) {
      note.push(line.slice(1).trim());
      continue;
    }
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) {
      const decl = new RegExp(`^\\s*${m[1]}: (.+),\\s*$`, "m").exec(configSource)?.[1];
      const def = decl === undefined ? null : (/\.default\(("?)([^)"]*)\1\)/.exec(decl)?.[2] ?? null);
      out.push({
        name: m[1],
        example: m[2].trim(),
        note: note.join(" "),
        readBy: decl === undefined ? "sdk" : "agent",
        default: def,
        required: decl !== undefined && def === null && !decl.includes(".optional()"),
      });
    }
    note = [];
  }
  return out;
}

function solFiles(root: string, dir: string): SolSource[] {
  return readdirSync(join(root, dir)).flatMap((f): SolSource[] => {
    const rel = `${dir}/${f}`;
    if (statSync(join(root, rel)).isDirectory()) return solFiles(root, rel);
    return f.endsWith(".sol") ? [{ file: rel, text: readFileSync(join(root, rel), "utf8") }] : [];
  });
}

/** `/// note` lines directly above each `address|uint256 internal constant NAME = value;`. */
export function parseBaseAddresses(text: string): BaseConstant[] {
  const out: BaseConstant[] = [];
  let note: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("///")) {
      note.push(line.slice(3).replace(/^\s*@notice\s+/, "").trim());
      continue;
    }
    const m = /^(address|uint256) internal constant (\w+) = ([^;]+);/.exec(line);
    if (m?.[1] && m[2] && m[3]) {
      out.push({ name: m[2], type: m[1] as BaseConstant["type"], value: m[3].trim(), note: note.join(" ") });
    }
    note = [];
  }
  return out;
}

/** Everything docs-gen writes, built from the repo at `root`. Pure apart from reading the sources. */
export function generateDocsData(root: string): DocsData {
  const read = (rel: string) => readFileSync(join(root, rel), "utf8");
  const full = buildSurface(solFiles(root, "contracts/src"));
  const keep = new Set<string>(DOCUMENTED_CONTRACTS);
  return {
    surface: {
      contracts: full.contracts.filter((c) => keep.has(c.name)),
      enums: full.enums.filter((e) => e.file === TYPES_FILE),
      structs: full.structs.filter((s) => s.file === TYPES_FILE),
    },
    addresses: parseBaseAddresses(read(ADDRESSES_FILE)),
    agent: {
      env: parseAgentEnv(read("agent/.env.example"), read("agent/src/config.ts")),
      scripts: Object.entries(JSON.parse(read("agent/package.json")).scripts as Record<string, string>).map(
        ([name, command]) => ({ name, command }),
      ),
      scriptFiles: readdirSync(join(root, "agent/scripts"))
        .filter((f) => f.endsWith(".ts"))
        .sort(),
    },
  };
}

/** JSON as committed: two-space indent and a trailing newline, so the sync test compares text exactly. */
export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
```

- [ ] **Step 5: Write the CLI** `web/scripts/docs-gen.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateDocsData, serialize } from "../lib/docs/docs-data";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OUT = fileURLToPath(new URL("../content/generated/", import.meta.url));

const data = generateDocsData(ROOT);
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}contracts.json`, serialize(data.surface));
writeFileSync(`${OUT}base-addresses.json`, serialize(data.addresses));
writeFileSync(`${OUT}agent.json`, serialize(data.agent));
console.log(
  `content/generated: ${data.surface.contracts.length} contracts, ${data.addresses.length} addresses, ${data.agent.env.length} settings`,
);
```

and in `web/package.json` `scripts`, after `"check:out"`:

```json
    "docs:gen": "tsx scripts/docs-gen.ts",
```

- [ ] **Step 6: Generate the data.**
  Run: `cd web && npm run docs:gen`
  Expected: `content/generated: 7 contracts, 20 addresses, 15 settings`.

- [ ] **Step 7: Write typed access for components** `web/lib/docs/generated.ts`:

```ts
import agent from "@/content/generated/agent.json";
import addresses from "@/content/generated/base-addresses.json";
import contracts from "@/content/generated/contracts.json";
import type { AgentData, BaseConstant, DocsData } from "./docs-data";
import type { SolSurface } from "./sol-surface";

/** The committed output of `npm run docs:gen`; test/docs-gen.test.ts keeps it in sync with the sources. */
export const docsData: DocsData = {
  surface: contracts as SolSurface,
  addresses: addresses as readonly BaseConstant[],
  agent: agent as AgentData,
};
```

- [ ] **Step 8: Run the tests and the typecheck.**
  Run: `cd web && npx vitest run test/docs-gen.test.ts && npm run typecheck`
  Expected: PASS (14 tests) and no type errors.

- [ ] **Step 9: Prove the sync test bites.** Temporarily add a function to a copy of the data:
  edit `web/content/generated/contracts.json`, rename `"queueMandate"` to `"queueMandateX"`, run
  `npx vitest run test/docs-gen.test.ts`: expect the "committed data is current" test to FAIL with a
  diff showing the name. Run `npm run docs:gen` to restore it, run the test again: PASS.

- [ ] **Step 10: Commit.**

```bash
git add web/lib/docs/sol-surface.ts web/lib/docs/docs-data.ts web/lib/docs/generated.ts web/scripts/docs-gen.ts web/content/generated web/test/docs-gen.test.ts web/package.json
git commit -m "feat(web): generate contract, address and agent reference data from the sources"
```

### Task 12: Reference components

The reference pages are prose around generated entries: `<Fn contract="MandateVault" name="queueMandate" />`
renders the signature, who may call it and whether it changes state, straight from `contracts.json`. A
name that does not exist throws while the page renders, so a typo fails `npm run build`, and Task 13's
coverage test fails when an item has no entry.

**Files:**
- Create: `web/lib/docs/signatures.ts`
- Create: `web/test/signatures.test.ts`
- Create: `web/components/docs/reference.tsx`
- Create: `web/test/docs-reference.test.tsx`
- Modify: `web/components/docs/mdx.tsx` (register the components)

**Interfaces:**
- Consumes: `docsData` (`@/lib/docs/generated`, Task 11), types `SolContract`, `SolFunction`, `SolEvent`,
  `SolError`, `SolParam`, `SolSurface`, `Mutability` (`@/lib/docs/sol-surface`, Task 11); `factFor`,
  `FactName` (`@/lib/docs/fact-text`, Task 3); `SITE` (`@/lib/site`).
- Produces (MDX components, every attribute a plain string unless noted):
  `<FunctionIndex contract qualify? />` (`qualify` is a boolean: anchors become `name-contract`, for pages
  whose H3s read `name (Contract)`), `<Fn contract name />`, `<EventEntry contract name />`,
  `<ErrorEntry contract name />`, `<TypeEntry name />`, `<EnvTable />`, `<EnvVar name />`,
  `<ScriptEntry name />`, `<ScriptFile name />`, `<AddressTable />`, `<FactTable names={[...]} />`;
  `headingId(text): string` (the id Fumadocs gives a heading); `functionSignature`, `eventSignature`,
  `errorSignature`, `accessLabel`, `findContract`, `findItem` from `@/lib/docs/signatures`.

- [ ] **Step 1: Write the failing signature test** `web/test/signatures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { docsData } from "@/lib/docs/generated";
import { accessLabel, errorSignature, eventSignature, findItem, functionSignature } from "@/lib/docs/signatures";

const s = docsData.surface;

describe("signatures from the generated surface", () => {
  it("writes functions with mutability and returns", () => {
    expect(functionSignature(findItem(s, "MandateVault", "functions", "queueMandate"))).toBe(
      "function queueMandate(Mandate m) external returns (bytes32 changeHash)",
    );
    expect(functionSignature(findItem(s, "MandateVault", "functions", "previewIntent"))).toBe(
      "function previewIntent(Intent intent) external view returns (Reason reason)",
    );
    expect(functionSignature(findItem(s, "MandateVault", "functions", "spentOnDay"))).toBe(
      "function spentOnDay(uint256 utcDay) public view returns (uint256)",
    );
  });

  it("writes events with indexed params, and errors", () => {
    expect(eventSignature(findItem(s, "MandateVault", "events", "Decision"))).toBe(
      "event Decision(bytes32 indexed intentId, Action action, address indexed token, uint256 amount, bool allowed, Reason reason, bytes32 rationaleHash)",
    );
    expect(errorSignature(findItem(s, "MandateVault", "errors", "ChangeNotReady"))).toBe(
      "error ChangeNotReady(bytes32 changeHash, uint256 eta)",
    );
  });

  it("labels access and names a missing item", () => {
    expect(accessLabel("owner")).toBe("Owner only");
    expect(accessLabel("anyone")).toBe("Anyone");
    expect(() => findItem(s, "MandateVault", "functions", "rugPull")).toThrow("MandateVault has no function named rugPull");
    expect(() => findItem(s, "Nope", "events", "X")).toThrow("contract Nope is not in");
  });
});
```

- [ ] **Step 2: Run it and see it fail.**
  Run: `cd web && npx vitest run test/signatures.test.ts`
  Expected: FAIL: `Failed to resolve import "@/lib/docs/signatures"`.

- [ ] **Step 3: Write** `web/lib/docs/signatures.ts`:

```ts
import type { SolContract, SolError, SolEvent, SolFunction, SolParam, SolSurface } from "./sol-surface";

const param = (p: SolParam) => [p.type, p.indexed ? "indexed" : "", p.name].filter(Boolean).join(" ");
const list = (ps: readonly SolParam[]) => ps.map(param).join(", ");

/** `function queueMandate(Mandate m) external returns (bytes32 changeHash)`, as a reader would write it. */
export function functionSignature(f: SolFunction): string {
  const mut = f.mutability === "nonpayable" ? "" : ` ${f.mutability}`;
  const ret = f.returns.length > 0 ? ` returns (${list(f.returns)})` : "";
  return `function ${f.name}(${list(f.params)}) ${f.visibility}${mut}${ret}`;
}

export function eventSignature(e: SolEvent): string {
  return `event ${e.name}(${list(e.params)})`;
}

export function errorSignature(e: SolError): string {
  return `error ${e.name}(${list(e.params)})`;
}

/** Who may call it, for a chip: "Owner only", "Executor only", "Vault only" or "Anyone". */
export function accessLabel(access: string): string {
  return access === "anyone" ? "Anyone" : `${access.charAt(0).toUpperCase()}${access.slice(1)} only`;
}

export function findContract(surface: SolSurface, name: string): SolContract {
  const c = surface.contracts.find((k) => k.name === name);
  if (!c) throw new Error(`contract ${name} is not in content/generated/contracts.json (run npm run docs:gen)`);
  return c;
}

/** One item of a contract by name; throws so a typo in an MDX entry fails the build. */
export function findItem<K extends "functions" | "events" | "errors">(
  surface: SolSurface,
  contract: string,
  kind: K,
  name: string,
): SolContract[K][number] {
  const item = findContract(surface, contract)[kind].find((x) => x.name === name);
  if (!item) throw new Error(`${contract} has no ${kind.slice(0, -1)} named ${name}`);
  return item as SolContract[K][number];
}
```

- [ ] **Step 4: Run it.** `cd web && npx vitest run test/signatures.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing component test** `web/test/docs-reference.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  AddressTable,
  EnvTable,
  EnvVar,
  ErrorEntry,
  EventEntry,
  FactTable,
  Fn,
  FunctionIndex,
  ScriptEntry,
  ScriptFile,
  TypeEntry,
} from "@/components/docs/reference";
import { FACTS } from "@/content/facts";
import { docsData } from "@/lib/docs/generated";
import { headingId } from "@/lib/docs/links";

describe("contract entries", () => {
  it("Fn shows the signature, who may call it and whether it changes state", () => {
    render(<Fn contract="MandateVault" name="queueMandate" />);
    expect(screen.getByText("function queueMandate(Mandate m) external returns (bytes32 changeHash)")).toBeInTheDocument();
    expect(screen.getByText("Owner only")).toBeInTheDocument();
    expect(screen.getByText("Changes state")).toBeInTheDocument();
  });

  it("Fn marks public state variables", () => {
    render(<Fn contract="MandateVault" name="spentOnDay" />);
    expect(screen.getByText("function spentOnDay(uint256 utcDay) public view returns (uint256)")).toBeInTheDocument();
    expect(screen.getByText("Public state")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
  });

  it("an unknown name throws, so a typo in a page fails the build", () => {
    expect(() => Fn({ contract: "MandateVault", name: "rugPull" })).toThrow("MandateVault has no function named rugPull");
    expect(() => TypeEntry({ name: "Order" })).toThrow("type Order is not in content/generated/contracts.json");
    expect(() => EnvVar({ name: "MAAT_NOPE" })).toThrow("MAAT_NOPE is not in agent/.env.example");
    expect(() => ScriptEntry({ name: "deploy" })).toThrow("npm run deploy is not in agent/package.json");
    expect(() => ScriptFile({ name: "nope.ts" })).toThrow("agent/scripts/nope.ts does not exist");
  });

  it("EventEntry lists the parameters and which are indexed", () => {
    render(<EventEntry contract="MandateVault" name="Decision" />);
    const table = screen.getByRole("region", { name: "Decision parameters" });
    const intent = within(table).getByText("intentId").closest("tr");
    expect(intent).not.toBeNull();
    expect(within(intent as HTMLElement).getByText("Yes")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 7);
  });

  it("ErrorEntry shows the signature", () => {
    render(<ErrorEntry contract="MandateVault" name="ChangeNotReady" />);
    expect(screen.getByText("error ChangeNotReady(bytes32 changeHash, uint256 eta)")).toBeInTheDocument();
  });

  it("TypeEntry numbers enum members from 0 and lists struct fields", () => {
    const { unmount } = render(<TypeEntry name="Reason" />);
    const rows = within(screen.getByRole("region", { name: "Reason members" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + FACTS.refusalCount.value + 1);
    expect(rows[1]).toHaveTextContent("0OK");
    unmount();
    render(<TypeEntry name="Mandate" />);
    expect(within(screen.getByRole("region", { name: "Mandate fields" })).getByText("maxPremiumBps")).toBeInTheDocument();
  });

  it("FunctionIndex links each function to the id Fumadocs gives its heading", () => {
    const { unmount } = render(<FunctionIndex contract="MandateVault" />);
    expect(screen.getByRole("link", { name: "queueMandate" })).toHaveAttribute("href", "#queuemandate");
    expect(screen.getByRole("link", { name: "GRACE_PERIOD" })).toHaveAttribute("href", "#grace_period");
    unmount();
    render(<FunctionIndex contract="AaveV4CreditAdapter" qualify />);
    expect(screen.getByRole("link", { name: "withdraw" })).toHaveAttribute("href", "#withdraw-aavev4creditadapter");
  });

  it("headingId follows the slug rules for the headings the reference uses", () => {
    expect(headingId("queueMandate")).toBe("queuemandate");
    expect(headingId("ZeroAddress (MandateVault)")).toBe("zeroaddress-mandatevault");
    expect(headingId("MAAT_MODE")).toBe("maat_mode");
  });
});

describe("agent, address and fact entries", () => {
  it("EnvTable has one row per setting, linked to its entry", () => {
    render(<EnvTable />);
    const rows = within(screen.getByRole("region", { name: "Agent settings" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + docsData.agent.env.length);
    expect(screen.getByRole("link", { name: "MAAT_MODE" })).toHaveAttribute("href", "#maat_mode");
  });

  it("EnvVar shows the default and the .env.example value", () => {
    render(<EnvVar name="MAAT_MODE" />);
    expect(screen.getAllByText("dry-run")).toHaveLength(2);
    expect(screen.getByText("agent/src/config.ts")).toBeInTheDocument();
  });

  it("ScriptEntry and ScriptFile name what runs", () => {
    render(
      <>
        <ScriptEntry name="agent" />
        <ScriptFile name="cdp-setup.ts" />
      </>,
    );
    expect(screen.getByText("npm run agent")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "agent/scripts/cdp-setup.ts" })).toHaveAttribute(
      "href",
      "https://github.com/duongnq2798/maat/blob/main/agent/scripts/cdp-setup.ts",
    );
  });

  it("AddressTable links every address to Basescan", () => {
    render(<AddressTable />);
    const rows = within(screen.getByRole("region", { name: "Base addresses" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + docsData.addresses.length);
    const addresses = docsData.addresses.filter((a) => a.type === "address");
    expect(screen.getAllByRole("link")).toHaveLength(addresses.length);
    expect(screen.getByRole("link", { name: addresses[0]?.value })).toHaveAttribute(
      "href",
      `https://basescan.org/address/${addresses[0]?.value}`,
    );
  });

  it("FactTable shows each value with its source", () => {
    render(<FactTable names={["timelockHours", "mandate.maxPremiumBps"]} />);
    expect(screen.getByText("24 hours")).toBeInTheDocument();
    expect(screen.getByText(FACTS.timelockHours.source)).toBeInTheDocument();
    expect(() => FactTable({ names: ["nope" as never] })).toThrow('<Fact name="nope" /> is not in FACT_TEXT');
  });
});
```

- [ ] **Step 6: Run it and see it fail.**
  Run: `cd web && npx vitest run test/docs-reference.test.tsx`
  Expected: FAIL: `Failed to resolve import "@/components/docs/reference"`.

- [ ] **Step 7: Write the components** `web/components/docs/reference.tsx`:

```tsx
import type { ReactNode } from "react";
import { type FactName, factFor } from "@/lib/docs/fact-text";
import { docsData } from "@/lib/docs/generated";
import { headingId } from "@/lib/docs/links";
import { accessLabel, errorSignature, eventSignature, findContract, findItem, functionSignature } from "@/lib/docs/signatures";
import type { Mutability, SolParam } from "@/lib/docs/sol-surface";
import { SITE } from "@/lib/site";

// Reference entries for the MDX pages under content/docs/reference. Each reads the committed output of
// `npm run docs:gen` and throws on an unknown name, so a typo in a page fails the build.

const surface = docsData.surface;

const MUTABILITY_LABEL: Readonly<Record<Mutability, string>> = {
  view: "Read only",
  pure: "Read only",
  nonpayable: "Changes state",
  payable: "Changes state, takes ETH",
};

function Signature({ children }: { children: string }) {
  return (
    <pre className="not-prose my-3 overflow-x-auto rounded-lg border border-fd-border bg-fd-muted px-4 py-3 font-mono text-[13px] leading-6 text-fd-foreground">
      <code>{children}</code>
    </pre>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-fd-border px-2.5 py-0.5 text-xs font-medium text-fd-muted-foreground">
      {children}
    </span>
  );
}

function Notice({ text }: { text: string }) {
  return text ? <p className="mt-3 text-fd-muted-foreground">{text}</p> : null;
}

/** A table that scrolls inside its own focusable region on small screens, never the page. */
function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  return (
    // tabIndex: a scrollable region must be reachable by keyboard (axe rule scrollable-region-focusable).
    <div className="relative my-6 overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      <table className="my-0">{children}</table>
    </div>
  );
}

function ParamTable({ label, params, indexed = false }: { label: string; params: readonly SolParam[]; indexed?: boolean }) {
  if (params.length === 0) return null;
  return (
    <ScrollTable label={label}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          {indexed ? <th>Indexed</th> : null}
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name}>
            <td><code>{p.name}</code></td>
            <td><code>{p.type}</code></td>
            {indexed ? <td>{p.indexed ? "Yes" : "No"}</td> : null}
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** Summary table of a contract's functions, each linking to its entry. `qualify` when the page heads entries `name (Contract)`. */
export function FunctionIndex({ contract, qualify = false }: { contract: string; qualify?: boolean }) {
  const c = findContract(surface, contract);
  return (
    <ScrollTable label={`${contract} functions`}>
      <thead>
        <tr>
          <th>Function</th>
          <th>Who may call</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        {c.functions.map((f) => (
          <tr key={f.name}>
            <td>
              <a href={`#${headingId(qualify ? `${f.name} (${contract})` : f.name)}`}><code>{f.name}</code></a>
            </td>
            <td>{accessLabel(f.access)}</td>
            <td>{f.kind === "getter" ? "Public state" : MUTABILITY_LABEL[f.mutability]}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

export function Fn({ contract, name }: { contract: string; name: string }) {
  const f = findItem(surface, contract, "functions", name);
  return (
    <div data-entry="function">
      <Signature>{functionSignature(f)}</Signature>
      <div className="not-prose flex flex-wrap gap-2">
        <Chip>{accessLabel(f.access)}</Chip>
        <Chip>{MUTABILITY_LABEL[f.mutability]}</Chip>
        {f.kind === "getter" ? <Chip>Public state</Chip> : null}
      </div>
      <Notice text={f.notice} />
    </div>
  );
}

export function EventEntry({ contract, name }: { contract: string; name: string }) {
  const e = findItem(surface, contract, "events", name);
  return (
    <div data-entry="event">
      <Signature>{eventSignature(e)}</Signature>
      <Notice text={e.notice} />
      <ParamTable label={`${name} parameters`} params={e.params} indexed />
    </div>
  );
}

export function ErrorEntry({ contract, name }: { contract: string; name: string }) {
  const e = findItem(surface, contract, "errors", name);
  return (
    <div data-entry="error">
      <Signature>{errorSignature(e)}</Signature>
      <Notice text={e.notice} />
      <ParamTable label={`${name} parameters`} params={e.params} />
    </div>
  );
}

/** An enum's members with their ids, or a struct's fields, from contracts/src/Types.sol. */
export function TypeEntry({ name }: { name: string }) {
  const en = surface.enums.find((e) => e.name === name);
  if (en) {
    return (
      <ScrollTable label={`${name} members`}>
        <thead>
          <tr>
            <th>Id</th>
            <th>Member</th>
          </tr>
        </thead>
        <tbody>
          {en.members.map((m, id) => (
            <tr key={m}>
              <td>{id}</td>
              <td><code>{m}</code></td>
            </tr>
          ))}
        </tbody>
      </ScrollTable>
    );
  }
  const st = surface.structs.find((s) => s.name === name);
  if (!st) throw new Error(`type ${name} is not in content/generated/contracts.json (run npm run docs:gen)`);
  return (
    <div data-entry="struct">
      <Notice text={st.notice} />
      <ParamTable label={`${name} fields`} params={st.fields} />
    </div>
  );
}

function envVar(name: string) {
  const v = docsData.agent.env.find((e) => e.name === name);
  if (!v) throw new Error(`${name} is not in agent/.env.example (content/generated/agent.json)`);
  return v;
}

const READ_BY = { agent: "Agent config", sdk: "SDK" } as const;

/** Every setting in agent/.env.example, each linking to its entry. */
export function EnvTable() {
  return (
    <ScrollTable label="Agent settings">
      <thead>
        <tr>
          <th>Setting</th>
          <th>Read by</th>
          <th>Required</th>
          <th>Default</th>
        </tr>
      </thead>
      <tbody>
        {docsData.agent.env.map((v) => (
          <tr key={v.name}>
            <td><a href={`#${headingId(v.name)}`}><code>{v.name}</code></a></td>
            <td>{READ_BY[v.readBy]}</td>
            <td>{v.required ? "Yes" : "No"}</td>
            <td>{v.default === null ? "None" : <code>{v.default}</code>}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

export function EnvVar({ name }: { name: string }) {
  const v = envVar(name);
  return (
    <div data-entry="env">
      <dl className="not-prose grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fd-muted-foreground">Read by</dt>
        <dd>{v.readBy === "agent" ? "agent/src/config.ts" : "the SDK that uses it, not agent/src/config.ts"}</dd>
        <dt className="text-fd-muted-foreground">Required</dt>
        <dd>{v.required ? "Yes, in every mode" : "No"}</dd>
        <dt className="text-fd-muted-foreground">Default</dt>
        <dd>{v.default === null ? "None" : <code>{v.default}</code>}</dd>
        <dt className="text-fd-muted-foreground">In .env.example</dt>
        <dd>{v.example ? <code>{v.example}</code> : "Empty: set your own"}</dd>
      </dl>
      <Notice text={v.note} />
    </div>
  );
}

export function ScriptEntry({ name }: { name: string }) {
  const s = docsData.agent.scripts.find((x) => x.name === name);
  if (!s) throw new Error(`npm run ${name} is not in agent/package.json (content/generated/agent.json)`);
  return (
    <div data-entry="script">
      <Signature>{`npm run ${s.name}`}</Signature>
      <p className="text-fd-muted-foreground">
        Runs <code>{s.command}</code> in <code>agent/</code>.
      </p>
    </div>
  );
}

export function ScriptFile({ name }: { name: string }) {
  if (!docsData.agent.scriptFiles.includes(name)) {
    throw new Error(`agent/scripts/${name} does not exist (content/generated/agent.json)`);
  }
  return (
    <p data-entry="script-file">
      <a href={`${SITE.repoUrl}/blob/main/agent/scripts/${name}`}><code>agent/scripts/{name}</code></a>
    </p>
  );
}

/** Every constant in contracts/script/BaseAddresses.sol; addresses link to Basescan. */
export function AddressTable() {
  return (
    <ScrollTable label="Base addresses">
      <thead>
        <tr>
          <th>Name</th>
          <th>Value</th>
          <th>Note</th>
        </tr>
      </thead>
      <tbody>
        {docsData.addresses.map((a) => (
          <tr key={a.name}>
            <td><code>{a.name}</code></td>
            <td>
              {a.type === "address" ? (
                <a href={`https://basescan.org/address/${a.value}`}><code>{a.value}</code></a>
              ) : (
                <code>{a.value}</code>
              )}
            </td>
            <td>{a.note}</td>
          </tr>
        ))}
      </tbody>
    </ScrollTable>
  );
}

/** Facts with their value and the source that proves it, for the default parameters page. */
export function FactTable({ names }: { names: readonly FactName[] }) {
  return (
    <ScrollTable label="Defaults">
      <thead>
        <tr>
          <th>Parameter</th>
          <th>Value</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {names.map((n) => {
          const f = factFor(n);
          return (
            <tr key={n}>
              <td><code>{n}</code></td>
              <td>{f.text}</td>
              <td>{f.source}</td>
            </tr>
          );
        })}
      </tbody>
    </ScrollTable>
  );
}
```

- [ ] **Step 8: Run the tests and the typecheck.**
  Run: `cd web && npx vitest run test/docs-reference.test.tsx test/signatures.test.ts && npm run typecheck`
  Expected: PASS (16 tests), no type errors.

- [ ] **Step 9: Register them for MDX.** In `web/components/docs/mdx.tsx`, add the import

```tsx
import {
  AddressTable,
  EnvTable,
  EnvVar,
  ErrorEntry,
  EventEntry,
  FactTable,
  Fn,
  FunctionIndex,
  ScriptEntry,
  ScriptFile,
  TypeEntry,
} from "./reference";
```

and add `AddressTable, EnvTable, EnvVar, ErrorEntry, EventEntry, FactTable, Fn, FunctionIndex, ScriptEntry,
ScriptFile, TypeEntry,` to the object `getMDXComponents` returns, before `...components`.

- [ ] **Step 10: See one entry in a page.** Add a scratch line `<Fn contract="MandateVault" name="execute" />`
  to `web/content/docs/index.mdx`, run `npm run build`, open `out/docs.html` and find
  `function execute(Intent intent) external returns (bool allowed, Reason reason)`. Then change the name to `executeX`,
  run `npm run build` again and expect it to fail with `MandateVault has no function named executeX`.
  Remove the line.

- [ ] **Step 11: Commit.**

```bash
git add web/lib/docs/signatures.ts web/test/signatures.test.ts web/components/docs/reference.tsx web/test/docs-reference.test.tsx web/components/docs/mdx.tsx
git commit -m "feat(web): add generated reference entries for functions, events, errors, types, settings and addresses"
```

### Task 13: Reference, contracts

**Files:**
- Create: `web/content/docs/reference/meta.json`
- Create: `web/content/docs/reference/{mandate-vault,events,errors,types,market-calendar,adapters}.mdx`
- Create: `web/test/docs-coverage.test.ts`
- Modify: `web/test/docs-ia.test.ts`

**Interfaces:**
- Consumes: `<FunctionIndex>`, `<Fn>`, `<EventEntry>`, `<ErrorEntry>`, `<TypeEntry>` (Task 12), `docsData`
  (Task 11: `import { docsData } from "@/lib/docs/generated"`).

This task follows the content procedure, with one extra first step: write the coverage test, so the
pages are driven by what the contracts actually expose.

- [ ] **Step 0a: Write the coverage test** `web/test/docs-coverage.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docsData } from "@/lib/docs/generated";
import { REPO_ROOT } from "./helpers/solidity";

const page = (slug: string) => readFileSync(join(REPO_ROOT, "web/content/docs", `${slug}.mdx`), "utf8");

/** Each documented contract and the reference page that must describe every function it exposes. */
const FUNCTION_PAGES: Readonly<Record<string, string>> = {
  MandateVault: "reference/mandate-vault",
  MarketCalendar: "reference/market-calendar",
  ISwapAdapter: "reference/adapters",
  AerodromeSwapAdapter: "reference/adapters",
  ICreditAdapter: "reference/adapters",
  AaveV4CreditAdapter: "reference/adapters",
};

const entry = (tag: string, attrs: Record<string, string>) =>
  new RegExp(`<${tag}\\s+${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join("\\s+")}\\s*/>`);

describe("every public function has a reference entry", () => {
  for (const c of docsData.surface.contracts) {
    const slug = FUNCTION_PAGES[c.name];
    if (slug === undefined) continue; // IMandateVaultEvents has events only
    it.each(c.functions.map((f) => f.name))(`${c.name}.%s`, (name) => {
      expect(page(slug)).toMatch(entry("Fn", { contract: c.name, name }));
    });
  }
});

describe("every event and error has a reference entry", () => {
  const events = page("reference/events");
  const errors = page("reference/errors");
  for (const c of docsData.surface.contracts) {
    // MandateVault re-exposes these events; the page lists them under MandateVault, where readers look.
    if (c.name === "IMandateVaultEvents") continue;
    it.each(c.events.map((e) => e.name))(`${c.name} event %s`, (name) => {
      expect(events).toMatch(entry("EventEntry", { contract: c.name, name }));
    });
    it.each(c.errors.map((e) => e.name))(`${c.name} error %s`, (name) => {
      expect(errors).toMatch(entry("ErrorEntry", { contract: c.name, name }));
    });
  }
});

describe("every enum and struct in Types.sol has a reference entry", () => {
  const types = page("reference/types");
  it.each([...docsData.surface.enums, ...docsData.surface.structs].map((t) => t.name))("%s", (name) => {
    expect(types).toMatch(entry("TypeEntry", { name }));
  });
});
```

- [ ] **Step 0b: Run it and see it fail.**
  Run: `cd web && npx vitest run test/docs-coverage.test.ts`
  Expected: FAIL with `ENOENT` for `reference/mandate-vault.mdx` and the other pages.

Then Steps 1 to 7 of the content procedure. Step 4 runs
`npx vitest run test/docs-ia.test.ts test/docs-content.test.ts test/docs-coverage.test.ts`.

`web/content/docs/reference/meta.json` (Task 14 appends its four pages):

```json
{
  "title": "Reference",
  "pages": ["mandate-vault", "events", "errors", "types", "market-calendar", "adapters"]
}
```

Reference template for every page: summary table first (`<FunctionIndex contract="…" />` or a markdown
table), then one H3 per item whose text is the item's name exactly (`### queueMandate`), then its entry
component, then two to five sentences of prose from the source: who calls it and why, effects, events it
emits, how it reverts or which refusals it can return. End with `## Related` linking the concept pages.

#### `reference/mandate-vault`

```yaml
---
title: MandateVault
description: "Every external and public function of MandateVault: its signature, who may call it, what it changes, and how it reverts or refuses."
type: reference
audience: [developer, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MandateVault.sol
  - contracts/src/IMandateVaultEvents.sol
  - contracts/test/MandateVault.t.sol
  - contracts/test/MandateVaultAdmin.t.sol
next: [reference/events, concepts/timelock-and-roles]
---
```

H2 groups, in this order: `Executor` (`execute`, `previewIntent`) · `Anyone` (`notifyRevenue`,
`syncMultiplier`) · `Owner, instant` (`setExecutor`, `setPaused`, `withdraw`, `fund`) · `Owner, timelocked`
(`queueMandate`, `queueTokenConfig`, `queuePayee`, `cancelChange`, `applyMandate`, `applyTokenConfig`,
`applyPayee`) · `Views` (`mandate`, `mandateHash`, `tokens`, `payees`, `policyHash`, `today`,
`mandateChangeHash`, `tokenChangeHash`, `payeeChangeHash`) · `Public state` (every getter: `owner`, `usdc`,
`policyRegistry`, `executor`, `paused`, `tokenConfig`, `allowedPayee`, `usedIntent`, `spentOnDay`,
`lastMultiplier`, `multiplierChangedAt`, `queuedAt`, `recordedUsdc`, `TIMELOCK`, `GRACE_PERIOD`) ·
`Constructor` (prose: what it validates and emits) · `Related`. The coverage test lists exactly what is
missing if a name is left out.

#### `reference/events`

```yaml
---
title: Events
description: Every event the vault, the calendar and the adapters emit, with each parameter and when the event is emitted.
type: reference
audience: [developer, watcher]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/IMandateVaultEvents.sol
  - contracts/src/MarketCalendar.sol
  - contracts/src/MandateVault.sol
next: [guides/watch-decisions-onchain, get-started/read-a-decision]
---
```

H2 `MandateVault` (one H3 per event, `Decision` first, then alphabetical) · H2 `MarketCalendar`
(`HolidayAdded`, `EarlyCloseSet`) · `Related`. For each: when it is emitted (which function), and for
`Decision` a link to Read a decision.

#### `reference/errors`

```yaml
---
title: Errors
description: Every custom error in Maat's contracts and adapters, with its parameters and the condition that raises it.
type: reference
audience: [developer, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MandateVault.sol
  - contracts/src/MarketCalendar.sol
  - contracts/src/adapters/AerodromeSwapAdapter.sol
  - contracts/src/adapters/AaveV4CreditAdapter.sol
  - contracts/src/adapters/ICreditAdapter.sol
  - contracts/src/lib/TokenTransfer.sol
next: [guides/configure-a-mandate, help/troubleshooting]
---
```

Open with the rule: a refused trade is not an error. `execute` reverts only with `NotExecutor` or
`IntentAlreadyUsed`; everything else that blocks a trade is a refusal code. Then one H2 per contract
(`MandateVault`, `MarketCalendar`, `AerodromeSwapAdapter`, `AaveV4CreditAdapter`, `ICreditAdapter`), one H3
per error. Errors with the same name in two contracts get one entry per contract; use the H3 text
`ZeroAddress (MandateVault)` so anchors stay unique.

#### `reference/types`

```yaml
---
title: Types
description: The Intent, Mandate and TokenConfig structs and the Action, Reason and SessionMode enums, field by field and member by member.
type: reference
audience: [developer, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/Types.sol
next: [concepts/mandate, concepts/refusal-codes]
---
```

H2 `Structs` (H3 `Intent`, `Mandate`, `TokenConfig`), H2 `Enums` (H3 `Action`, `Reason`, `SessionMode`).
`<TypeEntry>` renders the fields or members with their ids; prose adds units (USDC has 6 decimals, health
factors are WAD) from the comments in `Types.sol`, and for `Intent` the per-action meaning of `token` and
`amount` from its NatSpec.

#### `reference/market-calendar`

```yaml
---
title: MarketCalendar
description: The calendar contract's functions, the holidays and early closes it ships with, and the rule that it can only get stricter.
type: reference
audience: [developer, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MarketCalendar.sol
  - contracts/src/lib/DateLib.sol
  - contracts/test/MarketCalendar.t.sol
next: [concepts/market-hours, reference/events]
---
```

`<FunctionIndex contract="MarketCalendar" />`, H3 per function and getter (`addHoliday`, `setEarlyClose`,
`etOffsetSeconds`, `localTime`, `isOpen`, `owner`, `isHoliday`, `earlyCloseMin`), then `## Shipped holidays
and early closes`: a table copied from the constructor (date, kind, close time), introduced with
`<Fact name="calendarPreload.holidays" />` holidays and `<Fact name="calendarPreload.earlyCloses" />`
early closes, and a titled excerpt of the constructor lines so the excerpt gate keeps the table honest.

#### `reference/adapters`

```yaml
---
title: Adapters
description: The swap and credit adapter interfaces, and the Aerodrome Slipstream and Aave V4 adapters that implement them for Base.
type: reference
audience: [developer, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/adapters/ISwapAdapter.sol
  - contracts/src/adapters/AerodromeSwapAdapter.sol
  - contracts/src/adapters/ICreditAdapter.sol
  - contracts/src/adapters/AaveV4CreditAdapter.sol
next: [concepts/credit-and-health-factor, reference/base-addresses]
---
```

H2 per contract in this order: `ISwapAdapter`, `AerodromeSwapAdapter`, `ICreditAdapter`,
`AaveV4CreditAdapter`, each with `<FunctionIndex contract="…" qualify />` and an H3 + `<Fn>` per function.
Most names repeat between an interface and its implementation, so on this page every H3 names its
contract: `### withdraw (AaveV4CreditAdapter)`, `### swapExactIn (ISwapAdapter)`. `qualify` makes the
index link to those anchors. Where an implementation function is the interface function (same name),
write the prose once under the interface and under the implementation say only what it adds
(`onlyVault`, reverts, the custodian).

#### End-to-end checks for Task 13

The MandateVault reference is the widest page (long signatures, wide tables) and the one a developer
deep-links into (Review Focus 2 and 4). Between Steps 5 and 6 of the procedure:

- [ ] **Add the page to the width checks.** In `web/e2e/docs.spec.ts`, add `"/docs/reference/mandate-vault"`
  to the end of `PAGES`.
- [ ] **Append the reference tests** to `web/e2e/docs.spec.ts`:

```ts
test.describe("contract reference", () => {
  test("a function name finds its entry first", async ({ page }) => {
    await page.goto("/docs");
    const dialog = await openSearch(page);
    await dialog.getByRole("combobox").fill("queueMandate");
    await expect(dialog.getByRole("option").first()).toContainText(/MandateVault|queueMandate/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/docs\/reference\/mandate-vault(#queuemandate)?$/);
  });

  test("a deep link to a function, loaded cold, scrolls to it", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/docs/reference/mandate-vault#queuemandate");
    await expect(page.locator("#queuemandate")).toBeInViewport();
    await context.close();
  });
});
```

- [ ] **Run them.** `cd web && npx playwright test e2e/docs.spec.ts`. Expected: PASS, the MandateVault page
  included at all five widths. A page that scrolls sideways at 360 px means a table or signature is not
  inside its own scroll region (`ScrollTable`, Task 12): fix the component, not the test.

Add `web/e2e/docs.spec.ts` to the commit in Step 7.

---

### Task 14: Reference, agent, addresses and defaults

**Files:**
- Create: `web/content/docs/reference/{agent-configuration,agent-scripts,base-addresses,default-parameters}.mdx`
- Modify: `web/content/docs/reference/meta.json` (append the four slugs), `web/test/docs-coverage.test.ts`,
  `web/test/docs-ia.test.ts`

**Interfaces:**
- Consumes: `<EnvVar>`, `<EnvTable>`, `<ScriptEntry>`, `<AddressTable>`, `<FactTable>` (Task 12).

- [ ] **Step 0a: Extend the coverage test.** Append to `web/test/docs-coverage.test.ts`:

```ts
describe("the agent reference covers every setting and script", () => {
  const config = page("reference/agent-configuration");
  const scripts = page("reference/agent-scripts");
  it.each(docsData.agent.env.map((v) => v.name))("env %s", (name) => {
    expect(config).toMatch(entry("EnvVar", { name }));
  });
  it.each(docsData.agent.scripts.map((s) => s.name))("npm run %s", (name) => {
    expect(scripts).toMatch(entry("ScriptEntry", { name }));
  });
  it.each(docsData.agent.scriptFiles)("scripts/%s", (file) => {
    expect(scripts).toMatch(entry("ScriptFile", { name: file }));
  });
});

describe("base addresses page lists every constant", () => {
  it("uses the generated table", () => {
    expect(page("reference/base-addresses")).toMatch(/<AddressTable\s*\/>/);
  });
});
```

- [ ] **Step 0b: Run it and see it fail** (`ENOENT` for the four pages). Then the content procedure.

#### `reference/agent-configuration`

```yaml
---
title: Agent configuration
description: "Every environment variable the agent reads: whether it is required, its default, and what it changes in the loop."
type: reference
audience: [builder, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - agent/src/config.ts
  - agent/.env.example
  - agent/README.md
next: [guides/run-the-agent, reference/agent-scripts]
---
```

`<EnvTable />` first (name, read by, required, default). Then H2 `Read by the agent` and H2 `Read by the
SDKs` (`ANTHROPIC_API_KEY`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`), one H3 per
variable with `<EnvVar name="…" />` and what it changes: `MAAT_MODE` (dry-run never sends; live needs
`MAAT_BUILDER_CODE`), `MAAT_MAX_TX_PER_DAY` (`<Fact name="maxTxPerDay" />`), `MAAT_DEFAULT_DAILY_COMPUTE_USD`
(`<Fact name="dailyComputeUsd" />`), and so on. Secrets: say where each comes from and that `.env` is
gitignored; never show a value.

#### `reference/agent-scripts`

```yaml
---
title: Agent scripts
description: "The npm scripts in the agent package: what each runs, the modes they take, what they need and how they exit."
type: reference
audience: [builder, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - agent/package.json
  - agent/src/main.ts
  - agent/scripts/gen-abis.ts
  - agent/README.md
next: [guides/run-the-agent, guides/run-the-tests]
---
```

H2 `npm scripts`: H3 + `<ScriptEntry name="…" />` for `agent`, `test`, `test:integration`, `typecheck`,
`gen:abi`; for `agent`, the flags `main.ts` accepts (read `main.ts`: `--once`, `--dry-run`) and its exit
behaviour. H2 `Script files`: H3 + `<ScriptFile name="…" />` for `cdp-setup.ts` (owner only, inside an
"Owner only" warning callout: creates the CDP account and attaches the policy; it talks to Coinbase), 
`gen-abis.ts`, `smoke-claude.ts` (calls the paid Claude API: say so).

#### `reference/base-addresses`

```yaml
---
title: Base addresses
description: The Base mainnet tokens, Chainlink feeds, Aerodrome pools and Aave V4 contracts Maat uses, with links to Basescan.
type: reference
audience: [developer, builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/script/BaseAddresses.sol
next: [concepts/prices-and-premium, guides/deploy-your-own-vault]
---
```

`<AddressTable />` (generated: name, address linked to `https://basescan.org/address/<address>`, note).
Then prose: verified on the date in the file's NatSpec; the two pinned fork blocks and what each is for;
why AMZNc is not in the basket (README "Base integrations").

#### `reference/default-parameters`

```yaml
---
title: Default parameters
description: Every default the vault, the calendar and the agent ship with, with its unit and the source file that sets it.
type: reference
audience: [builder, developer, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - web/content/facts.ts
  - contracts/script/MaatConfig.sol
  - contracts/src/MandateVault.sol
  - agent/src/policy.ts
  - agent/src/config.ts
next: [concepts/mandate, guides/configure-a-mandate]
---
```

Three `<FactTable>`s under H2 `Vault and mandate`, `Calendar`, `Agent`, each listing the fact names that
belong there (Task 12 renders value and source). Every `FACT_TEXT` key appears in exactly one table:
add this assertion to `docs-coverage.test.ts` in Step 0a:

```ts
it("default-parameters lists every fact once", () => {
  const src = page("reference/default-parameters");
  const listed = [...src.matchAll(/names=\{\[([^\]]*)\]\}/g)].flatMap((m) =>
    [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((n) => n[1]),
  );
  expect([...listed].sort()).toEqual(Object.keys(FACT_TEXT).sort());
});
```

(import `FACT_TEXT` from `@/lib/docs/fact-text` at the top of the test file.)

#### End-to-end check for Task 14

Search must answer a setting in its first result (spec §1). Between Steps 5 and 6 of the procedure, append
to `web/e2e/docs.spec.ts`:

```ts
test("a setting name finds its entry first", async ({ page }) => {
  await page.goto("/docs");
  const dialog = await openSearch(page);
  await dialog.getByRole("combobox").fill("MAAT_MODE");
  await expect(dialog.getByRole("option").first()).toContainText(/Agent configuration|MAAT_MODE/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/reference\/agent-configuration(#maat_mode)?$/);
});
```

Run: `cd web && npx playwright test e2e/docs.spec.ts`. Expected: PASS. Add `web/e2e/docs.spec.ts` to the
commit in Step 7.

---

### Task 15: Guides, part 1

**Files:**
- Create: `web/content/docs/guides/meta.json`
- Create: `web/content/docs/guides/{run-the-tests,reproduce-the-fork-run,deploy-your-own-vault,configure-a-mandate}.mdx`
- Modify: `web/test/docs-ia.test.ts`

`web/content/docs/guides/meta.json` (Task 16 appends its four):

```json
{
  "title": "Guides",
  "pages": ["run-the-tests", "reproduce-the-fork-run", "deploy-your-own-vault", "configure-a-mandate"]
}
```

Guide template for every page: `## Before you start` (who it is for, prerequisites table, time) →
`<Steps>` with one `<Step>` per action, each with the command and its expected output → `## Check it
worked` → `## Common mistakes` → `## Next steps`. Run every offline command yourself before you paste its
output. For commands that need an RPC or keys you do not have, copy the output from the README or
runbook it comes from and say so in the label.

#### `guides/run-the-tests`

```yaml
---
title: Run the tests
description: Run the contract unit and fork suites, the agent unit and fork tests, and the website checks, with what each one needs to run.
type: guide
audience: [developer, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - contracts/foundry.toml
  - agent/package.json
  - web/package.json
next: [guides/reproduce-the-fork-run, security/testing]
---
```

Must show: the suites table from README "Development" without the Tests column (suite, command, folder,
needs); one `<Step>` per suite; `npm run verify` and `npm run e2e` for the site; `forge build --sizes`;
that there is no CI yet (README), so these are run locally.

#### `guides/reproduce-the-fork-run`

```yaml
---
title: Reproduce the fork run
description: Rerun the end-to-end agent test on a Base mainnet fork and read its decisions, its trace and the gas log it writes.
type: guide
audience: [developer, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - agent/test/integration/agent.fork.test.ts
  - agent/test/integration/anvil.ts
  - agent/test/integration/fork-gas.json
  - agent/README.md
next: [get-started/read-a-decision, security/testing]
---
```

Must show: prerequisites (Base archive RPC as `<BASE_RPC_URL>`, `base-anvil` v1.5.1 and why: upstream
Anvil reverts on `uiMultiplier()`), the commands from `agent/README.md` "Test", the fork point
(`<Fact name="forkBlock" />`, `<Fact name="forkDay" />` `<Fact name="forkTimeEt" />`), `<ForkLedger />` for
the four decisions, how `MAAT_GAS_LOG` writes `fork-gas.json`, and that BUY gas varies slightly between
runs. Time: 3 to 5 minutes (README).

#### `guides/deploy-your-own-vault`

```yaml
---
title: Deploy your own vault
description: "Deploy a vault with the default mandate: dry-run it on a fork first, then broadcast to Base mainnet from your own wallet."
type: guide
audience: [builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - deployments/README.md
  - contracts/script/Deploy.s.sol
  - contracts/script/MaatConfig.sol
  - contracts/test/fork/DeployFork.t.sol
next: [guides/configure-a-mandate, guides/run-the-agent]
---
```

Must show, from `deployments/README.md`: the dry-run with placeholder addresses (no key needed); the
pre-broadcast checklist, with the owner being immutable in a warning callout; the mainnet commands inside
`<Callout type="warning" title="Owner only">`; funding with `approve` then `fund` (never a plain
transfer, which is counted as revenue); the smoke test that expects a weekend `MARKET_CLOSED`; where to
record the addresses. Status: the Maat team has not broadcast yet; say so at the top.

#### `guides/configure-a-mandate`

```yaml
---
title: Configure a mandate
description: Change the limits, tokens and payees before you deploy, and understand the validation errors the vault raises for a bad config.
type: guide
audience: [builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/script/MaatConfig.sol
  - contracts/src/MandateVault.sol
  - contracts/test/MandateVaultAdmin.t.sol
next: [guides/deploy-your-own-vault, guides/change-a-rule]
---
```

Must show: where each default lives in `MaatConfig.sol` (titled excerpt of `defaultMandate`); the
validation rules from `_requireValidMandate`, `_requireValidCredit` and `_requireValidTokenConfig` as a
table (rule, error); limits such as the de-risk window cap (`<Fact name="maxDeriskWindowHours" />`);
that after deploy every change goes through the timelock (link Change a rule).

---

### Task 16: Guides, part 2

**Files:**
- Create: `web/content/docs/guides/{run-the-agent,change-a-rule,pause-withdraw-recover,watch-decisions-onchain}.mdx`
- Modify: `web/content/docs/guides/meta.json` (append the four), `web/test/docs-ia.test.ts`

#### `guides/run-the-agent`

```yaml
---
title: Run the agent
description: "Configure and start the agent loop: dry-run and live modes, its settings, the CDP wallet, the Builder Code and its daily limits."
type: guide
audience: [builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - agent/README.md
  - agent/src/main.ts
  - agent/src/config.ts
  - agent/src/loop/runOnce.ts
next: [reference/agent-configuration, guides/watch-decisions-onchain]
---
```

Must show: dry run first (commands from `agent/README.md` "Dry run"; it calls the paid Claude API, about
one cent per round); the live checklist from "Live run" inside an "Owner only" callout, including the
Builder Code format and the CDP policy; the journal and state files; "After a halted or pending-tx
cycle" as `## Recover from a halted round`; limits (`<Fact name="maxTxPerDay" />`, gas cap
`<Fact name="maxGas" />`, execute floor `<Fact name="executeGasFloor" />`).

#### `guides/change-a-rule`

```yaml
---
title: Change a rule
description: Queue a mandate, token or payee change, wait out the timelock, then apply or cancel it and check the new policy hash.
type: guide
audience: [builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MandateVault.sol
  - contracts/test/MandateVaultAdmin.t.sol
  - deployments/README.md
next: [concepts/timelock-and-roles, reference/mandate-vault]
---
```

Must show: `<TimelockFlow />`; reading the current values with `cast call` (read-only; placeholders);
queue, wait `<Fact name="timelockHours" />`, apply within `<Fact name="gracePeriodDays" />`, or cancel,
with the owner-only commands in a warning callout; the events each step emits; how to check
`mandateHash()` and `policyHash()` afterwards; common mistakes (`ChangeNotReady`, `ChangeExpired`, applying
different values than were queued gives `ChangeNotQueued`).

#### `guides/pause-withdraw-recover`

```yaml
---
title: Pause, withdraw and recover
description: "The emergency playbook: pause the vault, rotate the executor, withdraw funds and unwind a credit position, step by step."
type: guide
audience: [builder, evaluator]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MandateVault.sol
  - deployments/README.md
  - contracts/test/MandateVaultCredit.t.sol
next: [security/threat-model, concepts/credit-and-health-factor]
---
```

Must show: a decision table (situation → first action); pause (what still works: `REPAY`; withdrawing
collateral is blocked while paused); rotate the executor; withdraw (only to the owner); unwind credit from
`deployments/README.md` "Unwinding the credit position"; every signing command in an "Owner only" callout.

#### `guides/watch-decisions-onchain`

```yaml
---
title: Watch decisions onchain
description: Read Decision events from a vault with cast or viem, decode the action and reason, and match them to the agent's journal.
type: guide
audience: [watcher, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/IMandateVaultEvents.sol
  - contracts/src/Types.sol
  - agent/src/abi/generated.ts
next: [get-started/read-a-decision, concepts/refusal-codes]
---
```

Must show: `cast logs` with the full `Decision` event signature (from `<EventSignature name="Decision" />`)
and `--address <VAULT_ADDRESS>`, read-only; how the agent itself decodes a `Decision` with viem, as a
titled excerpt of `decisionIn` in `agent/src/loop/runOnce.ts` (the excerpt gate keeps it current; do not
write a new viem snippet that nothing compiles); mapping `action` and `reason` numbers to names (link
Types and Refusal codes); matching `rationaleHash` to `data/journal.jsonl`; and that no team vault is
deployed yet, so the commands use `<VAULT_ADDRESS>`: the same decoding runs in the agent fork test.

---

#### Phase 2 checkpoint

The reference and the guides are complete. Before Task 17:

- [ ] **Run everything.** `cd web && npm run verify && npm run e2e`
  Expected: all PASS, with `out/ is ready to deploy (landing and 35 docs pages checked)`.
- [ ] **Check the generated data is current.** `cd web && npm run docs:gen && git status --short web/content/generated`
  Expected: no output (the committed JSON matches the sources).
- [ ] **Check the landing page again.**
  `cd web && node ../.superpowers/docs-baseline/landing-compare.mjs ../.superpowers/docs-baseline/out out`
  Expected: `landing unchanged for a reader`.
- [ ] Nothing to commit unless a step needed a fix; commit a fix with a message that says what it fixes.

## Phase 3: trust and polish

### Task 17: Security

**Files:**
- Create: `web/content/docs/security/meta.json`
- Create: `web/content/docs/security/{model,threat-model,not-claimed,testing,report-a-vulnerability}.mdx`
- Modify: `web/test/docs-ia.test.ts`

`web/content/docs/security/meta.json`:

```json
{
  "title": "Security",
  "pages": ["model", "threat-model", "not-claimed", "testing", "report-a-vulnerability"]
}
```

These pages are read by evaluators deciding whether to trust Maat. Every claim names the code that
enforces it and the test that shows it, as a link to the file on `main`. Never round a limitation into a
strength.

#### `security/model`

```yaml
---
title: Security model
description: What the vault enforces, in which code, and why neither Claude nor a stolen executor key can get around it.
type: concept
audience: [evaluator, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/src/MandateVault.sol
  - contracts/src/GuardLib.sol
  - agent/src/exec/sender.ts
  - agent/src/exec/cdpPolicy.ts
  - README.md
next: [security/threat-model, security/testing]
---
```

H2 outline: `The principle: the agent proposes, the contract decides` · `What the contract enforces` ·
`What the agent adds` · `Refuse, do not revert` · `Fail closed` · `Trust boundaries`.
Must show: the README "Safety architecture" table split in two (contract layers; agent layers), each row
with where and the test; a trust-boundary list (trusted: the owner key, the contracts, Base, Chainlink,
the B20 precompiles; untrusted: Claude, the agent process, the executor key, the RPC); the guarded
sender's gas cap (`<Fact name="maxGas" />`).

#### `security/threat-model`

```yaml
---
title: Threat model
description: The assets, the actors and what each one could do with a leaked key, from the owner to the Claude API key, and the mitigations.
type: concept
audience: [evaluator, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - docs/superpowers/specs/2026-11-06-mandate-treasury-design.md
  - contracts/test/fork/MandateVaultFork.t.sol
  - agent/src/exec/cdpPolicy.ts
next: [security/not-claimed, guides/pause-withdraw-recover]
---
```

H2 outline: `Assets` · `Actors` · `If a key leaks` · `Other threats` · `Mitigations you run`.
Must show: one table per leaked secret (owner key, executor key, Claude API key, CDP API key and wallet
secret, RPC URL): what an attacker can do, cannot do, and the response. The executor row comes from
README "If the executor key leaks" and the fork test `test_compromisedExecutorIsBounded`, with the caps as
`<Fact>`s. The owner row is honest: a leaked owner key controls the vault (single immutable key; a multisig
is compatible but not set up). Other threats: a bad Claude proposal (bounded by the mandate), a stale or
manipulated price (staleness, premium, slippage floor), a missed holiday (staleness is the only backstop).

#### `security/not-claimed`

```yaml
---
title: What Maat does not claim
description: No audit, no mainnet deployment yet, and the known limitations: what can still go wrong and what is out of scope.
type: concept
audience: [evaluator, newcomer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
next: [get-started/status, security/report-a-vulnerability]
---
```

Every item from README "Known limitations", one H2 each, in the README's order, each with what it means
for a user and what would fix it. Open with a `<Callout type="warning">`: unaudited, not on mainnet, all
execution evidence is from a local fork. Include the dependency advisories without counts (they change):
say where `npm audit` reports them and which packages, from the README.

#### `security/testing`

```yaml
---
title: How it is tested
description: "How each guarantee is tested: contract unit and fork suites, agent tests, parity tests between the site and the code."
type: concept
audience: [evaluator, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - contracts/test/MandateVault.t.sol
  - contracts/test/GuardLib.t.sol
  - contracts/test/fork/MandateVaultFork.t.sol
  - agent/test/runOnce.test.ts
  - web/test/facts.test.ts
  - web/test/docs-gen.test.ts
next: [guides/run-the-tests, guides/reproduce-the-fork-run]
---
```

H2 outline: `Layers` · `Contracts` · `Fork tests against real Base state` · `The agent` · `Parity tests: the
site and these docs` · `What is not tested`.
Must show: a guarantee → test table (at least: refusal is logged not reverted, replay reverts, slippage
floor, timelock, repay while paused, compromised executor bounded, preview mismatch halts, exactly-once
sends), each test name linking to its file; the docs' own gates (facts, generated data, coverage,
excerpts) as proof the docs track the code; "What is not tested": no audit, no fuzzing campaign against
mainnet, the real Claude API and real CDP are not exercised (README "Status"). No counts.

#### `security/report-a-vulnerability`

```yaml
---
title: Report a vulnerability
description: How to report a security problem in Maat privately, what to include, and what to expect after you report it.
type: help
audience: [evaluator, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
next: [security/not-claimed, security/model]
---
```

Two cases, stated plainly. If GitHub private vulnerability reporting is enabled on the repository
(owner action, spec §10), link `https://github.com/duongnq2798/maat/security/advisories/new`. Until then:
send a direct message to [@maatonbase on X](SITE.xUrl) asking for a private channel, and do not open a
public issue. Before you commit, open the advisories URL while signed out: if GitHub shows the report form
or a sign-in prompt for it, keep the link; if it shows 404, ship only the X instructions and leave a
line in the commit message body saying the owner has not enabled private reporting yet. What to include:
the affected file and function, steps or a test that reproduces it, and the impact. What to expect: no
bounty (there is no budget; say so), credit in the changelog if wanted.

---

### Task 18: Troubleshooting and Changelog

**Files:**
- Create: `web/content/docs/help/{troubleshooting,changelog}.mdx`
- Modify: `web/content/docs/help/meta.json` (pages: `faq`, `troubleshooting`, `glossary`, `changelog`),
  `web/test/docs-ia.test.ts`, `README.md` (first-commit line)

#### `help/troubleshooting`

```yaml
---
title: Troubleshooting
description: "Fixes for problems that happened while building and testing Maat: line endings, Foundry versions, fork RPCs, submodules and gas."
type: help
audience: [developer, builder]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - agent/README.md
  - .gitattributes
  - contracts/foundry.toml
next: [guides/run-the-tests, help/faq]
---
```

One H2 per problem, each with `Symptom`, `Cause`, `Fix`, `Check the fix` as bold lead-ins. Only problems
that happened (spec §3.6): CRLF checkouts on Windows (`.gitattributes`), Foundry older than 1.8.4
(`base:Cobalt` hardfork), the Base anvil binary for B20 (`base-anvil` v1.5.1), fork RPC settings (archive
node needed for pinned blocks), `eth_estimateGas` starving `execute` (the gas floor
`<Fact name="executeGasFloor" />`), submodules (`--recursive` hits the Windows path limit). Quote each real
error message only if it appears in the repo (README, plans, test names); otherwise describe it.

#### `help/changelog`

```yaml
---
title: Changelog
description: "Maat's milestones, newest first: what each one added, when, and where to read the code and the spec behind it."
type: help
audience: [newcomer, evaluator, developer]
status: fork-tested
lastReviewed: 2026-11-07
sources:
  - README.md
  - docs/superpowers/plans/2026-11-06-maat-plan-1-core-contracts.md
  - docs/superpowers/plans/2026-11-06-maat-plan-2a-credit.md
  - docs/superpowers/plans/2026-11-06-maat-plan-2b-agent-runtime.md
  - docs/superpowers/plans/2026-11-07-maat-web-w1.md
next: [get-started/status, help/faq]
---
```

One H2 per milestone, newest first: `Docs center` (this plan), `Website`, `Agent runtime`, `Credit`, `Core
contracts`, `Project start`. Each: the date (from `git log --date=short` of its first and last commit:
run `git log --reverse --format='%h %ad %s' --date=short` and read it), a one-line scope, and links to the
plan and the main code folder. Cite a commit hash only after checking it is reachable from `main`
(`git merge-base --is-ancestor <sha> main && echo yes`); hashes quoted in older specs and plans may not
be, so never copy one from there.

Also in this task: `README.md` line 599 cites `ce1bbb4` as the first commit, which is not reachable from
`main`. Replace it with the hash `git log --reverse --format=%h main | head -1` prints (`009577d` at the
time of writing; check it). Add `README.md` to the commit.

---

### Task 18b: Every IA page has shipped

- [ ] **Step 1:** In `web/test/docs-ia.test.ts`, append this test inside the `describe` block, after
  "every written page is shipped and in the IA", so `SHIPPED` must now be every page in `DOCS_IA`:

```ts
it("the whole IA has shipped", () => {
  expect([...SHIPPED].sort()).toEqual([...IA_SLUGS].sort());
});
```

- [ ] **Step 2:** Run `cd web && npx vitest run test/docs-ia.test.ts`. Expected: PASS (all 42 pages).
- [ ] **Step 3:** Commit: `git commit -am "test(web): require every docs page in the information architecture"`.

### Task 19: llms.txt, llms-full.txt and the sitemap

Machines read the docs too (spec §9, Phase 3 item 2). `/llms.txt` lists every page with its description as
an absolute link (the llmstxt.org format), `/llms-full.txt` is every page as one Markdown file in sidebar
order, and `sitemap.xml` gains one entry per docs page, dated by its `lastReviewed`. `check:out` then
fails when any of the three misses a page. Per-page titles, descriptions, Open Graph tags and canonical
URLs already come from Task 1's `generateMetadata`; Step 7 only checks them.

**Files:**
- Modify: `web/test/docs-page.test.tsx`, `web/test/check-out.test.ts`
- Modify: `web/lib/docs/markdown.ts` (`llmsIndex`), `web/lib/check-out.ts` (`checkDocsIndexes`)
- Modify: `web/lib/docs-source.ts` (`pagesInSidebarOrder`)
- Create: `web/app/llms.txt/route.ts`, `web/app/llms-full.txt/route.ts`
- Modify: `web/app/sitemap.ts`, `web/scripts/check-out.ts`

**Interfaces:**
- Consumes: `source`, `type DocsPage`, `getPageMarkdown(page)` (Task 4), `pageExists(slug)` (Task 5),
  `SITE`, `siteUrl()` (`@/lib/site`), `checkDocsPage`, `checkExport`, `checkLandingIsolation` (Task 6),
  frontmatter `lastReviewed` (Task 1).
- Produces: `llmsIndex(docs, pages): string` (`@/lib/docs/markdown`);
  `checkDocsIndexes(files, urls): string[]` (`@/lib/check-out`); `pagesInSidebarOrder(): DocsPage[]`
  (`@/lib/docs-source`); `out/llms.txt`, `out/llms-full.txt`, docs entries in `out/sitemap.xml`.

- [ ] **Step 1: Write the failing unit tests.** In `web/test/docs-page.test.tsx`, change the Markdown
  import to

```ts
import { llmsIndex, markdownUrl, pageMarkdown, readingMinutes, slugsFromMarkdownPath } from "@/lib/docs/markdown";
```

and append:

```ts

describe("llmsIndex", () => {
  it("gives the summary, the full file and every page as an absolute link", () => {
    const docs = { title: "Maat docs", summary: "S.", fullUrl: "https://x.dev/llms-full.txt" };
    const pages = [{ title: "A", url: "https://x.dev/docs", description: "D" }, { title: "B", url: "https://x.dev/docs/b" }];
    expect(llmsIndex(docs, pages)).toBe(
      "# Maat docs\n\n> S.\n\nEvery page as one Markdown file: https://x.dev/llms-full.txt\n\n## Pages\n\n- [A](https://x.dev/docs): D\n- [B](https://x.dev/docs/b)\n",
    );
  });
});
```

In `web/test/check-out.test.ts`, change the import to

```ts
import { checkDocsIndexes, checkDocsPage, checkExport, checkLandingIsolation } from "@/lib/check-out";
```

and append:

```ts

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
```

Run: `cd web && npx vitest run test/docs-page.test.tsx test/check-out.test.ts`
Expected: FAIL: `TypeError: llmsIndex is not a function` and `TypeError: checkDocsIndexes is not a function`.

- [ ] **Step 2: Write the two helpers.** Append to `web/lib/docs/markdown.ts`:

```ts

/** /llms.txt (llmstxt.org): the docs title and summary, where all of it is as one file, then every page as an absolute link. */
export function llmsIndex(
  docs: { title: string; summary: string; fullUrl: string },
  pages: readonly { title: string; url: string; description?: string }[],
): string {
  const lines = [`# ${docs.title}`, "", `> ${docs.summary}`, "", `Every page as one Markdown file: ${docs.fullUrl}`, "", "## Pages", ""];
  for (const p of pages) lines.push(`- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ""}`);
  return `${lines.join("\n")}\n`;
}
```

Append to `web/lib/check-out.ts`:

```ts

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
```

Run: `cd web && npx vitest run test/docs-page.test.tsx test/check-out.test.ts`
Expected: PASS.

- [ ] **Step 3: List the pages in sidebar order.** Replace `web/lib/docs-source.ts` with this version
  (Task 4's and Task 5's functions, unchanged, plus `pagesInSidebarOrder` and its `flattenTree` import):

```ts
import { loader } from "fumadocs-core/source";
import { flattenTree } from "fumadocs-core/page-tree";
import { docs } from "@/.source/server";
import { pageMarkdown } from "@/lib/docs/markdown";
import { siteUrl } from "@/lib/site";

/** The docs page tree and page lookup, built from content/docs by fumadocs-mdx. */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

export type DocsPage = NonNullable<ReturnType<typeof source.getPage>>;

/** Every docs page in sidebar order, the order a reader pages through them. */
export function pagesInSidebarOrder(): DocsPage[] {
  return flattenTree(source.getPageTree().children).flatMap((item) => source.getNodePage(item) ?? []);
}

/** The page as Markdown with absolute links back to the site, for /md/*.md and llms-full.txt. */
export async function getPageMarkdown(page: DocsPage): Promise<string> {
  return pageMarkdown({
    title: page.data.title,
    url: new URL(page.url, siteUrl()).href,
    description: page.data.description,
    body: await page.data.getText("processed"),
  });
}

/** Whether a docs page exists, by slug ("concepts/nine-checks"; "" or "index" for the home page). */
export function pageExists(slug: string): boolean {
  const parts = slug === "index" ? [] : slug.split("/").filter(Boolean);
  return source.getPage(parts) !== undefined;
}
```

- [ ] **Step 4: Add the two text routes.** Both export one static file at build time, like
  `app/md/[...slug]/route.ts`. `web/app/llms.txt/route.ts`:

```ts
import { pagesInSidebarOrder } from "@/lib/docs-source";
import { llmsIndex } from "@/lib/docs/markdown";
import { SITE, siteUrl } from "@/lib/site";

// Exported once at build time to out/llms.txt: every docs page with its description, as absolute links.
export const revalidate = false;

export function GET() {
  const base = siteUrl();
  const pages = pagesInSidebarOrder().map((page) => ({
    title: page.data.title,
    url: new URL(page.url, base).href,
    description: page.data.description,
  }));
  const docs = { title: `${SITE.name} docs`, summary: SITE.description, fullUrl: new URL("/llms-full.txt", base).href };
  return new Response(llmsIndex(docs, pages), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

`web/app/llms-full.txt/route.ts`:

```ts
import { getPageMarkdown, pagesInSidebarOrder } from "@/lib/docs-source";

// Exported once at build time to out/llms-full.txt: every docs page as Markdown, in sidebar order.
export const revalidate = false;

export async function GET() {
  const pages = await Promise.all(pagesInSidebarOrder().map(getPageMarkdown));
  return new Response(pages.join("\n---\n\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

- [ ] **Step 5: List every docs page in the sitemap.** Replace `web/app/sitemap.ts` with:

```ts
import type { MetadataRoute } from "next";
import { pagesInSidebarOrder } from "@/lib/docs-source";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const docs = pagesInSidebarOrder().map((page) => ({
    url: new URL(page.url, base).href,
    lastModified: new Date(`${page.data.lastReviewed}T00:00:00Z`),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
  return [{ url: base.href, lastModified: new Date(), changeFrequency: "weekly", priority: 1 }, ...docs];
}
```

`robots.ts` already points crawlers at `/sitemap.xml`; leave it.

- [ ] **Step 6: Make the export check read the three files.** Replace `web/scripts/check-out.ts` with
  (Task 6's script plus `llms.txt` and `llms-full.txt` in `REQUIRED` and the `INDEXES` block):

```ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocsIndexes, checkDocsPage, checkExport, checkLandingIsolation } from "../lib/check-out";
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
  "api/search",
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
  if (!existsSync(join(OUT, `md${url}.md`))) problems.push(`missing out/md${url}.md`);
}
// test/docs-ia.test.ts checks that every written page is in the IA; here, that the export has docs at all.
if (docsFiles.length === 0) problems.push("found no docs pages in out/");

// The same absolute URLs the routes write (both read siteUrl() from the same environment).
const INDEXES = ["llms.txt", "llms-full.txt", "sitemap.xml"];
if (INDEXES.every((f) => existsSync(join(OUT, f)))) {
  const urls = [...known].map((url) => new URL(url, siteUrl()).href);
  problems.push(...checkDocsIndexes({ llms: read("llms.txt"), llmsFull: read("llms-full.txt"), sitemap: read("sitemap.xml") }, urls));
}

if (problems.length > 0) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
console.log(`out/ is ready to deploy (landing and ${docsFiles.length} docs ${docsFiles.length === 1 ? "page" : "pages"} checked)`);
```

- [ ] **Step 7: Build and check the export.**
  Run: `cd web && npm run typecheck && npm test && NEXT_TELEMETRY_DISABLED=1 npm run build && npm run check:out`
  Expected: all PASS, then `out/ is ready to deploy (landing and 42 docs pages checked)`. Then check by hand:
  - `head -8 out/llms.txt` starts with `# Maat docs`, the `>` summary, the `llms-full.txt` line and
    `## Pages`, and every link starts with `http://localhost:3000/docs` (the local `siteUrl()`; on Vercel
    it is the production domain).
  - `grep -c "<loc>" out/sitemap.xml` prints `43` (the landing page and 42 docs pages).
  - `grep -c "^URL: " out/llms-full.txt` prints `42`, and `grep -c "<Fact" out/llms-full.txt` prints `0`.
  - `grep -o '<link rel="canonical"[^>]*>' out/docs/concepts/nine-checks.html` prints one canonical link
    ending in `/docs/concepts/nine-checks`.
  - Prove the new check bites: delete one docs `<url>…</url>` entry from `out/sitemap.xml` by hand, run
    `npm run check:out` and see `✗ sitemap.xml does not list …` naming that page, then rebuild
    (`npm run build`) so `out/` is whole again.

- [ ] **Step 8: Commit.**

```bash
git add web/lib/docs/markdown.ts web/lib/check-out.ts web/lib/docs-source.ts web/app/llms.txt web/app/llms-full.txt web/app/sitemap.ts web/scripts/check-out.ts web/test/docs-page.test.tsx web/test/check-out.test.ts
git commit -m "feat(web): publish llms.txt, llms-full.txt and a sitemap entry for every docs page"
```

---

### Task 20: Accessibility and Lighthouse

Gate 9 (spec §8): axe finds no serious or critical violation on the docs home, one concept, one guide and
one reference page, in both themes. The Lighthouse targets (Global Constraints) are checked by hand once,
because a score depends on the machine and does not belong in a test.

**Files:**
- Modify: `web/package.json`, `web/package-lock.json` (`@axe-core/playwright`)
- Create: `web/e2e/docs-a11y.spec.ts`

**Interfaces:**
- Consumes: the exported site and the Playwright web server from `web/playwright.config.ts`; the theme
  key `theme` in `localStorage` (Task 1's `DocsProvider`).
- Produces: nothing later tasks import.

- [ ] **Step 1: Install axe.**

```bash
cd web && npm install --save-dev --save-exact @axe-core/playwright@4.14.0
```

- [ ] **Step 2: Write the test** `web/e2e/docs-a11y.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The docs home and one page of each kind with the most varied markup: tables, steps, code, signatures.
const PAGES = [
  "/docs",
  "/docs/concepts/nine-checks",
  "/docs/guides/run-the-tests",
  "/docs/reference/mandate-vault",
] as const;

for (const theme of ["light", "dark"] as const) {
  for (const path of PAGES) {
    test(`${path} in ${theme} has no serious or critical axe violations`, async ({ page }) => {
      // next-themes reads the stored choice before first paint, the same as a returning reader.
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
      expect(blocking).toEqual([]);
    });
  }
}
```

- [ ] **Step 3: Run it.**
  Run: `cd web && NEXT_TELEMETRY_DISABLED=1 npm run build && npx playwright test e2e/docs-a11y.spec.ts`
  Expected: PASS (8 tests). A failure prints the rule id and up to five selectors. Fix the cause in the
  component or in `app/(docs)/docs.css` (most often `color-contrast` from a token, or a control without
  a name); never disable a rule, exclude a selector or filter the test.

- [ ] **Step 4: Run Lighthouse by hand on two pages.** In one terminal, serve the export:
  `cd web && npx serve -L -n --no-port-switching -l 4173 out`. In another:

```bash
cd web && mkdir -p ../.superpowers/lighthouse
for page in docs docs/reference/mandate-vault; do
  npx -y lighthouse@13.6.0 "http://localhost:4173/$page" --quiet --chrome-flags="--headless=new" \
    --only-categories=performance,accessibility,best-practices,seo \
    --output=json --output-path="../.superpowers/lighthouse/$(echo "$page" | tr / -).json"
done
node -e 'for (const f of ["docs", "docs-reference-mandate-vault"]) { const r = require(`../.superpowers/lighthouse/${f}.json`); console.log(f, Object.values(r.categories).map((c) => `${c.id} ${Math.round(c.score * 100)}`).join(", ")); }'
```

  Lighthouse emulates a phone with simulated throttling by default, which is the mobile run the targets
  name. Expected: Performance ≥ 90, Accessibility 100, Best Practices ≥ 95, SEO 100 on both pages. Below a
  target, open the JSON's failing audits and fix the page (a missing `alt`, a heading order, an image
  without size, an unused preload), then rebuild and run again. Write the four scores of both pages in
  the task report; they are not committed. Stop the server afterwards.

- [ ] **Step 5: Commit.**

```bash
git add web/package.json web/package-lock.json web/e2e/docs-a11y.spec.ts
git commit -m "test(web): check the docs for serious accessibility problems in both themes"
```

### Task 21: Link the landing page to the docs

The landing page gains a "Docs" link in the nav and the footer, and both "Verify in 5 minutes" buttons
open the docs quickstart instead of the README anchor. These are plain `<a>` links: `/` and `/docs` have
different root layouts, so a client-side transition is not possible and a prefetch would only waste a
request. Nothing else on the landing page changes.

Before starting, check whether `feat/mandate-simulator` has merged into `main` (`git log --oneline main -5`).
It also edits the landing page. If it has merged, rebase this branch onto `main` first
(`git rebase main`) and run `cd web && npm test` before Step 1.

**Files:**
- Modify: `web/lib/site.ts` (`docsUrl`, `quickstartUrl`; remove `evaluateUrl`)
- Modify: `web/components/sections/Nav.tsx`, `web/components/sections/Hero.tsx`, `web/components/sections/Footer.tsx`
- Modify: `web/test/top.test.tsx`, `web/test/page.test.tsx`, `web/test/site.test.ts`

**Interfaces:**
- Consumes: `IA_SLUGS` (`@/lib/docs/ia`, Task 6).
- Produces: `SITE.docsUrl = "/docs"`, `SITE.quickstartUrl = "/docs/get-started/quickstart"`.

- [ ] **Step 1: Update the tests first.**

In `web/test/top.test.tsx`, the nav expectation becomes:

```tsx
    expect(links).toEqual([
      ["maat", "#top"],
      ["How it works", "#how"],
      ["Refusals", "#reasons"],
      ["Ledger", "#ledger"],
      ["Mandate", "#mandate"],
      ["Docs", SITE.docsUrl],
      ["View on GitHub ↗", SITE.repoUrl],
    ]);
```

and the hero line becomes:

```tsx
    expect(screen.getByRole("link", { name: "Verify it in 5 minutes" })).toHaveAttribute("href", SITE.quickstartUrl);
```

In `web/test/page.test.tsx`, the footer list becomes:

```tsx
    expect(links).toEqual([
      ["Docs", SITE.docsUrl],
      ["Source on GitHub", SITE.repoUrl],
      ["Verify in 5 minutes", SITE.quickstartUrl],
      ["Fork evidence", SITE.forkEvidenceUrl],
      ["MIT License", SITE.licenseUrl],
      [SITE.xHandle, SITE.xUrl],
    ]);
```

In `web/test/site.test.ts`, replace the `it.each` over `evaluateUrl` and `forkEvidenceUrl` with:

```ts
  it("forkEvidenceUrl points at a README heading", () => {
    expect(SITE.forkEvidenceUrl.startsWith(`${SITE.repoUrl}#`)).toBe(true);
    expect(slugs).toContain(SITE.forkEvidenceUrl.split("#")[1]);
  });

  it("the docs links point at pages in the docs IA", () => {
    expect(SITE.docsUrl).toBe("/docs");
    expect(SITE.quickstartUrl).toBe("/docs/get-started/quickstart");
    expect(IA_SLUGS).toContain(SITE.quickstartUrl.slice("/docs/".length));
  });
```

and add `import { IA_SLUGS } from "@/lib/docs/ia";` to its imports.

- [ ] **Step 2: Run them and see them fail.**
  Run: `cd web && npx vitest run test/top.test.tsx test/page.test.tsx test/site.test.ts`
  Expected: FAIL: the nav has no "Docs" link, the hero still points at the README, and `SITE.docsUrl` is
  undefined.

- [ ] **Step 3: Change the site config.** In `web/lib/site.ts`, replace

```ts
  /** README anchors: the offline five-minute check, and the fork run behind the ledger rows. */
  evaluateUrl: `${REPO}#how-to-evaluate-maat-in-5-minutes`,
  forkEvidenceUrl: `${REPO}#base-mainnet-fork-evidence`,
```

with

```ts
  /** The docs center, and its offline five-minute check. Plain links: /docs has its own root layout. */
  docsUrl: "/docs",
  quickstartUrl: "/docs/get-started/quickstart",
  /** README anchor: the fork run behind the ledger rows. */
  forkEvidenceUrl: `${REPO}#base-mainnet-fork-evidence`,
```

- [ ] **Step 4: Change the three sections.**

`web/components/sections/Nav.tsx`: after the `LINKS.map(...)` block and before the GitHub pill, add a link
that stays visible on phones:

```tsx
        <a href={SITE.docsUrl} className="navlink">
          Docs
        </a>
```

`web/components/sections/Hero.tsx`: the first CTA becomes an internal link (no ↗):

```tsx
            <a className="pill-dark" href={SITE.quickstartUrl}>
              Verify it in 5 minutes
            </a>
```

`web/components/sections/Footer.tsx`: `LINKS` becomes

```tsx
const LINKS = [
  { href: SITE.docsUrl, label: "Docs" },
  { href: SITE.repoUrl, label: "Source on GitHub" },
  { href: SITE.quickstartUrl, label: "Verify in 5 minutes" },
  { href: SITE.forkEvidenceUrl, label: "Fork evidence" },
  { href: SITE.licenseUrl, label: "MIT License" },
  { href: SITE.xUrl, label: SITE.xHandle },
] as const;
```

- [ ] **Step 5: Run the unit tests, the build and the export check.**
  Run: `cd web && npm run typecheck && npm test && npm run build && npm run check:out`
  Expected: all PASS; `out/ is ready to deploy`. `grep -rn evaluateUrl web --include=*.ts --include=*.tsx`
  (from the repo root, excluding `node_modules`) prints nothing.

- [ ] **Step 6: Run the landing e2e at every width.**
  Run: `cd web && npx playwright test e2e/smoke.spec.ts`
  Expected: PASS. The nav gained one link; at 360 px it must still wrap without page scroll.

- [ ] **Step 7: Commit.**

```bash
git add web/lib/site.ts web/components/sections/Nav.tsx web/components/sections/Hero.tsx web/components/sections/Footer.tsx web/test/top.test.tsx web/test/page.test.tsx web/test/site.test.ts
git commit -m "feat(web): link the landing page to the docs and its five-minute quickstart"
```

### Task 22: Final verification and the owner's checklist

Nothing new is built here. This task proves the branch as a whole: every gate green, the landing page
changed only by Task 21's links, nothing in the diff that the repo must not hold, and the actions only the
owner can take written down for them.

**Files:**
- None, unless a step finds a defect. Fix it in the file at fault and commit the fix on its own with a
  message that says what it fixes.

**Interfaces:**
- Consumes: everything above; `.superpowers/docs-baseline/landing-compare.mjs` (Task 1).
- Produces: the final report to the owner.

- [ ] **Step 1: Run everything.**
  Run: `cd web && npm run verify && npm run e2e`
  Expected: all PASS; `out/ is ready to deploy (landing and 42 docs pages checked)`; the IA test "the
  whole IA has shipped" (Task 18b) among the passes; every `e2e/docs.spec.ts`, `e2e/docs-a11y.spec.ts`
  and `e2e/smoke.spec.ts` test green.

- [ ] **Step 2: Check the generated data is current.**
  Run: `cd web && npm run docs:gen && git status --short web/content/generated`
  Expected: no output.

- [ ] **Step 3: Compare the landing page with `main`.** Build `main` in a throwaway worktree (git-ignored,
  under `.superpowers/`), so the comparison holds even if this branch was rebased onto newer landing work
  in Task 21:

```bash
git worktree add --detach .superpowers/main-tree main
(cd .superpowers/main-tree/web && npm ci && NEXT_TELEMETRY_DISABLED=1 npm run build)
(cd web && node ../.superpowers/docs-baseline/landing-compare.mjs ../.superpowers/main-tree/web/out out)
git worktree remove --force .superpowers/main-tree
```

  (`--detach` works even when `main` is checked out elsewhere; `--force` is needed only because the build
  left `node_modules/` and `out/` in that throwaway tree.)
  Expected: exit 1 with exactly one problem, `✗ landing HTML changed`: no CSS problem, and `deltaGzip`
  under 1024. In the printed `htmlDifference`, `onlyInNew` and `onlyInBaseline` hold only Task 21's
  links: the nav's `<a href="/docs" class="navlink">Docs`, the hero's "Verify it in 5 minutes" link to
  `/docs/get-started/quickstart` (and the README link it replaced), and the footer's "Docs" and "Verify
  in 5 minutes" links. Anything else is a regression: find the task that caused it and fix it there.

- [ ] **Step 4: Check the diff holds nothing the repo must not.** From the repo root:

```bash
git status --short
git diff main --stat | tail -1
git diff main -- . ':!web/package-lock.json' | grep -nE 'BASE_RPC_URL=[^<]|alchemy\.com/v2/|quiknode\.pro/|infura\.io/v3/'
git diff main -U0 -- . ':!web/package-lock.json' | grep '^+' | grep -nP '[^\x00-\x7F]'
```

  Expected: `git status` shows only `?? docs/superpowers/roadmap/` (it stays untracked); the secrets grep
  prints nothing; every hit of the last grep is one of the docs symbols `·` `≤` `≥` `→` `↗` `−` `…` `✗`
  `✔` or `↓` (the decision-loop diagram), except the fixtures that exist to prove a check catches a
  character: `web/test/content-checks.test.ts` (`é`, `’`, `—`, `│`) and `web/test/docs-facts.test.ts`
  (the `–` in a regex over the spec). Any other letter outside basic Latin, in prose, a comment or a
  message, is a defect: rewrite the line in plain English.

- [ ] **Step 5: Read the docs the way each reader arrives.** Serve `out/` (`cd web && npx serve -L -n out`)
  and, at 360 px and at 1440 px, follow each of the five paths on the docs home (`<RouterCards>`) for
  three pages, using only the links on the page, in light and then dark. Check: every page names its
  status, its sources link to files on GitHub, no page claims anything is live, and each path ends
  somewhere useful. Note anything wrong as a fix (Step 1's rule applies), not as a remark.

- [ ] **Step 6: Report to the owner and stop.** Do not push, open a PR or merge. The report holds:
  - `git log --oneline main..HEAD`;
  - the Lighthouse scores from Task 20 for both pages;
  - Step 3's `htmlDifference`, as evidence that the landing page changed only by its links;
  - the owner's checklist (spec §10), which no agent may do:
    1. Enable GitHub private vulnerability reporting for `duongnq2798/maat` (Settings → Code security).
       Until then, "Report a vulnerability" asks reporters for a direct message to @maatonbase on X.
    2. After the owner approves the push, confirm the Vercel build, then open `/docs`, `/llms.txt` and
       `/sitemap.xml` on the production domain and check the links in `llms.txt` use that domain.
