# Maat Web: "Try to make it say no" simulator. Design Spec

- **Date:** 2026-11-08
- **Status:** awaiting owner approval
- **Builds on:** branch `feat/landing-clarity` (commit 122304f) and `docs/superpowers/specs/2026-11-07-maat-web-design.md`
- **Contract reference:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md` §3.1 (the nine ordered checks)

---

## 1. Goal & success criteria

**Problem.** The 2026-11-07 audit scored Product experience and Activation 4/15: a visitor can only replay two recorded moments, so there is nothing to *do* and nothing to share.

**Goal.** Let a visitor probe the default mandate themselves and get a result worth posting on X ("I tried to buy NVDAc on Saturday and Maat said no").

**Success criteria:**
1. A `#try` section on the landing page lets a visitor pick a token, a USD amount and a moment (ET date and time), and shows which of the nine checks pass or fail and the reason code, live.
2. Every check the simulator models can be made to fail from the UI: Token allowed, Market session, Size limits (per trade and daily), Concentration.
3. The page says clearly that this is a simulation of the default mandate and that the contract is the source of truth.
4. Every number comes from `web/content/facts.ts`; every rule and value the simulator mirrors is parity-tested against the Solidity source (§5).
5. Fully static and client-side: `output: "export"` stays; no RPC, wallet, analytics or third-party scripts; `npm run check:out` passes.
6. `npm run verify` and `npm run e2e` pass, including a new e2e test for the simulator.

**Not goals:** SELL, credit actions (SUPPLY, BORROW, REPAY, WITHDRAW_COLLATERAL), PAY_EXPENSE, the `FEED_24_5` session mode, live chain data, editing mandate values.

---

## 2. Approach

A pure TypeScript port of the checks that can be decided offline, in `web/content/`, plus one React client component. Parity tests read the Solidity source and the Foundry test vectors with the helpers in `web/test/helpers/solidity.ts`, as `web/test/facts.test.ts` already does. No new dependency.

Rejected:
- **Build-time codegen** from `MarketCalendar.sol` to JSON: still needs the logic port, adds a build step; parity tests do the same job.
- **Running the real Solidity in the browser** (EVM in JS): heavy bundle, new dependency, and checks 2–7 would still need mocked feeds and pools.

---

## 3. Model

### 3.1 What one simulated day is

The simulator models **one trading day** of the vault. The day starts from the fork run's state: **$200 USDC and no stock** (`agent/test/integration/deploy.ts`, `fund(200_000_000n)`). The visitor previews an intent, then may **Execute** it:

- An allowed BUY adds its amount to *spent today* and to the token's holding, and takes it from USDC.
- A refused BUY is logged in the day's tape, as the vault logs a refusal, and changes nothing else.
- Picking another date starts a new day from the same starting state. Changing the time keeps the day.
- The tape holds at most 10 entries; past that, Execute is disabled until the visitor resets the day.

### 3.2 Checks, in contract order

Order and labels come from `CHECK_LABELS` in `web/content/engine.ts`. The first failure stops the run; later rows are `SKIP · not reached`.

| # | Check | Simulator rule | Reason on failure |
|---|---|---|---|
| 1 | Token allowed | Token is in the basket (NVDAc, GOOGLc, AAPLc). "Other token" fails. | `TOKEN_NOT_ALLOWED` |
| 2 | Token not paused | Fixed PASS, fork value: transfers active | — |
| 3 | Vault policy | Fixed PASS, fork value: path authorized | — |
| 4 | Market session | `REGULAR` mode of `MarketCalendar.isOpen`: closed on a listed holiday, on Saturday and Sunday; otherwise open when `09:30 ≤ t < close`, where close is 16:00 or the day's early close | `MARKET_CLOSED` |
| 5 | Feed freshness | Fixed PASS, fork value: `FACTS.feedAgeSec` (14 s) ≤ `maxStalenessSec` | — |
| 6 | Multiplier stable | Fixed PASS, fork value: no change within the cooldown | — |
| 7 | DEX premium | Fixed PASS, fork value: `FACTS.premiumsBps[token]` ≤ `maxPremiumBps` | — |
| — | Balance (not one of the nine) | As in `MandateVault._check`, between checks 7 and 8: amount is 0, or more than the USDC left | `INSUFFICIENT_BALANCE` |
| 8 | Size limits | `amount ≤ perTradeCapUsd` and `spentToday + amount ≤ dailyCapUsd` | `SIZE_LIMIT` |
| 9 | Concentration | `(held + amount) × 10,000 / total > maxWeightBps` | `CONCENTRATION` |

Details:
- **Amounts** are kept in micro-USDC (6 decimals) and weights in whole bps, with Solidity's integer division (floor).
- **Spent today** is keyed by UTC day (`block.timestamp / 1 days`, as `MandateVault.today()`). Within session hours the UTC day and the ET date are the same, so this never changes a result; it is mirrored anyway.
- **Weight:** holdings are valued at cost, so the total stays at $200. The vault values them at the Chainlink price; with prices fixed in the simulator the two agree. The page says so.
- **Balance row:** shown only when it fails, as an unnumbered row between 7 and 8, with the reason meaning from `REASON_MEANING`.
- **Fixed rows** (2, 3, 5, 6, 7) carry a small "fork" tag: values measured on the Base fork at block 53,551,627.

### 3.3 Calendar

`web/content/calendar.ts` ports:
- `DateLib`: `daysFromCivil`, `civilFromDays`, `weekday`, `nthSunday`.
- `MarketCalendar`: `etOffsetSeconds` (DST from the second Sunday of March 07:00 UTC to the first Sunday of November 06:00 UTC), `localTime`, and `isOpen` for `REGULAR`.
- One helper the contract does not need: ET wall time to UTC timestamp, the inverse of `localTime`.

Data, in `FACTS`:
- `nyseSessionMin` (exists): open 570, close 960.
- `calendar` (new): holidays and early closes from the `MarketCalendar` constructor, with the names in its comments: Thanksgiving 2026-11-26, Christmas 2026-12-25, New Year 2027-01-01; early close 13:00 on 2026-11-27 and 2026-12-24.

**Date window:** from the fork day (2026-11-05) to the last date the calendar lists (2027-01-01). The date input is bounded to it, and the "Now" preset is hidden when the visitor's clock is outside it. Both ends are derived from `FACTS`.

### 3.4 New facts

Each one has a source string and a parity test (§5.1):
- `basket`: `["NVDAc", "GOOGLc", "AAPLc"]`, from `contracts/script/MaatConfig.sol` `basket()`.
- `calendar`: as in §3.3, from the `contracts/src/MarketCalendar.sol` constructor.
- `forkVaultUsd`: 200, from `agent/test/integration/deploy.ts` `fund(200_000_000n)`.

---

## 4. Interface

### 4.1 Placement

- A new section `#try` right after Refusals: the visitor has just read the reason codes and can now trigger them. Ledger follows with the recorded decisions.
- Nav gains "Try it" (`#try`), between Refusals and Ledger.
- The hero's secondary CTA changes from "How it weighs a trade" (`#how`) to **"Try to make it say no"** (`#try`). The primary CTA is unchanged.

### 4.2 Section

Heading (`SectionHeading`, split layout):
- Eyebrow: "Try it"
- Title: "Try to make it say no."
- Lead: "A simulation of the default mandate, running in your browser. Pick a stock, an amount and a moment. The contract is the source of truth."

Two columns from about 1024 px, stacked below.

**Left card, "Intent":**
- **Token:** segmented buttons with `aria-pressed`: NVDAc, GOOGLc, AAPLc, Other token.
- **Amount:** a `$` number input plus chips $10, $20, $50, $51, $100. $51 trips the per-trade cap; $100 trips both caps.
- **Moment:**
  - Preset chips: Thu 5 Nov · 10:30 (the fork), Sat 7 Nov, Fri 6 Nov · 19:00, Thanksgiving, Fri 27 Nov · 13:30, Now. A chip without a time sets 10:30 ET.
  - A date input bounded to the window, with the weekday shown next to it.
  - A time slider from 00:00 to 23:59 ET in 1-minute steps (arrow keys move one minute), with `aria-valuetext` such as "10:30 ET". Its track shades the session for the chosen day: 09:30–16:00, 09:30–13:00 on an early close, nothing on a weekend or holiday.

**Right card, "SIMULATOR · default mandate · not the contract":**
- Intent line "BUY NVDAc · $20", and the moment "Thu 5 Nov · 10:30 ET".
- The nine rows, styled as in `DecisionEngine` (PASS, FAIL, SKIP); fixed rows tagged "fork"; the balance row when it fails.
- Verdict in a live region: Allowed or Refused, the reason code, and the `REASON_MEANING` line on a refusal.
- Actions: **Execute** (`pill-dark`), **Post on X ↗** and **Copy link** (`pill-line`).
- **Today · <date>:** the tape (time, intent, verdict), "Spent today $X / $100", each token's weight against the 40% maximum, and **Reset day**.

**Footnote under the grid:**
- Simulated: market session, token allowlist, size caps, weight.
- Fixed at fork values: rows 2, 3, 5, 6, 7.
- The $200 starting balance; holdings valued at cost.
- The holidays and early closes the calendar lists.
- GitHub links to `contracts/src/MarketCalendar.sol` and `contracts/src/MandateVault.sol`.

### 4.3 Behavior

- **Default**, also the exported static HTML: NVDAc, $20, Thu 5 Nov 10:30 ET, **Allowed · OK** (the fork's allowed BUY), with the prompt "It says yes. Change one thing to make it say no."
- **Live preview:** every input change re-evaluates the nine checks at once against the current day state, as step 02 of How it works previews against the contract. Rows do not re-animate while the slider moves.
- **Execute** appends to the tape and re-evaluates the preview against the new state.
- **Share link:** `/?day=2026-11-07&at=1030&buy=NVDAc-50&tape=1030-NVDAc-50#try`.
  - Read from `location.search` after hydration (no `useSearchParams`), so the static HTML keeps the default.
  - Verdicts are always recomputed, never read from the link, so a link cannot fake a result.
  - Invalid parameters fall back to the defaults; a tape longer than 10 entries is cut.
- **Post on X:** a plain link to `https://x.com/intent/post` with the text prefilled (no script):
  - Refused: "I tried to buy $50 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: MARKET_CLOSED."
  - Allowed: "I asked Maat's simulator to buy $20 of NVDAc on Thu 5 Nov at 10:30 ET. All nine checks passed. Can you make it say no?"
  - Both followed by the share link.
- **Copy link:** writes the share link to the clipboard; if the clipboard is unavailable, shows the link in a read-only field.

### 4.4 Files

| File | Role |
|---|---|
| `web/content/calendar.ts` (new) | Calendar port, §3.3 |
| `web/content/simulator.ts` (new) | `evaluate`, `execute`, presets, share codec, X text |
| `web/content/facts.ts` | New facts, §3.4 |
| `web/components/Simulator.tsx` (new) | Client component |
| `web/components/sections/TryIt.tsx` (new) | Section, heading, footnote |
| `web/app/page.tsx`, `web/components/sections/Nav.tsx`, `web/components/sections/Hero.tsx` | Placement, §4.1 |
| `web/lib/check-out.ts` | Default simulator verdict present in the export |

Design system: Signal classes and tokens from `web/app/globals.css` (`card`, `pill-dark`, `pill-line`, `accent`, `refuse`). All copy and comments in English.

---

## 5. Testing

### 5.1 Parity with the contracts

- **`web/test/calendar.test.ts`** (node environment):
  - Holidays and early closes, with their names, parsed from the `MarketCalendar` constructor, equal `FACTS.calendar`.
  - The DST rule in `etOffsetSeconds` (`nthSunday(y, 3, 2) * 1 days + 7 hours`, `nthSunday(y, 11, 1) * 1 days + 6 hours`) matches the TypeScript constants.
  - **Foundry vectors:** every `uint256 internal constant NAME = N;` in `contracts/test/MarketCalendar.t.sol`, every `assertTrue/assertFalse(cal.isOpen(NAME, SessionMode.REGULAR))` in the tests that use the constructor's calendar (`test_regularSession`, `test_holidaysAndEarlyClose`), and every `assertEq(cal.etOffsetSeconds(N), H hours)` give the same result through the port.
  - The DateLib vectors in the same file, where they parse cleanly.
  - The ET to UTC helper round-trips with `localTime` across the whole date window.
- **`web/test/facts.test.ts`:**
  - `basket` against `MaatConfig.basket()`.
  - `forkVaultUsd` against `deploy.ts`.

### 5.2 Unit

- **`web/test/simulator.test.ts`:**
  - Every reachable reason: OK, TOKEN_NOT_ALLOWED, MARKET_CLOSED (weekend, holiday, before open, after close, early close), INSUFFICIENT_BALANCE (zero, over balance), SIZE_LIMIT (per trade, daily), CONCENTRATION.
  - Boundaries: 09:29 and 09:30, 15:59 and 16:00, 12:59 and 13:00 on 2026-11-27, a weight of exactly 40% passing.
  - The first failure stops the run.
  - **Parity with `engine.ts`:** simulating the fork's two rows (Thu NVDAc $20, Sat GOOGLc $10) gives the same marks and reasons as `MOMENTS.thu` and `MOMENTS.sat`.
  - Share codec: round trip, garbage falls back to the defaults, the tape is cut at 10.
  - X text for a refusal and for an allowed intent.
- **`web/test/simulator.test.tsx`** (Testing Library):
  - Renders Allowed by default.
  - The Sat 7 Nov preset gives MARKET_CLOSED.
  - Executing $50 of NVDAc twice gives CONCENTRATION.
  - Reset day clears the tape.
- **`web/test/page.test.tsx`:** the `#try` section, the nav link and the hero CTA.

### 5.3 Export and e2e

- **`npm run check:out`:** the exported HTML contains the simulator's default verdict (Allowed · OK), and the `#try` anchors resolve.
- **`web/e2e/simulator.spec.ts`:**
  - A scenario by mouse and keyboard: a preset gives a refusal; Execute $50 of NVDAc twice gives CONCENTRATION; an arrow key on the slider from 15:59 to 16:00 flips the verdict to Refused.
  - Opening a share link reproduces its refusal.
  - No console errors.
- **Fit:** the existing test (360 to 1920 px, no page scroll, no clipped `.card`) covers the new cards with no change.
