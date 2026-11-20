# Readable Refusals and the Week Map. Design Spec

- **Date:** 2026-11-20
- **Status:** design approved by the owner in conversation on 2026-11-20 (labels, PR 1, PR 2, PR 3); this written spec awaits the owner's review
- **Lives at:** `web/` (the website and docs at `https://maatonbase.xyz`), plus `README.md`
- **Related:** `docs/superpowers/specs/2026-11-07-maat-web-design.md` (site), `docs/superpowers/specs/2026-11-07-maat-docs-center-design.md` (docs), `docs/superpowers/specs/2026-11-08-mandate-simulator-design.md` (simulator)

---

## 1. Problem and goal

**Problem.** The vault records every refusal as a typed reason code, the `Reason` enum in `contracts/src/Types.sol`
(`MARKET_CLOSED`, `PREMIUM_TOO_HIGH`, `MULTIPLIER_COOLDOWN`, and so on). The website shows these codes raw, often as
the main or only words a visitor reads: the simulator's tape says `Refused · CONCENTRATION`, its "Post on X" text ends
with `said no: MARKET_CLOSED.`, and the Refusals section uses the 19 codes as the titles of its items. A visitor who
does not read code cannot tell what happened.

**Goal.** Wherever an end user reads a refusal, a plain label comes first and the code stays beside it as a small,
muted tag. The code is kept because it is the onchain value: it is what a reader sees on Basescan and in the
reference docs, and "a refusal is a typed event" is the idea Maat is built on.

**Success criteria.**

1. No landing surface, simulator text, social image or newcomer or watcher docs page shows a reason code without its
   plain label next to it.
2. The code strings, the `data-reason` and `data-code` attributes, the anchors on `concepts/refusal-codes`
   (`#market_closed` and the rest) and the parity tests against `Types.sol` are unchanged.
3. Developer reference pages, verbatim code excerpts, the agent's logs and the contracts are unchanged.
4. Every label and every chart value comes from a recorded source: the contracts, `FACTS`, or `content/calendar.ts`.
   Nothing is invented.

## 2. Constraints found in the inventory

The inventory (five read-only agents, one per surface, plus a completeness critic, on `main` at `00f35e0`) and a
three-lens review of this spec found these load-bearing pieces. The design keeps them working:

- `test/facts.test.ts` compares `REASONS` with `enum Reason` in `contracts/src/Types.sol` and `REASON_GROUPS` with
  `REASONS`. `test/refusal-codes.test.ts` checks that `concepts/refusal-codes.mdx` has one `### CODE` heading with its
  Id line per entry of `REASONS`, grouped as `REASON_GROUPS`. The code strings never change.
- `lib/check-out.ts` checks the exported HTML for `role="status"` followed by a first child carrying
  `data-verdict="…"` and then `data-reason="<code>"`, for the hero's Sat 7 Nov moment and the simulator's default.
  The attribute order and the first-child position stay as they are; only the visible text inside changes.
- The 19 `### CODE` headings on `concepts/refusal-codes` produce the anchors that 20 hand-written links,
  `ReasonTable` and `remark-identifier-links.ts` (on the reference pages) point to.
- `decisionLabel()` in `content/decisions.ts` feeds the landing ledger (`components/LedgerTable.tsx`) and, through
  `forkLedger()` in `lib/docs/content-data.ts`, the docs ForkLedger in HTML (`components/docs/content.tsx`) and in
  Markdown (`lib/docs/component-text.ts`). `test/component-text-parity.test.tsx` keeps those two equal. ForkLedger
  appears on `get-started/read-a-decision` and `guides/reproduce-the-fork-run`.
- `lib/docs/flows.ts` drives both the HTML diagrams and their Markdown, `/md`, `llms-full.txt` and search copies.
- Code blocks titled `file#Lx-Ly` are checked line for line against the source (`test/docs-content.test.ts`) and are
  never edited.
- `web/brand/render.tsx` writes `brand/out/og.png` (the README hero), `app/opengraph-image.png`, its alt text and
  `brand/out/x-banner.png`. `test/brand.test.ts` pins the alt text and checks that the committed SVGs and alt text
  match a fresh render, but it checks the PNGs' sizes only, and CI never runs `npm run brand`. Stale PNGs would pass
  every gate, so PR 1 runs `npm run brand` and the reviewer opens each PNG.
- `test/readme.test.ts` requires every tracked file under `docs/superpowers/specs/` and `docs/superpowers/plans/` to
  be listed in the README's Documentation table.
- axe runs only on docs pages (`e2e/docs-a11y.spec.ts`), so nothing checks the landing's contrast today, while
  `web/README.md` sets a Lighthouse Accessibility target of 100.

## 3. The labels

A new `REASON_LABEL: Readonly<Record<ReasonCode, string>>` in `web/content/reasons.ts` holds one short label per code,
plus `OK`. A label names the rule. Where the contract also returns the code when it fails closed (a value it can't
read) or in a less common case, the note below lists it, and the full sentence under the label, `REASON_MEANING` or
`REASON_MEANING_DOCS`, covers it.

| Code | Label | Note |
| --- | --- | --- |
| `VAULT_PAUSED` | Vault paused | Repaying debt still goes through |
| `ACTION_NOT_SUPPORTED` | Credit not enabled | Returned only when the vault has no credit adapter |
| `TOKEN_NOT_ALLOWED` | Token not allowed | Also a stock the credit adapter doesn't support, the USDC leg of a credit action, and a BORROW against a supplied stock that is no longer allowed |
| `TOKEN_PAUSED` | Token paused | Also when the pause state can't be read |
| `POLICY_BLOCKED` | Blocked by token policy | Also when the token's policy or the policy registry can't be read |
| `MARKET_CLOSED` | Market closed | Also when the calendar can't be read |
| `FEED_STALE` | Price feed out of date | |
| `BAD_PRICE` | Bad price data | Zero, negative, undated or future answer; a feed or TWAP that can't be read or comes out zero; a mandate TWAP window of zero; a supplied collateral token with no feed |
| `MULTIPLIER_COOLDOWN` | Corporate action cooldown | A recent or scheduled multiplier change, or a multiplier that can't be read |
| `PREMIUM_TOO_HIGH` | Pool price too far from oracle | Above or below Chainlink |
| `SIZE_LIMIT` | Over the size limit | Per-trade or daily cap |
| `CONCENTRATION` | Too much in one stock | Also when the weight can't be measured: Aave collateral or debt unreadable, or debt at or above the vault's assets |
| `PAYEE_NOT_ALLOWED` | Payee not approved | |
| `INSUFFICIENT_BALANCE` | Not enough funds | More than the vault holds (USDC or the stock) or, for a collateral withdrawal, more than it supplied; includes an amount of zero |
| `SWAP_FAILED` | Swap failed | |
| `TRANSFER_FAILED` | Transfer failed | Includes a failed approval before a swap, a supply or a repay |
| `CREDIT_FAILED` | Aave call failed | Includes unreadable Aave account data |
| `HEALTH_FACTOR_LOW` | Health factor too low | |
| `DERISK_WINDOW` | Pre-pause safety margin | The last `deriskWindowSec` before 20:00 ET on a Friday, or on a Monday to Thursday followed by a listed holiday; also when the calendar can't be read |
| `OK` | All checks passed | Not "all nine": the count holds only for a BUY |

`REASON_MEANING.CONCENTRATION` gains the fail-closed case ("…, or its weight can't be measured."), as the docs meaning
already says.

A parity test requires `REASON_LABEL` to have exactly the keys `["OK", ...REASONS]`, each a non-empty string of at
most 32 characters with no underscore.

## 4. Shared pieces

- **`REASON_LABEL`** (above).
- **`reasonText(code)`** in `content/reasons.ts`: the plain-text form for places that can't hold markup (live-region
  sentences, the X post, alt text). It returns `"Market closed (MARKET_CLOSED)"`.
- **`<ReasonTag code tone layout />`** in `web/components/ui/ReasonTag.tsx`: renders the label, then the code in
  `font-mono text-[11px]`. `layout` is `stacked` (label over code, as `components/sections/Mandate.tsx` puts `label`
  over `k`) or `inline` (code after the label on one line). `tone` is one of:
  - `verdict`: on the ink or accent verdict box, white text, the code at the opacity the box's small labels already use;
  - `refuse`: in the refuse colour, on the refuse tint or on white;
  - `neutral`: the code in `text-ink-2`.

  The landing ledger does not use `ReasonTag`: its badge already holds the label, so the code sits beside the badge
  as a plain `<code>` in `text-ink-2`. (Amended 2026-11-20 with the PR 1 plan, which dropped an `accent` tone that no
  surface used.)

  Each pair keeps a contrast of at least 4.5:1, checked by an axe run on `/` added to `e2e/smoke.spec.ts`. The code
  stays in the accessible text; nothing is `aria-hidden`.
- **`decisionLabel(r)`** changes from `REFUSED · MARKET_CLOSED` to `Refused · Market closed` (and `Allowed · All
  checks passed`). The landing ledger renders it with the code as an inline tag. The docs ForkLedger cell reads
  `Refused · Market closed (MARKET_CLOSED)` in both HTML and Markdown, with the code in code formatting, so the parity
  test stays green.

## 5. PR 1: the landing, the simulator and the images

Branch `fix/web-readable-refusals`. This spec is committed on it, with its row in the README's Documentation table.

| Surface | File | Today | After |
| --- | --- | --- | --- |
| Hero decision engine | `components/DecisionEngine.tsx` | `Refused` … `MARKET_CLOSED`; `Allowed` … `OK` | `Refused` with a stacked `ReasonTag` on the right: **Market closed** over `MARKET_CLOSED`; the Thu moment shows **All checks passed** over `OK`. The outcome line stays |
| The problem, three cards | `components/sections/Problem.tsx` | red mono code top right | the label in the card's refuse colour, with the code under it |
| Refusals, 19 codes | `components/sections/Refusals.tsx` | code pill as the item title, meaning below | label as the item title, code as a muted tag beside it, meaning below; the `MARKET_CLOSED` highlight moves to the label; `data-code` stays |
| Landing ledger | `components/LedgerTable.tsx`, `content/decisions.ts` | `REFUSED · MARKET_CLOSED`, `ALLOWED · OK` | badge `Refused · Market closed` with the code as a tag; a refused row without a note shows `REASON_MEANING` for its code in the note column, and an allowed row without one leaves the cell empty (rows read from mainnet in W2 may have no note) |
| Docs fork ledger | `components/docs/content.tsx`, `lib/docs/component-text.ts` | `REFUSED · MARKET_CLOSED` in code | `Refused · Market closed (MARKET_CLOSED)`, the code in code formatting, the same in HTML and Markdown |
| Docs page quoting the ledger format | `content/docs/get-started/read-a-decision.mdx` | quotes `ALLOWED · OK` and `REFUSED · <reason>` (lines 26-27 and 120-121) | quotes the new format |
| Simulator verdict | `components/Simulator.tsx` | code beside `Refused`, meaning below | stacked `ReasonTag` beside `Refused`; meaning below as today; `OK` becomes **All checks passed** |
| Simulator tape and notice | `components/Simulator.tsx` | `Refused · CONCENTRATION` | tape: `Refused · Too much in one stock` with an inline code tag; notice: `…: Refused · Too much in one stock (CONCENTRATION)` via `reasonText` |
| Simulator "Post on X" | `content/simulator.ts` | `said no: MARKET_CLOSED.` | `said no: Market closed (MARKET_CLOSED).` via `reasonText` |
| How it works, decoded event | `components/sections/HowItWorks.tsx` | `reason MARKET_CLOSED` | unchanged value (the card shows the decoded log), plus a muted `// Market closed` after it |
| OG image and README hero | `brand/render.tsx`, `app/opengraph-image.*`, `brand/out/og.png` | `MARKET_CLOSED` beside `Refused` | **Market closed** with `MARKET_CLOSED` small under it; the alt text ends `…and the vault refuses: Market closed (MARKET_CLOSED).` |
| X banner | `brand/render.tsx`, `brand/out/x-banner.png` | badge `FAIL · MARKET_CLOSED` | badge `FAIL · Market closed` with `MARKET_CLOSED` small beside it |
| README | `README.md` | hero alt text (line 3), "Maat in 60 seconds" (line 54), two screenshots with their alt texts (lines 82-83) and caption (line 86) | each names the label next to the code; `docs/assets/readme/simulator-size-limit.png` and `fork-ledger.png` are retaken from a local build after the change; the Documentation table lists this spec and any plan file these PRs add |
| Web README | `web/README.md` | the row for a new member of `Reason` names `REASONS`, `REASON_GROUPS` and the refusal-codes heading | also requires its `REASON_LABEL` entry |

The `Reason reason` type in the How it works Solidity panel and every `data-*` attribute stay as they are.

**Owner step after merge:** upload the new `brand/out/x-banner.png` to @maatonbase on X.

## 6. PR 2: the docs

Branch `docs/readable-refusals`, cut from `main` after PR 1 merges (it uses `REASON_LABEL`).

**Rule.** On every page whose `audience` includes `newcomer` or `watcher`, a reason code is labelled: either its
`REASON_LABEL` text, compared case-insensitively, comes right before it with the code in brackets, as in "a BUY is
refused as market closed (`MARKET_CLOSED`)", or the code is the text of a link to its entry on
`concepts/refusal-codes`. Pages whose audience is only developers, builders and evaluators keep bare codes. On
`concepts/refusal-codes` itself, the entry headings, their Id lines and the All codes table are exempt.

1. **`concepts/refusal-codes`.** Each `### MARKET_CLOSED` heading becomes `### Market closed [#market_closed]`
   (Fumadocs custom heading ids, supported by the installed `fumadocs-core` 16.18.1), and its first line names the code
   and id. Anchors are unchanged. The readers of raw MDX headings learn the `[#id]` form: `test/refusal-codes.test.ts`,
   `headingIds()` in `lib/docs/content-checks.ts` (with a case in `test/content-checks.test.ts`),
   `repeatedHeadingIds()` in `test/docs-content.test.ts` and `heading()` in `test/docs-ia.test.ts`.
   `lib/docs/search-index.ts` needs no change: the processed Markdown drops the marker (`headingIds: false`) and the
   index takes anchors from the table of contents. The opening callout's bare codes get labels.
2. **Search.** A query that is a code (`MARKET_CLOSED`) still returns that code's entry first, through an alias record
   per code. The loose assertion in `e2e/docs.spec.ts` becomes exact. The empty-state hint
   (`components/docs/SearchDialog.tsx`) suggests a plain query first: `Try "market closed" or a code like MARKET_CLOSED`.
3. **`ReasonTable`** (`components/docs/content.tsx`, Markdown twin in `lib/docs/component-text.ts`) gains a first
   column, Reason, with the label. The Code column keeps the code as the link text.
4. **Pages that change under the Rule:** `help/faq`; `help/glossary` (the Premium, Preview, Refusal, Slippage floor and
   Staleness entries, whose hover previews appear on every page that links them and keep a link's text only, so they
   take labels rather than links); `get-started/how-a-decision-is-made`, `get-started/read-a-decision` and
   `get-started/status`; `concepts/nine-checks`, `concepts/market-hours` and `concepts/treasury-loop`;
   `guides/watch-decisions-onchain`; `security/not-claimed`; and the callout of `concepts/refusal-codes`.
   `get-started/what-is-maat` already follows the Rule and stays.
5. **Diagrams, for consistency.** The health factor scale (`HEALTH_FACTOR_SCALE` in `lib/docs/flows.ts`, drawn by
   `Scale` in `components/docs/diagrams.tsx`) titles its `DERISK_WINDOW` and `HEALTH_FACTOR_LOW` bands with their
   labels and moves each code into the detail line. The multiplier flow's caption names the label before
   `MULTIPLIER_COOLDOWN`; its step titles already have no code.
6. **A regression test** applies the Rule to every page whose audience includes `newcomer` or `watcher`. Code fences
   and excerpt blocks are exempt. `web/README.md` documents the `### <Label> [#<code>]` heading form and adds this rule,
   with its test, to "Rules the tests enforce".

Unchanged: the reference pages (`types`, `events`, `errors`, `mandate-vault`, `adapters` and the rest), excerpt-gated
blocks, the security pages' code excerpts, and the README's technical tables.

## 7. PR 3: the week map

Branch `feat/web-week-map`, cut from `main` after PR 1 merges.

**What it shows.** A full-width chart under the three cards of the Problem section: one row per day (Mon to Sun) and
one column per 30 minutes, New York time. Each slot shows what the market session check says for a BUY under the
default mandate (`FACTS.mandate.value.sessionMode`, `REGULAR`):

- **Session open:** the slot falls in the vault calendar's `REGULAR` session: Monday to Friday 09:30 to 16:00 ET, or
  to the early close, except the listed holidays.
- **Market closed:** any other slot. Its tooltip gives the reason in plain words, one per `regularSession()` case:
  weekend, the holiday's name, before the 09:30 open, after the close, or after an early close.

Two overlays explain the rest of the week:

- **Feed paused (assumed):** the hours the vault's `FEED_24_5` rule (`MarketCalendar.isOpen`) treats as closed:
  Friday 20:00 to Sunday 20:00 ET (`FACTS.feedEdgeMin.value`) and each listed holiday's whole New York day. The legend
  repeats the source's caveat: the schedule is assumed, not measured in the repository.
- **Pre-pause safety margin:** session-open slots where `_inDeriskWindow()` in `MandateVault.sol` is true. That
  window is the last `deriskWindowSec` (`FACTS.mandate.value.deriskWindowSec`, 8 hours by default) before 20:00 ET on
  a Friday, or on a Monday to Thursday whose next New York day is a listed holiday, and never on a Saturday or
  Sunday. Drawing it only on session-open slots shows where it can change an outcome: under the `REGULAR` mandate a
  BORROW, or a collateral withdrawal while there is debt, already needs the session open, so the margin matters from
  12:00 ET until the close. The legend says it applies to those two actions only, and that they then need the target
  health factor, not just the floor.

**Honesty.** A slot reports the market session check only. Its tooltip reads, for example, `Sat 10:30 ET · Market
session: Refused · Market closed (MARKET_CLOSED)` or `Tue 10:30 ET · Market session: passes`. It never says a trade
would be allowed, because the other checks also apply.

**Data.** Slots come from `regularSession()` and `sessionWindow()` in `content/calendar.ts`, the port the simulator
already uses. A new `inDeriskWindow(ts)` beside them ports `_inDeriskWindow()`, with unit tests for a Friday, a
Monday to Thursday before a holiday, a Sunday before a holiday (false), a window of zero, and both edges of the
window. The vault's own constant `FEED_FREEZE_MINUTE` gets a new `FACTS` entry, read from `MandateVault.sol` by
`test/facts.test.ts`, so the port has a recorded source. The calendar knows only the holidays and early closes that
`MarketCalendar`'s constructor seeds (`FACTS.calendar.value`, none after 1 Jan 2027); holidays the owner adds later
with `addHoliday` do not appear. The map shows what a freshly deployed vault would do, not the exchange's calendar.

**Which week.** The static HTML renders the fork-run week (Mon 2 to Sun 8 Nov 2026, which holds the Sat 7 Nov refusal)
so the build is deterministic. After hydration the chart switches to the viewer's current New York week only while
that week lies within `WINDOW` (`content/calendar.ts`), as the simulator's `clockNow()` does; otherwise it keeps the
fork-run week. When it shows the current week it draws a "now" line on today's row, refreshed every minute. The
heading names the week shown.

**Interaction and access.** Hover or tap on a slot shows its tooltip; slots are not focusable, so the chart has no
focusable content inside its `role="img"`. The SVG's accessible name summarises the week, and a visually hidden list
gives each day's session in words (for example `Thu 26 Nov: closed, Thanksgiving`), so keyboard and screen reader
users get the same facts.

**Build.** Hand-drawn SVG like `components/charts/WeekChart.tsx`, with the site's colour tokens; no chart library.
The existing WeekChart in the first card stays.

## 8. Testing and verification

For each PR:

- Unit tests (vitest) first, failing before the change: the `REASON_LABEL` parity test, `reasonText`, `ReasonTag`,
  the new `decisionLabel`, the `FEED_FREEZE_MINUTE` parity, and the slot and de-risk logic for PR 3.
- Update the tests that pin the old text, found by the inventory: `test/page.test.tsx`, `test/problem-how.test.tsx`,
  `test/decision-engine.test.tsx`, `test/decisions.test.ts`, `test/ledger-table.test.tsx`, `test/simulator.test.ts`,
  `test/simulator.test.tsx`, `test/brand.test.ts`, `test/docs-components.test.tsx`, `test/component-text.test.ts`,
  `test/component-text-parity.test.tsx`, `test/readme.test.ts`, `e2e/smoke.spec.ts`, `e2e/simulator.spec.ts` and
  `e2e/docs.spec.ts`, plus the heading readers named in section 6. Tests that read `data-reason` or compare `r.reason`
  values stay as they are.
- Add an axe pass on `/` to `e2e/smoke.spec.ts` (PR 1).
- Week map component tests pin the clock with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime`, as
  `test/simulator.test.tsx` does, and check both the static fork week and the switched week; any e2e assertion on the
  week's content sets the clock with `page.clock`.
- Run the whole web suite, the e2e suite, `next build` with the ship check (`lib/check-out.ts`), the docs checks, and
  `npm run brand` for PR 1, then open each re-rendered PNG.
- Look at every changed surface in the browser at desktop width and at 375 px.
- An adversarial review of the diff before the PR opens.
- One PR per branch to `main`; merge when CI `summary` is green and the diff is in scope.

## 9. Out of scope

- Dashboard charts and the live ledger: the W2 dashboard session builds them, and its reason display goes through
  one helper that switches to `REASON_LABEL` after PR 1 merges.
- The `Action` enum names (`BUY`, `WITHDRAW_COLLATERAL`, `PAY_EXPENSE`), which appear raw on some pages.
- The agent's journal and logs, the contracts, the ABI files and `/data/abi`.
