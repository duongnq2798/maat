# Maat M-9: the site as a weighing instrument

Date: 2026-11-23. Branches: one per phase (section 12). Status: the owner chose the direction and settled the four open decisions on 2026-11-23 (section 2). Three independent reviews then checked this spec against the repo at `66bd0d0` (pinned tests, code and data facts, pending-change conflicts and budgets), and their findings are folded in.

## 1. Goal

maatonbase.xyz explains a risk engine today. After this change it works like one: one precision instrument, with a white faceplate, an ink chassis and lit segments. Every lit segment is a sourced reading. The loudest state on the device is NO.

The hero object is the 30 px mark from `web/brand/mark.ts` (the beam, the feather `#6E83FF` and the order block), redrawn as a balance that tips only when a check fails. Around it sit:

- a readout of Base mainnet, read by the visitor's browser;
- an annunciator with 19 lamps, one per refusal code, lit by the chain where a live read can raise that code;
- a scope that traces a real mainnet weekend from the Weekend Gap Index;
- a printed tape of verdicts.

The design reference is industrial faceplates (engraved labels, keycaps and lamps), not a retro calculator. Unlit segments are close to invisible.

### 1.1 Research behind it

On 2026-11-23, five pages were captured at 1440x900 and 390x844, one screenshot per viewport while scrolling: three reference landing pages chosen by the owner, and maatonbase.xyz itself. The captures recorded fonts, the type scale, colours, libraries, animations, transfer size and page length.

Three directions were then drafted. Three judges scored them: a visual-design judge, a fintech head of design and a staff front-end engineer. The six axes were craft, clarity in 5 seconds, trust, memorability, feasibility in about 8 agent-days, and safety against the repo's pinned tests.

This spec is the winning direction, with three parts grafted from the runners-up:

- a single spring model that drives both the CSS easing and the drag;
- a verdict-first engine card;
- a per-number sources layer.

The notes and captures stay outside the repo. Section 11 is the bar this work must clear. It is measured, and none of it depends on the reference sites.

### 1.2 What success looks like

A visitor on a laptop sees four things in the first viewport without scrolling:

- the headline;
- both calls to action;
- a Base block number their own browser just read;
- a complete verdict with its reason code.

A visitor on a phone sees the headline and the live verdict line in the first screen.

Every number on the landing traces to one of these:

- a FACTS entry with a source;
- the fork run's ledger rows;
- the edition files;
- the visitor's own simulation;
- a live read named by its block.

Nothing counts up from zero, and nothing is an empty box while it loads. The landing stays under its weight budget (section 11, item 3).

## 2. Decisions

The owner settled these on 2026-11-23:

1. **Art direction: M-9, the weighing instrument**, with the grafts named in 1.1. Geist and Geist Mono only: no serif and no new font bytes.
2. **Hero delight: drag-to-tip only.** The visitor can drag the beam, and on release it springs back to the contract's answer. There is no sound. The drag is a lazy module and is the first thing cut if time runs out.
3. **Top nav (phase P4): pages first.** The bar reads `maat · Now · Gap Index · Ledger · Docs · View on GitHub ↗`. The landing sections move to a scroll-spy rail on desktop and to a "Sections" sheet on phones.
4. **Weekend Scope headline: picked at build time.** The build picks the largest measured gap in the edition files and writes the copy from that data, so the copy never drifts from it.
   - When this spec was written, that gap was MSTRc in window 2026-11-13: 1,411 bps below the held feed, 48.44 h frozen, 47,880 swaps while frozen.
   - NVDAc is one tap away in the small multiples.

## 3. Constraints the design keeps

Each item below was checked on main at `66bd0d0`. The tests named here stay unchanged unless a phase in section 12 says otherwise.

### 3.1 Pinned strings, tokens and structure

- The H1 "The AI agent that knows when not to trade." is pinned.
- Section ids and order are pinned: `#top`, `#how`, `#reasons`, `#try`, `#ledger`, `#mandate`. No new anchor link is added.
- The 20 colour tokens at `globals.css:13-32` stay byte-identical. `tokens.test` pins 18 of them; `brand.test`'s PALETTE also pins `--color-feather` and `--color-grid`. `--color-grid` and `.grid-bg` stay declared even after the hero's grid gives way to the tick ruler, because `Footer.tsx` uses `.grid-bg` until P4.
- Geist and Geist Mono stay mapped as `tokens.test` pins them.
- The body background stays `#FFFFFF` (`docs.spec`).
- The global `prefers-reduced-motion: reduce` block stays exactly as written.
- The spec plate keeps the literal labels CHECKS PER TRADE, TYPED REFUSALS and RULE TIMELOCK, as uppercase DOM text. Each is followed by its value as the next element sibling, whose text is exactly `9`, `19` or `24h` (`top.test.tsx:47-50`).
- The landing keeps exactly one visible `<table>`: the ledger's (smoke's strict locator). The Scope's window tape, the small multiples and the calibration sheet use lists or `<dl>`.

### 3.2 Smoke's animation wait

- `web/e2e/smoke.spec.ts` waits until every non-infinite entry of `document.getAnimations()` is `finished`. That list includes CSS transitions and WAAPI animations. So:
  - every finite animation ends within 2.2 s of its trigger;
  - the countdown changes its text once a minute and never animates;
  - nothing sits in a paused "armed" keyframe.
- The two `.anim-live` dots are the only infinite animations: the LIVE lamp (`LiveStatus.tsx`) and, until P4 restyles it, the AnnouncementBar dot. The AnnouncementBar dot stops looping in P4.

### 3.3 Status regions in the hero

- `#top` keeps exactly two `role="status"` regions: the engine's verdict region and the sr-only LiveStatus span.
- `#top [role="status"] > div` counts exactly 1. Smoke's reduced-motion test collects it together with the 9 check `li` and expects 10.
- The LiveStatus span stays the only `role="status"` and the only `aria-live` inside `[data-live-strip]` (`live.spec.ts:61`, `live-strip.test.tsx:396-397`). No `aria-live` is added above the strip.
- The beam's nine ticks are not `li` elements and sit outside "Mandate checks".

### 3.4 The annunciator stays on a light surface

- Smoke pins the reason-code colour at ink-2 `#5A6170` (`smoke.spec.ts:159`).
- On ink `#0B0D12` that is 3.13:1, which fails AA. On surface-soft `#F6F7F9` it is 5.80:1.
- So `#reasons` is a light faceplate, and a lit lamp is a ring, not a dark panel.

### 3.5 The live strip's DOM

- One element keeps `data-live-strip`, `tabIndex={-1}` and the `useRetry` ref together. It takes focus after a successful Retry (`live-strip.test.tsx:305-306`).
- It sits directly before the lead `<p>` (`live.spec.ts`: `#top [data-live-strip] + p`).
- Its direct children are, in order:
  - the sr-only LiveAnnouncer span;
  - exactly one `<p>` holding the reading (`live.spec.ts:317` measures `:scope > p`);
  - the bezel keys, in an element that is not a `<p>`;
  - the `<noscript>`.
- Rows inside the `<p>` are block-level spans.
- The word LIVE stays its own element, and no other element in the strip has the exact text "LIVE" (`live.spec.ts:313`).
- The lead may move at most 1 px when the first reading lands.
- The strings below stay as today. They are pinned by `live.spec.ts:56-100` and `live-strip.test.tsx:137-163`:
  - "Reading Base mainnet…";
  - the time as `formatUtc · formatEt` (UTC first, with seconds);
  - `session.detail`, for example "Saturday · NYSE closed";
  - the VerdictLine sentence and its ReasonTags, with "Market closed" and "MARKET_CLOSED" each matched by exactly one element;
  - the "All 13 B20s" link to `/now`.
- The static HTML contains no "REFUSE".

### 3.6 The engine card's DOM

- The DOM text `replay · Base fork · block 53,551,627` stays, in lower case. Capitals come only from CSS `text-transform` (`decision-engine.test.tsx:33`).
- `INTENT · SCRIPTED FORK RUN` and the moment's intent text stay as HTML text, outside the aria-hidden Balance (`:34`).
- The Sat/Thu toggle buttons keep their label as their only text.
- The verdict window stays the first `<div>` child of the `role="status"` region, with `data-verdict`, then `data-reason`. It holds, in this order:
  1. "VAULT DECISION";
  2. the verdict word;
  3. the stacked ReasonTag;
  4. the outcome line ("Decision logged · gas 111,116") as the tag's next sibling, in one right-aligned column (`decision-engine.test.tsx:27,43`; `smoke.spec.ts:93-102`).
- The Balance and its ticks sit outside `role="status"`.

### 3.7 Nothing live in the static HTML

- check:out bans `>LIVE<` and `basescan.org/block/` in the exported landing (`check-out.ts:55`).
- Live values appear only after the browser reads them.
- The landing never links a Basescan block URL in static markup. Live parts that render on the client may link one, as the strip's block link does today.
- check:out also bans "safe" anywhere in `out/gap-index.html`, class names included.

### 3.8 One read loop per page, and only on / and /now

- The landing sends one multicall at load and one per 30 s, and one request per host when both hosts fail (`live.spec.ts:143-146`).
- Every live surface on a page shares one snapshot (section 5.1, LiveSnapshotProvider).
- `/gap-index` and `/ledger` make no request outside their own origin (`gap-index.spec.ts:83-95`, `ledger.spec.ts:107`). Live chrome on those pages renders unlit and makes no RPC request.

### 3.9 Limits come from FACTS, never from literals

A later mandate change, for example to `maxPremiumBps`, must move every meter's full scale and every limit line with it. So limits are always read from `FACTS.mandate.value`.

### 3.10 Two pending changes own some files

**PR #15**, the live ledger dashboard, edits these among others:
- `web/components/sections/Nav.tsx` and `Ledger.tsx`;
- `web/app/(site)/layout.tsx`;
- `web/lib/check-out.ts` and `web/scripts/check-out.ts`;
- `web/next.config.ts`, `web/package.json` and `package-lock.json`;
- `web/app/globals.css`, at the `@source` brace line;
- `web/app/sitemap.ts`;
- `page.test.tsx`, `top.test.tsx` and `check-out.test.ts`;
- `web/README.md` and `status.mdx`.

**The deployment-record change**, which lands after the mainnet deploy, edits 60 files, including:
- `page.test.tsx`, `top.test.tsx`, `now-page.test.tsx`, `live-verdict.test.ts` and `docs.spec.ts`;
- `web/README.md`;
- `web/lib/live/verdict.ts`;
- `AnnouncementBar.tsx`, `Mandate.tsx`, `NowBoard.tsx` and `app/(site)/now/page.tsx`;
- 39 docs MDX files.

Its fill step also writes `deployments/README.md` and `web/content/generated/deployments.json`. Until each change merges, the redesign does not edit its files (section 12.2).

### 3.11 Tests run in jsdom

jsdom has no `IntersectionObserver`, no `window.matchMedia` and no `Element.prototype.animate`. Every new helper degrades when one is missing (section 5.1), so `page.test.tsx` and `top.test.tsx` pass unchanged at every phase before P4. `web/test/setup.ts` is not changed.

### 3.12 No new dependency, no third-party script, and no edition JSON in the client

- There is no animation library, no smooth-scroll library and no WebGL.
- The landing makes no request except the keyless RPC reads it already makes.
- The 368 KB edition file is read at build time by server components only. No `'use client'` module imports `content/gap-index`, `content/scope.ts` or `lib/gap/schema`.

## 4. Instrument grammar

One rule set holds on every page.

- **Tilt means verdict.**
  - Only the beam tilts: level means allowed, and -6° means refused.
  - Nothing else on the site rotates to carry meaning.
- **Meters mean magnitude.** Horizontal bars or needles show bps, hours and drift. Each is scaled to a FACTS limit, and the number is always written next to it.
- **Lamps mean state, and always carry a word: PASS, REFUSE or SKIP.**
  - Colour is never the only signal.
  - A lamp never prints a ReasonTag. Reason codes stay in VerdictLine and in the cards that already carry them.
  - In the reading state a lamp prints no word.
- **Plates mean provenance**, by word and by shape. Words are uppercase by CSS only.

  | Plate | Shape |
  |---|---|
  | `BASE MAINNET · LIVE` | filled dot |
  | `REPLAY · BASE FORK · BLOCK 53,551,627` | ring with hatch |
  | `EDITION 0 · RECORDED` | square |
  | `YOUR BROWSER · SIMULATED` | outline |
  | `PLANNED` or `[after deploy]` | dashed |

- **Ghost means not read yet.** Unlit segments appear next to the words "Reading Base mainnet…". A reading is never shown as a 0 or as an empty box before it arrives.

## 5. Units

Each unit has one purpose and can be tested on its own.

### 5.1 New code

| Unit | Path | Does | Depends on |
|---|---|---|---|
| LiveSnapshotProvider | `web/components/live/LiveSnapshotProvider.tsx` | runs exactly one `useLiveSnapshot` per page and gives `{ state, refresh, refreshing, hold, setHold }` through context to every live surface | `useLiveSnapshot` |
| Readout | `web/components/instrument/Readout.tsx` | chassis window, 100% of its column wide, fixed height per breakpoint (sized for the tallest state at that breakpoint's narrowest width), bezel-keys slot | Ghost |
| Digits | `web/components/instrument/Digits.tsx` | mono tabular number that rolls only the changed digits between two real readings | `rollDigits` |
| Ghost | `web/components/instrument/Ghost.tsx` | unlit segments as CSS generated content on an empty aria-hidden span; hidden under `forced-colors` | none |
| HoldKey | `web/components/instrument/HoldKey.tsx` | `aria-pressed` key that freezes reads and the countdown (WCAG 2.2.2) | LiveSnapshotProvider |
| Lamp | `web/components/instrument/Lamp.tsx` | state lamp with its word (section 4); a `::before` driven by a data attribute | none |
| Meter | `web/components/instrument/Meter.tsx` | hairline bar scaled to a limit passed as a prop, with the number written | `formatLimit` |
| Ruler | `web/components/instrument/Ruler.tsx` | decorative tick ruler (minor tick every 8 px, major every 56 px) | none |
| Balance | `web/components/instrument/Balance.tsx` | SVG on MARK's 30-unit grid with MARK's stroke and colours. It splits MARK.beam into a fixed post and base (`M15 7v15M11 22h8`) and a tilting crossbar (`M7 10h16`), and hangs two pans from the crossbar ends carrying MARK.feather and MARK.order. Nine ticks; tilt keyed off `data-verdict`; aria-hidden | `web/brand/mark.ts` |
| SourcePlate | `web/components/instrument/SourcePlate.tsx` | provenance plate (section 4) | none |
| Tape | `web/components/instrument/Tape.tsx` | printed verdict rows, with a clip-path print-in | none |
| Fig | `web/components/instrument/Fig.tsx` | puts `data-fact` on the element that already holds a whole string; shows its sources when SOURCES is on (section 10.2) | `content/facts.ts` |
| Live | `web/components/instrument/Live.tsx` | marks a live value with `data-live` (block, host, time) | none |
| ThumbBar | `web/components/instrument/ThumbBar.tsx` | phone bottom bar (6.2); mounted from `app/(site)/page.tsx`, never from `Hero.tsx`; renders nothing until both hero CTAs have scrolled out | LiveSnapshotProvider, Lamp and its own IntersectionObserver |
| useTipDrag | `web/components/instrument/useTipDrag.ts` | `beginTipDrag`, the drag integrator as a plain function (it calls no hook, so it stays server-safe), loaded with `import()` on the first pointerdown | `spring.ts` |
| Scope | `web/components/instrument/Scope.tsx` | server component: calls `content/scope.ts`; renders the trace, small multiples and window tape | `content/scope.ts` |
| ScopeScrubber | `web/components/instrument/ScopeScrubber.tsx` | `'use client'`: range input and crosshair; gets the downsampled series and precomputed `aria-valuetext` strings as props; imports nothing from `content/gap-index`, `content/scope.ts` or `lib/gap/schema` | none |
| NowConsole | `web/components/live/NowConsole.tsx` | channel strips for `/now` (7.1) | Lamp, Meter, LiveSnapshotProvider |
| spring | `web/lib/motion/spring.ts` | damped spring model: samples for CSS `linear()`, and one integrator step for the drag | none |
| onceInView | `web/lib/motion/once-in-view.ts` | one shared IntersectionObserver that sets `data-seen` (rootMargin `100000px 0px -12% 0px`); sets it at once when `IntersectionObserver` is missing | none |
| reducedMotion | `web/lib/motion/reduced-motion.ts` | `prefersReducedMotion()`; returns true when `window.matchMedia` is missing | none |
| rollDigits | `web/lib/motion/roll-digits.ts` | WAAPI roll (240 ms, 30 ms stagger); sets the text directly under reduced motion or when `Element.prototype.animate` is missing | reducedMotion |
| springs script | `web/scripts/springs.ts` | writes the `--ease-needle` and `--ease-settle` `linear()` strings into a marked block in `globals.css`; run as `npx tsx scripts/springs.ts` (its `package.json` entry waits for PR #15) | spring |
| formatLimit | `web/content/format.ts` (new export) | one wording for limits on every new instrument surface, for example "90,000 s (25 h)". The Mandate sheet keeps its pinned "90000 s", and NowBoard keeps `formatAge`, until P4 | none |
| nextOpen | `web/content/calendar.ts` (new export) | the next NYSE open after a timestamp, for the countdown | the calendar port |
| firing | `web/lib/live/firing.ts` | per reason code, how many of the 13 tokens have a FAIL row with that code in `TokenVerdict.checks` | `verdict.ts`, read only |
| scope | `web/content/scope.ts` | build time. Picks the largest measured gap; clips its `series.pool` to `[freeze.from.ts, freeze.to.ts]`; inserts the largest-gap swap (ts, pool, held) as its own point; downsamples; takes the held line from `freeze.from.answer`; builds summaries for the small multiples and the `aria-valuetext` strings with the `/gap-index` helpers (`etDateTime`, `gapBps`) | edition files |
| this-week calendar | `web/components/charts/ThisWeek.tsx` | Problem channel 1: the real current week and a "you are here" needle, client only. `WeekChart.tsx` and its pinned geometry stay unchanged | `content/calendar.ts` |

### 5.2 Changed code

| File | Change | Phase |
|---|---|---|
| `web/app/globals.css` | additive colour tokens; motion tokens; the springs block; `.thumb-bar { padding-bottom: env(safe-area-inset-bottom) }` (never a class name or inline style, so "safe" never reaches a class); a separate `@source "../components/instrument";` line placed after `@source "../lib/site.ts";`, never next to the brace line. Once PR #15 has merged, `instrument` goes into the brace instead | P0 |
| `web/playwright.config.ts` | `webkit` and `firefox` projects (`devices['Desktop Safari']`, `devices['Desktop Firefox']`) with `testMatch: /smoke\.spec\.ts$/` only | P0 |
| `.github/workflows/ci.yml` | after the chromium install step: `npx --no-install playwright install --with-deps webkit firefox` | P0 |
| `web/components/live/useLiveSnapshot.ts` | new option `active` (default true): while it is false (HOLD) there is no read, no 30 s timer and no 5 s reclassify interval. When it turns true, it reads at once if the last read is older than `REFRESH_MS`. Reads still run every 30 s while the page is visible, as today | P1 |
| `web/components/live/LiveStrip.tsx` | renders inside a Readout (3.5); keeps its export name, states and strings. The phone reserve band gives way to the Readout's fixed height | P1 |
| `web/components/live/VerdictLine.tsx` and `LiveStatus.tsx` | a new prop for a chassis palette (lcd and lcd-2) inside the Readout. `data-tone` keeps the values `ink` and `muted`, and NowBoard on white keeps today's classes | P1 |
| `web/components/DecisionEngine.tsx` | verdict-first order and the Balance, inside the DOM rules of 3.6 | P1 |
| `web/components/sections/Hero.tsx` | spec plate (3.1), tick ruler, CTAs above the fold, the H1 and H2 scale | P1 |
| `web/app/(site)/page.tsx` | mounts LiveSnapshotProvider and ThumbBar (P1); adds the Scope band between Problem and `#how` (P2a) | P1, P2a |
| `web/app/(site)/gap-index/page.tsx` | its Header shows the docked plate unlit, with a link to `/now` and no RPC read | P1 |
| `Nav.tsx` | opaque bar and docked mini readout | P1 only if PR #15 has merged, otherwise P4 |
| `web/components/sections/Refusals.tsx` | annunciator | P2a |
| `web/components/sections/Problem.tsx`, `BuiltOn.tsx` | channels inside the card DOM (6.3); plate row | P2a |
| `web/components/sections/HowItWorks.tsx` | signal path with a sticky specimen | P2b |
| `web/components/Simulator.tsx`, `sections/TryIt.tsx` | hardware keys, detents, the Execute sequence | P2b |
| `web/components/LedgerTable.tsx` | cards below 720 px | P2b |
| `web/components/gap/*` | draw-in; scrubber as a client child fed by props, with GapChart staying a server component; snap row of pills | P3 |
| `web/components/sections/Footer.tsx`, `TreasuryLoop.tsx` | ink chassis, mini Balance, serial plate, treasury ring | P4 |
| `AnnouncementBar.tsx`, `Mandate.tsx`, `NowBoard.tsx`, `app/(site)/now/page.tsx` | P4 work; this includes mounting the Readout, the summary line and NowConsole on `/now` | P4, after the record change merges |

## 6. The landing

### 6.1 Hero at 1440x900

From the top:

- **y 0-36: the status line.** The AnnouncementBar text stays verbatim; it is restyled in P4.
- **y 36-108: the nav.**
  - Until PR #15 merges, it stays as it is.
  - After that, it is opaque white with a 1 px line once the page scrolls.
  - When the hero leaves view, an aria-hidden mini readout docks at its right edge: "● block · session".
- **y 108-120:** a 12 px tick ruler (`#C9CED8`) replaces the masked 56 px grid.

**Left column, x 132-700:**

- **AGENTIC pill.**
- **H1.** Geist 600 at `clamp(44px,5.4vw,78px)`, line-height .96, -0.055em. Three lines at 1440, with "when not to trade." in accent. It is the LCP element and never animates.
- **Readout.** The live strip inside a chassis window: 568 px wide at 1440 (100% of the column), `#0B0D12`, radius 14, with an inset 1 px `#262B36` bezel. Its one `<p>` holds three rows:
  1. `LIVE · Base block N · HH:MM:SS UTC · HH:MM ET`. This is the LIVE pill, the block link, then `formatUtc · formatEt`, as today.
  2. `session.detail` verbatim, for example "Saturday · NYSE closed". A countdown follows it, for example "· opens Mon 09:30 ET · in 11 h 58 min", from `nextOpen`, at minute resolution. When the next open is later on the block's own ET day, `session.detail` already names it ("Monday · opens 09:30 ET"), so only "· in 2 h 30 min" follows. Under a minute it reads "· in under 1 min". There is no countdown in session, or when MarketCalendar's answer differs from the repo calendar's. A reading that is not live shows `session.detail` without one.
  3. The VerdictLine sentence verbatim (`data-verdict-line` kept), then the "All 13 B20s →" link to `/now`. The three basket lamps (NVDAc, GOOGLc, AAPLc) sit on this row. Each carries PASS or REFUSE and a hairline premium meter that shows live TWAP-vs-feed bps against `FACTS.mandate.value.maxPremiumBps`, with the number written.

  Read age, RPC host, HOLD and Refresh are 11 px keys on the bottom bezel, outside the `<p>`. HOLD is there in every state. Read age, RPC host and Refresh appear once a reading is shown (live, stale or behind). In the error state the line's own Retry reads again, and in the reading state a read is already in flight. The full detail is under SOURCES and on `/now`.
- **Lead.** `SITE.description`, at 19 px, directly after the strip.
- **CTAs.** "Verify it in 5 minutes" and "Try to make it say no", ending at about y 880, above the fold. Before this redesign they were cut at y 880-900.
- **Spec plate.** 9 / 19 / 24h, with the pinned labels (3.1) engraved in 11 px mono, and the SOURCES key outside the label/value pairs.

**Right column, x 748-1308: the engine card, verdict first.**

- The plate `replay · Base fork · block 53,551,627` (uppercase by CSS) and the "Choose a moment" Sat/Thu toggle.
- The Balance: 120 px wide, with the feather in the left pan, an ink order block labelled "BUY GOOGLc · $10" in the right pan, and nine ticks along the crossbar.
- `INTENT · SCRIPTED FORK RUN` and the intent text, as HTML.
- The verdict window, as 3.6 lays it out.
- Nine channel rows of 36 px: the grounds.

**Timeline:**

- **First paint, static HTML, no JS.** The base style is the final frame:
  - the beam at -6°;
  - tick 04 orange and ticks 05-09 grey;
  - the verdict visible;
  - the Readout showing ghost segments and "Reading Base mainnet…".

  A CSS intro then plays from first paint (fill both, keyframe from level):
  - ticks light on the existing row-in schedule (120 + 160·i ms);
  - the beam tips with `--ease-needle` (600 ms) from about 0.62 s;
  - the existing verdict stamp fires at 1.65 s;
  - everything has finished by 2.2 s.
- **First read (usually 0.5-2 s).**
  - The LIVE lamp lights in 120 ms.
  - The ghost segments give way to the real block number at once. Digits roll (240 ms each, 30 ms stagger) only between two real readings, as 8.1 rule 3 and `rollDigits` have it.
  - Geist Mono's weight settles from 300 to 560. The digits are mono, so nothing reflows.
  - One polite announcement goes through the existing sr-only span.
- **Every 30 s while the page is visible**, as `useLiveSnapshot` reads today.
  - Only changed digits roll, and the read age resets.
  - A 1 px scan line crosses the window once (400 ms), but only while the hero is on screen.
  - HOLD stops reads and the countdown.
- **Thu 5 Nov · 10:30.** The ticks relight blue from 1 to 9, the beam swings level on the needle spring, and the verdict window turns from ink to accent "Allowed".
- **Drag (lazy, cut first).**
  - The first pointerdown loads `useTipDrag`.
  - The beam tilts up to ±14° against a stiffening spring, and springs back to the contract's answer on release.
  - The caption reads "Only the nine checks move this beam."
  - It runs on `requestAnimationFrame` only while unsettled, so it never appears in `getAnimations()`.
  - It is off under reduced motion, and the Balance stays aria-hidden.

### 6.2 Hero at 390x844

- **y 0-32:** the status line, in its pinned phone form.
- **y 32-96:** the nav, with the mark, Docs and the GitHub pill.
- **H1:** 44 px, in 4 lines.
- **Readout:** 358 px wide at 390, 343 at 375 and 328 at 360 (100% of the column). Its height is fixed, and the live verdict line is in the first screen.
- **Lead:** 17 px.
- **CTAs:** stacked, 52 px each. At 390x844 they end at about y 1054, below the first screen, under the fixed-height Readout and the lead. The ThumbBar carries "Try to make it say no" once they scroll out.
- **Screen 2** opens on the Balance and the verdict window, then the channels.
- **ThumbBar.**
  - When both hero CTAs have scrolled out, a 56 px bottom bar slides up. It holds a live lamp and "Try to make it say no", which links `#try` on the landing.
  - It hides while `#try` or the footer is in view.
  - Under reduced motion it appears without sliding.

### 6.3 The other sections

| # | Section | Surface | Becomes |
|---|---|---|---|
| 0 | Status line | white | text verbatim; restyled in P4 |
| 1 | Nav | white, opaque | 6.1; pages first in P4 |
| 2 | `#top` | faceplate + Readout | 6.1, 6.2 |
| 3 | Built on | faceplate | engraved plate row, text only; 2 columns on phones |
| 4 | Problem | faceplate | three channels (below) |
| 5 | Weekend Scope (no id) | ink band | 6.4 |
| 6 | `#how` | faceplate + chassis specimen | 6.5 |
| 7 | `#reasons` | surface-soft faceplate | 6.6; h2 "Nineteen typed ways to say no." kept |
| 8 | `#try` | faceplate | 6.7 |
| 9 | `#ledger` | faceplate | 6.8 |
| 10 | `#mandate` | faceplate | P4: a calibration sheet as a `<dl>` with 12 rows and a tick ruler per limit; every pinned string visible |
| 11 | Treasury loop | surface-soft | P4: five detents on a ring; the "Planned" detent hatched |
| 12 | Footer | ink chassis; the body stays white | P4: "Watch it say no."; a mini Balance tipped or level by the live headline, labelled "from block N" on `/` and `/now` and unlit elsewhere; the pinned links, disclaimer and tagline; the SOURCES key; the serial plate |

Each Problem channel stays an `<article class="card">`. Its first child is the header div: the eyebrow span first, then the card's single stacked refuse ReasonTag with `ml-auto`. The pinned h3, the figure and the body `<p>` follow. Live needles carry PASS or REFUSE lamps, never ReasonTags.

1. **This week:** the real NYSE week from `FACTS.calendar`, with a "you are here" needle, in the new ThisWeek component.
2. **The fork facts** against the FACTS limit line, plus a live needle for each basket token.
3. **The recorded multiplier** beside the live `uiMultiplier`.

Length target: 8,500 px or less on desktop and 12,500 px or less on mobile. Today the page is 9,527 and 15,845 px.

### 6.4 Weekend Scope

An ink band with no id, between Problem and `#how`.

- **The trace.** A server-rendered trace of the headline gap that `content/scope.ts` picks. It shows:
  - the pool price;
  - the held feed;
  - the gap over the frozen hours, reaching the headline point itself.
- **Block range and links.** The block range is printed as plain numbers. The band links only:
  - the largest-gap transaction (`basescan.org/tx/…`);
  - `/gap-index#window-<id>`.

  No `basescan.org/block/` URL appears in the landing's static HTML.
- **The scrubber.** ScopeScrubber is a transparent `<input type="range">` over the trace that moves a crosshair. It works with the keyboard arrows, and its `aria-valuetext` reads, for example, "Sat 14 Nov 17:49 ET, pool 94.05, held 109.50, −1,411 bps".
- **Small multiples.** One per measured token, with NVDAc one tap away.
- **The window tape.** One cell per edition window, plus the next pending window, as a list.
- **The punchline:** "The pool moved. The vault's answer never changed: Market closed."
- **The caption.** It keeps the `/gap-index` caveat `SPOT_NOT_TWAP` (`content/gap-index/index.ts`): the gap compares the pool's spot price after a swap with the answer the feed held, not the 30-minute TWAP the vault checks. The limit line comes from FACTS.
- **What ships to the client.** Only the selected token's downsampled series, about 5 KB.

The word "safe" never appears.

### 6.5 Signal path (`#how`)

**The specimen.**
- At 1024 px and up, a sticky chassis specimen sits on the right. The pinned part is 200 vh at most.
- It walks the four pinned steps:
  1. **I:** Claude's `Intent[]`.
  2. **II:** `eth_call previewIntent`. The Balance previews the result.
  3. **III:** `execute()` with the nine checks. The block drops onto the pan and ticks 1 to 9 light.
  4. **IV:** the Decision event.
- The specimen states carry no headings. The four pinned H3s stay the only `h3` in `#how`, and map to a clickable chapter rail I-IV.

**How the step is chosen.** An IntersectionObserver middle band (rootMargin `-45% 0px -45% 0px`) sets `data-step`. When `IntersectionObserver` is missing, the parts render inline.

**The decoded event.** The decoded Saturday event prints line by line (clip-path, 260 ms per line, 40 ms stagger). It ends on the `[from mainnet tx]` chip.

**Smaller screens and reduced motion.** Below 1024 px, or under reduced motion, the parts render inline and are not sticky.

**What stays.** The pinned H3s, the code panel and the decoded pairs.

### 6.6 Annunciator (`#reasons`)

**Layout.** 19 keycap lamps plus a 20th cell, which shows the focused code's meaning in large type. This removes today's empty cell.

**The lamp element.**
- Each lamp is a `::before` on `li[data-code]`, driven by `data-firing`.
- Each `li[data-code]` keeps exactly its two children.
- `data-hot` stays on MARKET_CLOSED only.

**Which lamps can light.** A live read can raise only seven codes: TOKEN_NOT_ALLOWED, TOKEN_PAUSED, MARKET_CLOSED, FEED_STALE, BAD_PRICE, MULTIPLIER_COOLDOWN and PREMIUM_TOO_HIGH.
- Checks after the first failure are SKIP. So while the market is closed, FEED_STALE and PREMIUM_TOO_HIGH stay dark.
- The other 12 codes stay dim. They are marked "[after deploy]" through CSS generated content (`li[data-vault-only]::after`), never as DOM text inside `li[data-code]`.

**The summary line.** A throttled aria-live summary counts `firing.ts` results. While the NYSE is closed it reads, for example, "Lit now on Base: Token not allowed on 10 of 13 · Market closed on 3 of 13 · as of block N". The real counts come from the read.

### 6.7 Weigh it yourself (`#try`)

**Hardware keys.** Chips become keys, with 1 px of travel on `:active` over 60 ms and a 120 ms colour change.

**The time slider.**
- It gets hourly ticks, the NYSE band, and detents at the open and the close.
- A detent snaps only on pointer release at the end of a drag, within 6 minutes of the open or close.
- Keyboard steps and change events stay at one minute per step. So 15:59 ET is in session, and the next ArrowRight gives 16:00 ET and MARKET_CLOSED (`simulator.spec.ts:52-60`, `simulator.test.tsx:172-175`).
- Crossing 16:00 ET flips the session lamp and tilts a small Balance.

**Execute.**
1. The DOM verdict updates in the click's own task.
2. Then WEIGH plays, lighting channels 1-9 at 40 ms each.
3. TIP follows (600 ms), then STAMP (220 ms).
4. PRINT ends it: a tape row clip-reveals into "Today's decisions" over 260 ms.

The whole sequence takes 700 ms or less.

**Layout.**
- The controls column is sticky, and the actions sit in one row.
- The four notes, today four visible paragraphs (`TryIt.tsx:44-56`), become a 2x2 label card. Their text stays exactly as `page.test.tsx:57-76` pins it.

**Unchanged:** Share URL and Post on X.

### 6.8 Ledger tape (`#ledger`)

- **Kept:** the real `<table>`, its rows, the filters and the fork plate.
- **Below 720 px:** the rows become cards with the verdict first. This ends today's 820 px minimum width, which hid the DECISION column.
- **The mainnet slot** stays unlit with "[after deploy]". It shows Basescan tx rows only from a real `base-mainnet` row.

## 7. Other pages and chrome

### 7.1 `/now`

The h1 "Right now on Base" is pinned. In P4, after the record change merges, `/now` gains these parts above the existing NowBoard:

- the full Readout;
- a summary line built from the same verdicts, for example "N of 13 refused · <first reason> · NYSE opens Mon 09:30 ET in 11 h 58 min";
- NowConsole, with 13 channel strips. Each strip has:
  - a verdict lamp with its word;
  - a premium meter against the FACTS limit;
  - a feed-age bar against `maxStalenessSec` ("90,000 s (25 h)");
  - the multiplier;
  - a paused lamp;
- a session sparkline labelled "read by this tab since HH:MM ET";
- the method, in disclosures.

On phones the strips are a snap row marked `data-snap-x`, not `data-scroll-x`. `live.spec.ts:228` needs exactly one `[data-scroll-x]`, the NowBoard table. Each strip fits its own width.

NowBoard stays visible, so `live.spec.ts:191` and `:227` still pass.

P3 builds NowConsole and tests it in `web/test/instrument-now-console.test.tsx` only. Mounting it means editing `now/page.tsx`, a record file.

### 7.2 `/gap-index`

The title, h1, canonical and the markup's figures are kept.

- **Edition-at-a-glance strip:** small multiples, one per measured token.
- **GapChart:** it gains a draw-in and a readout. It stays a server component, and the scrubber is a client child fed by props.
- **Token pills:** one snap row on phones; today they wrap to 4 rows.
- **Window tape:**
  - It includes the next pending window.
  - Its cells use `data-tape-window` and sit outside the window `<section>`s.
  - It draws no `svg` inside a pending section.
- **Header:** it shows the docked plate unlit, linked to `/now`, and makes no RPC request.

### 7.3 `/ledger`

This happens only after PR #15 merges; otherwise it moves to P4.

- KPI tiles become Readout windows, unlit with "[after deploy]" until real events exist.
- Decision events print as tape rows with Basescan links.
- The page makes no request beyond what PR #15's page makes today.

### 7.4 Docs

This uses `docs.css` only, keeping the DOCS_MARKERS isolation.

**Headings:** H1 40 px / -0.04em, and H2 28 px / -0.03em.

**The chassis palette**, mapped onto Fumadocs' dark palette:

| Fumadocs role | Colour |
|---|---|
| background | `#0B0D12` |
| card | `#14171F` |
| border | `#262B36` |
| foreground | `#F3F4F6` |
| muted | `#B4BAC6` |
| primary | `#9DAEFF` |

**Figures:** tabular `<Fact>`.

**StatusBadge as lamp chips:**
- Fork-tested: ring;
- Live on mainnet: filled;
- Planned: dashed.

Docs prose about the redesign waits for the record change.

### 7.5 Chrome

- **Shared parts.** The same header, footer and CTA appear on every site page. Off the landing, the CTA and the ThumbBar link `/#try`, never a bare `#id`.
- **Live chrome reads Base only on `/` and `/now`.**
  - This covers the docked mini readout, the ThumbBar lamp and the footer's "from block N".
  - On `/gap-index` and `/ledger` these show their unlit frame with "Live on / and /now", make no RPC request, and link `/now`. In P1 only the `/gap-index` Header shows it. The `/ledger` frame ships with the pages-first nav in P4, because `/ledger` renders PR #15's `Nav`, whose links its tests pin.
  - The docked readout reaches `/now` in P4, because the `/now` Header is in a record file.
- **Calibration rail and "Sections" sheet.** These exist on the landing only, at 1280 px and up.
  - Both scroll-spy the six ids. They link `#top`, `#how`, `#reasons`, `#try` and `#mandate`.
  - Their Ledger entry links `/ledger`, as PR #15's nav does, while still spying `#ledger`.
  - Both ship in P4.
- **View transitions.** Cross-document view transitions are declared only under `prefers-reduced-motion: no-preference`.
- **Serial plate.** The server Footer renders it from `currentBuildCommit()` in `lib/build-info.ts`: "MAAT M-9 · built from commit <short> · 0 third-party scripts", plus `commitSuffix` for a dirty build. The commit clause is left out when the build has no commit.
- **Print stylesheet.** It turns the landing into a short sheet, with sources as endnotes. This part can be cut.

## 8. Motion

### 8.1 Rules

1. **Content never moves; the instrument does.**
   - Text and numbers render at their final value in the HTML.
   - Only these animate: beams, ticks, lamps, rules, scan lines, digit rolls between two real readings, and tape.
   - Nothing is parked at opacity 0 outside `@keyframes`.
2. **Motion is earned by data.** Something moves only when a reading lands, a check resolves or the visitor acts.
3. **Never count.** Static facts never animate their digits.
4. **Pause what nobody sees.**
   - The scan line and rAF loops stop when offscreen or when `document.hidden`.
   - HOLD stops reads, the countdown and the scan line.
5. **Finite and short.**
   - Every finite animation ends within 2.2 s of its trigger.
   - There is no `animation-timeline`, no scroll hijack and no pinned section over 200 vh.

### 8.2 Tokens

These go in `globals.css`, outside the pinned colour block.

**Durations:**
- `--t-tick: 120ms`: hover, a lamp turning on, key colour.
- `--t-flip: 240ms`: digit roll, weight settle, state change.
- `--t-weigh: 600ms`: the beam.
- `--t-draw: 900ms`: the scope trace and the signal path.
- `--stagger: 30ms`.

**`--ease-instrument: cubic-bezier(.2,.7,.2,1)`.** This is new, though the curve itself is not: today it is written inline in `.anim-row` and `.anim-stamp`. It is not named `--ease-out`, because that is Tailwind's own `cubic-bezier(0,0,.2,1)`, and defining it would change the `ease-out` utility.

**`--ease-needle` and `--ease-settle`.**
- `--ease-needle` has damping ratio .42, 23.4% overshoot. `--ease-settle` has damping ratio .7, 4.6% overshoot.
- Both are `linear()` strings that `web/scripts/springs.ts` generates from `web/lib/motion/spring.ts` into a marked block.
- `web/test/springs.test.ts` fails if the block and the model disagree, so the CSS and the drag share one model.

**Fallback.** `@supports not (transition-timing-function: linear(0, 1))` falls back to `cubic-bezier(.34,1.4,.64,1)`.

### 8.3 Inventory

| Name | Duration | Note |
|---|---|---|
| beam-tip, beam-level | 600 ms | needle |
| tick-lit | 120 ms | on the row-in schedule |
| lamp-on | 120 ms, plus a 6 px ring fading over 240 ms | |
| digit-roll | 240 ms each, 30 ms stagger | WAAPI `translateY` |
| wght-settle | 240 ms | weight 300 to 560 |
| scan | 400 ms | once per read, hero on screen |
| stamp | 500 ms | existing |
| print | 260 ms | clip-path |
| draw | 900 ms | `stroke-dashoffset`, once in view |
| key-press | 60 ms | 1 px travel |
| colour on nav links, simulator chips and pills | 120 ms | nav links and chips snap today; the `/gap-index` pills use Tailwind's default `transition-colors` and move to 120 ms |
| thumb bar | 240 ms | |

### 8.4 Reduced motion and forced colours

- **The CSS reduce block.** The global reduce block stays as `tokens.test` pins it. Because the base style is the final frame, every element lands on the truth.
- **What `prefersReducedMotion()` changes:**
  - digit rolls set the text directly;
  - Execute's delays are skipped;
  - the drag is off;
  - `#how` is not sticky.
- **View transitions** are declared only under no-preference.
- **Under `forced-colors`**, lamps gain 1 px borders and ghosts are hidden.

## 9. Type and colour

### 9.1 Type

The faces stay Geist Sans and Geist Mono variable, as today, with no new font bytes. The signature comes from how the faces are used:

- the mono weight settles when data lands;
- ghost segments sit behind live numbers;
- digits are tabular everywhere;
- plate labels are engraved.

| Role | Spec | 1440 / 390 |
|---|---|---|
| H1 | `clamp(44px,5.4vw,78px)`, 600, line-height .96, -0.055em | 78 / 44 |
| H2 | `clamp(32px,3.6vw,52px)`, line-height 1.02, -0.045em, `text-wrap: balance` | 52 / 32 |
| H3 | 22, line-height 1.2, 600, -0.025em | 22 |
| Lead | 19, line-height 1.55 | 19 / 17 |
| Body | 16, line-height 1.6, ink-body | 16 |
| UI | 15, 500 | 15 |
| Readout digits | Geist Mono 560 (settling from 300), `clamp(26px,2.6vw,38px)`, -0.02em, tabular | |
| Scope figures | Geist Mono 500, `clamp(48px,6vw,88px)` | |
| Plate labels | Geist Mono 500, 11 px, uppercase, .12em | 11 |
| Eyebrows | unchanged: mono 12 px, .08em, accent | 12 |

On phones the hierarchy becomes H1 44 px against H2 32 px; today it is 42 against 40. The balanced H2 also removes the one-word widows.

### 9.2 Colour

The 20 pinned tokens do not change (3.1). These tokens are added:

| Token | Value | Use and contrast |
|---|---|---|
| `--color-chassis-2` | `#14171F` | raised window |
| `--color-chassis-line` | `#262B36` | decorative hairline |
| `--color-lcd` | `#F3F4F6` | 17.66:1 on ink |
| `--color-lcd-2` | `#B4BAC6` | 9.98:1 on ink, 9.20:1 on chassis-2 |
| `--color-lcd-ghost` | `#1A1E27` | decorative, aria-hidden |
| `--color-pass-lit` | `#9DAEFF` | 9.19:1 on ink; the focus ring on dark |
| `--color-refuse-lit` | `#FF9B66` | 9.38:1 on ink |
| `--color-lamp-pass` | `#4D6BFF` | lamp core, always with a word |
| `--color-lamp-refuse` | `#FF5A1F` | lamp core, always with a word |
| `--color-label` | `#4A5160` | 7.96:1 on white, 7.43:1 on surface-soft |
| `--color-refuse-ink` | `#9A3412` | 6.62:1 on refuse-tint |
| `--color-tick` | `#C9CED8` | decorative |

Two of these replace weaker pairs:
- `--color-label` replaces every new small-text use of ink-3, which is 3.19:1 on white.
- `--color-refuse-ink` exists because refuse on refuse-tint is only 4.69:1.

**Contrast rules.** `web/test/instrument-contrast.test.ts` checks these over the declared pairs:
- Text at 12 px or less is 7:1 or more.
- All other text is 4.5:1 or more.
- Accent and refuse are never text on ink, and ink-2 is never used on ink.

There is one pinned exception. The ReasonTag code keeps the ink-2 colour that `smoke.spec.ts:159` pins: 6.21:1 on white and 5.80:1 on surface-soft. The test lists it as an exception at 4.5:1 or more.

**Surfaces:**
- The white faceplate is the body.
- Ink chassis bands carry the Scope and the footer.
- Display windows use chassis-2, with radius 14 and an inset bezel.
- Faceplate cards keep radius 20 and a 1 px line.
- No new shadows.

`og.png`, its alt text, the X banner and the avatar stay valid.

## 10. Live data, provenance and states

### 10.1 Sources

- **Live reads.** All of them go through the existing keyless browser RPC (`useLiveSnapshot`: publicnode, then mainnet.base.org), once per page through LiveSnapshotProvider. Nothing live is baked into the HTML.
- **Recorded numbers.** Each one comes from FACTS, the fork ledger rows or the edition files, with a test.
- **The calendar line.** It reads "repo calendar" until `deployments.json` has a MarketCalendar address, then "MarketCalendar 0x…", from `snapshot.calendar.source`.
- **The basket caption.** "default mandate · checks 1, 2, 4-7 · not the vault".

### 10.2 SOURCES

**Marking a fact.**
- `<Fig k="mandate.maxPremiumBps">` reads `FACTS.mandate.value.maxPremiumBps`, with its source from `FACTS.mandate.source`.
- `k` is either `<entry>` or `<entry>.<field>`.
- Fig never inserts an element inside a string that a test matches. `data-fact` goes on the element that already holds the whole string, for example the `24h` value or the replay plate.
- When one string holds several facts, their keys go in one space-separated `data-fact` attribute.

**The SOURCES key.**
- The key (`aria-pressed`) sits on the spec plate and in the footer.
- When it is on, the client mounts an engraved 11 px caption under each figure, for example "24h · MandateVault.sol TIMELOCK".
- The captions are not in the static HTML, so the exact-text tests stay intact.

**`web/e2e/sources.spec.ts`.** It fails on any digit in the landing DOM that has none of these marks on itself or an ancestor:

- `[data-fact]`;
- `[data-live]`;
- `[data-simulated]`, for the simulator's chosen and computed values;
- `[data-record]`, for the fork ledger rows of `content/decisions.ts`, whose source is `agent/test/integration/agent.fork.test.ts`.

The spec also allows:

- dates and times;
- the check ordinals 01-09 and the treasury step ordinals 01-05;
- names and identifiers that contain digits: B20, Aave V4, x402, ERC-8021, 24/7, "5 minutes", MIT, uint256, uint8, bytes32 and hex hashes.

Until P4 merges, the spec also allows everything inside `#mandate` and the status line. P4 removes that exemption once `Mandate.tsx` renders through Fig.

### 10.3 States

Every live or heavy surface has a designed frame for each state:

- **reading:** ghost segments and "Reading Base mainnet…";
- **live**;
- **stale:** with the age written;
- **behind:** the RPC's block is behind;
- **error:** with the words and the Retry key.

None of these frames is an empty box. `web/e2e/instrument-states.spec.ts` drives each state with `e2e/fake-live-rpc.ts` and checks it in the DOM: the `data-live-strip` value, the words, and no empty box. It saves `page.screenshot` captures into `test-results/screens`, as `smoke.spec.ts` does. No `toHaveScreenshot` baselines are committed, because they are named per platform and would never match CI.

### 10.4 Dated moments

- **Thanksgiving, Thu 26 Nov.** The live hero reads "Thanksgiving · NYSE closed" (`session.detail`).
- **Fri 27 Nov.** The hero reads "Friday · open until 13:00 ET" in session and "Friday · early close 13:00 ET" after it.
- **Mainnet slots.** The ledger, hero and `/ledger` slots flip from FORK to MAINNET only when both of these hold:
  - `deployments.json` has an address;
  - a real `base-mainnet` row exists.

  Nothing is claimed in advance.

## 11. The bar this work must clear

Items 2, 4 and 5 are manual measurements, taken at P-1 and P5 and recorded in the PR description. Lighthouse runs from Chrome DevTools, or from a version-pinned `npx lighthouse@<x.y.z>` outside the repo. It is never added to `package.json`. Every other item is a test or a check.

1. **First viewport.**
   - At 1440x900, these all end above 900 px: the H1, both CTAs, the live Readout with a block number read by the browser, and the complete verdict window.
   - At 390x844, the H1 and the live verdict line are in the first screen.
2. **First live reading.**
   - It is painted in 2.0 s or less p50 on desktop, and 3.0 s or less under Lighthouse mobile throttling.
   - The lead moves 1 px or less.
   - CLS is 0.00 on `/`, `/now` and `/gap-index`.
3. **Weight.** `web/e2e/weight.spec.ts` gzips `out/index.html` and every `/_next/` module script, stylesheet and font the landing links. A `noModule` legacy polyfill is not counted, because no browser that runs the module scripts downloads it. It fails if:
   - the total is over 360,000 B;
   - JS is over 185,000 B;
   - CSS is over 18,000 B;
   - fonts move more than 1 KB from the P-1 baseline;
   - any JS chunk linked by `/` or `/gap-index` contains a string unique to `edition-0.json`.

   The pages must also have 0 third-party scripts and 0 console errors. After PR #15 merges, this check may move into `lib/check-out.ts`.
4. **Lighthouse mobile.** Median of 3 runs on `/`, `/now`, `/gap-index` and one docs page:
   - Performance: target 95 or more, gate 90.
   - Accessibility, Best Practices and SEO: 100 each.
   - LCP: 1.5 s or less on desktop, 2.5 s or less throttled.
   - TBT: 150 ms or less.
5. **Interaction.**
   - INP is 100 ms or less on Sat/Thu, the simulator keys and Execute.
   - Execute's sequence takes 700 ms or less.
   - No task runs longer than 50 ms during the hero intro.
6. **Motion integrity.**
   - Every finite animation ends within 2.2 s.
   - There is no `animation-timeline`, and no opacity:0 outside keyframes.
   - Smoke's wait passes at 360, 768, 1024, 1440 and 1920 px.
   - Reduced motion shows the final beam angle, digits and tape.
   - Hidden tabs, offscreen instruments and HOLD run no rAF. Hidden tabs and HOLD also run no 30 s read.
7. **Provenance.**
   - `sources.spec.ts` passes.
   - No number counts from zero.
   - No chain value is in the static HTML.
   - The `live.spec.ts` call counts are unchanged: one multicall per read.
8. **Contrast and access.**
   - The contrast test passes.
   - Focus is visible on white and on chassis.
   - `forced-colors` captures are legible.
   - axe finds 0 serious or critical issues at all five widths on every site page.
   - Targets are 44 px or larger.
9. **Length.** Desktop is 8,500 px or less and mobile 12,500 px or less, with the Scope band included.
10. **Five moments, each shipped and filmed:**
    - a beam that tips at the failing check, with its final frame in the static HTML;
    - a 19-lamp annunciator, up to 7 of its lamps lit by the chain "as of block N";
    - a real mainnet time series on the landing, with a keyboard scrubber;
    - the same live readout docked in the nav on `/`, and on `/now` from P4, shown unlit on the other site pages;
    - a refusal the visitor triggers, watches weigh, tip, stamp and print, and shares by URL.
11. **Never an empty box.** Every state in 10.3 passes `instrument-states.spec.ts`.
12. **Mobile.**
    - No horizontal scroll at 360 px.
    - The ledger's DECISION column is visible at 390 px.
    - The `/gap-index` pills sit in one snap row.
    - The ThumbBar never covers `#try` or the footer.
13. **Cross-browser.**
    - The Playwright `webkit` and `firefox` projects pass `smoke.spec.ts`.
    - The `linear()` fallback works.
    - View transitions degrade to a plain navigation.
14. **Thanksgiving.** On Thu 26 Nov the live hero reads "Thanksgiving · NYSE closed", and the frame is captured.

## 12. Phases

### 12.1 Ship order

Each phase is its own branch. It merges only when CI is green: typecheck, vitest, build, check:out and Playwright.

The mainnet go-live moved to Tue 24 Nov. Until it is done, main stays at `66bd0d0`, so the go-live script's commit check stays quiet. Branches are built and pushed in the meantime and merge after the go-live.

| Phase | When | Branch | Scope |
|---|---|---|---|
| P-1 | Tue 24 Nov, after the go-live | none | merge PR #15 when green; check the record change still applies to the new main; capture a before baseline (screenshots, Lighthouse ×3, weights) |
| P0 primitives | built Mon 23 to Tue 24 Nov, merged after P-1 | `feat/instrument-primitives` | the section 5.1 units that no later phase names, unmounted; additive and motion tokens; springs script and parity test; contrast test; `formatLimit` and `nextOpen`; the `@source` line; `weight.spec.ts`; webkit and firefox projects. No visual change |
| P1 hero | merged by Wed 25 Nov 16:00 UTC | `feat/hero-instrument` | LiveSnapshotProvider, `active` and HoldKey; Readout in LiveStrip; Balance and verdict-first DecisionEngine; H1 and H2 scale; spec plate; tick ruler; ThumbBar; 120 ms colour transitions; drag-to-tip; the unlit docked plate in the `/gap-index` Header; the docked readout in Nav only if PR #15 has merged |
| P2a story | Thu 26 to Fri 27 Nov | `feat/scope-annunciator` | Weekend Scope, `content/scope.ts` and ScopeScrubber; Annunciator and `firing.ts`; Problem channels and ThisWeek; Built-on plate |
| P2b story | Sat 28 to Sun 29 Nov | `feat/signal-path-desk` | `#how` signal path; simulator keys and Execute sequence; ledger cards; SOURCES and `sources.spec.ts` |
| P3 pages | Mon 30 Nov to Tue 1 Dec | `feat/live-pages-instrument` | NowConsole, built and unit-tested but not mounted; `/gap-index` scrubber, small multiples, snap pills and tape; `/ledger` readouts if PR #15 has merged; docs.css; view transitions |
| P4 IA | Wed 2 Dec, after the record change merges | `feat/global-nav-instrument` | status line; Mandate calibration sheet; mount the Readout, summary line and NowConsole on `/now`; pages-first nav, rail and sheet; footer chassis and serial plate; treasury ring; `page.test` and `top.test`; mainnet slots live only from real rows; remove the `#mandate` exemption from `sources.spec.ts` |
| P5 QA | Thu 3 Dec | `chore/instrument-qa` | Lighthouse ×3 per page; axe at five widths; reduced motion and forced colours; after captures; README screenshots only if PR #15 and the record change have merged |

If the record change has not merged by Wed 2 Dec, P4 ships only the footer, the rail and the treasury ring, and the rest waits.

Submission is planned for Fri 4 Dec. The hard deadline is Sat 5 Dec 23:59 UTC.

### 12.2 Conflict rules

**Until the record change merges:**
- do not edit any of its 60 files, `deployments/README.md` or `web/content/generated/deployments.json`;
- put every new assertion in a new test file;
- use `verdict.ts` read only;
- make no changes to docs prose.

**Until PR #15 merges, do not touch:**
- `Nav.tsx` or `Ledger.tsx`;
- `(site)/layout.tsx`;
- `lib/check-out.ts` or `scripts/check-out.ts`;
- `next.config.ts`, `package.json` or `package-lock.json`;
- `sitemap.ts`;
- the `@source` brace line, or the lines next to it.

**After every redesign merge,** re-check that the record change still applies.

**Every limit reads FACTS.**

### 12.3 Cut order

If time runs short, cut in this order:

1. drag-to-tip;
2. view transitions;
3. the print sheet;
4. the calibration rail;
5. the `/now` sparkline;
6. the treasury ring.

The core is never cut: the Balance, the Readout, the Annunciator, the Scope and the mobile fixes.

## 13. Testing

Until the record change merges, all new tests go in new files.

| Test | Checks |
|---|---|
| `web/test/springs.test.ts` | the `globals.css` springs block equals the model's output; each curve's overshoot is within 1 point of its target |
| `web/test/instrument-contrast.test.ts` | every declared text pair meets 7:1 at 12 px or less and 4.5:1 otherwise, with the pinned ReasonTag exception |
| `web/test/instrument-*.test.tsx` | each unit in 5.1 renders its states; Lamp always renders its word and never a ReasonTag; Meter reads its limit from a prop fed by FACTS; each helper's missing-API path |
| `web/test/format-limit.test.ts` | the "90,000 s (25 h)" wording and the bps wording |
| `web/test/calendar-next-open.test.ts` | `nextOpen` across a weekend, Thanksgiving and the 13:00 ET early close |
| `web/test/live-firing.test.ts` | per-code counts on fixed snapshots, SKIP after the first failure included |
| `web/test/live-snapshot-provider.test.tsx` | one read loop for several subscribers; HOLD stops reads and timers |
| `web/test/scope.test.ts` | the pick is the largest measured gap; the client series reaches it (its minimum gap equals −largestGap.bps); the series stays under its byte budget; "safe" is absent |
| `web/e2e/instrument.spec.ts` | first-viewport bounds at 1440x900 and 390x844; `#top [role="status"]` count 2 and `#top [role="status"] > div` count 1; ThumbBar rules; no horizontal scroll at 360 |
| `web/e2e/instrument-states.spec.ts` | the reading, live, stale, behind and error frames (10.3) |
| `web/e2e/sources.spec.ts` | provenance (10.2) |
| `web/e2e/weight.spec.ts` | budgets (11, item 3) |
| existing `smoke`, `live`, `simulator`, `gap-index`, `ledger` and `docs` specs | unchanged and green; `smoke` also on webkit and firefox |

Locally, Playwright runs with `--workers=2`. CI keeps `--workers=1` (`ci.yml:150`).

## 14. Out of scope

- No contract, agent or deploy change.
- No new route. `/break`, `/proof` and `/d/<tx>` can reuse the instruments later.
- No sound and no haptics.
- No new font, library or third-party script.
