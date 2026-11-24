# Maat M-9 P1: the hero instrument Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mount the P0 instrument parts on the landing hero (spec 12.1, the P1 row with amendment A3). That covers:
- one shared live snapshot per page, with HOLD;
- the live strip inside a chassis Readout, with block digits, the countdown, basket lamps, premium meters and bezel keys;
- the verdict-first engine card, with the Balance and its CSS intro;
- the H1 and H2 scale, the tick ruler, the CTAs above the fold and the spec plate;
- the phone ThumbBar;
- the 120 ms colour transitions;
- the unlit docked plate on `/gap-index`;
- drag-to-tip;
- the two e2e specs for the first viewport and every live state.

The docked readout in the nav ships only if PR #15 has merged.

**Not in P1.**

| Item | Spec | Where it goes |
|---|---|---|
| The opaque nav bar and the docked mini readout | 6.1, 7.5 | Task 16, only once PR #15 has merged; otherwise P4 |
| The unlit nav frame on `/ledger` | 7.5 | P4 (amendment A6) |
| The SOURCES key and its captions, the calendar line and the basket caption | 10.1, 10.2 | P2b |
| `web/e2e/sources.spec.ts` | 10.2 | P2b |
| The Readout, NowConsole and the docked readout on `/now` | 7.1, 7.5 | P4 |
| The footer's "from block N" and the ThumbBar off the landing (`/#try`) | 7.5 | P4. P1 mounts the ThumbBar on the landing only |

**Architecture:**
- One `LiveSnapshotProvider`, mounted in `app/(site)/page.tsx`, runs the landing's only `useLiveSnapshot`. The strip, `HoldKey` and `ThumbBar` read it through context. `LiveStrip` makes its own provider only when none is above it, as when `top.test.tsx` renders `<Hero />` alone.
- HOLD is the provider's `hold` state. It turns the hook's new `active` option off, which stops the reads, both timers and the countdown, and freezes the frame.
- The strip renders inside P0's `Readout`, using new chassis palettes of `LiveStatus` and `VerdictLine`. The faceplate palettes stay byte-identical for NowBoard.
- The engine card mounts P0's `Balance`. Its intro is CSS only, keyed by a remount and a `data-tilt-from` attribute.
- The hero mounts P0's `Ruler` and `Fig`.
- `useTipDrag.ts` is a plain module, loaded with `import()` on the first pointerdown.
- Two e2e specs check the first viewport and every live state. The states spec also measures the Readout's natural height, which sets its fixed height per breakpoint.

**Tech Stack:**
- Next.js 16.4.5, with static export to `out/`;
- React 19.3.1 (`ref` is a plain prop, `<Context value>` is the provider, `inert` is a boolean prop);
- Tailwind 4.3.5 through `@tailwindcss/postcss`;
- TypeScript 7.0.2 (`strict`, `noUncheckedIndexedAccess`);
- vitest 5.1.0, with jsdom 29.1.1 and Testing Library 16.3.3;
- Playwright 1.65.0;
- Node 24.

**Spec:** `docs/superpowers/specs/2026-11-23-maat-web-instrument-design.md`

## Global Constraints

- **Workspace.** Work only in `E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument`, on branch `feat/hero-instrument`, cut from `origin/feat/instrument-primitives` (Task 0). In this plan, `W` means that path.
- **Absolute paths.** Your shell's working directory resets between calls, so every command below starts with `cd <absolute path>` or uses `git -C <absolute path>`.
- **Deadline.** P1 is merged by Wed 25 Nov 2026 16:00 UTC (spec 12.1).
  - Drag-to-tip (Task 12) is the first thing to cut (spec 12.3). If Tasks 0-11 are not all committed by Wed 25 Nov 2026 08:00 UTC, skip Task 12 and go on with Task 13.
  - Task 16 runs only after PR #15 has merged into `main`. If it cannot be done by Wed 25 Nov 2026 12:00 UTC, skip it: the rest of P1 merges without it, and the nav moves to P4.
- **Frozen until PR #15 merges (spec 12.2).** Do not edit any of these:
  - `web/components/sections/Nav.tsx` (until Task 16) and `web/components/sections/Ledger.tsx`;
  - `web/app/(site)/layout.tsx`;
  - `web/lib/check-out.ts` and `web/scripts/check-out.ts`;
  - `web/next.config.ts`, `web/package.json` and `web/package-lock.json`;
  - `web/app/sitemap.ts`;
  - the `@source` lines of `web/app/globals.css` (lines 1-11). P1 adds no `@source` line, because `components/instrument` and `components/live` are already scanned;
  - `page.test.tsx`, `top.test.tsx` and `check-out.test.ts`;
  - `web/README.md` and `status.mdx`.
- **Frozen until the deployment-record change merges (spec 3.10 and 12.2).** Do not edit its 60 files, including:
  - `page.test.tsx`, `top.test.tsx`, `now-page.test.tsx`, `live-verdict.test.ts` and `docs.spec.ts`;
  - `web/README.md`;
  - `web/lib/live/verdict.ts`, which is read only;
  - `AnnouncementBar.tsx`, `Mandate.tsx`, `NowBoard.tsx` and `app/(site)/now/page.tsx`;
  - the 39 docs MDX files;
  - `deployments/README.md` and `web/content/generated/deployments.json`.

  NowBoard keeps importing `LiveStatus` and `VerdictLine`, so their default (faceplate) classes and markup stay byte-identical (Task 4). Make no change to docs prose.
- **The pinned tokens.** The 20 colour tokens at the top of `globals.css` stay byte-identical. P1 adds no token: it uses P0's.
- **How `globals.css` may change in P1.**
  - New blocks go immediately before the global reduced-motion block. With Edit, set old_string to these two lines:

    ```css
    @media (prefers-reduced-motion: reduce) {
      html {
    ```

    Set new_string to the new block, a blank line, then those same two lines. Tasks 3, 6, 7, 9, 10, 12 and 16 add blocks this way.
  - Task 8 replaces the `.h2` rule's body.
  - Nothing else changes: not lines 1-11, not either `@theme` block, not the springs block and not the reduced-motion block.
- **Tailwind reads comments too.** Tailwind scans every word of every `@source` file, comments included, and makes a utility of any word that names one. P0 commit `4457e42` had to add `@source not inline("ring transform")` after two comment words became the `.ring` and `.transform` utilities. In comments and strings of new `.ts` and `.tsx` files under `components/`, `app/(site)/` and `content/`, avoid bare words that name a utility the code does not use, such as `transform`, `ring`, `filter`, `shadow`, `outline`, `invisible`, `sticky`, `table`, `contents`, `grow` and `truncate`. Write "pinned", "tint" or "the panel" instead. P0's `weight.spec.ts` css budget catches a large leak, not a small one.
- **Existing files P1 edits.** P1 edits only these existing files:
  - `web/components/live/useLiveSnapshot.ts`, `LiveStrip.tsx`, `LiveStatus.tsx` and `VerdictLine.tsx`;
  - `web/components/DecisionEngine.tsx`, `web/components/sections/Hero.tsx`, `web/components/Simulator.tsx` and `web/components/gap/TokenTabs.tsx`;
  - `web/app/(site)/page.tsx`, `web/app/(site)/gap-index/page.tsx` and `web/app/globals.css`;
  - `Nav.tsx`, and only in Task 16.

  Edit no existing test: every new assertion goes in a new file. `web/test/setup.ts` is not changed.
- **No new dependency of any kind.** `npm ci` is the only install. There is no animation library and no third-party script.
- **Motion (spec 8.1).**
  - There is no `animation-timeline` and no scroll hijack.
  - Nothing is ever `opacity: 0` outside `@keyframes`.
  - Every finite animation ends within 2.2 s of its trigger.
  - The base style of every part is its final frame.
  - The countdown changes its text once a minute and never animates.
  - The scan line runs only while the Readout is on screen, the tab is visible and the reading is not held.
  - The drag runs on `requestAnimationFrame` only while the beam is unsettled.
- **jsdom.** jsdom has none of these:
  - `IntersectionObserver`;
  - `window.matchMedia`;
  - `Element.prototype.animate` and `getAnimations`;
  - pointer capture.

  It may also lack `PointerEvent`. Every new helper degrades when one of them is missing, and each has a test for that path. `page.test.tsx` and `top.test.tsx` pass unchanged.
- **Client and server modules.**
  - These start with `"use client";`: `components/live/LiveSnapshotProvider.tsx`, `components/instrument/HoldKey.tsx`, `components/instrument/useScan.ts`, `components/instrument/ThumbBar.tsx` and `components/live/NavDock.tsx`.
  - These call no hook and stay server-safe: `components/instrument/DockedPlate.tsx`, `components/instrument/useTipDrag.ts` and `lib/live/countdown.ts`.
  - P0's `instrument-modules.test.ts` enforces the rules for everything in `components/instrument` and `lib/motion`, and `instrument-contrast.test.ts` checks their text colours. Small text there uses `text-label`, `text-lcd`, `text-lcd-2` or `text-pass-lit`, never `text-ink` or `text-accent`.
- **Limits come from FACTS.** Every meter reads `FACTS.mandate.value.maxPremiumBps`. Never write a literal limit outside tests that read FACTS.
- **One read loop per page (spec 3.8).** The landing runs exactly one `useLiveSnapshot`, through the provider in `page.tsx`. `/gap-index` makes no RPC request.
- **Nothing live in the static HTML (spec 3.7).** In the export, the strip is in its reading state. The ThumbBar renders nothing on the server. No lamp is lit, no countdown is shown and no "REFUSE" appears. `check:out` bans `>LIVE<`, `basescan.org/block/` and `data-verdict-line` in `out/index.html`.
- **The DOM contracts.** These are spec 3.3, 3.5 and 3.6:
  - `#top` keeps exactly two `role="status"` regions, and `#top [role="status"] > div` counts 1.
  - The strip's root keeps `data-live-strip`, `tabIndex={-1}` and the `useRetry` ref. Its children are, in order: the announcer, exactly one `<p>` of block rows, the bezel keys in a `<div>`, and the `<noscript>`. It sits directly before the lead `<p>`.
  - The engine card keeps its pinned texts, and keeps its verdict window as the first child of `role="status"`. The Balance is aria-hidden and sits outside the status region and the list.
- **How to write files.** Create and edit files with the Write and Edit tools. Never use a shell heredoc or `echo`, because a heredoc collapses `\\` into `\` and breaks regex escapes. The Write tool needs a file to have been Read before it overwrites it, so Read each existing file first. Line endings are LF, which `.gitattributes` enforces.
- **Commands.** Run these from `W/web`:
  - `npm run typecheck`, which takes a few minutes, so give it a 10-minute timeout;
  - `npm test -- <files>`;
  - `npm run build`;
  - `npm run check:out`;
  - `npm run verify`;
  - `npm run e2e -- <spec> --project=chromium --workers=2`.

  e2e serves `out/`, so build first. Locally, Playwright always runs with `--workers=2`, and only one Playwright run may use port 4173 at a time. Check first with `netstat -ano | grep 4173`, which must print nothing. The `webkit` and `firefox` projects run `smoke.spec.ts` only.
- **Git rules.**
  - Stage only with `git -C <W> add -- <explicit files>`. Never use `-A`, never `.`, never `commit -am`.
  - Commit with `git -C <W> commit -F "$SCRATCH/p1-commit-NN.txt"`. Start each commit call with `SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' &&`.
  - Write each message file with the Write tool. It holds a conventional subject (`feat(web): ...`, `test(web): ...`), a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never `--amend`, never force push, never `git stash`, never rebase, never `--no-verify`.
- **English only.** All repo text is English: code, comments, tests and commit messages.
- **Stop and report; do not work around.** Stop and report if any of these happens:
  - `origin/feat/instrument-primitives` does not exist at Task 0;
  - a baseline check fails at Task 0;
  - a file this plan edits has changed since `66bd0d0` (Task 0 Step 4);
  - a frozen file would need an edit;
  - an existing test fails and passing it would need an edit to that test;
  - a weight budget of P0's `weight.spec.ts` fails, because a budget is never raised;
  - a part of the first viewport at 1440x900 misses the fold by more than its own gain in Task 14's fallback (20 px for the H1, 24 px for the Readout, its block link and its verdict line, 32 px for the CTAs).

## Review Focus

These are five ways P1 can break while every test written task by task stays green. Each one is pinned in the task named.

1. **Two read loops on the landing.** This happens if the page provider and the strip's fallback provider both run, or if a new surface calls `useLiveSnapshot` itself. Each tab would then send two multicalls every 30 s, and `live.spec.ts`'s call counts would go flaky rather than fail outright. Pinned in:
   - Task 2: three subscribers send one multicall, and a strip under a provider never calls its own reader;
   - Task 14: with the ThumbBar mounted, HOLD holds the page at one call through two refresh intervals, and after release one more interval adds exactly one call.
2. **A HOLD that leaks.** The failures here are:
   - a read lands on screen while held;
   - the 5 s reclassify keeps ticking, so the age and the countdown move;
   - a release while a read is in flight leaves no timer, so the strip never reads again;
   - a hold that ends after `REFRESH_MS` waits another 30 s.

   Pinned in Task 1 by nine cases. They cover zero fake timers while held, a held frame `toEqual` to the frame before it, a pending answer applied on release, and exactly one more read one interval after a mid-read release.
3. **The block link loses its name.** The Digits cells give the link "Base block" plus ten single-character spans. Their accessible name depends on how each engine joins inline boxes, so it could stop matching "Base block 60,013,066" in one browser only. A second exact "LIVE" text would break the strict locators the same way. Pinned in Task 6:
   - an `aria-label` that `getByRole` finds by exact name;
   - ten cells;
   - one exact "LIVE";
   - `live.spec.ts`, which runs unchanged in Tasks 6 and 15.
4. **A live value or a lit lamp in the static HTML.** For example, the ThumbBar or a basket lamp rendering "REFUSE" on the server, or the reading state picking up a figure. The unit tests render on the client, where this cannot show. Pinned in:
   - Task 2: `renderToString` of a provider with the strip;
   - Task 10: `renderToString(<Page />)` has no `data-thumb-bar`, no "REFUSE", no lit `data-lamp` and one `data-live-strip`;
   - `check:out`, which runs on the real export from Task 6 on.
5. **A Balance intro that lies.** The intro could:
   - not replay on a toggle, because the keyed remount was lost;
   - start from the wrong angle;
   - end after 2.2 s, which smoke's animation wait would only catch as a slow test;
   - put the Balance inside the status region or the list, which breaks smoke's count of 10.

   Pinned in Task 7:
   - a new weighing node on every choice, with `data-tilt-from` checked over a Sat → Thu → Thu → Sat → Thu sequence;
   - every delay and duration parsed from `globals.css` and summed against 2,200 ms;
   - the Balance's ancestors checked.

## Spec amendments

At these points the spec's wording is wrong or says nothing, and this plan follows the amended text below. Each one is an edit to `docs/superpowers/specs/2026-11-23-maat-web-instrument-design.md` on the spec branch `docs/web-instrument-spec`. A4 to A9 are already applied to the spec, in the commit that adds this plan. A10 was applied after Task 14 measured the CTAs' bottom at 390x844 at 1013.58 px. The executor does not edit the spec.

- **A4, spec 5.1, the ThumbBar row's "Depends on" cell.**
  - Replace "`onceInView`" with "LiveSnapshotProvider, Lamp and its own IntersectionObserver".
  - Why: `onceInView` sets `data-seen` once and never reports that an element left view. The bar has to know when both CTAs are above the viewport, and when `#try` or the footer enters and leaves view.
- **A5, spec 5.1, the useTipDrag row's "Does" cell.**
  - Replace "lazy drag integrator, loaded on the first pointerdown" with "`beginTipDrag`, the drag integrator as a plain function (it calls no hook, so it stays server-safe), loaded with `import()` on the first pointerdown".
  - Why: a hook cannot be loaded lazily from inside an event handler. The file keeps its spec path.
- **A6, spec 7.5, the second bullet under "Live chrome reads Base only on `/` and `/now`".**
  - After "make no RPC request, and link `/now`." add "In P1 only the `/gap-index` Header shows it. The `/ledger` frame ships with the pages-first nav in P4, because `/ledger` renders PR #15's `Nav`, whose links its tests pin."
- **A7, spec 6.1, the Readout paragraph "Read age, RPC host, HOLD and Refresh are 11 px keys on the bottom bezel, outside the `<p>`."**
  - After it add "HOLD is there in every state. Read age, RPC host and Refresh appear once a reading is shown (live, stale or behind). In the error state the line's own Retry reads again, and in the reading state a read is already in flight."
- **A8, spec 6.1, the "First read" bullet "Block digits roll from ghost to the real value in 240 ms each, with a 30 ms stagger."**
  - Replace it with "The ghost segments give way to the real block number at once. Digits roll (240 ms each, 30 ms stagger) only between two real readings, as 8.1 rule 3 and `rollDigits` have it."
  - Why: a roll from the ghost would count from 8s, which 8.1 rule 3 forbids, and P0's `Digits` never rolls its first value.
- **A9, spec 6.1, the Readout's row 2.**
  - After "from `nextOpen`, at minute resolution." add: "When the next open is later on the block's own ET day, `session.detail` already names it ("Monday · opens 09:30 ET"), so only "· in 2 h 30 min" follows. Under a minute it reads "· in under 1 min". There is no countdown in session, or when MarketCalendar's answer differs from the repo calendar's. A reading that is not live shows `session.detail` without one."
- **A10, spec 6.2, "**CTAs:** stacked, 52 px each, ending at about y 780." Apply this one only if Task 14 records the CTAs' bottom past 844 at 390x844.**
  - Replace it with "**CTAs:** stacked, 52 px each. At 390x844 they end at about y 1014, below the first screen, under the fixed-height Readout and the lead. The ThumbBar carries "Try to make it say no" once they scroll out."
  - Spec 11 item 1 asks only for the H1 and the live verdict line in the first screen at 390x844, and Task 14 pins those.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/test/helpers/fake-reader.ts` | The fake Base reader, fake clocks, tab visibility and a judged reading, for P1's unit tests | 1 |
| `web/components/live/useLiveSnapshot.ts` (modify) | The `active` option: HOLD stops reads, timers and the frame | 1 |
| `web/test/live-snapshot-active.test.tsx` | HOLD at the hook | 1 |
| `web/components/live/LiveSnapshotProvider.tsx` | `"use client"`: one `useLiveSnapshot` per page, plus `hold`, through context | 2 |
| `web/components/live/LiveStrip.tsx` (modify) | Reads the provider (2); renders in a Readout with digits, countdown, basket and keys (6); calibrated height (13) | 2, 6, 13 |
| `web/test/live-snapshot-provider.test.tsx` | One loop for several subscribers; HOLD stops reads and timers (spec 13) | 2 |
| `web/components/instrument/HoldKey.tsx` | `"use client"`: the `aria-pressed` HOLD key and `KEY_CLASS` | 3 |
| `web/test/instrument-hold-key.test.tsx` | HoldKey | 3 |
| `web/components/live/LiveStatus.tsx` (modify) | A chassis palette for the pill, the block link, NotLiveWhy and ReadButton | 4 |
| `web/components/live/VerdictLine.tsx` (modify) | A chassis palette, `CHASSIS_TONE` | 4 |
| `web/test/instrument-chassis-palette.test.tsx` | Faceplate classes byte-identical, and chassis classes | 4 |
| `web/lib/live/countdown.ts` | `countdownText`: the next NYSE open, at minute resolution | 5 |
| `web/test/live-countdown.test.ts` | The countdown's vectors | 5 |
| `web/components/instrument/useScan.ts` | `"use client"`: one scan pass per new reading, only while on screen | 6 |
| `web/test/instrument-scan.test.tsx`, `web/test/instrument-live-readout.test.tsx` | The scan line, and the strip in its Readout | 6 |
| `web/components/DecisionEngine.tsx` (modify) | Verdict-first order, the Balance and its intro (7); drag-to-tip wiring (12) | 7, 12 |
| `web/test/instrument-engine-balance.test.tsx` | The card's order, the Balance's place, the tilt sequence and the timings | 7 |
| `web/components/sections/Hero.tsx` (modify) | The ruler, the H1 scale, the CTAs and the spec plate (8); the fold fallback (14) | 8, 14 |
| `web/test/instrument-hero.test.tsx` | The hero and `.h2` | 8 |
| `web/components/Simulator.tsx`, `web/components/gap/TokenTabs.tsx` (modify) | One class each, onto the 120 ms colour tick | 9 |
| `web/test/instrument-colour-transitions.test.ts` | The colour tick | 9 |
| `web/components/instrument/ThumbBar.tsx` | `"use client"`: the phone bottom bar | 10 |
| `web/app/(site)/page.tsx` (modify) | Mounts LiveSnapshotProvider and ThumbBar | 10 |
| `web/test/instrument-thumb-bar.test.tsx` | ThumbBar, and the landing's static HTML | 10 |
| `web/components/instrument/DockedPlate.tsx` | The unlit docked plate, linking `/now` | 11 |
| `web/app/(site)/gap-index/page.tsx` (modify) | Its Header shows the docked plate | 11 |
| `web/test/instrument-docked-plate.test.tsx` | DockedPlate and the `/gap-index` Header | 11 |
| `web/components/instrument/useTipDrag.ts` | `beginTipDrag`, the lazy drag integrator on the NEEDLE spring | 12 |
| `web/test/instrument-tip-drag.test.tsx` | The drag, and its wiring in the engine card | 12 |
| `web/e2e/instrument-states.spec.ts` | Every live frame at six widths; the Readout heights | 13 |
| `web/e2e/instrument.spec.ts` | First-viewport bounds, status counts, ThumbBar, no overflow at 360, HOLD, the docked plate | 14 |
| `web/app/globals.css` (modify) | The keys, Readout, weighing, colour tick, ThumbBar, drag and nav-bar blocks; `.h2` | 3, 6, 7, 8, 9, 10, 12, 16 |
| `web/components/live/NavDock.tsx` | `"use client"`: `NavBar` and `NavDock` | 16 |
| `web/components/sections/Nav.tsx` (modify) | Wrapped in `NavBar`, with `NavDock` on the landing | 16 |
| `web/test/instrument-nav-dock.test.tsx`, `web/e2e/instrument-nav.spec.ts` | The nav bar and the docked readout | 16 |

---

## Tasks

### Task 0: Worktree and baseline

**Files:**
- Create: the worktree `E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument` (branch `feat/hero-instrument`) and the scratch folder for commit messages.
- Test: none (baseline runs only)

**Interfaces:**
- Consumes: `origin/feat/instrument-primitives`, as P0 Task 16 pushed it, or as P0 Task 17 pushed it once PR #15 had merged.
- Produces:
  - a clean `W` with `web/node_modules` and a baseline `web/out/`;
  - four facts that later tasks rely on: the `@source` layout, that the P0 exports exist, whether PR #15 is in the base, and that the files P1 edits still hold their `66bd0d0` text.

- [ ] **Step 1: Fetch and find P0**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon fetch origin
git -C E:/APP2028/stocks-maxxing-hackathon rev-parse --verify --quiet origin/feat/instrument-primitives
```

Expected: one 40-character SHA. If it prints nothing (exit 1), stop and report "origin/feat/instrument-primitives is not on origin". P1 is cut from P0, so there is nothing to build on.

- [ ] **Step 2: Create the worktree**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon worktree add -b feat/hero-instrument E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument origin/feat/instrument-primitives
```

Expected: `Preparing worktree (new branch 'feat/hero-instrument')`. If the branch or the folder already exists, stop and report.

- [ ] **Step 3: Install the locked dependencies**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm ci
```

Expected: `added <n> packages` and no `npm ERR!`.

- [ ] **Step 4: Check the P0 parts and the base**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && ls components/instrument lib/motion
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && grep -n '^@source' app/globals.css
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && grep -c -e '^export function nextOpen' content/calendar.ts && grep -c -e '^export type LimitUnit' content/format.ts && grep -c -e '^@keyframes lamp-on' app/globals.css
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && grep -c '"/ledger"' components/sections/Nav.tsx
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument diff --stat 66bd0d0 HEAD -- web/components/live/LiveStrip.tsx web/components/live/LiveStatus.tsx web/components/live/VerdictLine.tsx web/components/live/useLiveSnapshot.ts web/components/DecisionEngine.tsx web/components/sections/Hero.tsx 'web/app/(site)/page.tsx' 'web/app/(site)/gap-index/page.tsx' web/components/Simulator.tsx web/components/gap/TokenTabs.tsx
```

Expected:
- `components/instrument` lists `Balance.tsx Digits.tsx Fig.tsx Ghost.tsx Lamp.tsx Live.tsx Meter.tsx Readout.tsx Ruler.tsx SourcePlate.tsx Tape.tsx types.ts`. `lib/motion` lists `once-in-view.ts reduced-motion.ts roll-digits.ts spring.ts springs-css.ts`.
- The `@source` lines are in one of two layouts. Either way `components/instrument` is scanned and P1 adds no `@source` line. If neither layout appears, stop and report.
  - Before PR #15: the brace `@source "../components/{charts,gap,live,sections,ui}";`, with a separate `@source "../components/instrument";` after `@source "../lib/site.ts";`.
  - After P0 Task 17: the brace `@source "../components/{charts,gap,instrument,ledger,live,sections,ui}";` and no separate line.
- The three counts print `1`, `1` and `1`.
- The `/ledger` count is `0` when PR #15 is not in the base, or `1` when it is. Write it down. Task 16 checks `main` itself.
- `diff --stat` prints nothing. If it lists a file, stop and report it: the edits below are written against these files' text at `66bd0d0`.

- [ ] **Step 5: Baseline checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- --workers=2
```

Expected:
- The typecheck exits 0.
- Every vitest file passes.
- The build and `check:out` exit 0.
- `netstat` prints nothing.
- Every Chromium spec passes, P0's `weight.spec.ts` included, and `smoke.spec.ts` passes on WebKit and Firefox.

If Playwright says a WebKit or Firefox executable does not exist, run `cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npx --no-install playwright install webkit firefox` once. That is the same browser download P0 Task 14 made. Then rerun the e2e command. Any other failure: stop and report it with the failing titles.

- [ ] **Step 6: The scratch folder and a clean tree**

```bash
mkdir -p 'C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build'
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument status --porcelain
```

Expected: no output. `out/`, `.next/`, `node_modules/` and `test-results/` are ignored. There is no commit in this task.

---

### Task 1: The `active` option of `useLiveSnapshot`

**Files:**
- Create: `web/test/helpers/fake-reader.ts`
- Modify: `web/components/live/useLiveSnapshot.ts` (the whole file, 160 lines)
- Test: `web/test/live-snapshot-active.test.tsx`

**Interfaces:**
- Consumes these, unchanged:
  - `classify`, `LiveState`, `Reading` and `REFRESH_MS` from `@/lib/live/freshness`;
  - `createReader`, `LIVE_RPCS`, `LiveReader` and `RpcError` from `@/lib/live/rpc`;
  - `readSnapshot`, `decodeSnapshot` and `LiveSnapshot` from `@/lib/live/snapshot`;
  - `headline`, `judgeToken` and `sessionAt` from `@/lib/live/verdict`;
  - the recorded fixture `web/test/fixtures/live-aggregate3.json`.
- Produces:
  - `LiveSnapshotOptions.active?: boolean`, which defaults to `true`. While it is false: no read starts, no timer runs and the frame does not change. A read already in flight is kept until the hold ends. `refresh()` is still shown at once.
  - The return type is unchanged: `{ state, refresh, refreshing, endpoints }`.
  - From `web/test/helpers/fake-reader.ts`:
    - `BLOCK`, `FRI` and `SAT`;
    - `results(timestamp, block?)`;
    - `type Edit` and `type Answer`;
    - `fakeReader(first)`, which returns `{ reader, call, multicalls, set, hold, release }`;
    - `installLiveClocks()`, `advance(ms)`, `hideTab()` and `showTab()`;
    - `readingAt(timestamp, opts?): Reading`.

**Review Focus 2** is pinned here.

- [ ] **Step 1: Write the failing test**

Create `web/test/helpers/fake-reader.ts`:

```ts
import { act } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { type Hex, MULTICALL3 } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { type CallResult, decodeAggregate3, encodeAggregate3Result, word } from "@/lib/live/abi";
import type { Reading } from "@/lib/live/freshness";
import { LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
import { decodeSnapshot, type LiveSnapshot } from "@/lib/live/snapshot";
import { headline, judgeToken, sessionAt } from "@/lib/live/verdict";
import fixture from "../fixtures/live-aggregate3.json";

/**
 * A fake Base for P1's unit tests, the same as test/live-strip.test.tsx builds for itself: the recorded multicall answer
 * with its block and timestamp words replaced, a MarketCalendar that answers like the repo calendar, fake clocks, and a
 * tab that can be hidden. A test file calls installLiveClocks() once, at its top.
 */

/** The recorded block, 60,013,066. */
export const BLOCK = BigInt(fixture.expected.blockNumber);
/** Fri 2026-11-20 16:43:08 UTC, 11:43 ET: in session. */
export const FRI = Number(fixture.expected.timestamp);
/** Sat 2026-11-21 15:00 UTC, 10:00 ET: the NYSE is closed. */
export const SAT = Date.UTC(2026, 10, 21, 15, 0, 0) / 1000;

/** The recorded answer, with the block number and timestamp words replaced. */
export function results(timestamp: number, block = BLOCK): CallResult[] {
  const r = decodeAggregate3(fixture.response as Hex);
  r[0] = { success: true, returnData: `0x${word(block)}` };
  r[1] = { success: true, returnData: `0x${word(BigInt(timestamp))}` };
  return r;
}

export type Edit = (r: CallResult[]) => CallResult[];

/** The recorded answer at `timestamp`, changed by `edit` if given; or both RPCs failing ("down"). */
export type Answer = { timestamp: number; block?: bigint; edit?: Edit } | "down";

const isMulticall = (tx: { to: Hex }) => tx.to.toLowerCase() === MULTICALL3.toLowerCase();

/**
 * A reader that answers like Base. `hold()` keeps the next calls in flight until `release(answer)`. `multicalls()` counts
 * the multicalls only, so no test depends on whether the deployments table names a MarketCalendar, which adds one call
 * to each good reading.
 */
export function fakeReader(first: Answer) {
  let answer = first;
  let gate: { promise: Promise<void>; open: () => void } | undefined;
  const call = vi.fn(async (tx: { to: Hex; data: Hex }): Promise<{ data: Hex; endpoint: string }> => {
    if (gate) await gate.promise;
    const a = answer;
    if (a === "down") throw new RpcError(LIVE_RPCS.map((endpoint) => ({ endpoint, message: "HTTP 503" })));
    if (!isMulticall(tx)) {
      return { data: `0x${word(regularSession(a.timestamp).open ? 1n : 0n)}`, endpoint: LIVE_RPCS[0]! };
    }
    const r = results(a.timestamp, a.block);
    return { data: encodeAggregate3Result(a.edit ? a.edit(r) : r), endpoint: LIVE_RPCS[0]! };
  });
  const reader: LiveReader = { call };
  return {
    reader,
    call,
    multicalls: () => call.mock.calls.filter(([tx]) => isMulticall(tx)).length,
    set: (next: Answer) => void (answer = next),
    hold: () => {
      let open = () => {};
      const promise = new Promise<void>((resolve) => (open = resolve));
      gate = { promise, open };
    },
    release: (next: Answer) => {
      answer = next;
      const g = gate;
      gate = undefined;
      g?.open();
    },
  };
}

let visibility: DocumentVisibilityState = "visible";

/** Fakes the timers and both clocks for every test in the file, and makes document.visibilityState settable. */
export function installLiveClocks(): void {
  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });
}

/** Moves the fake clocks on by `ms` and lets every answer due by then arrive. */
export const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The tab goes hidden, the way the browser says so. */
export function hideTab(): void {
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
}

/** The tab is shown again. */
export function showTab(): void {
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * The recorded answer at `timestamp`, judged the way the hook judges it, as read from the first RPC with the repo
 * calendar: for tests that render a part from a state without running the hook.
 */
export function readingAt(
  timestamp: number,
  opts: { block?: bigint; edit?: Edit; readAtMs?: number; wallAtReadSec?: number } = {},
): Reading {
  const r = results(timestamp, opts.block);
  const s = decodeSnapshot(opts.edit ? opts.edit(r) : r, FACTS.mandate.value.twapWindowSec);
  const snapshot: LiveSnapshot = { ...s, endpoint: LIVE_RPCS[0]!, calendar: { source: "repo" } };
  const session = sessionAt(snapshot);
  const verdicts = snapshot.tokens.map((t) => judgeToken(t, { timestamp: snapshot.timestamp, session }));
  return {
    snapshot,
    verdicts,
    headline: headline(verdicts),
    session,
    readAtMs: opts.readAtMs ?? 0,
    wallAtReadSec: opts.wallAtReadSec ?? timestamp,
  };
}
```

Create `web/test/live-snapshot-active.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLiveSnapshot } from "@/components/live/useLiveSnapshot";
import { type LiveState, REFRESH_MS } from "@/lib/live/freshness";
import { advance, BLOCK, fakeReader, hideTab, installLiveClocks, SAT, showTab } from "./helpers/fake-reader";

installLiveClocks();

/** The hook on a fake Base, with the visitor's clock 14 s after the block, the first read answered. */
async function mount(active = true) {
  vi.setSystemTime((SAT + 14) * 1000);
  const fake = fakeReader({ timestamp: SAT });
  const hook = renderHook(({ on }: { on: boolean }) => useLiveSnapshot({ reader: fake.reader, active: on }), {
    initialProps: { on: active },
  });
  await advance(0);
  return { fake, hook };
}

const blockOf = (s: LiveState) => ("reading" in s ? s.reading.snapshot.block : null);

describe("useLiveSnapshot's active option (HOLD)", () => {
  it("reads at mount and every REFRESH_MS while active, as before", async () => {
    const { fake, hook } = await mount();
    expect(fake.multicalls()).toBe(1);
    expect(hook.result.current.state.status).toBe("live");
    // The refresh timer and the 5 s reclassify interval.
    expect(vi.getTimerCount()).toBe(2);
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(2);
  });

  it("while held runs no timer, starts no read and keeps the frame on screen", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    const frame = hook.result.current.state;
    expect(vi.getTimerCount()).toBe(0);
    await advance(REFRESH_MS * 4);
    expect(fake.multicalls()).toBe(1);
    expect(hook.result.current.state).toEqual(frame);
    expect(hook.result.current.state.status).toBe("live");
  });

  it("on release shows a reading that aged past the live limit as stale at once, and reads at once", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    await advance(100_000);
    fake.hold();
    hook.rerender({ on: true });
    expect(hook.result.current.state.status).toBe("stale");
    expect(fake.multicalls()).toBe(2);
    fake.release({ timestamp: SAT + 105 });
    await advance(0);
    expect(hook.result.current.state.status).toBe("live");
    expect(vi.getTimerCount()).toBe(2);
  });

  it("on release after a short hold keeps the 30 s schedule from the last read", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    await advance(10_000);
    hook.rerender({ on: true });
    expect(fake.multicalls()).toBe(1);
    await advance(REFRESH_MS - 10_000 - 1);
    expect(fake.multicalls()).toBe(1);
    await advance(1);
    expect(fake.multicalls()).toBe(2);
  });

  it("keeps exactly one loop when the hold starts and ends while a read is in flight", async () => {
    const { fake, hook } = await mount();
    fake.hold();
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(2);
    hook.rerender({ on: false });
    hook.rerender({ on: true });
    fake.release({ timestamp: SAT + 30 });
    await advance(0);
    expect(hook.result.current.state.status).toBe("live");
    expect(vi.getTimerCount()).toBe(2);
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(3);
  });

  it("shows a read that lands while held only when the hold ends", async () => {
    const { fake, hook } = await mount();
    fake.hold();
    await advance(REFRESH_MS);
    hook.rerender({ on: false });
    fake.release({ timestamp: SAT + 30, block: BLOCK + 5n });
    await advance(0);
    expect(blockOf(hook.result.current.state)).toBe(BLOCK);
    expect(vi.getTimerCount()).toBe(0);
    hook.rerender({ on: true });
    expect(blockOf(hook.result.current.state)).toBe(BLOCK + 5n);
    expect(hook.result.current.state.status).toBe("live");
  });

  it("answers Refresh while held, at once, and still runs no timer", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    fake.set({ timestamp: SAT, block: BLOCK + 5n });
    act(() => hook.result.current.refresh());
    expect(hook.result.current.refreshing).toBe(true);
    await advance(0);
    const s = hook.result.current.state;
    expect(blockOf(s)).toBe(BLOCK + 5n);
    expect("ageMs" in s ? s.ageMs : null).toBe(0);
    expect(hook.result.current.refreshing).toBe(false);
    expect(fake.multicalls()).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("starts no read while it mounts held, and reads as soon as the hold ends", async () => {
    const { fake, hook } = await mount(false);
    expect(fake.multicalls()).toBe(0);
    expect(hook.result.current.state.status).toBe("reading");
    expect(vi.getTimerCount()).toBe(0);
    hook.rerender({ on: true });
    await advance(0);
    expect(fake.multicalls()).toBe(1);
    expect(hook.result.current.state.status).toBe("live");
  });

  it("reads nothing when a tab or page comes back while held", async () => {
    const { fake, hook } = await mount();
    hook.rerender({ on: false });
    hideTab();
    await advance(REFRESH_MS * 2);
    await act(async () => {
      showTab();
      window.dispatchEvent(new Event("pageshow"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fake.multicalls()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-snapshot-active.test.tsx
```

Expected: `Tests  6 failed | 3 passed (9)`. The hold cases fail, for example `expected 2 to be 0` on the timer count. Three cases already hold before the change, because `active` changes nothing they look at: the mount case, the short-hold case and the mid-read case.

- [ ] **Step 3: Write the minimal implementation**

Read `web/components/live/useLiveSnapshot.ts`, then replace the whole file with:

```ts
"use client";

import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { classify, type LiveState, type Reading, REFRESH_MS } from "@/lib/live/freshness";
import { createReader, LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
import { type LiveSnapshot, readSnapshot } from "@/lib/live/snapshot";
import { headline, judgeToken, sessionAt } from "@/lib/live/verdict";

export interface LiveSnapshotOptions {
  /** Answers the multicall; the keyless public RPCs (LIVE_RPCS) when left out. */
  reader?: LiveReader;
  refreshMs?: number;
  /** The visitor's monotonic clock, ms: performance.now(). */
  nowMs?: () => number;
  /** The visitor's wall clock, s: Date.now() / 1000. */
  wallSec?: () => number;
  /**
   * False while the visitor holds the reading (HOLD, WCAG 2.2.2). No read starts, the refresh timer and the 5 s
   * reclassify interval do not run, and the frame on screen does not change: a read already in flight finishes, and its
   * answer waits until the hold ends. A read that `refresh` asks for is shown at once, held or not. When it turns true
   * again, the clocks are read at once, so a reading that aged while held shows its age, and it reads at once if the
   * last read started `refreshMs` ago or more. Default true.
   */
  active?: boolean;
}

/** How often the age and the stale state move on without a new read. */
const RECLASSIFY_MS = 5_000;

interface Seen {
  last: Reading | undefined;
  /** Whether the latest read that settled failed. */
  failed: boolean;
  error?: string;
  /** Whether a read that refresh() asked for has not settled yet. */
  refreshing: boolean;
  /** The clocks when this was last looked at, so the render itself reads no clock. */
  nowMs: number;
  wallSec: number;
}

function judge(snapshot: LiveSnapshot, at: { nowMs: number; wallSec: number }): Reading {
  const session = sessionAt(snapshot);
  const verdicts = snapshot.tokens.map((t) => judgeToken(t, { timestamp: snapshot.timestamp, session }));
  return { snapshot, verdicts, headline: headline(verdicts), session, readAtMs: at.nowMs, wallAtReadSec: at.wallSec };
}

/**
 * Base mainnet, read in the browser. Nothing runs during the server render: the static HTML and the first client render
 * are the reading state. After mount it reads once, then every `refreshMs` while the tab is visible; a tab that comes
 * back after more than `refreshMs` reads at once. A tab or page that comes back looks at the clocks at once, so a reading
 * that aged while it slept is not shown as live while the new read runs. One read at a time. A failed read keeps the last
 * good reading, which `classify` then marks as not live. `refresh` reads now (a Retry or Refresh button), and
 * `refreshing` stays true until that read settles, while the state stays as it was; `endpoints` are the keyless RPCs the
 * default reader tries, in order. While `active` is false (HOLD) nothing runs and nothing on screen changes (see
 * LiveSnapshotOptions.active). A page runs this once: the landing through LiveSnapshotProvider.
 */
export function useLiveSnapshot(opts: LiveSnapshotOptions = {}): {
  state: LiveState;
  refresh: () => void;
  refreshing: boolean;
  endpoints: readonly string[];
} {
  const refreshMs = opts.refreshMs ?? REFRESH_MS;
  const active = opts.active ?? true;
  const [seen, setSeen] = useState<Seen>({ last: undefined, failed: false, refreshing: false, nowMs: 0, wallSec: 0 });

  // The latest options, read when a read starts, so a new function each render does not restart the loop.
  const options = useRef(opts);
  useEffect(() => {
    options.current = opts;
  });
  // The default reader, made on the first read in this browser, never at module scope or during a render.
  const fallback = useRef<LiveReader | null>(null);
  const readNow = useRef<(() => void) | null>(null);
  // Pauses and resumes the loop below; the second effect calls them when `active` changes.
  const control = useRef<{ pause: () => void; resume: () => void } | null>(null);

  useEffect(() => {
    let disposed = false;
    let inflight = false;
    let lastAttemptAt = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tick: ReturnType<typeof setInterval> | undefined;
    // Held: no read starts and no timer runs. An answer that settles meanwhile waits in `pending`.
    let paused = options.current.active === false;
    let pending: SetStateAction<Seen> | null = null;
    // A read the visitor asked for (Retry, Refresh) is shown at once, held or not.
    let forceCommit = false;

    const now = () => (options.current.nowMs ?? (() => performance.now()))();
    const wall = () => (options.current.wallSec ?? (() => Date.now() / 1000))();
    const reader = () => options.current.reader ?? (fallback.current ??= createReader());

    // The next read, refreshMs after the last one started; a hidden tab skips it and reads when it is shown again.
    const schedule = () => {
      clearTimeout(timer);
      timer = undefined;
      if (paused) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          if (document.visibilityState === "visible") void read();
        },
        Math.max(0, lastAttemptAt + refreshMs - now()),
      );
    };

    // One read, as the next state to show. It never throws.
    const attempt = async (): Promise<SetStateAction<Seen>> => {
      try {
        const snapshot = await readSnapshot(reader());
        // Both clocks as the answer arrived: the age runs from them, and the head's lag is fixed by the wall clock then.
        const at = { nowMs: now(), wallSec: wall() };
        return { last: judge(snapshot, at), failed: false, refreshing: false, ...at };
      } catch (e) {
        // An RPC that did not answer is said on the page, and the browser logs the failed request. An answer that did
        // not decode, or a throw in the verdict, is said nowhere else: one warning tells a developer why.
        if (!(e instanceof RpcError) || e.failures.some((f) => f.badAnswer)) console.warn("live: the reading failed:", e);
        const error = e instanceof Error ? e.message : String(e);
        // Clocks are read here, not in the updater, which React may call twice.
        const at = { nowMs: now(), wallSec: wall() };
        return (s: Seen) => ({ last: s.last, failed: true, error, refreshing: false, ...at });
      }
    };

    const read = async () => {
      if (inflight || disposed) return;
      inflight = true;
      clearTimeout(timer);
      timer = undefined;
      lastAttemptAt = now();
      const next = await attempt();
      inflight = false;
      if (disposed) return;
      if (paused && !forceCommit) {
        pending = next;
      } else {
        pending = null;
        setSeen(next);
      }
      forceCommit = false;
      schedule();
    };

    // Look at the clocks again, so the age and the stale state move on without a new read.
    const restamp = () => {
      const at = { nowMs: now(), wallSec: wall() };
      setSeen((s) => (s.last === undefined ? s : { ...s, ...at }));
    };

    // The tab is visible again, or the page is back from the back/forward cache (pageshow, which some browsers send
    // without a visibilitychange). The timers did not run while it slept, so the clocks are read at once: an old reading
    // never shows as live, even for the 5 s until the next tick. A held reading stays as it is.
    const onShow = () => {
      if (paused || document.visibilityState !== "visible") return;
      restamp();
      if (inflight) return;
      // A pending timer still reads on time; one that fired while hidden left none, so read now.
      if (timer === undefined || now() - lastAttemptAt >= refreshMs) void read();
    };

    const startTick = () => {
      clearInterval(tick);
      tick = setInterval(restamp, RECLASSIFY_MS);
    };

    const pause = () => {
      if (paused) return;
      paused = true;
      clearTimeout(timer);
      timer = undefined;
      clearInterval(tick);
      tick = undefined;
    };

    const resume = () => {
      if (!paused) return;
      paused = false;
      if (pending !== null) {
        setSeen(pending);
        pending = null;
      }
      startTick();
      restamp();
      // A read still in flight schedules the next one when it settles.
      if (inflight) return;
      if (now() - lastAttemptAt >= refreshMs && document.visibilityState === "visible") void read();
      else schedule();
    };

    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    readNow.current = () => {
      forceCommit = true;
      void read();
    };
    control.current = { pause, resume };
    if (!paused) {
      startTick();
      void read();
    }

    return () => {
      disposed = true;
      readNow.current = null;
      control.current = null;
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, [refreshMs]);

  useEffect(() => {
    if (active) control.current?.resume();
    else control.current?.pause();
  }, [active]);

  const refresh = useCallback(() => {
    const readOnce = readNow.current;
    if (readOnce === null) return;
    // A read already in flight answers this request too: it clears `refreshing` when it settles.
    setSeen((s) => ({ ...s, refreshing: true }));
    readOnce();
  }, []);

  return {
    state: classify(seen.last, seen.failed, seen.nowMs, seen.wallSec, seen.error),
    refresh,
    refreshing: seen.refreshing,
    endpoints: LIVE_RPCS,
  };
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-snapshot-active.test.tsx
```

Expected: `Tests  9 passed (9)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-strip.test.tsx test/now-page.test.tsx test/live-snapshot-active.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
```

Expected:
- Every file passes. `live-strip.test.tsx` covers the hook's behaviour without `active`, and `now-page.test.tsx` covers NowBoard's own call to the hook. Neither changes.
- The typecheck exits 0.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-01.txt`:

```
feat(web): add the active option to useLiveSnapshot, so HOLD stops reads and timers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/live/useLiveSnapshot.ts web/test/helpers/fake-reader.ts web/test/live-snapshot-active.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-01.txt"
```

---

### Task 2: LiveSnapshotProvider, and the strip on the shared snapshot

**Files:**
- Create: `web/components/live/LiveSnapshotProvider.tsx`
- Modify: `web/components/live/LiveStrip.tsx` (the whole file, 101 lines; the markup is unchanged)
- Test: `web/test/live-snapshot-provider.test.tsx`

**Interfaces:**
- Consumes:
  - `useLiveSnapshot(opts: LiveSnapshotOptions)` with `active` (Task 1);
  - `LiveState` from `@/lib/live/freshness`;
  - `LiveReader` from `@/lib/live/rpc`.
- Produces:
  - `interface LiveSnapshotValue { state: LiveState; refresh: () => void; refreshing: boolean; hold: boolean; setHold: (hold: boolean) => void }`;
  - `LiveSnapshotProvider({ reader?, children }: { reader?: LiveReader; children: ReactNode })`;
  - `useLive(): LiveSnapshotValue`, which throws `useLive needs a LiveSnapshotProvider above it` outside a provider;
  - `useLiveIfAny(): LiveSnapshotValue | null`.
  - `LiveStrip({ reader? })` keeps its export and props. Under a provider it reads the provider and ignores `reader`. Without one, it makes its own provider with `reader`.

**Review Focus 1 and 4** are pinned here, with Tasks 10 and 14.

- [ ] **Step 1: Write the failing test**

Create `web/test/live-snapshot-provider.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LiveSnapshotProvider, useLive, useLiveIfAny } from "@/components/live/LiveSnapshotProvider";
import { LiveStrip } from "@/components/live/LiveStrip";
import { REFRESH_MS } from "@/lib/live/freshness";
import { advance, fakeReader, installLiveClocks, SAT } from "./helpers/fake-reader";

installLiveClocks();

/** A subscriber that shows the shared status and holds or releases the reading. */
function Probe({ name }: { name: string }) {
  const { state, hold, setHold } = useLive();
  return (
    <button type="button" aria-pressed={hold} onClick={() => setHold(!hold)}>
      {`${name}: ${state.status}`}
    </button>
  );
}

function Orphan() {
  return <span data-orphan="">{useLiveIfAny() === null ? "no provider" : "provider"}</span>;
}

async function mount(children: React.ReactNode) {
  vi.setSystemTime((SAT + 14) * 1000);
  const fake = fakeReader({ timestamp: SAT });
  render(<LiveSnapshotProvider reader={fake.reader}>{children}</LiveSnapshotProvider>);
  await advance(0);
  return fake;
}

describe("LiveSnapshotProvider", () => {
  it("runs one read loop for every subscriber on the page", async () => {
    const fake = await mount(
      <>
        <Probe name="a" />
        <Probe name="b" />
        <LiveStrip />
      </>,
    );
    expect(fake.multicalls()).toBe(1);
    expect(screen.getByRole("button", { name: "a: live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "b: live" })).toBeInTheDocument();
    expect(document.querySelector("[data-live-strip]")).toHaveAttribute("data-live-strip", "live");
    // One refresh timer and one reclassify interval, not one pair per subscriber.
    expect(vi.getTimerCount()).toBe(2);
    await advance(REFRESH_MS);
    expect(fake.multicalls()).toBe(2);
  });

  it("holds every subscriber when one holds: no read, no timer, until it is released", async () => {
    const fake = await mount(
      <>
        <Probe name="a" />
        <Probe name="b" />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "a: live" }));
    expect(screen.getByRole("button", { name: "b: live" })).toHaveAttribute("aria-pressed", "true");
    expect(vi.getTimerCount()).toBe(0);
    await advance(REFRESH_MS * 3);
    expect(fake.multicalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /^b: / }));
    expect(screen.getByRole("button", { name: /^a: / })).toHaveAttribute("aria-pressed", "false");
    await advance(0);
    expect(fake.multicalls()).toBe(2);
    expect(screen.getByRole("button", { name: "a: live" })).toBeInTheDocument();
  });

  it("feeds a strip under it from the page's loop, never from the strip's own reader", async () => {
    const own = fakeReader({ timestamp: SAT });
    const fake = await mount(<LiveStrip reader={own.reader} />);
    expect(fake.multicalls()).toBe(1);
    expect(own.call).not.toHaveBeenCalled();
    expect(document.querySelector("[data-live-strip]")).toHaveAttribute("data-live-strip", "live");
  });

  it("holds the reading state only in the static HTML, and reads nothing on the server", () => {
    const fake = fakeReader({ timestamp: SAT });
    const html = renderToString(
      <LiveSnapshotProvider reader={fake.reader}>
        <Probe name="a" />
        <LiveStrip />
      </LiveSnapshotProvider>,
    );
    expect(html).toContain("a: reading");
    expect(html).toContain("Reading Base mainnet");
    for (const value of ["60,013,066", "60013066", ">LIVE<", "basescan.org/block/", "REFUSE", "data-verdict-line"]) {
      expect(html).not.toContain(value);
    }
    expect(fake.call).not.toHaveBeenCalled();
  });

  it("gives null to useLiveIfAny with no provider above", () => {
    render(<Orphan />);
    expect(screen.getByText("no provider")).toBeInTheDocument();
  });

  it("says which provider is missing when useLive has none", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Probe name="x" />)).toThrow("useLive needs a LiveSnapshotProvider above it");
    } finally {
      quiet.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-snapshot-provider.test.tsx
```

Expected: the file fails with `Failed to resolve import "@/components/live/LiveSnapshotProvider"`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/components/live/LiveSnapshotProvider.tsx`:

```tsx
"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import type { LiveState } from "@/lib/live/freshness";
import type { LiveReader } from "@/lib/live/rpc";
import { useLiveSnapshot } from "./useLiveSnapshot";

/** What every live surface on a page reads: the one snapshot, its refresh, and HOLD. */
export interface LiveSnapshotValue {
  state: LiveState;
  refresh: () => void;
  refreshing: boolean;
  /** True while the visitor holds the reading (HoldKey): no read, no timer, a frozen frame. */
  hold: boolean;
  setHold: (hold: boolean) => void;
}

const LiveSnapshotContext = createContext<LiveSnapshotValue | null>(null);

/**
 * Runs exactly one useLiveSnapshot for the page (spec 2026-11-23 section 3.8) and gives it to every live surface under
 * it: the strip, HoldKey, the ThumbBar's lamp. HOLD is state here, and turns the hook's `active` off. The landing mounts
 * it in app/(site)/page.tsx; `reader` is for tests.
 */
export function LiveSnapshotProvider({ reader, children }: { reader?: LiveReader; children: ReactNode }) {
  const [hold, setHold] = useState(false);
  const { state, refresh, refreshing } = useLiveSnapshot({ reader, active: !hold });
  return <LiveSnapshotContext value={{ state, refresh, refreshing, hold, setHold }}>{children}</LiveSnapshotContext>;
}

/** The page's live snapshot. Throws outside a LiveSnapshotProvider: a live surface must never start a loop of its own. */
export function useLive(): LiveSnapshotValue {
  const live = useContext(LiveSnapshotContext);
  if (live === null) throw new Error("useLive needs a LiveSnapshotProvider above it");
  return live;
}

/** The page's live snapshot, or null where no provider runs (a page that reads no chain shows its unlit frame). */
export function useLiveIfAny(): LiveSnapshotValue | null {
  return useContext(LiveSnapshotContext);
}
```

Read `web/components/live/LiveStrip.tsx`, then replace the whole file with the version below. The markup is unchanged. Only the source of the snapshot changes.

```tsx
"use client";

import type { MouseEvent } from "react";
import { NAV_TOKENS } from "@/content/b20-nav";
import type { LiveState } from "@/lib/live/freshness";
import { formatBlock, formatEt, formatUtc } from "@/lib/live/format";
import type { LiveReader } from "@/lib/live/rpc";
import { BlockLink, FAILED, LiveAnnouncer, LivePill, NotLiveWhy, READING, ReadButton, Sep, useRetry } from "./LiveStatus";
import { LiveSnapshotProvider, type LiveSnapshotValue, useLive, useLiveIfAny } from "./LiveSnapshotProvider";
import { VerdictLine } from "./VerdictLine";

function NowLink() {
  return (
    <a href="/now" className="whitespace-nowrap font-medium">
      All {NAV_TOKENS.length} B20s <span aria-hidden="true">→</span>
    </a>
  );
}

interface BodyProps {
  state: LiveState;
  refreshing: boolean;
  onRetry: (e: MouseEvent<HTMLButtonElement>) => void;
}

function Body({ state, refreshing, onRetry }: BodyProps) {
  switch (state.status) {
    case "reading":
      return <p className="m-0">{READING}</p>;
    case "error":
      return (
        <p className="m-0 text-ink">
          {FAILED}{" "}
          <ReadButton refreshing={refreshing} onClick={onRetry} idle="Retry" busy="Retrying…" className="ml-1 h-6 px-2.5 text-[12px]" />
        </p>
      );
    case "live": {
      const { snapshot, session, headline } = state.reading;
      return (
        <p className="m-0">
          <LivePill live />{" "}
          <BlockLink n={snapshot.block}>{`Base block ${formatBlock(snapshot.block)}`}</BlockLink>
          <Sep />
          <span className="whitespace-nowrap font-mono text-[12px]">
            {formatUtc(snapshot.timestamp)} · {formatEt(snapshot.timestamp)}
          </span>
          <Sep />
          <span>{session.detail}</span>
          <Sep mark="—" />
          <VerdictLine headline={headline} tone="ink" methodHref="/now#method" />
          <Sep />
          <NowLink />
        </p>
      );
    }
    case "stale":
    case "behind":
      return (
        <p className="m-0">
          <LivePill live={false} /> <NotLiveWhy state={state} />
          <Sep mark="—" />
          <VerdictLine headline={state.reading.headline} tone="muted" methodHref="/now#method" />
          <Sep />
          <NowLink />
        </p>
      );
  }
}

/**
 * The height of the tallest line the strip can show, measured in the browser (20 px lines): live, with three different
 * refusals and "Wednesday · open until 16:00 ET". It is 160 px at a 375 px phone (343 px wide), 80 px from 640 px (the
 * one-column hero, 608 to 935 px wide), 120 px from 1000 px (the two-column hero, 440 px wide) and 100 px from 1280 px
 * (560 px wide). Every state is reserved up front, so the landing never moves when a reading arrives; a short weekend
 * line leaves the rest empty. Phones narrower than 375 px still grow a line for that three-refusal headline only.
 * 62.5rem (1000 px), where the hero's grid takes two columns, is in rem so Tailwind sorts it between sm (40rem) and
 * xl (80rem).
 */
const RESERVE = "min-h-40 sm:min-h-20 min-[62.5rem]:min-h-30 xl:min-h-25";

/** The strip itself, on the page's one snapshot. */
function Strip({ live }: { live: LiveSnapshotValue }) {
  const { state, refresh, refreshing } = live;
  const { box, onRetry } = useRetry(state, refreshing, refresh);

  return (
    <div ref={box} tabIndex={-1} data-live-strip={state.status} className={`${RESERVE} text-[13px] leading-5 text-ink-2`}>
      <LiveAnnouncer state={state} />
      <Body state={state} refreshing={refreshing} onRetry={onRetry} />
      <noscript>
        <p className="m-0">
          The live line needs JavaScript. <a href="/now">Right now on Base</a> explains what it reads.
        </p>
      </noscript>
    </div>
  );
}

/** A strip that made its own provider: it reads the snapshot from there. */
function SharedStrip() {
  return <Strip live={useLive()} />;
}

/**
 * A quiet line under the landing H1: the Base block this browser read, its NYSE session, and what an agent under the
 * default mandate would do with a BUY of each basket token. The static HTML holds the reading state only; no chain
 * value is ever baked in. Under a LiveSnapshotProvider it reads the page's snapshot, and `reader` is not used; with
 * none above it (a test that renders the Hero alone), it runs a provider of its own with `reader`.
 */
export function LiveStrip({ reader }: { reader?: LiveReader }) {
  const live = useLiveIfAny();
  if (live !== null) return <Strip live={live} />;
  return (
    <LiveSnapshotProvider reader={reader}>
      <SharedStrip />
    </LiveSnapshotProvider>
  );
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-snapshot-provider.test.tsx test/live-strip.test.tsx
```

Expected: every test passes. `live-snapshot-provider.test.tsx` counts `6 passed`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/top.test.tsx test/page.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
```

Expected: both files pass, and the typecheck exits 0.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-02.txt`:

```
feat(web): share one live snapshot per page through LiveSnapshotProvider

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/live/LiveSnapshotProvider.tsx web/components/live/LiveStrip.tsx web/test/live-snapshot-provider.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-02.txt"
```

---

### Task 3: HoldKey

**Files:**
- Create: `web/components/instrument/HoldKey.tsx`
- Modify: `web/app/globals.css` (a new block before the global reduced-motion block)
- Test: `web/test/instrument-hold-key.test.tsx`

**Interfaces:**
- Consumes:
  - `useLive()` from `@/components/live/LiveSnapshotProvider` (Task 2);
  - the P0 tokens `--color-chassis-line`, `--color-lcd`, `--color-lcd-2`, `--color-pass-lit`, `--t-tick` and `--ease-instrument`.
- Produces:
  - `KEY_CLASS: string`, the class every bezel key shares. Task 6's Refresh key uses it too.
  - `HoldKey({ className }: { className?: string })`, a `"use client"` button: `type="button"`, `data-hold-key`, `aria-pressed={hold}`, the text "Hold", and `onClick` calls `setHold(!hold)`.
  - The CSS classes `.readout-key`, `.readout-key::before` (the 44 px target) and `.readout-key:active` (the 1 px, 60 ms key press of spec 8.3).

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-hold-key.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HoldKey, KEY_CLASS } from "@/components/instrument/HoldKey";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { REFRESH_MS } from "@/lib/live/freshness";
import { advance, fakeReader, installLiveClocks, SAT } from "./helpers/fake-reader";

installLiveClocks();

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

async function mount() {
  vi.setSystemTime((SAT + 14) * 1000);
  const fake = fakeReader({ timestamp: SAT });
  render(
    <LiveSnapshotProvider reader={fake.reader}>
      <HoldKey className="ml-2" />
    </LiveSnapshotProvider>,
  );
  await advance(0);
  return fake;
}

describe("HoldKey (spec 2026-11-23 section 5.1, WCAG 2.2.2)", () => {
  it("is a toggle button named Hold, not pressed at first", async () => {
    await mount();
    const key = screen.getByRole("button", { name: "Hold" });
    expect(key.tagName).toBe("BUTTON");
    expect(key).toHaveAttribute("type", "button");
    expect(key).toHaveAttribute("aria-pressed", "false");
    expect(key).toHaveAttribute("data-hold-key");
    expect(key.className).toBe(`${KEY_CLASS} ml-2`);
  });

  it("holds the page's reading while pressed, with no read and no timer, and a second press reads on", async () => {
    const fake = await mount();
    const key = screen.getByRole("button", { name: "Hold" });
    fireEvent.click(key);
    expect(key).toHaveAttribute("aria-pressed", "true");
    expect(vi.getTimerCount()).toBe(0);
    await advance(REFRESH_MS * 2);
    expect(fake.multicalls()).toBe(1);
    fireEvent.click(key);
    expect(key).toHaveAttribute("aria-pressed", "false");
    await advance(0);
    expect(fake.multicalls()).toBe(2);
  });

  it("needs the page's provider: it never starts a read loop of its own", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<HoldKey />)).toThrow("useLive needs a LiveSnapshotProvider above it");
    } finally {
      quiet.mockRestore();
    }
  });

  it("is a 24 px key with a 44 px target, lit pass-lit while pressed, and travels 1 px when pressed", () => {
    for (const cls of ["readout-key", "min-h-6", "text-lcd-2", "aria-pressed:border-pass-lit", "aria-pressed:text-pass-lit"]) {
      expect(KEY_CLASS.split(" ")).toContain(cls);
    }
    expect(css).toMatch(
      /\.readout-key\s*\{\s*position:\s*relative;\s*transition:\s*translate 60ms var\(--ease-instrument\), color var\(--t-tick\) var\(--ease-instrument\), border-color var\(--t-tick\) var\(--ease-instrument\);\s*\}/,
    );
    expect(css).toMatch(/\.readout-key::before\s*\{\s*content:\s*"";\s*position:\s*absolute;\s*inset:\s*-10px -4px;\s*\}/);
    expect(css).toMatch(/\.readout-key:active\s*\{\s*translate:\s*0 1px;\s*\}/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-hold-key.test.tsx
```

Expected: the file fails with `Failed to resolve import "@/components/instrument/HoldKey"`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/components/instrument/HoldKey.tsx`:

```tsx
"use client";

import { useLive } from "@/components/live/LiveSnapshotProvider";

/**
 * A bezel key on the Readout (spec 2026-11-23 sections 4 and 6.1): 24 px tall, mono, engraved, with a 44 px target from
 * `.readout-key::before` in app/globals.css and a 1 px press. lcd-2 at rest, lcd on hover, pass-lit while pressed. The
 * strip's Refresh key shares it.
 */
export const KEY_CLASS =
  "readout-key min-h-6 cursor-pointer rounded-md border border-chassis-line bg-transparent px-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-lcd-2 hover:text-lcd aria-pressed:border-pass-lit aria-pressed:text-pass-lit aria-disabled:cursor-wait focus-visible:outline-pass-lit";

/**
 * HOLD (WCAG 2.2.2): while pressed, the page's one reading is held. No read starts, no timer runs, and the strip and
 * its countdown stay as they are, until it is pressed again. It reads the page's LiveSnapshotProvider, never a loop of
 * its own. The word stays "Hold" in the DOM; CSS uppercases it.
 */
export function HoldKey({ className }: { className?: string }) {
  const { hold, setHold } = useLive();
  return (
    <button
      type="button"
      data-hold-key=""
      aria-pressed={hold}
      onClick={() => setHold(!hold)}
      className={className ? `${KEY_CLASS} ${className}` : KEY_CLASS}
    >
      Hold
    </button>
  );
}
```

In `web/app/globals.css`, insert this block immediately before the global reduced-motion block, the way Global Constraints describes:

```css
/* Bezel keys (components/instrument/HoldKey.tsx, KEY_CLASS): 24 px keys with a 44 px target, a 1 px press over 60 ms,
   and their colour on the 120 ms tick. */
@layer components {
  .readout-key {
    position: relative;
    transition: translate 60ms var(--ease-instrument), color var(--t-tick) var(--ease-instrument), border-color var(--t-tick) var(--ease-instrument);
  }
  .readout-key::before {
    content: "";
    position: absolute;
    inset: -10px -4px;
  }
  .readout-key:active {
    translate: 0 1px;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-hold-key.test.tsx
```

Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-modules.test.ts test/instrument-contrast.test.ts test/tokens.test.ts test/instrument-hold-key.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
```

Expected:
- Every file passes. The modules test checks that `HoldKey.tsx` is a client module with local imports only. The contrast test checks that `text-lcd`, `text-lcd-2` and `text-pass-lit` are declared pairs. The tokens test checks that the colour block and the reduce block are unchanged.
- The typecheck exits 0.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-03.txt`:

```
feat(web): add the HoldKey bezel key

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/instrument/HoldKey.tsx web/app/globals.css web/test/instrument-hold-key.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-03.txt"
```

---

### Task 4: Chassis palettes for LiveStatus and VerdictLine

**Files:**
- Modify: `web/components/live/LiveStatus.tsx`, the whole file (143 lines). The changes are to the imports (lines 1-5), LivePill (41-54), BlockLink (71-77), NotLiveWhy (79-92) and ReadButton (94-120).
- Modify: `web/components/live/VerdictLine.tsx`, the whole file (68 lines). The changes are a new `CHASSIS_TONE` after `TONE` (lines 6-13) and a `palette` prop on `VerdictLine` (32-67).
- Test: `web/test/instrument-chassis-palette.test.tsx`

**Interfaces:**
- Consumes:
  - `Surface` (`"faceplate" | "chassis"`) from `@/components/instrument/types` (P0 Task 9);
  - `classify` from `@/lib/live/freshness`;
  - `readingAt` and `SAT` from `web/test/helpers/fake-reader.ts` (Task 1).
- Produces:
  - `LivePill({ live, palette = "faceplate" })`.
  - `BlockLink({ n, children, label, palette = "faceplate" }: { n: bigint; children: ReactNode; label?: string; palette?: Surface })`. `label` becomes the link's `aria-label`.
  - `NotLiveWhy({ state, palette = "faceplate" })`.
  - `ReadButton({ ..., palette = "faceplate" })`.
  - `VerdictLine({ ..., palette = "faceplate" })` and `CHASSIS_TONE: Record<VerdictTone, string>`.
  - The default palette renders exactly today's classes and markup, so NowBoard (a frozen file) is unchanged. `TONE` and `data-tone` are unchanged.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-chassis-palette.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BlockLink, LivePill, NotLiveWhy, ReadButton } from "@/components/live/LiveStatus";
import { CHASSIS_TONE, TONE, VerdictLine } from "@/components/live/VerdictLine";
import { classify } from "@/lib/live/freshness";
import { readingAt, SAT } from "./helpers/fake-reader";

const PILL = "mr-1 inline-flex items-center gap-1.5 rounded-full px-2 align-[1px] font-mono text-[11px] font-semibold leading-4";
// NowBoard's classes before P1: the faceplate palette keeps every one of them, byte for byte.
const FACEPLATE_READ_BUTTON =
  "cursor-pointer rounded-full border border-line-strong bg-transparent align-middle font-medium text-ink hover:border-ink aria-disabled:cursor-wait aria-disabled:text-ink-2 aria-disabled:hover:border-line-strong";
const CHASSIS_READ_BUTTON =
  "cursor-pointer rounded-full border border-chassis-line bg-transparent align-middle font-medium text-lcd hover:border-lcd-2 aria-disabled:cursor-wait aria-disabled:text-lcd-2 aria-disabled:hover:border-chassis-line";

/** Read at SAT + 14 s; the refresh after it failed; looked at 30 s later. */
function staleState() {
  const s = classify(readingAt(SAT, { readAtMs: 0, wallAtReadSec: SAT + 14 }), true, 30_000, SAT + 44);
  if (s.status !== "stale") throw new Error(`expected a stale state, not ${s.status}`);
  return s;
}

describe("the live pieces on the faceplate and on the chassis (spec 2026-11-23 section 5.2)", () => {
  it("keeps NowBoard's faceplate classes and markup byte for byte by default", () => {
    render(
      <>
        <LivePill live />
        <LivePill live={false} />
        <BlockLink n={60_013_066n}>Base block 60,013,066</BlockLink>
        <ReadButton refreshing={false} onClick={() => {}} idle="Refresh" busy="Refreshing…" className="h-6 px-2.5" />
        <VerdictLine headline={{ kind: "refuse-all", reason: "MARKET_CLOSED" }} />
      </>,
    );
    const live = screen.getByText("LIVE");
    expect(live.className).toBe(`${PILL} bg-accent-tint py-px text-accent`);
    expect(live.firstElementChild!.className).toBe("anim-live size-1.5 rounded-full bg-accent");
    expect(screen.getByText("NOT LIVE").className).toBe(`${PILL} border border-ink-2 text-ink-2`);
    const link = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(link.className).toBe("whitespace-nowrap font-mono text-[12px]");
    expect(link).not.toHaveAttribute("aria-label");
    expect(screen.getByRole("button", { name: "Refresh" }).className).toBe(`${FACEPLATE_READ_BUTTON} h-6 px-2.5`);
    const line = document.querySelector("[data-verdict-line]")!;
    expect(line.className).toBe("text-ink");
    expect(line).toHaveAttribute("data-tone", "ink");
    expect(TONE).toEqual({ ink: "text-ink", muted: "text-ink-2 [&_[data-reason-tag]>span]:text-ink-2" });
  });

  it("draws the chassis pill and the Retry key in lcd and pass-lit", () => {
    render(
      <>
        <LivePill live palette="chassis" />
        <LivePill live={false} palette="chassis" />
        <ReadButton palette="chassis" refreshing onClick={() => {}} idle="Retry" busy="Retrying…" className="h-6 px-2.5" />
      </>,
    );
    const live = screen.getByText("LIVE");
    expect(live.className).toBe(`${PILL} readout-lit border border-pass-lit text-pass-lit`);
    expect(live.firstElementChild!.className).toBe("anim-live size-1.5 rounded-full bg-pass-lit");
    expect(screen.getByText("NOT LIVE").className).toBe(`${PILL} border border-lcd-2 text-lcd-2`);
    const retry = screen.getByRole("button", { name: "Retrying…" });
    expect(retry.className).toBe(`${CHASSIS_READ_BUTTON} h-6 px-2.5`);
    expect(retry).toHaveAttribute("aria-disabled", "true");
  });

  it("names a chassis block link by its label, whatever its content", () => {
    render(
      <BlockLink n={60_013_066n} label="Base block 60,013,066" palette="chassis">
        <span>60,013,066</span>
      </BlockLink>,
    );
    const link = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(link).toHaveAttribute("href", "https://basescan.org/block/60013066");
    expect(link.className).toBe("whitespace-nowrap font-mono text-[12px] text-pass-lit");
  });

  it("says why a reading is not live in the same words on either surface", () => {
    const state = staleState();
    const { unmount } = render(<NotLiveWhy state={state} />);
    const words = "last read block 60,013,066, 30 s ago · the RPC did not answer since";
    expect(document.body).toHaveTextContent(words);
    expect(screen.getByRole("link", { name: "60,013,066" }).className).toBe("whitespace-nowrap font-mono text-[12px]");
    unmount();
    render(<NotLiveWhy state={state} palette="chassis" />);
    expect(document.body).toHaveTextContent(words);
    expect(screen.getByRole("link", { name: "60,013,066" }).className).toBe("whitespace-nowrap font-mono text-[12px] text-pass-lit");
  });

  it("keeps data-tone and the sentence on the chassis, with its own tones", () => {
    expect(CHASSIS_TONE).toEqual({
      ink: "text-lcd [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd [&_[data-reason-tag]>span+span]:text-lcd-2",
      muted: "text-lcd-2 [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd-2",
    });
    const h = { kind: "refuse-all", reason: "MARKET_CLOSED" } as const;
    render(
      <>
        <VerdictLine headline={h} palette="chassis" />
        <VerdictLine headline={h} tone="muted" palette="chassis" className="block" />
      </>,
    );
    const [ink, muted] = [...document.querySelectorAll("[data-verdict-line]")];
    expect(ink!.className).toBe(CHASSIS_TONE.ink);
    expect(ink).toHaveAttribute("data-tone", "ink");
    expect(muted!.className).toBe(`${CHASSIS_TONE.muted} block`);
    expect(muted).toHaveAttribute("data-tone", "muted");
    expect(ink!.textContent).toBe(muted!.textContent);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-chassis-palette.test.tsx
```

Expected: `Tests  4 failed | 1 passed (5)`. The faceplate test passes, because it pins today's classes. The other four fail on the chassis classes, on the missing label name, or on `CHASSIS_TONE` being undefined.

- [ ] **Step 3: Write the minimal implementation**

Read `web/components/live/LiveStatus.tsx`, then replace the whole file with:

```tsx
import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import type { Surface } from "@/components/instrument/types";
import { basescanBlock } from "@/lib/live/basescan";
import type { LiveState } from "@/lib/live/freshness";
import { formatAge, formatBlock } from "@/lib/live/format";
import { headlineText } from "@/lib/live/verdict";

/**
 * The pieces the landing strip and /now share: the reading and failure sentences, the LIVE / NOT LIVE pill, the block
 * link, why a reading is not live, the one polite live region, and a Retry that keeps its focus. Each visible piece
 * takes a palette: "faceplate", the default, is /now's white board with today's classes; "chassis" is the landing's
 * Readout, in lcd and pass-lit on the dark window.
 */
export const READING = "Reading Base mainnet…";
export const FAILED = "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.";

/** A reading the page can show: live, or not live with the reason. */
export type ShownState = Extract<LiveState, { reading: unknown }>;

/** What the polite region says: the status and the verdict only, so a new block every refresh is not read aloud. */
export function announcement(state: LiveState): string {
  switch (state.status) {
    case "reading":
      return READING;
    case "error":
      return FAILED;
    case "live":
      return `Live. ${headlineText(state.reading.headline)}`;
    case "stale":
    case "behind":
      return `Not live. ${headlineText(state.reading.headline)}`;
  }
}

/** The only live region: it changes when the status or the verdict does, never for a new block alone. */
export function LiveAnnouncer({ state }: { state: LiveState }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {announcement(state)}
    </span>
  );
}

/** A pill no taller than the 20 px line, so the line keeps its height. */
const PILL = "mr-1 inline-flex items-center gap-1.5 rounded-full px-2 align-[1px] font-mono text-[11px] font-semibold leading-4";

/** The pill's colours on each surface. The faceplate's are NowBoard's, byte for byte. */
const LIVE_PILL: Readonly<Record<Surface, { live: string; dot: string; notLive: string }>> = {
  faceplate: { live: "bg-accent-tint py-px text-accent", dot: "bg-accent", notLive: "border border-ink-2 text-ink-2" },
  chassis: { live: "readout-lit border border-pass-lit text-pass-lit", dot: "bg-pass-lit", notLive: "border border-lcd-2 text-lcd-2" },
};

/** LIVE for a live reading, NOT LIVE for any other reading. */
export function LivePill({ live, palette = "faceplate" }: { live: boolean; palette?: Surface }) {
  const p = LIVE_PILL[palette];
  return live ? (
    <span className={`${PILL} ${p.live}`}>
      <span aria-hidden="true" className={`anim-live size-1.5 rounded-full ${p.dot}`} />
      LIVE
    </span>
  ) : (
    <span className={`${PILL} ${p.notLive}`}>NOT LIVE</span>
  );
}

/**
 * The mark between two parts of the line, wider apart than the "·" inside a part. The spaces around it are real, so the
 * line can wrap there and a screen reader keeps the parts apart; the mark itself is visual only.
 */
export function Sep({ mark = "·" }: { mark?: "·" | "—" }) {
  return (
    <>
      {" "}
      <span aria-hidden="true" className="mx-1">
        {mark}
      </span>{" "}
    </>
  );
}

const BLOCK_LINK: Readonly<Record<Surface, string>> = {
  faceplate: "whitespace-nowrap font-mono text-[12px]",
  chassis: "whitespace-nowrap font-mono text-[12px] text-pass-lit",
};

/**
 * A block, linked on Basescan. `label` names the link whole when its content is not one string: the strip's link
 * holds one Digits cell per character, and engines may join those cells into a name differently.
 */
export function BlockLink({
  n,
  children,
  label,
  palette = "faceplate",
}: {
  n: bigint;
  children: ReactNode;
  label?: string;
  palette?: Surface;
}) {
  return (
    <a href={basescanBlock(n)} target="_blank" rel="noopener noreferrer" aria-label={label} className={BLOCK_LINK[palette]}>
      {children}
    </a>
  );
}

/** Why a reading is not live: it aged or a refresh failed (stale), or the RPC's head was behind the visitor's clock. */
export function NotLiveWhy({ state, palette = "faceplate" }: { state: ShownState; palette?: Surface }) {
  const block = (
    <BlockLink n={state.reading.snapshot.block} palette={palette}>
      {formatBlock(state.reading.snapshot.block)}
    </BlockLink>
  );
  return state.status === "behind" ? (
    <span>
      the RPC&apos;s latest block {block} is {formatAge(state.lagSec)} behind your clock
    </span>
  ) : (
    <span>
      last read block {block}, {formatAge(state.ageMs / 1000)} ago
      {state.refreshFailed ? " · the RPC did not answer since" : ""}
    </span>
  );
}

const READ_BUTTON: Readonly<Record<Surface, string>> = {
  faceplate:
    "cursor-pointer rounded-full border border-line-strong bg-transparent align-middle font-medium text-ink hover:border-ink aria-disabled:cursor-wait aria-disabled:text-ink-2 aria-disabled:hover:border-line-strong",
  chassis:
    "cursor-pointer rounded-full border border-chassis-line bg-transparent align-middle font-medium text-lcd hover:border-lcd-2 aria-disabled:cursor-wait aria-disabled:text-lcd-2 aria-disabled:hover:border-chassis-line",
};

/**
 * Retry or Refresh. While the read is in flight the button stays where it is and keeps focus: aria-disabled, not
 * disabled, since a disabled button loses focus to the page.
 */
export function ReadButton({
  refreshing,
  onClick,
  idle,
  busy,
  className,
  palette = "faceplate",
}: {
  refreshing: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  idle: string;
  busy: string;
  /** The button's size. */
  className: string;
  palette?: Surface;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={refreshing || undefined}
      className={`${READ_BUTTON[palette]} ${className}`}
    >
      {refreshing ? busy : idle}
    </button>
  );
}

/**
 * A Retry for the failed first read. A retry that works takes the focused Retry button away with the error, so the focus
 * goes to `box` (give it tabIndex -1), not to the page. A click while a read is in flight does nothing.
 */
export function useRetry(state: LiveState, refreshing: boolean, refresh: () => void) {
  const box = useRef<HTMLDivElement>(null);
  const focusAfterRetry = useRef(false);

  const onRetry = (e: MouseEvent<HTMLButtonElement>) => {
    if (refreshing) return;
    focusAfterRetry.current = document.activeElement === e.currentTarget;
    refresh();
  };

  useEffect(() => {
    if (refreshing || !focusAfterRetry.current) return;
    focusAfterRetry.current = false;
    if (state.status !== "error") box.current?.focus();
  }, [refreshing, state.status]);

  return { box, onRetry };
}
```

Read `web/components/live/VerdictLine.tsx`, then replace the whole file with:

```tsx
import type { ReactNode } from "react";
import type { Surface } from "@/components/instrument/types";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { type RefusalCode, reasonText } from "@/content/reasons";
import { type Headline, headlineText, VAULT_NOT_RUN } from "@/lib/live/verdict";

export type VerdictTone = "ink" | "muted";

/** The sentence's color, and the tags' labels with it: /now mutes its table cells the same way. */
export const TONE: Record<VerdictTone, string> = {
  ink: "text-ink",
  // A reading that is not live: the whole sentence in the secondary ink, the tag's label included.
  muted: "text-ink-2 [&_[data-reason-tag]>span]:text-ink-2",
};

/**
 * The same tones inside the landing's Readout (spec 2026-11-23 section 5.2): lcd text and pass-lit links on the dark
 * window. A live line's tags keep their two weights, the label in lcd and the code in lcd-2; a muted line is lcd-2
 * throughout.
 */
export const CHASSIS_TONE: Record<VerdictTone, string> = {
  ink: "text-lcd [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd [&_[data-reason-tag]>span+span]:text-lcd-2",
  muted: "text-lcd-2 [&_a]:text-pass-lit [&_[data-reason-tag]>span]:text-lcd-2",
};

function codes(h: Headline): RefusalCode[] {
  switch (h.kind) {
    case "refuse-all":
      return [h.reason];
    case "mixed":
      return h.refused.map((r) => r.reason);
    case "pass-all":
      return [];
  }
}

/**
 * The headline sentence of headlineText, word for word, with each "Label (CODE)" shown as its ReasonTag. Splitting the
 * one sentence keeps the strip, /now and the announcement in the same words. The tags are two flex boxes, so a screen
 * reader reads "Market closed MARKET_CLOSED" as part of the sentence; no aria-label is needed. When nothing is refused,
 * the closing "vault checks not run" links `methodHref`, the method that says which checks need a vault. `palette`
 * picks TONE (the faceplate, the default) or CHASSIS_TONE; data-tone says the tone on either.
 */
export function VerdictLine({
  headline: h,
  tone = "ink",
  className,
  methodHref,
  palette = "faceplate",
}: {
  headline: Headline;
  tone?: VerdictTone;
  className?: string;
  methodHref?: string;
  palette?: Surface;
}) {
  let rest = headlineText(h);
  const parts: ReactNode[] = [];
  codes(h).forEach((code, i) => {
    const text = reasonText(code);
    const at = rest.indexOf(text);
    if (at < 0) return;
    parts.push(rest.slice(0, at), <ReasonTag key={i} code={code} tone="neutral" layout="inline" />);
    rest = rest.slice(at + text.length);
  });
  const at = h.kind === "pass-all" && methodHref !== undefined ? rest.lastIndexOf(VAULT_NOT_RUN) : -1;
  if (at >= 0) {
    parts.push(
      rest.slice(0, at),
      <a key="method" href={methodHref} className="underline underline-offset-2">
        {VAULT_NOT_RUN}
      </a>,
    );
    rest = rest.slice(at + VAULT_NOT_RUN.length);
  }
  parts.push(rest);
  const tones = palette === "chassis" ? CHASSIS_TONE : TONE;
  return (
    <span data-verdict-line={h.kind} data-tone={tone} className={className ? `${tones[tone]} ${className}` : tones[tone]}>
      {parts}
    </span>
  );
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-chassis-palette.test.tsx
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/now-page.test.tsx test/live-strip.test.tsx test/live-snapshot-provider.test.tsx test/instrument-chassis-palette.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
```

Expected:
- Every file passes. `now-page.test.tsx` renders NowBoard on the faceplate defaults.
- The typecheck exits 0. NowBoard passes a string child to `BlockLink`, which a `ReactNode` still takes.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-04.txt`:

```
feat(web): add a chassis palette to the live pill, block link, Retry and verdict line

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/live/LiveStatus.tsx web/components/live/VerdictLine.tsx web/test/instrument-chassis-palette.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-04.txt"
```

---

### Task 5: The countdown

**Files:**
- Create: `web/lib/live/countdown.ts`
- Test: `web/test/live-countdown.test.ts`

**Interfaces:**
- Consumes:
  - `nextOpen(ts: number): number` from `@/content/calendar` (P0 Task 6). It throws for a non-finite `ts` and when there is no open within 14 days.
  - `localTime`, `regularSession` and `WEEKDAY_NAMES` from `@/content/calendar`;
  - `clockLabel` from `@/content/format`;
  - `formatAge` from `@/lib/live/format`;
  - `Session` and `sessionAt` from `@/lib/live/verdict` (read only).
- Produces: `countdownText(session: Session, blockTs: number, nowSec: number): string | null`. It returns:
  - `null` when the block is in session, or when MarketCalendar's answer differs from the repo calendar's (amendment A9);
  - otherwise `"opens Mon 09:30 ET · in 1 d 23 h"`, or `"in 2 h 30 min"` when the open is later on the block's own ET day;
  - `"in under 1 min"` when under a minute is left.

  The time is floored to the minute and printed in `formatAge`'s two largest units.

- [ ] **Step 1: Write the failing test**

Create `web/test/live-countdown.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Hex } from "@/content/b20-nav";
import { countdownText } from "@/lib/live/countdown";
import type { LiveSnapshot } from "@/lib/live/snapshot";
import { sessionAt } from "@/lib/live/verdict";

const at = (iso: string) => Date.parse(iso) / 1000;
/** Fri 2026-11-20 16:43:08 UTC, 11:43 ET: in session. */
const FRI = at("2026-11-20T16:43:08Z");
/** Sat 2026-11-21 15:00 UTC, 10:00 ET. */
const SAT = at("2026-11-21T15:00:00Z");
/** Mon 2026-11-23 12:00 UTC, 07:00 ET: before the open. */
const MON = at("2026-11-23T12:00:00Z");
const CALENDAR: Hex = "0x00000000000000000000000000000000000000ca";

/** The countdown the strip shows for a block at `blockTs`, read from the repo calendar or with MarketCalendar's answer. */
function countdown(blockTs: number, nowSec: number, onchain?: boolean | null): string | null {
  const calendar: LiveSnapshot["calendar"] =
    onchain === undefined ? { source: "repo" } : { source: "onchain", address: CALENDAR, open: onchain };
  return countdownText(sessionAt({ timestamp: blockTs, calendar }), blockTs, nowSec);
}

describe("countdownText (spec 2026-11-23 section 6.1, amendment A9)", () => {
  it.each([
    ["a Saturday block read 14 s later", SAT, SAT + 14, "opens Mon 09:30 ET · in 1 d 23 h"],
    ["a block an hour later, read 14 s after it", SAT + 3600, SAT + 3614, "opens Mon 09:30 ET · in 1 d 22 h"],
    ["Thanksgiving", at("2026-11-26T15:00:00Z"), at("2026-11-26T15:00:00Z"), "opens Fri 09:30 ET · in 23 h 30 min"],
    ["after Friday's 13:00 ET early close", at("2026-11-27T18:00:00Z"), at("2026-11-27T18:00:00Z"), "opens Mon 09:30 ET · in 2 d 20 h"],
    ["Wednesday after the close, with Thanksgiving next", at("2026-11-25T21:00:00Z"), at("2026-11-25T21:00:00Z"), "opens Fri 09:30 ET · in 1 d 17 h"],
  ])("names the next open's day and time for %s", (_, blockTs, nowSec, text) => {
    expect(countdown(blockTs, nowSec)).toBe(text);
  });

  it.each([
    ["at 07:00 ET", MON, MON, "in 2 h 30 min"],
    ["61 s later", MON, MON + 61, "in 2 h 28 min"],
    ["30 s before the open", at("2026-11-23T14:29:30Z"), at("2026-11-23T14:29:30Z"), "in under 1 min"],
  ])("says only how long when the open is later the same ET day: %s", (_, blockTs, nowSec, text) => {
    expect(countdown(blockTs, nowSec)).toBe(text);
  });

  it("keeps one text through each minute: it changes once a minute, never every second", () => {
    expect(countdown(MON, MON + 1)).toBe("in 2 h 29 min");
    expect(countdown(MON, MON + 59)).toBe("in 2 h 29 min");
    expect(countdown(MON, MON + 60)).toBe("in 2 h 29 min");
    expect(countdown(MON, MON + 61)).toBe("in 2 h 28 min");
  });

  it.each([
    ["in session", FRI, undefined],
    ["when MarketCalendar cannot be read in the repo calendar's session", FRI, null],
    ["when MarketCalendar says closed and the repo calendar says open", FRI, false],
    ["when MarketCalendar says open and the repo calendar says closed", SAT, true],
  ])("shows no countdown %s", (_, blockTs, onchain) => {
    expect(countdown(blockTs, blockTs + 14, onchain)).toBeNull();
  });

  it("counts down when MarketCalendar agrees the NYSE is closed", () => {
    expect(countdown(SAT, SAT + 14, false)).toBe("opens Mon 09:30 ET · in 1 d 23 h");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-countdown.test.ts
```

Expected: the file fails with `Failed to resolve import "@/lib/live/countdown"`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/lib/live/countdown.ts`:

```ts
import { localTime, nextOpen, regularSession, WEEKDAY_NAMES } from "@/content/calendar";
import { clockLabel } from "@/content/format";
import { formatAge } from "./format";
import type { Session } from "./verdict";

/**
 * The countdown after session.detail on the strip's second row (spec 2026-11-23 section 6.1, amendment A9): when the
 * NYSE next opens after the block, and how long that is from the visitor's clock `nowSec`, floored to the minute.
 * - null in session, and null when MarketCalendar's answer differs from the repo calendar's (the row then says
 *   "MarketCalendar: open" or "MarketCalendar: closed", and the repo calendar cannot say when it opens);
 * - "in 2 h 30 min" when the open is later on the block's own ET day, which session.detail already names
 *   ("Monday · opens 09:30 ET");
 * - "opens Mon 09:30 ET · in 1 d 23 h" otherwise, and "in under 1 min" for the last minute.
 * Pass the clock as it stood at the reading (wallAtReadSec + ageMs / 1000), so HOLD, which freezes the age, freezes it.
 */
export function countdownText(session: Session, blockTs: number, nowSec: number): string | null {
  if (session.open || regularSession(blockTs).open) return null;
  let opensAt: number;
  try {
    opensAt = nextOpen(blockTs);
  } catch {
    return null;
  }
  const left = Math.max(0, opensAt - nowSec);
  const wait = left < 60 ? "under 1 min" : formatAge(Math.floor(left / 60) * 60);
  const open = localTime(opensAt);
  if (open.etDay === localTime(blockTs).etDay) return `in ${wait}`;
  const day = (WEEKDAY_NAMES[open.weekday] ?? "").slice(0, 3);
  return `opens ${day} ${clockLabel(open.minuteOfDay)} ET · in ${wait}`;
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-countdown.test.ts
```

Expected: `Tests  14 passed (14)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/calendar-next-open.test.ts test/calendar.test.ts test/live-format.test.ts test/live-countdown.test.ts
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
```

Expected: every file passes, and the typecheck exits 0.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-05.txt`:

```
feat(web): add countdownText, the next NYSE open at minute resolution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/lib/live/countdown.ts web/test/live-countdown.test.ts
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-05.txt"
```

---

### Task 6: The live strip in a Readout, and the scan line

**Files:**
- Create: `web/components/instrument/useScan.ts`
- Modify: `web/components/live/LiveStrip.tsx`, the whole file (the Task 2 version)
- Modify: `web/app/globals.css` (a new block before the global reduced-motion block)
- Test: `web/test/instrument-scan.test.tsx` and `web/test/instrument-live-readout.test.tsx`

**Interfaces:**
- Consumes, from P0:
  - `Readout({ reserve, className, ...rest })` and `ReadoutKeys({ children, className })`;
  - `Digits({ value: string; className? })` and `Ghost({ pattern, className? })`;
  - `Lamp({ state, on })` and `Meter({ value, limit, unit, on })`;
  - `liveAttrs(snapshot)`;
  - `prefersReducedMotion()` from `@/lib/motion/reduced-motion`;
  - the `lamp-on` keyframes.
- Consumes, from earlier P1 tasks:
  - `HoldKey` and `KEY_CLASS` (Task 3);
  - the chassis palettes (Task 4);
  - `countdownText` (Task 5);
  - `LiveSnapshotProvider`, `useLive` and `useLiveIfAny` (Task 2).
- Consumes, unchanged: `FACTS.basket.value` and `FACTS.mandate.value.maxPremiumBps`.
- Produces:
  - `SCAN_MS = 400`, `scanOnce(line: HTMLElement, travelPx: number): Animation | null`, and `useScan(box, line, key: number | null, held: boolean): void`.
  - `STRIP_RESERVE: string`, the Readout's fixed height per breakpoint. Task 13 calibrates it.
  - The strip's new DOM. The root is a `Readout` holding `data-live-strip`, `tabIndex={-1}` and the `useRetry` ref. Its children are, in order: the announcer `span`, one `p` of `span.block` rows, the `ReadoutKeys` `div`, and `noscript`.
  - The CSS classes `.readout-figure`, `.readout-digits`, `.readout-scan` and `.readout-lit`, and the keyframes `wght-settle`.

**Review Focus 3** is pinned here, through the `aria-label`, the ten Digits cells and the one exact "LIVE". `live.spec.ts` runs unchanged in Step 5.

- [ ] **Step 1: Write the failing tests**

Create `web/test/instrument-scan.test.tsx`:

```tsx
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCAN_MS, scanOnce, useScan } from "@/components/instrument/useScan";

/** An IntersectionObserver the test drives: fire() reports every target in or out of view. */
class FakeIO {
  static all: FakeIO[] = [];
  callback: IntersectionObserverCallback;
  targets: Element[] = [];
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  fire(isIntersecting: boolean) {
    const entries = this.targets.map((target) => ({ target, isIntersecting }) as IntersectionObserverEntry);
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

const animate = vi.fn(() => ({}) as Animation);

/** matchMedia answering `reduce` for the reduced-motion query, and Element.prototype.animate as a spy. */
function stubMotion(reduce: boolean, withAnimate = true) {
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: reduce, media, addEventListener() {}, removeEventListener() {} }));
  if (withAnimate) Element.prototype.animate = animate as unknown as Element["animate"];
}

let visibility: DocumentVisibilityState = "visible";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (document as { visibilityState?: unknown }).visibilityState;
  animate.mockClear();
  FakeIO.all = [];
  visibility = "visible";
});

function Probe({ k, held }: { k: number | null; held: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  useScan(box, line, k, held);
  return (
    <div ref={box}>
      <span ref={line} data-scan="" />
    </div>
  );
}

/** The probe with a 120 px window, its first reading (key 1000) shown, and the observer's first report given. */
function mount(onScreen: boolean) {
  const r = render(<Probe k={null} held={false} />);
  Object.defineProperty(r.container.firstElementChild!, "clientHeight", { configurable: true, value: 120 });
  r.rerender(<Probe k={1_000} held={false} />);
  const io = FakeIO.all[0];
  if (io) act(() => io.fire(onScreen));
  return r;
}

describe("scanOnce (spec 2026-11-23 section 8.3: scan, 400 ms, once per read)", () => {
  it("draws nothing under reduced motion", () => {
    stubMotion(true);
    expect(scanOnce(document.createElement("span"), 100)).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });

  it("draws nothing where Element.prototype.animate is missing", () => {
    stubMotion(false, false);
    expect(scanOnce(document.createElement("span"), 100)).toBeNull();
  });

  it("runs one linear pass down the window, visible only while it runs", () => {
    stubMotion(false);
    scanOnce(document.createElement("span"), 118);
    expect(SCAN_MS).toBe(400);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenCalledWith(
      [
        { transform: "translateY(0)", visibility: "visible" },
        { transform: "translateY(118px)", visibility: "visible" },
      ],
      { duration: SCAN_MS, easing: "linear" },
    );
  });
});

describe("useScan (spec section 8.1 rule 4: pause what nobody sees)", () => {
  it("scans once per new reading while on screen, never for the first reading", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    stubMotion(false);
    const r = mount(true);
    expect(animate).not.toHaveBeenCalled();
    r.rerender(<Probe k={31_000} held={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: "translateY(0)", visibility: "visible" },
      { transform: "translateY(118px)", visibility: "visible" },
    ]);
    r.rerender(<Probe k={31_000} held={false} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("stays still off screen, while held, and on a hidden tab", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    stubMotion(false);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    const r = mount(false);
    r.rerender(<Probe k={31_000} held={false} />);
    act(() => FakeIO.all[0]!.fire(true));
    r.rerender(<Probe k={61_000} held />);
    visibility = "hidden";
    r.rerender(<Probe k={91_000} held={false} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("runs nothing where IntersectionObserver is missing", () => {
    stubMotion(false);
    const r = mount(true);
    r.rerender(<Probe k={31_000} held={false} />);
    expect(FakeIO.all).toHaveLength(0);
    expect(animate).not.toHaveBeenCalled();
  });

  it("disconnects its observer when it unmounts", () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    stubMotion(false);
    mount(true).unmount();
    expect(FakeIO.all[0]!.disconnected).toBe(true);
  });
});
```

Create `web/test/instrument-live-readout.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { meterText } from "@/components/instrument/Meter";
import { LiveStrip, STRIP_RESERVE } from "@/components/live/LiveStrip";
import { FACTS } from "@/content/facts";
import { LIVE_RPCS } from "@/lib/live/rpc";
import { type Answer, advance, fakeReader, FRI, installLiveClocks, readingAt, SAT } from "./helpers/fake-reader";
import { passingBasket } from "./helpers/live";

installLiveClocks();

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const HOST = new URL(LIVE_RPCS[0]!).host;

/** The strip on its own provider, the visitor's clock at `wallSec`, the first read answered unless held. */
async function mount(first: Answer, wallSec: number, opts: { hold?: boolean } = {}) {
  vi.setSystemTime(wallSec * 1000);
  const fake = fakeReader(first);
  if (opts.hold) fake.hold();
  render(<LiveStrip reader={fake.reader} />);
  await advance(0);
  return fake;
}

const strip = () => document.querySelector<HTMLElement>("[data-live-strip]")!;
const rows = () => [...strip().querySelectorAll<HTMLElement>(":scope > p > span")];
const countdown = () => strip().querySelector("[data-countdown]");
const readAge = () => strip().querySelector("[data-read-age]")?.textContent;

describe("the live strip in its Readout (spec 2026-11-23 sections 3.5 and 6.1)", () => {
  it("keeps the strip's DOM: announcer, one <p> of three block rows, the bezel keys, then the noscript", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    const s = strip();
    expect(s).toHaveAttribute("data-readout");
    expect(s).toHaveAttribute("data-live-strip", "live");
    expect(s).toHaveAttribute("tabindex", "-1");
    expect([...s.children].map((c) => c.tagName)).toEqual(["SPAN", "P", "DIV", "NOSCRIPT"]);
    expect(s.children[2]).toHaveAttribute("data-readout-keys");
    expect(rows()).toHaveLength(3);
    for (const row of rows()) expect(row.className.split(" ")).toContain("block");
    expect(s.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(s.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("names the block link by its whole number, writes it in ten digit cells, and marks the reading live", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    const link = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(link).toHaveAttribute("href", "https://basescan.org/block/60013066");
    const digits = link.querySelector("[data-digits]")!;
    expect(digits.children).toHaveLength(10);
    expect(digits.textContent).toBe("60,013,066");
    expect(screen.getAllByText("LIVE", { exact: true })).toHaveLength(1);
    const p = strip().querySelector(":scope > p")!;
    expect(p).toHaveAttribute("data-live", "60013066");
    expect(p).toHaveAttribute("data-live-host", HOST);
    expect(p).toHaveAttribute("data-live-time", String(SAT));
  });

  it("counts down to the next open on a closed day, and HOLD freezes the countdown", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    expect(rows()[1]).toHaveTextContent("Saturday · NYSE closed · opens Mon 09:30 ET · in 1 d 23 h");
    expect(countdown()).toHaveTextContent("opens Mon 09:30 ET · in 1 d 23 h");
    const hold = screen.getByRole("button", { name: "Hold" });
    fireEvent.click(hold);
    await advance(3_600_000);
    expect(strip()).toHaveAttribute("data-live-strip", "live");
    expect(countdown()).toHaveTextContent("opens Mon 09:30 ET · in 1 d 23 h");
    fake.hold();
    fireEvent.click(hold);
    // Released: the held reading is an hour old, so it is stale, without a countdown, while the new read runs.
    expect(strip()).toHaveAttribute("data-live-strip", "stale");
    expect(countdown()).toBeNull();
    expect(rows()[1]).toHaveTextContent("Saturday · NYSE closed");
    fake.release({ timestamp: SAT + 3600 });
    await advance(0);
    expect(strip()).toHaveAttribute("data-live-strip", "live");
    expect(countdown()).toHaveTextContent("opens Mon 09:30 ET · in 1 d 22 h");
  });

  it("shows no countdown in session", async () => {
    await mount({ timestamp: FRI }, FRI + 14);
    expect(rows()[1]).toHaveTextContent("Friday · open until 16:00 ET");
    expect(countdown()).toBeNull();
  });

  it("lights a lamp and writes a premium meter for each basket token, from the reading and FACTS", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    const verdicts = readingAt(SAT).verdicts;
    const limit = FACTS.mandate.value.maxPremiumBps;
    for (const symbol of FACTS.basket.value) {
      const cell = strip().querySelector(`[data-basket-token="${symbol}"]`)!;
      expect(cell).toHaveTextContent(symbol);
      expect(cell.querySelector("[data-lamp]")).toHaveAttribute("data-lamp", "refuse");
      const v = verdicts.find((t) => t.symbol === symbol)!;
      const meter = cell.querySelector("[data-meter]");
      if (v.premiumBps === null) expect(cell).toHaveTextContent("premium not read");
      else expect(meter).toHaveTextContent(meterText(Number(v.premiumBps), limit, "bps"));
    }
    // The lamps print their word only: the one reason tag is the verdict line's.
    expect(strip().querySelectorAll("[data-reason-tag]")).toHaveLength(1);
  });

  it("lights every basket lamp PASS when the default mandate refuses none of them", async () => {
    await mount({ timestamp: FRI, edit: passingBasket }, FRI + 14);
    const lamps = [...strip().querySelectorAll("[data-basket-token] [data-lamp]")].map((l) => l.getAttribute("data-lamp"));
    expect(lamps).toEqual(["pass", "pass", "pass"]);
  });

  it("shows unlit ghost segments, and no lamp or key but HOLD, while the first read is in flight", async () => {
    await mount({ timestamp: SAT }, SAT + 14, { hold: true });
    expect(strip()).toHaveAttribute("data-live-strip", "reading");
    expect(strip().querySelector("[data-ghost]")).toHaveAttribute("data-ghost", "88,888,888");
    expect(rows()[0]).toHaveTextContent("Reading Base mainnet…");
    expect(strip().querySelector("[data-digits], [data-lamp], [data-read-age], [data-refresh-key]")).toBeNull();
    expect(screen.getByRole("button", { name: "Hold" })).toBeInTheDocument();
  });

  it("keeps HOLD in the error state, next to the line's Retry, with no Refresh", async () => {
    await mount("down", SAT + 14);
    expect(strip()).toHaveAttribute("data-live-strip", "error");
    expect(screen.getByRole("button", { name: "Hold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(strip().querySelector("[data-refresh-key], [data-read-age]")).toBeNull();
  });

  it("writes the read age and the RPC host on the bezel, says held while held, and Refresh reads at once", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    expect(readAge()).toBe(`read 0 s ago · ${HOST}`);
    await advance(5_000);
    expect(readAge()).toBe(`read 5 s ago · ${HOST}`);
    const hold = screen.getByRole("button", { name: "Hold" });
    fireEvent.click(hold);
    expect(readAge()).toBe(`held · ${HOST}`);
    fireEvent.click(hold);
    fake.hold();
    const refresh = strip().querySelector<HTMLButtonElement>("[data-refresh-key]")!;
    expect(refresh).toHaveTextContent("Refresh");
    fireEvent.click(refresh);
    expect(refresh).toHaveTextContent("Refreshing…");
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(refresh);
    expect(fake.multicalls()).toBe(2);
    fake.release({ timestamp: SAT });
    await advance(0);
    expect(refresh).toHaveTextContent("Refresh");
    expect(refresh).not.toHaveAttribute("aria-disabled");
    expect(readAge()).toBe(`read 0 s ago · ${HOST}`);
  });

  it("reserves one fixed height per breakpoint, never a min-height", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    expect(STRIP_RESERVE).toMatch(/^h-\[\d+px\] sm:h-\[\d+px\] min-\[62\.5rem\]:h-\[\d+px\] xl:h-\[\d+px\]$/);
    for (const cls of STRIP_RESERVE.split(" ")) expect(strip().className.split(" ")).toContain(cls);
    expect(strip().className).not.toMatch(/(^|\s)min-h-/);
  });

  it("draws the block number at readout size with a weight settle, and keeps the scan line hidden at rest", () => {
    expect(css).toMatch(
      /\.readout-figure\s*\{\s*font-size:\s*clamp\(26px, 2\.6vw, 38px\);\s*line-height:\s*1\.15;\s*letter-spacing:\s*-0\.02em;\s*font-weight:\s*560;\s*\}/,
    );
    expect(css).toMatch(/\.readout-digits\s*\{\s*animation:\s*wght-settle var\(--t-flip\) var\(--ease-instrument\) both;\s*\}/);
    expect(css).toMatch(/@keyframes wght-settle\s*\{\s*from\s*\{\s*font-weight:\s*300;\s*\}\s*\}/);
    expect(css).toMatch(/\.readout-scan\s*\{[^}]*position:\s*absolute;[^}]*height:\s*1px;[^}]*visibility:\s*hidden;[^}]*\}/);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-scan.test.tsx test/instrument-live-readout.test.tsx
```

Expected:
- `instrument-scan.test.tsx` fails with `Failed to resolve import "@/components/instrument/useScan"`.
- `instrument-live-readout.test.tsx` reports failing tests, for example `expected element to have attribute "data-readout"`. `STRIP_RESERVE` is not exported yet.

- [ ] **Step 3: Write the minimal implementation**

Create `web/components/instrument/useScan.ts`:

```ts
"use client";

import { type RefObject, useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/motion/reduced-motion";

/** How long the scan line takes to cross the window, ms (spec 2026-11-23 section 8.3). */
export const SCAN_MS = 400;

/**
 * One pass of the 1 px scan line down `travelPx`, with WAAPI: visible only while it runs, so it ends on its base style,
 * hidden. Nothing under reduced motion, or where Element.prototype.animate is missing.
 */
export function scanOnce(line: HTMLElement, travelPx: number): Animation | null {
  if (prefersReducedMotion() || typeof line.animate !== "function") return null;
  return line.animate(
    [
      { transform: "translateY(0)", visibility: "visible" },
      { transform: `translateY(${travelPx}px)`, visibility: "visible" },
    ],
    { duration: SCAN_MS, easing: "linear" },
  );
}

/**
 * Runs scanOnce down `box` each time `key` (the reading's readAtMs) moves from one reading to the next: never for the
 * first reading, and only while `box` is on screen, the tab is visible and the reading is not held (spec section 8.1,
 * rule 4). Where IntersectionObserver is missing, the box counts as off screen, so nothing runs.
 */
export function useScan(
  box: RefObject<HTMLElement | null>,
  line: RefObject<HTMLElement | null>,
  key: number | null,
  held: boolean,
): void {
  const onScreen = useRef(false);
  const isHeld = useRef(held);
  const last = useRef<number | null>(null);

  useEffect(() => {
    isHeld.current = held;
  }, [held]);

  useEffect(() => {
    const el = box.current;
    if (el === null || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) onScreen.current = e.isIntersecting;
    });
    io.observe(el);
    return () => {
      io.disconnect();
      onScreen.current = false;
    };
  }, [box]);

  useEffect(() => {
    const prev = last.current;
    last.current = key;
    if (prev === null || key === null || prev === key) return;
    const el = box.current;
    const ln = line.current;
    if (el === null || ln === null) return;
    if (!onScreen.current || isHeld.current || document.visibilityState !== "visible") return;
    scanOnce(ln, Math.max(0, el.clientHeight - 2));
  }, [key, box, line]);
}
```

Read `web/components/live/LiveStrip.tsx`, then replace the whole file with:

```tsx
"use client";

import { type MouseEvent, type RefObject, useRef } from "react";
import { Digits } from "@/components/instrument/Digits";
import { Ghost } from "@/components/instrument/Ghost";
import { HoldKey, KEY_CLASS } from "@/components/instrument/HoldKey";
import { Lamp } from "@/components/instrument/Lamp";
import { liveAttrs } from "@/components/instrument/Live";
import { Meter } from "@/components/instrument/Meter";
import { Readout, ReadoutKeys } from "@/components/instrument/Readout";
import { useScan } from "@/components/instrument/useScan";
import { NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import { countdownText } from "@/lib/live/countdown";
import type { LiveState, Reading } from "@/lib/live/freshness";
import { formatAge, formatBlock, formatEt, formatUtc } from "@/lib/live/format";
import type { LiveReader } from "@/lib/live/rpc";
import { BlockLink, FAILED, LiveAnnouncer, LivePill, NotLiveWhy, READING, ReadButton, Sep, useRetry } from "./LiveStatus";
import { LiveSnapshotProvider, type LiveSnapshotValue, useLive, useLiveIfAny } from "./LiveSnapshotProvider";
import { VerdictLine } from "./VerdictLine";

/** The unlit block number while the first read is in flight: the shape of a block in the 60 millions. */
const GHOST_BLOCK = "88,888,888";

/**
 * The Readout's fixed height per breakpoint (spec 2026-11-23 sections 3.5 and 6.2): the tallest frame of
 * e2e/instrument-states.spec.ts at that breakpoint's narrowest width (360, 640, 1000, and 1280 to 1920 px), plus 20 px,
 * rounded up to 4 px. Every state fits, so the lead never moves when a reading lands. 62.5rem (1000 px), where the
 * hero's grid takes two columns, is in rem so Tailwind sorts it between sm (40rem) and xl (80rem).
 */
export const STRIP_RESERVE = "h-[352px] sm:h-[232px] min-[62.5rem]:h-[296px] xl:h-[232px]";

function NowLink() {
  return (
    <a href="/now" className="whitespace-nowrap font-medium text-pass-lit">
      All {NAV_TOKENS.length} B20s <span aria-hidden="true">→</span>
    </a>
  );
}

/**
 * The three basket tokens on row 3: each one's lamp (PASS or REFUSE, what the default mandate does with a BUY) and its
 * pool premium on a meter scaled to FACTS.mandate.value.maxPremiumBps, with the number written. No reason tag: the
 * reasons are the verdict line's.
 */
function Basket({ reading }: { reading: Reading }) {
  const limit = FACTS.mandate.value.maxPremiumBps;
  return (
    <span data-basket="" className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-3">
      {FACTS.basket.value.map((symbol) => {
        const v = reading.verdicts.find((t) => t.symbol === symbol);
        return (
          <span key={symbol} data-basket-token={symbol} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[12px] font-medium text-lcd">{symbol}</span>
            <Lamp state={v === undefined ? "reading" : v.mandate === "OK" ? "pass" : "refuse"} on="chassis" />
            {v !== undefined && v.premiumBps !== null ? (
              <Meter value={Number(v.premiumBps)} limit={limit} unit="bps" on="chassis" />
            ) : (
              <span className="font-mono text-[11px] text-lcd-2">premium not read</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

interface BodyProps {
  state: LiveState;
  refreshing: boolean;
  onRetry: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** The strip's one <p>: its rows are block spans (spec 3.5). */
function Body({ state, refreshing, onRetry }: BodyProps) {
  switch (state.status) {
    case "reading":
      return (
        <p className="m-0">
          <span className="block">
            <Ghost pattern={GHOST_BLOCK} className="readout-figure mr-2" />
            {READING}
          </span>
        </p>
      );
    case "error":
      return (
        <p className="m-0">
          <span className="block">
            {FAILED}{" "}
            <ReadButton
              palette="chassis"
              refreshing={refreshing}
              onClick={onRetry}
              idle="Retry"
              busy="Retrying…"
              className="ml-1 h-6 px-2.5 text-[12px]"
            />
          </span>
        </p>
      );
    case "live": {
      const { snapshot, session, headline, wallAtReadSec } = state.reading;
      const block = formatBlock(snapshot.block);
      // The visitor's clock as it stood at this frame: HOLD freezes the age, so it freezes the countdown too.
      const countdown = countdownText(session, snapshot.timestamp, wallAtReadSec + state.ageMs / 1000);
      return (
        <p className="m-0" {...liveAttrs(snapshot)}>
          <span className="block">
            <LivePill live palette="chassis" />{" "}
            <BlockLink n={snapshot.block} label={`Base block ${block}`} palette="chassis">
              Base block <Digits value={block} className="readout-figure readout-digits" />
            </BlockLink>
            <Sep />
            <span className="whitespace-nowrap font-mono text-[12px]">
              {formatUtc(snapshot.timestamp)} · {formatEt(snapshot.timestamp)}
            </span>
          </span>
          <span className="block">
            <span>{session.detail}</span>
            {countdown === null ? null : (
              <>
                <Sep />
                <span data-countdown="" className="whitespace-nowrap">
                  {countdown}
                </span>
              </>
            )}
          </span>
          <span className="block">
            <VerdictLine headline={headline} tone="ink" palette="chassis" methodHref="/now#method" />
            <Sep />
            <NowLink />
            <Basket reading={state.reading} />
          </span>
        </p>
      );
    }
    case "stale":
    case "behind":
      return (
        <p className="m-0" {...liveAttrs(state.reading.snapshot)}>
          <span className="block">
            <LivePill live={false} palette="chassis" /> <NotLiveWhy state={state} palette="chassis" />
          </span>
          <span className="block text-lcd-2">{state.reading.session.detail}</span>
          <span className="block">
            <VerdictLine headline={state.reading.headline} tone="muted" palette="chassis" methodHref="/now#method" />
            <Sep />
            <NowLink />
          </span>
        </p>
      );
  }
}

interface KeysProps {
  state: LiveState;
  refreshing: boolean;
  hold: boolean;
  onRefresh: () => void;
  scanLine: RefObject<HTMLSpanElement | null>;
}

/**
 * The bottom bezel, outside the <p> (spec 6.1, amendment A7): the scan line, then the read age and the RPC host once
 * a reading is shown, then HOLD in every state, and Refresh once a reading is shown.
 */
function Keys({ state, refreshing, hold, onRefresh, scanLine }: KeysProps) {
  const shown = state.status === "reading" || state.status === "error" ? null : state;
  return (
    <ReadoutKeys className="mt-auto pt-2">
      <span ref={scanLine} aria-hidden="true" data-scan="" className="readout-scan" />
      {shown === null ? null : (
        <span data-read-age="">
          {hold ? "held" : `read ${formatAge(shown.ageMs / 1000)} ago`} · {new URL(shown.reading.snapshot.endpoint).host}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <HoldKey />
        {shown === null ? null : (
          <button
            type="button"
            data-refresh-key=""
            aria-disabled={refreshing || undefined}
            onClick={() => {
              if (!refreshing) onRefresh();
            }}
            className={KEY_CLASS}
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </span>
    </ReadoutKeys>
  );
}

/** The strip itself, on the page's one snapshot, in its chassis window. */
function Strip({ live }: { live: LiveSnapshotValue }) {
  const { state, refresh, refreshing, hold } = live;
  const { box, onRetry } = useRetry(state, refreshing, refresh);
  const scanLine = useRef<HTMLSpanElement>(null);
  const shown = state.status === "reading" || state.status === "error" ? null : state;
  useScan(box, scanLine, shown === null ? null : shown.reading.readAtMs, hold);

  return (
    <Readout
      ref={box}
      tabIndex={-1}
      data-live-strip={state.status}
      reserve={STRIP_RESERVE}
      className="relative flex flex-col text-[13px] leading-5"
    >
      <LiveAnnouncer state={state} />
      <Body state={state} refreshing={refreshing} onRetry={onRetry} />
      <Keys state={state} refreshing={refreshing} hold={hold} onRefresh={refresh} scanLine={scanLine} />
      <noscript>
        <p className="m-0">
          The live line needs JavaScript.{" "}
          <a href="/now" className="text-pass-lit">
            Right now on Base
          </a>{" "}
          explains what it reads.
        </p>
      </noscript>
    </Readout>
  );
}

/** A strip that made its own provider: it reads the snapshot from there. */
function SharedStrip() {
  return <Strip live={useLive()} />;
}

/**
 * The live Readout under the landing H1: the Base block this browser read, its NYSE session and the countdown to the
 * next open, what an agent under the default mandate would do with a BUY of each basket token, and the bezel keys. The
 * static HTML holds the reading state only; no chain value is ever baked in. Under a LiveSnapshotProvider it reads the
 * page's snapshot, and `reader` is not used; with none above it (a test that renders the Hero alone), it runs a
 * provider of its own with `reader`.
 */
export function LiveStrip({ reader }: { reader?: LiveReader }) {
  const live = useLiveIfAny();
  if (live !== null) return <Strip live={live} />;
  return (
    <LiveSnapshotProvider reader={reader}>
      <SharedStrip />
    </LiveSnapshotProvider>
  );
}
```

In `web/app/globals.css`, insert this block immediately before the global reduced-motion block:

```css
/* The live strip's Readout (components/live/LiveStrip.tsx). The block number at readout size, its weight settling from
   300 to 560 when a reading lands; the scan line, hidden at rest (useScan shows it for one 400 ms pass); the LIVE
   pill's lamp; and focus rings in pass-lit on the dark window. */
@layer components {
  .readout-figure {
    font-size: clamp(26px, 2.6vw, 38px);
    line-height: 1.15;
    letter-spacing: -0.02em;
    font-weight: 560;
  }
  .readout-digits {
    animation: wght-settle var(--t-flip) var(--ease-instrument) both;
  }
  .readout-scan {
    position: absolute;
    top: 0;
    left: 14px;
    right: 14px;
    height: 1px;
    background: var(--color-pass-lit);
    visibility: hidden;
    pointer-events: none;
  }
  .readout-lit {
    --lamp: var(--color-lamp-pass);
    animation: lamp-on var(--t-flip) var(--ease-instrument);
  }
  [data-readout] :focus-visible {
    outline-color: var(--color-pass-lit);
  }
}
@keyframes wght-settle {
  from {
    font-weight: 300;
  }
}
```

- [ ] **Step 4: Run them and see them pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-scan.test.tsx test/instrument-live-readout.test.tsx
```

Expected: `Tests  18 passed (18)`, 7 in `instrument-scan.test.tsx` and 11 in `instrument-live-readout.test.tsx`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/live-strip.test.tsx test/live-snapshot-provider.test.tsx test/top.test.tsx test/page.test.tsx test/instrument-modules.test.ts test/instrument-contrast.test.ts
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/live.spec.ts e2e/smoke.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. `live-strip.test.tsx` is unchanged and still pins:
  - the strings;
  - the link names "Base block 60,013,066" and "60,013,066";
  - one `aria-live`;
  - focus moving to the strip after a Retry that works.
- The typecheck, the build and `check:out` exit 0. The export holds the reading state only.
- `netstat` prints nothing.
- Every `live.spec.ts` and `smoke.spec.ts` test passes on Chromium. That includes the four "the landing does not move" tests (the fixed height keeps the lead within 1 px) and smoke's animation wait, which the 400 ms scan and the 240 ms settle end well inside.

If a `live.spec.ts` test fails on the block link's name or on "LIVE", stop and report: that is Review Focus 3.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-06.txt`:

```
feat(web): render the live strip in a chassis Readout with digits, countdown, basket lamps and bezel keys

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/instrument/useScan.ts web/components/live/LiveStrip.tsx web/app/globals.css web/test/instrument-scan.test.tsx web/test/instrument-live-readout.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-06.txt"
```

---

### Task 7: A verdict-first DecisionEngine, and the Balance intro

**Files:**
- Modify: `web/components/DecisionEngine.tsx`, the whole file (106 lines). The changes are to the imports (lines 1-7), the state and `choose` (16-19), the plate (26-28), the intent row (52-58), and the order of the list (60-82) and the status region (84-103).
- Modify: `web/app/globals.css` (a new block before the global reduced-motion block)
- Test: `web/test/instrument-engine-balance.test.tsx`

**Interfaces:**
- Consumes:
  - `Balance({ verdict, checks, size?, className? })` and `BALANCE` (P0 Task 11);
  - `SourcePlate({ kind, on?, children, ...rest })` (P0 Task 9);
  - `factAttr("forkBlock")` (P0 Task 13);
  - `WEIGH_MS` from `@/lib/motion/spring`;
  - `MOMENTS`, `MOMENT_ORDER`, `MomentId` and `CheckMark` from `@/content/engine`, unchanged.
- Produces:
  - `export type Tilt = "level" | "refused"` and `export function tiltFrom(prev: MomentId | null, next: MomentId): Tilt`.
  - The card's order: the header (plate and toggle), the weighing row (the `data-weighing` node keyed by `run`, holding the Balance and its CSS label, then the intent column), the `role="status"` region, then the "Mandate checks" list.
  - The CSS: `.weighing`, `--tilt-from`, the keyframes `beam-tip`, `pan-feather`, `pan-order` and `tick-lit`, and `.balance-label::before`.

**Review Focus 5** is pinned here.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-engine-balance.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionEngine, tiltFrom } from "@/components/DecisionEngine";
import { MOMENTS } from "@/content/engine";
import { WEIGH_MS } from "@/lib/motion/spring";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function setup() {
  const { container } = render(<DecisionEngine />);
  return {
    container,
    status: () => screen.getByRole("status"),
    list: () => screen.getByRole("list", { name: "Mandate checks" }),
    svg: () => container.querySelector<SVGSVGElement>("svg.balance")!,
    weighing: () => container.querySelector<HTMLElement>("[data-weighing]")!,
    sat: () => screen.getByRole("button", { name: MOMENTS.sat.toggleLabel }),
    thu: () => screen.getByRole("button", { name: MOMENTS.thu.toggleLabel }),
  };
}

/** Whether `b` comes after `a` in the document. */
const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("the engine card, verdict first (spec 2026-11-23 sections 3.6 and 6.1)", () => {
  it("weighs first: the Balance, then the verdict, then the nine checks, with the Balance outside both", () => {
    const ui = setup();
    const svg = ui.svg();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-verdict", "refused");
    expect(follows(svg, ui.status())).toBe(true);
    expect(follows(ui.status(), ui.list())).toBe(true);
    expect(svg.closest('[role="status"]')).toBeNull();
    expect(svg.closest("ol")).toBeNull();
    const ticks = [...svg.querySelectorAll("[data-tick]")].map((t) => t.getAttribute("data-tick"));
    expect(ticks).toEqual(within(ui.list()).getAllByRole("listitem").map((li) => li.getAttribute("data-mark")));
    expect(ui.container.querySelectorAll("li")).toHaveLength(9);
    expect(ui.status().firstElementChild).toHaveAttribute("data-verdict", "refused");
  });

  it("keeps the pinned texts as HTML outside the Balance, and labels the order pan from CSS", () => {
    const ui = setup();
    const plate = ui.container.querySelector('[data-plate="replay"]')!;
    expect(screen.getByText("replay · Base fork · block 53,551,627")).toBe(plate);
    expect(plate).toHaveAttribute("data-fact", "forkBlock");
    expect(screen.getByText("INTENT · SCRIPTED FORK RUN")).toBeInTheDocument();
    expect(screen.getByText(MOMENTS.sat.intent)).toBeInTheDocument();
    const label = ui.weighing().querySelector(".balance-label")!;
    expect(label).toHaveAttribute("data-label", MOMENTS.sat.intent);
    expect(label).toHaveAttribute("aria-hidden", "true");
    expect(label.textContent).toBe("");
    expect(css).toMatch(/\.balance-label::before\s*\{\s*content:\s*attr\(data-label\);\s*white-space:\s*nowrap;\s*\}/);
  });

  it("remounts the weighing on every choice and starts the beam where the last moment left it", () => {
    const ui = setup();
    const nodes = [ui.weighing()];
    const tilts = [ui.weighing().getAttribute("data-tilt-from")];
    const verdicts = [ui.svg().getAttribute("data-verdict")];
    for (const press of [ui.thu, ui.thu, ui.sat, ui.thu]) {
      fireEvent.click(press());
      nodes.push(ui.weighing());
      tilts.push(ui.weighing().getAttribute("data-tilt-from"));
      verdicts.push(ui.svg().getAttribute("data-verdict"));
    }
    expect(new Set(nodes).size).toBe(5);
    expect(tilts).toEqual(["level", "refused", "level", "level", "refused"]);
    expect(verdicts).toEqual(["refused", "allowed", "allowed", "refused", "allowed"]);
  });

  it("tilts from level on first paint and on a replay, and from the last moment's angle otherwise", () => {
    expect(tiltFrom(null, "sat")).toBe("level");
    expect(tiltFrom("sat", "sat")).toBe("level");
    expect(tiltFrom("thu", "thu")).toBe("level");
    expect(tiltFrom("sat", "thu")).toBe("refused");
    expect(tiltFrom("thu", "sat")).toBe("level");
  });

  it("holds the final frame in the static HTML: the refused beam and its ticks, with a level start", () => {
    const doc = new DOMParser().parseFromString(renderToString(<DecisionEngine />), "text/html");
    const svg = doc.querySelector("svg.balance")!;
    expect(svg.getAttribute("data-verdict")).toBe("refused");
    expect(svg.closest("[data-weighing]")!.getAttribute("data-tilt-from")).toBe("level");
    expect([...svg.querySelectorAll("[data-tick]")].map((t) => t.getAttribute("data-tick"))).toEqual(
      MOMENTS.sat.checks.map((c) => c.mark),
    );
  });

  it("ends the intro inside 2.2 s: the ticks on the rows' schedule, the beam from 620 ms on the needle spring", () => {
    const ui = setup();
    const rowDelays = within(ui.list())
      .getAllByRole("listitem")
      .map((li) => Math.round(Number.parseFloat(li.style.animationDelay) * 1000));
    const tickDelays = [...css.matchAll(/\.weighing \.balance-tick:nth-child\((\d+)\)\s*\{\s*animation-delay:\s*(\d+)ms;\s*\}/g)].map(
      ([, n, ms]) => [Number(n), Number(ms)],
    );
    expect(tickDelays).toEqual(rowDelays.map((ms, i) => [i + 2, ms]));
    expect(css).toMatch(/\.weighing \.balance-tick\s*\{\s*animation:\s*tick-lit var\(--t-tick\) var\(--ease-instrument\) both;\s*\}/);
    expect(css).toMatch(/\.weighing \.balance-beam\s*\{\s*animation:\s*beam-tip var\(--t-weigh\) var\(--ease-needle\) 620ms both;\s*\}/);
    expect(css).toMatch(
      /\.weighing \.balance-pan\[data-pan="feather"\]\s*\{\s*animation:\s*pan-feather var\(--t-weigh\) var\(--ease-needle\) 620ms both;\s*\}/,
    );
    expect(css).toMatch(
      /\.weighing \.balance-pan\[data-pan="order"\]\s*\{\s*animation:\s*pan-order var\(--t-weigh\) var\(--ease-needle\) 620ms both;\s*\}/,
    );
    expect(css).toMatch(/@keyframes beam-tip\s*\{\s*from\s*\{\s*rotate:\s*var\(--tilt-from\);\s*\}\s*\}/);
    expect(css).toMatch(/\.weighing\[data-tilt-from="refused"\]\s*\{\s*--tilt-from:\s*-6deg;\s*\}/);
    expect(css).toContain("--t-weigh: 600ms;");
    expect(css).toContain("--t-tick: 120ms;");
    const rowMs = Number(/\.anim-row\s*\{\s*animation:\s*row-in (\d+)ms /.exec(css)![1]);
    const stamp = /\.anim-stamp\s*\{\s*animation:\s*stamp (\d+)ms cubic-bezier\([^)]*\) ([\d.]+)s both;\s*\}/.exec(css)!;
    const lastRow = Math.max(...rowDelays);
    const weighing = Math.max(620 + WEIGH_MS, lastRow + 120);
    expect(weighing).toBe(1520);
    const card = Math.max(weighing, lastRow + rowMs, Number(stamp[2]) * 1000 + Number(stamp[1]));
    expect(card).toBe(2150);
    expect(card).toBeLessThanOrEqual(2200);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-engine-balance.test.tsx
```

Expected: `Tests  6 failed (6)`. There is no Balance, no plate and no CSS yet, and `tiltFrom` is undefined.

- [ ] **Step 3: Write the minimal implementation**

Read `web/components/DecisionEngine.tsx`, then replace the whole file with:

```tsx
"use client";

import { useState } from "react";
import { Balance } from "@/components/instrument/Balance";
import { factAttr } from "@/components/instrument/Fig";
import { SourcePlate } from "@/components/instrument/SourcePlate";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { type CheckMark, MOMENT_ORDER, type MomentId, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";

const MARK_STYLE: Record<CheckMark, string> = {
  PASS: "bg-accent-tint text-accent",
  FAIL: "bg-refuse text-white",
  SKIP: "bg-line-soft text-ink-2",
};

/** Where the beam's intro starts: level, or at the refused angle (BALANCE.refusedDeg). */
export type Tilt = "level" | "refused";

const tiltOf = (id: MomentId): Tilt => (MOMENTS[id].allowed ? "level" : "refused");

/**
 * The angle the beam's intro starts from when the visitor moves from `prev` to `next`: where `prev` left the beam, so
 * Sat → Thu swings level from -6° and Thu → Sat tips from level. The first paint (no `prev`) and a replay of the same
 * moment start level, so the beam tips again (spec 2026-11-23 section 6.1).
 */
export function tiltFrom(prev: MomentId | null, next: MomentId): Tilt {
  return prev === null || prev === next ? "level" : tiltOf(prev);
}

export function DecisionEngine() {
  const [state, setState] = useState<{ moment: MomentId; run: number; from: Tilt }>({ moment: "sat", run: 0, from: "level" });
  const moment = MOMENTS[state.moment];
  // Every click bumps `run`, which remounts the weighing, the rows and the verdict card so their animations replay.
  const choose = (id: MomentId) => setState((s) => ({ moment: id, run: s.run + 1, from: tiltFrom(s.moment, id) }));

  return (
    <div className="card overflow-hidden shadow-[0_1px_0_var(--color-line),0_30px_80px_-30px_color-mix(in_srgb,var(--color-ink)_28%,transparent)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-head px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold">DECISION ENGINE</span>
          <SourcePlate kind="replay" data-fact={factAttr("forkBlock")}>
            {`replay · Base fork · block ${formatInt(FACTS.forkBlock.value)}`}
          </SourcePlate>
        </div>
        <div role="group" aria-label="Choose a moment" className="flex rounded-full bg-line-soft p-[3px]">
          {MOMENT_ORDER.map((id) => {
            const on = state.moment === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => choose(id)}
                className={`min-h-9 cursor-pointer rounded-full border-0 px-3.5 py-2 text-xs font-medium ${
                  on
                    ? "bg-white text-ink shadow-[0_1px_2px_color-mix(in_srgb,var(--color-ink)_12%,transparent)]"
                    : "bg-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {MOMENTS[id].toggleLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* The weighing: the Balance and the order it weighs. The Balance is aria-hidden; the words are in the HTML. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 pt-5">
        <div
          key={`weighing-${state.run}`}
          data-weighing=""
          data-tilt-from={state.from}
          className="weighing flex shrink-0 flex-col items-center gap-1"
        >
          <Balance verdict={moment.allowed ? "allowed" : "refused"} checks={moment.checks.map((c) => c.mark)} />
          <span aria-hidden="true" data-label={moment.intent} className="balance-label font-mono text-[10px] text-label" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-ink-2">INTENT · SCRIPTED FORK RUN</span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">{moment.intent}</span>
          <span className="font-mono text-xs text-ink-2">{moment.when}</span>
        </div>
      </div>

      {/* The live region itself never remounts; only its child does. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="mx-3 mt-4">
        <div
          key={`verdict-${state.run}`}
          data-verdict={moment.allowed ? "allowed" : "refused"}
          data-reason={moment.reason}
          className={`anim-stamp flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-[18px] py-4 text-white ${
            moment.allowed ? "bg-accent" : "bg-ink"
          }`}
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] opacity-80">VAULT DECISION</span>
            <span className="text-[26px] font-semibold tracking-[-0.03em]">{moment.allowed ? "Allowed" : "Refused"}</span>
          </div>
          <div className="ml-auto flex flex-col gap-1.5 text-right">
            <ReasonTag code={moment.reason} tone="verdict" layout="stacked" />
            <span className="font-mono text-[11px] opacity-80">{moment.outcome}</span>
          </div>
        </div>
      </div>

      {/* The grounds: nine channel rows of 36 px. */}
      <ol key={`checks-${state.run}`} aria-label="Mandate checks" className="m-0 list-none px-3 pb-3 pt-3">
        {moment.checks.map((c, i) => (
          <li
            key={c.label}
            data-mark={c.mark}
            style={{ animationDelay: `${(0.12 + 0.16 * i).toFixed(2)}s` }}
            className={`anim-row grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-3 rounded-[10px] px-2.5 py-2 ${
              c.mark === "FAIL" ? "bg-refuse-tint" : ""
            }`}
          >
            <span aria-hidden="true" className="font-mono text-[11px] text-ink-2">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className={`text-sm font-medium ${c.mark === "SKIP" ? "text-ink-2" : ""}`}>{c.label}</span>
              <span className="font-mono text-xs text-ink-2">{c.detail}</span>
            </span>
            <span className={`rounded-md py-1 text-center font-mono text-[11px] font-semibold ${MARK_STYLE[c.mark]}`}>
              {c.mark}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

In `web/app/globals.css`, insert this block immediately before the global reduced-motion block:

```css
/* The engine card's weighing intro (components/DecisionEngine.tsx). It replays on every choice, because the weighing
   node is keyed by run, and starts where the visitor's last moment left the beam (data-tilt-from). The ticks light on
   the rows' schedule (120 + 160·i ms) and the beam swings from 620 ms on the needle spring, so the weighing ends by
   1.52 s and the card's whole intro, with the verdict stamp, by 2.15 s: inside section 8.1's 2.2 s. The base style is
   the final frame, so the static HTML and reduced motion show the truth. */
@layer components {
  .weighing {
    --tilt-from: 0deg;
  }
  .weighing[data-tilt-from="refused"] {
    --tilt-from: -6deg;
  }
  .weighing .balance-beam {
    animation: beam-tip var(--t-weigh) var(--ease-needle) 620ms both;
  }
  .weighing .balance-pan[data-pan="feather"] {
    animation: pan-feather var(--t-weigh) var(--ease-needle) 620ms both;
  }
  .weighing .balance-pan[data-pan="order"] {
    animation: pan-order var(--t-weigh) var(--ease-needle) 620ms both;
  }
  .weighing .balance-tick {
    animation: tick-lit var(--t-tick) var(--ease-instrument) both;
  }
  .weighing .balance-tick:nth-child(2) {
    animation-delay: 120ms;
  }
  .weighing .balance-tick:nth-child(3) {
    animation-delay: 280ms;
  }
  .weighing .balance-tick:nth-child(4) {
    animation-delay: 440ms;
  }
  .weighing .balance-tick:nth-child(5) {
    animation-delay: 600ms;
  }
  .weighing .balance-tick:nth-child(6) {
    animation-delay: 760ms;
  }
  .weighing .balance-tick:nth-child(7) {
    animation-delay: 920ms;
  }
  .weighing .balance-tick:nth-child(8) {
    animation-delay: 1080ms;
  }
  .weighing .balance-tick:nth-child(9) {
    animation-delay: 1240ms;
  }
  .weighing .balance-tick:nth-child(10) {
    animation-delay: 1400ms;
  }
  .balance-label::before {
    content: attr(data-label);
    white-space: nowrap;
  }
}
@keyframes beam-tip {
  from {
    rotate: var(--tilt-from);
  }
}
@keyframes pan-feather {
  from {
    translate: calc(8px * (1 - cos(var(--tilt-from)))) calc(-8px * sin(var(--tilt-from)));
  }
}
@keyframes pan-order {
  from {
    translate: calc(-8px * (1 - cos(var(--tilt-from)))) calc(8px * sin(var(--tilt-from)));
  }
}
@keyframes tick-lit {
  from {
    stroke: var(--color-tick);
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-engine-balance.test.tsx
```

Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/decision-engine.test.tsx test/top.test.tsx test/page.test.tsx test/instrument-balance.test.tsx test/tokens.test.ts test/instrument-engine-balance.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/smoke.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. `decision-engine.test.tsx` is unchanged and still pins:
  - the plate's lower-case text and the INTENT line;
  - the verdict's `data-verdict` then `data-reason`, on the status region's first child;
  - the order of the verdict's texts;
  - a new list on every replay.
- The typecheck, the build and `check:out` exit 0. `check:out` finds the Saturday verdict right after `role="status"`.
- `netstat` prints nothing.
- Every `smoke.spec.ts` test passes on Chromium, including:
  - the animation wait after Thu, since every finite animation ends;
  - "reduced motion shows the final state at once", which still collects exactly 10 elements;
  - the verdict's right edges.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-07.txt`:

```
feat(web): weigh first in the engine card, with the Balance and its CSS intro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/DecisionEngine.tsx web/app/globals.css web/test/instrument-engine-balance.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-07.txt"
```

---

### Task 8: The hero: the H1 and H2 scale, the ruler, the CTAs and the spec plate

**Files:**
- Modify: `web/components/sections/Hero.tsx`, the whole file (51 lines)
- Modify: `web/app/globals.css`, the body of the `.h2` rule (lines 79-85 at `66bd0d0`; find it with `grep -n "^  .h2 {" app/globals.css`)
- Test: `web/test/instrument-hero.test.tsx`

**Interfaces:**
- Consumes:
  - `Ruler({ className })` (P0 Task 10);
  - `Fig({ k, as, children, className })` and `FactKey` (P0 Task 13);
  - `LiveStrip` (Task 6) and `DecisionEngine` (Task 7);
  - `FACTS` and `SITE`, unchanged.
- Produces:
  - `#top`, with the ruler as its first child and no `.grid-bg`;
  - the H1 at the 9.1 scale;
  - the two CTAs, each with `data-hero-cta`, which Task 10's ThumbBar observes;
  - the spec plate, where each `dd` carries `data-fact`;
  - `.h2` at the 9.1 scale.

  The texts `top.test.tsx` pins are unchanged: the H1, the lead, the three stats (label then value), both CTA links and the "Choose a moment" group.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-hero.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "@/components/sections/Hero";
import { FACTS } from "@/content/facts";
import { SITE } from "@/lib/site";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const hero = () => document.getElementById("top")!;
const classes = (el: Element) => el.getAttribute("class")!.split(" ");

describe("the hero (spec 2026-11-23 sections 6.1, 6.2 and 9.1)", () => {
  it("draws the tick ruler where the masked grid was", () => {
    render(<Hero />);
    const ruler = hero().querySelector(":scope > [data-ruler]");
    expect(ruler).not.toBeNull();
    expect(ruler).toHaveAttribute("aria-hidden", "true");
    expect(hero().querySelector(".grid-bg")).toBeNull();
    expect(hero().querySelector(".hero-glow")).not.toBeNull();
  });

  it("sets the H1 at clamp(44px,5.4vw,78px), line-height .96 and -0.055em, with its words unchanged", () => {
    render(<Hero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(classes(h1)).toEqual(
      expect.arrayContaining(["text-[clamp(44px,5.4vw,78px)]", "leading-[0.96]", "tracking-[-0.055em]", "font-semibold"]),
    );
    expect(h1).toHaveTextContent("The AI agent that knows when not to trade.");
  });

  it("puts both CTAs right after the lead: 52 px and stacked on phones, 44 px in a row from sm", () => {
    render(<Hero />);
    const ctas = [...hero().querySelectorAll<HTMLAnchorElement>("[data-hero-cta]")];
    expect(ctas.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Verify it in 5 minutes", SITE.quickstartUrl],
      ["Try to make it say no", "#try"],
    ]);
    for (const a of ctas) expect(classes(a)).toEqual(expect.arrayContaining(["min-h-[52px]", "sm:min-h-11", "justify-center"]));
    const group = ctas[0]!.parentElement!;
    expect(classes(group)).toEqual(expect.arrayContaining(["flex", "flex-col", "sm:flex-row"]));
    const lead = group.previousElementSibling!;
    expect(lead.tagName).toBe("P");
    expect(lead).toHaveTextContent(SITE.description);
    expect(lead.previousElementSibling).toHaveAttribute("data-live-strip");
  });

  it("engraves the spec plate's labels and marks each figure with the fact it comes from", () => {
    render(<Hero />);
    const plate = [
      ["CHECKS PER TRADE", "checksPerTrade", String(FACTS.checksPerTrade.value)],
      ["TYPED REFUSALS", "refusalCount", String(FACTS.refusalCount.value)],
      ["RULE TIMELOCK", "timelockHours", `${FACTS.timelockHours.value}h`],
    ] as const;
    for (const [label, fact, value] of plate) {
      const dt = screen.getByText(label);
      expect(dt.tagName).toBe("DT");
      expect(classes(dt)).toEqual(expect.arrayContaining(["font-mono", "text-[11px]", "tracking-[0.12em]", "text-label"]));
      const dd = dt.nextElementSibling!;
      expect(dd.tagName).toBe("DD");
      expect(dd).toHaveAttribute("data-fact", fact);
      expect(dd.textContent).toBe(value);
    }
  });

  it("sets .h2 at clamp(32px, 3.6vw, 52px) and -0.045em, balanced", () => {
    expect(css).toMatch(
      /\.h2\s*\{\s*margin:\s*0;\s*font-size:\s*clamp\(32px, 3\.6vw, 52px\);\s*line-height:\s*1\.02;\s*letter-spacing:\s*-0\.045em;\s*font-weight:\s*600;\s*text-wrap:\s*balance;\s*\}/,
    );
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-hero.test.tsx
```

Expected: `Tests  5 failed (5)`. There is no ruler, the H1 classes are the old ones, there is no `data-hero-cta` and no `data-fact`, and `.h2` is the old rule.

- [ ] **Step 3: Write the minimal implementation**

Read `web/components/sections/Hero.tsx`, then replace the whole file with:

```tsx
import { DecisionEngine } from "@/components/DecisionEngine";
import { type FactKey, Fig } from "@/components/instrument/Fig";
import { Ruler } from "@/components/instrument/Ruler";
import { LiveStrip } from "@/components/live/LiveStrip";
import { FACTS } from "@/content/facts";
import { SITE } from "@/lib/site";

/** The spec plate: the pinned labels (spec 2026-11-23 section 3.1), each figure marked with the fact it comes from. */
const SPECS: readonly { label: string; fact: FactKey; value: string; pad: string }[] = [
  { label: "CHECKS PER TRADE", fact: "checksPerTrade", value: String(FACTS.checksPerTrade.value), pad: "pr-4" },
  { label: "TYPED REFUSALS", fact: "refusalCount", value: String(FACTS.refusalCount.value), pad: "border-l border-line px-4" },
  { label: "RULE TIMELOCK", fact: "timelockHours", value: `${FACTS.timelockHours.value}h`, pad: "border-l border-line pl-4" },
];

/**
 * The landing's first screen (spec sections 6.1 and 6.2): a tick ruler, the H1, the live Readout, the lead, both CTAs
 * above the fold at 1440x900, and the spec plate; the engine card weighs on the right.
 */
export function Hero() {
  return (
    <header id="top" className="relative overflow-hidden">
      <Ruler className="absolute inset-x-0 top-0" />
      <div aria-hidden="true" className="hero-glow absolute -right-[10%] -top-[10%] h-[120%] w-3/5" />
      <div className="wrap relative grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-10 pb-16 pt-8 sm:pb-24 sm:pt-10 md:gap-14">
        <div className="flex flex-col gap-5">
          <span className="inline-flex items-center gap-2.5 self-start rounded-full border border-line bg-white py-[7px] pl-2 pr-3.5 text-[13px] text-ink-2">
            <span className="rounded-full bg-accent-tint px-2 py-[3px] font-mono text-[11px] font-semibold text-accent">
              AGENTIC
            </span>
            An AI treasury for tokenized stocks on Base
          </span>
          <h1 className="m-0 text-[clamp(44px,5.4vw,78px)] font-semibold leading-[0.96] tracking-[-0.055em]">
            The AI agent that knows <span className="text-accent">when not to trade.</span>
          </h1>
          <LiveStrip />
          <p className="lead max-w-[31em] text-[17px] leading-[1.55] sm:text-[19px]">{SITE.description}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <a data-hero-cta="" className="pill-dark min-h-[52px] justify-center sm:min-h-11" href={SITE.quickstartUrl}>
              Verify it in 5 minutes
            </a>
            <a data-hero-cta="" className="pill-line min-h-[52px] justify-center sm:min-h-11" href="#try">
              Try to make it say no
            </a>
          </div>
          <dl className="m-0 mt-2 grid max-w-[560px] grid-cols-3 border-t border-line">
            {SPECS.map((s) => (
              <div key={s.label} className={`pt-[18px] ${s.pad}`}>
                <dt className="font-mono text-[11px] font-medium tracking-[0.12em] text-label">{s.label}</dt>
                <Fig k={s.fact} as="dd" className="m-0 mt-1.5 text-4xl font-semibold tracking-[-0.04em]">
                  {s.value}
                </Fig>
              </div>
            ))}
          </dl>
        </div>
        <DecisionEngine />
      </div>
    </header>
  );
}
```

In `web/app/globals.css`, replace the `.h2` rule. With Edit, set old_string to:

```css
  .h2 {
    margin: 0;
    font-size: clamp(40px, 4.6vw, 64px);
    line-height: 1.02;
    letter-spacing: -0.04em;
    font-weight: 600;
  }
```

and new_string to:

```css
  .h2 {
    margin: 0;
    font-size: clamp(32px, 3.6vw, 52px);
    line-height: 1.02;
    letter-spacing: -0.045em;
    font-weight: 600;
    text-wrap: balance;
  }
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-hero.test.tsx
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/top.test.tsx test/page.test.tsx test/instrument-fig-live.test.tsx test/tokens.test.ts test/instrument-hero.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/smoke.spec.ts e2e/live.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. `top.test.tsx` is unchanged: it pins the three stats as label then value, both CTAs, and `#top`.
- The typecheck, the build and `check:out` exit 0.
- `netstat` prints nothing.
- Every `smoke.spec.ts` and `live.spec.ts` test passes on Chromium. That includes no page scroll at 360 px, and the lead moving 1 px or less when a reading lands.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-08.txt`:

```
feat(web): set the hero on the instrument scale with a tick ruler, CTAs above the fold and the spec plate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/sections/Hero.tsx web/app/globals.css web/test/instrument-hero.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-08.txt"
```

---

### Task 9: The 120 ms colour transitions

**Files:**
- Modify: `web/components/Simulator.tsx`, one class string (line 57 at `66bd0d0`). Its unique anchor is ``className={`min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] font-medium ${``.
- Modify: `web/components/gap/TokenTabs.tsx`, one class string (line 72 at `66bd0d0`). Its unique anchor is `cursor-pointer transition-colors`.
- Modify: `web/app/globals.css` (a new block before the global reduced-motion block)
- Test: `web/test/instrument-colour-transitions.test.ts`

**Interfaces:**
- Consumes: `--t-tick: 120ms` and `--ease-instrument` (P0 Task 1).
- Produces: the class `.tick-colour`. It, `.navlink`, `.pill-dark` and `.pill-line` transition `color`, `background-color` and `border-color` over `--t-tick` (spec 8.3).

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-colour-transitions.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const css = read("app/globals.css");

describe("the 120 ms colour tick (spec 2026-11-23 section 8.3)", () => {
  it("moves nav links and pills off the snap, onto --t-tick and the instrument curve", () => {
    expect(css).toMatch(
      /\.tick-colour,\s*\.navlink,\s*\.pill-dark,\s*\.pill-line\s*\{\s*transition-property:\s*color, background-color, border-color;\s*transition-duration:\s*var\(--t-tick\);\s*transition-timing-function:\s*var\(--ease-instrument\);\s*\}/,
    );
    expect(css).toContain("--t-tick: 120ms;");
  });

  it("gives the simulator's chips the tick", () => {
    expect(read("components/Simulator.tsx")).toContain(
      "className={`tick-colour min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] font-medium ${",
    );
  });

  it("swaps the /gap-index pills' default 150 ms transition for the tick", () => {
    const tabs = read("components/gap/TokenTabs.tsx");
    expect(tabs).toContain("cursor-pointer tick-colour");
    expect(tabs).not.toContain("transition-colors");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-colour-transitions.test.ts
```

Expected: `Tests  3 failed (3)`.

- [ ] **Step 3: Write the minimal implementation**

In `web/components/Simulator.tsx`, use Edit:
- old_string: ``className={`min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] font-medium ${``
- new_string: ``className={`tick-colour min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] font-medium ${``

In `web/components/gap/TokenTabs.tsx`, use Edit:
- old_string: `cursor-pointer transition-colors`
- new_string: `cursor-pointer tick-colour`

In `web/app/globals.css`, insert this block immediately before the global reduced-motion block:

```css
/* The 120 ms colour tick (spec 2026-11-23 section 8.3): nav links, the pills, the simulator's chips and the
   /gap-index token pills change colour over --t-tick instead of snapping. */
@layer components {
  .tick-colour,
  .navlink,
  .pill-dark,
  .pill-line {
    transition-property: color, background-color, border-color;
    transition-duration: var(--t-tick);
    transition-timing-function: var(--ease-instrument);
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-colour-transitions.test.ts
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/simulator.test.tsx test/gap-page.test.tsx test/tokens.test.ts test/instrument-colour-transitions.test.ts
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/simulator.spec.ts e2e/gap-index.spec.ts --project=chromium --workers=2
```

Expected:
- Every file passes. The typecheck, the build and `check:out` exit 0. The class name `tick-colour` does not hold "safe", so `out/gap-index.html` stays clean.
- `netstat` prints nothing.
- Every `simulator.spec.ts` and `gap-index.spec.ts` test passes on Chromium.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-09.txt`:

```
feat(web): move nav links, pills and chips onto the 120 ms colour tick

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/Simulator.tsx web/components/gap/TokenTabs.tsx web/app/globals.css web/test/instrument-colour-transitions.test.ts
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-09.txt"
```

---

### Task 10: The ThumbBar, and the landing's one provider

**Files:**
- Create: `web/components/instrument/ThumbBar.tsx`
- Modify: `web/app/(site)/page.tsx`, the whole file (36 lines)
- Modify: `web/app/globals.css` (a new block before the global reduced-motion block)
- Test: `web/test/instrument-thumb-bar.test.tsx`

**Interfaces:**
- Consumes:
  - `useLiveIfAny()` and `LiveSnapshotProvider` (Task 2);
  - `Lamp` and `LampState` (P0 Task 9);
  - the `[data-hero-cta]` links (Task 8), `#try`, and the page's one `<footer>` (`Footer.tsx`);
  - `.thumb-bar`, from P0 Task 1, for the safe-area padding.
- Produces:
  - `thumbLamp(state: LiveState | undefined): LampState`;
  - `interface ThumbView { ctasAbove: boolean; tryInView: boolean; footerInView: boolean }` and `thumbShown(v: ThumbView): boolean`;
  - `ThumbBar({ href = "#try" }: { href?: string })`, `"use client"`. It renders `null` until both CTAs have been above the viewport. After that it renders `div[data-thumb-bar="shown" | "hidden"]`, which is `inert` while hidden.
  - `page.tsx` wraps the landing in one `LiveSnapshotProvider` and mounts `<ThumbBar />` after `<Footer />`.

**Review Focus 1 and 4** are pinned here, with Tasks 2 and 14.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-thumb-bar.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/(site)/page";
import { ThumbBar, thumbLamp, thumbShown } from "@/components/instrument/ThumbBar";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { LiveStrip } from "@/components/live/LiveStrip";
import { classify } from "@/lib/live/freshness";
import type { LiveReader } from "@/lib/live/rpc";
import { type Answer, advance, fakeReader, FRI, installLiveClocks, readingAt, SAT } from "./helpers/fake-reader";
import { passingBasket } from "./helpers/live";

installLiveClocks();

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** An IntersectionObserver the test drives, one entry at a time. */
class FakeIO {
  static all: FakeIO[] = [];
  callback: IntersectionObserverCallback;
  targets: Element[] = [];
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  /** Reports `target` in or out of view, its bottom edge at `bottom` px against a viewport whose top is 0. */
  report(target: Element, isIntersecting: boolean, bottom = 0) {
    const entry = {
      target,
      isIntersecting,
      boundingClientRect: { bottom } as DOMRectReadOnly,
      rootBounds: { top: 0 } as DOMRectReadOnly,
    } as IntersectionObserverEntry;
    act(() => this.callback([entry], this as unknown as IntersectionObserver));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeIO.all = [];
});

/** The landing's parts the bar knows: the strip, both CTAs, #try, the footer, then the bar, on one provider. */
function Landing({ reader }: { reader: LiveReader }) {
  return (
    <LiveSnapshotProvider reader={reader}>
      <LiveStrip />
      <a data-hero-cta="" href="/quickstart">
        Verify it in 5 minutes
      </a>
      <a data-hero-cta="" href="#try">
        Try to make it say no
      </a>
      <section id="try" />
      <footer />
      <ThumbBar />
    </LiveSnapshotProvider>
  );
}

async function mount(first: Answer = { timestamp: SAT }, wallSec = SAT + 14, observer = true) {
  if (observer) vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.setSystemTime(wallSec * 1000);
  const fake = fakeReader(first);
  const { container, unmount } = render(<Landing reader={fake.reader} />);
  await advance(0);
  const [verify, tryCta] = [...container.querySelectorAll("[data-hero-cta]")];
  return {
    fake,
    unmount,
    io: () => FakeIO.all.find((o) => o.targets.some((t) => t.hasAttribute("data-hero-cta")))!,
    verify: verify!,
    tryCta: tryCta!,
    section: container.querySelector("#try")!,
    footer: container.querySelector("footer")!,
    bar: () => container.querySelector<HTMLElement>("[data-thumb-bar]"),
  };
}

/** Both CTAs scrolled out above the viewport. */
function scrollPast(ui: Awaited<ReturnType<typeof mount>>) {
  ui.io().report(ui.verify, false, -60);
  ui.io().report(ui.tryCta, false, -8);
}

describe("the ThumbBar (spec 2026-11-23 sections 6.2 and 11 item 12)", () => {
  it("shows only when both CTAs are above the viewport and neither #try nor the footer is in view", () => {
    expect(thumbShown({ ctasAbove: true, tryInView: false, footerInView: false })).toBe(true);
    expect(thumbShown({ ctasAbove: false, tryInView: false, footerInView: false })).toBe(false);
    expect(thumbShown({ ctasAbove: true, tryInView: true, footerInView: false })).toBe(false);
    expect(thumbShown({ ctasAbove: true, tryInView: false, footerInView: true })).toBe(false);
  });

  it("lights its lamp from a live reading only: PASS when the basket passes, REFUSE otherwise", () => {
    const sat = readingAt(SAT, { wallAtReadSec: SAT + 14 });
    const pass = readingAt(FRI, { edit: passingBasket, wallAtReadSec: FRI + 14 });
    expect(thumbLamp(undefined)).toBe("reading");
    expect(thumbLamp({ status: "reading" })).toBe("reading");
    expect(thumbLamp({ status: "error", message: "HTTP 503" })).toBe("reading");
    expect(thumbLamp(classify(sat, false, 0, SAT + 14))).toBe("refuse");
    expect(thumbLamp(classify(pass, false, 0, FRI + 14))).toBe("pass");
    expect(thumbLamp(classify(sat, true, 30_000, SAT + 44))).toBe("reading");
  });

  it("renders nothing until both hero CTAs have scrolled out above the viewport", async () => {
    const ui = await mount();
    expect(ui.bar()).toBeNull();
    ui.io().report(ui.verify, false, -60);
    expect(ui.bar()).toBeNull();
    ui.io().report(ui.tryCta, false, -8);
    const bar = ui.bar()!;
    expect(bar).toHaveAttribute("data-thumb-bar", "shown");
    expect(bar).not.toHaveAttribute("inert");
    const link = bar.querySelector("a")!;
    expect(link).toHaveAttribute("href", "#try");
    expect(link).toHaveTextContent("Try to make it say no");
  });

  it("never shows for CTAs below the viewport, which the page has not reached yet", async () => {
    const ui = await mount();
    ui.io().report(ui.verify, false, 900);
    ui.io().report(ui.tryCta, false, 960);
    expect(ui.bar()).toBeNull();
  });

  it("hides, inert, while #try or the footer is in view, and comes back after", async () => {
    const ui = await mount();
    scrollPast(ui);
    ui.io().report(ui.section, true);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "hidden");
    expect(ui.bar()).toHaveAttribute("inert");
    ui.io().report(ui.section, false);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "shown");
    ui.io().report(ui.footer, true);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "hidden");
    ui.io().report(ui.footer, false);
    expect(ui.bar()).toHaveAttribute("data-thumb-bar", "shown");
  });

  it("lights its lamp from the page's one reading, beside the strip, on one read loop", async () => {
    const ui = await mount();
    scrollPast(ui);
    expect(ui.bar()!.querySelector("[data-lamp]")).toHaveAttribute("data-lamp", "refuse");
    expect(ui.fake.multicalls()).toBe(1);
  });

  it("renders nothing where IntersectionObserver is missing", async () => {
    const ui = await mount({ timestamp: SAT }, SAT + 14, false);
    expect(ui.bar()).toBeNull();
    expect(FakeIO.all).toHaveLength(0);
  });

  it("disconnects its observer when the page unmounts", async () => {
    const ui = await mount();
    const io = ui.io();
    ui.unmount();
    expect(io.disconnected).toBe(true);
  });

  it("keeps the landing's static HTML free of the bar, of lit lamps and of refusals", { timeout: 60_000 }, () => {
    const html = renderToString(<Page />);
    expect(html).not.toContain("data-thumb-bar");
    expect(html).not.toContain("REFUSE");
    expect(html).not.toMatch(/data-lamp="(pass|refuse)"/);
    expect(html.match(/data-live-strip=/g)).toHaveLength(1);
    expect(html).toContain('data-live-strip="reading"');
  });

  it("slides over --t-flip, and appears without sliding under reduced motion", () => {
    expect(css).toMatch(
      /\[data-thumb-bar\]\s*\{\s*transition:\s*translate var\(--t-flip\) var\(--ease-instrument\), visibility var\(--t-flip\);\s*\}/,
    );
    expect(css).toMatch(/\[data-thumb-bar="hidden"\]\s*\{\s*translate:\s*0 100%;\s*visibility:\s*hidden;\s*\}/);
    expect(css).toMatch(/@starting-style\s*\{\s*\[data-thumb-bar="shown"\]\s*\{\s*translate:\s*0 100%;\s*\}\s*\}/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-thumb-bar.test.tsx
```

Expected: the file fails with `Failed to resolve import "@/components/instrument/ThumbBar"`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/components/instrument/ThumbBar.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useLiveIfAny } from "@/components/live/LiveSnapshotProvider";
import type { LiveState } from "@/lib/live/freshness";
import { Lamp, type LampState } from "./Lamp";

/** The bar's lamp: lit only while the page's one reading is live, PASS when the basket passes, else REFUSE. */
export function thumbLamp(state: LiveState | undefined): LampState {
  if (state === undefined || state.status !== "live") return "reading";
  return state.reading.headline.kind === "pass-all" ? "pass" : "refuse";
}

/** What the bar knows of the page. */
export interface ThumbView {
  /** Both hero CTAs have scrolled out above the viewport. */
  ctasAbove: boolean;
  tryInView: boolean;
  footerInView: boolean;
}

/** The bar shows once both CTAs are gone above, and never over #try or the footer (spec 6.2 and 11 item 12). */
export function thumbShown(v: ThumbView): boolean {
  return v.ctasAbove && !v.tryInView && !v.footerInView;
}

type Mode = "none" | "shown" | "hidden";

/**
 * The phone bottom bar (spec 2026-11-23 section 6.2): a lamp from the page's one reading and "Try to make it say no".
 * It renders nothing until both [data-hero-cta] links have scrolled out above the viewport, so the static HTML and the
 * first screen never hold it; after that it slides up, and back down (inert) while #try or the footer is in view. One
 * IntersectionObserver of its own watches the CTAs, #try and the footer; where there is none, the bar never shows.
 * Below md only. Mounted from app/(site)/page.tsx, never from the Hero.
 */
export function ThumbBar({ href = "#try" }: { href?: string }) {
  const live = useLiveIfAny();
  const [mode, setMode] = useState<Mode>("none");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ctas = [...document.querySelectorAll("[data-hero-cta]")];
    if (ctas.length === 0) return;
    const tryIt = document.getElementById("try");
    const footer = document.querySelector("footer");
    const above = new Map<Element, boolean>(ctas.map((el) => [el, false]));
    const view = { tryInView: false, footerInView: false };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (above.has(e.target)) {
          // Out of view above the viewport's top edge: scrolled past, not yet to come.
          above.set(e.target, !e.isIntersecting && e.boundingClientRect.bottom <= (e.rootBounds?.top ?? 0));
        } else if (e.target === tryIt) view.tryInView = e.isIntersecting;
        else if (e.target === footer) view.footerInView = e.isIntersecting;
      }
      const shown = thumbShown({ ctasAbove: [...above.values()].every(Boolean), ...view });
      setMode((m) => (shown ? "shown" : m === "none" ? "none" : "hidden"));
    });
    for (const el of ctas) io.observe(el);
    if (tryIt !== null) io.observe(tryIt);
    if (footer !== null) io.observe(footer);
    return () => io.disconnect();
  }, []);

  if (mode === "none") return null;
  const shown = mode === "shown";
  return (
    <div
      data-thumb-bar={mode}
      inert={!shown}
      className="thumb-bar fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white md:hidden"
    >
      <div className="wrap flex h-14 items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] text-label">
          Basket now <Lamp state={thumbLamp(live?.state)} />
        </span>
        <a href={href} className="pill-dark min-h-11 px-4 py-2.5 text-sm">
          Try to make it say no
        </a>
      </div>
    </div>
  );
}
```

Read `web/app/(site)/page.tsx`, then replace the whole file with:

```tsx
import { ThumbBar } from "@/components/instrument/ThumbBar";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Footer } from "@/components/sections/Footer";
import { Hero } from "@/components/sections/Hero";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Ledger } from "@/components/sections/Ledger";
import { Mandate } from "@/components/sections/Mandate";
import { Nav } from "@/components/sections/Nav";
import { Problem } from "@/components/sections/Problem";
import { Refusals } from "@/components/sections/Refusals";
import { TreasuryLoop } from "@/components/sections/TreasuryLoop";
import { TryIt } from "@/components/sections/TryIt";

// The landing runs exactly one read of Base (spec 2026-11-23 section 3.8): the provider's. The strip, HOLD and the
// ThumbBar's lamp read it.
export default function Page() {
  return (
    <LiveSnapshotProvider>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AnnouncementBar />
      <Nav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <BuiltOn />
        <Problem />
        <HowItWorks />
        <Refusals />
        <TryIt />
        <Ledger />
        <Mandate />
        <TreasuryLoop />
      </main>
      <Footer />
      <ThumbBar />
    </LiveSnapshotProvider>
  );
}
```

In `web/app/globals.css`, insert this block immediately before the global reduced-motion block:

```css
/* The ThumbBar (components/instrument/ThumbBar.tsx): it slides up over --t-flip when both hero CTAs have scrolled out,
   and back down while #try or the footer is in view. The reduce block turns the transition off, so under reduced
   motion it appears without sliding. */
@layer components {
  [data-thumb-bar] {
    transition: translate var(--t-flip) var(--ease-instrument), visibility var(--t-flip);
  }
  [data-thumb-bar="hidden"] {
    translate: 0 100%;
    visibility: hidden;
  }
  @starting-style {
    [data-thumb-bar="shown"] {
      translate: 0 100%;
    }
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-thumb-bar.test.tsx
```

Expected: `Tests  10 passed (10)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/page.test.tsx test/top.test.tsx test/live-snapshot-provider.test.tsx test/instrument-modules.test.ts test/instrument-contrast.test.ts test/instrument-thumb-bar.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build && npm run check:out
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && grep -c "data-thumb-bar" out/index.html
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/live.spec.ts e2e/smoke.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. `page.test.tsx` is unchanged, and its in-page link targets are still exactly the seven ids, because jsdom has no IntersectionObserver and the bar never renders there.
- The typecheck, the build and `check:out` exit 0.
- `grep -c` prints `0` and exits 1: the export holds no bar.
- `netstat` prints nothing.
- Every `live.spec.ts` and `smoke.spec.ts` test passes on Chromium. `live.spec.ts` still counts one multicall per read, now from the page's provider.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-10.txt`:

```
feat(web): mount the landing's one LiveSnapshotProvider and the phone ThumbBar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/instrument/ThumbBar.tsx 'web/app/(site)/page.tsx' web/app/globals.css web/test/instrument-thumb-bar.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-10.txt"
```

---

### Task 11: The unlit docked plate on `/gap-index`

**Files:**
- Create: `web/components/instrument/DockedPlate.tsx`
- Modify: `web/app/(site)/gap-index/page.tsx`, two places: the imports (lines 7-8 at `66bd0d0`) and the `Header` (lines 99-100)
- Test: `web/test/instrument-docked-plate.test.tsx`

**Interfaces:**
- Consumes: `Lamp` (P0 Task 9).
- Produces: `DockedPlate({ className = "inline-flex" }: { className?: string })`. It is server-safe. It renders `a[href="/now"][data-docked-plate="unlit"]`, holding an unlit lamp and the words "Live on / and /now" (spec 7.5). It makes no RPC request. `className` carries the display classes, so a caller can hide the plate below a breakpoint.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-docked-plate.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GapIndexPage from "@/app/(site)/gap-index/page";
import { DockedPlate } from "@/components/instrument/DockedPlate";

const classes = (el: Element) => el.getAttribute("class")!.split(" ");

describe("the docked plate, unlit (spec 2026-11-23 section 7.5, amendment A6)", () => {
  it("links /now with an unlit lamp and the words Live on / and /now", () => {
    render(<DockedPlate />);
    const plate = screen.getByRole("link", { name: "Live on / and /now" });
    expect(plate).toHaveAttribute("href", "/now");
    expect(plate).toHaveAttribute("data-docked-plate", "unlit");
    expect(classes(plate)).toEqual(expect.arrayContaining(["inline-flex", "min-h-11", "text-label"]));
    const lamp = plate.querySelector("[data-lamp]")!;
    expect(lamp).toHaveAttribute("data-lamp", "reading");
    expect(lamp.textContent).toBe("");
  });

  it("takes the display classes it is given in place of inline-flex", () => {
    render(<DockedPlate className="mr-2 hidden md:inline-flex" />);
    const c = classes(screen.getByRole("link", { name: "Live on / and /now" }));
    expect(c).toEqual(expect.arrayContaining(["mr-2", "hidden", "md:inline-flex"]));
    expect(c).not.toContain("inline-flex");
  });

  it("sits in the /gap-index Header before the first nav link, unlit, in the static HTML", { timeout: 60_000 }, () => {
    const html = renderToString(<GapIndexPage />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const nav = doc.querySelector('header nav[aria-label="Main"]')!;
    const plate = nav.querySelector("[data-docked-plate]")!;
    expect(plate.getAttribute("href")).toBe("/now");
    expect(plate.nextElementSibling?.getAttribute("href")).toBe("/#how");
    expect(html.match(/data-docked-plate=/g)).toHaveLength(1);
    expect(html).not.toMatch(/data-lamp="(pass|refuse)"/);
    expect(html).not.toContain("data-live-strip");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-docked-plate.test.tsx
```

Expected: the file fails with `Failed to resolve import "@/components/instrument/DockedPlate"`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/components/instrument/DockedPlate.tsx`:

```tsx
import { Lamp } from "./Lamp";

/**
 * The docked readout's unlit frame, for the pages that read no chain (spec 2026-11-23 section 7.5, amendment A6): an
 * unlit lamp and "Live on / and /now", linked to /now. It holds no live value and makes no RPC request, so it is
 * server-safe. `className` holds its display classes, "inline-flex" unless the caller hides it below a breakpoint.
 */
export function DockedPlate({ className = "inline-flex" }: { className?: string }) {
  return (
    <a
      href="/now"
      data-docked-plate="unlit"
      className={`min-h-11 items-center gap-2 rounded-full border border-line px-3 font-mono text-[11px] text-label ${className}`}
    >
      <Lamp state="reading" />
      Live on / and /now
    </a>
  );
}
```

In `web/app/(site)/gap-index/page.tsx`, make two Edits.

The import. old_string:

```tsx
import { BlockLink, INLINE_LINK } from "@/components/gap/WindowTable";
import { Footer } from "@/components/sections/Footer";
```

new_string:

```tsx
import { BlockLink, INLINE_LINK } from "@/components/gap/WindowTable";
import { DockedPlate } from "@/components/instrument/DockedPlate";
import { Footer } from "@/components/sections/Footer";
```

The Header. old_string:

```tsx
        <div className="flex flex-wrap items-center gap-1">
          <a href="/#how" className="navlink max-[720px]:hidden">
```

new_string:

```tsx
        <div className="flex flex-wrap items-center gap-1">
          <DockedPlate className="mr-2 hidden md:inline-flex" />
          <a href="/#how" className="navlink max-[720px]:hidden">
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-docked-plate.test.tsx
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/gap-page.test.tsx test/instrument-modules.test.ts test/instrument-contrast.test.ts test/instrument-docked-plate.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/gap-index.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. `gap-page.test.tsx` is unchanged, and still finds "Maat home", "Docs" and "View on GitHub" in the Main nav.
- The modules test passes: `DockedPlate.tsx` calls no hook and is not a client module.
- The typecheck, the build and `check:out` exit 0. The plate's words hold no "safe", so `out/gap-index.html` stays clean.
- `netstat` prints nothing.
- Every `gap-index.spec.ts` test passes on Chromium, including "the page raises no console error and makes no request outside its own origin".

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-11.txt`:

```
feat(web): show the unlit docked plate in the /gap-index header

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/instrument/DockedPlate.tsx 'web/app/(site)/gap-index/page.tsx' web/test/instrument-docked-plate.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-11.txt"
```

---

### Task 12: Drag-to-tip

This is the first thing to cut (spec 12.3). If Tasks 0-11 are not all committed by Wed 25 Nov 2026 08:00 UTC, skip this task and go on with Task 13.

**Files:**
- Create: `web/components/instrument/useTipDrag.ts`
- Modify: `web/components/DecisionEngine.tsx`, the whole file again (Task 7's text, plus the drag)
- Modify: `web/app/globals.css` (a new block before the global reduced-motion block)
- Test: `web/test/instrument-tip-drag.test.tsx`

**Interfaces:**
- Consumes:
  - `NEEDLE`, `SETTLE_EPSILON`, `SpringState` and `springStep` from `@/lib/motion/spring` (P0 Task 2). NEEDLE's ω is 27.8 rad/s, so ω·dt stays under 1 for every step up to `MAX_STEP_SEC`, and `springStep` stays stable.
  - `prefersReducedMotion()` (P0 Task 3), which is true where `matchMedia` is missing;
  - `BALANCE.refusedDeg` (P0 Task 11), and the Balance's `--tilt` custom property, which its beam and pans read.
- Produces, in `useTipDrag.ts`. It is a plain module that calls no hook, so it stays server-safe (amendment A5):
  - `TIP_MAX_DEG = 14`, `TIP_TRAVEL_PX = 60`, `MAX_STEP_SEC = 1 / 30`, and `EPS_DEG = SETTLE_EPSILON * TIP_MAX_DEG`;
  - `tipTarget(restDeg: number, dx: number): number`, which is `restDeg + 14·tanh(dx / 60)`, clamped to ±14;
  - `interface TipTarget { style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">; setAttribute(name, value): void; removeAttribute(name): void; getAnimations?(options?): readonly { cancel(): void }[] }`;
  - `interface TipDragOptions { svg: TipTarget; zone: EventTarget; pointerId: number; startX: number; restDeg: number; raf?; caf?; onEnd?: () => void }` and `interface TipDrag { stop(): void }`;
  - `beginTipDrag(opts: TipDragOptions): TipDrag`.
- Produces in the engine card:
  - a press on the weighing loads `useTipDrag.ts` with `import()`. A drag starts only for the primary button, with no drag running, and never under reduced motion.
  - the caption "Only the nine checks move this beam." appears once a drag has started.
  - choosing a moment, or unmounting, stops the drag.

**How a drag runs.**
- On start it cancels every animation in the Balance's subtree, which ends the intro at its final frame. It sets `data-dragging`, which turns the beam's and the pans' transitions off, and writes `--tilt` at the rest angle.
- Each `pointermove` of its own pointer sets the target, and starts a frame if none is pending.
- Each frame takes one `springStep` toward the target. The step is the time since the last frame, capped at `MAX_STEP_SEC`, or 1/60 s for the first frame after a start or a wake. The frame then writes `--tilt` as `x.toFixed(3) + "deg"`, clamped to ±14. It asks for another frame only while the beam is unsettled: more than `EPS_DEG` from the target, or moving faster than `EPS_DEG·ω` per second. So `requestAnimationFrame` never runs while the beam rests (spec 8.1).
- `pointerup` or `pointercancel` of its own pointer sets the target back to the rest angle, so the needle swings past rest and settles. Once settled the drag finishes. It finishes at once if it is already settled.
- Finishing removes the three listeners, cancels a pending frame, removes `--tilt` and `data-dragging`, and calls `onEnd` once. The CSS rest angle, which `data-verdict` keys, takes over again. `stop()` finishes at once, and a second call does nothing.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-tip-drag.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisionEngine } from "@/components/DecisionEngine";
import { beginTipDrag, TIP_MAX_DEG, type TipTarget, tipTarget } from "@/components/instrument/useTipDrag";
import { MOMENTS } from "@/content/engine";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const src = readFileSync(new URL("../components/DecisionEngine.tsx", import.meta.url), "utf8");
const CAPTION = "Only the nine checks move this beam.";

/** jsdom may have no PointerEvent: a MouseEvent with a pointerId is all the drag and React read. */
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId ?? 1;
  }
}

const send = (target: EventTarget, type: string, clientX: number, pointerId = 1) =>
  target.dispatchEvent(new FakePointerEvent(type, { clientX, pointerId }));

/** A Balance the drag writes to: each --tilt written, the attributes set, and how many animations were cancelled. */
function stubBalance() {
  const writes: number[] = [];
  const attrs = new Map<string, string>();
  let tilt: string | null = null;
  let cancelled = 0;
  const svg: TipTarget = {
    style: {
      setProperty: (name: string, value: string | null) => {
        if (name !== "--tilt" || value === null) return;
        tilt = value;
        writes.push(Number.parseFloat(value));
      },
      removeProperty: (name: string) => {
        if (name === "--tilt") tilt = null;
        return "";
      },
    },
    setAttribute: (name, value) => void attrs.set(name, value),
    removeAttribute: (name) => void attrs.delete(name),
    getAnimations: () => [{ cancel: () => void cancelled++ }, { cancel: () => void cancelled++ }],
  };
  return { svg, writes, attrs, tilt: () => tilt, cancelled: () => cancelled };
}

/** requestAnimationFrame as a queue the test runs: one frame every `stepMs`. */
function frameQueue() {
  const queue = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = 0;
  return {
    raf: (cb: FrameRequestCallback) => {
      queue.set(++id, cb);
      return id;
    },
    caf: (n: number) => void queue.delete(n),
    pending: () => queue.size,
    /** Runs frames until none is asked for, or `max` have run, and says how many ran. */
    run(stepMs = 1000 / 60, max = 1000) {
      let ran = 0;
      while (queue.size > 0 && ran < max) {
        now += stepMs;
        const due = [...queue.values()];
        queue.clear();
        for (const cb of due) cb(now);
        ran++;
      }
      return ran;
    },
  };
}

function start(restDeg = 0, startX = 100) {
  const balance = stubBalance();
  const frames = frameQueue();
  const zone = document.createElement("div");
  const onEnd = vi.fn();
  const drag = beginTipDrag({ svg: balance.svg, zone, pointerId: 1, startX, restDeg, raf: frames.raf, caf: frames.caf, onEnd });
  return { ...balance, frames, zone, onEnd, drag };
}

describe("beginTipDrag (spec 2026-11-23 sections 6.1 and 8.1, amendment A5)", () => {
  it("pulls the beam softly, and never past ±14°", () => {
    expect(tipTarget(0, 0)).toBe(0);
    expect(tipTarget(-6, 0)).toBe(-6);
    expect(tipTarget(0, 60)).toBeCloseTo(TIP_MAX_DEG * Math.tanh(1), 9);
    expect(tipTarget(0, 30)).toBeLessThan(tipTarget(0, 60));
    expect(tipTarget(0, 1e6)).toBe(TIP_MAX_DEG);
    expect(tipTarget(-6, 1e6)).toBe(8);
    expect(tipTarget(-6, -1e6)).toBe(-TIP_MAX_DEG);
  });

  it("starts by ending the CSS intro, marking the Balance and writing its rest angle, with no frame asked for", () => {
    const d = start(-6);
    expect(d.cancelled()).toBe(2);
    expect(d.attrs.get("data-dragging")).toBe("");
    expect(d.tilt()).toBe("-6.000deg");
    expect(d.frames.pending()).toBe(0);
  });

  it("follows its own pointer only", () => {
    const d = start();
    send(d.zone, "pointermove", 160, 2);
    send(d.zone, "pointerup", 160, 2);
    expect(d.frames.pending()).toBe(0);
    expect(d.onEnd).not.toHaveBeenCalled();
    send(d.zone, "pointermove", 160);
    expect(d.frames.pending()).toBe(1);
  });

  it("springs to the pull, clamps the overshoot at ±14°, and stops asking for frames once settled while held", () => {
    const d = start();
    send(d.zone, "pointermove", 220);
    const ran = d.frames.run();
    expect(ran).toBeGreaterThan(5);
    expect(ran).toBeLessThan(120);
    expect(d.frames.pending()).toBe(0);
    expect(d.writes.at(-1)!).toBeCloseTo(tipTarget(0, 120), 1);
    expect(Math.max(...d.writes)).toBe(TIP_MAX_DEG);
    expect(d.onEnd).not.toHaveBeenCalled();
  });

  it("on release swings back past rest on the needle spring, then cleans up and ends once", () => {
    const d = start();
    send(d.zone, "pointermove", 220);
    d.frames.run();
    const before = d.writes.length;
    send(d.zone, "pointerup", 220);
    d.frames.run();
    const back = d.writes.slice(before);
    expect(Math.min(...back)).toBeLessThan(-1);
    expect(back.every((x) => Math.abs(x) <= TIP_MAX_DEG)).toBe(true);
    expect(d.tilt()).toBeNull();
    expect(d.attrs.has("data-dragging")).toBe(false);
    expect(d.onEnd).toHaveBeenCalledTimes(1);
    expect(d.frames.pending()).toBe(0);
    const after = d.writes.length;
    send(d.zone, "pointermove", 300);
    expect(d.writes.length).toBe(after);
    expect(d.frames.pending()).toBe(0);
  });

  it("stays stable when frames come half a second apart", () => {
    const d = start();
    send(d.zone, "pointermove", -20);
    const ran = d.frames.run(500);
    expect(ran).toBeLessThan(60);
    expect(d.writes.every((x) => Number.isFinite(x) && Math.abs(x) <= TIP_MAX_DEG)).toBe(true);
    expect(d.writes.at(-1)!).toBeCloseTo(tipTarget(0, -120), 1);
    send(d.zone, "pointerup", -20);
    d.frames.run(500);
    expect(d.onEnd).toHaveBeenCalledTimes(1);
  });

  it("ends the same way on pointercancel, and at once when released at rest", () => {
    const d = start(-6);
    send(d.zone, "pointermove", 130);
    d.frames.run();
    send(d.zone, "pointercancel", 130);
    d.frames.run();
    expect(d.tilt()).toBeNull();
    expect(d.onEnd).toHaveBeenCalledTimes(1);

    const still = start();
    send(still.zone, "pointerup", 100);
    expect(still.onEnd).toHaveBeenCalledTimes(1);
    expect(still.frames.pending()).toBe(0);
    expect(still.tilt()).toBeNull();
  });

  it("stop() ends a drag at once, and only once", () => {
    const d = start();
    send(d.zone, "pointermove", 200);
    d.frames.run(1000 / 60, 3);
    expect(d.frames.pending()).toBe(1);
    d.drag.stop();
    expect(d.frames.pending()).toBe(0);
    expect(d.tilt()).toBeNull();
    expect(d.attrs.has("data-dragging")).toBe(false);
    d.drag.stop();
    send(d.zone, "pointerup", 200);
    expect(d.onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("drag-to-tip in the engine card", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A browser that answers the reduced-motion query. jsdom has no matchMedia, which reads as "reduce". */
  const motion = (reduce: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduce, media: query, addEventListener() {}, removeEventListener() {} }));

  function card() {
    const { container } = render(<DecisionEngine />);
    return {
      container,
      zone: () => container.querySelector<HTMLElement>("[data-weighing]")!,
      svg: () => container.querySelector("svg.balance")!,
    };
  }

  const pressOn = (zone: HTMLElement, button = 0) =>
    act(async () => {
      zone.dispatchEvent(new FakePointerEvent("pointerdown", { clientX: 100, button }));
    });

  /** Lets an import() a press started finish, so a test can see that it started nothing. */
  const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));

  it("loads the drag on the first primary press, marks the Balance and adds the caption", async () => {
    motion(false);
    const ui = card();
    expect(screen.queryByText(CAPTION)).toBeNull();
    await pressOn(ui.zone());
    await waitFor(() => expect(ui.svg()).toHaveAttribute("data-dragging"));
    expect(screen.getByText(CAPTION)).toBeInTheDocument();
    // 11 px text needs 7:1 (spec 9.2): label is 7.96:1 on white, ink-2 only 6.21:1. P0's contrast test does not scan this file.
    expect(screen.getByText(CAPTION).className.split(" ")).toContain("text-label");
  });

  it("ends the drag when a moment is chosen", async () => {
    motion(false);
    const ui = card();
    const first = ui.svg();
    await pressOn(ui.zone());
    await waitFor(() => expect(first).toHaveAttribute("data-dragging"));
    fireEvent.click(screen.getByRole("button", { name: MOMENTS.thu.toggleLabel }));
    expect(first).not.toHaveAttribute("data-dragging");
    expect(ui.container.querySelector("[data-dragging]")).toBeNull();
    expect(ui.svg()).toHaveAttribute("data-verdict", "allowed");
  });

  it("starts no drag under reduced motion, for a secondary button, or when the press ends before the drag loads", async () => {
    motion(true);
    const reduced = card();
    await pressOn(reduced.zone());
    await settle();
    expect(reduced.svg()).not.toHaveAttribute("data-dragging");
    cleanup();

    motion(false);
    const ui = card();
    await pressOn(ui.zone(), 2);
    await settle();
    expect(ui.svg()).not.toHaveAttribute("data-dragging");
    await act(async () => {
      ui.zone().dispatchEvent(new FakePointerEvent("pointerdown", { clientX: 100 }));
      ui.zone().dispatchEvent(new FakePointerEvent("pointerup", { clientX: 100 }));
    });
    await settle();
    expect(ui.svg()).not.toHaveAttribute("data-dragging");
    expect(screen.queryByText(CAPTION)).toBeNull();
  });

  it("imports the integrator lazily, and turns the beam's transitions off while dragging", () => {
    expect(src).toContain('import("@/components/instrument/useTipDrag")');
    expect(src).toMatch(/^import type \{ TipDrag \} from "@\/components\/instrument\/useTipDrag";$/m);
    expect(src.match(/from "@\/components\/instrument\/useTipDrag"/g)).toHaveLength(1);
    expect(css).toMatch(
      /\.balance\[data-dragging\] \.balance-beam,\s*\.balance\[data-dragging\] \.balance-pan\s*\{\s*transition:\s*none;\s*\}/,
    );
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-tip-drag.test.tsx
```

Expected: the file fails with `Failed to resolve import "@/components/instrument/useTipDrag"`.

- [ ] **Step 3: Write the minimal implementation**

Create `web/components/instrument/useTipDrag.ts`:

```ts
import { NEEDLE, SETTLE_EPSILON, type SpringState, springStep } from "@/lib/motion/spring";

/** How far a drag can tip the beam either way, degrees. */
export const TIP_MAX_DEG = 14;
/** The pointer travel over which the pull reaches tanh(1), 76%, of TIP_MAX_DEG, px. */
export const TIP_TRAVEL_PX = 60;
/** The longest step the spring takes: a slow frame is cut to this, so NEEDLE's ω·dt stays under 1. */
export const MAX_STEP_SEC = 1 / 30;
/** The step of the first frame after a start or a wake, before a frame time has been seen. */
const FIRST_STEP_SEC = 1 / 60;
/** Settled: this close to the target, in degrees, and slower than EPS_DEG · ω per second. */
export const EPS_DEG = SETTLE_EPSILON * TIP_MAX_DEG;

const clamp = (deg: number) => Math.min(TIP_MAX_DEG, Math.max(-TIP_MAX_DEG, deg));

/** Where a pointer `dx` px from the drag's start pulls the beam: the rest angle plus a soft pull, within ±14°. */
export function tipTarget(restDeg: number, dx: number): number {
  return clamp(restDeg + TIP_MAX_DEG * Math.tanh(dx / TIP_TRAVEL_PX));
}

const settled = (s: SpringState, target: number) =>
  Math.abs(s.x - target) < EPS_DEG && Math.abs(s.v) < EPS_DEG * NEEDLE.omega;

/** What the drag writes to: the Balance's svg, whose beam and pans read --tilt. */
export interface TipTarget {
  style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAnimations?(options?: GetAnimationsOptions): readonly { cancel(): void }[];
}

export interface TipDragOptions {
  svg: TipTarget;
  /** Where the pointer's events arrive: the element that captured it. */
  zone: EventTarget;
  pointerId: number;
  /** The pointer's clientX when the drag began. */
  startX: number;
  /** The beam's angle for the verdict shown: 0 when allowed, BALANCE.refusedDeg when refused. */
  restDeg: number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  /** Called once, when the drag has finished. */
  onEnd?: () => void;
}

export interface TipDrag {
  /** Ends the drag at once: the beam goes back to its CSS rest, and every listener and frame is dropped. */
  stop(): void;
}

/**
 * Drag-to-tip (spec 2026-11-23 sections 6.1 and 8.1, amendment A5): the beam follows the pointer on the NEEDLE spring,
 * one springStep per animation frame and only while it is unsettled, and swings back past rest when let go. Only the
 * nine checks move this beam: the drag never changes the verdict, and the beam always returns to it. A plain
 * function, loaded with import() on the first press, so the landing never downloads it before then.
 */
export function beginTipDrag(opts: TipDragOptions): TipDrag {
  const { svg, zone, pointerId, startX, restDeg, onEnd } = opts;
  const raf = opts.raf ?? ((cb: FrameRequestCallback) => requestAnimationFrame(cb));
  const caf = opts.caf ?? ((id: number) => cancelAnimationFrame(id));
  let state: SpringState = { x: restDeg, v: 0 };
  let target = restDeg;
  let frame: number | null = null;
  let last: number | null = null;
  let released = false;
  let done = false;

  const write = () => svg.style.setProperty("--tilt", `${clamp(state.x).toFixed(3)}deg`);

  const tick = (now: number) => {
    frame = null;
    const dt = last === null ? FIRST_STEP_SEC : Math.min(MAX_STEP_SEC, Math.max(0, (now - last) / 1000));
    last = now;
    state = springStep(state, target, NEEDLE, dt);
    write();
    if (!settled(state, target)) frame = raf(tick);
    else if (released) finish();
  };

  const wake = () => {
    if (frame !== null || done) return;
    last = null;
    frame = raf(tick);
  };

  const onMove = (e: Event) => {
    const p = e as PointerEvent;
    if (p.pointerId !== pointerId || released) return;
    target = tipTarget(restDeg, p.clientX - startX);
    wake();
  };

  const onUp = (e: Event) => {
    if ((e as PointerEvent).pointerId !== pointerId || released) return;
    released = true;
    target = restDeg;
    if (settled(state, target)) finish();
    else wake();
  };

  function finish() {
    if (done) return;
    done = true;
    zone.removeEventListener("pointermove", onMove);
    zone.removeEventListener("pointerup", onUp);
    zone.removeEventListener("pointercancel", onUp);
    if (frame !== null) caf(frame);
    frame = null;
    svg.style.removeProperty("--tilt");
    svg.removeAttribute("data-dragging");
    onEnd?.();
  }

  for (const a of svg.getAnimations?.({ subtree: true }) ?? []) a.cancel();
  svg.setAttribute("data-dragging", "");
  write();
  zone.addEventListener("pointermove", onMove);
  zone.addEventListener("pointerup", onUp);
  zone.addEventListener("pointercancel", onUp);
  return { stop: finish };
}
```

Read `web/components/DecisionEngine.tsx`, then replace the whole file with:

```tsx
"use client";

import { type PointerEvent, useEffect, useRef, useState } from "react";
import { BALANCE, Balance } from "@/components/instrument/Balance";
import { factAttr } from "@/components/instrument/Fig";
import { SourcePlate } from "@/components/instrument/SourcePlate";
import type { TipDrag } from "@/components/instrument/useTipDrag";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { type CheckMark, MOMENT_ORDER, type MomentId, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import { prefersReducedMotion } from "@/lib/motion/reduced-motion";

const MARK_STYLE: Record<CheckMark, string> = {
  PASS: "bg-accent-tint text-accent",
  FAIL: "bg-refuse text-white",
  SKIP: "bg-line-soft text-ink-2",
};

/** Where the beam's intro starts: level, or at the refused angle (BALANCE.refusedDeg). */
export type Tilt = "level" | "refused";

const tiltOf = (id: MomentId): Tilt => (MOMENTS[id].allowed ? "level" : "refused");

/**
 * The angle the beam's intro starts from when the visitor moves from `prev` to `next`: where `prev` left the beam, so
 * Sat → Thu swings level from -6° and Thu → Sat tips from level. The first paint (no `prev`) and a replay of the same
 * moment start level, so the beam tips again (spec 2026-11-23 section 6.1).
 */
export function tiltFrom(prev: MomentId | null, next: MomentId): Tilt {
  return prev === null || prev === next ? "level" : tiltOf(prev);
}

export function DecisionEngine() {
  const [state, setState] = useState<{ moment: MomentId; run: number; from: Tilt }>({ moment: "sat", run: 0, from: "level" });
  const [dragged, setDragged] = useState(false);
  const drag = useRef<TipDrag | null>(null);
  const pressed = useRef(false);
  const moment = MOMENTS[state.moment];

  // A drag never outlives the card.
  useEffect(
    () => () => {
      drag.current?.stop();
    },
    [],
  );

  // Every click bumps `run`, which remounts the weighing, the rows and the verdict card so their animations replay. A
  // choice ends a drag first.
  const choose = (id: MomentId) => {
    drag.current?.stop();
    setState((s) => ({ moment: id, run: s.run + 1, from: tiltFrom(s.moment, id) }));
  };

  // Drag-to-tip (spec 2026-11-23 section 6.1): the integrator loads on the first press, never with the page. A drag
  // starts for the primary button only, one at a time, and never under reduced motion.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current !== null || prefersReducedMotion()) return;
    const zone = e.currentTarget;
    const svg = zone.querySelector<SVGSVGElement>("svg.balance");
    if (svg === null) return;
    pressed.current = true;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      // No pointer capture here, or the pointer is already gone: the drag still listens on the zone.
    }
    const { pointerId, clientX } = e;
    const restDeg = moment.allowed ? 0 : BALANCE.refusedDeg;
    void import("@/components/instrument/useTipDrag").then(({ beginTipDrag }) => {
      if (!pressed.current || drag.current !== null || !zone.isConnected) return;
      drag.current = beginTipDrag({
        svg,
        zone,
        pointerId,
        startX: clientX,
        restDeg,
        onEnd: () => {
          drag.current = null;
        },
      });
      setDragged(true);
    });
  };
  const onPointerUp = () => {
    pressed.current = false;
  };

  return (
    <div className="card overflow-hidden shadow-[0_1px_0_var(--color-line),0_30px_80px_-30px_color-mix(in_srgb,var(--color-ink)_28%,transparent)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-head px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs font-semibold">DECISION ENGINE</span>
          <SourcePlate kind="replay" data-fact={factAttr("forkBlock")}>
            {`replay · Base fork · block ${formatInt(FACTS.forkBlock.value)}`}
          </SourcePlate>
        </div>
        <div role="group" aria-label="Choose a moment" className="flex rounded-full bg-line-soft p-[3px]">
          {MOMENT_ORDER.map((id) => {
            const on = state.moment === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                onClick={() => choose(id)}
                className={`min-h-9 cursor-pointer rounded-full border-0 px-3.5 py-2 text-xs font-medium ${
                  on
                    ? "bg-white text-ink shadow-[0_1px_2px_color-mix(in_srgb,var(--color-ink)_12%,transparent)]"
                    : "bg-transparent text-ink-2 hover:text-ink"
                }`}
              >
                {MOMENTS[id].toggleLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* The weighing: the Balance and the order it weighs. The Balance is aria-hidden; the words are in the HTML. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 pt-5">
        <div
          key={`weighing-${state.run}`}
          data-weighing=""
          data-tilt-from={state.from}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="weighing flex shrink-0 cursor-grab touch-pan-y flex-col items-center gap-1"
        >
          <Balance verdict={moment.allowed ? "allowed" : "refused"} checks={moment.checks.map((c) => c.mark)} />
          <span aria-hidden="true" data-label={moment.intent} className="balance-label font-mono text-[10px] text-label" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[11px] text-ink-2">INTENT · SCRIPTED FORK RUN</span>
          <span className="text-[30px] font-semibold tracking-[-0.035em]">{moment.intent}</span>
          <span className="font-mono text-xs text-ink-2">{moment.when}</span>
        </div>
      </div>
      {dragged ? <p className="m-0 px-5 pt-2 font-mono text-[11px] text-label">Only the nine checks move this beam.</p> : null}

      {/* The live region itself never remounts; only its child does. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="mx-3 mt-4">
        <div
          key={`verdict-${state.run}`}
          data-verdict={moment.allowed ? "allowed" : "refused"}
          data-reason={moment.reason}
          className={`anim-stamp flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-[18px] py-4 text-white ${
            moment.allowed ? "bg-accent" : "bg-ink"
          }`}
        >
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[11px] opacity-80">VAULT DECISION</span>
            <span className="text-[26px] font-semibold tracking-[-0.03em]">{moment.allowed ? "Allowed" : "Refused"}</span>
          </div>
          <div className="ml-auto flex flex-col gap-1.5 text-right">
            <ReasonTag code={moment.reason} tone="verdict" layout="stacked" />
            <span className="font-mono text-[11px] opacity-80">{moment.outcome}</span>
          </div>
        </div>
      </div>

      {/* The grounds: nine channel rows of 36 px. */}
      <ol key={`checks-${state.run}`} aria-label="Mandate checks" className="m-0 list-none px-3 pb-3 pt-3">
        {moment.checks.map((c, i) => (
          <li
            key={c.label}
            data-mark={c.mark}
            style={{ animationDelay: `${(0.12 + 0.16 * i).toFixed(2)}s` }}
            className={`anim-row grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-3 rounded-[10px] px-2.5 py-2 ${
              c.mark === "FAIL" ? "bg-refuse-tint" : ""
            }`}
          >
            <span aria-hidden="true" className="font-mono text-[11px] text-ink-2">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className={`text-sm font-medium ${c.mark === "SKIP" ? "text-ink-2" : ""}`}>{c.label}</span>
              <span className="font-mono text-xs text-ink-2">{c.detail}</span>
            </span>
            <span className={`rounded-md py-1 text-center font-mono text-[11px] font-semibold ${MARK_STYLE[c.mark]}`}>
              {c.mark}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

In `web/app/globals.css`, insert this block immediately before the global reduced-motion block:

```css
/* Drag-to-tip (components/instrument/useTipDrag.ts): while a drag writes --tilt every frame, the beam and the pans
   follow it directly instead of easing toward each new value. */
@layer components {
  .balance[data-dragging] .balance-beam,
  .balance[data-dragging] .balance-pan {
    transition: none;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-tip-drag.test.tsx
```

Expected: `Tests  12 passed (12)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/decision-engine.test.tsx test/instrument-engine-balance.test.tsx test/instrument-modules.test.ts test/instrument-contrast.test.ts test/top.test.tsx test/instrument-tip-drag.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/smoke.spec.ts e2e/weight.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. The modules test passes: `useTipDrag.ts` calls no hook and imports only from `@/`.
- The typecheck, the build and `check:out` exit 0.
- `netstat` prints nothing.
- Every `smoke.spec.ts` and `weight.spec.ts` test passes on Chromium. The drag is its own chunk, which `out/index.html` does not link, so the JS budget does not count it. Write down the weight log line.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-12.txt`:

```
feat(web): tip the engine card's beam by drag on the needle spring, loaded on the first press

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/instrument/useTipDrag.ts web/components/DecisionEngine.tsx web/app/globals.css web/test/instrument-tip-drag.test.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-12.txt"
```

---

### Task 13: Every live frame at six widths, and the Readout's calibrated height

**Files:**
- Create: `web/e2e/instrument-states.spec.ts`
- Modify: `web/components/live/LiveStrip.tsx`, the one `STRIP_RESERVE` line, if the measurement asks for new values
- Test: `web/e2e/instrument-states.spec.ts`

**Interfaces:**
- Consumes:
  - `routeLiveRpc`, `fixtureResults`, `withFeed`, `twapOf`, `SESSION_TS`, `WEEKEND_TS`, `Scenario` and `LiveRpc` from `e2e/fake-live-rpc.ts`, unchanged;
  - `HEAD_MAX_LAG_SEC` and `REFRESH_MS` from `lib/live/freshness`;
  - the strip's DOM (Task 6): `[data-live-strip]` on the Readout, the one `<p>` of block rows, `[data-readout-keys]` and the HOLD key.
- Produces:
  - 42 Chromium tests: 7 frames × 6 widths (360, 640, 1000, 1280, 1440 and 1920 px), each 900 px tall, under reduced motion. The frames are reading, live on the weekend, live in session with every check passing, live with three refusals, stale, behind, and error.
  - Each test checks the frame's words, that no row is empty, and that HOLD is on the bezel. It writes the Readout's natural height to `web/test-results/readout-heights/<frame>-<width>.txt` and a screenshot to `web/test-results/screens/`. It then checks that the natural height fits the fixed one.
  - `STRIP_RESERVE`, set from those files: the tallest frame at each breakpoint's narrowest width, plus 20 px, rounded up to 4 px.

**Why these frames.** They are spec 13's "each state frame at 360, 640, 1000, 1280, 1440 and 1920". The three-refusal frame is the longest text the verdict line can print. Each basket token is refused for a different reason, so the line names all three with their codes.

- [ ] **Step 1: Write the spec**

Create `web/e2e/instrument-states.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { NAV_TOKENS } from "../content/b20-nav";
import { FACTS } from "../content/facts";
import { type CallResult, word } from "../lib/live/abi";
import { HEAD_MAX_LAG_SEC, REFRESH_MS } from "../lib/live/freshness";
import { LIVE_RPCS } from "../lib/live/rpc";
import {
  fixtureResults,
  type LiveRpc,
  routeLiveRpc,
  type Scenario,
  SESSION_TS,
  twapOf,
  WEEKEND_TS,
  withFeed,
} from "./fake-live-rpc";

// Every frame the landing's live Readout can show, at six widths, under reduced motion so each frame is final at once
// (spec 2026-11-23 sections 3.5, 6.2 and 13). Each test writes the Readout's natural height, measured with its fixed
// height lifted, to test-results/readout-heights/<frame>-<width>.txt; STRIP_RESERVE in components/live/LiveStrip.tsx
// comes from those files. No test here touches the network: e2e/fake-live-rpc.ts answers for Base.

const WIDTHS = [360, 640, 1000, 1280, 1440, 1920] as const;
const HEIGHTS = "test-results/readout-heights";
const READING = "Reading Base mainnet…";
const FAILED = "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.";

const strip = (page: Page) => page.locator("#top [data-live-strip]");

/** Each basket feed fresh at its pool's TWAP, 10 s before the in-session block: every market check passes. */
function passAll(): CallResult[] {
  let r = fixtureResults(SESSION_TS);
  for (const symbol of FACTS.basket.value) {
    r = withFeed(r, symbol, twapOf(r, symbol, FACTS.mandate.value.twapWindowSec), SESSION_TS - 10);
  }
  return r;
}

/**
 * The longest verdict the strip can print: each basket token refused for its own reason. The first one's feed is
 * older than maxStalenessSec (FEED_STALE). The second has a multiplier change scheduled an hour after the block
 * (MULTIPLIER_COOLDOWN). The third's feed sits below its pool's TWAP by about 2 × maxPremiumBps + 100 bps
 * (PREMIUM_TOO_HIGH).
 */
function threeRefusals(): CallResult[] {
  const [stale, cooling, premium] = FACTS.basket.value;
  const { maxPremiumBps, maxStalenessSec, twapWindowSec } = FACTS.mandate.value;
  let r = fixtureResults(SESSION_TS);
  for (const symbol of FACTS.basket.value) {
    const twap = twapOf(r, symbol, twapWindowSec);
    const answer = symbol === premium ? (twap * 10_000n) / BigInt(10_000 + 2 * maxPremiumBps + 100) : twap;
    r = withFeed(r, symbol, answer, symbol === stale ? SESSION_TS - maxStalenessSec - 600 : SESSION_TS - 10);
  }
  // effectiveAt: the third of each token's five calls, after the block number and the timestamp.
  const i = NAV_TOKENS.findIndex((t) => t.symbol === cooling);
  if (i < 0) throw new Error(`no NAV token ${cooling}`);
  r[2 + i * 5 + 2] = { success: true, returnData: `0x${word(BigInt(SESSION_TS + 3600))}` };
  return r;
}

interface Frame {
  name: string;
  /** The browser's clock when the page loads, s. */
  clock: number;
  scenario: Scenario;
  /** Keep every answer in flight: the strip stays in its first read, for 8 s per host. */
  hold?: boolean;
  /** What moves the strip on from its first answer to this frame. */
  then?: (page: Page, rpc: LiveRpc) => Promise<void>;
  state: "reading" | "live" | "stale" | "behind" | "error";
  words: readonly string[];
  /** The reason codes the verdict line tags, in basket order. */
  tags?: readonly string[];
}

const FRAMES: readonly Frame[] = [
  { name: "reading", clock: WEEKEND_TS + 5, scenario: "weekend", hold: true, state: "reading", words: [READING] },
  {
    name: "live-weekend",
    clock: WEEKEND_TS + 5,
    scenario: "weekend",
    state: "live",
    words: ["LIVE", "Saturday · NYSE closed", "opens Mon 09:30 ET · in 1 d 23 h", "would REFUSE"],
    tags: ["MARKET_CLOSED"],
  },
  {
    name: "live-session",
    clock: SESSION_TS + 5,
    scenario: { results: passAll(), open: true },
    state: "live",
    words: ["LIVE", "Friday · open until 16:00 ET", "would pass the market checks"],
  },
  {
    name: "live-three-refusals",
    clock: SESSION_TS + 5,
    scenario: { results: threeRefusals(), open: true },
    state: "live",
    words: ["LIVE", "would REFUSE"],
    tags: ["FEED_STALE", "MULTIPLIER_COOLDOWN", "PREMIUM_TOO_HIGH"],
  },
  {
    name: "stale",
    clock: WEEKEND_TS + 5,
    scenario: "weekend",
    then: async (page, rpc) => {
      await expect(strip(page)).toHaveAttribute("data-live-strip", "live");
      rpc.set("down");
      await page.clock.runFor(REFRESH_MS);
    },
    state: "stale",
    words: ["NOT LIVE", "last read block", "the RPC did not answer since"],
  },
  {
    name: "behind",
    clock: WEEKEND_TS + HEAD_MAX_LAG_SEC + 60,
    scenario: "weekend",
    state: "behind",
    words: ["NOT LIVE", "behind your clock"],
  },
  { name: "error", clock: WEEKEND_TS + 5, scenario: "down", state: "error", words: [FAILED, "Retry"] },
];

/** Console errors with the URL each is logged against, so the 503s a frame asks for can be told from real errors. */
function errorsWithUrl(page: Page): { text: string; url: string }[] {
  const errors: { text: string; url: string }[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push({ text: m.text(), url: m.location().url });
  });
  page.on("pageerror", (e) => errors.push({ text: e.message, url: "" }));
  return errors;
}

const originOf = (url: string) => (URL.canParse(url) ? new URL(url).origin : "");

for (const frame of FRAMES) {
  for (const width of WIDTHS) {
    test(`the ${frame.name} frame fits the Readout at ${width} px`, async ({ page }) => {
      const errors = errorsWithUrl(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width, height: 900 });
      await page.clock.install({ time: frame.clock * 1000 });
      const rpc = await routeLiveRpc(page, frame.scenario, { hold: frame.hold });
      await page.goto("/");
      const s = strip(page);
      await frame.then?.(page, rpc);
      await expect(s).toHaveAttribute("data-live-strip", frame.state);
      for (const w of frame.words) await expect(s).toContainText(w);
      if (frame.tags !== undefined) {
        const tags = s.locator("[data-reason-tag]");
        await expect(tags).toHaveCount(frame.tags.length);
        expect(await tags.evaluateAll((els) => els.map((el) => el.getAttribute("data-reason-tag")))).toEqual(frame.tags);
      }
      await page.evaluate(() => document.fonts.ready);

      // Every row of the one <p> holds words, and HOLD is on the bezel in every frame (amendment A7).
      const empty = await s.evaluate(
        (el) => [...el.querySelectorAll(":scope > p > span")].filter((row) => (row.textContent ?? "").trim() === "").length,
      );
      expect(empty).toBe(0);
      await expect(s.locator("[data-readout-keys]").getByRole("button", { name: "Hold" })).toBeVisible();

      // The natural height: the Readout with its fixed height lifted for one measurement.
      const { box, natural } = await s.evaluate((el) => {
        const fixed = el.getBoundingClientRect().height;
        el.style.height = "auto";
        const content = el.getBoundingClientRect().height;
        el.style.height = "";
        return { box: fixed, natural: content };
      });
      mkdirSync(HEIGHTS, { recursive: true });
      writeFileSync(`${HEIGHTS}/${frame.name}-${width}.txt`, `${Math.ceil(natural)}\n`);
      await page.screenshot({ path: `test-results/screens/states-${frame.name}-${width}.png` });
      expect(natural, `${frame.name} at ${width} px needs ${Math.ceil(natural)} px`).toBeLessThanOrEqual(box);

      // The only errors are the 503s the frame asked for; any other error fails the test.
      const expected = errors.filter((e) => LIVE_RPCS.includes(originOf(e.url)) && /status of 503\b/.test(e.text));
      expect(errors.filter((e) => !expected.includes(e))).toEqual([]);
    });
  }
}
```

- [ ] **Step 2: Run it and read the heights**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && rm -rf test-results/readout-heights && npm run build
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/instrument-states.spec.ts --project=chromium --workers=2
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && ls test-results/readout-heights | wc -l
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && node -e 'const fs=require("node:fs");const dir="test-results/readout-heights";const h={};for(const f of fs.readdirSync(dir)){const w=/-(\d+)\.txt$/.exec(f)[1];(h[w]??=[]).push(Number(fs.readFileSync(dir+"/"+f,"utf8")));}const px=(ws)=>Math.ceil((Math.max(...ws.flatMap((w)=>h[w]??[Number.NaN]))+20)/4)*4;console.log(`h-[${px(["360"])}px] sm:h-[${px(["640"])}px] min-[62.5rem]:h-[${px(["1000"])}px] xl:h-[${px(["1280","1440","1920"])}px]`);'
```

Expected:
- The build exits 0, and `netstat` prints nothing.
- Every test gets past its words, its tags, the empty-row check and the HOLD check. Only the last height check may fail: Task 6's `STRIP_RESERVE` is an estimate made before any measurement, and such a failure prints `<frame> at <width> px needs <n> px`.
- If a test fails before its height check, stop and report it with its title and message. That is a defect in Tasks 4-6, not a height to calibrate.
- `wc -l` prints `42`.
- `node` prints one line, of the form `h-[<a>px] sm:h-[<b>px] min-[62.5rem]:h-[<c>px] xl:h-[<d>px]`. If it holds `NaN`, a width has no file: stop and report.

- [ ] **Step 3: Set STRIP_RESERVE from the heights**

If the printed line equals `h-[352px] sm:h-[232px] min-[62.5rem]:h-[296px] xl:h-[232px]`, and Step 2 passed all 42 tests, skip to Step 5.

Otherwise, in `web/components/live/LiveStrip.tsx`, use Edit:
- old_string: `export const STRIP_RESERVE = "h-[352px] sm:h-[232px] min-[62.5rem]:h-[296px] xl:h-[232px]";`
- new_string: the same line with the printed value between the quotes.

Each value is the tallest natural height at that breakpoint's narrowest width (360, 640 and 1000 px, and the tallest of 1280, 1440 and 1920 px for `xl`), plus 20 px, rounded up to 4 px. Do not round a value down, and do not drop the 20 px.

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/instrument-states.spec.ts --project=chromium --workers=2
```

Expected: `42 passed`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-live-readout.test.tsx test/live-strip.test.tsx test/top.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run check:out
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/live.spec.ts e2e/smoke.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. `instrument-live-readout.test.tsx` checks the shape of `STRIP_RESERVE`, not its numbers, and checks that the Readout carries each of its classes.
- The typecheck exits 0. The typecheck covers `e2e/`, since `tsconfig.json` includes every `.ts` file.
- `check:out` exits 0.
- `netstat` prints nothing.
- Every `live.spec.ts` and `smoke.spec.ts` test passes on Chromium. That includes the "the landing does not move" tests and no page scroll at 360 px.

Write down the `STRIP_RESERVE` value for Task 15.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-13.txt`:

```
test(web): measure every live frame at six widths and size the Readout from it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Stage `web/components/live/LiveStrip.tsx` only if Step 3 changed it. With the change:

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/e2e/instrument-states.spec.ts web/components/live/LiveStrip.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-13.txt"
```

Without it:

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/e2e/instrument-states.spec.ts
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-13.txt"
```

---

### Task 14: The first viewport, the ThumbBar, HOLD and the docked plate, end to end

**Files:**
- Create: `web/e2e/instrument.spec.ts`
- Modify: `web/components/sections/Hero.tsx`, two class strings, only if the 1440 test misses the fold (the fallback in Step 3)
- Test: `web/e2e/instrument.spec.ts`

**Interfaces:**
- Consumes:
  - `routeLiveRpc` and `WEEKEND_TS` (`e2e/fake-live-rpc.ts`), and `measureFit` (`e2e/helpers.ts`);
  - `REFRESH_MS` and `LIVE_RPCS`;
  - the DOM of Tasks 6-11: `[data-live-strip]`, `.readout-digits`, `[data-verdict-line]`, `[data-read-age]`, the HOLD key, `[data-hero-cta]`, `[data-thumb-bar]` and `[data-docked-plate]`.
- Produces: 8 Chromium tests for spec 11 items 1, 2 and 12 and spec 13's `instrument.spec.ts`:
  - the first viewport at 1440x900 and at 390x844;
  - the status-region counts;
  - the ThumbBar;
  - no sideways scroll at 360;
  - HOLD on the page's one read loop;
  - the docked plate on `/gap-index`;
  - axe on the live hero.

  The 390 test also writes the CTAs' bottom edge to `web/test-results/fold/cta-bottom-390.txt`, which decides amendment A10.

**Review Focus 1** is pinned here by the HOLD test, with the ThumbBar mounted.

- [ ] **Step 1: Write the spec**

Create `web/e2e/instrument.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { REFRESH_MS } from "../lib/live/freshness";
import { LIVE_RPCS } from "../lib/live/rpc";
import { routeLiveRpc, WEEKEND_TS } from "./fake-live-rpc";
import { collectErrors, measureFit } from "./helpers";

// The landing's first viewport and the hero instrument end to end (spec 2026-11-23 sections 6.2, 11 and 13), against
// the fake RPC of e2e/fake-live-rpc.ts. Each landing test sets the browser's clock 5 s after the weekend block, so the
// reading is LIVE. The clock then runs on in real time, unless a test moves it with runFor.

const strip = (page: Page) => page.locator("#top [data-live-strip]");
const bottom = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().bottom);

async function liveWeekend(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: (WEEKEND_TS + 5) * 1000 });
  const rpc = await routeLiveRpc(page, "weekend");
  await page.goto("/");
  await expect(strip(page)).toHaveAttribute("data-live-strip", "live");
  await page.evaluate(() => document.fonts.ready);
  return rpc;
}

/** Puts `selector` at the top (or the bottom) of the screen at once, past the page's smooth scrolling. */
const scrollTo = (page: Page, selector: string, block: ScrollLogicalPosition = "start") =>
  page.evaluate(({ s, b }) => document.querySelector(s)!.scrollIntoView({ block: b, behavior: "instant" }), {
    s: selector,
    b: block,
  });

test("at 1440x900 the H1, both CTAs, the live Readout, its block and its verdict line are in the first screen", async ({
  page,
}) => {
  await liveWeekend(page, 1440, 900);
  const s = strip(page);
  await expect(s.locator(".readout-digits")).toHaveText("60,013,066");
  const parts: [string, Locator][] = [
    ["H1", page.getByRole("heading", { level: 1 })],
    ["Readout", s],
    ["block", s.getByRole("link", { name: "Base block 60,013,066" })],
    ["verdict line", s.locator("[data-verdict-line]")],
  ];
  const ctas = await page.locator("[data-hero-cta]").all();
  expect(ctas).toHaveLength(2);
  for (const cta of ctas) parts.push([`CTA ${await cta.textContent()}`, cta]);
  // Soft, so a miss reports every part's bottom edge, which Step 3's fallback reads.
  for (const [name, l] of parts) expect.soft(await bottom(l), name).toBeLessThanOrEqual(900);
});

test("at 390x844 the H1 and the live verdict line are in the first screen", async ({ page }) => {
  await liveWeekend(page, 390, 844);
  expect(await bottom(page.getByRole("heading", { level: 1 })), "H1").toBeLessThanOrEqual(844);
  expect(await bottom(strip(page).locator("[data-verdict-line]")), "verdict line").toBeLessThanOrEqual(844);
  // Amendment A10 applies only if the CTAs end below the first screen here.
  const ctaBottoms = await Promise.all((await page.locator("[data-hero-cta]").all()).map(bottom));
  mkdirSync("test-results/fold", { recursive: true });
  writeFileSync("test-results/fold/cta-bottom-390.txt", `${Math.ceil(Math.max(...ctaBottoms))}\n`);
});

test("#top keeps two status regions, the engine's verdict window is the only div in them, and the Balance is outside both", async ({
  page,
}) => {
  await liveWeekend(page, 1440, 900);
  await expect(page.locator('#top [role="status"]')).toHaveCount(2);
  await expect(page.locator('#top [role="status"] > div')).toHaveCount(1);
  await expect(page.locator("#top svg.balance")).toHaveCount(1);
  await expect(page.locator('#top [role="status"] svg.balance, #top [aria-label="Mandate checks"] svg.balance')).toHaveCount(0);
});

test("on a phone the ThumbBar rises once both CTAs are above the screen, and steps aside over #try and the footer", async ({
  page,
}) => {
  await liveWeekend(page, 390, 844);
  const bar = page.locator("[data-thumb-bar]");
  await expect(bar).toHaveCount(0);
  await scrollTo(page, "#how");
  await expect(bar).toHaveAttribute("data-thumb-bar", "shown");
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-lamp]")).toHaveAttribute("data-lamp", "refuse");
  await expect(bar.getByRole("link", { name: "Try to make it say no" })).toHaveAttribute("href", "#try");
  await scrollTo(page, "#try");
  await expect(bar).toHaveAttribute("data-thumb-bar", "hidden");
  await expect(bar).toHaveAttribute("inert", "");
  await scrollTo(page, "#how");
  await expect(bar).toHaveAttribute("data-thumb-bar", "shown");
  await scrollTo(page, "footer", "end");
  await expect(bar).toHaveAttribute("data-thumb-bar", "hidden");
  await scrollTo(page, "#how");
  await expect(bar).toHaveAttribute("data-thumb-bar", "shown");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(bar).toBeHidden();
});

test("nothing scrolls sideways at 360 px, with the live Readout and with the ThumbBar up", async ({ page }) => {
  await liveWeekend(page, 360, 800);
  const first = await measureFit(page);
  expect(first.overflow).toBeLessThanOrEqual(0);
  expect(first.clipped).toEqual([]);
  await scrollTo(page, "#how");
  await expect(page.locator("[data-thumb-bar]")).toHaveAttribute("data-thumb-bar", "shown");
  const scrolled = await measureFit(page);
  expect(scrolled.overflow).toBeLessThanOrEqual(0);
  expect(scrolled.clipped).toEqual([]);
});

test("HOLD holds the page at one read through two refresh intervals, and one interval after release adds one more", async ({
  page,
}) => {
  const rpc = await liveWeekend(page, 1440, 900);
  const s = strip(page);
  expect(rpc.calls()).toBe(1);
  const hold = s.locator("[data-readout-keys]").getByRole("button", { name: "Hold" });
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "true");
  await expect(s.locator("[data-read-age]")).toContainText("held · ");
  await page.clock.runFor(2 * REFRESH_MS);
  expect(rpc.calls()).toBe(1);
  await expect(s).toHaveAttribute("data-live-strip", "live");
  await hold.click();
  await expect(hold).toHaveAttribute("aria-pressed", "false");
  // Held for longer than REFRESH_MS, so the release reads at once (Task 1).
  await expect.poll(() => rpc.calls()).toBe(2);
  await page.clock.runFor(REFRESH_MS);
  await expect.poll(() => rpc.calls()).toBe(3);
});

test("/gap-index shows the docked plate unlit, linked to /now, and reads no chain", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  const rpc = await routeLiveRpc(page, "weekend");
  const rpcRequests: string[] = [];
  page.on("request", (r) => {
    if (LIVE_RPCS.some((host) => r.url().startsWith(host))) rpcRequests.push(r.url());
  });
  await page.goto("/gap-index", { waitUntil: "networkidle" });
  const plate = page.getByRole("navigation", { name: "Main" }).locator("[data-docked-plate]");
  await expect(plate).toBeVisible();
  await expect(plate).toHaveAttribute("data-docked-plate", "unlit");
  await expect(plate).toHaveAttribute("href", "/now");
  await expect(plate).toHaveText("Live on / and /now");
  await expect(plate.locator("[data-lamp]")).toHaveAttribute("data-lamp", "reading");
  expect(rpc.calls()).toBe(0);
  expect(rpcRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("the live hero has no serious or critical axe violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await liveWeekend(page, 1440, 900);
  const { violations } = await new AxeBuilder({ page }).include("#top").analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking).toEqual([]);
});
```

- [ ] **Step 2: Run it**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/instrument.spec.ts --project=chromium --workers=2
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && cat test-results/fold/cta-bottom-390.txt
```

These tests check parts that Tasks 6-12 built, so they are expected to pass at once: `8 passed`. One failure is planned for: the 1440 test may report a part whose bottom is past 900 px, because the hero's height there was estimated at 855-883 px before any measurement.

The `cat` prints the CTAs' bottom edge at 390x844, in px. Write it down for Task 15. If it is above 844, amendment A10 is not needed. If it is past 844, A10 applies.

If any test other than the 1440 one fails, stop and report it with its title and message.

- [ ] **Step 3: The fold fallback, only if the 1440 test failed**

Read the failure's numbers. The test's checks are soft, so it prints the bottom edge of every part past 900 px. The fallback is these two Edits in `web/components/sections/Hero.tsx`:
- old_string `pb-16 pt-8 sm:pb-24 sm:pt-10 md:gap-14`, new_string `pb-16 pt-8 sm:pb-24 sm:pt-6 md:gap-14`. This saves 16 px for every part.
- old_string `<div className="flex flex-col gap-5">`, new_string `<div className="flex flex-col gap-4">`. This saves 4 px for each gap above a part. The column's children are the AGENTIC pill, the H1, the strip, the lead, the CTAs and the spec plate, so there is one gap above the H1, two above the strip and four above the CTAs.

So each part gains:

| Part | Gaps above it | Gain |
|---|---|---|
| H1 | 1 | 16 + 4 = 20 px |
| Readout, its block link and its verdict line | 2 | 16 + 8 = 24 px |
| both CTAs | 4 | 16 + 16 = 32 px |

The CTAs sit lowest, so they miss first and by the most. Make both Edits only if every part past 900 px misses by no more than its own gain. If any part misses by more than its own gain, make no Edit, then stop and report every part's bottom edge. That is a stop condition of Global Constraints: the fallback does not cover it.

Skip this step if Step 2 passed all 8.

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/instrument.spec.ts --project=chromium --workers=2
```

Expected: `8 passed`. If Step 3 changed the Hero, run `cat test-results/fold/cta-bottom-390.txt` again and write down the new value.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-hero.test.tsx test/top.test.tsx test/page.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/smoke.spec.ts e2e/live.spec.ts e2e/instrument-states.spec.ts --project=chromium --workers=2
```

Expected:
- Every vitest file passes. `instrument-hero.test.tsx` pins neither the padding nor the gap, so the fallback leaves it green.
- The typecheck exits 0.
- `netstat` prints nothing.
- Every test of the three specs passes on Chromium, with `42` from `instrument-states.spec.ts`. The Readout's height does not depend on the hero's padding.

- [ ] **Step 6: Commit**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-14.txt`:

```
test(web): check the first viewport, the ThumbBar, HOLD and the docked plate end to end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Stage `web/components/sections/Hero.tsx` only if Step 3 changed it. With the change:

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/e2e/instrument.spec.ts web/components/sections/Hero.tsx
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-14.txt"
```

Without it:

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/e2e/instrument.spec.ts
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-14.txt"
```

---

### Task 15: The full gate, the push and the PR

**Files:**
- Create: `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-pr-body.md`, outside the repo
- Modify: none, unless Step 3 merges a moved base
- Test: the full gate

**Interfaces:**
- Consumes: Tasks 0-14, and the values written down in Tasks 12, 13 and 14:
  - the weight log line;
  - `STRIP_RESERVE`;
  - the CTAs' bottom at 390x844.
- Produces: `feat/hero-instrument` pushed to `origin`, and one open PR. Its base is `main` if P0 has merged, otherwise `feat/instrument-primitives`. Do not merge it in this run. P0 merges first (spec 12.1), and a PR stacked on `feat/instrument-primitives` must never merge into that branch.

- [ ] **Step 1: The full gate**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run verify
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- --workers=2
```

Expected:
- `npm run verify` runs the typecheck, vitest, the build and `check:out`, and exits 0.
- `netstat` prints nothing.
- The e2e run passes every Chromium spec. That includes `instrument-states.spec.ts` (42), `instrument.spec.ts` (8), `weight.spec.ts`, `live.spec.ts`, `smoke.spec.ts`, `simulator.spec.ts`, `gap-index.spec.ts`, `docs.spec.ts` and `docs-a11y.spec.ts`. `smoke.spec.ts` also passes on WebKit and Firefox.
- Write down the line that starts `landing weight, gzip -9:`.

If a test that passed at Task 0 now fails, stop and report it with its title.

- [ ] **Step 2: Only the planned files changed**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument diff --name-status origin/feat/instrument-primitives...HEAD
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument log --oneline origin/feat/instrument-primitives..HEAD
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument status --porcelain
```

Expected: the name-status lists exactly 34 paths.
- `M` for 11 files:
  - `web/app/(site)/page.tsx`, `web/app/(site)/gap-index/page.tsx` and `web/app/globals.css`;
  - `web/components/DecisionEngine.tsx`, `web/components/Simulator.tsx`, `web/components/gap/TokenTabs.tsx` and `web/components/sections/Hero.tsx`;
  - `web/components/live/LiveStatus.tsx`, `LiveStrip.tsx`, `VerdictLine.tsx` and `useLiveSnapshot.ts`.
- `A` for 23 files:
  - `web/components/instrument/DockedPlate.tsx`, `HoldKey.tsx`, `ThumbBar.tsx`, `useScan.ts` and `useTipDrag.ts`;
  - `web/components/live/LiveSnapshotProvider.tsx` and `web/lib/live/countdown.ts`;
  - `web/test/helpers/fake-reader.ts`;
  - 13 test files: `web/test/live-snapshot-active.test.tsx`, `live-snapshot-provider.test.tsx` and `live-countdown.test.ts`, then the `web/test/instrument-*` files for the hold key, the chassis palette, the scan, the live Readout, the engine Balance, the hero, the colour transitions, the ThumbBar, the docked plate and the tip drag;
  - `web/e2e/instrument-states.spec.ts` and `web/e2e/instrument.spec.ts`.

If Task 12 was skipped, there are 32 paths: `useTipDrag.ts` and `instrument-tip-drag.test.tsx` are not there.

The log shows 14 commits, `p1-commit-01` to `p1-commit-14`, or 13 without Task 12. The status is empty. No path in the list is a frozen file of Global Constraints.

- [ ] **Step 3: Bring in a base that has moved**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon fetch origin
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument && gh pr list --head feat/instrument-primitives --state merged --json number --jq length
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument merge-base --is-ancestor origin/feat/instrument-primitives HEAD; echo $?
```

Pick one case and write down `BASE`.
- **`gh` prints `1`.** P0 has merged, so `BASE` is `main`. Merge `origin/main` in, as below.
- **`gh` prints `0` and `merge-base` prints `1`.** P0 is still open, but its branch has moved on, for example through P0 Task 17. `BASE` is `feat/instrument-primitives`. Merge `origin/feat/instrument-primitives` in, as below.
- **`gh` prints `0` and `merge-base` prints `0`.** `BASE` is `feat/instrument-primitives`. There is nothing to merge, so skip to Step 4.

To merge, with `REF` as `origin/main` or `origin/feat/instrument-primitives`:

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument merge --no-ff --no-commit REF
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument status --porcelain
```

Expected: `Automatic merge went well; stopped before committing as requested`, and no status line starts with `UU`, `AA`, `DU` or `UD`. On a conflict, run `git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument merge --abort`, then stop and report the conflicting paths.

The merge stages its own result, so stage nothing else. Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-15.txt`:

```
chore(web): merge the moved base into the hero instrument

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-15.txt"
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm ci
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run verify
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- --workers=2
```

Expected: `npm ci` prints `added <n> packages` with no `npm ERR!`. `verify` exits 0, `netstat` prints nothing, and the e2e run passes as in Step 1. If `main` brought PR #15 in, PR #15's `ledger.spec.ts` and its `top.test.tsx` pass too. A failure here is a stop condition: report it with the failing titles.

- [ ] **Step 4: Push the branch**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument push -u origin feat/hero-instrument
```

Expected: `branch 'feat/hero-instrument' set up to track 'origin/feat/hero-instrument'`. Never force push.

- [ ] **Step 5: Open the PR**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-pr-body.md` with the Write tool. Use the text below. Put the values you wrote down in the four lines that name them, and keep only the true one of the two A10 sentences. Drop the drag line from "What" if Task 12 was skipped, and drop the "Not in this PR" drag line if it was not.

```markdown
## What

Phase P1 of the Maat web instrument: the hero instrument (spec `docs/superpowers/specs/2026-11-23-maat-web-instrument-design.md`, section 12.1, the P1 row with amendment A3). It mounts P0's parts on the landing hero:

- one `LiveSnapshotProvider` per page, the landing's only read loop, with HOLD;
- the live strip in a chassis Readout, with block digits, the countdown to the next NYSE open, basket lamps and premium meters, and bezel keys;
- the verdict-first engine card, with the Balance and its CSS intro;
- the H1 and H2 scale, the tick ruler, both CTAs, and the spec plate marked with `data-fact`;
- the phone ThumbBar;
- the 120 ms colour tick on nav links, pills and chips;
- the unlit docked plate in the `/gap-index` header;
- drag-to-tip on the needle spring, loaded on the first press.

## Checks

- `npm run verify` and the full Playwright run pass, with smoke on WebKit and Firefox.
- New e2e: `instrument-states.spec.ts` (7 live frames at 6 widths) and `instrument.spec.ts` (the first viewport, the status regions, the ThumbBar, 360 px, HOLD, the docked plate, axe).
- Weight: the `landing weight, gzip -9:` line from the run.
- Readout height: the `STRIP_RESERVE` value from Task 13.
- CTAs at 390x844: their bottom edge in px, from Task 14.
- A10 applies: the CTAs sit just below the first screen at 390x844. / A10 is not needed: the CTAs end inside the first screen at 390x844.

## Spec amendments

The plan's amendments A4 to A9 (and A10 when it applies) go to the spec on `docs/web-instrument-spec`. This PR follows them.

## Not in this PR

- Drag-to-tip, cut under spec 12.3.
- The nav's opaque bar and docked readout: they follow on this branch only once PR #15 has merged, otherwise in P4.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then, with `BASE` from Step 3:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument && gh pr create --base BASE --head feat/hero-instrument --title "feat(web): mount the hero instrument (M-9 P1)" --body-file 'C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-pr-body.md'
```

Expected: the PR's URL. Do not merge it.

- [ ] **Step 6: Report**

Report back with:
- the PR URL and its base;
- the commit subjects;
- the weight log line;
- the `STRIP_RESERVE` value;
- the CTAs' bottom at 390x844, and whether A10 applies;
- whether Task 12 was skipped;
- any stop condition you met.

Task 16 is a separate run, and only after PR #15 has merged.

---

### Task 16: After PR #15, the opaque nav bar and the docked readout

Run this task only once PR #15 has merged into `main`, and only if it can be done by Wed 25 Nov 2026 12:00 UTC. Otherwise skip it: P1 merges without it, and the nav moves to P4.

**Files:**
- Create: `web/components/live/NavDock.tsx`
- Modify: `web/components/sections/Nav.tsx`, the whole file (38 lines at PR #15's `b49df92`)
- Modify: `web/app/globals.css` (a new block before the global reduced-motion block)
- Test: `web/test/instrument-nav-dock.test.tsx`, `web/e2e/instrument-nav.spec.ts`

**Interfaces:**
- Consumes:
  - `useLiveIfAny()` (Task 2);
  - `formatBlock` from `@/lib/live/format`;
  - PR #15's `Nav({ onLanding = true })`, with its `LINKS` (`/ledger` among them) and its `to()` helper;
  - `#top` (Task 8).
- Produces:
  - `NavBar({ children })`, `"use client"`. It renders `div[data-nav-bar].nav-bar`, which is white and sticky from lg (1024 px). Below lg the nav can wrap to two rows (at 768 px its links need about 780 px of a 704 px row), so it scrolls away with the page there. A passive scroll listener sets `data-scrolled` once `scrollY > 0`.
  - `NavDock()`, `"use client"`. It renders `span[data-nav-dock]` only while `#top` is out of view and the page's reading is live. The span is aria-hidden, shown from xl only, and reads "● 60,013,066 · Saturday · NYSE closed". It renders nothing without a provider and nothing without IntersectionObserver.
  - `Nav`: wrapped in `NavBar`, with `NavDock` as the last child of its links, and only when `onLanding`. Its links are unchanged.
  - The CSS: `.nav-bar` and its hairline on the 120 ms tick. From lg, and only on a page that has the bar, `html:has([data-nav-bar]) [id] { scroll-margin-top: 96px }`, so an anchor lands below the pinned bar. `/now` and `/gap-index` load the same `globals.css` but render no `Nav`, so their anchors keep the base 16 px.

- [ ] **Step 1: Check that the task can run**

```bash
date -u +%Y-%m-%dT%H:%MZ
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument && gh pr view 15 --json state,mergeCommit --jq '.state + " " + .mergeCommit.oid'
git -C E:/APP2028/stocks-maxxing-hackathon fetch origin
git -C E:/APP2028/stocks-maxxing-hackathon diff --quiet b49df92 origin/main -- web/components/sections/Nav.tsx; echo $?
```

Expected:
- The date is before `2026-11-25T12:00Z`. If not, skip this task and report it.
- `MERGED <sha>`. If the state is anything else, skip this task and report it.
- `0`: `main`'s `Nav.tsx` is PR #15's text at `b49df92`. If it prints `1`, stop and report. The file below is written against that text.

- [ ] **Step 2: Bring PR #15 in**

If the P1 PR's base is `main` (Task 15 Step 3), `REF` is `origin/main`.

If the base is `feat/instrument-primitives`, P0 must already hold PR #15, through P0 Task 17. Check:

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument merge-base --is-ancestor <the sha from Step 1> origin/feat/instrument-primitives; echo $?
```

`0` means `REF` is `origin/feat/instrument-primitives`. `1` means P0 Task 17 has not run, so skip this task and report it. A P1 branch that merged `main` itself would bring PR #15's whole diff into a PR stacked on P0.

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument merge --no-ff --no-commit REF
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument status --porcelain
```

Expected: `Automatic merge went well; stopped before committing as requested`, and no status line starts with `UU`, `AA`, `DU` or `UD`. On a conflict, run `git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument merge --abort`, then stop and report the conflicting paths.

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-16.txt`:

```
chore(web): merge PR #15 into the hero instrument

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-16.txt"
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm ci
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/top.test.tsx test/page.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run typecheck
```

Expected: `npm ci` prints `added <n> packages` with no `npm ERR!`. Both test files pass. `top.test.tsx` is now PR #15's version, which pins the `/ledger` link. The typecheck exits 0.

- [ ] **Step 3: Write the failing tests**

Create `web/test/instrument-nav-dock.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSnapshotProvider } from "@/components/live/LiveSnapshotProvider";
import { NavBar, NavDock } from "@/components/live/NavDock";
import { Nav } from "@/components/sections/Nav";
import { formatBlock } from "@/lib/live/format";
import { SITE } from "@/lib/site";
import { advance, BLOCK, fakeReader, installLiveClocks, SAT } from "./helpers/fake-reader";

installLiveClocks();

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const css = read("app/globals.css");

/** An IntersectionObserver the test drives. */
class FakeIO {
  static all: FakeIO[] = [];
  callback: IntersectionObserverCallback;
  targets: Element[] = [];
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  report(target: Element, isIntersecting: boolean) {
    const entry = { target, isIntersecting } as IntersectionObserverEntry;
    act(() => this.callback([entry], this as unknown as IntersectionObserver));
  }
}

const observing = (el: Element) => FakeIO.all.find((o) => o.targets.includes(el))!;
const setScrollY = (y: number) => Object.defineProperty(window, "scrollY", { configurable: true, writable: true, value: y });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  FakeIO.all = [];
  setScrollY(0);
});

describe("the nav bar and its docked reading (spec 2026-11-23 sections 6.1 and 7.5)", () => {
  it("marks the bar once the page has scrolled, from one passive listener that it removes on unmount", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    setScrollY(0);
    const { container, unmount } = render(
      <NavBar>
        <span />
      </NavBar>,
    );
    const bar = container.querySelector("[data-nav-bar]")!;
    expect(bar).not.toHaveAttribute("data-scrolled");
    setScrollY(120);
    fireEvent.scroll(window);
    expect(bar).toHaveAttribute("data-scrolled", "");
    setScrollY(0);
    fireEvent.scroll(window);
    expect(bar).not.toHaveAttribute("data-scrolled");
    const listener = add.mock.calls.find(([type]) => type === "scroll");
    expect(listener?.[2]).toEqual({ passive: true });
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", listener?.[1]);
  });

  it("docks the page's live reading once #top has left the screen, on the page's one read loop", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.setSystemTime((SAT + 14) * 1000);
    const fake = fakeReader({ timestamp: SAT });
    const { container } = render(
      <LiveSnapshotProvider reader={fake.reader}>
        <header id="top" />
        <NavDock />
      </LiveSnapshotProvider>,
    );
    await advance(0);
    const top = container.querySelector("#top")!;
    const dock = () => container.querySelector<HTMLElement>("[data-nav-dock]");
    observing(top).report(top, true);
    expect(dock()).toBeNull();
    observing(top).report(top, false);
    expect(dock()).toHaveTextContent(`● ${formatBlock(BLOCK)} · Saturday · NYSE closed`);
    expect(dock()).toHaveAttribute("aria-hidden", "true");
    expect(dock()!.className.split(" ")).toEqual(expect.arrayContaining(["hidden", "xl:inline-flex"]));
    observing(top).report(top, true);
    expect(dock()).toBeNull();
    expect(fake.multicalls()).toBe(1);
  });

  it("docks nothing for a reading that is not live, nor without a provider or an observer", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.setSystemTime((SAT + 14) * 1000);
    const fake = fakeReader({ timestamp: SAT });
    fake.hold();
    const reading = render(
      <LiveSnapshotProvider reader={fake.reader}>
        <header id="top" />
        <NavDock />
      </LiveSnapshotProvider>,
    );
    await advance(0);
    const top = reading.container.querySelector("#top")!;
    observing(top).report(top, false);
    expect(reading.container.querySelector("[data-nav-dock]")).toBeNull();
    reading.unmount();
    expect(FakeIO.all.every((o) => o.disconnected)).toBe(true);

    const alone = render(
      <>
        <header id="top" />
        <NavDock />
      </>,
    );
    const aloneTop = alone.container.querySelector("#top")!;
    observing(aloneTop).report(aloneTop, false);
    expect(alone.container.querySelector("[data-nav-dock]")).toBeNull();
    alone.unmount();

    vi.stubGlobal("IntersectionObserver", undefined);
    FakeIO.all = [];
    render(
      <>
        <header id="top" />
        <NavDock />
      </>,
    );
    expect(FakeIO.all).toHaveLength(0);
    expect(document.querySelector("[data-nav-dock]")).toBeNull();
  });

  it("wraps the nav in the bar, keeps PR #15's links, and docks the reading on the landing only", () => {
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.parentElement).toHaveAttribute("data-nav-bar");
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["maat", "#top"],
      ["How it works", "#how"],
      ["Refusals", "#reasons"],
      ["Try it", "#try"],
      ["Ledger", "/ledger"],
      ["Mandate", "#mandate"],
      ["Docs", SITE.docsUrl],
      ["View on GitHub ↗", SITE.repoUrl],
    ]);
    expect(read("components/sections/Nav.tsx")).toContain("{onLanding ? <NavDock /> : null}");
  });

  it("draws the hairline on the 120 ms tick, and from lg lands anchors below the pinned bar, on pages that have it", () => {
    expect(css).toMatch(
      /\.nav-bar\s*\{\s*border-bottom:\s*1px solid transparent;\s*transition:\s*border-color var\(--t-tick\) var\(--ease-instrument\);\s*\}/,
    );
    expect(css).toMatch(/\.nav-bar\[data-scrolled\]\s*\{\s*border-bottom-color:\s*var\(--color-line\);\s*\}/);
    expect(css).toMatch(
      /@layer base\s*\{\s*@media \(min-width: 64rem\)\s*\{\s*html:has\(\[data-nav-bar\]\) \[id\]\s*\{\s*scroll-margin-top:\s*96px;\s*\}\s*\}\s*\}/,
    );
  });
});
```

Create `web/e2e/instrument-nav.spec.ts`:

```ts
import { expect, type Page, test } from "@playwright/test";
import { LIVE_RPCS } from "../lib/live/rpc";
import { routeLiveRpc, WEEKEND_TS } from "./fake-live-rpc";

// The nav bar and its docked reading (spec 2026-11-23 sections 6.1 and 7.5), against the fake RPC of
// e2e/fake-live-rpc.ts. The landing tests set the browser's clock 5 s after the weekend block, so the reading is LIVE.

const navBar = (page: Page) => page.locator("[data-nav-bar]");
const dock = (page: Page) => page.locator("[data-nav-dock]");

async function liveWeekend(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: (WEEKEND_TS + 5) * 1000 });
  await routeLiveRpc(page, "weekend");
  await page.goto("/");
  await expect(page.locator("#top [data-live-strip]")).toHaveAttribute("data-live-strip", "live");
}

const scrollTo = (page: Page, selector: string) =>
  page.evaluate((s) => document.querySelector(s)!.scrollIntoView({ block: "start", behavior: "instant" }), selector);
const scrollHome = (page: Page) => page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

test("from lg the nav stays at the top, white, with a hairline once the page has scrolled", async ({ page }) => {
  await liveWeekend(page, 1440);
  await expect(navBar(page)).not.toHaveAttribute("data-scrolled");
  await scrollTo(page, "#how");
  await expect(navBar(page)).toHaveAttribute("data-scrolled", "");
  expect(await navBar(page).evaluate((el) => el.getBoundingClientRect().top)).toBe(0);
  expect(await navBar(page).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
  await expect.poll(() => navBar(page).evaluate((el) => getComputedStyle(el).borderBottomColor)).not.toBe("rgba(0, 0, 0, 0)");
  await scrollHome(page);
  await expect(navBar(page)).not.toHaveAttribute("data-scrolled");
});

test("on the landing the nav docks the live reading once the hero has gone, from xl only", async ({ page }) => {
  await liveWeekend(page, 1440);
  await expect(dock(page)).toHaveCount(0);
  await scrollTo(page, "#how");
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toHaveText("● 60,013,066 · Saturday · NYSE closed");
  await expect(dock(page)).toHaveAttribute("aria-hidden", "true");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(dock(page)).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollHome(page);
  await expect(dock(page)).toHaveCount(0);
});

// Below lg the nav can wrap to two rows (at 768 px it does), so it is not pinned there: on a phone, nor at 800 px.
for (const [width, height] of [
  [390, 844],
  [800, 900],
] as const) {
  test(`below lg, at ${width} px, the nav scrolls away with the page`, async ({ page }) => {
    await liveWeekend(page, width, height);
    await scrollTo(page, "#how");
    expect(await navBar(page).evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
  });
}

for (const width of [1024, 1440]) {
  test(`from lg, at ${width} px, a nav link lands its section below the pinned bar`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await liveWeekend(page, width);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Try it" }).click();
    await expect(page).toHaveURL(/#try$/);
    const navBottom = await navBar(page).evaluate((el) => el.getBoundingClientRect().bottom);
    const sectionTop = await page.locator("#try").evaluate((el) => el.getBoundingClientRect().top);
    expect(sectionTop).toBeGreaterThanOrEqual(navBottom - 1);
  });
}

test("/ledger keeps the bar without a docked reading, and reads no chain", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Serve a deployments file that names no vault, so /ledger stays in its waiting view and reads nothing from Base,
  // whatever deployments/README.md records by the time this runs. PR #15's ledger client uses the same two hosts.
  await page.route("**/data/deployments.json", (r) =>
    r.fulfill({ json: { network: "Base mainnet", chainId: 8453, vault: null, deployTx: null, contracts: [] } }),
  );
  const rpc = await routeLiveRpc(page, "weekend");
  const rpcRequests: string[] = [];
  page.on("request", (r) => {
    if (LIVE_RPCS.some((host) => r.url().startsWith(host))) rpcRequests.push(r.url());
  });
  await page.goto("/ledger", { waitUntil: "networkidle" });
  await expect(navBar(page)).toHaveCount(1);
  await page.mouse.wheel(0, 1500);
  await expect(navBar(page)).toHaveAttribute("data-scrolled", "");
  await expect(dock(page)).toHaveCount(0);
  expect(rpc.calls()).toBe(0);
  expect(rpcRequests).toEqual([]);
});
```

- [ ] **Step 4: Run them and see them fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-nav-dock.test.tsx
```

Expected: the file fails with `Failed to resolve import "@/components/live/NavDock"`.

- [ ] **Step 5: Write the minimal implementation**

Create `web/components/live/NavDock.tsx`:

```tsx
"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { formatBlock } from "@/lib/live/format";
import { useLiveIfAny } from "./LiveSnapshotProvider";

/**
 * The nav's bar (spec 2026-11-23 sections 6.1 and 7.5): white and, from lg, pinned to the top of the screen, with a
 * hairline under it once the page has scrolled. Below lg the nav can wrap to two rows, so it scrolls away with the
 * page. One passive scroll listener sets data-scrolled; nothing else runs on scroll.
 */
export function NavBar({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (el === null) return;
    const update = () => el.toggleAttribute("data-scrolled", window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <div ref={bar} data-nav-bar="" className="nav-bar relative z-30 bg-white lg:sticky lg:top-0">
      {children}
    </div>
  );
}

/**
 * The docked mini readout (spec 6.1): once the hero has scrolled out of view, the nav repeats the page's one reading
 * as "● 60,013,066 · Saturday · NYSE closed", from xl only. It shows a live reading and nothing else. It reads the page's
 * LiveSnapshotProvider, never a loop of its own, and it is aria-hidden, because the strip's announcer is the page's
 * one live region.
 */
export function NavDock() {
  const live = useLiveIfAny();
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const top = document.getElementById("top");
    if (top === null) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setDocked(!e.isIntersecting);
    });
    io.observe(top);
    return () => io.disconnect();
  }, []);
  const state = live?.state;
  if (!docked || state === undefined || state.status !== "live") return null;
  const { snapshot, session } = state.reading;
  return (
    <span
      data-nav-dock=""
      aria-hidden="true"
      className="ml-3 hidden items-center gap-1.5 font-mono text-[11px] text-label xl:inline-flex"
    >
      <span className="text-accent">●</span> {formatBlock(snapshot.block)} · {session.detail}
    </span>
  );
}
```

Read `web/components/sections/Nav.tsx`, then replace the whole file with:

```tsx
import { NavBar, NavDock } from "@/components/live/NavDock";
import { Mark } from "@/components/ui/Mark";
import { SITE } from "@/lib/site";

// Section anchors on the landing; "Ledger" is its own page, /ledger, with the fork run and the mainnet vault.
const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#reasons", label: "Refusals" },
  { href: "#try", label: "Try it" },
  { href: "/ledger", label: "Ledger" },
  { href: "#mandate", label: "Mandate" },
] as const;

/**
 * The site's top bar, in NavBar: white, and pinned from lg. Off the landing (`onLanding={false}`), its section anchors
 * point back at the landing. On the landing it docks the page's live reading once the hero has scrolled away.
 */
export function Nav({ onLanding = true }: { onLanding?: boolean }) {
  const to = (href: string) => (onLanding || !href.startsWith("#") ? href : `/${href}`);
  return (
    <NavBar>
      <nav aria-label="Main" className="wrap flex flex-wrap items-center justify-between gap-3 py-[18px]">
        <a href={onLanding ? "#top" : "/"} aria-label="Maat home" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="text-[21px] font-semibold tracking-[-0.03em]">maat</span>
        </a>
        <div className="flex flex-wrap items-center gap-1">
          {LINKS.map((l) => (
            <a key={l.href} href={to(l.href)} className="navlink max-[720px]:hidden">
              {l.label}
            </a>
          ))}
          <a href={SITE.docsUrl} className="navlink">
            Docs
          </a>
          <a href={SITE.repoUrl} className="pill-dark ml-2 px-[18px] py-[11px]">
            View on GitHub
            <span aria-hidden="true"> ↗</span>
          </a>
          {onLanding ? <NavDock /> : null}
        </div>
      </nav>
    </NavBar>
  );
}
```

In `web/app/globals.css`, insert this block immediately before the global reduced-motion block:

```css
/* The nav bar (components/live/NavDock.tsx, NavBar): white, pinned from lg, with a hairline once the page has
   scrolled, on the 120 ms tick. From lg, on a page that has the bar, every anchor lands below it. /now and /gap-index
   load this file but have no bar, so their anchors keep the base 16 px. */
@layer components {
  .nav-bar {
    border-bottom: 1px solid transparent;
    transition: border-color var(--t-tick) var(--ease-instrument);
  }
  .nav-bar[data-scrolled] {
    border-bottom-color: var(--color-line);
  }
}
@layer base {
  @media (min-width: 64rem) {
    html:has([data-nav-bar]) [id] {
      scroll-margin-top: 96px;
    }
  }
}
```

- [ ] **Step 6: Run them and see them pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm test -- test/instrument-nav-dock.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run build
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- e2e/instrument-nav.spec.ts --project=chromium --workers=2
```

Expected: `Tests  5 passed (5)`, the build exits 0, `netstat` prints nothing, and Playwright prints `7 passed`.

- [ ] **Step 7: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run verify
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument/web && npm run e2e -- --workers=2
```

Expected:
- `verify` exits 0. `top.test.tsx` still finds the Main nav's links in order: `NavDock` renders nothing in jsdom, which has no IntersectionObserver. `check:out` finds no `>LIVE<` in `out/index.html`, since the dock renders nothing on the server.
- `netstat` prints nothing.
- The full e2e run passes, as in Task 15 Step 1, with PR #15's `ledger.spec.ts` and the 7 nav tests.

- [ ] **Step 8: Commit and push**

Write `C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build/p1-commit-17.txt`:

```
feat(web): pin the nav as an opaque bar and dock the live reading in it on the landing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument add -- web/components/live/NavDock.tsx web/components/sections/Nav.tsx web/app/globals.css web/test/instrument-nav-dock.test.tsx web/e2e/instrument-nav.spec.ts
SCRATCH='C:/Users/eric/AppData/Local/Temp/claude/1c1c64b5723fc21e/7d533f09-7376-4305-a908-3e8b385bcd59/scratchpad/p1-build' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument commit -F "$SCRATCH/p1-commit-17.txt"
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument push origin feat/hero-instrument
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/hero-instrument status --porcelain
```

Expected: the push is a fast-forward, `<old>..<new>  feat/hero-instrument -> feat/hero-instrument`, and the status is empty. The open P1 PR now holds the nav. Never force push.

Report back with:
- the merge result;
- the 5 + 7 test totals;
- the full e2e totals per project;
- any stop condition you met.
