# Maat web

Public landing page for Maat (W1) and its docs center at `/docs`, in one static Next.js export.
Spec: `docs/superpowers/specs/2026-11-07-maat-web-design.md`. Approved comp: `docs/superpowers/specs/assets/2026-11-07-maat-landing-v2.dc.html`.
Docs center spec: `docs/superpowers/specs/2026-11-07-maat-docs-center-design.md`. Plan: `docs/superpowers/plans/2026-11-07-maat-docs-center.md`.

`/now` (Right now on Base) reads Base mainnet in the browser through `lib/live/`: one Multicall3 call over keyless public RPCs, judged like `MandateVault` for a BUY.

`/gap-index` (Weekend Gap Index) publishes one edition file per run in `content/gap-index/`, written by `npm run gap-index -- --edition N` from Base logs (`lib/gap/`).

A new edition file is also imported in `content/gap-index/index.ts`. After a window ends, each live feed must post its first update after the open, in a block at or before the run's head, before the window can be measured; until then the run names the feeds that have not and asks to run again later. The last live feed's first update came 232, 438 and 368 seconds after edition 0's three Monday opens (9, 16 and 23 November 2026), and 315 to 8,345 seconds after the other 11 regular opens from 6 to 25 November.

The run reads through the latest finalized block, so a window counts as ended only once a finalized block is at or after its open; until then it is written as pending. With `--complete` the run refuses instead, before it reads any log, and writes nothing. Base finalizes blocks in steps. In reads of both public RPCs every 10 seconds from 04:21 to 05:37 UTC on 26 November 2026, each step finalized 344 to 432 seconds' worth of new blocks, each new finalized block was first answered 816 to 946 seconds after it was made, and from 10 minutes in, the newest finalized block either RPC had answered so far was 816 to 1,344 seconds (13.6 to 22.4 minutes) old at each read. So a window can be measured no sooner than about 14 minutes after its open. A single answer can be older: some of the servers behind `https://base-rpc.publicnode.com`, the RPC the run reads its logs from, and behind `https://mainnet.base.org` kept answering an older finalized block, up to 2,614 and 3,089 seconds (43.6 and 51.5 minutes) old, and publicnode's answer went back to an older block than the one before it 87 times in 447 reads. So the run asks each of the two RPCs three times at once and reads through the newest finalized block any read answers, since no finalized block can reorg, and it prints that block, the RPC that answered it and how many reads answered. When no read answers, it asks all six again after 1 and then 2 seconds. In 72 reads every 10 seconds from 06:19 to 06:31 UTC on 26 November 2026, that head was 826 to 1,507 seconds old (median 1,026) and went back to an older block once, where a single read of publicnode, the run's head before, was 838 to 1,564 seconds old (median 1,256) and went back 11 times. With `--complete --wait MINUTES`, for up to that many minutes from its start, a run whose head is before the last open reads it again every 30 seconds, printing one line each and reading no log, then measures; when a live feed has not updated by the head, it reads the head the same way until Base finalizes a newer block, then measures again. A reread that no RPC answers keeps the head and costs one beat. Once the minutes pass, it refuses as it would without `--wait`. The run caches each span of logs it reads 1,000 or more blocks below its head as soon as it reads it, so a run that stops for a feed that has not updated yet leaves the next run little to read: edition 0's token rows took 389 to 441 seconds a window cold, and 14 to 33 seconds with its spans cached. Before it measures, it checks every window against the `MarketCalendar` of `deployments/README.md` with `isOpen` calls (`calendarChecks` in `lib/gap/windows.ts`), so a window may start on any weekday or after an early close. An edition whose entry in `content/gap-index/editions.ts` sets `decisions` also counts the vault's `Decision` events in each window, by sender as `/ledger` labels them. To reproduce a committed file byte for byte, pin its head block: `npm run -s gap-index -- --edition 0 --head 61273559 --stdout`.

`npm run gap-index -- --edition N --warm` measures nothing and writes nothing under `content/gap-index/`. It reads into the log cache, web/.cache/gap, which git ignores, through the measuring run's own read code and cache file names, the logs that run will read from spans that end 1,000 or more blocks below the finalized block, so a later run reads only the spans after them. An ended window is read as the measuring run reads it. A window still pending is read from its close through the finalized block, with each pool's swaps from its feed's last update before the close, where a freeze can start. A window that has not closed yet has nothing to read. For each window it prints every 50,000-block span (`SPAN` in `lib/gap/rpc.ts`) with how many of its files it read from Base and how many came from the cache, then how many span files the cache now holds for that window and its `eth_getLogs` calls. When it cannot write the file of a span that has settled, as with a full disk or a folder it cannot write, it says how many such files each span and window has and the first error, and once it has read every window it exits 1, as a later run would read those spans from Base again. It refuses `--complete`, a measuring run that writes the edition file, `--stdout`, as it has no edition to print, and `--no-cache`, as it would keep nothing. `--window`, `--token` and `--head` work with it. Edition 0 rehearsed it on 26 November 2026: warmed with `--head 61251000`, a block made at 13:29:35 UTC on 23 November while its last window was still pending, then measured with `npm run -s gap-index -- --edition 0 --head 61273559 --stdout`, which printed `content/gap-index/edition-0.json` byte for byte in 163 seconds.

**Edition 1 on Mon 30 Nov 2026.**

1. Run `npm run gap-index -- --edition 1 --warm` on Sun 29 Nov, then again at 13:05 UTC or a little later on Mon 30 Nov. At Base's 5 blocks a second, the open at 14:30:00 UTC is block 64,293,122: 2,043,000 blocks after block 62,250,122, the first block of Wed 25 Nov 21:00:00 UTC, which `--warm` found on 26 November. The open falls in the span 64,250,000-64,299,999, which starts at 12:06:15 UTC. The span before it ends at block 64,249,999, and a run keeps it once its head is block 64,250,999 or later, which Base makes at 12:09:35 UTC. With the reads above, the newest finalized block reaches it 816 to 1,344 seconds later, at 12:23 to 12:32 UTC, and even the oldest single answer measured, 3,089 seconds, reaches it by 13:02 UTC. The run prints the block it reads through, and its last line for window `2026-11-27` gives the block its last span file ends at: if that is below 64249999, it read an older finalized block, so run it again. No run before the open can keep the open's own span, since it ends after the open.
2. After that warm run, Monday's `--complete` run reads from Base only these; it reads everything else from the cache:
   - for each of the 13 tokens, the feed's updates and the pool's swaps from block 64,250,000 to its head. While its head is inside the open's span, at block 64,299,999 (made at 14:52:55 UTC) or lower, that is three `eth_getLogs` calls a token: the updates in the window, the search for the first update after the open, and the swaps.
   - the vault's `Decision` logs over both windows, which the cache does not keep: 15 calls for Thanksgiving's 747,000 blocks and 25 for the weekend's 1,233,000, then one transaction read for each `Decision`.
   - its `eth_call` reads (each feed's phases, `MarketCalendar` and the vault's owner) and the block headers that find each window's first and last blocks.
3. At 14:40 UTC, run `npm run gap-index -- --edition 1 --complete --wait 25`. It measures once its head is at or after the open at 14:30:00 UTC, block 64,293,122; with the reads above, the newest finalized block reaches it 816 to 1,344 seconds after the open, at 14:43:36 to 14:52:24 UTC. Until then it reads the head again every 30 seconds, prints how far it still is from the open and reads no log. If a live feed has not updated by that head, it waits the same way for Base to finalize a newer block and measures again: at the Monday opens above the last feed updated 438 seconds after the open at the latest, which a head 1,344 seconds old (1,507 in the 72 reads above) passes at 14:59:42 (15:02:25) UTC. If it still cannot measure 25 minutes after it started, at about 15:05 UTC, it refuses and writes nothing: run it again.

`/ledger` (the mainnet ledger) reads the vault the deployments table records, the Base mainnet `MandateVault`, from Base in the browser through `lib/chain/`; built from a table with no vault, it shows a waiting state instead ([Mainnet ledger](#mainnet-ledger)).

## Commands (run in `web/`)

| Command | What it does |
|---|---|
| `npm install` | install the pinned dependencies |
| `npm run dev` | dev server on http://localhost:3000 |
| `npm test` | unit, component and contract parity tests, and the docs gates ([Docs content](#docs-content)) |
| `npm run typecheck` | Next route types + `tsc --noEmit` |
| `npm run build` | static export into `out/` |
| `npm run check:out` | checks `out/`: the landing page (metadata, link targets, no third-party scripts, Saturday state in the HTML, the simulator's `#try` section and its default verdict, the live strip's reading state and no chain reading baked in), `/now` (metadata, its heading, its reading state and no chain reading baked in), `/gap-index` (metadata, its heading, the first measured window's NVDAc hours in the markup and no "safe"), `/ledger` (metadata, its connecting line and no chain reading baked in while the deployments table records a vault, the waiting state while it has none, and its sitemap entry), `/proof` (metadata, the counting rule in the markup, its static state against the deployments table, no robots rule and its sitemap entry), `/ask`'s own link preview image and every docs page ([what it checks](#what-checkout-checks)) |
| `npm run verify` | `typecheck` + `test` + `build` + `check:out`, in that order. It does not run the e2e tests |
| `npm run brand` | re-renders the logo, icons, OG image and X avatar/banner |
| `npm run card` | `npm run card -- <txhash>` draws the Weighing card of one vault Decision, read from Base, as a 1600x900 and a 1080x1350 PNG; `-- --fixture FILE` draws a fork, simulated or preview transaction instead, and `--out DIR` picks the folder ([Weighing card](#weighing-card)) |
| `npm run rationales` | `npm run rationales -- <journal.jsonl>` rewrites `content/generated/rationales.json`, the rationale text the mainnet ledger checks against each `rationaleHash` ([Mainnet ledger](#mainnet-ledger)) |
| `npm run snapshot` | reads the vault's logs from Base through `https://base-rpc.publicnode.com` (`-- --rpc <https URL>` for another keyless RPC), checks them against `https://mainnet.base.org` as a browser does (`-- --check <https URL>`), and rewrites the decisions snapshot in `content/generated/`, which a first read of the mainnet ledger starts from; `-- --fresh` scans from the deploy block instead of building on the committed file ([Mainnet ledger](#mainnet-ledger)) |
| `npm run docs:gen` | rewrites the reference data in `content/generated/` from the contracts, the agent and the deployments table ([Docs content](#docs-content)) |
| `npm run gap-index` | measures the Weekend Gap Index from Base logs and writes one edition file under content/gap-index/ (`-- --edition N`; to reproduce one figure run `npm run -s gap-index -- --edition N --window ID --token SYM --stdout`: `-s` keeps npm's banner out of the JSON; the head is the newest finalized block of three reads each of `https://base-rpc.publicnode.com` and `https://mainnet.base.org`, and logs are read from the first only; `--head BLOCK` reads through a finalized block instead of that head, `--complete` refuses to write unless every window is measured, `--complete --wait MINUTES` reads the head again every 30 s, for up to that many minutes, until it passes the last open and, when a live feed has not updated by it, until a newer one is finalized, and `--warm` only reads the logs a later run needs into its log cache and writes nothing) |
| `npm run e2e` | Playwright on `out/`: `e2e/smoke.spec.ts` and `e2e/simulator.spec.ts` for the landing page, `e2e/live.spec.ts` for the live strip and `/now` against the fake RPC of `e2e/fake-live-rpc.ts`, `e2e/now-week.spec.ts` for `/now`'s market week and the agent's note with a frozen clock in a closed window and an open one, `e2e/gap-index.spec.ts` for `/gap-index`, `e2e/ledger.spec.ts` for `/ledger` against the fake Base RPC of `e2e/fake-rpc.ts`, `e2e/ledger-snapshot.spec.ts` for a first read that starts from the decisions snapshot (its timing on the public RPC runs only with `MAAT_E2E_LIVE=1`), `e2e/proof.spec.ts` for `/proof` against the fake chain of `test/helpers/fake-proof-chain.ts`, `e2e/ask.spec.ts` for `/ask`'s send path and preview against the fake RPC of `e2e/fake-ask-rpc.ts`, `e2e/ask-weighing.spec.ts` for `/ask`'s feed of weighings, its counters and its link preview, against the same fake chain as `/proof` and a mocked agent journal, `e2e/nav.spec.ts` for the landing's nav and phone menu, which list the same pages, Now, Gap Index, Ledger and Docs, and add Ask and Proof after Ledger only when `content/ask-open.ts` is turned on, `e2e/docs.spec.ts` and `e2e/docs-a11y.spec.ts` for the docs. Run `npm run build` first: it serves the existing `out/` and does not build. Once per machine: `npx playwright install chromium` |

Keep Next's anonymous telemetry off when you build:

- Git Bash: `NEXT_TELEMETRY_DISABLED=1 npm run build`
- PowerShell: `$env:NEXT_TELEMETRY_DISABLED=1; npm run build`

Full local check: `npm run verify`, then `npm run e2e` (the build inside `verify` leaves the `out/` that e2e serves).

## Where the numbers come from

Every number on the page lives in `content/facts.ts` with a `source`. `test/facts.test.ts` reads the contracts and the fork test directly, so a contract change that moves a number fails the tests until the site is updated.

W1's decisions are only those of the labeled Base fork run. The mandate sheet's `mandateHash` chip is the `mandateHash()` of the vault the owner deployed on Base mainnet, shortened. A value that exists only once a decision is a mainnet transaction is shown as `[from mainnet tx]`, never as a made-up hash. The day the footer gives for the vault's deploy is the Date cell of the `MandateVault` row in `deployments/README.md`, read through `lib/chain/config.ts`; built from a table with no vault, the footer names no day.

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
| `content/generated/skill.json` | `skills/maat-market-guard/SKILL.md`, which `app/skill.md/route.ts` serves at `/skill.md` |

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
| **Deploy claims.** The table in `deployments/README.md` records the four Base mainnet addresses, so the test lists every line of every page, and of `lib/docs/abi.ts`, that still denies the deploy, and fails on any line it lists. Its other tests put such a line back into copies of pages and of `lib/docs/abi.ts`, fill the four rows with test values, and check that the list names each of those lines, and none while no row has an address. One more runs the real pages and `lib/docs/abi.ts` against the four rows filled with test values, so a line that still denies the deploy fails before the real addresses are written too | `test/docs-content.test.ts` |
| **Block components.** A table, diagram or other block component has a blank line before and after it; otherwise MDX puts it inside a paragraph | `check:out` |
| **Callouts.** `<Callout>` takes the type `note`, `warning` or `fork`; any other type fails the build | `components/docs/Callout.tsx` |
| **Words.** Prose uses the lines and names of `docs/brand/lexicon.md`, and none of the variants it retires, such as "the contract decides" or "frozen" for a feed. Code, link targets and comments are exempt | `test/lexicon.test.ts`, which reads the site's components and pages and the README too |

Conventions no test checks:

- Link a term to its glossary entry, `/docs/help/glossary#<id>`, on its first use in a page's prose. The links test checks only that the entry exists. On the page, the link previews the entry on hover and keyboard focus.
- A small number that comes from the code, such as the number of checks, goes through `<Fact>` too: the numbers test catches only distinctive ones.
- No test counts: nothing would keep them in sync.
- Command output on a page is copied from a real run and says what produced it. A placeholder looks like `<VAULT_ADDRESS>`.
- Every `<Callout>` has a `title`.
- A command that signs or broadcasts, such as `cast send` or `forge script --broadcast`, sits inside a `<Callout type="warning" title="Owner only">`.
- An `execute` command in such a callout also passes `--gas-limit` of at least `<Fact name="executeGasFloor" />` (`EXECUTE_GAS_FLOOR` in `agent/src/exec/calls.ts`). The callout says why, and links the Gas estimation section of `content/docs/security/not-claimed.mdx`: a plain gas estimate can record a false failure and use up the intent id. The number in each command is typed by hand inside a code fence, where the numbers rule does not look, and no test ties it to `EXECUTE_GAS_FLOOR`: when the floor changes, update the number after each `--gas-limit` in the code fences of `content/docs/`.

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
| a member of `Reason` | concepts/refusal-codes | a `### <CODE>` heading under its group's heading, with its Id line, and the code in `REASONS`, in the enum's order, in `REASON_GROUPS`, and in `REASON_LABEL` with a plain label of at most 32 characters and no underscore, in `content/reasons.ts` (`test/refusal-codes.test.ts`, `test/facts.test.ts`, `test/reason-label.test.ts`); also every line of `contracts/src` that returns it in `REASON_RAISED_AT`, and its line in `GUARD_CHECKLIST` with the matching row on concepts/agent-checklist (`test/reasons-json.test.ts`, `test/agent-checklist.test.ts`). A contract change that moves a line that returns a reason fails `test/reasons-json.test.ts` until `REASON_RAISED_AT` follows it |
| a setting in `agent/.env.example` | reference/agent-configuration | a `### <NAME>` heading with `<EnvVar name="<NAME>" />` directly under it |
| a script in `agent/package.json` | reference/agent-scripts | a `### <name>` heading with `<ScriptEntry name="<name>" />` directly under it |
| a `.ts` file in `agent/scripts` | reference/agent-scripts | a `### <file>` heading with `<ScriptFile name="<file>" />` directly under it |
| a folder at the top of the repository, or a file at its root | reference/repository-map | a row of its first table that links the folder to itself on GitHub, or the file's name in code (`test/docs-content.test.ts`) |

A contract is documented only while `DOCUMENTED_CONTRACTS` in `lib/docs/docs-data.ts` names it. A new one also needs its page in `FUNCTION_PAGES` in `test/docs-coverage.test.ts` and, if it has functions, in `FUNCTION_PAGES` in `lib/docs/remark-identifier-links.ts`, with `true` when its function headings name the contract, as on reference/adapters; without that entry the build fails.

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

It checks the `out/` the last build left and does not build, so run it after `npm run build`. It also reads `content/generated/abi.json` to compare the ABIs, `content/generated/skill.json` to compare `/skill.md`, the edition files in `content/gap-index/` for the NVDAc hours `/gap-index` must show, and, on CI or Vercel, the pages in `content/docs/` for the localhost URLs they write.

- The files a deploy needs, among them `index.html`, `now.html`, `gap-index.html`, `404.html`, `docs.html`, `ledger.html`, `proof.html`, `ask.html` and its card `/og/ask.png`, `sitemap.xml`, `llms.txt`, `llms-full.txt` and the search index.
- `/ask`'s link preview: its `og:image` and `twitter:image` both name `/og/ask.png`, not the landing's image, and that file is a 1200×630 PNG, as for a docs page.
- The landing page: `lang`, the title and description of `SITE` (`lib/site.ts`), an absolute Open Graph image, the X card, the Saturday verdict in the HTML, the simulator's `#try` section with its default verdict in its live region, the live strip's reading state with no LIVE pill, Basescan block link or verdict line in the HTML (the strip reads Base in the browser, so a reading in the export would be a stale one), a target for each `#` link, scripts only from `/_next/`, no Google Fonts, and no docs CSS or JS in its assets.
- `/now`, the Right now on Base page: `lang`, the title "Right now on Base · Maat", a description of 50 to 160 characters, an absolute canonical URL ending in `/now`, an absolute Open Graph image, its h1, the board's reading state with no LIVE pill, Basescan block link or verdict line in the HTML, a target for each `#` link, scripts only from `/_next/`, no Google Fonts, and an entry in `sitemap.xml`.
- `/gap-index`, the Weekend Gap Index page: `lang`, the title "Weekend Gap Index · Maat", a description of 50 to 160 characters, an absolute canonical URL ending in `/gap-index`, an absolute Open Graph image, its h1, the NVDAc hours of the first measured window in the markup with its inline scripts removed (the page is built from the committed edition files, so its figures must be in the HTML itself, for readers without JavaScript and for crawlers), no "safe" in any case anywhere in the HTML, a target for each `#` link, scripts only from `/_next/`, no Google Fonts, and an entry in `sitemap.xml`.
- Every docs page: `lang`, a title that ends in "· Maat Docs" (the docs home is "Maat Docs"), a description of 50 to 160 characters, an absolute canonical URL and `og:image`, scripts only from `/_next/`, no Google Fonts, no block element inside a paragraph, and links that lead to a heading of the page, an exported docs page or a file in `out/`.
- Each docs page's link preview image: a PNG of the size its tags give, named by both `og:image` and `twitter:image`.
- Each docs page's Markdown copy: no component tag left in place of its text, the index note first, and the status label, review date and Source of truth files of its page.
- `llms.txt`, `llms-full.txt` and `sitemap.xml` list every docs page, and `llms.txt` gives the status under its summary and links each page's Markdown copy.
- Each ABI under `out/data/abi/` holds the committed ABI.
- `skill.md`, the market-guard skill's instructions for other agents, is exactly the text of `skills/maat-market-guard/SKILL.md`.
- `reasons.json`, every refusal reason with its id, meaning, group, checklist line and the contract lines that return it, is what `reasonsFile` in `content/reasons.ts` writes.
- `/ledger`, the mainnet ledger: while the deployments table records a vault, its connecting line and no chain reading in the HTML (no "Reading Base mainnet" line and no Basescan transaction link: the page reads Base in the browser); the waiting state only while the table has none; a description of 50 to 160 characters, an absolute Open Graph image, a canonical URL ending in `/ledger`, a target for each `#` link, scripts only from `/_next/`, no Google Fonts, and a `sitemap.xml` entry.
- `/proof`, the counting rule and its counts: `lang`, the title "Proof · Maat", a description of 50 to 160 characters, an absolute canonical URL ending in `/proof`, an absolute Open Graph image, its h1, a sentence of the rule in the markup with its inline scripts removed, and no robots rule, since the page is public. While the deployments table records no MaatInbox, it says counting starts when the inbox is recorded, every brief line says "not deployed" and no wallet or brief is listed; once it records one, the reading state and no count in the HTML (the page reads the logs in the browser). Also a target for each `#` link, scripts only from `/_next/`, no Google Fonts, and a `sitemap.xml` entry.
- The search index stays within the gzipped budget in `lib/check-out.ts`, and every result opens an exported page and heading.
- On CI or Vercel only: no exported file links an `http://localhost` URL (see below).

### Mainnet ledger

`/ledger` has no server. The static HTML follows the deployments table the build read: the waiting state while the Base mainnet `MandateVault` row has no address, a connecting line once it has one. The committed table records the vault, so the export shows the connecting line. In the browser the page fetches `/data/deployments.json` (written from that table by `npm run docs:gen` and the build), and once it names a vault it reads Base directly through `lib/chain/`: a check that the address is a `MandateVault`, the treasury in one multicall at the latest block, the vault's logs from its deploy block (the table's Tx cell; without one, `SCAN_FLOOR_BLOCK` in `lib/chain/config.ts`) in chunks, newest first, and the block times and gas of new decisions. What it read is cached in `localStorage`, below a reorg margin.

- RPCs: `DEFAULT_RPCS` in `lib/chain/rpc.ts`, keyless and open to any origin. `NEXT_PUBLIC_BASE_RPC_URL`, if set at build time to an `https:` URL, is tried first; it ships to every visitor, so never put a private key or a paid key there.
- Rationale text: `/data/rationales.json`, from `content/generated/rationales.json`. To refresh it, run `npm run rationales -- <path to the agent's journal.jsonl>` and commit the file. The page shows a text only when its hash matches the one in the `Decision` event.
- Decisions snapshot: `/data/decisions-snapshot.json`, the file `npm run snapshot` writes in `content/generated/` (`null` while there is none). It holds every log of the vault from its deploy block to a finalized block N, and N's hash; no block time, gas or transaction. A first read uses it once Base gives the same hash for block N and the receipt of each log below N minus `SNAPSHOT_REORG_WINDOW` (`lib/chain/snapshot.ts`) holds that log as the file has it. It then takes those logs from the file, reads each Decision's time, gas and transaction from Base as for any other row, and scans only from there to the head. So the file can leave a log out but cannot add or change one. Without a snapshot, or with one that fails that check, it scans from the deploy block. A browser drops the logs it cached from a file once the site serves another file, or none. The build only copies the committed file and never asks Base for it, so a refresh is a data PR: run `npm run snapshot`, which reads Base, builds on the committed file and checks the result on a second RPC before it writes it, and commit what it writes. A cold read still scans every block from N minus the window to the head, and Base adds about 432,000 blocks a day, so refresh the snapshot once a day: `MAAT_E2E_LIVE=1` on `e2e/ledger-snapshot.spec.ts` prints how far the head is past N and how long a cold read takes with the file and without it.

### Site URL

`siteUrl()` in `lib/site.ts` is the base of every absolute link to the site that the export writes: canonical and Open Graph URLs, `robots.txt`, `sitemap.xml`, `llms.txt`, `llms-full.txt`, the Markdown copies, and the page URL that each docs page's feedback links quote in the issue they open. It takes `NEXT_PUBLIC_SITE_URL`, then the Vercel production domain (`VERCEL_PROJECT_PRODUCTION_URL`), then `http://localhost:3000`, so a local build links localhost. When `CI` or `VERCEL` is set, `check:out` fails if the site URL is a loopback address such as localhost, or if an exported file links a localhost URL that no docs page writes in its own text. Set `NEXT_PUBLIC_SITE_URL` to the public site and build again.

## Deploy (owner)

1. **Vercel:** Add New → Project → import this GitHub repo.
   - Root Directory: `web`.
   - Framework preset: Next.js.
   - Build Command: `npm run build && npm run check:out`. Vercel's default, `npm run build`, does not run `check:out`, so without this no deploy runs the checks in [What check:out checks](#what-checkout-checks) or the localhost checks in [Site URL](#site-url).
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
| `/og/ask.png` (not committed) | `/ask`'s own 1200×630 link preview: the mark and the line in `content/ask-card.ts`. `app/og/ask.png/route.ts` draws it with `renderAskOg` in `brand/render.tsx` when the site is built |
| `brand/out/x-avatar.png`, `x-banner.png` | X profile photo and header |
| `brand/out/favicon-32.png`, `icon-512.png`, `apple-icon-180.png` | icons (also copied into `app/`) |

The words live in `docs/brand/lexicon.md`, at the repository root: the approved lines, the names and the two lines on where the name comes from. `test/lexicon.test.ts` holds it to its lines and fails on a retired variant anywhere in the public copy.

The geometry lives in `brand/mark.ts`. Change it there and run `npm run brand`. A test fails if the committed SVGs no longer match. The OG image, its alt text and the X banner also show the Market closed label from `REASON_LABEL` in `content/reasons.ts`: after changing it, run `npm run brand` and commit the PNGs and `app/opengraph-image.alt.txt`.

## Weighing card

`npm run card -- <txhash> [--out DIR]` draws one vault Decision in one fixed frame, at the two sizes a post carries: 1600x900 and 1080x1350 (`brand/card.tsx`, `lib/card/`). Without `--out` the PNGs go to the build-in-public image folder at the repository root, which git ignores. The card is not a site page: nothing goes under `out/`.

It reads Base mainnet, read-only, through the ledger's keyless RPCs (`https://base-rpc.publicnode.com`, then `https://mainnet.base.org`):

- the transaction's receipt, sender and calldata, and its block's time;
- the vault's owner, for the sender label;
- every Decision log of the vault from its deploy block (the MandateVault tx in the deployments table) through this one, to number it;
- the token's decimals when the amount is in token units (a SELL, SUPPLY or WITHDRAW_COLLATERAL);
- the Brief logs of the MaatInbox in the deployments table, for the text of a brief that a verified blob adopts.

What the card prints:

| Part | From |
|---|---|
| Date line | the block's time in ET, with the session from `content/calendar.ts`: `Fri 27 Nov · early close 13:00 ET`, `Thu 26 Nov · Thanksgiving, NYSE closed` |
| Weighing № N | the Decision's place among every Decision of the vault, in chain order (block, then log index). The two operator Decisions of 24 Nov are № 1 and № 2 |
| Balance | as the landing draws it, tilted for a refusal. Ticks light only when the reason code is raised by exactly one of the nine checks: the checks before it pass and it fails. An allowed Decision, or a code no single check raises, lights none |
| Verdict | `Refused · Market closed (MARKET_CLOSED)`, with the label from `content/reasons.ts` |
| Intent | action, token and amount: `BUY · NVDAc · $5.00` |
| Sent by | the label of the `/ledger` chip: `owner, by hand`, `agent`, `probe` or `brief-driven`. Without one: `sender unknown`, or `sender not labeled` when the tx is not a direct `execute` call to the vault |
| Rationale | the maat:v1 text in the calldata. `hash verified` when its keccak256 is the Decision's `rationaleHash`, then an excerpt (below); `hash mismatch: text not shown`; or `no rationale in this tx`. The text is credited to `Maat's agent` only when the sender is `agent` or `brief-driven`; otherwise the card names the blob's model, as `/ledger` does |
| Bill | a PAY_EXPENSE reads `Compute bill paid · $1.00 · to the owner's allowlisted address`, with the real amount and payee, on a neutral plate, never as a trade |
| Brief | from a verified blob only, as `/ledger`'s Briefs: the brief id, its sender and text; `brief text not available` when the text was not read. The reply is in the agent's journal, which the card does not read: `reply not available`. A brief on the owner's `/ask` hide-list (`content/ask-hidden.ts`) shows `brief text hidden by the owner, as on /ask`, and its reply is not shown either |
| Footer | block, short tx, `Own treasury only. Not offered to US persons.` and `Every trade is weighed.` |

The excerpt starts with the sentences where the agent says it expects a refusal, whole while they fit; one too long to fit is cut around its refusal word. When a card's text would push the footer past the 48 px margin, the brief and its reply are cut shorter first, then the rationale, until it fits. A card that cannot fit is refused rather than drawn without its footer. The 1080x1350 card is the one for phones: no text on it is under 24 px, which is 8.3 px at a 375 px screen width.

`npm run card -- --fixture FILE` draws a transaction from a JSON file shaped like `test/fixtures/weighing-card-1.json`, with `kind` set to `fork`, `simulated` or `preview`. The card is not numbered and carries a band across the top: FORK REPLAY, SIMULATED or PREVIEW, NOT A DECISION. A `mainnet` file is refused: a mainnet Decision is read from Base by its hash.

The tests are `test/card-model.test.ts`, `test/card-render.test.ts`, `test/card-cli.test.ts` and `test/card-hidden.test.ts`. The card of № 1 must re-draw `test/fixtures/weighing-card-1-1600x900.svg` and `test/fixtures/weighing-card-1-1080x1350.svg` byte for byte. They are SVG because the PNG bytes can differ between operating systems. After a deliberate change to the card, rewrite them with `npx vitest run test/card-render.test.ts -u` and look at the PNGs before committing.
