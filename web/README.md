# Maat web

Public landing page for Maat (W1) and its docs center at `/docs`, in one static Next.js export.
Spec: `docs/superpowers/specs/2026-11-07-maat-web-design.md`. Approved comp: `docs/superpowers/specs/assets/2026-11-07-maat-landing-v2.dc.html`.
Docs center spec: `docs/superpowers/specs/2026-11-07-maat-docs-center-design.md`. Plan: `docs/superpowers/plans/2026-11-07-maat-docs-center.md`.

## Commands (run in `web/`)

| Command | What it does |
|---|---|
| `npm install` | install the pinned dependencies |
| `npm run dev` | dev server on http://localhost:3000 |
| `npm test` | unit, component and contract parity tests, and the docs gates ([Docs content](#docs-content)) |
| `npm run typecheck` | Next route types + `tsc --noEmit` |
| `npm run build` | static export into `out/` |
| `npm run check:out` | checks `out/`: the landing page (metadata, link targets, no third-party scripts, Saturday state in the HTML) and every docs page ([what it checks](#what-checkout-checks)) |
| `npm run verify` | `typecheck` + `test` + `build` + `check:out`, in that order. It does not run the e2e tests |
| `npm run brand` | re-renders the logo, icons, OG image and X avatar/banner |
| `npm run docs:gen` | rewrites the reference data in `content/generated/` from the contracts, the agent and the deployments table ([Docs content](#docs-content)) |
| `npm run e2e` | Playwright on `out/`: `e2e/smoke.spec.ts` for the landing page, `e2e/docs.spec.ts` and `e2e/docs-a11y.spec.ts` for the docs. Run `npm run build` first: it serves the existing `out/` and does not build. Once per machine: `npx playwright install chromium` |

Keep Next's anonymous telemetry off when you build:

- Git Bash: `NEXT_TELEMETRY_DISABLED=1 npm run build`
- PowerShell: `$env:NEXT_TELEMETRY_DISABLED=1; npm run build`

Full local check: `npm run verify`, then `npm run e2e` (the build inside `verify` leaves the `out/` that e2e serves).

## Where the numbers come from

Every number on the page lives in `content/facts.ts` with a `source`. `test/facts.test.ts` reads the contracts and the fork test directly, so a contract change that moves a number fails the tests until the site is updated.

W1 shows only the labeled Base fork run. Values that exist only after the mainnet deploy are shown as `[after deploy]` and `[from mainnet tx]`, never as made-up hashes.

## Docs content

The docs center is one MDX file per page, `content/docs/<section>/<page>.mdx`, which Fumadocs renders into the same export as the landing page.

**Every change to the contracts, the agent or the site updates the docs pages it affects, in the same change.** The tests below catch part of the drift: a function, event, error, setting or script with no reference entry, generated data that is out of date, a fact whose value moved in the code, an excerpt whose lines changed, and a cited test that is gone. No test can tell when a sentence stops being true, so read the pages your change touches. The honesty rules in §2 of the docs center spec bind every page.

### Check a change

1. Run `npm run docs:gen` after any change to the files it reads (below), and commit the files it rewrites. While a committed file is out of date, `test/docs-gen.test.ts` fails and names it.
2. Run `npm run verify`: the typecheck, the tests, the build and `check:out`, in that order.
3. Run `npm run e2e`, which serves the `out/` that `verify` leaves.

| `docs:gen` writes | From |
|---|---|
| `content/generated/contracts.json` | the functions, events and errors of the contracts that `DOCUMENTED_CONTRACTS` in `lib/docs/docs-data.ts` names, and the enums and structs in `contracts/src/Types.sol` |
| `content/generated/base-addresses.json` | `contracts/script/BaseAddresses.sol` |
| `content/generated/deployments.json` | the table in `deployments/README.md` |
| `content/generated/agent.json` | the settings in `agent/.env.example` with their defaults in `agent/src/config.ts`, the scripts in `agent/package.json`, and the `.ts` files in `agent/scripts` |
| `content/generated/tests.json` | the line each test starts on, in `contracts/test` and `agent/test` |
| `content/generated/abi.json` | `agent/src/abi/generated.ts`, which `npm run gen:abi` writes in `agent/` |

### Frontmatter

`lib/docs/frontmatter.ts` holds the schema. `test/docs-content.test.ts`, `test/docs-ia.test.ts` and `test/docs-frontmatter.test.ts` check every page against it.

| Field | Rule |
|---|---|
| `title`, `description` | Exactly the page's entry in `lib/docs/ia.ts`. A description has 50 to 160 characters |
| `type` | One of `concept`, `guide`, `reference`, `help`, `overview` |
| `audience` | One or more of `newcomer`, `watcher`, `developer`, `builder`, `evaluator` |
| `status` | One of `fork-tested`, `live`, `planned`, shown as Fork-tested, Live on mainnet and Planned. The table on the status page says what each means. The docs home and the Help pages show no label |
| `lastReviewed` | The day the page was last checked against the code, as YYYY-MM-DD. Every page's header but the docs home's shows it, and `sitemap.xml` gives it as the page's last change |
| `sources` | Paths from the repository root that prove the page; each must exist. They fill the Source of truth box |
| `next` | One to three pages to read next, each a page of `lib/docs/ia.ts` named by its path, such as concepts/nine-checks. A section's own page has none. Two pages may not name each other as their first `next` page. A page with its own Next steps or Related section ends with it, and links there every page `next` names |

### Rules the tests enforce

| Rule | Checked by |
|---|---|
| **Numbers.** A distinctive number (three or more digits, a dollar amount or a bps value) that is the text of a fact may not be typed into prose: render it with `<Fact name="..." />`. Code, JSX tags and frontmatter are exempt, and so is a fact whose text is a date. A `<Fact>` name that does not exist fails too | `test/docs-content.test.ts` |
| **Characters.** Outside fenced code, a page holds printable ASCII and `·` `≤` `≥` `→` `↗` `−` only | `test/docs-content.test.ts` |
| **Links.** A `/docs/...` link opens a page of `lib/docs/ia.ts` and, after `#`, a heading that page has. A link to the repository on `main` names a path that exists | `test/docs-content.test.ts`, and `check:out` for the links in the HTML |
| **Headings.** No two headings on a page share an id | `test/docs-content.test.ts` |
| **Excerpts.** A code block that quotes a file opens at the start of a line, with a title such as `contracts/src/GuardLib.sol#L44-L62` (the path from the repository root, then the lines), and holds exactly those lines | `test/docs-content.test.ts` |
| **Cited tests.** A `test_...` name in code is a Solidity test in `contracts/test`, and a link whose text is a test name goes to the file that defines it. Text in double quotes in the same line or table cell as a link to a file in `agent/test` is an `it()` or `describe()` title in that file; a phrase in code beside that link, or beside the file's name in code, is a title or a string of that file | `test/docs-content.test.ts` |
| **Agent messages.** Each message in the first column of the table under Agent scripts' "Messages the agent prints" heading is one string in `agent/src` or `agent/scripts`, word for word, with a placeholder such as `<PID>` for each value the code fills in | `test/docs-content.test.ts` |
| **Deploy claims.** Once a Base mainnet row of the table in `deployments/README.md` has an address, the test lists every line of every page, and of `lib/docs/abi.ts`, that still says nothing is deployed, and fails until each is rewritten | `test/docs-content.test.ts` |
| **Block components.** A table, diagram or other block component has a blank line before and after it; otherwise MDX puts it inside a paragraph | `check:out` |
| **Callouts.** `<Callout>` takes the type `note`, `warning` or `fork`; any other type fails the build | `components/docs/Callout.tsx` |

Conventions no test checks:

- Link a term to its glossary entry, `/docs/help/glossary#<id>`, on its first use in a page's prose. The links test checks only that the entry exists. On the page, the link previews the entry on hover and keyboard focus.
- A small number that comes from the code, such as the number of checks, goes through `<Fact>` too: the numbers test catches only distinctive ones.
- No test counts: nothing would keep them in sync.
- Command output on a page is copied from a real run and says what produced it. A placeholder looks like `<VAULT_ADDRESS>`.
- Every `<Callout>` has a `title`.
- A command that signs or broadcasts, such as `cast send` or `forge script --broadcast`, sits inside a `<Callout type="warning" title="Owner only">`.
- An `execute` command in such a callout also passes `--gas-limit` of at least `<Fact name="executeGasFloor" />` (`EXECUTE_GAS_FLOOR` in `agent/src/exec/calls.ts`). The callout says why, and links the Gas estimation section of `content/docs/security/not-claimed.mdx`: a plain gas estimate can record a false failure and use up the intent id.

### Add a number

1. Put the value and its `source`, the file and the name the code gives it, in `DOCS_FACTS` in `content/docs-facts.ts`. A number the landing page shows too goes in `FACTS` in `content/facts.ts` instead.
2. Add a check to `test/docs-facts.test.ts` (or `test/facts.test.ts`) that reads that file and compares the value, so the tests fail when the code changes it. A figure the repository cannot prove, such as the planned x402 price, cites the document it comes from.
3. Add its text, a plain label and, for a setting, the place in the code that sets it, to `FACT_TEXT` in `lib/docs/fact-text.ts`. `<Fact name="..." />` renders that text, and `test/docs-facts.test.ts` checks that the place in the code exists.
4. Add its name to one `<FactTable names={[...]} />` on `content/docs/reference/default-parameters.mdx`: `test/docs-coverage.test.ts` wants every name of `FACT_TEXT` there exactly once. A table holds settings only, each with its place in the code, or figures only.

### Reference entries

When the code gains something public, its reference page needs an entry, or a test fails: `test/docs-coverage.test.ts`, unless its row below names another. `test/docs-coverage.test.ts` reads the names from `content/generated/`, so run `npm run docs:gen` first.

| The code gains | Page | Entry |
|---|---|---|
| a function of `MandateVault` or `MarketCalendar` | reference/mandate-vault or reference/market-calendar | a `### <name>` heading with `<Fn contract="<Contract>" name="<name>" />` directly under it |
| a function of `ISwapAdapter`, `AerodromeSwapAdapter`, `ICreditAdapter` or `AaveV4CreditAdapter` | reference/adapters | a `### <name> (<Contract>)` heading with `<Fn contract="<Contract>" name="<name>" />` directly under it |
| an event | reference/events | `<EventEntry contract="<Contract>" name="<Event>" />`; the events of `IMandateVaultEvents` go under `MandateVault` |
| an error | reference/errors | `<ErrorEntry contract="<Contract>" name="<Error>" />` |
| an enum or struct in `contracts/src/Types.sol` | reference/types | `<TypeEntry name="<Name>" />` |
| a member of `Reason` | concepts/refusal-codes | a `### <CODE>` heading under its group's heading, with its Id line, and the code in `REASONS`, in the enum's order, and in `REASON_GROUPS` in `content/reasons.ts` (`test/refusal-codes.test.ts`, `test/facts.test.ts`) |
| a setting in `agent/.env.example` | reference/agent-configuration | a `### <NAME>` heading with `<EnvVar name="<NAME>" />` directly under it |
| a script in `agent/package.json` | reference/agent-scripts | a `### <name>` heading with `<ScriptEntry name="<name>" />` directly under it |
| a `.ts` file in `agent/scripts` | reference/agent-scripts | a `### <file>` heading with `<ScriptFile name="<file>" />` directly under it |
| a folder at the top of the repository, or a file at its root | reference/repository-map | a row of its first table that links the folder to itself on GitHub, or the file's name in code (`test/docs-content.test.ts`) |

A contract is documented only while `DOCUMENTED_CONTRACTS` in `lib/docs/docs-data.ts` names it. A new one also needs its page in `FUNCTION_PAGES` in `test/docs-coverage.test.ts`.

### Add a page

1. Write `content/docs/<section>/<page>.mdx` with the frontmatter above.
2. Add the page, with its title and description, to its section in `DOCS_IA` (`lib/docs/ia.ts`), where it goes in the sidebar.
3. Add its file name, without `.mdx`, to `pages` in the section's `meta.json`, in the same order. `meta.json` also holds each group separator, such as `---Contracts---`, and each link to another section's page, where the section's `groups` and `links` in `lib/docs/ia.ts` put them; `test/docs-ia.test.ts` compares the two.
4. Add `<section>/<page>` to `SHIPPED` in `test/docs-ia.test.ts`.
5. If the page is long, or shows a table, diagram or card no listed page has, add its URL to `PAGES` in `e2e/docs.spec.ts` (no page scroll and no console error at each width in `WIDTHS`) and to `PAGES` in `e2e/docs-a11y.spec.ts` (axe, in the light and the dark theme).
6. If the page's `audience` names a reader its section's `index.mdx` does not, add that reader there, in the order of `AUDIENCES` (`lib/docs/frontmatter.ts`): `test/docs-ia.test.ts` wants a section's own page written for exactly the readers of its other pages. A new Help page shows no status label, so it also goes in the list of pages without one in `test/docs-frontmatter.test.ts`.

The page's card on its section page, its previous and next cards, its search records, its Markdown copy, its link preview image and its lines in `llms.txt`, `llms-full.txt` and `sitemap.xml` are all built from the page, with nothing to add.

A new section is a folder with a `meta.json` and its own `index.mdx`: titled like the section, `type: overview`, `status: fork-tested`, no `next`, the audiences of all its pages in the order of `AUDIENCES` (`lib/docs/frontmatter.ts`), and a body of one sentence and then `<SectionIndex section="<dir>" />`. It also needs a section in `DOCS_IA` that starts with that page, the folder in `content/docs/meta.json`, and a row in `SECTIONS` in `e2e/docs.spec.ts`.

### Add a component

A component that prints data on a page, such as a reference entry, a table or a diagram, is a self-closing tag whose props are literal values. Besides the component itself, it needs:

1. Its entry in `getMDXComponents` in `components/docs/mdx.tsx`, so pages can use it.
2. Its name in `DATA_COMPONENTS` in `lib/docs/data-components.ts`. `test/data-components.test.ts` fails on a tag a page uses, or a component `getMDXComponents` registers, that the list leaves out, and on a name in the list that no page uses or `getMDXComponents` does not register.
3. Its text in the Markdown copies, in `COMPONENT_TEXT` in `lib/docs/component-text.ts`, built from the tag's props. Without it the typecheck and `test/component-text.test.ts` fail. `check:out` also fails on any tag of `DATA_COMPONENTS` left in a Markdown copy.

A component that wraps Markdown text, such as `<Callout>`, stays out of `DATA_COMPONENTS`, because its tag stays in the copies around that text. Add it to `KEPT` in `test/data-components.test.ts` instead.

### What check:out checks

It checks the `out/` the last build left and does not build, so run it after `npm run build`. It also reads `content/generated/abi.json` to compare the ABIs, and, on CI or Vercel, the pages in `content/docs/` for the localhost URLs they write.

- The files a deploy needs, among them `index.html`, `404.html`, `docs.html`, `sitemap.xml`, `llms.txt`, `llms-full.txt` and the search index.
- The landing page: `lang`, the title and description of `SITE` (`lib/site.ts`), an absolute Open Graph image, the X card, the Saturday verdict in the HTML, a target for each `#` link, scripts only from `/_next/`, no Google Fonts, and no docs CSS or JS in its assets.
- Every docs page: `lang`, a title that ends in "· Maat Docs" (the docs home is "Maat Docs"), a description of 50 to 160 characters, an absolute canonical URL and `og:image`, scripts only from `/_next/`, no Google Fonts, no block element inside a paragraph, and links that lead to a heading of the page, an exported docs page or a file in `out/`.
- Each docs page's link preview image: a PNG of the size its tags give, named by both `og:image` and `twitter:image`.
- Each docs page's Markdown copy: no component tag left in place of its text, the index note first, and the status label, review date and Source of truth files of its page.
- `llms.txt`, `llms-full.txt` and `sitemap.xml` list every docs page, and `llms.txt` gives the status under its summary and links each page's Markdown copy.
- Each ABI under `out/data/abi/` holds the committed ABI.
- The search index stays within the gzipped budget in `lib/check-out.ts`, and every result opens an exported page and heading.
- On CI or Vercel only: no exported file links an `http://localhost` URL (see below).

### Site URL

`siteUrl()` in `lib/site.ts` is the base of every absolute link to the site that the export writes: canonical and Open Graph URLs, `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, the Markdown copies, and the page URL that each docs page's feedback links quote in the issue they open. It takes `NEXT_PUBLIC_SITE_URL`, then the Vercel production domain (`VERCEL_PROJECT_PRODUCTION_URL`), then `http://localhost:3000`, so a local build links localhost. When `CI` or `VERCEL` is set, `check:out` fails if the site URL is a loopback address such as localhost, or if an exported file links a localhost URL that no docs page writes in its own text. Set `NEXT_PUBLIC_SITE_URL` to the public site and build again.

## Deploy (owner)

1. **Vercel:** Add New → Project → import this GitHub repo.
   - Root Directory: `web`.
   - Framework preset: Next.js.
   - Node.js version: 24.x.
   - No environment variables are needed for the first deploy.
2. **Deploy.** The site works on its `*.vercel.app` URL, and the OG and Twitter cards use that URL automatically.
3. **Custom domain:**
   - after buying the domain, add it under Project → Domains and set the DNS records Vercel shows;
   - set `NEXT_PUBLIC_SITE_URL=https://<domain>` for Production;
   - redeploy, so the cards point at the domain.
4. **X (@maatonbase):** upload `brand/out/x-avatar.png` as the profile photo and `brand/out/x-banner.png` as the header.
5. **Before announcing:** run Lighthouse on the production URL (Chrome DevTools → Lighthouse → Mobile, all categories). Targets:

   | Category | Target |
   |---|---|
   | Performance | ≥ 90 |
   | Accessibility | 100 |
   | Best Practices | ≥ 95 |
   | SEO | 100 |

## Brand files

| File | Use |
|---|---|
| `brand/src/mark.svg`, `mark-light.svg`, `lockup.svg` | vector logo (dark tile, outlined tile, mark + wordmark) |
| `brand/out/og.png` | 1200×630 link preview (also `app/opengraph-image.png`) |
| `brand/out/x-avatar.png`, `x-banner.png` | X profile photo and header |
| `brand/out/favicon-32.png`, `icon-512.png`, `apple-icon-180.png` | icons (also copied into `app/`) |

The geometry lives in `brand/mark.ts`. Change it there and run `npm run brand`. A test fails if the committed SVGs no longer match.
