# Maat M-9 P0: instrument primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and unit-test the spec section 5.1 units that no later phase of spec 12.1 names (the instrument parts, the motion helpers, the spring and its generated CSS easings, `formatLimit` and `nextOpen`), add the instrument tokens beside the pinned ones, and add the weight budget and the WebKit and Firefox smoke runs, all without mounting anything, so the site does not change visibly.

**Not in P0.** This plan does not build these ten section 5.1 units. Each one belongs to a later phase of spec 12.1:

| Unit | Path | Phase |
|---|---|---|
| HoldKey | `web/components/instrument/HoldKey.tsx` | P1. Spec 12.1 names no phase for it. It sets the provider's `hold` and so the `active` option of `useLiveSnapshot`, which are both P1, so it ships with them (amendment A3) |
| LiveSnapshotProvider | `web/components/live/LiveSnapshotProvider.tsx` | P1 |
| ThumbBar | `web/components/instrument/ThumbBar.tsx` | P1 |
| useTipDrag | `web/components/instrument/useTipDrag.ts` | P1, as drag-to-tip, which is first in the cut order (spec 12.3) |
| Scope | `web/components/instrument/Scope.tsx` | P2a |
| ScopeScrubber | `web/components/instrument/ScopeScrubber.tsx` | P2a |
| firing | `web/lib/live/firing.ts` | P2a |
| scope | `web/content/scope.ts` | P2a |
| ThisWeek | `web/components/charts/ThisWeek.tsx` | P2a |
| NowConsole | `web/components/live/NowConsole.tsx` | P3, built and unit-tested but not mounted; P4 mounts it |

Every other section 5.1 unit is built in Tasks 1-13.

**Architecture:** Small, unmounted building blocks. The React parts live in `web/components/instrument/` and are server-safe, except `Digits`. The motion helpers live in `web/lib/motion/`, and two new exports go into `web/content/`. CSS is only added to `web/app/globals.css`, beside the pinned tokens and never inside them. One spring model in `lib/motion/spring.ts` feeds both the CSS easings, through `scripts/springs.ts` and a byte-for-byte parity test, and the later drag. A gzip budget spec and two smoke-only Playwright projects guard the phases after this one.

**Tech Stack:** Next.js 16.4.5 (static export to `out/`), React 19.3.1 (`ref` is a plain prop), Tailwind 4.3.5 through `@tailwindcss/postcss`, TypeScript 7.0.2 (`strict`, `noUncheckedIndexedAccess`), vitest 5.1.0 with jsdom 29.1.1 and Testing Library 16.3.3, Playwright 1.65.0, tsx 4.23.15, Node 24.

**Spec:** `docs/superpowers/specs/2026-11-23-maat-web-instrument-design.md`

## Global Constraints

- **Workspace.** Work only in `E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives`, on branch `feat/instrument-primitives`, cut from `origin/main` at `66bd0d0` (Task 0). In this plan, `W` means that path.
- **Absolute paths.** Your shell's working directory resets between calls, so every command below starts with `cd <absolute path>` or uses `git -C <absolute path>`.
- **Frozen until PR #15 merges (spec 12.2).** Do not edit any of these:
  - `web/components/sections/Nav.tsx` and `web/components/sections/Ledger.tsx`;
  - `web/app/(site)/layout.tsx`;
  - `web/lib/check-out.ts` and `web/scripts/check-out.ts`;
  - `web/next.config.ts`, `web/package.json` and `web/package-lock.json`;
  - `web/app/sitemap.ts`;
  - the `@source` brace line of `web/app/globals.css` (line 8, `@source "../components/{charts,gap,live,sections,ui}";`) and the lines next to it. Task 17 is the one step that edits the brace, and it runs only after PR #15 has merged;
  - `page.test.tsx`, `top.test.tsx` and `check-out.test.ts`;
  - `web/README.md` and `status.mdx`.
- **Frozen until the deployment-record change merges (spec 3.10 and 12.2).** Do not edit its 60 files, including:
  - `page.test.tsx`, `top.test.tsx`, `now-page.test.tsx`, `live-verdict.test.ts` and `docs.spec.ts`;
  - `web/README.md`;
  - `web/lib/live/verdict.ts`, which is read only;
  - `AnnouncementBar.tsx`, `Mandate.tsx`, `NowBoard.tsx` and `app/(site)/now/page.tsx`;
  - the 39 docs MDX files;
  - `deployments/README.md` and `web/content/generated/deployments.json`.

  Make no change to docs prose.
- **The pinned tokens.** The 20 pinned colour tokens (spec 3.1) stay byte-identical at `globals.css:13-32`. They are:

  | Token | Value |
  |---|---|
  | `--color-bg` | `#FFFFFF` |
  | `--color-surface-soft` | `#F6F7F9` |
  | `--color-surface-head` | `#FBFBFC` |
  | `--color-line` | `#E6E8EC` |
  | `--color-line-soft` | `#F1F2F5` |
  | `--color-line-strong` | `#D5D8DF` |
  | `--color-ink` | `#0B0D12` |
  | `--color-ink-2` | `#5A6170` |
  | `--color-ink-3` | `#8A90A0` |
  | `--color-ink-body` | `#3D4350` |
  | `--color-accent` | `#1F3BFF` |
  | `--color-accent-tint` | `#EEF1FF` |
  | `--color-accent-soft` | `#DCE2FF` |
  | `--color-refuse` | `#C2410C` |
  | `--color-refuse-tint` | `#FFF1EA` |
  | `--color-refuse-hatch` | `#F3B79A` |
  | `--color-code-key` | `#8EA2FF` |
  | `--color-code-type` | `#7DD3C0` |
  | `--color-feather` | `#6E83FF` |
  | `--color-grid` | `#EEF0F4` |
- **How `globals.css` may change.** Only add lines, until Task 17. Lines 1-10 and the first `@theme` block (lines 12-36) keep every byte, and the global `@media (prefers-reduced-motion: reduce)` block stays exactly as written. New lines go in exactly three places:
  - directly after line 10, `@source "../lib/site.ts";`;
  - after the first `@theme` block's closing `}` (line 36);
  - immediately before the line `@media (prefers-reduced-motion: reduce) {`.
- **Existing files P0 may edit.** These four only by adding lines (Task 17's brace edit aside):
  - `web/app/globals.css`;
  - `web/content/format.ts`;
  - `web/content/calendar.ts`;
  - `.github/workflows/ci.yml`.

  `web/playwright.config.ts` is the one exception: its line 10, `projects: [...]`, is replaced by six lines in Task 14.

  Edit no existing test. Every new assertion goes in a new file. `web/test/setup.ts` is not changed.
- **No new dependency of any kind.** `npm ci` is the only install, plus the WebKit and Firefox browser download in Task 14. There is no animation library, no CDN and no third-party script.
- **Motion.**
  - There is no `animation-timeline` and no scroll hijack.
  - Nothing is ever `opacity: 0` outside `@keyframes`.
  - Every finite animation ends within 2.2 s.
  - The base style of every part is its final frame.
- **jsdom.** jsdom has no `IntersectionObserver`, no `window.matchMedia` and no `Element.prototype.animate`. Every helper degrades when one of them is missing, and each one has a test for that path.
- **Client and server modules.** Among the P0 parts, only `components/instrument/Digits.tsx` starts with `"use client";`. Every other P0 module calls no React hook and stays server-safe.
- **Limits come from FACTS.** Every limit reads `FACTS.mandate.value`, and a Meter's full scale is its `limit` prop. Never write a literal limit outside tests that read FACTS.
- **Nothing is mounted.** In P0, no page, section or existing component imports from `components/instrument` or `lib/motion`. There is no visual change.
- **How to write files.** Create and edit files with the Write and Edit tools. Never use a shell heredoc or `echo`, because a heredoc collapses `\\` into `\` and breaks regex escapes. Line endings are LF, which `.gitattributes` enforces.
- **Commands.** Run these from `W/web`:
  - `npm run typecheck`, which runs `next typegen` and then `tsc --noEmit` and takes a few minutes, so give it a 10-minute timeout;
  - `npm test -- <files>`, which runs `vitest run`;
  - `npm run build`;
  - `npm run check:out`;
  - `npm run e2e -- <args> --workers=2`.

  Locally, Playwright always runs with `--workers=2`, and only one Playwright run may use port 4173 at a time. Check first with `netstat -ano | grep 4173`. CI keeps `--workers=1`.
- **Git rules.**
  - Stage only with `git -C <W> add -- <explicit files>`. Never use `-A`, never `.`, never `commit -am`.
  - Commit with `git -C <W> commit -F "$SCRATCH/<file>"`.
    - `$SCRATCH` is your session's scratchpad directory, as an absolute path with forward slashes.
    - Start each commit call with `SCRATCH='<that path>' &&`.
    - Write the message file with the Write tool.
  - Every message is a conventional subject (`feat(web): ...`, `test(web): ...`), then a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never `--amend`, never force push, never `git stash`, never `--no-verify`.
- **English only.** All repo text is English: code, comments, tests and commit messages.
- **Stop and report; do not work around.** Stop and report if any of these happens:
  - `origin/main` is not `66bd0d0` at Task 0 (Task 17 expects a newer main, with PR #15 merged);
  - a frozen file would need an edit;
  - a baseline check fails at Task 0;
  - a WebKit or Firefox smoke test fails (Task 14);
  - a weight budget fails (Task 15);
  - the font weight is more than 1,000 B away from the measured baseline.

## Review Focus

1. **`weight.spec.ts` passes while counting nothing.** This happens when a tag regex matches no asset, an edition marker list is empty, or a page loads no script. It is pinned in Task 15 by guards that each fail when this happens:
   - at least 5 JS files, at least 1 CSS file and exactly 2 fonts;
   - more than 50 markers, at least 1 of them found in `out/gap-index.html`;
   - at least 5 scripts per page and at least 1 script request.

   Task 15 also runs an injected-marker drill to prove the leak test fails.
2. **A Meter that lies about magnitude.** It could scale from a literal instead of its limit, or draw a bar for a bad limit or a bad reading. It is pinned in Task 10:
   - the fill moves when only the `limit` prop changes (100 against 150 bps, from FACTS);
   - `meterPercent` throws for a limit of 0, -1, NaN or Infinity, and for a reading of -0.5, -1, NaN or Infinity;
   - a reading past its limit pins at 100 %, sets `data-over` and still writes the real number.
3. **`nextOpen` off by a day at an edge.** It is pinned in Task 6 by these vectors and a sweep:
   - the open instant itself, which returns the next day's open;
   - one second before an open;
   - the 13:00 ET early close and the minute before it;
   - Thanksgiving and Christmas;
   - both DST switches;
   - a sweep from 20 Nov 2026 to 8 Jan 2027 that checks no open falls between `ts` and the answer.
4. **Digits that count or garble.** This covers rolling the first reading, rolling a reading that gained a digit (cells no longer line up), and comparing against the cells instead of the old reading. It is pinned in Task 3 (`rollDigits`) and Task 7 (`Digits`).
5. **A Readout that breaks the live strip's DOM contract (spec 3.5).** This covers `ref`, `tabIndex` or `data-live-strip` landing on another element, children that get wrapped or reordered, and an `aria-live` added above the strip. It is pinned in Task 8.

## Spec amendments

At three points the spec's wording is wrong or says nothing, and this plan follows the amended text below. Each one is an edit to `docs/superpowers/specs/2026-11-23-maat-web-instrument-design.md` on the spec branch `docs/web-instrument-spec`, and it lands together with this plan. The executor does not make these edits: the P0 worktree is cut from `66bd0d0`, which holds no spec.

- **A1, spec 8.2: the overshoot figures.**
  - Replace "`--ease-needle` has damping ratio .42, about 22% overshoot. `--ease-settle` has damping ratio .7, about 4% overshoot." with "`--ease-needle` has damping ratio .42, 23.4% overshoot. `--ease-settle` has damping ratio .7, 4.6% overshoot."
  - The damping ratios are the design and stay. `exp(-πζ/√(1-ζ²))` gives 23.365% for ζ .42 and 4.599% for ζ .7. Exactly 22% would need ζ ≈ 0.434, and exactly 4% would need ζ ≈ 0.716.
  - With the new figures, spec 13's "within 1 point of its target" is what Task 2 tests: the sampled peaks are 1.232 and 1.046.
- **A2, spec 11 item 3: what the weight counts.**
  - Replace "every `/_next/` script, stylesheet and font the landing links" with "every `/_next/` module script (a `noModule` legacy polyfill is not counted, since no browser that runs the module scripts downloads it), stylesheet and font the landing links".
  - The exclusion decides the JS budget. At `66bd0d0` the landing's JS is 158,901 B without the polyfill and 198,421 B with it, against a budget of 185,000 B. Task 15 counts the amended way.
- **A3, spec 12.1: phases.**
  - In the P1 row, change "LiveSnapshotProvider and `active`" to "LiveSnapshotProvider, `active` and HoldKey".
  - In the P0 row, change "the section 5.1 units, unmounted" to "the section 5.1 units that no later phase names, unmounted".
  - The "Not in P0" table above lists those later-phase units.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `web/app/globals.css` (modify) | `@source "../components/instrument";`, folded into the brace once PR #15 has merged; the instrument colour and motion tokens; the springs block; `.thumb-bar`; the CSS of Ghost, Digits, Lamp, SourcePlate, Meter, Ruler, Balance and Tape | 1, 2, 7, 9-12, 17 |
| `web/lib/motion/spring.ts` | The damped spring: parameters, closed form, `linear()` samples, the integrator step | 2 |
| `web/lib/motion/springs-css.ts` | The springs block text, and the reader and writer for its markers | 2 |
| `web/scripts/springs.ts` | `npx tsx scripts/springs.ts`: rewrites the springs block from the model | 2 |
| `web/lib/motion/reduced-motion.ts` | `prefersReducedMotion()`, true when `matchMedia` is missing | 3 |
| `web/lib/motion/roll-digits.ts` | `rollDigits`: the WAAPI roll of changed digits, or text only | 3 |
| `web/lib/motion/once-in-view.ts` | `onceInView`: one shared IntersectionObserver that sets `data-seen` | 4 |
| `web/content/format.ts` (modify) | `formatLimit` and `LimitUnit` | 5 |
| `web/content/calendar.ts` (modify) | `nextOpen` and `NEXT_OPEN_HORIZON_DAYS` | 6 |
| `web/components/instrument/Ghost.tsx` | Unlit segments as generated content | 7 |
| `web/components/instrument/Digits.tsx` | `"use client"`: the rolling mono number | 7 |
| `web/components/instrument/Readout.tsx` | The display window and its bezel keys slot | 8 |
| `web/components/instrument/types.ts` | `Surface`, `SMALL_TEXT`, `Verdict` | 9 |
| `web/components/instrument/Lamp.tsx` | The state lamp with its word | 9 |
| `web/components/instrument/SourcePlate.tsx` | The provenance plate | 9 |
| `web/components/instrument/Meter.tsx` | The hairline bar against a limit prop, with the number written | 10 |
| `web/components/instrument/Ruler.tsx` | The decorative tick ruler | 10 |
| `web/components/instrument/Balance.tsx` | The MARK-grid balance whose beam tilts by `data-verdict` | 11 |
| `web/components/instrument/Tape.tsx` | Printed verdict rows | 12 |
| `web/components/instrument/Fig.tsx` | `data-fact` keys, `resolveFact`, `factAttr`, `<Fig>` | 13 |
| `web/components/instrument/Live.tsx` | `liveAttrs` and `<Live>` | 13 |
| `web/playwright.config.ts` (modify) | The `webkit` and `firefox` projects, smoke only | 14 |
| `.github/workflows/ci.yml` (modify) | The `cross_browsers` install step | 14 |
| `web/e2e/weight.spec.ts` | Gzip budgets, the edition-leak check, third-party scripts and console errors | 15 |
| `web/test/instrument-tokens.test.ts`, `web/test/instrument-contrast.test.ts` | Tokens, the `@source` line, `.thumb-bar`, contrast pairs | 1 |
| `web/test/springs.test.ts`, `web/test/instrument-spring.test.ts` | Block parity and overshoot targets; the model and the integrator | 2 |
| `web/test/instrument-roll-digits.test.ts` | `prefersReducedMotion` and `rollDigits` | 3 |
| `web/test/instrument-once-in-view.test.ts` | `onceInView` | 4 |
| `web/test/format-limit.test.ts` | `formatLimit` | 5 |
| `web/test/calendar-next-open.test.ts` | `nextOpen` | 6 |
| `web/test/instrument-ghost-digits.test.tsx` | Ghost and Digits | 7 |
| `web/test/instrument-readout.test.tsx` | Readout | 8 |
| `web/test/instrument-lamp-plate.test.tsx` | Lamp and SourcePlate | 9 |
| `web/test/instrument-meter-ruler.test.tsx` | Meter and Ruler | 10 |
| `web/test/instrument-balance.test.tsx` | Balance | 11 |
| `web/test/instrument-tape.test.tsx` | Tape | 12 |
| `web/test/instrument-fig-live.test.tsx`, `web/test/instrument-modules.test.ts` | Fig and Live; module rules for every part | 13 |
| `web/test/instrument-browsers.test.ts` | Pins the Playwright projects and the CI install step | 14 |

---

## Tasks

### Task 0: Worktree and baseline

**Files:**
- Create: the worktree `E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives` (branch `feat/instrument-primitives`)
- Test: none (baseline runs only)

**Interfaces:**
- Consumes: `origin/main` at `66bd0d0`.
- Produces: a clean worktree with `web/node_modules`, a baseline `web/out/`, and the measured font baseline (a number, expected `140786`), which Task 15 uses.

- [ ] **Step 1: Fetch and check main**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon fetch origin
git -C E:/APP2028/stocks-maxxing-hackathon rev-parse --short origin/main
```

Expected: `66bd0d0`. If it prints anything else, stop and report. P-1 may have merged PR #15, which moves the `@source` brace and the frozen-file rules. Tasks 0-16 are written for `66bd0d0`, and Task 17 brings in the newer main afterwards.

- [ ] **Step 2: Create the worktree**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon worktree add -b feat/instrument-primitives E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives origin/main
```

Expected: `Preparing worktree (new branch 'feat/instrument-primitives')` and `HEAD is now at 66bd0d0 ...`. If the branch or the folder already exists, stop and report.

- [ ] **Step 3: Install the locked dependencies**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm ci
```

Expected: `added <n> packages` and no `npm ERR!`.

- [ ] **Step 4: Baseline typecheck and unit tests**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test
```

Expected: the typecheck exits 0, and every vitest file passes. If anything fails, stop and report it with the failing test names. Nothing in P0 may start from a red baseline.

- [ ] **Step 5: Baseline build and the font baseline**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run build
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && node -e 'const fs=require("fs"),z=require("zlib");const h=fs.readFileSync("out/index.html","utf8");const f=[...new Set([...h.matchAll(/href="(\/_next\/[^"?#]+\.woff2)"/g)].map(m=>m[1]))];console.log(f.length+" fonts "+f.reduce((n,p)=>n+z.gzipSync(fs.readFileSync("out"+p),{level:9}).length,0))'
```

Expected: the build ends with the export done and no error, and the one-liner prints `2 fonts 140786`. Write the number down: Task 15 uses it as `FONT_BASELINE`. If it prints another number, Task 15 uses yours instead. If it prints a font count other than 2, stop and report.

- [ ] **Step 6: Confirm a clean tree**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives status --porcelain
```

Expected: no output. `out/`, `.next/` and `node_modules/` are ignored. There is no commit in this task.

---

### Task 1: Instrument tokens, the `@source` line, `.thumb-bar` and the contrast test

**Files:**
- Modify: `web/app/globals.css`, adding lines only:
  - one line after line 10;
  - a block after line 36, the closing `}` of the first `@theme`;
  - a block immediately before `@media (prefers-reduced-motion: reduce) {`, line 288 at `66bd0d0`.
- Create: none besides the tests.
- Test: `web/test/instrument-tokens.test.ts`, `web/test/instrument-contrast.test.ts`

**Interfaces:**
- Consumes: the pinned tokens in `web/app/globals.css`.
- Produces:
  - **CSS custom properties.**
    - Colours: `--color-chassis-2`, `--color-chassis-line`, `--color-lcd`, `--color-lcd-2`, `--color-lcd-ghost`, `--color-pass-lit`, `--color-refuse-lit`, `--color-lamp-pass`, `--color-lamp-refuse`, `--color-label`, `--color-refuse-ink`, `--color-tick`.
    - Durations: `--t-tick: 120ms`, `--t-flip: 240ms`, `--t-weigh: 600ms`, `--t-draw: 900ms`, `--stagger: 30ms`.
    - Curve: `--ease-instrument: cubic-bezier(0.2, 0.7, 0.2, 1)`.
  - **Tailwind utilities** for those colours, such as `bg-chassis-2` and `text-lcd`. They are generated only when a scanned file uses them.
  - **The `@source "../components/instrument";` line.**
  - **The `.thumb-bar` rule.**
  - **The contrast rules** that every later part in `components/instrument/` must pass.

- [ ] **Step 1: Write the failing tests**

Create `web/test/instrument-tokens.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const lines = css.split("\n");

// The 20 pinned tokens (spec 2026-11-23 section 3.1), byte for byte. tokens.test pins 18 values and brand.test two
// more; this pins the block itself, so nothing is ever added inside it.
const PINNED_BLOCK = [
  "  --color-bg: #FFFFFF;",
  "  --color-surface-soft: #F6F7F9;",
  "  --color-surface-head: #FBFBFC;",
  "  --color-line: #E6E8EC;",
  "  --color-line-soft: #F1F2F5;",
  "  --color-line-strong: #D5D8DF;",
  "  --color-ink: #0B0D12;",
  "  --color-ink-2: #5A6170;",
  "  --color-ink-3: #8A90A0;",
  "  --color-ink-body: #3D4350;",
  "  --color-accent: #1F3BFF;",
  "  --color-accent-tint: #EEF1FF;",
  "  --color-accent-soft: #DCE2FF;",
  "  --color-refuse: #C2410C;",
  "  --color-refuse-tint: #FFF1EA;",
  "  --color-refuse-hatch: #F3B79A;",
  "  --color-code-key: #8EA2FF;",
  "  --color-code-type: #7DD3C0;",
  "  --color-feather: #6E83FF;",
  "  --color-grid: #EEF0F4;",
];

// Spec section 9.2, verbatim.
const ADDED_COLOURS: Record<string, string> = {
  "chassis-2": "#14171F",
  "chassis-line": "#262B36",
  lcd: "#F3F4F6",
  "lcd-2": "#B4BAC6",
  "lcd-ghost": "#1A1E27",
  "pass-lit": "#9DAEFF",
  "refuse-lit": "#FF9B66",
  "lamp-pass": "#4D6BFF",
  "lamp-refuse": "#FF5A1F",
  label: "#4A5160",
  "refuse-ink": "#9A3412",
  tick: "#C9CED8",
};

// Spec section 8.2, verbatim; the curve is written the way .anim-row writes it.
const MOTION: Record<string, string> = {
  "--t-tick": "120ms",
  "--t-flip": "240ms",
  "--t-weigh": "600ms",
  "--t-draw": "900ms",
  "--stagger": "30ms",
  "--ease-instrument": "cubic-bezier(0.2, 0.7, 0.2, 1)",
};

describe("instrument tokens in app/globals.css (spec 2026-11-23 sections 8.2 and 9.2)", () => {
  it("keeps the 20 pinned colour tokens as one block, byte for byte", () => {
    const start = lines.indexOf(PINNED_BLOCK[0]!);
    expect(start).toBeGreaterThan(0);
    expect(lines[start - 1]).toBe("@theme {");
    expect(lines.slice(start, start + PINNED_BLOCK.length)).toEqual(PINNED_BLOCK);
    expect(lines[start + PINNED_BLOCK.length]).toBe("");
  });

  it.each(Object.entries(ADDED_COLOURS))("declares --color-%s: %s once, after the pinned block", (name, hex) => {
    const all = [...css.matchAll(new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`, "g"))];
    expect(all).toHaveLength(1);
    expect(all[0]?.[1]).toBe(hex);
    expect(all[0]!.index).toBeGreaterThan(css.indexOf("  --color-grid: #EEF0F4;"));
  });

  it.each(Object.entries(MOTION))("declares %s: %s once", (name, value) => {
    const all = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, "g"))];
    expect(all).toHaveLength(1);
    expect(all[0]?.[1]).toBe(value);
  });

  it("leaves Tailwind's ease-out alone", () => {
    expect(css).not.toMatch(/--ease-out\s*:/);
  });

  // Spec section 5.2: until PR #15 merges, instrument has its own line after lib/site.ts, away from the frozen brace
  // line. Once PR #15 has merged, it goes into the brace instead. The brace is found by its shape, so the folders
  // PR #15 adds to it do not break this test.
  it("feeds components/instrument to the landing sheet once: on its own line after lib/site.ts, or in the brace", () => {
    const brace = lines.findIndex((l) => /^@source "\.\.\/components\/\{[^}]+\}";$/.test(l));
    expect(brace).toBeGreaterThanOrEqual(0);
    const folders = /\{([^}]+)\}/.exec(lines[brace]!)![1]!.split(",");
    const own = lines.indexOf('@source "../components/instrument";');
    if (folders.includes("instrument")) {
      expect(own).toBe(-1);
    } else {
      expect(own).toBe(lines.indexOf('@source "../lib/site.ts";') + 1);
      expect(own - brace).toBeGreaterThan(1);
    }
    expect(lines.filter((l) => l.startsWith("@source ") && l.includes("instrument"))).toHaveLength(1);
  });

  it("pads the ThumbBar for a phone's home indicator in the stylesheet only (spec section 5.2)", () => {
    expect(css.match(/safe-area-inset-bottom/g)).toHaveLength(1);
    expect(css).toMatch(/\.thumb-bar\s*\{\s*padding-bottom:\s*env\(safe-area-inset-bottom\);\s*\}/);
  });
});
```

Create `web/test/instrument-contrast.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const PARTS = new URL("../components/instrument/", import.meta.url);

/** Every --color-* token in app/globals.css, by name: the first declaration wins, as in the pinned tests. */
const TOKENS = new Map<string, string>();
for (const [, name, hex] of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
  if (!TOKENS.has(name!)) TOKENS.set(name!, hex!.toUpperCase());
}

function hex(name: string): string {
  const value = TOKENS.get(name);
  if (value === undefined) throw new Error(`no --color-${name} in app/globals.css`);
  return value;
}

/** WCAG 2.2 relative luminance of an sRGB colour "#RRGGBB". */
function luminance(colour: string): number {
  const n = Number.parseInt(colour.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG contrast ratio of two colours, 1 to 21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** "small": text at 12 px or less, 7:1 or more. "text": any larger text, 4.5:1 or more (spec section 9.2). */
type Size = "small" | "text";
const MIN: Readonly<Record<Size, number>> = { small: 7, text: 4.5 };

interface Pair {
  fg: string;
  bg: string;
  size: Size;
  use: string;
}

// Every text pair the instrument parts declare (spec section 9.2), by token name.
const PAIRS: readonly Pair[] = [
  { fg: "lcd", bg: "ink", size: "small", use: "readout text on the ink chassis" },
  { fg: "lcd", bg: "chassis-2", size: "small", use: "readout text in a raised window" },
  { fg: "lcd-2", bg: "ink", size: "small", use: "bezel keys, lamp words and plates on the chassis" },
  { fg: "lcd-2", bg: "chassis-2", size: "small", use: "the same in a raised window" },
  { fg: "pass-lit", bg: "ink", size: "small", use: "a lit pass word on the chassis" },
  { fg: "pass-lit", bg: "chassis-2", size: "small", use: "a lit pass word in a raised window" },
  { fg: "refuse-lit", bg: "ink", size: "small", use: "a lit refusal word on the chassis" },
  { fg: "refuse-lit", bg: "chassis-2", size: "small", use: "a lit refusal word in a raised window" },
  { fg: "label", bg: "bg", size: "small", use: "engraved labels, lamp words, plates and meter numbers on the white faceplate" },
  { fg: "label", bg: "surface-soft", size: "small", use: "the same on the surface-soft faceplate of #reasons" },
  { fg: "refuse-ink", bg: "refuse-tint", size: "text", use: "refusal text above 12 px on the refuse tint" },
];

// The pinned exception: the ReasonTag code keeps ink-2, which e2e/smoke.spec.ts:159 pins, at 11 px: 4.5:1 or more.
const EXCEPTIONS: readonly Pair[] = [
  { fg: "ink-2", bg: "bg", size: "small", use: "the ReasonTag code on white" },
  { fg: "ink-2", bg: "surface-soft", size: "small", use: "the ReasonTag code on surface-soft" },
];
const EXCEPTION_MIN = 4.5;

/** The dark surfaces, and the colours never used as text on them (spec section 9.2). */
const DARK = ["ink", "chassis-2"];
const NEVER_ON_DARK = ["accent", "refuse", "ink-2"];

const name = (p: Pair) => `${p.fg} on ${p.bg} (${p.use})`;

/** The source of every part in components/instrument (none yet is fine: the folder fills up task by task). */
function partSources(): { file: string; text: string }[] {
  if (!existsSync(PARTS)) return [];
  return readdirSync(PARTS)
    .filter((f) => /\.tsx?$/.test(f))
    .map((file) => ({ file, text: readFileSync(new URL(file, PARTS), "utf8") }));
}

describe("instrument contrast (spec 2026-11-23 section 9.2)", () => {
  it("computes the ratios the spec gives", () => {
    const ratio = (fg: string, bg: string) => Number(contrast(hex(fg), hex(bg)).toFixed(2));
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 10);
    expect(ratio("lcd", "ink")).toBe(17.66);
    expect(ratio("lcd-2", "ink")).toBe(9.98);
    expect(ratio("lcd-2", "chassis-2")).toBe(9.2);
    expect(ratio("pass-lit", "ink")).toBe(9.19);
    expect(ratio("refuse-lit", "ink")).toBe(9.38);
    expect(ratio("label", "bg")).toBe(7.96);
    expect(ratio("label", "surface-soft")).toBe(7.43);
    expect(ratio("refuse-ink", "refuse-tint")).toBe(6.62);
    expect(ratio("ink-2", "bg")).toBe(6.22);
    expect(ratio("ink-2", "surface-soft")).toBe(5.8);
    expect(ratio("ink-2", "ink")).toBe(3.13);
    expect(ratio("ink-3", "bg")).toBe(3.19);
    expect(ratio("refuse", "refuse-tint")).toBe(4.69);
  });

  it("names only tokens app/globals.css declares", () => {
    for (const p of [...PAIRS, ...EXCEPTIONS]) {
      expect(TOKENS.has(p.fg), `--color-${p.fg}`).toBe(true);
      expect(TOKENS.has(p.bg), `--color-${p.bg}`).toBe(true);
    }
  });

  it.each(PAIRS.map((p) => [name(p), p] as const))("%s meets its minimum", (_, p) => {
    expect(contrast(hex(p.fg), hex(p.bg))).toBeGreaterThanOrEqual(MIN[p.size]);
  });

  it.each(EXCEPTIONS.map((p) => [name(p), p] as const))("%s is the pinned exception: 4.5:1 or more, under 7:1", (_, p) => {
    const r = contrast(hex(p.fg), hex(p.bg));
    expect(r).toBeGreaterThanOrEqual(EXCEPTION_MIN);
    expect(r).toBeLessThan(MIN.small);
  });

  it("never declares accent or refuse as text on ink, nor ink-2 on ink", () => {
    for (const p of [...PAIRS, ...EXCEPTIONS]) {
      expect(DARK.includes(p.bg) && NEVER_ON_DARK.includes(p.fg), name(p)).toBe(false);
    }
  });

  it("gives every text colour an instrument part uses a declared pair", () => {
    const declared = new Set([...PAIRS, ...EXCEPTIONS].map((p) => p.fg));
    for (const { file, text } of partSources()) {
      for (const [, colour] of text.matchAll(/\btext-([a-z][a-z0-9-]*)/g)) {
        if (TOKENS.has(colour!)) expect(declared.has(colour!), `${file} uses text-${colour}`).toBe(true);
      }
    }
  });

  it("never puts accent, refuse or ink-2 text in a class list that sets a dark surface", () => {
    for (const { file, text } of partSources()) {
      for (const [list] of text.matchAll(/"[^"\n]*"|`[^`\n]*`/g)) {
        if (!/\bbg-(ink|chassis-2)\b/.test(list)) continue;
        expect(list, file).not.toMatch(/\btext-(accent|refuse|ink-2)\b/);
      }
    }
  });
});
```

The spec writes ink-2 on white as 6.21:1, but WCAG rounding of the exact ratio (6.216) gives 6.22. The test pins 6.22.

- [ ] **Step 2: Run them and see them fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-tokens.test.ts test/instrument-contrast.test.ts
```

Expected: `Tests  33 failed | 7 passed (40)`.
- The 12 colour cases, the 6 motion cases, the `@source` case, the `.thumb-bar` case, the ratios case, the token-names case and the 11 pairs fail. They report `expected [] to have a length of 1` or `no --color-lcd in app/globals.css`.
- The pinned block, the ease-out case, the 2 exceptions, the dark-surface rule and the 2 part scans pass. The folder does not exist yet.

- [ ] **Step 3: Add the lines to `web/app/globals.css`**

Read the file first; Edit needs it. Make three edits, adding lines only.

(a) Directly after line 10, `@source "../lib/site.ts";`, add this line. It goes before the existing blank line 11.

```css
@source "../components/instrument";
```

With Edit, set old_string to `@source "../lib/site.ts";\n\n@theme {` and new_string to `@source "../lib/site.ts";\n@source "../components/instrument";\n\n@theme {`.

(b) After the first `@theme` block, add a blank line and the block below. Use Edit with old_string set to these two lines:

```css
  --font-mono: var(--font-geist-mono), ui-monospace, monospace;
}
```

Set new_string to those same two lines, then a blank line, then:

```css
/* Instrument tokens (spec 2026-11-23-maat-web-instrument-design.md, sections 8.2 and 9.2), beside the pinned block
   above and never inside it. Tailwind writes a token into the sheet only once a class or a var() uses it. */
@theme {
  --color-chassis-2: #14171F;
  --color-chassis-line: #262B36;
  --color-lcd: #F3F4F6;
  --color-lcd-2: #B4BAC6;
  --color-lcd-ghost: #1A1E27;
  --color-pass-lit: #9DAEFF;
  --color-refuse-lit: #FF9B66;
  --color-lamp-pass: #4D6BFF;
  --color-lamp-refuse: #FF5A1F;
  --color-label: #4A5160;
  --color-refuse-ink: #9A3412;
  --color-tick: #C9CED8;

  --t-tick: 120ms;
  --t-flip: 240ms;
  --t-weigh: 600ms;
  --t-draw: 900ms;
  --stagger: 30ms;
  /* Named for the instrument, not ease-out: Tailwind's ease-out utility reads a variable of that name. */
  --ease-instrument: cubic-bezier(0.2, 0.7, 0.2, 1);
}
```

(c) Immediately before the line `@media (prefers-reduced-motion: reduce) {`, insert the block below, then a blank line. With Edit, set old_string to `@media (prefers-reduced-motion: reduce) {` and new_string to the block, a blank line, then `@media (prefers-reduced-motion: reduce) {`.

```css
/* ThumbBar (phase P1): its padding clears a phone's home indicator. The inset is named here, in the stylesheet only,
   never in a class name or an inline style (spec 2026-11-23 section 5.2). */
@layer components {
  .thumb-bar {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
```

The pinned block moves down by one line, from 13-32 to 14-33, because of edit (a). Its bytes do not change. The tests find it by content.

- [ ] **Step 4: Run them and see them pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-tokens.test.ts test/instrument-contrast.test.ts
```

Expected: `Tests  40 passed (40)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/tokens.test.ts test/brand.test.ts test/page.test.tsx test/top.test.tsx
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives && git diff --numstat -- web/app/globals.css
```

Expected:
- All the tests pass.
- The numstat shows lines added and `0` removed: `34	0	web/app/globals.css`.

`tokens.test` reads each `--color-NAME:` by its first match. None of the new names contains a pinned name followed by a colon: `--color-chassis-line:` does not contain `--color-line:`.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-01.txt` with the Write tool:

```
feat(web): add the instrument tokens, the instrument @source line and the contrast test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/app/globals.css web/test/instrument-tokens.test.ts web/test/instrument-contrast.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-01.txt"
```

---

### Task 2: The spring model, the springs script and the springs block

**Files:**
- Create:
  - `web/lib/motion/spring.ts`;
  - `web/lib/motion/springs-css.ts`;
  - `web/scripts/springs.ts`.
- Modify: `web/app/globals.css`. Add the two marker lines after the instrument `@theme` block from Task 1 (its closing `}` is line 62 after Task 1), and then let the script fill them.
- Test: `web/test/springs.test.ts`, `web/test/instrument-spring.test.ts`

**Interfaces:**
- Consumes: `--t-weigh: 600ms` from Task 1.
- Produces (`lib/motion/spring.ts`):
  - **Constants:** `NEEDLE_ZETA = 0.42`, `SETTLE_ZETA = 0.7`, `WEIGH_MS = 600`, `SETTLE_EPSILON = 0.001`, `CURVE_INTERVALS = 60`, `CURVE_DECIMALS = 3`.
  - **Types:** `interface Spring { zeta: number; omega: number }` and `interface SpringState { x: number; v: number }`.
  - **Functions:**
    - `settleRadians(zeta: number): number`;
    - `springFor(zeta: number, durationMs: number): Spring`;
    - `NEEDLE: Spring`, with ω ≈ 27.797 rad/s;
    - `stepResponse(spring: Spring, t: number): number`;
    - `overshoot(zeta: number): number`;
    - `easingPoints(zeta: number): number[]`;
    - `linearEasing(zeta: number): string`;
    - `springStep(state: SpringState, target: number, spring: Spring, dt: number): SpringState`.
- Produces (`lib/motion/springs-css.ts`): `SPRINGS_START`, `SPRINGS_END`, `SPRING_FALLBACK = "cubic-bezier(0.34, 1.4, 0.64, 1)"`, `springsBlock(): string`, `currentSpringsBlock(css: string): string`, `replaceSpringsBlock(css: string): string`.
- Produces in CSS: `--ease-needle` and `--ease-settle`, as Tailwind `@theme` variables, with the `@supports not (transition-timing-function: linear(0, 1))` fallback.

**The model and its parameters.** The spring is a damped harmonic oscillator, `x'' = -ω²(x - target) - 2ζωx'`, released at rest at 0 toward 1.
- ζ is 0.42 for the needle and 0.7 for the settle.
- A curve ends when the envelope `e^(-ζωt)/√(1-ζ²)` falls to `SETTLE_EPSILON` = 0.001 of the travel. That fixes `ωT = -ln(0.001·√(1-ζ²))/ζ`: 16.6781 rad for ζ .42 and 10.3492 rad for ζ .7.
- Each `linear()` curve has 61 points (`k/60` of the settle time), rounded to 3 decimals, with the first exactly 0 and the last exactly 1.
- The beam's spring is `springFor(0.42, 600)`, so ω = 16.6781 / 0.6 ≈ 27.797 rad/s.
- The integrator is semi-implicit Euler: the velocity first, then the position.

**The overshoot target.** The exact overshoot is `exp(-πζ/√(1-ζ²))`: 23.4% for ζ .42 and 4.6% for ζ .7. These are spec 8.2's targets as amended by A1, which keeps the damping ratios and corrects "about 22%" and "about 4%". The test pins these figures, and checks that each curve's sampled peak (1.232 and 1.046) is within 1 point of them (spec 13).

- [ ] **Step 1: Write the failing tests**

Create `web/test/springs.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NEEDLE_ZETA, overshoot, SETTLE_ZETA, WEIGH_MS } from "@/lib/motion/spring";
import { currentSpringsBlock, replaceSpringsBlock, SPRING_FALLBACK, springsBlock } from "@/lib/motion/springs-css";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const block = currentSpringsBlock(css);

/** The points of a linear() easing the springs block declares for `name`. */
function points(name: string): number[] {
  const value = new RegExp(`^  ${name}: linear\\(([^)]*)\\);$`, "m").exec(block)?.[1];
  if (value === undefined) throw new Error(`no ${name}: linear(...) in the springs block`);
  return value.split(", ").map(Number);
}

// Spec section 8.2: damping ratio .42 gives 23.4% overshoot and .7 gives 4.6%, the exact exp(-πζ/√(1-ζ²)).
// Spec section 13: each curve's sampled peak is within 1 point of its target.
const CURVES = [
  ["--ease-needle", NEEDLE_ZETA, 23.4],
  ["--ease-settle", SETTLE_ZETA, 4.6],
] as const;

describe("the springs block of app/globals.css (spec 2026-11-23 section 8.2)", () => {
  it("is byte for byte what scripts/springs.ts writes from lib/motion/spring.ts (run npx tsx scripts/springs.ts)", () => {
    expect(block).toBe(springsBlock());
    expect(replaceSpringsBlock(css)).toBe(css);
  });

  it.each(CURVES)("%s (damping ratio %s) runs 0 to 1 and overshoots within 1 point of %s%%", (name, zeta, target) => {
    const p = points(name);
    expect(p[0]).toBe(0);
    expect(p.at(-1)).toBe(1);
    const peak = (Math.max(...p) - 1) * 100;
    expect(Math.abs(peak - target)).toBeLessThanOrEqual(1);
    expect(overshoot(zeta) * 100).toBeCloseTo(target, 1);
  });

  it("falls back to one cubic-bezier for both where linear() is missing", () => {
    expect(block).toContain(
      [
        "@supports not (transition-timing-function: linear(0, 1)) {",
        "  :root {",
        `    --ease-needle: ${SPRING_FALLBACK};`,
        `    --ease-settle: ${SPRING_FALLBACK};`,
        "  }",
        "}",
      ].join("\n"),
    );
    expect(SPRING_FALLBACK).toBe("cubic-bezier(0.34, 1.4, 0.64, 1)");
  });

  it("times the beam as the drag does: --t-weigh is WEIGH_MS", () => {
    expect(css).toContain(`  --t-weigh: ${WEIGH_MS}ms;`);
  });
});
```

Create `web/test/instrument-spring.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CURVE_INTERVALS,
  easingPoints,
  linearEasing,
  NEEDLE,
  NEEDLE_ZETA,
  overshoot,
  SETTLE_EPSILON,
  SETTLE_ZETA,
  settleRadians,
  type SpringState,
  springFor,
  springStep,
  stepResponse,
  WEIGH_MS,
} from "@/lib/motion/spring";
import { replaceSpringsBlock, SPRINGS_END, SPRINGS_START, springsBlock } from "@/lib/motion/springs-css";

/** Runs the integrator from rest at 0 toward `target` for `seconds`, `dt` per step; returns every position. */
function integrate(target: number, dt: number, seconds: number): number[] {
  let s: SpringState = { x: 0, v: 0 };
  const xs: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    s = springStep(s, target, NEEDLE, dt);
    xs.push(s.x);
  }
  return xs;
}

describe("the spring model (lib/motion/spring.ts)", () => {
  it("gives the beam's spring its settle time: ω from the needle's damping ratio and WEIGH_MS", () => {
    expect(NEEDLE.zeta).toBe(NEEDLE_ZETA);
    expect(NEEDLE.omega).toBeCloseTo(settleRadians(NEEDLE_ZETA) / (WEIGH_MS / 1000), 12);
    expect(NEEDLE.omega).toBeCloseTo(27.797, 3);
    expect(stepResponse(NEEDLE, 0)).toBe(0);
    expect(Math.abs(stepResponse(NEEDLE, WEIGH_MS / 1000) - 1)).toBeLessThanOrEqual(SETTLE_EPSILON);
  });

  it.each([NEEDLE_ZETA, SETTLE_ZETA])("samples ζ %s as 61 points from exactly 0 to exactly 1, 3 decimals each", (zeta) => {
    const p = easingPoints(zeta);
    expect(p).toHaveLength(CURVE_INTERVALS + 1);
    expect(p[0]).toBe(0);
    expect(p.at(-1)).toBe(1);
    for (const v of p) expect(Math.round(v * 1000) / 1000).toBe(v);
    expect(Math.max(...p) - 1).toBeLessThanOrEqual(overshoot(zeta) + 0.0005);
    expect(Math.min(...p)).toBeGreaterThanOrEqual(0);
    expect(linearEasing(zeta)).toBe(`linear(${p.join(", ")})`);
  });

  it("gives the needle about 23% and the settle about 5% of overshoot", () => {
    expect(overshoot(NEEDLE_ZETA)).toBeCloseTo(0.2337, 4);
    expect(overshoot(SETTLE_ZETA)).toBeCloseTo(0.046, 4);
  });

  it("refuses a spring that does not overshoot, and a duration that is not positive", () => {
    for (const zeta of [0, 1, 1.2, -0.1, Number.NaN]) expect(() => settleRadians(zeta), String(zeta)).toThrow(/between 0 and 1/);
    for (const ms of [0, -600, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => springFor(NEEDLE_ZETA, ms), String(ms)).toThrow(/positive/);
  });
});

describe("the integrator step (springStep)", () => {
  it("tracks the closed form at 0.5 ms steps and settles at the target", () => {
    const dt = 0.0005;
    const xs = integrate(1, dt, WEIGH_MS / 1000);
    const worst = Math.max(...xs.map((x, i) => Math.abs(x - stepResponse(NEEDLE, (i + 1) * dt))));
    expect(worst).toBeLessThan(0.01);
    expect(Math.abs(xs.at(-1)! - 1)).toBeLessThan(0.005);
    expect(Math.abs(Math.max(...xs) - 1 - overshoot(NEEDLE_ZETA))).toBeLessThan(0.005);
  });

  it("stays stable at 60 frames a second and comes to rest", () => {
    const xs = integrate(1, 1 / 60, 2);
    expect(xs.every(Number.isFinite)).toBe(true);
    expect(Math.abs(xs.at(-1)! - 1)).toBeLessThan(0.001);
  });

  it("is linear in the target: toward -6 degrees it moves -6 times as far as toward 1", () => {
    const unit = integrate(1, 1 / 60, 1);
    const tilt = integrate(-6, 1 / 60, 1);
    tilt.forEach((x, i) => expect(x).toBeCloseTo(-6 * unit[i]!, 10));
  });

  it("holds still at the target", () => {
    expect(springStep({ x: -6, v: 0 }, -6, NEEDLE, 1 / 60)).toEqual({ x: -6, v: 0 });
  });
});

describe("the springs block (lib/motion/springs-css.ts)", () => {
  const file = (block: string) => `a {}\n${block}\nb {}\n`;

  it("rewrites only what lies between the markers, and a second run changes nothing", () => {
    const stale = file(`${SPRINGS_START}: old */\n@theme {\n  --ease-needle: linear(0, 1);\n}\n${SPRINGS_END}`);
    const once = replaceSpringsBlock(stale);
    expect(once).toBe(file(springsBlock()));
    expect(replaceSpringsBlock(once)).toBe(once);
  });

  it("refuses a file with a missing, doubled or reversed marker rather than guess", () => {
    const b = springsBlock();
    for (const bad of [
      "a {}\n",
      file(b.replace(SPRINGS_END, "")),
      file(b.replace(SPRINGS_START, "/*")),
      file(`${b}\n${b}`),
      file(`${SPRINGS_END}\n${SPRINGS_START} */`),
    ]) {
      expect(() => replaceSpringsBlock(bad)).toThrow(/exactly one/);
    }
  });

  it("writes LF line ends only", () => {
    expect(springsBlock()).not.toContain("\r");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/springs.test.ts test/instrument-spring.test.ts
```

Expected: both files fail to load with `Failed to resolve import "@/lib/motion/spring"`, and no test runs.

- [ ] **Step 3: Write the model, the block helpers and the script**

Create `web/lib/motion/spring.ts`:

```ts
/**
 * The site's one spring (spec 2026-11-23-maat-web-instrument-design.md section 8.2): it shapes the beam's CSS easings
 * and, later, the drag that tips the beam, so the two never disagree. A damped harmonic oscillator pulled toward a
 * target: x'' = -ω²(x - target) - 2ζωx', with damping ratio ζ and natural frequency ω.
 */

/** The needle's damping ratio: the beam swings past and settles. Its overshoot is exp(-πζ/√(1-ζ²)), 23.4%. */
export const NEEDLE_ZETA = 0.42;
/** The settle damping ratio: a small overshoot, 4.6%. */
export const SETTLE_ZETA = 0.7;
/** How long the beam takes to weigh, ms: --t-weigh in app/globals.css (test/springs.test.ts keeps them equal). */
export const WEIGH_MS = 600;

/** A curve ends where the swing's envelope e^(-ζωt)/√(1-ζ²) has fallen to this fraction of the travel. */
export const SETTLE_EPSILON = 0.001;
/** Intervals in a sampled curve: 61 points, one every 10 ms of a 600 ms beam. */
export const CURVE_INTERVALS = 60;
/** Decimals kept per point of a sampled curve. */
export const CURVE_DECIMALS = 3;

export interface Spring {
  /** Damping ratio ζ, between 0 and 1: under-damped, so it overshoots. */
  readonly zeta: number;
  /** Natural frequency ω, in radians per second. */
  readonly omega: number;
}

export interface SpringState {
  /** Position. */
  readonly x: number;
  /** Velocity, per second. */
  readonly v: number;
}

function underdamped(zeta: number): void {
  if (!(zeta > 0 && zeta < 1)) throw new Error(`a damping ratio between 0 and 1 is needed (under-damped), not ${zeta}`);
}

/** ωT: the radians of natural frequency a spring of damping ratio `zeta` takes to settle to SETTLE_EPSILON. */
export function settleRadians(zeta: number): number {
  underdamped(zeta);
  return -Math.log(SETTLE_EPSILON * Math.sqrt(1 - zeta * zeta)) / zeta;
}

/** The spring of damping ratio `zeta` that settles in `durationMs`: the CSS curve of that duration and the drag share it. */
export function springFor(zeta: number, durationMs: number): Spring {
  if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw new Error(`a positive duration is needed, not ${durationMs}`);
  return { zeta, omega: settleRadians(zeta) / (durationMs / 1000) };
}

/** The beam's spring: the needle's damping ratio over WEIGH_MS. */
export const NEEDLE: Spring = springFor(NEEDLE_ZETA, WEIGH_MS);

/** Where a spring released at rest at 0 is after `t` seconds, pulled toward 1: the closed form of the step response. */
export function stepResponse(spring: Spring, t: number): number {
  const { zeta, omega } = spring;
  underdamped(zeta);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
}

/** How far the step response swings past 1, as a fraction of the travel: exp(-πζ/√(1-ζ²)). */
export function overshoot(zeta: number): number {
  underdamped(zeta);
  return Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
}

/**
 * The points of a CSS linear() easing for damping ratio `zeta`: the step response at CURVE_INTERVALS + 1 evenly spaced
 * times from release to settle, each rounded to CURVE_DECIMALS. The first point is exactly 0 and the last exactly 1;
 * the points between swing above 1 by about the overshoot. The shape depends on `zeta` alone: the CSS duration stretches it.
 */
export function easingPoints(zeta: number): number[] {
  // Time in units of the settle time, so ω is the settle radians.
  const unit: Spring = { zeta, omega: settleRadians(zeta) };
  const scale = 10 ** CURVE_DECIMALS;
  const points: number[] = [];
  for (let k = 0; k <= CURVE_INTERVALS; k++) {
    if (k === 0) points.push(0);
    else if (k === CURVE_INTERVALS) points.push(1);
    else points.push(Math.round(stepResponse(unit, k / CURVE_INTERVALS) * scale) / scale);
  }
  return points;
}

/** easingPoints as a CSS value: "linear(0, 0.036, …, 1)". */
export function linearEasing(zeta: number): string {
  return `linear(${easingPoints(zeta).join(", ")})`;
}

/**
 * One semi-implicit (symplectic) Euler step of `dt` seconds toward `target`: the velocity first, then the position from
 * the new velocity. The drag runs one step per animation frame; it stays stable while ω·dt is under 2.
 */
export function springStep(state: SpringState, target: number, spring: Spring, dt: number): SpringState {
  const { zeta, omega } = spring;
  const a = -omega * omega * (state.x - target) - 2 * zeta * omega * state.v;
  const v = state.v + a * dt;
  return { x: state.x + v * dt, v };
}
```

Create `web/lib/motion/springs-css.ts`:

```ts
import { linearEasing, NEEDLE_ZETA, SETTLE_ZETA } from "./spring";

/** The marked block in app/globals.css that scripts/springs.ts writes: from the start marker to the end marker. */
export const SPRINGS_START = "/* springs:start";
export const SPRINGS_END = "/* springs:end */";
/** Where linear() is missing (spec 2026-11-23 section 8.2), both easings fall back to one overshooting curve. */
export const SPRING_FALLBACK = "cubic-bezier(0.34, 1.4, 0.64, 1)";

/** The springs block, start marker to end marker inclusive, as lib/motion/spring.ts gives it today. LF line ends. */
export function springsBlock(): string {
  return [
    `${SPRINGS_START}: written by \`npx tsx scripts/springs.ts\` from lib/motion/spring.ts; do not edit by hand. */`,
    "@theme {",
    `  --ease-needle: ${linearEasing(NEEDLE_ZETA)};`,
    `  --ease-settle: ${linearEasing(SETTLE_ZETA)};`,
    "}",
    "@supports not (transition-timing-function: linear(0, 1)) {",
    "  :root {",
    `    --ease-needle: ${SPRING_FALLBACK};`,
    `    --ease-settle: ${SPRING_FALLBACK};`,
    "  }",
    "}",
    SPRINGS_END,
  ].join("\n");
}

/** Where the block sits in `css`. Throws unless `css` holds exactly one start marker and, after it, exactly one end marker. */
function blockAt(css: string): { start: number; end: number } {
  const start = css.indexOf(SPRINGS_START);
  const end = css.indexOf(SPRINGS_END);
  const once = start >= 0 && end > start && css.indexOf(SPRINGS_START, start + 1) < 0 && css.indexOf(SPRINGS_END, end + 1) < 0;
  if (!once) throw new Error(`app/globals.css needs exactly one "${SPRINGS_START}" marker followed by exactly one "${SPRINGS_END}"`);
  return { start, end: end + SPRINGS_END.length };
}

/** The springs block as `css` holds it, start marker to end marker inclusive. */
export function currentSpringsBlock(css: string): string {
  const { start, end } = blockAt(css);
  return css.slice(start, end);
}

/** `css` with its springs block rewritten from the model; everything outside the markers is kept byte for byte. */
export function replaceSpringsBlock(css: string): string {
  const { start, end } = blockAt(css);
  return `${css.slice(0, start)}${springsBlock()}${css.slice(end)}`;
}
```

Create `web/scripts/springs.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { replaceSpringsBlock } from "../lib/motion/springs-css";

// Rewrites the springs block of app/globals.css from lib/motion/spring.ts: `npx tsx scripts/springs.ts` from web/.
// test/springs.test.ts fails while the block and the model disagree. Its package.json entry waits for PR #15.
const CSS = fileURLToPath(new URL("../app/globals.css", import.meta.url));

const before = readFileSync(CSS, "utf8");
const after = replaceSpringsBlock(before);
if (after === before) {
  console.log("app/globals.css: the springs block is up to date");
} else {
  writeFileSync(CSS, after);
  console.log("app/globals.css: wrote the springs block");
}
```

- [ ] **Step 4: Add the markers and generate the block**

In `web/app/globals.css`, use Edit with old_string set to these two lines:

```css
  --ease-instrument: cubic-bezier(0.2, 0.7, 0.2, 1);
}
```

Set new_string to those same two lines, then a blank line, then:

```css
/* springs:start: written by `npx tsx scripts/springs.ts` from lib/motion/spring.ts; do not edit by hand. */
/* springs:end */
```

Then run the script twice:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npx tsx scripts/springs.ts && npx tsx scripts/springs.ts
```

Expected: first `app/globals.css: wrote the springs block`, then `app/globals.css: the springs block is up to date`. The block in `globals.css` now reads exactly:

```css
/* springs:start: written by `npx tsx scripts/springs.ts` from lib/motion/spring.ts; do not edit by hand. */
@theme {
  --ease-needle: linear(0, 0.036, 0.13, 0.264, 0.421, 0.584, 0.742, 0.885, 1.006, 1.101, 1.17, 1.213, 1.232, 1.231, 1.215, 1.187, 1.152, 1.114, 1.077, 1.041, 1.011, 0.986, 0.967, 0.954, 0.947, 0.945, 0.948, 0.953, 0.961, 0.969, 0.978, 0.987, 0.994, 1.001, 1.006, 1.01, 1.012, 1.013, 1.013, 1.012, 1.01, 1.008, 1.006, 1.004, 1.002, 1, 0.999, 0.998, 0.997, 0.997, 0.997, 0.997, 0.997, 0.998, 0.998, 0.999, 0.999, 1, 1, 1, 1);
  --ease-settle: linear(0, 0.014, 0.05, 0.104, 0.17, 0.244, 0.322, 0.401, 0.479, 0.554, 0.624, 0.69, 0.749, 0.802, 0.85, 0.891, 0.926, 0.955, 0.98, 0.999, 1.015, 1.026, 1.035, 1.041, 1.044, 1.046, 1.046, 1.045, 1.043, 1.04, 1.037, 1.033, 1.029, 1.026, 1.022, 1.019, 1.016, 1.013, 1.01, 1.008, 1.006, 1.004, 1.003, 1.001, 1, 1, 0.999, 0.999, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.998, 0.999, 0.999, 0.999, 1);
}
@supports not (transition-timing-function: linear(0, 1)) {
  :root {
    --ease-needle: cubic-bezier(0.34, 1.4, 0.64, 1);
    --ease-settle: cubic-bezier(0.34, 1.4, 0.64, 1);
  }
}
/* springs:end */
```

If the script prints anything else, or the block differs, stop and report. The model is the source of truth. Never hand-edit the block.

- [ ] **Step 5: Run the tests and see them pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/springs.test.ts test/instrument-spring.test.ts test/instrument-tokens.test.ts test/tokens.test.ts
```

Expected: every test passes, and `test/springs.test.ts` with `test/instrument-spring.test.ts` count `17 passed`.

- [ ] **Step 6: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit**

Write `$SCRATCH/p0-commit-02.txt`:

```
feat(web): add the spring model and generate the springs block from it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/lib/motion/spring.ts web/lib/motion/springs-css.ts web/scripts/springs.ts web/app/globals.css web/test/springs.test.ts web/test/instrument-spring.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-02.txt"
```

---

### Task 3: `prefersReducedMotion` and `rollDigits`

**Files:**
- Create: `web/lib/motion/reduced-motion.ts`, `web/lib/motion/roll-digits.ts`
- Test: `web/test/instrument-roll-digits.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"`;
  - `prefersReducedMotion(): boolean`, which is true when `window` or `window.matchMedia` is missing;
  - `ROLL_MS = 240`, `ROLL_STAGGER_MS = 30` and `ROLL_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)"`;
  - `ROLL_KEYFRAMES: readonly Keyframe[]`, which is `[{ transform: "translateY(100%)" }, { transform: "translateY(0)" }]`;
  - `rollDigits(cells: readonly HTMLElement[], from: string, to: string): Animation[]`.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-roll-digits.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, REDUCED_MOTION_QUERY } from "@/lib/motion/reduced-motion";
import { ROLL_EASING, ROLL_KEYFRAMES, ROLL_MS, ROLL_STAGGER_MS, rollDigits } from "@/lib/motion/roll-digits";

/** One span per character, as Digits renders them. */
const cellsOf = (text: string) =>
  [...text].map((ch) => {
    const cell = document.createElement("span");
    cell.textContent = ch;
    return cell;
  });
const textOf = (cells: readonly HTMLElement[]) => cells.map((c) => c.textContent).join("");

/** A matchMedia that answers `reduce` for the reduced-motion query. */
function stubMotion(reduce: boolean) {
  const matchMedia = vi.fn((query: string) => ({ matches: query === REDUCED_MOTION_QUERY && reduce, media: query }));
  vi.stubGlobal("matchMedia", matchMedia);
  return matchMedia;
}

/** A WAAPI stand-in on Element.prototype: jsdom has none. */
function stubAnimate() {
  // The parameters are Element.animate's, so the test can read the keyframes and timing each call was given.
  const animate = vi.fn(function (this: Element, _keyframes: Keyframe[], _timing: KeyframeAnimationOptions) {
    return { target: this } as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: animate });
  return animate;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe("prefersReducedMotion (lib/motion/reduced-motion.ts)", () => {
  it("is true where window.matchMedia is missing, as in jsdom", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    expect(prefersReducedMotion()).toBe(true);
  });

  it("asks the reduced-motion query and returns its answer", () => {
    const matchMedia = stubMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("rollDigits (lib/motion/roll-digits.ts)", () => {
  it("only writes the text where Element.prototype.animate is missing, as in jsdom", () => {
    stubMotion(false);
    expect(typeof Element.prototype.animate).toBe("undefined");
    const cells = cellsOf("60,013,066");
    expect(rollDigits(cells, "60,013,066", "60,013,071")).toEqual([]);
    expect(textOf(cells)).toBe("60,013,071");
  });

  it("rolls only the changed characters, 240 ms each, 30 ms apart, in cell order", () => {
    stubMotion(false);
    const animate = stubAnimate();
    const cells = cellsOf("60,013,066");
    const started = rollDigits(cells, "60,013,066", "60,013,071");
    expect(textOf(cells)).toBe("60,013,071");
    expect(started).toHaveLength(2);
    expect(animate.mock.contexts).toEqual([cells[8], cells[9]]);
    expect(animate.mock.calls.map(([, timing]) => timing)).toEqual([
      { duration: ROLL_MS, delay: 0, easing: ROLL_EASING, fill: "backwards" },
      { duration: ROLL_MS, delay: ROLL_STAGGER_MS, easing: ROLL_EASING, fill: "backwards" },
    ]);
    expect(animate.mock.calls[0]?.[0]).toEqual(ROLL_KEYFRAMES);
  });

  it("rolls the cells React has already written: it compares with `from`, not with the cells", () => {
    stubMotion(false);
    const animate = stubAnimate();
    const cells = cellsOf("60,013,071");
    expect(rollDigits(cells, "60,013,066", "60,013,071")).toHaveLength(2);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("writes the text and rolls nothing under reduced motion", () => {
    stubMotion(true);
    const animate = stubAnimate();
    const cells = cellsOf("60,013,066");
    expect(rollDigits(cells, "60,013,066", "60,013,071")).toEqual([]);
    expect(textOf(cells)).toBe("60,013,071");
    expect(animate).not.toHaveBeenCalled();
  });

  it("rolls nothing when the reading is unchanged", () => {
    stubMotion(false);
    const animate = stubAnimate();
    expect(rollDigits(cellsOf("60,013,066"), "60,013,066", "60,013,066")).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it("writes but never rolls a reading that changed length, and leaves cells of the old length alone", () => {
    stubMotion(false);
    const animate = stubAnimate();
    const grown = cellsOf("10,000,000");
    expect(rollDigits(grown, "9,999,999", "10,000,000")).toEqual([]);
    expect(textOf(grown)).toBe("10,000,000");
    const old = cellsOf("9,999,999");
    expect(rollDigits(old, "9,999,999", "10,000,000")).toEqual([]);
    expect(textOf(old)).toBe("9,999,999");
    expect(animate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-roll-digits.test.ts
```

Expected: the file fails to load with `Failed to resolve import "@/lib/motion/reduced-motion"`.

- [ ] **Step 3: Write the helpers**

Create `web/lib/motion/reduced-motion.ts`:

```ts
/** The query the global reduce block of app/globals.css answers. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether the visitor asked for reduced motion. True where window.matchMedia is missing (on the server, in jsdom): a
 * page that cannot ask shows the final frame, which is the base style of every part (spec 2026-11-23 section 8.4).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}
```

Create `web/lib/motion/roll-digits.ts`:

```ts
import { prefersReducedMotion } from "./reduced-motion";

/** One character's roll, and the gap between two that roll together (spec 2026-11-23 section 8.3, digit-roll). */
export const ROLL_MS = 240;
export const ROLL_STAGGER_MS = 30;
/** --ease-instrument of app/globals.css, written out: WAAPI takes no var(). */
export const ROLL_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";
/** The new character rises into its cell from below; the number around the cells clips it (.digits in app/globals.css). */
export const ROLL_KEYFRAMES: readonly Keyframe[] = [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }];

function canAnimate(): boolean {
  return typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
}

/**
 * Writes `to` into `cells`, one character per cell, then rolls in each cell whose character differs from `from`, in
 * cell order, ROLL_STAGGER_MS apart. Only a change between two readings of the same length rolls: when `from` and `to`
 * differ in length (a block number that gains a digit), the cells no longer line up, so the text is written and nothing
 * rolls. When `cells` and `to` differ in length nothing is written: the caller renders one cell per character first.
 * Under reduced motion, or where Element.prototype.animate is missing (jsdom), it only writes the text. Returns the
 * animations it started, each finite.
 */
export function rollDigits(cells: readonly HTMLElement[], from: string, to: string): Animation[] {
  const next = [...to];
  if (cells.length !== next.length) return [];
  next.forEach((ch, i) => {
    const cell = cells[i]!;
    if (cell.textContent !== ch) cell.textContent = ch;
  });
  const before = [...from];
  if (before.length !== next.length || prefersReducedMotion() || !canAnimate()) return [];
  const started: Animation[] = [];
  next.forEach((ch, i) => {
    if (before[i] === ch) return;
    const timing: KeyframeAnimationOptions = {
      duration: ROLL_MS,
      delay: started.length * ROLL_STAGGER_MS,
      easing: ROLL_EASING,
      fill: "backwards",
    };
    started.push(cells[i]!.animate([...ROLL_KEYFRAMES], timing));
  });
  return started;
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-roll-digits.test.ts
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0. The typed parameters of the `animate` stub are what let `mock.calls` be read without a type error.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-03.txt`:

```
feat(web): add prefersReducedMotion and the rollDigits helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/lib/motion/reduced-motion.ts web/lib/motion/roll-digits.ts web/test/instrument-roll-digits.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-03.txt"
```

---

### Task 4: `onceInView`

**Files:**
- Create: `web/lib/motion/once-in-view.ts`
- Test: `web/test/instrument-once-in-view.test.ts`

**Interfaces:**
- Consumes: none.
- Produces:
  - `SEEN_ROOT_MARGIN = "100000px 0px -12% 0px"`;
  - `onceInView(el: Element): () => void`, which sets `data-seen=""` once and returns a cleanup that stops watching. ThumbBar (P1) and the Scope's draw (P2a) use it.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-once-in-view.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** An IntersectionObserver stand-in that records what it watches and lets a test report intersections. */
class FakeObserver {
  static made: FakeObserver[] = [];
  readonly watched = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    FakeObserver.made.push(this);
  }
  observe(el: Element) {
    this.watched.add(el);
  }
  unobserve(el: Element) {
    this.watched.delete(el);
  }
  disconnect() {
    this.watched.clear();
  }
  /** Reports `el` crossing into (or out of) the band. */
  report(el: Element, isIntersecting: boolean) {
    this.callback([{ target: el, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

/** A fresh copy of the module, so each test starts with no shared observer. */
async function load() {
  vi.resetModules();
  return import("@/lib/motion/once-in-view");
}

beforeEach(() => {
  FakeObserver.made = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onceInView (lib/motion/once-in-view.ts)", () => {
  it("sets data-seen at once where IntersectionObserver is missing, as in jsdom", async () => {
    const { onceInView } = await load();
    expect(typeof IntersectionObserver).toBe("undefined");
    const el = document.createElement("div");
    const stop = onceInView(el);
    expect(el).toHaveAttribute("data-seen", "");
    expect(() => stop()).not.toThrow();
  });

  it("watches every element through one observer, with the spec's band", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { onceInView, SEEN_ROOT_MARGIN } = await load();
    const a = document.createElement("div");
    const b = document.createElement("div");
    onceInView(a);
    onceInView(b);
    expect(FakeObserver.made).toHaveLength(1);
    expect(FakeObserver.made[0]!.options).toEqual({ rootMargin: "100000px 0px -12% 0px" });
    expect(SEEN_ROOT_MARGIN).toBe("100000px 0px -12% 0px");
    expect([...FakeObserver.made[0]!.watched]).toEqual([a, b]);
    expect(a).not.toHaveAttribute("data-seen");
  });

  it("marks an element seen when it enters the band, then stops watching it", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { onceInView } = await load();
    const el = document.createElement("div");
    onceInView(el);
    const io = FakeObserver.made[0]!;
    io.report(el, false);
    expect(el).not.toHaveAttribute("data-seen");
    io.report(el, true);
    expect(el).toHaveAttribute("data-seen", "");
    expect(io.watched.has(el)).toBe(false);
  });

  it("leaves an element already seen alone, and its cleanup stops watching", async () => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const { onceInView } = await load();
    const seen = document.createElement("div");
    seen.setAttribute("data-seen", "");
    onceInView(seen);
    expect(FakeObserver.made).toHaveLength(0);
    const el = document.createElement("div");
    const stop = onceInView(el);
    expect(FakeObserver.made[0]!.watched.has(el)).toBe(true);
    stop();
    expect(FakeObserver.made[0]!.watched.has(el)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-once-in-view.test.ts
```

Expected: it fails with `Failed to resolve import "@/lib/motion/once-in-view"`, either at load or in each of the 4 tests.

- [ ] **Step 3: Write the helper**

Create `web/lib/motion/once-in-view.ts`:

```ts
/**
 * The band a part must reach to count as seen (spec 2026-11-23 section 5.1): anything above the viewport counts, so a
 * page opened half way down shows the parts it scrolled past finished, and the bottom 12% of the viewport does not.
 */
export const SEEN_ROOT_MARGIN = "100000px 0px -12% 0px";

let shared: IntersectionObserver | undefined;

/** The page's one observer, made on first use. */
function observer(): IntersectionObserver {
  shared ??= new IntersectionObserver(
    (entries, io) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-seen", "");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: SEEN_ROOT_MARGIN },
  );
  return shared;
}

/**
 * Sets data-seen on `el` the first time it enters the band, through one IntersectionObserver the whole page shares.
 * Where IntersectionObserver is missing (jsdom, old browsers) it sets data-seen at once, so the part shows its final
 * frame. An element already seen is left alone. Returns a cleanup that stops watching `el`.
 */
export function onceInView(el: Element): () => void {
  if (el.hasAttribute("data-seen")) return () => {};
  if (typeof IntersectionObserver === "undefined") {
    el.setAttribute("data-seen", "");
    return () => {};
  }
  const io = observer();
  io.observe(el);
  return () => io.unobserve(el);
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-once-in-view.test.ts
```

Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-04.txt`:

```
feat(web): add the onceInView helper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/lib/motion/once-in-view.ts web/test/instrument-once-in-view.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-04.txt"
```

---

### Task 5: `formatLimit`

**Files:**
- Modify: `web/content/format.ts`. Append after line 46, the last line of the file and the closing `}` of `andList`.
- Test: `web/test/format-limit.test.ts`

**Interfaces:**
- Consumes: `formatInt(n: number): string` from `web/content/format.ts` (`toLocaleString("en-US")`), and `FACTS.mandate.value` in the test.
- Produces:
  - `type LimitUnit = "s" | "bps"`;
  - `formatLimit(value: number, unit: LimitUnit): string`. It throws for a value that is not a whole number of 0 or more. Meter uses it in Task 10, and P1 and later surfaces use it too.

- [ ] **Step 1: Write the failing test**

Create `web/test/format-limit.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { formatLimit } from "@/content/format";

const m = FACTS.mandate.value;

describe("formatLimit (spec 2026-11-23 section 5.1)", () => {
  it('writes the feed-age limit as "90,000 s (25 h)", from FACTS', () => {
    expect(m.maxStalenessSec).toBe(90_000);
    expect(formatLimit(m.maxStalenessSec, "s")).toBe("90,000 s (25 h)");
  });

  it("writes every other limit in seconds the same way: whole hours first, else whole minutes", () => {
    expect(formatLimit(m.twapWindowSec, "s")).toBe("1,800 s (30 min)");
    expect(formatLimit(m.multiplierCooldownSec, "s")).toBe("86,400 s (24 h)");
    expect(formatLimit(m.deriskWindowSec, "s")).toBe("28,800 s (8 h)");
    expect(formatLimit(3600, "s")).toBe("3,600 s (1 h)");
    expect(formatLimit(5400, "s")).toBe("5,400 s (90 min)");
    expect(formatLimit(60, "s")).toBe("60 s (1 min)");
  });

  it("writes seconds alone under a minute, or when neither hours nor minutes divide them", () => {
    expect(formatLimit(45, "s")).toBe("45 s");
    expect(formatLimit(90, "s")).toBe("90 s");
    expect(formatLimit(3601, "s")).toBe("3,601 s");
    expect(formatLimit(0, "s")).toBe("0 s");
  });

  it("writes basis points with their unit, grouped", () => {
    expect(formatLimit(m.maxPremiumBps, "bps")).toBe("100 bps");
    expect(formatLimit(m.maxSlippageBps, "bps")).toBe("150 bps");
    expect(formatLimit(m.maxWeightBps, "bps")).toBe("4,000 bps");
    expect(formatLimit(0, "bps")).toBe("0 bps");
  });

  it("refuses a limit that is not a whole number of 0 or more", () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatLimit(bad, "s"), String(bad)).toThrow(/whole number/);
      expect(() => formatLimit(bad, "bps"), String(bad)).toThrow(/whole number/);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/format-limit.test.ts
```

Expected: `Tests  5 failed (5)`, with `formatLimit is not a function` (or a missing-export error naming `formatLimit`).

- [ ] **Step 3: Append the function**

In `web/content/format.ts`, use Edit with old_string set to these two lines (the end of `andList`):

```ts
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
```

Set new_string to those same two lines, then a blank line, then:

```ts
/** The units a limit is written in on the instrument surfaces. */
export type LimitUnit = "s" | "bps";

/**
 * A limit as every new instrument surface writes it (spec 2026-11-23 section 5.1): "100 bps", and seconds with the
 * whole hours, or else the whole minutes, after them: "90,000 s (25 h)", "1,800 s (30 min)". Under a minute, or
 * when neither divides it, the seconds stand alone: "45 s", "90 s". The Mandate sheet keeps its own "90000 s" and
 * NowBoard its formatAge until phase P4.
 */
export function formatLimit(value: number, unit: LimitUnit): string {
  if (!Number.isInteger(value) || value < 0) throw new Error(`a limit is a whole number of ${unit}, 0 or more: ${value}`);
  if (unit === "bps") return `${formatInt(value)} bps`;
  const seconds = `${formatInt(value)} s`;
  if (value >= 3600 && value % 3600 === 0) return `${seconds} (${formatInt(value / 3600)} h)`;
  if (value >= 60 && value % 60 === 0) return `${seconds} (${formatInt(value / 60)} min)`;
  return seconds;
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/format-limit.test.ts test/format.test.ts
```

Expected: every test passes, and `format-limit.test.ts` counts `5 passed`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives && git diff --numstat -- web/content/format.ts
```

Expected: the typecheck exits 0, and the numstat prints `18	0	web/content/format.ts`.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-05.txt`:

```
feat(web): add formatLimit for the instrument surfaces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/content/format.ts web/test/format-limit.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-05.txt"
```

---

### Task 6: `nextOpen`

**Files:**
- Modify: `web/content/calendar.ts`. Insert before line 145, `/** The dates the simulator offers: ...`, which is after `regularSession` and before `WINDOW`.
- Test: `web/test/calendar-next-open.test.ts`

**Interfaces:**
- Consumes, from `web/content/calendar.ts`:
  - `localTime(ts: number): LocalTime`;
  - `sessionWindow(etDay: number): { openMin: number; closeMin: number } | undefined`;
  - `etToTimestamp(etDay: number, minuteOfDay: number): number`;
  - `regularSession(ts)`, in the test.
- Produces:
  - `NEXT_OPEN_HORIZON_DAYS = 14`;
  - `nextOpen(ts: number): number`. It returns the UTC timestamp, in seconds, of the first REGULAR open strictly after `ts`, and throws for a non-finite `ts`. The P1 countdown uses it ("opens Mon 09:30 ET · in 11 h 58 min").

- [ ] **Step 1: Write the failing test**

Create `web/test/calendar-next-open.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nextOpen, regularSession } from "@/content/calendar";

/** Seconds since the epoch of a UTC wall-clock time. */
const utc = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
const iso = (ts: number) => new Date(ts * 1000).toISOString();

describe("nextOpen (content/calendar.ts)", () => {
  const cases: [name: string, at: number, next: number][] = [
    ["Saturday 21 Nov to Monday 23 Nov 09:30 EST", utc(2026, 11, 21, 15, 0), utc(2026, 11, 23, 14, 30)],
    ["the Wednesday 16:00 close skips Thanksgiving to Friday 27 Nov", utc(2026, 11, 25, 21, 0), utc(2026, 11, 27, 14, 30)],
    ["Thanksgiving, Thursday 26 Nov, to Friday 27 Nov", utc(2026, 11, 26, 15, 0), utc(2026, 11, 27, 14, 30)],
    ["the 13:00 ET early close of Friday 27 Nov to Monday 30 Nov", utc(2026, 11, 27, 18, 0), utc(2026, 11, 30, 14, 30)],
    ["the last open minute of Friday 27 Nov to Monday 30 Nov", utc(2026, 11, 27, 17, 59), utc(2026, 11, 30, 14, 30)],
    ["before the open of Friday 27 Nov to that same open", utc(2026, 11, 27, 13, 0), utc(2026, 11, 27, 14, 30)],
    ["one second before an open to that open", utc(2026, 11, 23, 14, 29, 59), utc(2026, 11, 23, 14, 30)],
    ["the open instant itself to the next day's open", utc(2026, 11, 23, 14, 30), utc(2026, 11, 24, 14, 30)],
    ["the 13:00 close of Christmas Eve over Christmas to Monday 28 Dec", utc(2026, 12, 24, 18, 0), utc(2026, 12, 28, 14, 30)],
    ["Friday 12 Mar 2027 over the DST start to Monday 15 Mar 09:30 EDT", utc(2027, 3, 12, 21, 0), utc(2027, 3, 15, 13, 30)],
    ["Friday 30 Oct 2026 over the DST end to Monday 2 Nov 09:30 EST", utc(2026, 10, 30, 20, 0), utc(2026, 11, 2, 14, 30)],
  ];

  it.each(cases)("%s", (_name, at, next) => {
    expect(iso(nextOpen(at))).toBe(iso(next));
  });

  it("is always a later instant where the market has just opened, with no open in between", () => {
    const from = utc(2026, 11, 20, 0, 0);
    const to = utc(2027, 1, 8, 0, 0);
    const step = 11 * 3600 + 7 * 60 + 13; // 11 h 7 min 13 s, so the samples fall on every hour of the week
    const opensAt = (minute: number) => regularSession(minute).open && !regularSession(minute - 60).open;
    let checked = 0;
    for (let ts = from; ts < to; ts += step) {
      const next = nextOpen(ts);
      expect(next, iso(ts)).toBeGreaterThan(ts);
      expect(next % 60, iso(ts)).toBe(0);
      expect(opensAt(next), iso(ts)).toBe(true);
      for (let minute = Math.ceil((ts + 1) / 60) * 60; minute < next; minute += 60) {
        if (opensAt(minute)) throw new Error(`${iso(ts)}: an open at ${iso(minute)} comes before ${iso(next)}`);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("refuses a timestamp that is not finite", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => nextOpen(bad), String(bad)).toThrow(/finite timestamp/);
    }
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/calendar-next-open.test.ts
```

Expected: `Tests  13 failed (13)`, with `nextOpen is not a function` (or a missing-export error naming `nextOpen`).

- [ ] **Step 3: Insert the function**

In `web/content/calendar.ts`, use Edit with old_string set to:

```ts
/** The dates the simulator offers: from the fork day to the last date the calendar lists. */
```

Set new_string to the block below, a blank line, then that same comment line:

```ts
/** How far nextOpen looks ahead: no NYSE closure in the calendar runs longer than a long weekend. */
export const NEXT_OPEN_HORIZON_DAYS = 14;

/**
 * The UTC timestamp of the first REGULAR open strictly after `ts` (spec 2026-11-23 section 5.1): the next trading day's
 * 09:30 ET, read from sessionWindow, so weekends, holidays and early closes count as the contract counts them, and the
 * DST rule of etToTimestamp sets the offset of that day. At the open instant itself it returns the next day's open.
 */
export function nextOpen(ts: number): number {
  if (!Number.isFinite(ts)) throw new Error(`nextOpen needs a finite timestamp: ${ts}`);
  const { etDay } = localTime(ts);
  for (let day = etDay; day < etDay + NEXT_OPEN_HORIZON_DAYS; day++) {
    const session = sessionWindow(day);
    if (session === undefined) continue;
    const open = etToTimestamp(day, session.openMin);
    if (open > ts) return open;
  }
  throw new Error(`no NYSE open within ${NEXT_OPEN_HORIZON_DAYS} days of ${ts}`);
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/calendar-next-open.test.ts test/calendar.test.ts test/simulator.test.ts
```

Expected: every test passes, and `calendar-next-open.test.ts` counts `13 passed`. The calendar port's Foundry vectors in `calendar.test.ts` still pass.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives && git diff --numstat -- web/content/calendar.ts
```

Expected: the typecheck exits 0, and the numstat prints `20	0	web/content/calendar.ts`.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-06.txt`:

```
feat(web): add nextOpen to the calendar port

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/content/calendar.ts web/test/calendar-next-open.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-06.txt"
```

---

### Task 7: Ghost and Digits

**Files:**
- Create: `web/components/instrument/Ghost.tsx`, `web/components/instrument/Digits.tsx`
- Modify: `web/app/globals.css`. Add one block immediately before `@media (prefers-reduced-motion: reduce) {`.
- Test: `web/test/instrument-ghost-digits.test.tsx`

**Interfaces:**
- Consumes: `rollDigits` and `ROLL_STAGGER_MS` from Task 3, `REDUCED_MOTION_QUERY` in the test, and `--color-lcd-ghost` from Task 1.
- Produces:
  - `ghostOf(sample: string): string`;
  - `interface GhostProps { pattern: string; className?: string }`, and `Ghost(props: GhostProps)`, which renders `<span aria-hidden="true" data-ghost class="ghost">` and throws unless the pattern holds only `8 , . :` and spaces;
  - `interface DigitsProps { value: string; className?: string }`, and `Digits(props: DigitsProps)`, a `"use client"` component that renders `<span data-digits class="digits">` with one `<span>` per character;
  - the CSS classes `.ghost` and `.digits`.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-ghost-digits.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Digits } from "@/components/instrument/Digits";
import { Ghost, ghostOf } from "@/components/instrument/Ghost";
import { REDUCED_MOTION_QUERY } from "@/lib/motion/reduced-motion";
import { ROLL_STAGGER_MS } from "@/lib/motion/roll-digits";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

/** A WAAPI stand-in on Element.prototype (jsdom has none), and a matchMedia that allows motion. */
function stubMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query !== REDUCED_MOTION_QUERY, media: query })),
  );
  // The parameters are Element.animate's, so the test can read the keyframes and timing each call was given.
  const animate = vi.fn(function (this: Element, _keyframes: Keyframe[], _timing: KeyframeAnimationOptions) {
    return { target: this } as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: animate });
  return animate;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe("Ghost (components/instrument/Ghost.tsx)", () => {
  it("is an empty aria-hidden span: the 8s are generated content, never text", () => {
    const { container } = render(<Ghost pattern="88,888,888" />);
    const ghost = container.firstElementChild as HTMLElement;
    expect(ghost.tagName).toBe("SPAN");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost).toHaveAttribute("data-ghost", "88,888,888");
    expect(ghost.className).toBe("ghost");
    expect(ghost.textContent).toBe("");
    expect(ghost.childNodes).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("adds a class after its own", () => {
    const { container } = render(<Ghost pattern="88:88" className="absolute inset-0" />);
    expect((container.firstElementChild as HTMLElement).className).toBe("ghost absolute inset-0");
  });

  it("turns every digit of a sample into an 8 and keeps the separators", () => {
    expect(ghostOf("60,013,066")).toBe("88,888,888");
    expect(ghostOf("14:30:05")).toBe("88:88:88");
    expect(ghostOf("1.000537")).toBe("8.888888");
  });

  it("refuses a pattern that would show anything but unlit segments, a 0 included", () => {
    for (const bad of ["", "0", "88,888,880", "Reading", "88-88"]) {
      expect(() => render(<Ghost pattern={bad} />), JSON.stringify(bad)).toThrow(/ghost pattern/);
    }
  });

  it("is drawn from data-ghost in lcd-ghost mono, and hidden under forced-colors", () => {
    expect(css).toMatch(
      /\.ghost::before\s*\{\s*content:\s*attr\(data-ghost\);\s*color:\s*var\(--color-lcd-ghost\);\s*font-family:\s*var\(--font-mono\);\s*font-variant-numeric:\s*tabular-nums;\s*white-space:\s*pre;\s*\}/,
    );
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.ghost\s*\{\s*display:\s*none;\s*\}\s*\}/);
  });
});

describe("Digits (components/instrument/Digits.tsx)", () => {
  const cells = (root: Element) => [...root.querySelectorAll("[data-digits] > span")];

  it("writes the value as one span per character, in a digits span", () => {
    const { container } = render(<Digits value="60,013,066" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-digits", "");
    expect(root.className).toBe("digits");
    expect(root.textContent).toBe("60,013,066");
    expect(cells(container).map((c) => c.textContent)).toEqual([..."60,013,066"]);
  });

  it("adds a class after its own", () => {
    const { container } = render(<Digits value="1" className="text-[38px]" />);
    expect((container.firstElementChild as HTMLElement).className).toBe("digits text-[38px]");
  });

  it("never rolls the first reading, even where motion is allowed", () => {
    const animate = stubMotion();
    render(<Digits value="60,013,066" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("rolls only the digits a new reading changed", () => {
    const animate = stubMotion();
    const { container, rerender } = render(<Digits value="60,013,066" />);
    rerender(<Digits value="60,013,071" />);
    expect(container.textContent).toBe("60,013,071");
    expect(animate.mock.contexts).toEqual([cells(container)[8], cells(container)[9]]);
    expect(animate.mock.calls.map(([, timing]) => timing.delay)).toEqual([0, ROLL_STAGGER_MS]);
  });

  it("rolls nothing on a re-render with the same reading", () => {
    const animate = stubMotion();
    const { rerender } = render(<Digits value="60,013,066" />);
    rerender(<Digits value="60,013,066" className="x" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("writes a reading that gained a digit in full and rolls nothing", () => {
    const animate = stubMotion();
    const { container, rerender } = render(<Digits value="9,999,999" />);
    rerender(<Digits value="10,000,000" />);
    expect(container.textContent).toBe("10,000,000");
    expect(cells(container)).toHaveLength(10);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Digits value="10,000,001" />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("only writes the new reading where Element.prototype.animate is missing, as in jsdom", () => {
    expect(typeof Element.prototype.animate).toBe("undefined");
    const { container, rerender } = render(<Digits value="60,013,066" />);
    rerender(<Digits value="60,013,071" />);
    expect(container.textContent).toBe("60,013,071");
  });

  it("clips the roll to the number and keeps every cell in line", () => {
    expect(css).toMatch(
      /\.digits\s*\{\s*display:\s*inline-block;\s*clip-path:\s*inset\(0\);\s*font-family:\s*var\(--font-mono\);\s*font-variant-numeric:\s*tabular-nums;\s*white-space:\s*nowrap;\s*\}/,
    );
    expect(css).toMatch(/\.digits > span\s*\{\s*display:\s*inline-block;\s*\}/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-ghost-digits.test.tsx
```

Expected: the file fails to load with `Failed to resolve import "@/components/instrument/Digits"`.

- [ ] **Step 3: Write the parts and their CSS**

Create `web/components/instrument/Ghost.tsx`:

```tsx
/** What a ghost may show: unlit 8s, and the separators a reading keeps. */
const GHOST_PATTERN = /^[8,.: ]+$/;

/** The unlit shape of a reading like `sample`: every digit becomes an 8, so "60,013,066" gives "88,888,888". */
export function ghostOf(sample: string): string {
  return sample.replace(/\d/g, "8");
}

export interface GhostProps {
  /** The unlit shape, for example "88,888,888": 8s and the separators , . : and space only. */
  pattern: string;
  className?: string;
}

/**
 * Unlit segments: "not read yet" (spec 2026-11-23 sections 4 and 5.1). The 8s are CSS generated content on an empty
 * aria-hidden span, so they are in no accessible text and no textContent, and never read as a 0. `.ghost` in
 * app/globals.css draws them, and hides them under forced-colors.
 */
export function Ghost({ pattern, className }: GhostProps) {
  if (!GHOST_PATTERN.test(pattern)) {
    throw new Error(`a ghost pattern holds only 8s and the separators , . : or space: ${JSON.stringify(pattern)}`);
  }
  return <span aria-hidden="true" data-ghost={pattern} className={className ? `ghost ${className}` : "ghost"} />;
}
```

Create `web/components/instrument/Digits.tsx`:

```tsx
"use client";

import { useLayoutEffect, useRef } from "react";
import { rollDigits } from "@/lib/motion/roll-digits";

export interface DigitsProps {
  /** The reading as written, for example formatBlock(snapshot.block). */
  value: string;
  className?: string;
}

/**
 * A mono tabular number, one span per character (spec 2026-11-23 section 5.1). React writes the value; when a new
 * reading replaces an earlier one of the same length, rollDigits rolls in only the characters that changed. The first
 * reading never rolls (section 8.1, rule 3: never count), and neither does a reading that changed length.
 */
export function Digits({ value, className }: DigitsProps) {
  const root = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useLayoutEffect(() => {
    const from = shown.current;
    shown.current = value;
    const el = root.current;
    if (from === value || el === null) return;
    rollDigits([...el.children] as HTMLElement[], from, value);
  }, [value]);
  return (
    <span ref={root} data-digits="" className={className ? `digits ${className}` : "digits"}>
      {[...value].map((ch, i) => (
        // One cell per position: a cell keeps its place when its character changes, which is what rolls.
        <span key={i}>{ch}</span>
      ))}
    </span>
  );
}
```

In `web/app/globals.css`, insert this block immediately before `@media (prefers-reduced-motion: reduce) {`, with a blank line after it. With Edit, set old_string to `@media (prefers-reduced-motion: reduce) {` and new_string to the block, a blank line, then that line.

```css
/* Ghost and Digits (components/instrument/Ghost.tsx, Digits.tsx). A ghost's 8s come from data-ghost, so no 8 is ever
   text; a digit rolls inside its cell, and the number clips the roll. */
@layer components {
  .ghost::before {
    content: attr(data-ghost);
    color: var(--color-lcd-ghost);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: pre;
  }
  @media (forced-colors: active) {
    .ghost {
      display: none;
    }
  }
  .digits {
    display: inline-block;
    clip-path: inset(0);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .digits > span {
    display: inline-block;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-ghost-digits.test.tsx test/instrument-contrast.test.ts test/tokens.test.ts
```

Expected: every test passes, and `instrument-ghost-digits.test.tsx` counts `13 passed`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-07.txt`:

```
feat(web): add the Ghost and Digits instrument parts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/components/instrument/Ghost.tsx web/components/instrument/Digits.tsx web/app/globals.css web/test/instrument-ghost-digits.test.tsx
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-07.txt"
```

---

### Task 8: Readout

**Files:**
- Create: `web/components/instrument/Readout.tsx`
- Test: `web/test/instrument-readout.test.tsx`

**Interfaces:**
- Consumes: Tailwind utilities from the Task 1 tokens (`bg-chassis-2`, `border-chassis-line`, `text-lcd`, `text-lcd-2`, `outline-pass-lit`). The test also uses `Ghost` from Task 7 and `READING` from `web/components/live/LiveStatus.tsx`, read only.
- Produces:
  - `interface ReadoutProps extends Omit<ComponentProps<"div">, "className"> { reserve: string; className?: string }`;
  - the `READOUT_CLASS` string;
  - `Readout(props: ReadoutProps)`, which renders one `<div data-readout>` and passes every other prop through, `ref` included;
  - `interface ReadoutKeysProps { children: ReactNode; className?: string }`;
  - `ReadoutKeys(props: ReadoutKeysProps)`, which renders `<div data-readout-keys>`.

  In P1, LiveStrip renders its existing children through these components.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-readout.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { Ghost } from "@/components/instrument/Ghost";
import { READOUT_CLASS, Readout, ReadoutKeys } from "@/components/instrument/Readout";
import { READING } from "@/components/live/LiveStatus";

describe("Readout (components/instrument/Readout.tsx)", () => {
  it("is one chassis-2 window, full width, with the reserved height after its own classes", () => {
    const { container } = render(
      <Readout reserve="h-[132px] md:h-[112px]" className="mt-6">
        <p>x</p>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(container.children).toHaveLength(1);
    expect(root.tagName).toBe("DIV");
    expect(root).toHaveAttribute("data-readout", "");
    expect(root.className).toBe(`${READOUT_CLASS} h-[132px] md:h-[112px] mt-6`);
    for (const c of ["w-full", "rounded-[14px]", "border-chassis-line", "bg-chassis-2", "text-lcd"]) {
      expect(root.classList.contains(c), c).toBe(true);
    }
  });

  it("passes the live strip's ref, tabIndex and data-live-strip through to that one element", () => {
    const ref = createRef<HTMLDivElement>();
    const { container } = render(
      <Readout ref={ref} reserve="h-[120px]" tabIndex={-1} data-live-strip="live" aria-label="Live reading">
        <p>x</p>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(ref.current).toBe(root);
    expect(root).toHaveAttribute("tabindex", "-1");
    expect(root).toHaveAttribute("data-live-strip", "live");
    expect(root).toHaveAttribute("aria-label", "Live reading");
    ref.current?.focus();
    expect(document.activeElement).toBe(root);
  });

  it("keeps the strip's children as its direct children, in order: span, one p, the keys div, noscript", () => {
    const { container } = render(
      <Readout reserve="h-[120px]" data-live-strip="reading">
        <span className="sr-only" role="status" aria-live="polite" />
        <p className="m-0">
          <Ghost pattern="88,888,888" />
          {READING}
        </p>
        <ReadoutKeys>
          <button type="button">Hold</button>
        </ReadoutKeys>
        <noscript>Live data needs JavaScript.</noscript>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect([...root.children].map((c) => c.tagName)).toEqual(["SPAN", "P", "DIV", "NOSCRIPT"]);
    expect(root.querySelectorAll(":scope > p")).toHaveLength(1);
    expect(root.querySelector(":scope > p")?.textContent).toBe(READING);
    expect(root.querySelector(":scope > [data-readout-keys]")?.tagName).toBe("DIV");
  });

  it("adds no live region of its own: the strip's announcer stays the only one", () => {
    const { container } = render(
      <Readout reserve="h-[120px]">
        <span role="status" aria-live="polite" />
        <p>x</p>
      </Readout>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toHaveAttribute("aria-live");
    expect(root).not.toHaveAttribute("role");
    expect(root.querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});

describe("ReadoutKeys (components/instrument/Readout.tsx)", () => {
  it("is a div of small lcd-2 mono keys, never a p", () => {
    const { container } = render(
      <ReadoutKeys className="justify-end">
        <button type="button">Retry</button>
      </ReadoutKeys>,
    );
    const keys = container.firstElementChild as HTMLElement;
    expect(keys.tagName).toBe("DIV");
    expect(keys).toHaveAttribute("data-readout-keys", "");
    expect(keys.className).toBe("flex flex-wrap items-center gap-2 font-mono text-[11px] text-lcd-2 justify-end");
    expect(container.querySelector("p")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-readout.test.tsx
```

Expected: the file fails to load with `Failed to resolve import "@/components/instrument/Readout"`.

- [ ] **Step 3: Write the part**

Create `web/components/instrument/Readout.tsx`:

```tsx
import type { ComponentProps, ReactNode } from "react";

export interface ReadoutProps extends Omit<ComponentProps<"div">, "className"> {
  /**
   * The fixed height per breakpoint, as Tailwind classes written out where the Readout is used, for example
   * "h-[132px] md:h-[112px]": sized for the tallest state at that breakpoint's narrowest width, so nothing under the
   * window moves when a reading lands (spec 2026-11-23 sections 3.5 and 5.1).
   */
  reserve: string;
  className?: string;
}

/** The window's own classes: a chassis-2 display window, radius 14, a 1 px chassis-line bezel, lcd text. */
export const READOUT_CLASS =
  "box-border w-full rounded-[14px] border border-chassis-line bg-chassis-2 px-4 py-3 text-lcd focus-visible:outline-pass-lit";

/**
 * The display window a live reading sits in, 100% of its column wide. It renders one div and passes every other prop
 * through, so the live strip keeps data-live-strip, tabIndex={-1} and the useRetry ref on this one element, and its
 * children stay the div's direct children in the order given (the sr-only announcer, the one <p>, the bezel keys,
 * the <noscript>). It adds no aria-live: the strip's announcer stays the only live region inside it.
 */
export function Readout({ reserve, className, children, ...rest }: ReadoutProps) {
  const classes = [READOUT_CLASS, reserve, className].filter(Boolean).join(" ");
  return (
    <div data-readout="" {...rest} className={classes}>
      {children}
    </div>
  );
}

export interface ReadoutKeysProps {
  children: ReactNode;
  className?: string;
}

/** The bezel keys under the reading: a div, never a <p>, so the strip keeps exactly one <p> child (spec 3.5). */
export function ReadoutKeys({ children, className }: ReadoutKeysProps) {
  const classes = ["flex flex-wrap items-center gap-2 font-mono text-[11px] text-lcd-2", className].filter(Boolean).join(" ");
  return (
    <div data-readout-keys="" className={classes}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-readout.test.tsx test/instrument-contrast.test.ts
```

Expected: every test passes, and `instrument-readout.test.tsx` counts `5 passed`. The contrast scan now reads `Readout.tsx`: `text-lcd` and `text-lcd-2` are declared pairs, and its `bg-chassis-2` class list holds no accent, refuse or ink-2 text.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-08.txt`:

```
feat(web): add the Readout display window and its bezel keys slot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/components/instrument/Readout.tsx web/test/instrument-readout.test.tsx
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-08.txt"
```

---

### Task 9: Shared types, Lamp and SourcePlate

**Files:**
- Create: `web/components/instrument/types.ts`, `web/components/instrument/Lamp.tsx`, `web/components/instrument/SourcePlate.tsx`
- Modify: `web/app/globals.css`. Add one block immediately before `@media (prefers-reduced-motion: reduce) {`.
- Test: `web/test/instrument-lamp-plate.test.tsx`

**Interfaces:**
- Consumes: the Task 1 tokens (`--color-lamp-pass`, `--color-lamp-refuse`, `--color-lcd-ghost`, `--color-line-strong`, `--color-ink-3`, `--t-tick`, `--t-flip`, `--ease-instrument`). The test also uses `REASONS` and `REASON_LABEL` from `web/content/reasons.ts`.
- Produces from `types.ts`:
  - `type Surface = "faceplate" | "chassis"`;
  - `SMALL_TEXT: Readonly<Record<Surface, string>>`, which maps `faceplate` to `text-label` and `chassis` to `text-lcd-2`;
  - `type Verdict = "allowed" | "refused"`.
- Produces from `Lamp.tsx`:
  - `type LampState = "pass" | "refuse" | "skip" | "reading"`;
  - `LAMP_WORD`, which maps `pass` to `PASS`, `refuse` to `REFUSE`, `skip` to `SKIP` and `reading` to `""`;
  - `interface LampProps { state: LampState; on?: Surface; className?: string }`;
  - `Lamp(props: LampProps)`, which renders `<span data-lamp data-on class="lamp ...">`.
- Produces from `SourcePlate.tsx`:
  - `type PlateKind = "live" | "replay" | "edition" | "simulated" | "planned"`;
  - `interface SourcePlateProps extends Omit<ComponentProps<"span">, "className" | "children"> { kind: PlateKind; on?: Surface; children: ReactNode; className?: string }`;
  - `SourcePlate(props: SourcePlateProps)`.
- Produces in CSS: `.lamp`, the `lamp-on` keyframes and `.plate`.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-lamp-plate.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LAMP_WORD, Lamp, type LampState } from "@/components/instrument/Lamp";
import { type PlateKind, SourcePlate } from "@/components/instrument/SourcePlate";
import { SMALL_TEXT, type Surface } from "@/components/instrument/types";
import { REASON_LABEL, REASONS } from "@/content/reasons";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

const STATES: readonly LampState[] = ["pass", "refuse", "skip", "reading"];
const SURFACES: readonly Surface[] = ["faceplate", "chassis"];

describe("Lamp (components/instrument/Lamp.tsx)", () => {
  it.each<[LampState, string]>([
    ["pass", "PASS"],
    ["refuse", "REFUSE"],
    ["skip", "SKIP"],
  ])("%s prints its word, %s, as its only text", (state, word) => {
    const { container } = render(<Lamp state={state} />);
    const lamp = container.firstElementChild as HTMLElement;
    expect(lamp.tagName).toBe("SPAN");
    expect(lamp).toHaveAttribute("data-lamp", state);
    expect(lamp.textContent).toBe(word);
    expect(LAMP_WORD[state]).toBe(word);
  });

  it("prints no word while reading", () => {
    const { container } = render(<Lamp state="reading" />);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild).toHaveAttribute("data-lamp", "reading");
  });

  it.each(STATES)("%s never prints a ReasonTag, a reason code or a reason label", (state) => {
    const { container } = render(<Lamp state={state} on="chassis" />);
    expect(container.querySelector("[data-reason-tag]")).toBeNull();
    const text = container.textContent ?? "";
    for (const code of REASONS) {
      expect(text.includes(code), code).toBe(false);
      expect(text.includes(REASON_LABEL[code]), REASON_LABEL[code]).toBe(false);
    }
  });

  it.each(SURFACES)("on the %s, prints its word in that surface's small-text colour", (on) => {
    const { container } = render(<Lamp state="pass" on={on} className="ml-2" />);
    const lamp = container.firstElementChild as HTMLElement;
    expect(lamp).toHaveAttribute("data-on", on);
    expect(lamp.className).toBe(`lamp inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold ${SMALL_TEXT[on]} ml-2`);
  });

  it("draws the lamp from data-lamp: lit cores, a ring for skip, the 6 px lamp-on ring, and a border under forced-colors", () => {
    expect(css).toMatch(/\.lamp\[data-lamp="pass"\]\s*\{\s*--lamp:\s*var\(--color-lamp-pass\);\s*\}/);
    expect(css).toMatch(/\.lamp\[data-lamp="refuse"\]\s*\{\s*--lamp:\s*var\(--color-lamp-refuse\);\s*\}/);
    expect(css).toMatch(/\.lamp\[data-on="chassis"\]\s*\{\s*--lamp:\s*var\(--color-lcd-ghost\);\s*\}/);
    expect(css).toMatch(/\.lamp::before\s*\{[^}]*content:\s*"";[^}]*background-color:\s*var\(--lamp\);[^}]*transition:\s*background-color var\(--t-tick\)/);
    expect(css).toMatch(/\.lamp\[data-lamp="pass"\]::before,\s*\.lamp\[data-lamp="refuse"\]::before\s*\{\s*animation:\s*lamp-on var\(--t-flip\)/);
    expect(css).toMatch(/\.lamp\[data-lamp="skip"\]::before\s*\{\s*border:\s*1px solid var\(--color-ink-3\);\s*background-color:\s*transparent;\s*\}/);
    expect(css).toMatch(/@keyframes lamp-on\s*\{\s*from\s*\{\s*box-shadow:\s*0 0 0 6px[^}]*\}\s*to\s*\{\s*box-shadow:\s*0 0 0 0 transparent;\s*\}\s*\}/);
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.lamp::before\s*\{\s*border:\s*1px solid CanvasText;\s*\}\s*\}/);
  });
});

describe("SourcePlate (components/instrument/SourcePlate.tsx)", () => {
  it("keeps its words in their DOM case after an aria-hidden shape, uppercase by CSS only", () => {
    const { container } = render(<SourcePlate kind="replay">replay · Base fork · block 53,551,627</SourcePlate>);
    const plate = container.firstElementChild as HTMLElement;
    expect(plate.tagName).toBe("SPAN");
    expect(plate).toHaveAttribute("data-plate", "replay");
    expect(plate.textContent).toBe("replay · Base fork · block 53,551,627");
    expect(plate.classList.contains("uppercase")).toBe(true);
    const shape = plate.firstElementChild as HTMLElement;
    expect(shape).toHaveAttribute("data-plate-shape", "");
    expect(shape).toHaveAttribute("aria-hidden", "true");
    expect(shape.textContent).toBe("");
  });

  it("passes other props, such as data-fact, through to the plate", () => {
    const { container } = render(
      <SourcePlate kind="replay" data-fact="forkBlock" on="chassis" className="mt-1">
        replay · Base fork · block 53,551,627
      </SourcePlate>,
    );
    const plate = container.firstElementChild as HTMLElement;
    expect(plate).toHaveAttribute("data-fact", "forkBlock");
    expect(plate.className).toBe("plate inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase text-lcd-2 mt-1");
  });

  it.each<PlateKind>(["live", "replay", "edition", "simulated", "planned"])("draws the %s shape in app/globals.css", (kind) => {
    render(<SourcePlate kind={kind}>words</SourcePlate>);
    expect(css).toContain(`.plate[data-plate="${kind}"] > [data-plate-shape] {`);
  });

  it("engraves the words at .12em and gives each kind its shape", () => {
    expect(css).toMatch(/\.plate\s*\{\s*letter-spacing:\s*0\.12em;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="live"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*999px;\s*background:\s*currentColor;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="replay"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*999px;\s*background:\s*repeating-linear-gradient\(/);
    expect(css).toMatch(/\.plate\[data-plate="edition"\] > \[data-plate-shape\]\s*\{\s*background:\s*currentColor;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="simulated"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*2px;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="planned"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*999px;\s*border-style:\s*dashed;\s*\}/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-lamp-plate.test.tsx
```

Expected: the file fails to load with `Failed to resolve import "@/components/instrument/Lamp"`.

- [ ] **Step 3: Write the types, the parts and their CSS**

Create `web/components/instrument/types.ts`:

```ts
/** The surface a part sits on: the white faceplate, or a dark chassis window (spec 2026-11-23 section 9.2). */
export type Surface = "faceplate" | "chassis";

/**
 * Small text (12 px or less) on each surface, at 7:1 or more: label on the faceplate (7.96:1 on white, 7.43:1 on
 * surface-soft) and lcd-2 on the chassis (9.98:1 on ink, 9.20:1 on chassis-2). test/instrument-contrast.test.ts checks
 * both pairs.
 */
export const SMALL_TEXT: Readonly<Record<Surface, string>> = {
  faceplate: "text-label",
  chassis: "text-lcd-2",
};

/** A weighed trade's outcome, as data-verdict carries it on the Balance and the Tape. */
export type Verdict = "allowed" | "refused";
```

Create `web/components/instrument/Lamp.tsx`:

```tsx
import { SMALL_TEXT, type Surface } from "./types";

/** A lamp's state: lit for a pass or a refusal, a ring for a skipped check, unlit while the chain is being read. */
export type LampState = "pass" | "refuse" | "skip" | "reading";

/** The word each state prints (spec 2026-11-23 section 4). The reading state prints none. */
export const LAMP_WORD: Readonly<Record<LampState, string>> = {
  pass: "PASS",
  refuse: "REFUSE",
  skip: "SKIP",
  reading: "",
};

export interface LampProps {
  state: LampState;
  /** The surface the lamp sits on, which sets its word's colour and its unlit core. */
  on?: Surface;
  className?: string;
}

/**
 * A state lamp and its word. Colour is never the only signal: every lit state prints PASS, REFUSE or SKIP. A lamp never
 * prints a ReasonTag; reason codes stay in VerdictLine and the cards that carry them. The lamp itself is the `::before`
 * of `.lamp` in app/globals.css, keyed off data-lamp.
 */
export function Lamp({ state, on = "faceplate", className }: LampProps) {
  const classes = ["lamp inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold", SMALL_TEXT[on], className]
    .filter(Boolean)
    .join(" ");
  return (
    <span data-lamp={state} data-on={on} className={classes}>
      {LAMP_WORD[state]}
    </span>
  );
}
```

Create `web/components/instrument/SourcePlate.tsx`:

```tsx
import type { ComponentProps, ReactNode } from "react";
import { SMALL_TEXT, type Surface } from "./types";

/**
 * Where a figure comes from (spec 2026-11-23 section 4), each with its shape: live a filled dot, replay a ring with
 * hatch, edition a square, simulated an outline, planned a dashed ring.
 */
export type PlateKind = "live" | "replay" | "edition" | "simulated" | "planned";

export interface SourcePlateProps extends Omit<ComponentProps<"span">, "className" | "children"> {
  kind: PlateKind;
  on?: Surface;
  /** The plate's words in their DOM case, for example "replay · Base fork · block 53,551,627": CSS uppercases them. */
  children: ReactNode;
  className?: string;
}

/**
 * A provenance plate: an aria-hidden shape, then the words. The words stay in the case they are written in, so a test
 * that matches the lower-case DOM text still matches; `uppercase` and the .12em engraving come from CSS. Other props,
 * such as data-fact, pass through to the plate.
 */
export function SourcePlate({ kind, on = "faceplate", children, className, ...rest }: SourcePlateProps) {
  const classes = ["plate inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase", SMALL_TEXT[on], className]
    .filter(Boolean)
    .join(" ");
  return (
    <span data-plate={kind} {...rest} className={classes}>
      <span data-plate-shape="" aria-hidden="true" />
      {children}
    </span>
  );
}
```

In `web/app/globals.css`, insert this block immediately before `@media (prefers-reduced-motion: reduce) {`, with a blank line after it, the same way as in Task 7:

```css
/* Lamp (components/instrument/Lamp.tsx): the lamp is the ::before beside the word, unlit until data-lamp lights it.
   Lighting runs lamp-on once: a 6 px ring that fades to nothing, the base style. */
@layer components {
  .lamp {
    --lamp: var(--color-line-strong);
  }
  .lamp[data-on="chassis"] {
    --lamp: var(--color-lcd-ghost);
  }
  .lamp[data-lamp="pass"] {
    --lamp: var(--color-lamp-pass);
  }
  .lamp[data-lamp="refuse"] {
    --lamp: var(--color-lamp-refuse);
  }
  .lamp::before {
    content: "";
    flex: none;
    box-sizing: border-box;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background-color: var(--lamp);
    transition: background-color var(--t-tick) var(--ease-instrument);
  }
  .lamp[data-lamp="pass"]::before,
  .lamp[data-lamp="refuse"]::before {
    animation: lamp-on var(--t-flip) var(--ease-instrument);
  }
  .lamp[data-lamp="skip"]::before {
    border: 1px solid var(--color-ink-3);
    background-color: transparent;
  }
  @media (forced-colors: active) {
    .lamp::before {
      border: 1px solid CanvasText;
    }
  }
}
@keyframes lamp-on {
  from {
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--lamp) 35%, transparent);
  }
  to {
    box-shadow: 0 0 0 0 transparent;
  }
}

/* SourcePlate (components/instrument/SourcePlate.tsx): provenance by word and by shape. Uppercase comes from CSS. */
@layer components {
  .plate {
    letter-spacing: 0.12em;
  }
  .plate > [data-plate-shape] {
    flex: none;
    box-sizing: border-box;
    width: 8px;
    height: 8px;
    border: 1px solid currentColor;
  }
  .plate[data-plate="live"] > [data-plate-shape] {
    border-radius: 999px;
    background: currentColor;
  }
  .plate[data-plate="replay"] > [data-plate-shape] {
    border-radius: 999px;
    background: repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 3px);
  }
  .plate[data-plate="edition"] > [data-plate-shape] {
    background: currentColor;
  }
  .plate[data-plate="simulated"] > [data-plate-shape] {
    border-radius: 2px;
  }
  .plate[data-plate="planned"] > [data-plate-shape] {
    border-radius: 999px;
    border-style: dashed;
  }
}
```

A note for later phases: a lamp in the refuse state prints `REFUSE`. The static HTML must never contain "REFUSE" (spec 3.5), so the phases that mount a Lamp render the refuse state on the client only. P0 mounts nothing.

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-lamp-plate.test.tsx test/instrument-contrast.test.ts test/tokens.test.ts
```

Expected: every test passes, and `instrument-lamp-plate.test.tsx` counts `19 passed`. `tokens.test` still passes its opacity rule, because `lamp-on` animates a box-shadow, not opacity.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-09.txt`:

```
feat(web): add the Lamp and SourcePlate instrument parts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/components/instrument/types.ts web/components/instrument/Lamp.tsx web/components/instrument/SourcePlate.tsx web/app/globals.css web/test/instrument-lamp-plate.test.tsx
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-09.txt"
```

---

### Task 10: Meter and Ruler

**Files:**
- Create: `web/components/instrument/Meter.tsx`, `web/components/instrument/Ruler.tsx`
- Modify: `web/app/globals.css`. Add one block immediately before `@media (prefers-reduced-motion: reduce) {`.
- Test: `web/test/instrument-meter-ruler.test.tsx`

**Interfaces:**
- Consumes: `formatLimit` and `LimitUnit` from Task 5, `SMALL_TEXT` and `Surface` from Task 9, the tokens `--color-line`, `--color-chassis-line`, `--color-lamp-pass`, `--color-lamp-refuse` and `--color-tick`, and `FACTS.mandate.value` in the test.
- Produces from `Meter.tsx`:
  - `meterPercent(value: number, limit: number): number`, which throws for a limit that is not positive and finite, and for a value that is negative or not finite;
  - `meterText(value: number, limit: number, unit: LimitUnit): string`;
  - `interface MeterProps { value: number; limit: number; unit: LimitUnit; on?: Surface; className?: string }`;
  - `Meter(props: MeterProps)`.
- Produces from `Ruler.tsx`:
  - `RULER = { minorPx: 8, majorPx: 56, heightPx: 12 } as const`;
  - `Ruler({ className }: { className?: string })`.
- Produces in CSS: `.meter-track`, `.meter-fill` and `.ruler`.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-meter-ruler.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Meter, meterPercent, meterText } from "@/components/instrument/Meter";
import { RULER, Ruler } from "@/components/instrument/Ruler";
import { FACTS } from "@/content/facts";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");
const m = FACTS.mandate.value;

/** The meter's parts: the root, the aria-hidden track, its fill, and the written number. */
function setup(ui: ReactElement) {
  const { container } = render(ui);
  const root = container.firstElementChild as HTMLElement;
  const [track, number] = [...root.children] as [HTMLElement, HTMLElement];
  return { root, track, fill: track.firstElementChild as HTMLElement, number };
}

describe("meterPercent and meterText (components/instrument/Meter.tsx)", () => {
  it("scales a reading to its limit, 0 to 100", () => {
    expect(meterPercent(0, 100)).toBe(0);
    expect(meterPercent(53, 100)).toBe(53);
    expect(meterPercent(100, 100)).toBe(100);
    expect(meterPercent(45_000, m.maxStalenessSec)).toBe(50);
  });

  it("pins a reading past its limit at 100", () => {
    expect(meterPercent(101, 100)).toBe(100);
    expect(meterPercent(1e12, 100)).toBe(100);
  });

  it("refuses a limit that is not positive and finite", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => meterPercent(1, bad), String(bad)).toThrow(/positive, finite limit/);
    }
  });

  it("refuses a reading that is negative or not finite", () => {
    for (const bad of [-0.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => meterPercent(bad, 100), String(bad)).toThrow(/finite value of 0 or more/);
    }
  });

  it("writes the reading, rounded, over the limit, in the limit wording", () => {
    expect(meterText(53, m.maxPremiumBps, "bps")).toBe("53 bps / 100 bps");
    expect(meterText(52.6, m.maxPremiumBps, "bps")).toBe("53 bps / 100 bps");
    expect(meterText(14, m.maxStalenessSec, "s")).toBe("14 s / 90,000 s (25 h)");
  });

  it("refuses a limit that is not a whole number, through formatLimit", () => {
    expect(() => meterText(1, 1.5, "bps")).toThrow(/whole number/);
  });
});

describe("Meter (components/instrument/Meter.tsx)", () => {
  it("reads its full scale from the limit prop, fed by FACTS", () => {
    const { root, fill, number } = setup(<Meter value={53} limit={m.maxPremiumBps} unit="bps" />);
    expect(root).toHaveAttribute("data-meter", "");
    expect(root).not.toHaveAttribute("data-over");
    expect(fill.style.width).toBe("53%");
    expect(number.textContent).toBe("53 bps / 100 bps");
  });

  it("moves its full scale with the limit: the same reading on another limit fills another share", () => {
    const { fill, number } = setup(<Meter value={53} limit={m.maxSlippageBps} unit="bps" />);
    expect(fill.style.width).toBe(`${(53 / 150) * 100}%`);
    expect(number.textContent).toBe("53 bps / 150 bps");
  });

  it("marks a reading past its limit, pins the bar, and still writes the reading", () => {
    const { root, fill, number } = setup(<Meter value={108_000} limit={m.maxStalenessSec} unit="s" />);
    expect(root).toHaveAttribute("data-over", "");
    expect(fill.style.width).toBe("100%");
    expect(number.textContent).toBe("108,000 s (30 h) / 90,000 s (25 h)");
  });

  it("hides the bar from assistive tech; the written number is the reading", () => {
    const { track, number } = setup(<Meter value={0} limit={m.maxPremiumBps} unit="bps" />);
    expect(track).toHaveAttribute("aria-hidden", "true");
    expect(track.textContent).toBe("");
    expect(number).not.toHaveAttribute("aria-hidden");
    expect(number.textContent).toBe("0 bps / 100 bps");
  });

  it.each([
    ["faceplate", "text-label"],
    ["chassis", "text-lcd-2"],
  ] as const)("on the %s, writes its number in %s", (on, colour) => {
    const { root, number } = setup(<Meter value={1} limit={m.maxPremiumBps} unit="bps" on={on} className="w-40" />);
    expect(root).toHaveAttribute("data-on", on);
    expect(root.className).toBe("meter inline-flex flex-col gap-1 w-40");
    expect(number.className).toBe(`font-mono text-[11px] tabular-nums ${colour}`);
  });

  it("refuses to render a bad limit or a bad reading rather than draw a wrong bar", () => {
    expect(() => render(<Meter value={1} limit={0} unit="bps" />)).toThrow(/positive, finite limit/);
    expect(() => render(<Meter value={Number.NaN} limit={100} unit="bps" />)).toThrow(/finite value/);
  });

  it("draws a hairline track, a pass fill, and a refuse fill past the limit", () => {
    expect(css).toMatch(/\.meter-track\s*\{\s*display:\s*block;\s*height:\s*2px;\s*background:\s*var\(--color-line\);\s*\}/);
    expect(css).toMatch(/\.meter\[data-on="chassis"\] \.meter-track\s*\{\s*background:\s*var\(--color-chassis-line\);\s*\}/);
    expect(css).toMatch(/\.meter-fill\s*\{\s*display:\s*block;\s*height:\s*100%;\s*background:\s*var\(--color-lamp-pass\);\s*\}/);
    expect(css).toMatch(/\.meter\[data-over\] \.meter-fill\s*\{\s*background:\s*var\(--color-lamp-refuse\);\s*\}/);
  });
});

describe("Ruler (components/instrument/Ruler.tsx)", () => {
  it("is an empty aria-hidden div", () => {
    const { container } = render(<Ruler className="mt-8" />);
    const ruler = container.firstElementChild as HTMLElement;
    expect(ruler.tagName).toBe("DIV");
    expect(ruler).toHaveAttribute("aria-hidden", "true");
    expect(ruler).toHaveAttribute("data-ruler", "");
    expect(ruler.className).toBe("ruler mt-8");
    expect(ruler.childNodes).toHaveLength(0);
  });

  it("draws a minor tick every 8 px and a major one every 56 px, 12 px tall", () => {
    expect(RULER).toEqual({ minorPx: 8, majorPx: 56, heightPx: 12 });
    const block = /\.ruler\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain(`height: ${RULER.heightPx}px;`);
    expect(block).toContain(`repeating-linear-gradient(to right, var(--color-tick) 0 1px, transparent 1px ${RULER.majorPx}px)`);
    expect(block).toContain(`repeating-linear-gradient(to right, var(--color-tick) 0 1px, transparent 1px ${RULER.minorPx}px)`);
    expect(block).toContain(`background-size: 100% ${RULER.heightPx}px, 100% ${RULER.heightPx / 2}px;`);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-meter-ruler.test.tsx
```

Expected: the file fails to load with `Failed to resolve import "@/components/instrument/Meter"`.

- [ ] **Step 3: Write the parts and their CSS**

Create `web/components/instrument/Meter.tsx`:

```tsx
import { formatLimit, type LimitUnit } from "@/content/format";
import { SMALL_TEXT, type Surface } from "./types";

/**
 * How full a meter is, 0 to 100. The limit must be a positive finite number and the value a finite number of 0 or
 * more; a value past the limit pins the bar at 100 (the written number still says how far past).
 */
export function meterPercent(value: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error(`a meter needs a positive, finite limit: ${limit}`);
  if (!Number.isFinite(value) || value < 0) throw new Error(`a meter reads a finite value of 0 or more: ${value}`);
  return Math.min(100, (value / limit) * 100);
}

/** What a meter writes beside its bar: the reading rounded to a whole unit, then the limit, in the limit wording. */
export function meterText(value: number, limit: number, unit: LimitUnit): string {
  return `${formatLimit(Math.round(value), unit)} / ${formatLimit(limit, unit)}`;
}

export interface MeterProps {
  /** The reading, in `unit`. */
  value: number;
  /** The full scale, read from FACTS.mandate.value by the caller (spec 2026-11-23 section 3.9), never a literal. */
  limit: number;
  unit: LimitUnit;
  on?: Surface;
  className?: string;
}

/**
 * A hairline bar scaled to `limit`, with the number written beside it (spec section 4: meters mean magnitude, and the
 * number is always written). The bar is aria-hidden; the written number is the reading. data-over marks a reading past
 * its limit, and turns the fill to the refusal lamp colour.
 */
export function Meter({ value, limit, unit, on = "faceplate", className }: MeterProps) {
  const percent = meterPercent(value, limit);
  const text = meterText(value, limit, unit);
  const classes = ["meter inline-flex flex-col gap-1", className].filter(Boolean).join(" ");
  return (
    <span data-meter="" data-on={on} data-over={value > limit ? "" : undefined} className={classes}>
      <span aria-hidden="true" className="meter-track">
        <span className="meter-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className={`font-mono text-[11px] tabular-nums ${SMALL_TEXT[on]}`}>{text}</span>
    </span>
  );
}
```

Create `web/components/instrument/Ruler.tsx`:

```tsx
/** The tick ruler's geometry (spec 2026-11-23 section 5.1); `.ruler` in app/globals.css draws it with these numbers. */
export const RULER = { minorPx: 8, majorPx: 56, heightPx: 12 } as const;

/** A decorative tick ruler: a minor tick every 8 px, a major one every 56 px. aria-hidden, and it holds no text. */
export function Ruler({ className }: { className?: string }) {
  return <div aria-hidden="true" data-ruler="" className={className ? `ruler ${className}` : "ruler"} />;
}
```

In `web/app/globals.css`, insert this block immediately before `@media (prefers-reduced-motion: reduce) {`, with a blank line after it, the same way as in Task 7. Keep the `background-image` declaration on one line: the test reads it as one string.

```css
/* Meter and Ruler (components/instrument/Meter.tsx, Ruler.tsx). A meter's fill width comes inline from its reading;
   the ruler's numbers are RULER's: a major tick every 56 px at full height, a minor one every 8 px at half. */
@layer components {
  .meter-track {
    display: block;
    height: 2px;
    background: var(--color-line);
  }
  .meter[data-on="chassis"] .meter-track {
    background: var(--color-chassis-line);
  }
  .meter-fill {
    display: block;
    height: 100%;
    background: var(--color-lamp-pass);
  }
  .meter[data-over] .meter-fill {
    background: var(--color-lamp-refuse);
  }
  .ruler {
    height: 12px;
    background-image: repeating-linear-gradient(to right, var(--color-tick) 0 1px, transparent 1px 56px), repeating-linear-gradient(to right, var(--color-tick) 0 1px, transparent 1px 8px);
    background-size: 100% 12px, 100% 6px;
    background-position: left bottom;
    background-repeat: no-repeat;
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-meter-ruler.test.tsx test/instrument-contrast.test.ts test/format-limit.test.ts
```

Expected: every test passes, and `instrument-meter-ruler.test.tsx` counts `16 passed`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-10.txt`:

```
feat(web): add the Meter and Ruler instrument parts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/components/instrument/Meter.tsx web/components/instrument/Ruler.tsx web/app/globals.css web/test/instrument-meter-ruler.test.tsx
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-10.txt"
```

---

### Task 11: Balance

**Files:**
- Create: `web/components/instrument/Balance.tsx`
- Modify: `web/app/globals.css`. Add one block immediately before `@media (prefers-reduced-motion: reduce) {`.
- Test: `web/test/instrument-balance.test.tsx`

**Interfaces:**
- Consumes:
  - `MARK` and `PALETTE` from `web/brand/mark.ts`, read only. `MARK.beam` is `"M15 7v15M11 22h8M7 10h16"`, `MARK.beamWidth` is `1.8`, `MARK.feather` is `"M9 11.5c-2 2.6-2 5.4 0 7.5 2-2.1 2-4.9 0-7.5z"`, and `MARK.order` is `{ x: 19, y: 12.5, size: 5, radius: 1 }`.
  - `type CheckMark = "PASS" | "FAIL" | "SKIP"` and `MOMENTS` from `web/content/engine.ts`.
  - `FACTS.checksPerTrade.value` (9).
  - `Verdict` from Task 9.
  - `--t-weigh` and `--ease-needle` from Tasks 1 and 2, and the `--color-tick`, `--color-lamp-pass` and `--color-lamp-refuse` tokens.
- Produces:
  - `BALANCE`, which is `{ post: "M15 7v15M11 22h8", bar: "M7 10h16", pivot: { x: 15, y: 10 }, ends: { feather: { x: 7, y: 10 }, order: { x: 23, y: 10 } }, refusedDeg: -6, hangerWidth: 0.6, tickWidth: 0.5 }`;
  - `tickPath(i: number): string`;
  - `interface BalanceProps { verdict: Verdict; checks: readonly CheckMark[]; size?: number; className?: string }`;
  - `Balance(props: BalanceProps)`.
  - In CSS: `.balance`, `.balance-beam`, `.balance-pan` and `.balance-tick`.

**The geometry.**
- The post and base are `M15 7v15M11 22h8`, and the crossbar is `M7 10h16`. Their concatenation is `MARK.beam`.
- The pivot is the top of the post at (15, 10), and the crossbar's ends are 8 units either side, at (7, 10) and (23, 10).
- The feather pan hangs from (7, 10). Its hanger runs to the feather's top at y 11.5. `MARK.feather` starts at x 9, so it is translated by `-2` to centre under the end.
- The order pan hangs from (23, 10). Its hanger runs to y 12.5, and the 5-unit box is centred under the end at x 20.5.
- The nine ticks sit at x = 7, 9, … 23 on the bar.

**The tilt.** It is pure CSS, keyed off `data-verdict`. `--tilt` is 0deg for allowed and -6deg for refused.
- The beam rotates `var(--tilt)` about (15px, 10px) in view-box units.
- Each pan translates with its end of the beam and does not rotate. For an end at offset `-8` (feather), a turn by θ moves it by `(8(1 - cos θ), -8 sin θ)`. At θ = -6deg the feather end drops 0.836 and moves inward 0.044, and the order end mirrors it.
- The base style is the final frame. The static HTML, and reduced motion through the global reduce block, show the true angle at once.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-balance.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MARK, PALETTE } from "@/brand/mark";
import { BALANCE, Balance, tickPath } from "@/components/instrument/Balance";
import type { Verdict } from "@/components/instrument/types";
import { type CheckMark, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

const SAT = MOMENTS.sat.checks.map((c) => c.mark);
const THU = MOMENTS.thu.checks.map((c) => c.mark);

function setup(verdict: Verdict, checks: readonly CheckMark[] = SAT) {
  const { container } = render(<Balance verdict={verdict} checks={checks} />);
  const svg = container.querySelector("svg") as SVGSVGElement;
  return { container, svg };
}

describe("Balance geometry (components/instrument/Balance.tsx)", () => {
  it("splits MARK.beam into the fixed post and base and the tilting crossbar, and nothing else", () => {
    expect(BALANCE.post).toBe("M15 7v15M11 22h8");
    expect(BALANCE.bar).toBe("M7 10h16");
    expect(`${BALANCE.post}${BALANCE.bar}`).toBe(MARK.beam);
  });

  it("pivots on the top of the post and hangs the pans from the crossbar's ends, 8 units either side", () => {
    expect(BALANCE.pivot).toEqual({ x: 15, y: 10 });
    expect(BALANCE.ends).toEqual({ feather: { x: 7, y: 10 }, order: { x: 23, y: 10 } });
    expect(BALANCE.pivot.x - BALANCE.ends.feather.x).toBe(8);
    expect(BALANCE.ends.order.x - BALANCE.pivot.x).toBe(8);
    expect(BALANCE.refusedDeg).toBe(-6);
  });

  it("puts one tick per check along the crossbar, from end to end", () => {
    const ticks = Array.from({ length: FACTS.checksPerTrade.value }, (_, i) => tickPath(i));
    expect(ticks).toEqual([7, 9, 11, 13, 15, 17, 19, 21, 23].map((x) => `M${x} 9.4v1.2`));
  });
});

describe("Balance (components/instrument/Balance.tsx)", () => {
  it("is one aria-hidden, unfocusable svg on MARK's 30-unit grid, 120 px by default", () => {
    const { container, svg } = setup("refused");
    expect(container.children).toHaveLength(1);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", "0 0 30 30");
    expect(svg).toHaveAttribute("width", "120");
    expect(svg).toHaveAttribute("height", "120");
    expect(svg.getAttribute("class")).toBe("balance");
    expect(container.textContent).toBe("");
  });

  it.each<Verdict>(["allowed", "refused"])("carries data-verdict=%s for the CSS tilt", (verdict) => {
    expect(setup(verdict).svg).toHaveAttribute("data-verdict", verdict);
  });

  it("draws the post, the feather pan, the order pan, then the beam, in that order", () => {
    const { svg } = setup("refused");
    const layers = [...svg.children];
    expect(layers.map((el) => el.getAttribute("class") ?? el.tagName.toLowerCase())).toEqual([
      "path",
      "balance-pan",
      "balance-pan",
      "balance-beam",
    ]);
    const post = layers[0]!;
    expect(post.getAttribute("d")).toBe(BALANCE.post);
    expect(post.getAttribute("stroke")).toBe(PALETTE.ink);
    expect(post.getAttribute("stroke-width")).toBe(String(MARK.beamWidth));
    expect(post.getAttribute("stroke-linecap")).toBe("round");
  });

  it("hangs MARK.feather from the feather end, centred under it, in the feather colour", () => {
    const pan = setup("allowed").svg.querySelector('[data-pan="feather"]') as SVGGElement;
    const [hanger, feather] = [...pan.children];
    expect(hanger?.getAttribute("d")).toBe("M7 10V11.5");
    expect(hanger?.getAttribute("stroke-width")).toBe(String(MARK.beamWidth / 3));
    expect(feather?.getAttribute("d")).toBe(MARK.feather);
    expect(feather?.getAttribute("transform")).toBe("translate(-2 0)");
    expect(feather?.getAttribute("fill")).toBe(PALETTE.feather);
  });

  it("hangs MARK.order from the order end, centred under it, in ink", () => {
    const pan = setup("allowed").svg.querySelector('[data-pan="order"]') as SVGGElement;
    const [hanger, box] = [...pan.children];
    expect(hanger?.getAttribute("d")).toBe("M23 10V12.5");
    expect(box?.tagName.toLowerCase()).toBe("rect");
    expect([box?.getAttribute("x"), box?.getAttribute("y"), box?.getAttribute("width"), box?.getAttribute("height")]).toEqual([
      "20.5",
      String(MARK.order.y),
      String(MARK.order.size),
      String(MARK.order.size),
    ]);
    expect(box?.getAttribute("rx")).toBe(String(MARK.order.radius));
    expect(box?.getAttribute("fill")).toBe(PALETTE.ink);
  });

  it("puts the crossbar and its nine ticks in the beam, each tick marked with its check, and no list items", () => {
    const { svg } = setup("refused", THU);
    const beam = svg.querySelector(".balance-beam") as SVGGElement;
    expect(beam.firstElementChild?.getAttribute("d")).toBe(BALANCE.bar);
    const ticks = [...beam.querySelectorAll(".balance-tick")];
    expect(ticks).toHaveLength(FACTS.checksPerTrade.value);
    expect(ticks.map((t) => t.getAttribute("data-tick"))).toEqual(THU);
    expect(ticks.map((t) => t.getAttribute("d"))).toEqual(THU.map((_, i) => tickPath(i)));
    expect(svg.querySelector("li")).toBeNull();
  });

  it("refuses a list of marks that is not one per check", () => {
    expect(() => render(<Balance verdict="allowed" checks={SAT.slice(1)} />)).toThrow(/one mark per check: 9, got 8/);
    expect(() => render(<Balance verdict="allowed" checks={[...SAT, "SKIP"]} />)).toThrow(/one mark per check/);
  });

  it("takes a size and a class", () => {
    const { container } = render(<Balance verdict="allowed" checks={SAT} size={96} className="shrink-0" />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("width", "96");
    expect(svg.getAttribute("class")).toBe("balance shrink-0");
  });
});

describe("Balance tilt (app/globals.css)", () => {
  /** The declarations of one rule, by its exact selector. */
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule ${selector}`);
    return m[1]!.replace(/\s+/g, " ").trim();
  };

  it("is level in the base style and -6deg only when refused: the base style is the final frame", () => {
    expect(rule(".balance")).toBe("--tilt: 0deg;");
    expect(rule('.balance[data-verdict="refused"]')).toBe(`--tilt: ${BALANCE.refusedDeg}deg;`);
  });

  it("turns only the beam, about the pivot, over --t-weigh on the needle curve", () => {
    expect(rule(".balance-beam")).toBe(
      `transform-box: view-box; transform-origin: ${BALANCE.pivot.x}px ${BALANCE.pivot.y}px; rotate: var(--tilt); transition: rotate var(--t-weigh) var(--ease-needle);`,
    );
  });

  it("moves each pan with its end of the beam, 8 units out, without turning it", () => {
    expect(rule(".balance-pan")).toBe("transition: translate var(--t-weigh) var(--ease-needle);");
    expect(rule('.balance-pan[data-pan="feather"]')).toBe(
      "translate: calc(8px * (1 - cos(var(--tilt)))) calc(-8px * sin(var(--tilt)));",
    );
    expect(rule('.balance-pan[data-pan="order"]')).toBe(
      "translate: calc(-8px * (1 - cos(var(--tilt)))) calc(8px * sin(var(--tilt)));",
    );
    expect(css).not.toMatch(/\.balance-pan[^{]*\{[^}]*\brotate\s*:/);
  });

  it("keeps each pan on its end of the beam at -6deg: the translation is the end's own movement", () => {
    const t = (BALANCE.refusedDeg * Math.PI) / 180;
    const r = BALANCE.pivot.x - BALANCE.ends.feather.x;
    // The feather end at -6deg, turned about the pivot (y grows downwards, so a negative angle lifts the right end).
    const featherEnd = { x: BALANCE.pivot.x - r * Math.cos(t), y: BALANCE.pivot.y - r * Math.sin(t) };
    expect(featherEnd.x - BALANCE.ends.feather.x).toBeCloseTo(r * (1 - Math.cos(t)), 12);
    expect(featherEnd.y - BALANCE.ends.feather.y).toBeCloseTo(-r * Math.sin(t), 12);
    expect(featherEnd.y).toBeGreaterThan(BALANCE.ends.feather.y);
  });

  it("colours the ticks by their check", () => {
    expect(rule(".balance-tick")).toBe("stroke: var(--color-tick); stroke-linecap: butt;");
    expect(rule('.balance-tick[data-tick="PASS"]')).toBe("stroke: var(--color-lamp-pass);");
    expect(rule('.balance-tick[data-tick="FAIL"]')).toBe("stroke: var(--color-lamp-refuse);");
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-balance.test.tsx
```

Expected: the file fails to load with `Failed to resolve import "@/components/instrument/Balance"`.

- [ ] **Step 3: Write the part and its CSS**

Create `web/components/instrument/Balance.tsx`:

```tsx
import { MARK, PALETTE } from "@/brand/mark";
import type { CheckMark } from "@/content/engine";
import { FACTS } from "@/content/facts";
import type { Verdict } from "./types";

/** Where MARK.feather starts: its first point, "M9 11.5", the top of the feather. */
const FEATHER_TOP = { x: 9, y: 11.5 } as const;

/**
 * The Balance's geometry on MARK's 30-unit grid (spec 2026-11-23 section 5.1). MARK.beam splits into the fixed post and
 * base and the crossbar that tilts about the top of the post; the pans hang from the crossbar's ends.
 */
export const BALANCE = {
  post: "M15 7v15M11 22h8",
  bar: "M7 10h16",
  pivot: { x: 15, y: 10 },
  ends: { feather: { x: 7, y: 10 }, order: { x: 23, y: 10 } },
  /** The beam's angle for a refusal; an allowed trade leaves it level. Only the beam tilts (spec section 4). */
  refusedDeg: -6,
  hangerWidth: MARK.beamWidth / 3,
  tickWidth: 0.5,
} as const;

/** The nine ticks along the crossbar, one per check in order, from the feather end to the order end. */
export function tickPath(i: number): string {
  const step = (BALANCE.ends.order.x - BALANCE.ends.feather.x) / (FACTS.checksPerTrade.value - 1);
  return `M${BALANCE.ends.feather.x + step * i} 9.4v1.2`;
}

export interface BalanceProps {
  verdict: Verdict;
  /** One mark per check, in check order: PASS, FAIL or SKIP. There are always FACTS.checksPerTrade of them. */
  checks: readonly CheckMark[];
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
}

/**
 * The scale the hero weighs a trade on: MARK's post, crossbar, feather and order, with MARK's stroke and colours.
 * data-verdict keys the tilt in app/globals.css (.balance): level for allowed, -6deg for refused, and the base style is
 * that final frame, so the static HTML and reduced motion show the truth. aria-hidden: the verdict is in words elsewhere,
 * and the ticks are paths, not list items.
 */
export function Balance({ verdict, checks, size = 120, className }: BalanceProps) {
  if (checks.length !== FACTS.checksPerTrade.value) {
    throw new Error(`the Balance needs one mark per check: ${FACTS.checksPerTrade.value}, got ${checks.length}`);
  }
  const { feather, order } = BALANCE.ends;
  const box = MARK.order;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK.size} ${MARK.size}`}
      aria-hidden="true"
      focusable="false"
      data-verdict={verdict}
      className={className ? `balance ${className}` : "balance"}
    >
      <path d={BALANCE.post} fill="none" stroke={PALETTE.ink} strokeWidth={MARK.beamWidth} strokeLinecap="round" />
      <g className="balance-pan" data-pan="feather">
        <path
          d={`M${feather.x} ${feather.y}V${FEATHER_TOP.y}`}
          stroke={PALETTE.ink}
          strokeWidth={BALANCE.hangerWidth}
          strokeLinecap="round"
        />
        <path d={MARK.feather} transform={`translate(${feather.x - FEATHER_TOP.x} 0)`} fill={PALETTE.feather} />
      </g>
      <g className="balance-pan" data-pan="order">
        <path d={`M${order.x} ${order.y}V${box.y}`} stroke={PALETTE.ink} strokeWidth={BALANCE.hangerWidth} strokeLinecap="round" />
        <rect x={order.x - box.size / 2} y={box.y} width={box.size} height={box.size} rx={box.radius} fill={PALETTE.ink} />
      </g>
      <g className="balance-beam">
        <path d={BALANCE.bar} fill="none" stroke={PALETTE.ink} strokeWidth={MARK.beamWidth} strokeLinecap="round" />
        {checks.map((mark, i) => (
          <path key={i} className="balance-tick" data-tick={mark} d={tickPath(i)} strokeWidth={BALANCE.tickWidth} />
        ))}
      </g>
    </svg>
  );
}
```

In `web/app/globals.css`, insert this block immediately before `@media (prefers-reduced-motion: reduce) {`, with a blank line after it, the same way as in Task 7:

```css
/* Balance (components/instrument/Balance.tsx). Only the beam tilts: level is allowed, -6deg is refused. Each pan rides
   its end of the crossbar, 8 units from the pivot, and stays upright. The base style is the final frame. */
@layer components {
  .balance {
    --tilt: 0deg;
  }
  .balance[data-verdict="refused"] {
    --tilt: -6deg;
  }
  .balance-beam {
    transform-box: view-box;
    transform-origin: 15px 10px;
    rotate: var(--tilt);
    transition: rotate var(--t-weigh) var(--ease-needle);
  }
  .balance-pan {
    transition: translate var(--t-weigh) var(--ease-needle);
  }
  .balance-pan[data-pan="feather"] {
    translate: calc(8px * (1 - cos(var(--tilt)))) calc(-8px * sin(var(--tilt)));
  }
  .balance-pan[data-pan="order"] {
    translate: calc(-8px * (1 - cos(var(--tilt)))) calc(8px * sin(var(--tilt)));
  }
  .balance-tick {
    stroke: var(--color-tick);
    stroke-linecap: butt;
  }
  .balance-tick[data-tick="PASS"] {
    stroke: var(--color-lamp-pass);
  }
  .balance-tick[data-tick="FAIL"] {
    stroke: var(--color-lamp-refuse);
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-balance.test.tsx test/brand.test.ts test/instrument-contrast.test.ts
```

Expected: every test passes, and `instrument-balance.test.tsx` counts `17 passed`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-11.txt`:

```
feat(web): add the Balance, whose beam tilts by data-verdict in CSS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/components/instrument/Balance.tsx web/app/globals.css web/test/instrument-balance.test.tsx
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-11.txt"
```

---

### Task 12: Tape

**Files:**
- Create: `web/components/instrument/Tape.tsx`
- Modify: `web/app/globals.css`. Add one block immediately before `@media (prefers-reduced-motion: reduce) {`.
- Test: `web/test/instrument-tape.test.tsx`

**Interfaces:**
- Consumes: `Verdict` from Task 9, plus `--ease-instrument`, `--color-lamp-pass` and `--color-lamp-refuse`.
- Produces:
  - `interface TapeProps { label?: string; children: ReactNode; className?: string }`;
  - `Tape(props: TapeProps)`, which renders `<ol data-tape class="tape">`;
  - `interface TapeRowProps { verdict: Verdict; fresh?: boolean; children: ReactNode; className?: string }`;
  - `TapeRow(props: TapeRowProps)`, which renders `<li data-tape-row data-verdict data-fresh?>`;
  - in CSS, `.tape`, `.tape-row` and the `print` keyframes.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-tape.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tape, TapeRow } from "@/components/instrument/Tape";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

describe("Tape (components/instrument/Tape.tsx)", () => {
  it("is an ordered list of rows, never a table", () => {
    const { container } = render(
      <Tape label="Vault decisions" className="mt-4">
        <TapeRow verdict="allowed">BUY NVDAc · allowed</TapeRow>
        <TapeRow verdict="refused">BUY NVDAc · refused · MARKET_CLOSED</TapeRow>
      </Tape>,
    );
    const tape = container.firstElementChild as HTMLElement;
    expect(tape.tagName).toBe("OL");
    expect(tape).toHaveAttribute("data-tape", "");
    expect(tape).toHaveAttribute("aria-label", "Vault decisions");
    expect(tape.className).toBe("tape mt-4");
    expect(container.querySelector("table")).toBeNull();
    const rows = [...tape.children] as HTMLElement[];
    expect(rows.map((r) => r.tagName)).toEqual(["LI", "LI"]);
    expect(rows.map((r) => r.getAttribute("data-verdict"))).toEqual(["allowed", "refused"]);
    expect(rows.map((r) => r.textContent)).toEqual(["BUY NVDAc · allowed", "BUY NVDAc · refused · MARKET_CLOSED"]);
  });

  it("has no accessible name unless given one", () => {
    const { container } = render(
      <Tape>
        <TapeRow verdict="allowed">row</TapeRow>
      </Tape>,
    );
    expect(container.firstElementChild).not.toHaveAttribute("aria-label");
  });

  it("marks only a fresh row to print in; a row from the static HTML is at its final frame", () => {
    const { container } = render(
      <Tape>
        <TapeRow verdict="allowed">old</TapeRow>
        <TapeRow verdict="refused" fresh className="py-2">
          new
        </TapeRow>
      </Tape>,
    );
    const [old, fresh] = [...container.querySelectorAll("li")];
    expect(old).not.toHaveAttribute("data-fresh");
    expect(old?.className).toBe("tape-row");
    expect(fresh).toHaveAttribute("data-fresh", "");
    expect(fresh?.className).toBe("tape-row py-2");
  });

  it("prints a fresh row in once over 260 ms with clip-path, from nothing to the whole row", () => {
    expect(css).toMatch(/\.tape-row\[data-fresh\]\s*\{\s*animation:\s*print 260ms var\(--ease-instrument\) both;\s*\}/);
    expect(css).toMatch(
      /@keyframes print\s*\{\s*from\s*\{\s*clip-path:\s*inset\(0 0 100% 0\);\s*\}\s*to\s*\{\s*clip-path:\s*inset\(0\);\s*\}\s*\}/,
    );
    expect(css).toMatch(/\.tape\s*\{\s*margin:\s*0;\s*padding:\s*0;\s*list-style:\s*none;\s*\}/);
    expect(css).toMatch(/\.tape-row\[data-verdict="refused"\]\s*\{\s*border-left-color:\s*var\(--color-lamp-refuse\);\s*\}/);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-tape.test.tsx
```

Expected: the file fails to load with `Failed to resolve import "@/components/instrument/Tape"`.

- [ ] **Step 3: Write the part and its CSS**

Create `web/components/instrument/Tape.tsx`:

```tsx
import type { ReactNode } from "react";
import type { Verdict } from "./types";

export interface TapeProps {
  /** The list's accessible name, for example "Vault decisions". */
  label?: string;
  children: ReactNode;
  className?: string;
}

/** Printed verdict rows (spec 2026-11-23 section 5.1): an ordered list, never a table (the landing keeps one table). */
export function Tape({ label, children, className }: TapeProps) {
  return (
    <ol data-tape="" aria-label={label} className={className ? `tape ${className}` : "tape"}>
      {children}
    </ol>
  );
}

export interface TapeRowProps {
  verdict: Verdict;
  /**
   * A row that landed while the page is open: it prints in once (`print`, 260 ms, clip-path). Rows in the static HTML
   * are never fresh, so they render at their final frame.
   */
  fresh?: boolean;
  children: ReactNode;
  className?: string;
}

/** One printed row. Its words carry the verdict; data-verdict only sets the colour of its rule. */
export function TapeRow({ verdict, fresh = false, children, className }: TapeRowProps) {
  return (
    <li
      data-tape-row=""
      data-verdict={verdict}
      data-fresh={fresh ? "" : undefined}
      className={className ? `tape-row ${className}` : "tape-row"}
    >
      {children}
    </li>
  );
}
```

In `web/app/globals.css`, insert this block immediately before `@media (prefers-reduced-motion: reduce) {`, with a blank line after it, the same way as in Task 7:

```css
/* Tape (components/instrument/Tape.tsx): printed rows. Only a row that lands while the page is open prints in. */
@layer components {
  .tape {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tape-row {
    border-left: 2px solid var(--color-lamp-pass);
    padding-left: 10px;
  }
  .tape-row[data-verdict="refused"] {
    border-left-color: var(--color-lamp-refuse);
  }
  .tape-row[data-fresh] {
    animation: print 260ms var(--ease-instrument) both;
  }
}
@keyframes print {
  from {
    clip-path: inset(0 0 100% 0);
  }
  to {
    clip-path: inset(0);
  }
}
```

- [ ] **Step 4: Run it and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-tape.test.tsx test/tokens.test.ts
```

Expected: every test passes, and `instrument-tape.test.tsx` counts `4 passed`.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-12.txt`:

```
feat(web): add the Tape of printed verdict rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/components/instrument/Tape.tsx web/app/globals.css web/test/instrument-tape.test.tsx
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-12.txt"
```

---

### Task 13: Fig, Live and the instrument module rules

**Files:**
- Create: `web/components/instrument/Fig.tsx`, `web/components/instrument/Live.tsx`
- Test: `web/test/instrument-fig-live.test.tsx`, `web/test/instrument-modules.test.ts`

**Interfaces:**
- Consumes:
  - `FACTS` from `web/content/facts.ts`, where every entry is `{ value, source }`;
  - `type LiveSnapshot` from `web/lib/live/snapshot.ts` (type only), with `block: bigint`, `timestamp: number` and `endpoint: string`;
  - in the tests, `formatLimit` and `formatBlock` from `web/lib/live/format.ts`.
- Produces from `Fig.tsx`:
  - `type FactKey`, which is any FACTS entry name, or `<entry>.<field>` for a scalar field of an entry whose value is a plain object, for example `"timelockHours"` or `"mandate.maxPremiumBps"`;
  - `interface ResolvedFact { value: unknown; source: string }`;
  - `resolveFact(key: string): ResolvedFact`;
  - `factAttr(keys: FactKey | readonly FactKey[]): string`;
  - `type FigTag`;
  - `interface FigProps { k: FactKey | readonly FactKey[]; as?: FigTag; children: string | number; className?: string }`;
  - `Fig(props: FigProps)`.
- Produces from `Live.tsx`:
  - `type LiveSource = Pick<LiveSnapshot, "block" | "timestamp" | "endpoint">`;
  - `interface LiveAttrs`;
  - `liveAttrs(snapshot: LiveSource): LiveAttrs`;
  - `type LiveTag`;
  - `interface LiveProps { snapshot: LiveSource; as?: LiveTag; children: string; className?: string }`;
  - `Live(props: LiveProps)`.
- Produces the module rules (`instrument-modules.test.ts`), which every later part in `components/instrument` and `lib/motion` must keep:
  - a module that calls a hook is a client module;
  - no client module and no motion helper imports `content/gap-index`, `content/scope` or `lib/gap/schema`;
  - imports come only from `react`, `@/`, `./` or `node:`;
  - there is no `animation-timeline`.

  The tests check the 17 P0 files by name. They allow new files, so P1 and later phases can add parts without editing them.

**How Fig follows spec 10.2.**
- `k` is `<entry>` or `<entry>.<field>`.
- `resolveFact("mandate.maxPremiumBps")` reads `FACTS.mandate.value.maxPremiumBps`, with its source taken from `FACTS.mandate.source`.
- `data-fact` goes on the element that already holds the whole string, and Fig inserts no element inside it.
- Several keys go into one space-separated attribute.

The SOURCES key and its captions are P2b work. They mount on the client from `resolveFact`, so P0 renders no caption.

- [ ] **Step 1: Write the failing tests**

Create `web/test/instrument-fig-live.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type FactKey, Fig, factAttr, resolveFact } from "@/components/instrument/Fig";
import { Live, liveAttrs } from "@/components/instrument/Live";
import { FACTS } from "@/content/facts";
import { formatLimit } from "@/content/format";
import { formatBlock } from "@/lib/live/format";

const SNAPSHOT = { block: 60_013_066n, timestamp: 1_795_000_000, endpoint: "https://base-rpc.publicnode.com" };

describe("resolveFact (components/instrument/Fig.tsx)", () => {
  it("reads an entry with its source", () => {
    expect(resolveFact("timelockHours")).toEqual({ value: 24, source: FACTS.timelockHours.source });
    expect(resolveFact("checksPerTrade")).toEqual({ value: 9, source: FACTS.checksPerTrade.source });
  });

  it("reads a field with the source of its entry, as spec section 10.2 gives it", () => {
    expect(resolveFact("mandate.maxPremiumBps")).toEqual({
      value: FACTS.mandate.value.maxPremiumBps,
      source: FACTS.mandate.source,
    });
    expect(resolveFact("gas.refusalLog").value).toBe(111_116);
    expect(resolveFact("premiumsBps.NVDAc").value).toBe(53);
  });

  it("refuses a key FACTS does not have", () => {
    for (const bad of ["", "nope", "mandate.nope", "timelockHours.x", "basket.0", "calendar.holidays", "toString", "mandate.constructor"]) {
      expect(() => resolveFact(bad), bad).toThrow(/no fact|no field|not one number/);
    }
  });
});

describe("factAttr (components/instrument/Fig.tsx)", () => {
  it("is one key, or several space-separated", () => {
    expect(factAttr("timelockHours")).toBe("timelockHours");
    expect(factAttr(["mandate.maxPremiumBps", "mandate.maxSlippageBps"])).toBe("mandate.maxPremiumBps mandate.maxSlippageBps");
  });

  it("refuses no key, a repeated key, or an unknown key", () => {
    expect(() => factAttr([])).toThrow(/at least one key/);
    expect(() => factAttr(["forkBlock", "forkBlock"])).toThrow(/repeated/);
    expect(() => factAttr(["forkBlock", "nope" as FactKey])).toThrow(/no fact/);
  });
});

describe("Fig (components/instrument/Fig.tsx)", () => {
  it("puts data-fact on the element that holds the whole string, and nothing inside it", () => {
    const { container } = render(
      <Fig k="timelockHours" as="dd">
        {`${FACTS.timelockHours.value}h`}
      </Fig>,
    );
    const dd = container.firstElementChild as HTMLElement;
    expect(dd.tagName).toBe("DD");
    expect(dd).toHaveAttribute("data-fact", "timelockHours");
    expect(dd.textContent).toBe("24h");
    expect(dd.children).toHaveLength(0);
    expect(dd).not.toHaveAttribute("class");
  });

  it("is a span by default, takes a class, and writes several keys into one attribute", () => {
    const m = FACTS.mandate.value;
    const { container } = render(
      <Fig k={["mandate.maxPremiumBps", "mandate.maxSlippageBps"]} className="font-mono">
        {`${formatLimit(m.maxPremiumBps, "bps")} premium · ${formatLimit(m.maxSlippageBps, "bps")} slippage`}
      </Fig>,
    );
    const span = container.firstElementChild as HTMLElement;
    expect(span.tagName).toBe("SPAN");
    expect(span.className).toBe("font-mono");
    expect(span).toHaveAttribute("data-fact", "mandate.maxPremiumBps mandate.maxSlippageBps");
    expect(span.textContent).toBe("100 bps premium · 150 bps slippage");
  });

  it("writes a number child as its text", () => {
    const { container } = render(<Fig k="checksPerTrade">{FACTS.checksPerTrade.value}</Fig>);
    expect(container.textContent).toBe("9");
  });

  it("refuses to render an unknown key", () => {
    expect(() => render(<Fig k={"mandate.nope" as FactKey}>1</Fig>)).toThrow(/no field/);
  });
});

describe("Live (components/instrument/Live.tsx)", () => {
  it("names the block, the RPC host and the block time", () => {
    expect(liveAttrs(SNAPSHOT)).toEqual({
      "data-live": "60013066",
      "data-live-host": "base-rpc.publicnode.com",
      "data-live-time": "1795000000",
    });
    expect(liveAttrs({ ...SNAPSHOT, endpoint: "https://mainnet.base.org/" })["data-live-host"]).toBe("mainnet.base.org");
  });

  it("marks the element that holds the live value, and nothing inside it", () => {
    const { container } = render(
      <Live snapshot={SNAPSHOT} as="strong" className="font-mono">
        {formatBlock(SNAPSHOT.block)}
      </Live>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("STRONG");
    expect(el).toHaveAttribute("data-live", "60013066");
    expect(el).toHaveAttribute("data-live-host", "base-rpc.publicnode.com");
    expect(el).toHaveAttribute("data-live-time", "1795000000");
    expect(el.className).toBe("font-mono");
    expect(el.textContent).toBe("60,013,066");
    expect(el.children).toHaveLength(0);
  });

  it("is a span by default", () => {
    const { container } = render(<Live snapshot={SNAPSHOT}>x</Live>);
    expect(container.firstElementChild?.tagName).toBe("SPAN");
  });
});
```

Create `web/test/instrument-modules.test.ts`:

```ts
// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const sources = (dir: string) =>
  readdirSync(new URL(`../${dir}/`, import.meta.url))
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: `${dir}/${f}`, text: read(`${dir}/${f}`) }));

// Every module of the two folders, so the rules below also hold for the parts later phases add.
const MODULES = [...sources("components/instrument"), ...sources("lib/motion")];
const isClient = (text: string) => text.startsWith('"use client";\n');

// The P0 units of spec 2026-11-23 section 5.1. Digits is the one client module among them.
const P0_SERVER_SAFE = [
  "components/instrument/Balance.tsx",
  "components/instrument/Fig.tsx",
  "components/instrument/Ghost.tsx",
  "components/instrument/Lamp.tsx",
  "components/instrument/Live.tsx",
  "components/instrument/Meter.tsx",
  "components/instrument/Readout.tsx",
  "components/instrument/Ruler.tsx",
  "components/instrument/SourcePlate.tsx",
  "components/instrument/Tape.tsx",
  "components/instrument/types.ts",
  "lib/motion/once-in-view.ts",
  "lib/motion/reduced-motion.ts",
  "lib/motion/roll-digits.ts",
  "lib/motion/spring.ts",
  "lib/motion/springs-css.ts",
];
const P0_CLIENT = ["components/instrument/Digits.tsx"];

describe("instrument modules (spec 2026-11-23 sections 3.11, 3.12 and 5.1)", () => {
  it("has every P0 part and helper", () => {
    const missing = [...P0_SERVER_SAFE, ...P0_CLIENT].filter((file) => !existsSync(new URL(`../${file}`, import.meta.url)));
    expect(missing).toEqual([]);
  });

  it("keeps the P0 parts server-safe, except Digits, which is a client module", () => {
    for (const file of P0_SERVER_SAFE) expect(read(file), file).not.toContain("use client");
    for (const file of P0_CLIENT) expect(isClient(read(file)), file).toBe(true);
  });

  it("makes every module that calls a React hook a client module", () => {
    for (const { file, text } of MODULES) {
      if (/\buse(State|Effect|LayoutEffect|Ref|Context|SyncExternalStore|Reducer|Transition)\s*\(/.test(text)) {
        expect(isClient(text), file).toBe(true);
      }
    }
  });

  it("never imports the edition data, the scope or the gap schema into a client module or a motion helper", () => {
    for (const { file, text } of MODULES) {
      if (!isClient(text) && !file.startsWith("lib/motion/")) continue;
      expect(text, file).not.toMatch(/from "[^"]*(content\/gap-index|content\/scope|lib\/gap\/schema)/);
    }
  });

  it("adds no animation library and no scroll-driven animation", () => {
    for (const { file, text } of MODULES) {
      for (const [, spec] of text.matchAll(/from "([^"]+)"/g)) {
        const local = spec === "react" || spec!.startsWith("@/") || spec!.startsWith("./") || spec!.startsWith("node:");
        expect(local, `${file}: ${spec}`).toBe(true);
      }
    }
    expect(read("app/globals.css")).not.toContain("animation-timeline");
  });
});
```

- [ ] **Step 2: Run them and see them fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-fig-live.test.tsx test/instrument-modules.test.ts
```

Expected:
- `instrument-fig-live.test.tsx` fails to load with `Failed to resolve import "@/components/instrument/Fig"`.
- In `instrument-modules.test.ts`, `has every P0 part and helper` fails and lists `components/instrument/Fig.tsx` and `components/instrument/Live.tsx`.
- `keeps the P0 parts server-safe` fails with `ENOENT` on `Fig.tsx`.
- The other 3 module rules pass.

- [ ] **Step 3: Write the parts**

Create `web/components/instrument/Fig.tsx`:

```tsx
import { FACTS } from "@/content/facts";

type Entries = typeof FACTS;
type EntryName = keyof Entries & string;
type Scalar = string | number | boolean;

/** The fields of a fact whose value is a plain object, and only those that hold one number, string or boolean. */
type FieldName<V> = V extends readonly unknown[]
  ? never
  : V extends object
    ? { [F in keyof V & string]: V[F] extends Scalar ? F : never }[keyof V & string]
    : never;

/**
 * A key into FACTS (spec 2026-11-23 section 10.2): `<entry>`, or `<entry>.<field>` for a field of an entry whose value
 * is a plain object, for example "timelockHours" or "mandate.maxPremiumBps".
 */
export type FactKey = { [E in EntryName]: E | `${E}.${FieldName<Entries[E]["value"]>}` }[EntryName];

export interface ResolvedFact {
  value: unknown;
  /** The entry's source: a field shares the source of its entry. */
  source: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What a key names: FACTS[entry].value, or one field of it, with FACTS[entry].source. It takes any string, so the
 * SOURCES key can resolve a data-fact read back from the page; it throws on a key FACTS does not have.
 */
export function resolveFact(key: string): ResolvedFact {
  const dot = key.indexOf(".");
  const entry = dot === -1 ? key : key.slice(0, dot);
  if (!Object.hasOwn(FACTS, entry)) throw new Error(`no fact ${JSON.stringify(entry)} in content/facts.ts`);
  const fact = FACTS[entry as EntryName];
  if (dot === -1) return { value: fact.value, source: fact.source };
  const field = key.slice(dot + 1);
  const value: unknown = fact.value;
  if (!isPlainObject(value) || !Object.hasOwn(value, field)) {
    throw new Error(`no field ${JSON.stringify(field)} in FACTS.${entry}`);
  }
  const fieldValue = value[field];
  if (typeof fieldValue === "object" || fieldValue === undefined) {
    throw new Error(`FACTS.${entry}.${field} is not one number, string or boolean`);
  }
  return { value: fieldValue, source: fact.source };
}

/** The data-fact value for one or more keys: space-separated, each one known and none repeated. */
export function factAttr(keys: FactKey | readonly FactKey[]): string {
  const list: readonly string[] = typeof keys === "string" ? [keys] : keys;
  if (list.length === 0) throw new Error("data-fact needs at least one key");
  if (new Set(list).size !== list.length) throw new Error(`a fact key is repeated: ${list.join(" ")}`);
  for (const k of list) resolveFact(k);
  return list.join(" ");
}

/** The elements a figure may already sit in. */
export type FigTag = "span" | "strong" | "b" | "dd" | "dt" | "td" | "p" | "div" | "li";

export interface FigProps {
  /** The fact, or the facts, the whole string comes from. */
  k: FactKey | readonly FactKey[];
  /** The element that holds the whole string; Fig adds no element of its own inside it. */
  as?: FigTag;
  /** The whole string, written from FACTS by the caller, for example "24h" or "100 bps". */
  children: string | number;
  className?: string;
}

/**
 * Marks the element that already holds a whole string with data-fact (spec section 10.2), and adds nothing inside it,
 * so a test that matches the string still matches. The SOURCES captions come later, on the client, from resolveFact.
 */
export function Fig({ k, as: Tag = "span", children, className }: FigProps) {
  return (
    <Tag data-fact={factAttr(k)} className={className}>
      {children}
    </Tag>
  );
}
```

Create `web/components/instrument/Live.tsx`:

```tsx
import type { LiveSnapshot } from "@/lib/live/snapshot";

/** The part of a snapshot a live mark names: the block, the RPC host that answered, and the block's time. */
export type LiveSource = Pick<LiveSnapshot, "block" | "timestamp" | "endpoint">;

export interface LiveAttrs {
  "data-live": string;
  "data-live-host": string;
  "data-live-time": string;
}

/** The attributes that mark a value read from the chain: block number, RPC host, block timestamp in seconds. */
export function liveAttrs(snapshot: LiveSource): LiveAttrs {
  return {
    "data-live": snapshot.block.toString(),
    "data-live-host": new URL(snapshot.endpoint).host,
    "data-live-time": String(snapshot.timestamp),
  };
}

/** The elements a live value may sit in. */
export type LiveTag = "span" | "strong" | "dd" | "td" | "p";

export interface LiveProps {
  snapshot: LiveSource;
  as?: LiveTag;
  /** The value as written, for example formatBlock(snapshot.block). */
  children: string;
  className?: string;
}

/**
 * Marks a value read from the chain (spec 2026-11-23 sections 5.1 and 10.2), on the element that holds it. Only client
 * code has a snapshot, so a live mark is never in the static HTML.
 */
export function Live({ snapshot, as: Tag = "span", children, className }: LiveProps) {
  return (
    <Tag {...liveAttrs(snapshot)} className={className}>
      {children}
    </Tag>
  );
}
```

- [ ] **Step 4: Run them and see them pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-fig-live.test.tsx test/instrument-modules.test.ts test/instrument-contrast.test.ts
```

Expected: every test passes. `instrument-fig-live.test.tsx` and `instrument-modules.test.ts` count `17 passed` together.

- [ ] **Step 5: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test
```

Expected: the typecheck exits 0 and every vitest file passes. If `test/simulator.test.tsx` times out only under the full run, run it alone with `npm test -- test/simulator.test.tsx`. In planning, it once timed out under load and passed alone. Report it if it fails alone.

- [ ] **Step 6: Commit**

Write `$SCRATCH/p0-commit-13.txt`:

```
feat(web): add Fig and Live, and pin the rules every instrument module keeps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/components/instrument/Fig.tsx web/components/instrument/Live.tsx web/test/instrument-fig-live.test.tsx web/test/instrument-modules.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-13.txt"
```

---

### Task 14: WebKit and Firefox smoke projects

**Files:**
- Modify:
  - `web/playwright.config.ts`, where line 10, `projects: [...]`, becomes six lines;
  - `.github/workflows/ci.yml`, adding two lines after line 146, the `browsers` step's `run:` line.
- Test: `web/test/instrument-browsers.test.ts`, plus the real smoke run on both engines.

**Interfaces:**
- Consumes: `web/e2e/smoke.spec.ts`, unchanged and never edited, and `readRepo` from `web/test/helpers/solidity.ts`.
- Produces:
  - Playwright projects `chromium` (every spec), `webkit` (`devices["Desktop Safari"]`, `testMatch: /smoke\.spec\.ts$/`) and `firefox` (`devices["Desktop Firefox"]`, the same `testMatch`);
  - CI step `- id: cross_browsers` with `run: npx --no-install playwright install --with-deps webkit firefox`.

- [ ] **Step 1: Write the failing test**

Create `web/test/instrument-browsers.test.ts`:

```ts
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRepo } from "./helpers/solidity";

const config = readFileSync(new URL("../playwright.config.ts", import.meta.url), "utf8");
const ci = readRepo(".github/workflows/ci.yml");

describe("cross-browser smoke (spec 2026-11-23 section 11, item 13)", () => {
  it("runs every spec on Chromium, and only smoke.spec.ts on WebKit and Firefox", () => {
    const projects = /\n  projects: \[\n([\s\S]*?)\n  \],\n/.exec(config)?.[1];
    expect(projects?.split("\n").map((line) => line.trim())).toEqual([
      '{ name: "chromium", use: { ...devices["Desktop Chrome"] } },',
      '{ name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: /smoke\\.spec\\.ts$/ },',
      '{ name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /smoke\\.spec\\.ts$/ },',
    ]);
  });

  it("matches smoke.spec.ts and no other spec", () => {
    const match = /smoke\.spec\.ts$/;
    expect(match.test("e2e/smoke.spec.ts")).toBe(true);
    for (const other of ["e2e/live.spec.ts", "e2e/weight.spec.ts", "e2e/smoke.spec.tsx", "e2e/smokespec.ts"]) {
      expect(match.test(other), other).toBe(false);
    }
  });

  it("installs WebKit and Firefox in CI right after Chromium, just before the e2e step", () => {
    const lines = ci.split("\n").map((line) => line.trim());
    const chromium = lines.indexOf("run: npx --no-install playwright install --with-deps --only-shell chromium");
    expect(chromium).toBeGreaterThan(0);
    expect(lines.slice(chromium + 1, chromium + 4)).toEqual([
      "- id: cross_browsers",
      "run: npx --no-install playwright install --with-deps webkit firefox",
      "- id: e2e",
    ]);
    expect(lines.filter((line) => line.startsWith("run: npx --no-install playwright install"))).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-browsers.test.ts
```

Expected: `Tests  2 failed | 1 passed (3)`. The projects case and the CI case fail; the regex case passes.

Before any edit, record how many tests Chromium runs:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npx playwright test --list --project=chromium | tail -1
```

Expected: `Total: <n> tests in <m> files`. Write `<n>` down for Step 6.

- [ ] **Step 3: Add the projects and the CI step**

In `web/playwright.config.ts`, read the file first. Then use Edit with old_string set to:

```ts
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
```

Set new_string to:

```ts
  // Every spec runs on Chromium. WebKit and Firefox run smoke.spec.ts only (spec 2026-11-23 section 11, item 13).
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testMatch: /smoke\.spec\.ts$/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testMatch: /smoke\.spec\.ts$/ },
  ],
```

In `.github/workflows/ci.yml`, read the file first. Then use Edit with old_string set to:

```yaml
      - id: browsers
        run: npx --no-install playwright install --with-deps --only-shell chromium
```

Set new_string to:

```yaml
      - id: browsers
        run: npx --no-install playwright install --with-deps --only-shell chromium
      - id: cross_browsers
        run: npx --no-install playwright install --with-deps webkit firefox
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-browsers.test.ts
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Run smoke on WebKit and Firefox**

This step downloads the two Playwright browser builds once, about 200 MB. It downloads no npm package. On Windows, `--with-deps` is not needed.

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npx --no-install playwright install webkit firefox
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run build
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run e2e -- --project=webkit --project=firefox --workers=2
```

Expected:
- `netstat` prints nothing.
- The run lists `Running 30 tests`, 15 smoke tests per engine, and ends `30 passed`.

If any test fails on either engine, stop here.
- Do not edit `smoke.spec.ts`, do not narrow `testMatch`, and do not commit.
- Report each failing title with its project, and the first error line.
- Report the screenshots under `test-results/e2e`.

Spec 11, item 13 makes this a bar the redesign must clear, so the owner decides.

- [ ] **Step 6: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npx playwright test --list --project=chromium | tail -1
```

Expected: the typecheck exits 0. The list ends `Total: <n> tests in <m> files`, with the same `<n>` as Step 2 recorded: Chromium still runs every spec.

- [ ] **Step 7: Commit**

Write `$SCRATCH/p0-commit-14.txt`:

```
test(web): run smoke.spec.ts on WebKit and Firefox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/playwright.config.ts .github/workflows/ci.yml web/test/instrument-browsers.test.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-14.txt"
```

**Known follow-ups, not done in P0.** Both files are frozen for this plan: docs prose, and `smoke.spec.ts`, which is never edited. Name both follow-ups in the Task 16 report, so they are not lost.
- **The contributor guide installs Chromium only.** After this task, a bare `npm run e2e` also runs `smoke.spec.ts` on WebKit and Firefox. A contributor who follows `web/content/docs/guides/run-the-tests.mdx` installs only Chromium, so both new projects then fail with a browser-not-installed error. On the next docs branch, change its lines 36, 55 and 193 from `npx playwright install chromium` to `npx playwright install chromium webkit firefox`. Or keep Chromium and say there that `npm run e2e -- --project=chromium` runs on Chromium alone.
- **The smoke screenshots overwrite each other.** `smoke.spec.ts:27-28` saves `test-results/screens/landing-${width}.png`, a path with no project in it. With three projects and `--workers=2`, the engine that finishes last overwrites the Chromium screenshot. The tests still pass, but the saved file no longer shows which engine made it. When `smoke.spec.ts` is no longer frozen, change the path to `` `test-results/screens/${test.info().project.name}/landing-${width}.png` ``.

---

### Task 15: The weight spec

**Files:**
- Create: `web/e2e/weight.spec.ts`
- Test: the spec itself, plus an injected-marker drill that proves its leak check fails when it should.

**Interfaces:**
- Consumes:
  - `out/` from `npm run build`;
  - `web/content/gap-index/edition-0.json`, read only. Its windows are `{ tokens?: { freeze: { from: { tx }, to: { tx } } | null, largestGap: { tx } | null, series: { pool: [ts, price][] } }[] }[]`;
  - `routeLiveRpc(page, "weekend")` from `web/e2e/fake-live-rpc.ts`;
  - `collectErrors(page)` from `web/e2e/helpers.ts`;
  - `FONT_BASELINE`, the font number from Task 0 Step 5.
- Produces: four Playwright tests on the `chromium` project:
  - the gzip budgets: total 360,000 B, JS 185,000 B, CSS 18,000 B, and fonts within 1,000 B of `FONT_BASELINE`;
  - the edition-leak check on `/` and `/gap-index`;
  - no third-party script and no console error, on each of `/` and `/gap-index`.

  After PR #15 merges, this check may move into `lib/check-out.ts` (spec 11, item 3). That is not done here.

**What it counts.** This follows spec 11, item 3, as amended by A2:
- Everything is gzip level 9 from `out/`: `out/index.html`, plus every `/_next/` module script, stylesheet and font that the landing's HTML links, each counted once.
- A `noModule` script is left out. It is the legacy polyfill, which no browser that runs the page's module scripts downloads. The unamended spec wording would count it, and the JS budget would then fail on today's main (198,421 B against 185,000 B), so A2 must land with this plan.

Measured on a build of `66bd0d0`:

| Part | Gzipped bytes |
|---|---|
| HTML | 24,123 |
| JS | 158,901 (198,421 with the `noModule` polyfill of 39,520) |
| CSS | 8,090 |
| Fonts | 140,786 |
| Total | 331,900 |

P0 mounts nothing, so JS does not move. CSS grows by about 1.3 KB from the instrument rules and the utilities of `components/instrument`.

- [ ] **Step 1: Write the spec**

Create `web/e2e/weight.spec.ts`. If Task 0 Step 5 printed a number other than 140786, write that number into `FONT_BASELINE`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import edition from "../content/gap-index/edition-0.json" with { type: "json" };
import { routeLiveRpc } from "./fake-live-rpc";
import { collectErrors } from "./helpers";

// Spec 2026-11-23 section 11, item 3. Every byte is counted gzipped (level 9) from the static export in out/, which
// `npm run build` writes before this spec runs. Run alone with: npm run e2e -- e2e/weight.spec.ts --project=chromium
const OUT = fileURLToPath(new URL("../out/", import.meta.url));

/** The budgets, in gzipped bytes. */
const BUDGET = { total: 360_000, js: 185_000, css: 18_000 } as const;
/** The two Geist woff2 files the landing preloads, gzipped, measured at P-1 (main at 66bd0d0 gives 140,786). */
const FONT_BASELINE = 140_786;
const FONT_TOLERANCE = 1_000;

interface Asset {
  path: string;
  kind: "js" | "css" | "font";
  bytes: number;
}

const gz = (buf: Buffer) => gzipSync(buf, { level: 9 }).length;
const file = (rel: string) => readFileSync(`${OUT}${rel.replace(/^\//, "")}`);

/**
 * Every /_next/ script, stylesheet and font a page's HTML links, each once. A `noModule` script is left out: it is the
 * legacy polyfill, and no browser that runs the page's module scripts downloads it.
 */
function linked(html: string): Asset[] {
  const assets = new Map<string, Asset>();
  for (const [tag, path] of html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="(\/_next\/[^"?#]+)[^"]*"[^>]*>/g)) {
    if (/\snoModule\b/i.test(tag)) continue;
    const kind = path!.endsWith(".js") ? "js" : path!.endsWith(".css") ? "css" : path!.endsWith(".woff2") ? "font" : undefined;
    if (kind === undefined || assets.has(path!)) continue;
    assets.set(path!, { path: path!, kind, bytes: gz(file(path!)) });
  }
  return [...assets.values()];
}

const sum = (assets: readonly Asset[], kind: Asset["kind"]) =>
  assets.filter((a) => a.kind === kind).reduce((n, a) => n + a.bytes, 0);

/**
 * Strings only edition-0.json holds: the transaction hashes of each token's freeze and largest gap, and the first and
 * last pool price of its series. A pending window has no tokens yet, and a token with no pool has no freeze and no gap.
 */
function editionMarkers(): string[] {
  const markers = new Set<string>();
  for (const window of edition.windows) {
    for (const token of window.tokens ?? []) {
      for (const tx of [token.freeze?.from?.tx, token.freeze?.to?.tx, token.largestGap?.tx]) {
        if (tx) markers.add(tx);
      }
      const pool = token.series.pool;
      const first = pool[0];
      const last = pool[pool.length - 1];
      if (first) markers.add(String(first[1]));
      if (last) markers.add(String(last[1]));
    }
  }
  return [...markers];
}

test("the landing stays inside its gzip budgets", () => {
  const html = file("index.html");
  const assets = linked(html.toString("utf8"));
  // Guards: a regex that matches nothing would pass every budget.
  expect(assets.filter((a) => a.kind === "js").length).toBeGreaterThanOrEqual(5);
  expect(assets.filter((a) => a.kind === "css").length).toBeGreaterThanOrEqual(1);
  expect(assets.filter((a) => a.kind === "font")).toHaveLength(2);

  const weight = { html: gz(html), js: sum(assets, "js"), css: sum(assets, "css"), font: sum(assets, "font") };
  const total = weight.html + weight.js + weight.css + weight.font;
  console.log(`landing weight, gzip -9: ${JSON.stringify({ ...weight, total })}`);

  expect.soft(weight.js, "JS").toBeLessThanOrEqual(BUDGET.js);
  expect.soft(weight.css, "CSS").toBeLessThanOrEqual(BUDGET.css);
  expect.soft(Math.abs(weight.font - FONT_BASELINE), `fonts ${weight.font} B against ${FONT_BASELINE} B`).toBeLessThanOrEqual(
    FONT_TOLERANCE,
  );
  expect.soft(total, "total").toBeLessThanOrEqual(BUDGET.total);
});

test("no script that / or /gap-index links holds a string unique to edition-0.json", () => {
  const markers = editionMarkers();
  expect(markers.length).toBeGreaterThan(50);
  // The markers are real: the server-rendered /gap-index writes some of them into its HTML.
  const gapHtml = file("gap-index.html").toString("utf8");
  expect(markers.filter((m) => gapHtml.includes(m)).length).toBeGreaterThan(0);

  const leaks: string[] = [];
  for (const page of ["index.html", "gap-index.html"]) {
    const scripts = linked(file(page).toString("utf8")).filter((a) => a.kind === "js");
    expect(scripts.length, page).toBeGreaterThanOrEqual(5);
    for (const { path } of scripts) {
      const text = file(path).toString("utf8");
      for (const m of markers) if (text.includes(m)) leaks.push(`${page}: ${path} holds ${m}`);
    }
  }
  expect(leaks).toEqual([]);
});

for (const path of ["/", "/gap-index"]) {
  test(`${path} loads no third-party script and logs no console error`, async ({ page }) => {
    await routeLiveRpc(page, "weekend");
    const errors = collectErrors(page);
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await page.goto(path, { waitUntil: "networkidle" });
    const origin = new URL(page.url()).origin;
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.filter((url) => new URL(url).origin !== origin)).toEqual([]);
    expect(errors).toEqual([]);
  });
}
```

- [ ] **Step 2: Build and run it**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run build
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run e2e -- e2e/weight.spec.ts --project=chromium --workers=2
```

Expected: `4 passed`. The log line reads close to this:

`landing weight, gzip -9: {"html":24123,"js":158901,"css":9400,"font":140786,"total":333200}`

The HTML and JS are unchanged from `66bd0d0`, CSS is about 9,400, and the total is about 333,000. The edition has 120 markers, and 72 of them appear in `gap-index.html`.

If a budget fails, stop and report the logged weights. Do not raise a budget and do not change what is counted. Spec 11, item 3 sets the budgets, so the owner decides.

- [ ] **Step 3: See the leak check fail on a real leak, then restore**

This drill proves the leak test is not vacuous. Pick the third module script (not `noModule`) that `out/index.html` links. Copy it aside, append a marker, run the leak test, and restore the file. Do all of it with the commands below, which name the file for you.

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && node -e 'const fs=require("fs");const h=fs.readFileSync("out/index.html","utf8");const js=[...new Set([...h.matchAll(/<script\b[^>]*\ssrc="(\/_next\/[^"?#]+\.js)"[^>]*>/g)].filter(m=>!/\snoModule\b/i.test(m[0])).map(m=>m[1]))];const p="out"+js[2];fs.copyFileSync(p,p+".keep");const e=require("./content/gap-index/edition-0.json");const tx=e.windows[0].tokens[0].freeze.from.tx;fs.appendFileSync(p,"\n//"+tx+"\n");console.log("planted "+tx+" in "+p)'
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run e2e -- e2e/weight.spec.ts --project=chromium --workers=2 -g "unique to edition"
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && node -e 'const fs=require("fs");for(const f of fs.readdirSync("out/_next/static/chunks"))if(f.endsWith(".keep")){const p="out/_next/static/chunks/"+f;fs.renameSync(p,p.slice(0,-5));console.log("restored "+p.slice(0,-5))}'
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run e2e -- e2e/weight.spec.ts --project=chromium --workers=2
```

Expected:
- The planted run prints `1 failed`. Its diff lists `"index.html: /_next/static/chunks/<file>.js holds 0x416f..."`, and the same line for `gap-index.html` if that page links the chunk too.
- After the restore, the last run prints `4 passed` again.

`out/` is ignored by git, so nothing of the drill can be committed.

- [ ] **Step 4: Wider checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run typecheck
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run check:out
```

Expected: both exit 0. `tsconfig.json` includes `e2e/`, so the typecheck covers the JSON import and the optional chains.

- [ ] **Step 5: Commit**

Write `$SCRATCH/p0-commit-15.txt`:

```
test(web): add the landing weight budget spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/e2e/weight.spec.ts
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-15.txt"
```

---

### Task 16: Final verification and push

**Files:**
- Create: none
- Modify: none
- Test: the full gate

**Interfaces:**
- Consumes: Tasks 1-15.
- Produces: `feat/instrument-primitives` pushed to `origin`, with no PR and no merge. P0 merges after P-1 (spec 12.1), and Task 17 runs before its PR is opened.

- [ ] **Step 1: The full gate**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run verify
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run e2e -- --workers=2
```

Expected:
- `npm run verify` runs typecheck, vitest, build and check:out, and exits 0.
- The e2e run passes every spec on Chromium, `weight.spec.ts` included, and smoke on WebKit and Firefox.

If a test that passed at Task 0 now fails, stop and report it.

- [ ] **Step 2: Only the planned files changed, and nothing is mounted**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives diff --name-status origin/main...HEAD
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives diff --numstat origin/main...HEAD -- web/app/globals.css web/content/format.ts web/content/calendar.ts
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives log --oneline origin/main..HEAD
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives status --porcelain
```

Expected:
- The name-status lists exactly 41 paths:
  - `M` for `.github/workflows/ci.yml`, `web/app/globals.css`, `web/content/calendar.ts`, `web/content/format.ts` and `web/playwright.config.ts`;
  - `A` for the 5 `web/lib/motion/*.ts` files and `web/scripts/springs.ts`;
  - `A` for the 12 `web/components/instrument/*` files;
  - `A` for the 17 new `web/test/*` files and `web/e2e/weight.spec.ts`.
- The numstat shows `0` removed lines for all three files: `245	0` for `globals.css`, `20	0` for `calendar.ts` and `18	0` for `format.ts`.
- The log shows 15 commits.
- The status is empty.

Then use the Grep tool with pattern `components/instrument|lib/motion` over `web/app`, `web/components` and `web/content`, with glob `*.{ts,tsx}`. Expected: matches only inside `web/components/instrument/`, and the comments of `web/app/globals.css` are not scanned. No page, section or existing component imports a part.

- [ ] **Step 3: Push the branch**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives push -u origin feat/instrument-primitives
```

Expected: `branch 'feat/instrument-primitives' set up to track 'origin/feat/instrument-primitives'`. Do not open a PR and do not merge. The PR is opened only after P-1 and after Task 17. CI on a pull request builds the branch merged into `main`, and that `main` will hold PR #15's new brace line.

Report back with:
- the 15 commit subjects;
- the weight log line from Task 15;
- the WebKit and Firefox result;
- the two known follow-ups from Task 14;
- any stop condition you met.

This run ends here. Task 17 is a separate run, after P-1.

---

### Task 17: After P-1, merge main and fold `instrument` into the brace

Run this task only after P-1 has merged PR #15 into `main` (spec 12.1), and before the P0 PR is opened. Spec 5.2 says: "Once PR #15 has merged, `instrument` goes into the brace instead". After PR #15 the brace is no longer frozen (spec 12.2). So this is the one step in the plan that edits lines 1-10 of `globals.css` and removes a line.

**Files:**
- Modify: `web/app/globals.css`. `instrument` goes into the brace line, and the separate `@source "../components/instrument";` line is deleted.
- Test: `web/test/instrument-tokens.test.ts`, unchanged. Its `@source` case accepts both layouts. Then the full gate runs again.

**Interfaces:**
- Consumes: `origin/main` after P-1, with PR #15 merged; `feat/instrument-primitives` as Task 16 pushed it, in `W`. If `W` is gone, recreate it first with `git -C E:/APP2028/stocks-maxxing-hackathon worktree add E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives feat/instrument-primitives`.
- Produces: `feat/instrument-primitives` with `main` merged in and the line `@source "../components/{charts,gap,instrument,ledger,live,sections,ui}";`, pushed and ready for its PR.

- [ ] **Step 1: Check that PR #15 has merged**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon fetch origin
git -C E:/APP2028/stocks-maxxing-hackathon show origin/main:web/app/globals.css | grep -n '^@source "../components/{'
```

Expected: `8:@source "../components/{charts,gap,ledger,live,sections,ui}";`.
- If it prints `8:@source "../components/{charts,gap,live,sections,ui}";`, PR #15 has not merged. Stop, and do not run this task.
- If it prints any other line, stop and report it.

- [ ] **Step 2: Merge main**

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives merge --no-ff --no-commit origin/main
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives status --porcelain
```

Expected: `Automatic merge went well; stopped before committing as requested`. No status line starts with `UU`, `AA`, `DU` or `UD`. If git reports a conflict, run `git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives merge --abort`, then stop and report the conflicting paths.

The merge stages its own result. Stage nothing else before this commit. Write `$SCRATCH/p0-commit-16.txt`:

```
chore(web): merge main into the instrument primitives after PR #15

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-16.txt"
```

- [ ] **Step 3: Reinstall the locked dependencies**

PR #15 adds `viem` to `web/package.json` and `web/package-lock.json`, so the installed tree is out of date.

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm ci
```

Expected: `added <n> packages` and no `npm ERR!`.

- [ ] **Step 4: Fold `instrument` into the brace**

Read `web/app/globals.css` first; Edit needs it. Use Edit with old_string set to these four lines:

```css
@source "../components/{charts,gap,ledger,live,sections,ui}";
@source "../content/*.ts";
@source "../lib/site.ts";
@source "../components/instrument";
```

Set new_string to these three:

```css
@source "../components/{charts,gap,instrument,ledger,live,sections,ui}";
@source "../content/*.ts";
@source "../lib/site.ts";
```

- [ ] **Step 5: Run the checks**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm test -- test/instrument-tokens.test.ts
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run verify
netstat -ano | grep 4173
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives/web && npm run e2e -- --workers=2
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives diff --numstat origin/main -- web/app/globals.css
```

Expected:
- The tokens file prints `Tests  22 passed (22)`.
- `npm run verify` exits 0.
- `netstat` prints nothing.
- The e2e run passes every spec on Chromium, `weight.spec.ts` and PR #15's `ledger.spec.ts` included, and smoke on WebKit and Firefox.
- The numstat prints `245	1	web/app/globals.css`. The brace line is the one removed line, and its new form is one of the 245 added lines.

If a test fails, stop and report it with the failing titles. This covers a weight budget that PR #15's code pushes over the limit. Do not raise a budget and do not change what is counted.

- [ ] **Step 6: Commit and push**

Write `$SCRATCH/p0-commit-17.txt`:

```
feat(web): move components/instrument into the @source brace now that PR #15 has merged

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives add -- web/app/globals.css
SCRATCH='<your scratchpad path>' && git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives commit -F "$SCRATCH/p0-commit-17.txt"
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives push origin feat/instrument-primitives
git -C E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/instrument-primitives status --porcelain
```

Expected: the push is a fast-forward, `<old>..<new>  feat/instrument-primitives -> feat/instrument-primitives`, and the status is empty. Never force push. The P0 PR can now be opened. CI's merge ref is then this same tree.

Report back with:
- the merge result;
- the weight log line;
- the e2e totals per project;
- any stop condition you met.
