# Maat Web W1: Public site & brand. Design Spec

- **Date:** 2026-11-07
- **Status:** awaiting owner approval
- **Original spec:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md` (§3.6 Dashboard, §5 Compliance)
- **Approved comp:** the v2 "Signal" version on the Design canvas (private). A source copy is stored in the repo at `docs/superpowers/specs/assets/2026-11-07-maat-landing-v2.dc.html`. This is the **canonical reference** for layout, copy, colors and numbers. The file uses the canvas `.dc.html` format (`{{hole}}`, `<sc-for>`, `class Component extends DCLogic`), so the implementer reads it as a drawing and does not run it directly.

---

## 1. Goals & success criteria

**Goal:** have a public Maat page **as early as possible**. The page helps to:
- start building in public on X (@maatonbase) with an official link;
- settle the brand early: logo, avatar, X banner, OG image;
- let judges understand the product in about 10 seconds: *the agent knows when not to trade*.

**Success criteria (W1):**
1. A single-page landing site that matches comp v2 (same sections, copy, numbers, colors and fonts), works from 360 px to 1920 px, and has no horizontal scrollbar.
2. The Decision engine in the hero is interactive. The "Sat 7 Nov" button shows **Refused · MARKET_CLOSED** (step 4 FAIL, steps 5–9 SKIP). The "Thu 5 Nov · 10:30" button shows **Allowed · OK** (all 9 steps PASS).
3. Every number on the page has its source recorded in code (§5.4). Every number that can be checked against the contract has an automated parity test.
4. Lighthouse (mobile): Performance ≥ 90, Accessibility = 100, Best Practices ≥ 95, SEO = 100.
5. The full set of brand assets (§6) exists as source SVGs and pre-exported PNGs.
6. The build produces a static site (`next build` with `output: "export"`). The owner only needs to import the repo into Vercel to deploy it.

**Not goals of W1:**
- reading live mainnet data;
- wallet connection or SIWE;
- dashboard, diary, replay page;
- Base App mini-app manifest;
- x402.

These belong to W2/W3 (§10). W1 must not block them.

---

## 2. Design direction "Signal" (approved)

The concept is unchanged from v1: the Ma'at scale, Allowed set against Refused, a public ledger of decisions. The visual language shifts to tech: clean and trustworthy, so that both crypto and fintech judges find it familiar.

### 2.1 Design tokens

| Token | Value | Used for |
|---|---|---|
| `bg` | `#FFFFFF` | page background |
| `surface-soft` | `#F6F7F9` | alternating sections, secondary blocks |
| `surface-head` | `#FBFBFC` | card/table header |
| `line` | `#E6E8EC` | borders, rules |
| `line-soft` | `#F1F2F5` | table row dividers, segmented control background |
| `line-strong` | `#D5D8DF` | outline button border |
| `ink` | `#0B0D12` | primary text, black buttons, code panel |
| `ink-2` | `#5A6170` | secondary text (6.2:1 on white) |
| `ink-3` | `#8A90A0` | small ordinal numbers. **Use only for decorative text ≤ 11 px that comes with another label** |
| `ink-body` | `#3D4350` | text in chips/strips |
| `accent` | `#1F3BFF` | accent color, PASS, Allowed (6.7:1 on white) |
| `accent-tint` | `#EEF1FF` | Allowed/PASS badge background |
| `accent-soft` | `#DCE2FF` | feed bars in charts |
| `refuse` | `#C2410C` | FAIL, Refused, reason code (5.2:1 on white) |
| `refuse-tint` | `#FFF1EA` | FAIL row background, Refused badge |
| `refuse-hatch` | `#F3B79A` | diagonal hatching for the "frozen" region |
| `code-key` / `code-type` | `#8EA2FF` / `#7DD3C0` | syntax highlighting in the black code panel |

- **Corner radius:** card 20 px, child block 14 px, badge 6–8 px, pill 999 px.
- **Shadow:** only the Decision engine card has a shadow: `0 1px 0 line, 0 30px 80px -30px rgba(11,13,18,.28)`.
- **Hero and footer background:** a 56 px grid in `#EEF0F4`, with a radial mask so it fades out toward the edges. The hero also has a radial blue glow `rgba(31,59,255,.10)` in the top-right corner.

### 2.2 Typography

- **Geist** (400/500/600/700) for all text. **Geist Mono** (400/500/600) for numbers, labels, code.
- Loaded with `next/font/google` and self-hosted at build time, so there is no call to Google at runtime.
- **Sizes:**
  - H1: `clamp(52px, 6.2vw, 86px)`, line-height 0.98, letter-spacing −0.05em, weight 600.
  - H2: `clamp(40px, 4.6vw, 64px)`, letter-spacing −0.04em.
  - Lead: 19–20 px, line-height 1.6, color `ink-2`.
  - Eyebrow: mono 12 px, uppercase, tracking 0.08em, color `accent`.

### 2.3 Motion

- **Decision engine check rows:** fade + translateY 6 px keyframe, 420 ms, `cubic-bezier(.2,.7,.2,1)`. Row *i* has a delay of `0.12 + 0.16·i` seconds.
- **Verdict block:** "stamp" (scale 0.96 → 1.01 → 1), 500 ms, delay 1.65 seconds.
- **Replay:** each time the toggle is clicked, the animation restarts from the beginning by changing the list's `key`.
- **"Live" dot:** pulses on a 2-second cycle in the announcement bar.
- `prefers-reduced-motion: reduce` disables all animation; content appears immediately in its final state.

### 2.4 Logo

- **Mark 30×30:**
  - an `ink` square, radius 9;
  - a white scale, made of a post, a base and a beam;
  - a **feather** in `#6E83FF` hanging on the left;
  - a white **square block** on the right, representing the trade order.
- **Wordmark:** lowercase "maat", Geist 600, tracking −0.03em.
- **Tagline:** "Every trade is weighed." appears in the footer and on the X banner.

---

## 3. Page structure & content

Copy is in English, taken **verbatim** from comp v2. Section order:

| # | Section | Main content | Interaction |
|---|---|---|---|
| 0 | Announcement bar | live dot + "Tested on a Base mainnet fork" · "Mainnet launch is next. Every decision below was recorded on that fork." · link "Follow the build" → x.com/maatonbase | none |
| 1 | Nav | logo · How it works · Refusals · Ledger · Mandate · CTA "Watch it decide" (#ledger). Below 720 px the links are hidden and the CTA is kept | anchor |
| 2 | Hero | pill "AGENTIC · An AI treasury for tokenized stocks on Base" · H1 "The AI agent that knows **when not to trade.**" · lead · 2 CTAs · 3 stats: **9** checks per trade, **19** typed refusals, **24h** rule timelock · Decision engine card | toggle Sat/Thu |
| 3 | Built on | Base · B20 stocks · Chainlink · Aerodrome · Aave V4 · Coinbase CDP · Claude. **Text only**, no third-party logos | none |
| 4 | Problem | H2 "Tokenized stocks trade 24/7. Their prices don't." + 3 cards: (a) weekly feed/NYSE chart + `MARKET_CLOSED`, (b) bar chart of premiums 29/49/53 bps with the 100 threshold + `PREMIUM_TOO_HIGH`, (c) NVDAc `uiMultiplier` + `MULTIPLIER_COOLDOWN` | none |
| 5 | How it works | H2 "The model may advise. The contract decides." · 4 steps (Claude proposes / Preview as executor / The vault weighs it / Recorded either way) · code panel `event Decision(...)` · table decoding the Sat 7 Nov order | none |
| 6 | Refusals | H2 "Nineteen typed ways to say no." · 5 groups: Market 5, Token and policy 5, Limits 4, Credit 3, Execution 2. `MARKET_CLOSED` highlighted | none |
| 7 | Ledger | H2 "Every answer is public. Especially no." · All/Allowed/Refused filter chips · 4 fork rows · source note | filter |
| 8 | Mandate | H2 "Rules the agent can't loosen." · 3 chips (timelock 24h · executor can only call execute() · mandateHash [after deploy]) · 12-parameter table | none |
| 9 | Treasury loop | H2 "An agent that pays its own way." · 5 steps EARN/BUY/SUPPLY/BORROW/PAY | none |
| 10 | Footer | "Watch it **say no.**" · lead · CTA Follow @maatonbase / Open the ledger · disclaimer · tagline | link |

**Decision engine (hero):** data for the two moments, exactly as in the comp.

- **Sat 7 Nov** (default):
  - Intent: `BUY GOOGLc · $10`.
  - Check 1–3 PASS, check 4 "Market session · Saturday · NYSE closed" FAIL, check 5–9 "not reached" SKIP.
  - Verdict: `Refused`, `MARKET_CLOSED`, "Decision logged · gas 111,116".
- **Thu 5 Nov · 10:30 ET:**
  - Intent: `BUY NVDAc · $20`.
  - 9 PASS with these details: `NVDAc in mandate`, `transfers active`, `authorized`, `REGULAR · open`, `14s ≤ 3600s`, `no change 24h`, `53 ≤ 100 bps`, `$20 ≤ $50 · $100/day`, `weight ≤ 40%`.
  - Verdict: `Allowed`, `OK`, "Swap executed · gas 758,192".

**Footer disclaimer (verbatim):** "Maat is an experiment built for Base Stocks Maxxing. It holds only its own treasury, gives no investment advice, confers no shareholder rights and is not offered to US persons."

**Values that exist only after the mainnet deploy** (`mandateHash`, `rationaleHash`, Basescan links): show exactly the placeholder strings from the comp (`[after deploy]`, `[from mainnet tx]`). **Do not generate fake hashes.**

---

## 4. Approaches considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **Next.js App Router, static export (chosen)** | Same stack as the dashboard in the original spec §3.6, so W2 only needs to drop `output: "export"` to add server data. One-click Vercel deploy. Components can be reused in W2 | Slightly heavier than Astro | **Chosen.** Only two islands run on the client, so very little JS is shipped |
| Astro | JS close to 0, fast builds | W2 would have to move to Next.js (dashboard, Base App), so there would be two stacks | Rejected |
| Hand-written static HTML | Fastest for day one | No components or tests, hard to move up to W2 | Rejected |

---

## 5. Technical architecture

### 5.1 Stack
- **Platform:** Node 24, npm, TypeScript strict.
- **Framework:** Next.js App Router, latest stable version at the time the plan is written, configured with `output: "export"`. React 19, Tailwind CSS v4 with the tokens from §2.1 declared in `@theme`.
- **Versions:** the plan will state the exact versions, checked with `npm view`.
- **W1 does not include:** wagmi, viem, RPC, analytics, cookies.

### 5.2 Directory layout
```
web/
  app/
    layout.tsx            # fonts, metadata, OG/Twitter, <html lang="en">
    page.tsx              # assembles the sections
    icon.png, apple-icon.png, opengraph-image.png  # copied from brand/out
    robots.ts, sitemap.ts
  components/
    sections/             # AnnouncementBar, Nav, Hero, BuiltOn, Problem, HowItWorks,
                          # Refusals, Ledger, Mandate, TreasuryLoop, Footer
    charts/               # WeekChart.tsx, PremiumChart.tsx (static SVG, with role="img" + aria-label)
    DecisionEngine.tsx    # "use client"
    LedgerTable.tsx       # "use client"
    ui/                   # Pill, Card, Eyebrow, SourceNote, CodePanel
  content/
    facts.ts              # every number + its source (§5.4)
    decisions.ts          # DecisionRow[] from the fork run (§5.3)
    engine.ts             # data for the 2 moments of the Decision engine
    copy.ts               # long headlines/leads used in several places (optional)
  brand/
    src/                  # mark.svg, mark-light.svg, lockup.svg
    out/                  # PNGs exported by the script (§6)
  scripts/
    brand.ts              # satori + @resvg/resvg-js → PNG
  test/                   # vitest + Testing Library
  e2e/                    # Playwright smoke
```

### 5.3 Data layer: leaving room for W2
```ts
export type DecisionSource = "base-fork" | "base-mainnet";
export interface DecisionRow {
  source: DecisionSource;
  block: number;            // fork: always the origin block 53_551_627 (the fork point); mainnet: the tx's block
  timeLabel: string;        // formatted ET time. Fork: "Thu 5 Nov 10:30"; the Saturday row is fork time +2 days
                            // (anvil setNextBlockTimestamp in agent.fork.test.ts) → "Sat 7 Nov"
  action: "BUY" | "SELL" | "SUPPLY" | "WITHDRAW_COLLATERAL" | "BORROW" | "REPAY" | "PAY_EXPENSE";
  symbol: string;           // "NVDAc"
  amountUsd: number;
  allowed: boolean;
  reason: ReasonCode;       // "OK" | 19 codes from Types.sol
  gasUsed?: number;
  note?: string;
  txHash?: `0x${string}`;   // mainnet only
}
export function getDecisions(): DecisionRow[]; // W1: returns the fork data
```
- `LedgerTable` and the Decision engine use only `DecisionRow` and `ReasonCode`. In W2 only `getDecisions()` needs to be swapped for the mainnet source; the UI stays unchanged.
- **Every row has a `source`.** Any row with `source = "base-fork"` always shows the source note in the UI (block 53,551,627).

### 5.4 Source of truth & parity tests

`content/facts.ts` exports constants of the form `{ value, source }`, where `source` is a string pointing to a specific file or measurement.

| Fact | Value | Source | Automated check |
|---|---|---|---|
| Checks per trade | 9 | original spec §3.1 | no (the spec is prose) |
| Reason codes | 19 codes, in exact order | `contracts/src/Types.sol` `enum Reason` (excluding `OK`) | **yes**: parse the enum, match the list and the groups |
| Timelock | 24h | `contracts/src/MandateVault.sol` `TIMELOCK = 24 hours` | **yes**: parse the constant |
| Signature `event Decision` | 7 fields | `contracts/src/IMandateVaultEvents.sol` | **yes**: parse the event, compare names + types with `CodePanel` |
| Mandate parameters | 100/100/3600/1 days/1800/50e6/100e6/1.5e18/2e18/8 hours, `maxWeightBps` 4000 | `contracts/script/MaatConfig.sol` | **yes**: parse `defaultMandate` + constants + `TokenConfig` |
| Fork block | 53,551,627 | `agent/test/integration/agent.fork.test.ts` `BLOCK_SESSION` | **yes**: parse the constant |
| `uiMultiplier` NVDAc | 1.000537939576369481 | `agent/test/integration/anvil.ts` (comment 1000537939576369481) | **yes**: parse |
| Premium | NVDAc 53, GOOGLc 49, AAPLc 29 bps | comment in `MaatConfig.sol` | **yes**: parse the comment |
| Gas | BUY 758,192 · SUPPLY 286,707 · BORROW 484,173 · recording a refusal 111,116 | `agent/test/integration/fork-gas.json` (output of `MAAT_GAS_LOG`) | **yes**: read the log file |
| Feed age | 14 s | measured on the fork at BLOCK_SESSION | no |
| Loop cadence | 15 minutes during a session | original spec §3.5 | no |
| x402 price | ~0.01 USDC | original spec §3.4 | no |
| Rebalance | deviation of ±5% | original spec §3.5 | no |

- The `facts.test.ts` test checks two things: every fact has a non-empty `source`, and the rows marked "yes" in the table above match the source files. The files being parsed live outside `web/`; the test reads them through a relative path to the repo root.
- When the contract changes, the test fails, so the page cannot silently drift from the code.

### 5.5 Client islands

Only two components are `"use client"`. Everything else is rendered statically at build time.

- **`DecisionEngine`:**
  - State `{ moment: "sat" | "thu", run: number }`.
  - The toggle is two `<button aria-pressed>` elements inside a `role="group"` with an `aria-label`.
  - The verdict area has `aria-live="polite"`.
  - When `run` changes, the check list remounts so the animation replays.
- **`LedgerTable`:**
  - Filter chips are `<button aria-pressed>`, at least 44 px tall.
  - The table sits in its own `overflow-x:auto` region with `tabIndex=0` and an `aria-label`, so only the table scrolls horizontally and the page does not.

---

## 6. Brand assets

`scripts/brand.ts` (`npm run brand`) renders from JSX with satori, using the Geist font from the `geist` package, then exports PNGs with `@resvg/resvg-js` into `web/brand/out/`.

| File | Size | Content |
|---|---|---|
| `mark.svg` / `mark-light.svg` | vector | mark on a dark background / outlined mark on a white background |
| `lockup.svg` | vector | mark + wordmark "maat" |
| `favicon` / `icon.png` / `apple-icon.png` | 32 / 512 / 180 | mark |
| `og.png` | 1200×630 | H1 "The AI agent that knows when not to trade." + mini card Refused · MARKET_CLOSED + background grid + lockup |
| `x-avatar.png` | 400×400 | centered mark, leaving a safe margin for the circular crop |
| `x-banner.png` | 1500×500 | "Every trade is weighed." + a strip of 3 badges (PASS · PASS · FAIL MARKET_CLOSED). Content is shifted to the right, leaving the bottom-left corner for the avatar |

The owner uploads the avatar and banner to X personally. The agent does not operate the X account.

---

## 7. Quality

- **Accessibility:**
  - contrast ≥ 4.5:1 for all regular text;
  - SVG charts have `role="img"` and an `aria-label` describing the data;
  - keyboard navigable, with a clear focus ring (2 px `accent` outline);
  - a skip link is present;
  - every section has a heading at the correct level;
  - no emoji; the PASS/FAIL/SKIP labels are text.
- **Responsive:**
  - the hero uses `grid-template-columns: repeat(auto-fit, minmax(min(100%, 500px), 1fr))`, so it collapses to 1 column on its own when the container is narrower than 2 columns × 500 px;
  - grids use `auto-fit minmax(min(100%, X), 1fr)`;
  - 16 px gutter below 720 px;
  - no horizontal scroll at 360 px, except in the ledger table region.
- **Performance:**
  - self-hosted fonts, with the 2 main weights preloaded;
  - no raster images in the page, only inline SVG;
  - client JS consists of only the 2 islands.
- **SEO:**
  - title "Maat · The AI agent that knows when not to trade";
  - description taken from the hero lead;
  - OG + Twitter `summary_large_image`, `twitter:site` = @maatonbase;
  - `robots`, `sitemap`;
  - `metadataBase` is read from the env var `NEXT_PUBLIC_SITE_URL`, defaulting to the Vercel URL.
- **Privacy:** W1 has no analytics, cookies or third-party scripts, so no cookie banner is needed.
- **Compliance:**
  - the disclaimer in §3;
  - W1 has no wallet interaction, so no US geofence is needed yet (original spec §5 requires it only for wallet interaction).

---

## 8. Testing

- **Unit (vitest + Testing Library + jsdom):**
  - `DecisionEngine`: defaults to Sat; verdict "Refused" and `MARKET_CLOSED`; check 4 is FAIL; checks 5–9 are SKIP. Clicking Thu gives 9 PASS, "Allowed", and `aria-pressed` updates correctly.
  - `LedgerTable`: All = 4 rows, Allowed = 3, Refused = 1.
  - `facts.test.ts`: the parity tests from §5.4.
- **Build:** `npm run build` produces `out/` without errors. Every anchor `#how`, `#reasons`, `#ledger`, `#mandate`, `#top` has a target element.
- **E2E smoke (Playwright, Chromium only) run against `out/`:**
  - at 360, 768 and 1440 px: `scrollWidth ≤ innerWidth`;
  - no console errors;
  - clicking the toggle changes the verdict;
  - take screenshots for the owner to review.
- **Lighthouse:** run manually before the public announcement, checked against the thresholds in §1.

---

## 9. Deploy & owner tasks

The agent only prepares the code and the instructions in `web/README.md`. The following are done by the **owner**:

1. Create the Vercel account and project, import the repo, and set the root directory to `web/`.
2. Choose and buy a domain, then point the DNS. Until a domain exists, use `*.vercel.app`.
3. Upload `x-avatar.png` and `x-banner.png` to @maatonbase.
4. Click share or post the link publicly.

The repo is currently private. Vercel can deploy from a private repo. When moving to the new public repo (decided), only the project's Git source needs to be changed.

---

## 10. Web roadmap after W1 (each part has its own spec)

> **Update 2026-11-20:** W2 has its own spec, [`2026-11-20-maat-web-w2-ledger-design.md`](2026-11-20-maat-web-w2-ledger-design.md). Two changes from the sketch below: the read path stays client-side (the visitor's browser calls a public Base RPC, so `output: "export"` stays and no RPC key exists), and the Base App mini-app manifest is dropped.

- **W2: Live ledger & dashboard** (after the mainnet deploy, alongside or after Plan 3):
  - `getDecisions()` reads the `Decision` event from the mainnet vault using viem on the server side. The RPC key stays on the server only and never appears in the bundle or the repo. At that point `output: "export"` is dropped.
  - Each row has a Basescan link.
  - **Rationale verified:** the rationale text comes from the journal export. Before showing the "hash verified" badge, the UI checks `keccak256(text) == rationaleHash` onchain. This hashing matches `agent/src/intent.ts` `rationaleHash()`.
  - The dashboard includes: balances by `balanceOfUI`, value = raw × feed, HF, revenue and costs, and a mandate page with the real `mandateHash`.
  - Add the Base App mini-app manifest.
  - Add the US geofence only when wallet interaction is added.
- **W3:** a daily diary (X drafts that the owner posts) and a replay page for the fork scenarios.

---

## 11. Schedule

W1 is done **before** everything else, estimated at 2–3 working days:

1. Scaffold, tokens, layout, hero and Decision engine.
2. The remaining sections, charts, ledger, parity tests.
3. Brand script and assets, SEO, Playwright, Lighthouse, deploy README.

After that, the build calendar (a local planning note, not in this repository) is reordered as: W1 → Plan 3 (Guard Service, x402) → mainnet deploy and go-live → W2 → W3, Factory, Skill → submit on 4 Dec.

---

## 12. Decisions made & open questions

**Decided:**
- The v0 data is real fork data and always carries a source label (the owner chose "Fork data, labeled").
- Use direction v2 "Signal", with a light background (approved by the owner).
- Copy is in English, verbatim from the comp, with 5 accuracy corrections already applied to the comp:
  1. "Tested on" instead of "Running on";
  2. "recorded on that fork";
  3. `maxWeightBps (per token)`;
  4. `deriskWindow` "8 h before Fri 20:00 ET";
  5. added "confers no shareholder rights".
- Next.js static export on Vercel. W1 has no wallet, no RPC and no analytics.

**Open questions** (do not block W1):
- Official domain. The owner chooses; names such as `maat.xyz`, `maatonbase.xyz`, `usemaat.xyz` could be checked, but none has been verified as available.
- Whether to add a GitHub link in the nav once the repo is public.
