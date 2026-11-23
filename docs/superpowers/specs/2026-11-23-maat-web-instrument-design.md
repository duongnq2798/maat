# Maat M-9: the site as a weighing instrument

Date: 2026-11-23. Branches: one per phase (section 12). Status: the owner chose the direction and settled the four open decisions on 2026-11-23 (section 2).

## 1. Goal

maatonbase.xyz explains a risk engine today. After this change it works like one. The site becomes a single precision instrument: a white faceplate, an ink chassis, and lit segments. Every lit segment is a sourced reading, and the loudest state on the device is NO.

The hero object is the 30 px mark from `web/brand/mark.ts` (the beam, the feather `#6E83FF` and the order block), redrawn as a balance. It tips only when a check fails. Four instruments sit around it:

- **a readout** of Base mainnet, read by the visitor's browser;
- **an annunciator** with 19 lamps, one per refusal code, lit by the chain right now;
- **a scope** that traces a real mainnet weekend from the Weekend Gap Index;
- **a printed tape** of verdicts.

The design reference is industrial faceplates: engraved labels, keycaps and lamps. It is not a retro calculator. Unlit segments are close to invisible.

### 1.1 Research behind it

On 2026-11-23, three reference landing pages chosen by the owner and maatonbase.xyz itself were captured at 1440x900 and 390x844, one screenshot per viewport while scrolling. The captures recorded fonts, the type scale, colours, libraries, animations, transfer size and page length. Three directions were drafted and scored by three judges (a visual-design judge, a fintech head of design and a staff front-end engineer) on six axes:

- craft;
- clarity in 5 seconds;
- trust;
- memorability;
- feasibility in about 8 agent-days;
- safety against the repo's pinned tests.

This spec is the winning direction, with three parts grafted from the runners-up:

- a single spring model that drives both the CSS easing and the drag;
- a verdict-first engine card;
- a per-number sources layer.

The notes and captures stay outside the repo. Section 11 lists the bar this work must clear. Each item there is measured, and none of it depends on the reference sites.

### 1.2 What success looks like

A visitor on a laptop sees four things in the first viewport without scrolling:

- the headline;
- both calls to action;
- a Base block number their own browser just read;
- a complete verdict with its reason code.

A visitor on a phone sees the headline and the live verdict line in the first screen.

Every number on the page traces to a FACTS entry with a source, to the edition files, or to a live read named by block. Nothing counts up from zero. Nothing is an empty box while it loads. The site stays under 360 KB on the landing.

## 2. Decisions

The owner settled these on 2026-11-23:

1. **Art direction: M-9, the weighing instrument**, with the grafts named in 1.1. Geist and Geist Mono only; no serif and no new font bytes.
2. **Hero delight: drag-to-tip only.** The visitor can drag the beam. On release it springs back to the contract's answer. There is no sound. The drag is a lazy module and is the first thing cut if time runs out.
3. **Top nav (phase P4): pages first.** The bar reads `maat · Now · Gap Index · Ledger · Docs · View on GitHub ↗`. The landing sections move to a scroll-spy rail on desktop and a "Sections" sheet on phones.
4. **Weekend Scope headline: picked at build time.** The build picks the largest measured gap in the edition files. When this spec was written that was MSTRc in window 2026-11-13: 1,411 bps below the held feed, 48.44 h frozen, 47,880 swaps while frozen. NVDAc is one tap away in the small multiples. The copy comes from the data, so it never drifts from it.

## 3. Constraints the design keeps

Each of these was checked on main at `66bd0d0`.

1. **Pinned strings and tokens stay.**
   - The H1 "The AI agent that knows when not to trade." is pinned.
   - The section ids and their order (`#top`, `#how`, `#reasons`, `#try`, `#ledger`, `#mandate`) are kept. No new anchor link is added.
   - The 18 colour tokens in `globals.css` stay byte-identical (`tokens.test`, `brand.test` PALETTE).
   - Geist and Geist Mono stay mapped as `tokens.test` pins them.
   - The body background stays `#FFFFFF` (`docs.spec`).
   - The global `prefers-reduced-motion: reduce` block stays exactly as written.
2. **Smoke's animation wait.**
   - `web/e2e/smoke.spec.ts` waits until every non-infinite entry of `document.getAnimations()` is `finished`. That list includes CSS transitions and WAAPI animations.
   - So every finite animation ends within 2.2 s of its trigger.
   - The countdown changes text once a minute and never animates.
   - Nothing sits in a paused "armed" keyframe.
   - The live dot is the only infinite animation.
3. **Exactly one status region in the hero.**
   - Smoke's reduced-motion test collects the 9 check `li` plus `#top [role="status"] > div` and expects exactly 10.
   - The live announcer stays the sr-only `<span role="status">` in `LiveStatus.tsx`.
   - The Readout adds no other `role="status"` with `div` children inside `#top`.
   - The beam's nine ticks are not `li` elements inside "Mandate checks".
4. **The annunciator stays on a light surface.**
   - Smoke pins the MARKET_CLOSED code colour at ink-2 `#5A6170`.
   - On ink `#0B0D12` that is 3.13:1, which fails AA. On surface-soft `#F6F7F9` it is 5.80:1.
   - So `#reasons` is a light faceplate, and a lit lamp shows as a ring, not a dark panel.
5. **The live strip stays where tests expect it.** The Readout keeps `data-live-strip` and sits directly before the lead `<p>`. The lead may move at most 1 px when the first reading lands (`live.spec`).
6. **Nothing live is in the static HTML.** check:out bans `>LIVE<` and `basescan.org/block/` in the export. Live values appear only after the browser reads them.
7. **Limits come from FACTS, never from literals.** The branch `feat/mainnet-config` (unmerged) may move `maxPremiumBps` from 100 to 150. Every meter's full scale and every "limit" line reads `FACTS.mandate`.
8. **Two pending changes own some files.**
   - **PR #15** (the live ledger dashboard) edits, among others:
     - `web/components/sections/Nav.tsx` and `Ledger.tsx`;
     - `web/app/(site)/layout.tsx`;
     - `web/lib/check-out.ts` and `web/scripts/check-out.ts`;
     - `web/next.config.ts` and `web/package.json`;
     - the `@source` brace line in `globals.css`;
     - `page.test.tsx`, `top.test.tsx`, `web/README.md` and `status.mdx`.
   - **The deployment-record change**, which lands after the mainnet deploy, edits 60 files, including:
     - `page.test.tsx`, `top.test.tsx`, `now-page.test.tsx`, `live-verdict.test.ts` and `docs.spec.ts`;
     - `web/README.md`;
     - `web/lib/live/verdict.ts`;
     - `AnnouncementBar.tsx`, `Mandate.tsx`, `NowBoard.tsx` and `app/(site)/now/page.tsx`;
     - 39 docs MDX files.
   - Until each one merges, the redesign does not edit its files (section 12.2).
9. **No new dependency and no third-party script.** No animation library, no smooth-scroll library and no WebGL. The landing makes no request except the keyless RPC reads it already makes.
10. **The edition JSON never ships to the client.** The 368 KB edition file is read at build time. Only a downsampled series for the selected token reaches the browser.

## 4. Instrument grammar

One rule set holds on every page.

- **Tilt means verdict.**
  - Only the beam tilts: level means allowed, and -6° means refused.
  - Nothing else on the site rotates to carry meaning.
- **Meters mean magnitude.**
  - Horizontal bars or needles show bps, hours and drift.
  - Each is scaled to a FACTS limit, and the number is always written next to it.
- **Lamps mean state, and always carry a word:** PASS, REFUSE, SKIP, LIVE or NOT LIVE. Colour is never the only signal.
- **Plates mean provenance, shown by word and by shape:**

  | Plate | Shape |
  |---|---|
  | `BASE MAINNET · LIVE` | filled dot |
  | `BASE FORK · REPLAY · BLOCK 53,551,627` | ring with hatch |
  | `EDITION 0 · RECORDED` | square |
  | `YOUR BROWSER · SIMULATED` | outline |
  | `PLANNED` or `[after deploy]` | dashed |

- **Ghost means not read yet.**
  - Unlit segments appear next to the words "Reading Base mainnet".
  - A reading is never shown as a 0 or an empty box before it arrives.

## 5. Units

Each unit has one purpose and can be tested on its own.

### 5.1 New code

| Unit | Path | Does | Depends on |
|---|---|---|---|
| Readout | `web/components/instrument/Readout.tsx` | chassis window, fixed height per breakpoint, rows passed as children, bezel keys slot | Digits, Ghost |
| Digits | `web/components/instrument/Digits.tsx` | mono tabular number that rolls only the changed digits between two real readings | `rollDigits` |
| Ghost | `web/components/instrument/Ghost.tsx` | unlit segments as CSS generated content on an empty aria-hidden span; hidden under forced-colors | none |
| HoldKey | `web/components/instrument/HoldKey.tsx` | `aria-pressed` key that freezes reads and the countdown (WCAG 2.2.2) | none |
| Lamp | `web/components/instrument/Lamp.tsx` | state lamp, always with its word; a `::before` driven by a data attribute | none |
| Meter | `web/components/instrument/Meter.tsx` | hairline bar scaled to a limit, with the number written | `formatLimit` |
| Ruler | `web/components/instrument/Ruler.tsx` | decorative tick ruler (minor tick every 8 px, major every 56 px) | none |
| Balance | `web/components/instrument/Balance.tsx` | SVG beam scaled from `MARK`, nine ticks, tilt keyed off `data-verdict`, aria-hidden | `web/brand/mark.ts` |
| SourcePlate | `web/components/instrument/SourcePlate.tsx` | provenance plate (section 4) | none |
| Tape | `web/components/instrument/Tape.tsx` | printed verdict rows with a clip-path print-in | none |
| Fig | `web/components/instrument/Fig.tsx` | renders a FACTS value with `data-fact`; shows its source when SOURCES is on | `content/facts.ts` |
| Live | `web/components/instrument/Live.tsx` | renders a live value with `data-live` (block, host, time) | none |
| useTipDrag | `web/components/instrument/useTipDrag.ts` | lazy drag integrator, loaded on the first pointerdown | `spring.ts` |
| spring | `web/lib/motion/spring.ts` | damped spring model: samples for CSS `linear()`, and one integrator step for the drag | none |
| onceInView | `web/lib/motion/once-in-view.ts` | one shared IntersectionObserver that sets `data-seen` (rootMargin `100000px 0px -12% 0px`) | none |
| reducedMotion | `web/lib/motion/reduced-motion.ts` | `prefersReducedMotion()` | none |
| rollDigits | `web/lib/motion/roll-digits.ts` | WAAPI roll (240 ms, 30 ms stagger); sets text directly under reduced motion | reducedMotion |
| springs script | `web/scripts/springs.ts` | writes the `--ease-needle` and `--ease-settle` `linear()` strings into a marked block in `globals.css` | spring |
| formatLimit | `web/content/format.ts` (new export) | one wording for limits everywhere, e.g. "90,000 s (25 h)" | none |
| firing | `web/lib/live/firing.ts` | per reason code, how many of the 13 B20 tokens raise it at this block | `verdict.ts`, read only |
| scope | `web/content/scope.ts` | build time: picks the largest measured gap and downsamples its series; summaries for the small multiples | edition files |
| Scope | `web/components/instrument/Scope.tsx` | server-rendered trace, range-input scrubber, small multiples, window tape | `content/scope.ts` |
| NowConsole | `web/components/live/NowConsole.tsx` | channel strips for /now beside the existing NowBoard | Lamp, Meter |

### 5.2 Changed code

| File | Change | Phase |
|---|---|---|
| `web/components/live/LiveStrip.tsx` | renders inside a Readout; keeps its export name, states, strings and `data-live-strip`; the 160 px reserve band on phones is replaced by the Readout's fixed height | P1 |
| `web/components/DecisionEngine.tsx` | verdict-first order; the Balance replaces the decorative header; nine channel rows | P1 |
| `web/components/sections/Hero.tsx` | spec plate, tick ruler, CTAs above the fold, the H1 and H2 scale | P1 |
| `web/app/globals.css` | additive tokens, motion tokens, the springs block, and a separate `@source "../components/instrument";` line | P0 |
| `web/components/sections/Refusals.tsx` | annunciator | P2a |
| `web/components/sections/Problem.tsx`, `BuiltOn.tsx` | channels, plate row | P2a |
| `web/app/(site)/page.tsx` | adds the Scope band between Problem and `#how` | P2a |
| `web/components/sections/HowItWorks.tsx` | signal path with a sticky specimen | P2b |
| `web/components/Simulator.tsx`, `sections/TryIt.tsx` | hardware keys, detents, the Execute sequence | P2b |
| `web/components/LedgerTable.tsx` | cards below 720 px | P2b |
| `web/components/gap/*` | draw-in, scrubber, snap row of pills | P3 |
| `web/components/sections/Footer.tsx`, `TreasuryLoop.tsx` | ink chassis, mini Balance, serial plate, treasury ring | P4 |
| `Nav.tsx`, `AnnouncementBar.tsx`, `Mandate.tsx`, `NowBoard.tsx` | P4, after PR #15 and the record change merge | P4 |

## 6. The landing

### 6.1 Hero at 1440x900

From top to bottom:

- **y 0-36: status line.** The AnnouncementBar text stays verbatim. It is restyled only in P4.
- **y 36-108: nav.**
  - Until PR #15 merges, the nav stays as it is.
  - After that it is opaque white, with a 1 px line once the page scrolls.
  - When the hero leaves view, an aria-hidden mini readout docks at the right edge: "● block · NYSE closed".
- **y 108-120: tick ruler.** A 12 px tick ruler (`#C9CED8`) replaces the masked 56 px grid.

**Left column, x 132-700:**

- **AGENTIC pill.**
- **H1.**
  - Geist 600 at `clamp(44px,5.4vw,78px)`, line-height .96, -0.055em.
  - Three lines at 1440, with "when not to trade." in accent.
  - It is the LCP element and never animates.
- **Readout.** A 568x112 chassis window (`#0B0D12`, radius 14, inset 1 px `#262B36` bezel) with exactly three rows:
  1. `● LIVE · Base block N · HH:MM ET · HH:MM UTC`
  2. `NYSE CLOSED · opens Mon 09:30 ET · in 11 h 58 m`. This row has minute resolution. A holiday is named, for example "Thanksgiving" on 26 Nov.
  3. `Would refuse now: Market closed MARKET_CLOSED`, plus three lamps for NVDAc, GOOGLc and AAPLc. Each lamp carries PASS or REFUSE and a hairline premium meter. The meter shows live TWAP-vs-feed bps against `FACTS.mandate.maxPremiumBps`, with the number written.

  Read age, RPC host, HOLD and Refresh are 11 px keys on the bottom bezel. The full detail is under SOURCES and on /now.
- **Lead.** `SITE.description`, at 19 px.
- **CTAs.** "Verify it in 5 minutes" and "Try to make it say no", ending at about y 736, above the fold. Today they are cut at the fold (y 880-900).
- **Spec plate.** 9 / 19 / 24h with engraved 11 px mono labels, and the SOURCES key.

**Right column, x 748-1308: the engine card, verdict first.**

- A header plate `REPLAY · BASE FORK · BLOCK 53,551,627`, and the "Choose a moment" Sat/Thu toggle.
- The Balance.
  - A 120 px beam with the feather in the left pan.
  - An ink order block labelled "BUY GOOGLc · $10" in the right pan.
  - Nine ticks along the beam, one per check.
- The ink verdict window "Refused · Market closed / MARKET_CLOSED", with the label over the code.
- Nine channel rows of 36 px: the grounds.

**Timeline:**

- **First paint, static HTML, no JS.** The base style is the final frame:
  - the beam is at -6°;
  - tick 04 is orange and ticks 05-09 are grey;
  - the verdict is visible;
  - the Readout shows ghost segments and "Reading Base mainnet".

  A CSS intro then plays from first paint (fill both, keyframe from level):
  - ticks light on the existing row-in schedule (120 + 160·i ms);
  - the beam tips with `--ease-needle` (600 ms) from about 0.62 s;
  - the existing verdict stamp fires at 1.65 s;
  - everything has finished by 2.2 s.
- **First read (usually 0.5-2 s).**
  - The LIVE lamp lights in 120 ms.
  - Block digits roll from ghost to the real value in 240 ms each, with a 30 ms stagger.
  - Geist Mono's weight settles from 300 to 560. Mono digits mean nothing reflows.
  - One polite announcement goes through the existing sr-only span.
- **Every 30 s while the page is visible and the hero is on screen.**
  - Only changed digits roll.
  - A 1 px scan line crosses the window once (400 ms).
  - The read age resets.
  - HOLD freezes reads and the countdown.
- **Thu 5 Nov · 10:30.**
  - The ticks relight blue from 1 to 9.
  - The beam swings level on the needle spring.
  - The verdict window turns from ink to accent "Allowed".
- **Drag (lazy, cut first).**
  - The first pointerdown loads `useTipDrag`.
  - The beam tilts up to ±14° against a stiffening spring and springs back to the contract's answer on release.
  - The caption reads "Only the nine checks move this beam."
  - It runs on `requestAnimationFrame` only while unsettled, so it never appears in `getAnimations()`.
  - It is off under reduced motion and is aria-hidden.

### 6.2 Hero at 390x844

- **y 0-32:** the status line in its pinned phone form.
- **y 32-96:** the nav with the mark, Docs and the GitHub pill.
- **H1:** 44 px, in 4 lines.
- **Readout:** a fixed 358x168 with the same three rows, so the live verdict line is in the first screen.
- **Lead:** 17 px.
- **CTAs:** stacked at 52 px each, ending at about y 780.
- **Screen 2:** opens on the Balance and the verdict window, then the channels.
- **Thumb bar.**
  - When both hero CTAs have scrolled out, a 56 px bottom bar slides up. It respects the safe-area inset and holds a live lamp and "Try to make it say no".
  - It hides while `#try` or the footer is in view.
  - Under reduced motion it appears without sliding.

### 6.3 The other sections

| # | Section | Surface | Becomes |
|---|---|---|---|
| 0 | Status line | white | text verbatim; restyled in P4 |
| 1 | Nav | white, opaque | 6.1; pages-first in P4 |
| 2 | `#top` | faceplate + Readout | 6.1, 6.2 |
| 3 | Built on | faceplate | engraved plate row, text only; 2 columns on phones |
| 4 | Problem | faceplate | three channels (below) |
| 5 | Weekend Scope (no id) | ink band | 6.4 |
| 6 | `#how` | faceplate + chassis specimen | 6.5 |
| 7 | `#reasons` | surface-soft faceplate | 6.6; the h2 "Nineteen typed ways to say no." is kept |
| 8 | `#try` | faceplate | 6.7 |
| 9 | `#ledger` | faceplate | 6.8 |
| 10 | `#mandate` | faceplate | P4: a calibration sheet, 12 rows with one tick ruler per limit; every pinned string visible |
| 11 | Treasury loop | surface-soft | P4: five detents on a ring; the "Planned" detent hatched |
| 12 | Footer | ink chassis; the body stays white | P4: "Watch it say no.", a mini Balance labelled "from block N", the pinned links, the disclaimer and tagline, the SOURCES key, the serial plate |

The three Problem channels:

1. This week's real NYSE calendar from `FACTS.calendar`, with a "you are here" needle.
2. The fork facts against the FACTS limit line, plus a live needle for each basket token.
3. The recorded multiplier beside the live `uiMultiplier`.

Length target: 8,500 px or less on desktop and 12,500 px or less on mobile. Today the page is 9,527 and 15,845 px.

### 6.4 Weekend Scope

An ink band with no id, between Problem and `#how`.

- **The trace.**
  - It is a server-rendered trace of the headline gap that `content/scope.ts` picks at build time.
  - It shows the pool price, the held feed and the gap, over the frozen hours, with the Basescan block range.
- **The scrubber.**
  - A transparent `<input type="range">` sits over the trace and moves a crosshair. It works with the keyboard arrows.
  - Its `aria-valuetext` reads, for example, "Sat 14 Nov 17:49 ET, pool 94.05, held 109.50, -1,411 bps".
- **Small multiples.** One per measured token, with NVDAc one tap away.
- **A window tape.** One cell per edition window, plus the next pending window.
- **The punchline:** "The pool moved. The vault's answer never changed: Market closed."
- **The caption** keeps the edition's spot-vs-held caveat and the limit line from FACTS.
- **What ships.** Only the selected token's downsampled series (about 5 KB) reaches the client.

The word "safe" never appears.

### 6.5 Signal path (`#how`)

- **The specimen.**
  - A sticky chassis specimen sits on the right at 1024 px and up. The pinned part is 200 vh at most.
  - It walks through five steps:
    1. Claude's `Intent[]`;
    2. `eth_call previewIntent`, where the Balance previews;
    3. `execute()`, where the block drops onto the pan;
    4. the nine checks;
    5. the Decision event.
- **Steps and rail.** An IntersectionObserver middle band (rootMargin `-45% 0px -45% 0px`) sets `data-step`. A clickable chapter rail I-IV sits on the left.
- **The decoded event.** The decoded Saturday event prints line by line (clip-path, 260 ms per line, 40 ms stagger). It ends on the `[from mainnet tx]` chip.
- **Fallback.** Below 1024 px or under reduced motion, the steps render inline, not sticky.
- **What is kept.** The pinned H3s, the code panel and the decoded pairs.

### 6.6 Annunciator (`#reasons`)

- **The grid.** 19 keycap lamps plus a 20th cell, which shows the focused code's meaning in large type. This removes today's empty cell.
- **The lamp.**
  - It is a `::before` driven by `data-firing`.
  - Each `li[data-code]` keeps exactly its two children.
  - `data-hot` stays on MARKET_CLOSED only.
- **What lights it.** A code lights when the live default-mandate verdict raises it for any of the 13 B20 tokens, per `lib/live/firing.ts`.
- **The live summary.** A throttled aria-live summary reads, for example, "Lit now on Base: Market closed on 13 of 13 · Token not allowed on 10 of 13 · as of block N".
- **Vault-only checks** (3, 8, 9) stay dim and are marked "[after deploy]".

### 6.7 Weigh it yourself (`#try`)

- **Hardware keys.** Chips become keys: 1 px of travel on `:active` over 60 ms, and a 120 ms colour change.
- **The time slider.**
  - It gets hourly ticks, the NYSE band, and detents at the open and close that snap within 6 minutes.
  - Crossing 16:00 ET flips the session lamp and tilts a small Balance.
- **Execute.**
  - It updates the DOM verdict in the click's own task.
  - Then it plays WEIGH (channels 1-9 at 40 ms), TIP (600 ms), STAMP (220 ms) and PRINT, where a tape row clip-reveals into "Today's decisions" over 260 ms.
  - The whole run takes 700 ms or less.
- **Layout.**
  - The controls column is sticky.
  - The actions sit in one row.
  - The four pinned notes become a visible 2x2 label card, not a disclosure.
- **Unchanged:** Share URL and Post on X.

### 6.8 Ledger tape (`#ledger`)

- **Kept:** the real `<table>`, its rows, the filters and the fork plate.
- **Below 720 px:** rows become cards with the verdict first. This ends today's 820 px minimum width, which hid the DECISION column.
- **The mainnet slot** stays unlit with "[after deploy]". It shows Basescan tx rows only from a real `base-mainnet` row.

## 7. Other pages and chrome

### 7.1 `/now`

The h1 "Right now on Base" is pinned. The page shows:

- the full Readout;
- one summary line, for example "13 of 13 refused · Market closed · NYSE opens Mon 09:30 ET in 11 h 58 m";
- NowConsole: 13 channel strips, each with:
  - a verdict lamp with its word;
  - a premium meter against the FACTS limit;
  - a feed-age bar against `maxStalenessSec` ("90,000 s (25 h)");
  - the multiplier;
  - a paused lamp;
- a session sparkline labelled "read by this tab since HH:MM ET";
- the method, in disclosures.

On phones the strips are a snap row with `data-scroll-x`.

`NowBoard.tsx` and `now/page.tsx` are edited only in P4. Until then NowConsole is a sibling. After the record change merges, NowBoard moves behind a "Table view" toggle.

### 7.2 `/gap-index`

The title, h1, canonical and the markup's figures are kept.

- An edition-at-a-glance strip of small multiples.
- GapChart gains a draw-in, the range scrubber and a readout.
- The token pills become one snap row on phones. Today they wrap to 4 rows.
- A window tape that includes the next pending window.

### 7.3 `/ledger` (after PR #15 merges)

- KPI tiles become Readout windows. They stay unlit with "[after deploy]" until real events exist.
- Decision events print as tape rows with Basescan links.

### 7.4 Docs

docs.css only, keeping the DOCS_MARKERS isolation.

- **Headings:** H1 40 px / -0.04em and H2 28 px / -0.03em.
- **Dark palette:** the chassis colours, mapped to Fumadocs' dark palette.

  | Fumadocs role | Colour |
  |---|---|
  | background | `#0B0D12` |
  | card | `#14171F` |
  | border | `#262B36` |
  | foreground | `#F3F4F6` |
  | muted | `#B4BAC6` |
  | primary | `#9DAEFF` |

- **Figures:** tabular `<Fact>`.
- **StatusBadge as lamp chips:**
  - Fork-tested: ring;
  - Live on mainnet: filled;
  - Planned: dashed.

Docs prose about the redesign waits for the record change.

### 7.5 Chrome on every site page

- the same header, footer and CTA;
- a calibration rail at 1280 px and up that scroll-spies the six existing ids (P4);
- the thumb bar on phones;
- the docked mini readout (after PR #15);
- cross-document view transitions, declared only under `prefers-reduced-motion: no-preference`;
- a footer serial plate from `lib/build-info.ts`: "MAAT M-9 · built from commit <short sha> · 0 third-party scripts";
- a print stylesheet that turns the landing into a short sheet with sources as endnotes. It can be cut.

## 8. Motion

### 8.1 Rules

1. **Content never moves; the instrument does.**
   - Text and numbers render at their final value in the HTML.
   - Only beams, ticks, lamps, rules, scan lines, digit rolls between two real readings, and tape animate.
   - Nothing is parked at opacity 0 outside `@keyframes`.
2. **Motion is earned by data.** Something moves only when a reading lands, a check resolves or the visitor acts. The live dot is the only loop.
3. **Never count.** Static facts never animate their digits.
4. **Pause what nobody sees.** The scan, the countdown and rAF loops stop when offscreen, when `document.hidden`, and on HOLD.
5. **Finite and short.**
   - Every finite animation ends within 2.2 s of its trigger.
   - No `animation-timeline`, no scroll hijack, and no pinned section over 200 vh.

### 8.2 Tokens

These go in `globals.css`, outside the pinned colour block.

- **Durations:**
  - `--t-tick: 120ms`, for hover, a lamp turning on, and key colour;
  - `--t-flip: 240ms`, for a digit roll, the weight settling, and a state change;
  - `--t-weigh: 600ms`, for the beam;
  - `--t-draw: 900ms`, for the scope trace and the signal path;
  - `--stagger: 30ms`.
- **`--ease-out: cubic-bezier(.2,.7,.2,1)`**, which already exists.
- **`--ease-needle`** (damping ratio .42, about 22% overshoot) and **`--ease-settle`** (damping ratio .7, about 4% overshoot):
  - These are `linear()` strings that `web/scripts/springs.ts` generates from `web/lib/motion/spring.ts` into a marked block.
  - `web/test/springs.test.ts` fails if the block and the model disagree, so the CSS and the drag share one model.
- **Fallback.** `@supports not (transition-timing-function: linear(0, 1))` falls back to `cubic-bezier(.34,1.4,.64,1)`.

### 8.3 Inventory

| Name | Duration | Easing or method |
|---|---|---|
| beam-tip, beam-level | 600 ms | needle |
| tick-lit | 120 ms | on the row-in schedule |
| lamp-on | 120 ms, plus a 6 px ring fading over 240 ms | |
| digit-roll | 240 ms each, 30 ms stagger | WAAPI `translateY` |
| wght-settle | 240 ms | weight 300 to 560 |
| scan | 400 ms | once per read |
| stamp | 500 ms | existing |
| print | 260 ms | clip-path |
| draw | 900 ms | `stroke-dashoffset`, once in view |
| key-press | 60 ms | 1 px travel |
| colour on pills, nav links and chips | 120 ms | today these snap |
| thumb bar | 240 ms | |

### 8.4 Reduced motion and forced colours

- **The CSS block.** The global reduce block stays as `tokens.test` pins it. Because the base style is the final frame, every element lands on the truth.
- **What `prefersReducedMotion()` changes:**
  - digit rolls set the text directly;
  - Execute's delays are skipped;
  - the drag is off;
  - `#how` is not sticky.
- **View transitions** are declared only under no-preference.
- **Under `forced-colors`**, lamps gain 1 px borders and ghosts are hidden.

## 9. Type and colour

### 9.1 Type

Geist Sans and Geist Mono variable, as today, with no new font bytes. The typographic signature comes from how the faces are used:

- the mono weight settles when data lands;
- ghost segments sit behind live numbers;
- digits are tabular everywhere;
- plate labels look engraved.

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

On phones the hierarchy becomes H1 44 px against H2 32 px. Today it is 42 against 40. The balanced H2 also removes the one-word widows.

### 9.2 Colour

The 18 pinned tokens do not change. These tokens are added:

| Token | Value | Use and contrast |
|---|---|---|
| `--color-chassis-2` | `#14171F` | raised window |
| `--color-chassis-line` | `#262B36` | decorative hairline |
| `--color-lcd` | `#F3F4F6` | 17.66:1 on ink |
| `--color-lcd-2` | `#B4BAC6` | 9.98:1 on ink, 9.20:1 on chassis-2 |
| `--color-lcd-ghost` | `#1A1E27` | decorative, aria-hidden |
| `--color-pass-lit` | `#9DAEFF` | 9.19:1 on ink; the focus ring on dark |
| `--color-refuse-lit` | `#FF9B66` | 9.38:1 on ink |
| `--color-lamp-pass` | `#4D6BFF` | lamp core, always paired with a word |
| `--color-lamp-refuse` | `#FF5A1F` | lamp core, always paired with a word |
| `--color-label` | `#4A5160` | 7.96:1 on white, 7.43:1 on surface-soft |
| `--color-refuse-ink` | `#9A3412` | 6.62:1 on refuse-tint |
| `--color-tick` | `#C9CED8` | decorative |

What each new token replaces:

- `--color-label` replaces every small-text use of ink-3, which is 3.19:1 on white.
- `--color-refuse-ink` exists because refuse on refuse-tint is only 4.69:1.

Rules, enforced by a new contrast test over the declared pairs:

- Text at 12 px or less is 7:1 or more.
- All other text is 4.5:1 or more.
- Accent and refuse are never text on ink.
- ink-2 is never used on ink.

Surfaces:

- The white faceplate is the body.
- Ink chassis bands carry the Scope and the footer.
- Display windows use chassis-2 with radius 14 and an inset bezel.
- Faceplate cards keep radius 20 and a 1 px line.
- No new shadows.

`og.png`, its alt text, the X banner and the avatar stay valid.

## 10. Live data, provenance and states

### 10.1 Sources

- **Live reads.** All of them go through the existing keyless browser RPC (`useLiveSnapshot`: publicnode, then mainnet.base.org). Nothing live is baked into the HTML.
- **Recorded numbers.** Each one comes from FACTS or the edition files, with a test.
- **The calendar line.** It reads "repo calendar" until `deployments.json` has a MarketCalendar address. After that it reads "MarketCalendar 0x…", from `snapshot.calendar.source`.
- **The basket caption** is "default mandate · checks 1, 2, 4-7 · not the vault".

### 10.2 SOURCES

- Every number renders through `<Fig k="…">`, from a FACTS entry's `{ value, source }`, or through `<Live>`.
- The SOURCES key (`aria-pressed`) is on the spec plate and in the footer. When it is on, the client mounts an engraved 11 px caption under each figure, for example "24h · MandateVault.sol TIMELOCK".
- The captions are not in the static HTML, so the exact-text tests stay intact.
- A new `web/e2e/sources.spec.ts` fails on any digit in the landing DOM that is outside:
  - `[data-fact]`;
  - `[data-live]`;
  - a short allow-list (dates, and the check ordinals 01-09).

### 10.3 States

Every live or heavy surface has a designed frame for each state:

- **reading:** ghost segments and "Reading Base mainnet";
- **live;**
- **stale:** with the age written;
- **behind:** the RPC's block is behind;
- **error:** with the words and a Retry key.

None of them is an empty box. Each state is screenshot-tested with `e2e/fake-live-rpc.ts`.

### 10.4 Dated moments

- **Thanksgiving, Thu 26 Nov.** The live hero reads "NYSE closed · Thanksgiving" from `FACTS.calendar` on a weekday. On Fri 27 it reads "closes 13:00 ET".
- **Mainnet slots.** The ledger, hero and /ledger slots flip from FORK to MAINNET only when `deployments.json` has an address and a real `base-mainnet` row exists. Nothing is claimed in advance.

## 11. The bar this work must clear

Each item is measured.

1. **First viewport.**
   - At 1440x900: the H1, both CTAs, the live Readout with a block number read by the browser, and the complete verdict window all end above 900 px.
   - At 390x844: the H1 and the live verdict line.
2. **First live reading.**
   - It is painted in 2.0 s or less p50 on desktop, and 3.0 s or less under Lighthouse mobile throttling.
   - The lead moves 1 px or less.
   - CLS is 0.00 on /, /now and /gap-index.
3. **Weight.**
   - Landing 360 KB or less, JS 185 KB or less, CSS 18 KB or less.
   - Fonts unchanged at 138 KB.
   - 0 third-party scripts, and 0 console errors on every page.
4. **Lighthouse mobile.** Median of 3 runs on /, /now, /gap-index and one docs page:
   - Performance 95 or more as the target, with 90 as the gate;
   - Accessibility 100, Best Practices 100, SEO 100;
   - LCP 1.5 s or less on desktop and 2.5 s or less throttled;
   - TBT 150 ms or less.
5. **Interaction.**
   - INP 100 ms or less on Sat/Thu, the simulator keys and Execute.
   - Execute's sequence takes 700 ms or less.
   - No long task over 50 ms during the hero intro.
6. **Motion integrity.**
   - Every finite animation ends within 2.2 s.
   - Zero `animation-timeline` and zero opacity:0 outside keyframes.
   - Smoke's wait passes at 360, 768, 1024, 1440 and 1920 px.
   - Reduced motion shows the final beam angle, digits and tape.
   - Hidden or offscreen tabs run no rAF and no timer except the 30 s read.
7. **Provenance.**
   - `sources.spec.ts` passes.
   - No number counts from zero.
   - No chain value is in the static HTML.
8. **Contrast and access.**
   - The contrast test passes.
   - Focus is visible on white and on chassis.
   - `forced-colors` screenshots are legible.
   - axe finds 0 serious or critical issues at all five widths on every site page.
   - Targets are 44 px or larger.
9. **Length.** Desktop 8,500 px or less and mobile 12,500 px or less, with the Scope band included.
10. **Five moments, each shipped and filmed:**
    - a beam that tips at the failing check, with its final frame in the static HTML;
    - a 19-lamp annunciator lit by the chain "as of block N";
    - a real mainnet time series on the landing with a keyboard scrubber;
    - the same live readout docked in the nav on every site page;
    - a refusal the visitor triggers, watches weigh, tip, stamp and print, and shares by URL.
11. **Never an empty box.** Every state in 10.3 is screenshot-tested.
12. **Mobile.**
    - No horizontal scroll at 360 px.
    - The ledger's DECISION column is visible at 390 px.
    - The /gap-index pills sit in one snap row.
    - The thumb bar never covers `#try` or the footer.
13. **Cross-browser.** Playwright WebKit and Firefox projects pass smoke, the `linear()` fallback works, and view transitions degrade to a plain navigation.
14. **Thanksgiving.** On Thu 26 Nov the live hero reads "NYSE closed · Thanksgiving", and the frame is captured.

## 12. Phases

### 12.1 Ship order

Each phase is its own `feat/` branch. A phase merges only when CI is green: typecheck, vitest, build, check:out and Playwright. The site gets better at every merge.

| Phase | When | Branch | Scope |
|---|---|---|---|
| P-1 | Mon 23 Nov, after the mainnet deploy | none | merge PR #15 when green; check the record change applies to the new main; capture a before baseline (screenshots, Lighthouse ×3) |
| P0 primitives | Tue 24 Nov | `feat/instrument-primitives` | section 5.1 units; additive tokens; motion tokens; springs script and parity test; contrast test; `formatLimit`; the new `@source` line. No visual change |
| P1 hero | by Wed 25 Nov 16:00 UTC | `feat/hero-instrument` | Readout in LiveStrip; Balance and verdict-first DecisionEngine; H1 and H2 scale; spec plate; tick ruler; thumb bar; 120 ms colour transitions; drag-to-tip; the docked readout only if PR #15 has merged |
| P2a story | Thu 26 to Fri 27 Nov | `feat/scope-annunciator` | Weekend Scope and `content/scope.ts`; Annunciator and `firing.ts`; Problem channels; Built-on plate |
| P2b story | Sat 28 to Sun 29 Nov | `feat/signal-path-desk` | `#how` signal path; simulator keys and Execute sequence; ledger cards; SOURCES and `sources.spec.ts` |
| P3 pages | Mon 30 Nov to Tue 1 Dec | `feat/live-pages-instrument` | NowConsole; /gap-index scrubber, small multiples and snap pills; /ledger readouts; docs.css; view transitions |
| P4 IA | Wed 2 Dec, after the record change merges | `feat/global-nav-instrument` | status line; Mandate calibration sheet; pages-first nav and rail; footer chassis and serial plate; treasury ring; NowBoard toggle; `page.test` and `top.test`; mainnet slots, live only from real rows |
| P5 QA | Thu 3 Dec | `chore/instrument-qa` | Lighthouse ×3 per page; axe at five widths; reduced motion and forced colours; WebKit and Firefox; after captures; README screenshots |

If the record change has not merged by Wed 2 Dec, P4 ships only the footer, the rail and the treasury ring. The rest waits.

Submission is planned for Fri 4 Dec. The hard deadline is Sat 5 Dec 23:59 UTC.

### 12.2 Conflict rules

- **Until the record change merges:**
  - do not edit any of its 60 files;
  - put every new assertion in a new test file;
  - consume `verdict.ts` read only;
  - make no docs prose changes.
- **Until PR #15 merges,** do not touch:
  - `Nav.tsx` or `Ledger.tsx`;
  - `(site)/layout.tsx`;
  - `lib/check-out.ts` or `scripts/check-out.ts`;
  - `next.config.ts` or `package.json`;
  - the `@source` brace line.
- **After every redesign merge,** re-check that the record change still applies.
- **Every limit reads FACTS.**

### 12.3 Cut order

If time runs short, cut in this order:

1. drag-to-tip;
2. view transitions;
3. the print sheet;
4. the calibration rail;
5. the /now sparkline;
6. the treasury ring.

The core is never cut: the Balance, the Readout, the Annunciator, the Scope and the mobile fixes.

## 13. Testing

All new tests go in new files until the record change merges.

| Test | Checks |
|---|---|
| `web/test/springs.test.ts` | the `globals.css` springs block equals the model's output; the overshoot of each curve is within 1 point of its target |
| `web/test/instrument-contrast.test.ts` | every declared text pair meets 7:1 at 12 px or less and 4.5:1 otherwise |
| `web/test/instrument-*.test.tsx` | each unit in 5.1 renders its states; Lamp always renders a word; Meter reads its limit from a prop fed by FACTS |
| `web/test/format-limit.test.ts` | the "90,000 s (25 h)" wording and the bps wording |
| `web/test/live-firing.test.ts` | per-code counts on fixed snapshots, including all 13 refused |
| `web/test/scope.test.ts` | the pick is the largest measured gap in the edition files; the client series stays under its byte budget; "safe" is absent |
| `web/e2e/instrument.spec.ts` | first-viewport bounds at 1440x900 and 390x844; one status region in `#top`; the thumb bar rules; no horizontal scroll at 360 |
| `web/e2e/instrument-states.spec.ts` | the reading, live, stale, behind and error frames with `fake-live-rpc` |
| `web/e2e/sources.spec.ts` | provenance (section 10.2) |
| existing `smoke`, `live`, `simulator`, `gap-index`, `docs` specs | unchanged and green |

Playwright always runs with `--workers=2`.

## 14. Out of scope

- No contract, agent or deploy change.
- No new route besides what already exists. `/break`, `/proof` and `/d/<tx>` can reuse the instruments later.
- No sound and no haptics.
- No new font, library or third-party script.
