# Maat Docs Center. Design Spec

- **Date:** 2026-11-07
- **Status:** approved by the owner on 2026-11-07; §7 updated the same day with the spike's outcome
- **Lives at:** `https://maatonbase.xyz/docs`, built from this repo's `web/` app
- **Related:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md` (product), `docs/superpowers/specs/2026-11-07-maat-web-design.md` (site, Signal design system), root `README.md` (current long-form docs)
- **Reference studied:** `https://www.vestiarion.xyz/docs` (93 pages, MDX on Next.js; studied 2026-11-07)

---

## 1. Goal, readers and success criteria

**Goal.** A documentation center that lets any reader understand Maat in minutes, verify every claim against
the code, run it, and run their own copy, without asking the team. It must be the most trustworthy part of the
project: every statement traces to the implementation.

**Readers and what each needs first.**

| Reader | Arrives wanting to | First page | Must leave knowing |
| --- | --- | --- | --- |
| Newcomer | know what Maat is and why it matters | What is Maat | the problem, the one-sentence answer, where to go next |
| Watcher (follows the agent on X or the site) | understand a decision they saw | Read a decision | what each reason code means and how to check it onchain |
| Developer / judge | verify the claims and read the code | Quickstart: verify in 5 minutes | how to run the tests and where each guarantee is enforced |
| Builder | run their own vault and agent | Deploy your own vault | every step from fork to mainnet, the limits, the failure modes |
| Evaluator / partner | decide whether to trust or integrate it | Security model | the threat model, what is and is not guaranteed, the test evidence |

**Success criteria.**
1. **Newcomer test:** from `/docs`, a reader who has never heard of Maat can say what it does and why after
   reading one page (under 3 minutes), and every page ends by telling them what to read next.
2. **Developer test:** with only the docs, a developer can clone, run the offline tests, reproduce the fork
   run, and read any public function, event, error or reason code without opening the Solidity.
3. **Evaluator test:** the security pages state what the vault guarantees, what it does not, how each claim is
   tested, and the current deployment status, with links to the code and tests.
4. **No drift:** every number comes from `web/content/facts.ts` (or `web/content/docs-facts.ts`, for numbers only the docs cite, kept out of the landing bundle) or generated data that tests keep in sync with
   the contracts and agent; reference pages fail the build when a contract function, event, error, reason
   code or agent setting is undocumented.
5. **Quality bar:** works from 360 px to 1920 px with no horizontal page scroll; search answers a reason code,
   a function name or a setting in its first result; Lighthouse mobile on `/docs` and one long page:
   Performance ≥ 90, Accessibility 100, Best Practices ≥ 95, SEO 100; zero serious or critical axe violations.
6. **Static and private by default:** still a static export (`output: "export"`), no third-party scripts,
   no analytics, no cookies. `npm run check:out` covers the docs pages.

## 2. Honesty rules (binding for every page)

1. **Document only what exists.** Maat has no REST API, SDK, webhooks, API keys, rate limits or hosted
   service. The docs do not create pages for them. The planned x402 guard appears only on Status & roadmap,
   labelled Planned.
2. **Every page shows its status** with one of three labels: **Fork-tested** (exercised on a Base mainnet
   fork, not deployed), **Live on mainnet** (only after the owner deploys; none today), **Planned**.
3. **Every page lists its sources**: the contract, agent or test files that prove it (a "Source of truth"
   box with GitHub links to `main`).
4. **Numbers are never typed into prose.** They render through a `<Fact>` component reading `FACTS` or `DOCS_FACTS`, or
   through generated data with a sync test. A number that has no source does not go on the page. Test counts
   are not shown (nothing keeps them in sync); the docs tell readers how to run the suites instead.
5. **No invented outputs.** Command output shown on a page is copied from a real run and labelled with what
   produced it. Placeholders look like placeholders (`<VAULT_ADDRESS>`), never like real hashes or addresses.
6. **English only.** No other language anywhere in the docs, their history, file names or commit messages.

## 3. Information architecture

URL pattern: `/docs/<section>/<page>`. Sections map one to one to sidebar groups. Sidebar order is the order
below. Every page has frontmatter (§5.1).

### 3.0 Docs home: `/docs`
One screen: a two-sentence description of Maat, a five-card router (one card per reader in §1, each naming
its first page and what they will get), the decision diagram, and links to search, the GitHub repo and X.

### 3.1 Get started: `/docs/get-started/*`
| Page | Purpose | Primary sources |
| --- | --- | --- |
| `what-is-maat` | Problem (24/7 tokens, sleeping prices), answer (agent proposes, mandate decides), what exists today | README "The problem", "What Maat does"; product spec §1–2 |
| `how-a-decision-is-made` | The four-step loop with a diagram and the Saturday refusal as the worked example | README "How a decision is made"; `agent/src/loop/runOnce.ts`; `contracts/src/MandateVault.sol` `execute` |
| `quickstart` | Verify Maat in five minutes, offline: clone, submodules, the refusal test, the agent tests, the site tests, each with expected output | README "How to evaluate Maat in 5 minutes" (commands and outputs copied from it) |
| `read-a-decision` | Read a `Decision` event and a ledger row: fields, reason codes, gas, Builder Code | `IMandateVaultEvents.sol`; `web/content/decisions.ts`; fork test |
| `status` | What is fork-tested, what is next (mainnet), what is planned (x402 guard, dashboard), and what each step needs | README "Status", "Roadmap" |

### 3.2 Concepts: `/docs/concepts/*`
| Page | Purpose | Primary sources |
| --- | --- | --- |
| `mandate` | Every mandate field: meaning, default, unit, why that value, which check reads it | `Types.sol` `Mandate`, `TokenConfig`; `script/MaatConfig.sol`; `FACTS.mandate` |
| `nine-checks` | The checks in order, what each reads, the reason it returns, why the order matters | `GuardLib.checkMarket`; `MandateVault` preview path; `content/engine.ts` `CHECK_LABELS` |
| `refusal-codes` | All 19 codes: meaning, which actions can return it, where in the code, how the agent reacts | `Types.sol` `Reason`; `content/reasons.ts`; `agent/src/refusals.ts` |
| `market-hours` | NYSE regular session, holidays, early closes, the Friday feed edge, ET vs UTC | `MarketCalendar.sol`; `FACTS.nyseSessionMin`, `feedEdgeMin` |
| `prices-and-premium` | Chainlink equity feeds, the Aerodrome TWAP, premium in bps, staleness, the measured premiums | `PriceLib.sol`; `GuardLib.sol`; `FACTS.premiumsBps` |
| `splits-and-multiplier` | B20 `uiMultiplier`, change detection, the cooldown, fail-closed reads | `GuardLib.multiplierBlocked`; `syncMultiplier`; `FACTS.nvdaUiMultiplier` |
| `credit-and-health-factor` | Aave V4 supply and borrow, health factor floor and target, the de-risk window, repay while paused | `AaveV4CreditAdapter.sol`; `MandateVault` credit path |
| `timelock-and-roles` | Owner, executor, payees; queue, wait, apply, cancel; the grace window; what a leaked key can do | `MandateVault` queue/apply functions; README "Safety architecture" |
| `treasury-loop` | Buy, supply, borrow, pay its own bill; what is planned (earn) | `agent/src/policy.ts`; `TreasuryLoop.tsx` content |

### 3.3 Guides: `/docs/guides/*`
| Page | Goal of the reader | Primary sources |
| --- | --- | --- |
| `run-the-tests` | Run contract unit, contract fork, agent unit, agent fork and web suites; what each needs | README "Development"; package scripts; `foundry.toml` |
| `reproduce-the-fork-run` | Rerun the end-to-end agent fork test and read its trace and gas log | `agent/test/integration/*`; README "Base mainnet fork evidence" |
| `deploy-your-own-vault` | Deploy a vault with the default mandate on a fork, then on mainnet with their own keys | `deployments/README.md`; `script/Deploy.s.sol` |
| `configure-a-mandate` | Change limits, tokens, payees before deploy; the validation errors they will hit | `script/MaatConfig.sol`; `_requireValid*` in `MandateVault` |
| `run-the-agent` | Configure and run the agent loop: modes, settings, CDP wallet, Builder Code, cadence, daily caps | `agent/README.md`; `agent/src/config.ts`; `agent/src/main.ts` |
| `change-a-rule` | Queue a mandate, token or payee change, wait, apply or cancel, and verify the new hash | `queue*`/`apply*`/`cancelChange`; events |
| `pause-withdraw-recover` | The emergency playbook: pause, what still works, withdraw, unwind credit | `setPaused`, `withdraw`, credit rules |
| `watch-decisions-onchain` | Read `Decision` events with viem or `cast` (read only) | `IMandateVaultEvents.sol`; `FACTS.decisionEvent` |

### 3.4 Reference: `/docs/reference/*`
| Page | Content | Kept in sync by |
| --- | --- | --- |
| `mandate-vault` | Every external/public function: signature, who may call, effects, events, reverts or refusals | generated `contracts.json` + coverage test |
| `events` | Every event and its parameters | same |
| `errors` | Every custom error, when it is raised | same |
| `types` | `Intent`, `Mandate`, `TokenConfig`, `Action`, `Reason`, `SessionMode` | same |
| `market-calendar` | Public functions and the holiday table it encodes | same |
| `adapters` | `ISwapAdapter`, `ICreditAdapter`, the Aerodrome and Aave V4 adapters | same |
| `agent-configuration` | Every environment variable: required, default, effect | coverage test against `agent/src/config.ts` |
| `agent-scripts` | `npm run agent` and the other scripts, modes and exit behaviour | coverage test against `agent/package.json` |
| `base-addresses` | Tokens, feeds, pools, Aave spoke, with Basescan links | generated from `script/BaseAddresses.sol` |
| `default-parameters` | Every default with its unit and source file | `FACTS` |

### 3.5 Security: `/docs/security/*`
| Page | Content |
| --- | --- |
| `model` | What the vault enforces, in which code, and why the model cannot bypass it |
| `threat-model` | Assets, actors, leaked-key table (owner, executor, Claude key, CDP key), mitigations |
| `not-claimed` | What Maat does not claim: no audit, not deployed, known limitations, what can still go wrong |
| `testing` | How the guarantees are tested: suites, fork tests, parity tests; how to run them |
| `report-a-vulnerability` | How to report privately (see §10 owner action) |

### 3.6 Help: `/docs/help/*`
| Page | Content |
| --- | --- |
| `faq` | Grouped questions from newcomer to evaluator; each answer links to the page that proves it |
| `troubleshooting` | Symptom → cause → fix, only for problems that really happened: CRLF checkouts on Windows, Foundry older than 1.8.4, the Base anvil binary for B20, fork RPC settings, `eth_estimateGas` starving `execute`, submodules |
| `glossary` | Every term the docs use: B20, uiMultiplier, TWAP, bps, premium, health factor, ERC-8021 Builder Code, CDP, x402, NYSE session, feed edge, etc. |
| `changelog` | Milestones newest first (core contracts, credit, agent runtime, website, docs center), each with date, scope line and links |

**Not created, on purpose:** API reference, SDK, webhooks, authentication, rate limits, enterprise deployment.
None of these exist. If the x402 guard ships, it gets its own reference section then.

## 4. Page anatomy and writing standards

### 4.1 Common to every page
- Breadcrumb, H1, one-sentence lede that states what the reader will get.
- Header row: status label (§2.2), audience chips, reading time, "Last reviewed" date.
- Body in the template for its type (§4.2).
- "Source of truth" box listing the files that prove the page.
- "Next" block: one to three links chosen for the reader, then previous/next by sidebar order.
- Footer row: "Was this page helpful?" (§6.9), "Edit on GitHub", "Copy page as Markdown".

### 4.2 Templates
- **Concept:** what and why (2–3 sentences) → how it works (diagram or table) → worked example from the fork
  run → edge cases → what it does not do → related pages.
- **Guide:** goal, who it is for, prerequisites, time → numbered steps, each with the command and its
  expected output → "Check it worked" → common mistakes → next steps.
- **Reference:** summary table → one entry per item (signature, access, effects, events, reverts or
  refusals, example where useful) → related concepts.
- **Help:** FAQ as grouped Q&A; troubleshooting as symptom, cause, fix, and how to confirm the fix.

### 4.3 Writing rules
Plain English, second person, short sentences, active voice. Define a term on first use and link it to the
glossary. Lists for steps, tables for comparisons, prose for reasoning. No marketing filler. No page without a
purpose line and at least one concrete artifact (a table, diagram, command, example or code excerpt).

## 5. Content model

### 5.1 Frontmatter (validated by test)
```yaml
title: The nine checks
description: The order in which the vault checks a trade, and the reason each check returns.  # 50–160 chars
type: concept            # concept | guide | reference | help | overview
audience: [developer, evaluator]   # newcomer | watcher | developer | builder | evaluator
status: fork-tested      # fork-tested | live | planned
lastReviewed: 2026-11-07
sources:                 # repo paths; each must exist
  - contracts/src/GuardLib.sol
  - contracts/src/MandateVault.sol
```

### 5.2 MDX components
| Component | Does |
| --- | --- |
| `<Fact name="…" />` | Renders a value from `FACTS` or `DOCS_FACTS`; a typo fails the typecheck |
| `<Status />`, `<Audience />` | Header labels, from frontmatter |
| `<SourceOfTruth />` | Source box, from frontmatter `sources` |
| `<Callout type="note" \| "warning" \| "fork">` | Notes; `fork` marks content that ran on a fork only |
| `<Steps>` | Numbered guide steps |
| `<ReasonTable />` | All refusal codes with meanings, from `REASONS` and `REASON_MEANING` |
| `<MandateTable />` | The mandate rows, from `mandateRows(FACTS.mandate.value)` |
| `<FunctionTable contract="…" />`, `<EventTable />`, `<ErrorTable />` | Reference tables from generated data |
| Diagrams | Inline SVG React components: decision loop, architecture, timelock flow, treasury loop, market week. Each has a text alternative |

### 5.3 Generated data
`web/scripts/docs-gen.ts` (`npm run docs:gen`) parses the Solidity sources and writes committed JSON under
`web/content/generated/`: functions (name, params, returns, mutability, access modifier), events, errors,
enums, structs, and Base addresses. A test re-parses the sources and fails with "run npm run docs:gen" when
the committed JSON is stale, following the existing `fork-gas.json` pattern. The build never reads outside
`web/` at runtime.

## 6. UX and UI

1. **Layout:** header (logo, "Docs", search, theme toggle, GitHub, X), left sidebar by section, content
   column about 72 characters wide, right "On this page" table of contents with scroll spy.
2. **Design system:** Signal tokens and Geist / Geist Mono from the landing page. Docs add a dark theme
   (tokens defined for both, AA contrast checked); the landing page stays light only.
3. **Search:** Ctrl/Cmd+K and a header field; a static index built at export time, searched in the browser;
   results grouped by section with the matching heading; designed empty state ("No results for … Try a
   reason code like MARKET_CLOSED") and error state; keyboard navigable.
4. **Navigation aids:** breadcrumbs, previous/next cards, section landing lists, deep-linkable headings with
   copy-link anchors.
5. **Code blocks:** syntax highlighting at build time (bash, solidity, ts, json, text), file title, copy
   button, line highlighting for walkthroughs; long lines scroll inside the block.
6. **Reading comfort:** body 16–17 px, line height about 1.7, max line length about 72 characters, generous
   heading spacing; tables scroll horizontally inside their own region on small screens.
7. **Mobile:** sidebar becomes a drawer, table of contents becomes a collapsible "On this page" at the top;
   tap targets ≥ 44 px.
8. **States:** search loading, empty and error; a docs 404 page with search and the section list.
9. **Feedback without a backend:** "Yes" and "No" buttons open a prefilled GitHub issue (title
   "Docs feedback: <page> (helpful | not helpful)", body with the page URL and a prompt). No tracking.
10. **AI-readable:** `/llms.txt` (index of pages with one-line descriptions) and `/llms-full.txt` (all pages
    as Markdown), plus "Copy page as Markdown" on every page.

## 7. Architecture

- **Framework:** Fumadocs (`fumadocs-core`, `fumadocs-ui` 16.x and `fumadocs-mdx` 15.x; peer `next 16.x`)
  inside the existing Next.js 16 app. Versions are pinned exactly, as for the rest of `web/`.
- **Files:**
  - `web/content/docs/<section>/<page>.mdx` plus `meta.json` per section for sidebar order
  - `web/source.config.ts`: MDX collection and frontmatter schema
  - `web/lib/docs-source.ts`: the page tree and lookup
  - route groups give the landing page and the docs separate root layouts: `web/app/(site)/` holds the
    landing page, `web/app/(docs)/layout.tsx` the docs root layout (providers, theme, docs styles)
  - `web/app/(docs)/docs/layout.tsx`: docs layout (header, sidebar)
  - `web/app/(docs)/docs/[[...slug]]/page.tsx`: page renderer, metadata, static params
  - `web/app/global-not-found.tsx`: the 404 page, since two root layouts cannot share `not-found.tsx`
  - search, `llms.txt` and `llms-full.txt` as statically generated routes
  - `web/components/docs/*` for the components in §5.2 and the diagrams
- **Isolation from the landing page:** docs styles and providers load only under `/docs`. The landing page's
  HTML and CSS must not change beyond the added "Docs" links, and its first-load JavaScript may grow by at
  most 1024 B gzip. The spike measured 876 B: Next splits its own router code differently once the app has
  a second root layout; none of it is docs code. The plan's spike decision record has the details.
- **Static export:** every docs route has static params; the search index is a static file; no route needs a
  server at request time.
- **Fallback:** if the spike (§9, Phase 1 task 1) shows Fumadocs cannot meet the isolation, export or
  `check:out` criteria, build the same IA, components and tests on `@next/mdx` with Shiki and MiniSearch
  instead. The content and tests do not change.

## 8. Keeping docs true: quality gates

All run in `npm run verify` (unit and build) or `npm run e2e`.

1. **Frontmatter:** schema valid; description 50–160 characters; every `sources` path exists in the repo.
2. **Links:** every internal link and anchor resolves; GitHub links point at paths that exist on `main`.
3. **Generated data in sync** with the Solidity sources (§5.3).
4. **Coverage:** every function, event, error, enum member, reason code, agent environment variable and
   agent script has a documented entry.
5. **Facts:** numbers render from `FACTS` and `DOCS_FACTS`. A lint over the MDX flags hand-typed copies of distinctive fact
   values (gas figures, the fork block, dollar caps, bps limits, the multiplier), so they cannot drift.
6. **Language:** `web/content/docs` is plain English; a check rejects letters outside basic Latin except an
   allowlist of symbols the docs use (·, ≤, ≥, →, ↗, −).
7. **Export:** `check:out` extended to every docs page: no third-party scripts, internal links have targets,
   titles and descriptions present.
8. **End to end:** docs home and a long page fit 360, 768, 1024, 1440 and 1920 px with no page scroll and no
   console errors; search finds `MARKET_CLOSED`, `queueMandate` and `MAAT_MODE` first; mobile drawer opens
   and closes by keyboard; theme toggles and persists; copy button copies.
9. **Accessibility:** axe on docs home, one concept, one guide and one reference page: no serious or
   critical violations.

## 9. Phases

**Phase 1: foundation and learning path.**
1. Spike: Fumadocs in the static export with Signal theme, dark mode and static search; prove landing
   isolation and `check:out`. Decide Fumadocs or fallback, and record the decision in the plan.
2. Docs layout, header, search, theme, feedback, edit link, copy as Markdown, 404.
3. Components: `Fact`, `Status`, `Audience`, `SourceOfTruth`, `Callout`, `Steps`, `ReasonTable`,
   `MandateTable`, the decision-loop and architecture diagrams.
4. Gates 1, 2, 5, 6, 7, 8.
5. Pages: docs home, Get started (5), Concepts (9), Glossary, FAQ.

**Phase 2: build and reference.**
1. `docs-gen` and the generated data with its sync test (gate 3).
2. Reference (10) with coverage tests (gate 4).
3. Guides (8).

**Phase 3: trust and polish.**
1. Security (5), Troubleshooting, Changelog.
2. `llms.txt`, `llms-full.txt`, sitemap entries for every docs page, per-page metadata and canonical URLs.
3. Axe (gate 9) and the Lighthouse targets.
4. Landing integration: "Docs" in the nav and footer; the hero's "Verify it in 5 minutes" points to
   `/docs/get-started/quickstart`.

Each phase ends green on `npm run verify` and `npm run e2e`, is committed on its own, and is pushed or merged
only with the owner's approval.

## 10. Owner actions

- Enable GitHub **private vulnerability reporting** for `duongnq2798/maat` (Settings → Code security) before
  the "Report a vulnerability" page ships. Until then that page asks reporters to send a direct message to @maatonbase on X and not to open a public issue.
- Confirm the Vercel project builds from the recreated repository (the next push shows it).

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Fumadocs styles or providers leak into the landing page | Spike measures it first; fallback in §7 |
| Content drifts from code after later plans (guard service, dashboard) | Generated data, coverage tests, `lastReviewed`, and a rule that every product PR updates the affected pages |
| Docs overstate readiness before mainnet | Status labels on every page; the honesty rules in §2 are reviewed per page |
| Concurrent landing work (simulator branch) conflicts with Phase 3 landing links | Phase 3 lands after that branch merges, or rebases onto it |
| Search index grows the docs bundle | Index loads on first search only, not on page load |
