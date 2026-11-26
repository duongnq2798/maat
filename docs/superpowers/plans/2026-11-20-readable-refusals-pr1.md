# Readable Refusals, PR 1. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wherever a visitor reads a refusal on the landing, in the simulator, in the docs fork ledger or on the social images, a plain label comes first and the onchain reason code stays beside it as a small tag.

**Architecture:** One label map (`REASON_LABEL`) and one plain-text helper (`reasonText`) in `web/content/reasons.ts`, and one `ReasonTag` component for markup. Each surface switches to them; the hidden `data-verdict`, `data-reason` and `data-code` attributes and every code string stay as they are. The brand images are re-rendered with `npm run brand`, and the README's screenshots are retaken.

**Tech Stack:** Next.js 16.4.5 (static export), React 19.3.1, Tailwind CSS 4.3.5, TypeScript 7.0.2, vitest 5.1.0 with Testing Library, Playwright 1.65.0 with `@axe-core/playwright` 4.14.0, satori 0.63.2 and `@resvg/resvg-js` 2.6.2 for the brand images.

**Spec:** `docs/superpowers/specs/2026-11-20-readable-refusals-design.md` (sections 1 to 5 and 8). PR 2 (docs) and PR 3 (week map) get their own plans after this PR merges.

## Global Constraints

- Work in `E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals` on branch `fix/web-readable-refusals`; run npm and test commands from `web/`.
- The code strings of `enum Reason` never change. `data-verdict`, `data-reason` and `data-code` keep their elements, positions and attribute order (`lib/check-out.ts` regex-checks them in the exported HTML).
- Labels are exactly those in spec section 3; `reasonText(code)` returns `"<label> (<CODE>)"`.
- Small text (the 11 px code tags) keeps a contrast of at least 4.5:1; the landing has no serious or critical axe violation.
- Every committed file is in English. No number, date or count is invented.
- Stage with `git add -- <files>` only (never `git add -A`, `git add .` or `git commit -am`); commit with `git commit -F <message file>`; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No `--amend`, no force push, no bare `git stash`.
- Never stage `grep.exe.stackdump`, `web/grep.exe.stackdump` or `docs/superpowers/roadmap/`.
- e2e tests serve `web/out`, so run `npm run build` before `npx playwright test`.
- A step's line numbers name the file as it reads before that task's edits. Edits earlier in the same task shift them, so always match the quoted text.

## Review Focus

The spec implies these inputs, but no task's tests would otherwise exercise them. Each line names its owning task, which adds the test.

1. A 375 px wide screen with the longest labels ("Pool price too far from oracle", "Price feed out of date"): the Refusals items, the ledger cell and the simulator verdict wrap inside their boxes and the page never scrolls sideways (Task 8 adds an e2e check that `document.documentElement.scrollWidth` does not exceed the viewport width at 375 px).
2. The X intent link built from the new post text, whose brackets (and the `$`, `:` and apostrophe already in it) must survive URL encoding: the decoded `text` parameter equals the post text exactly (Task 6).
3. What a screen reader announces from the hero's and the simulator's `role="status"` regions after a change: the region's text reads verdict, label, code, outcome in that order, with no stray characters (Tasks 4 and 6).
4. A ledger row with no note, as mainnet rows read in W2 may be: a refused row shows the meaning for its code and an allowed row shows an empty cell, never `undefined` (Task 3).
5. Stale brand PNGs: CI checks only their sizes, so the images must be re-rendered and opened by eye (Task 7).

---

### Task 1: Plain labels for the reason codes

**Files:**
- Modify: `web/content/reasons.ts:44-45` (insert `REASON_LABEL` and `reasonText` after `HIGHLIGHT_REASON`)
- Modify: `web/content/reasons.ts:60` (`REASON_MEANING.CONCENTRATION`)
- Modify: `web/README.md:113` (the "Reference entries" row for a member of `Reason`)
- Create: `web/test/reason-label.test.ts`
- Test: `web/test/reason-label.test.ts`, plus the existing `web/test/readme.test.ts`, `web/test/facts.test.ts`, `web/test/refusal-codes.test.ts`, `web/test/page.test.tsx`, `web/test/docs-components.test.tsx`, `web/test/component-text.test.ts`, `web/test/component-text-parity.test.tsx`, `web/test/simulator.test.tsx`

**Interfaces:**
- Consumes: `REASONS`, `type ReasonCode`, `REASON_MEANING` and `REASON_MEANING_DOCS`, all in `web/content/reasons.ts` today. No earlier task.
- Produces (Tasks 2 and later import these from `@/content/reasons`):
  - `export const REASON_LABEL: Readonly<Record<ReasonCode, string>>`, one label per key `"OK"` and each `REASONS` member, in that order.
  - `export function reasonText(code: ReasonCode): string`, which returns `` `${REASON_LABEL[code]} (${code})` ``, so `reasonText("MARKET_CLOSED") === "Market closed (MARKET_CLOSED)"`.
  - `REASON_MEANING.CONCENTRATION === "The buy would push one stock past its maximum weight, or its weight can't be measured."`. `REASON_MEANING_DOCS` spreads `REASON_MEANING` and does not override `CONCENTRATION`, so `REASON_MEANING_DOCS.CONCENTRATION` changes with it. The docs ReasonTable (HTML in `components/docs/content.tsx:81`, Markdown in `lib/docs/component-text.ts:276`) and the landing Refusals section (`components/sections/Refusals.tsx:35`) pick up the new sentence with no further edit.

Searches done for this task, so nothing is missed:
- `grep -rn "maximum weight\|push one stock" web/test web/e2e web/content web/lib web/components` finds only `web/content/reasons.ts:60`. No existing unit test, e2e spec or committed Markdown output pins the CONCENTRATION sentence. `test/page.test.tsx:41` and `test/docs-components.test.tsx:33-34` read `REASON_MEANING` and `REASON_MEANING_DOCS` at run time, so they stay as they are. `web/` tracks no generated `.md` or `.txt` output, and the repository has no snapshot files.
- `test/readme.test.ts:100-108` ("names in code only paths the repository tracks") runs `git ls-files`. Once the README row names `test/reason-label.test.ts`, that file has to be staged before the README test runs. Step 4 stages it first.
- The README's Documentation table already has this plan's row (`README.md:702`), added in the same commit that added this plan file, so the check that it lists every tracked spec and plan (`test/readme.test.ts:146-152`) passes from this task on.

- [ ] **Step 1: Write the failing test**

Create `web/test/reason-label.test.ts` with exactly this content:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REASON_LABEL, REASON_MEANING, REASON_MEANING_DOCS, REASONS, reasonText } from "@/content/reasons";

// Spec 2026-11-20 section 3: one short plain label per code, shown before the code wherever a person reads a decision.
// The code strings themselves are held to Types.sol by facts.test.ts; this file holds the labels to those codes.

describe("REASON_LABEL", () => {
  it("has exactly the keys OK and REASONS, in enum order", () => {
    expect(Object.keys(REASON_LABEL)).toEqual(["OK", ...REASONS]);
  });

  it("gives each code a non-empty label of at most 32 characters with no underscore", () => {
    for (const [code, label] of Object.entries(REASON_LABEL)) {
      expect(label.trim(), code).not.toBe("");
      expect(label.length, code).toBeLessThanOrEqual(32);
      expect(label, code).not.toContain("_");
    }
  });
});

describe("reasonText", () => {
  it("puts the label first and the code in brackets", () => {
    expect(reasonText("MARKET_CLOSED")).toBe("Market closed (MARKET_CLOSED)");
    expect(reasonText("OK")).toBe("All checks passed (OK)");
  });
});

describe("REASON_MEANING", () => {
  it("gives CONCENTRATION's fail-closed case, as concepts/refusal-codes does, on the landing and in the docs table", () => {
    const meaning = "The buy would push one stock past its maximum weight, or its weight can't be measured.";
    expect(REASON_MEANING.CONCENTRATION).toBe(meaning);
    expect(REASON_MEANING_DOCS.CONCENTRATION).toBe(meaning);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

From `web/`:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals/web
npx vitest run test/reason-label.test.ts
```

Expected: `Test Files  1 failed (1)`, `Tests  4 failed (4)`:
- both `REASON_LABEL` tests fail with `TypeError: Cannot convert undefined or null to object`, because `REASON_LABEL` is not exported yet;
- the `reasonText` test fails with a `TypeError` saying `reasonText` is not a function;
- the `REASON_MEANING` test fails with an `AssertionError`, because `REASON_MEANING.CONCENTRATION` still reads `"The buy would push one stock past its maximum weight."`.

- [ ] **Step 3: Implement**

3a. In `web/content/reasons.ts`, replace these lines (44-45):

```ts
/** The refusal the fork run recorded; the Refusals section highlights it. */
export const HIGHLIGHT_REASON: RefusalCode = "MARKET_CLOSED";
```

with:

```ts
/** The refusal the fork run recorded; the Refusals section highlights it. */
export const HIGHLIGHT_REASON: RefusalCode = "MARKET_CLOSED";

/** One short plain label per code, shown before the code wherever a person reads a decision (spec 2026-11-20 section 3). */
export const REASON_LABEL: Readonly<Record<ReasonCode, string>> = {
  OK: "All checks passed",
  VAULT_PAUSED: "Vault paused",
  ACTION_NOT_SUPPORTED: "Credit not enabled",
  TOKEN_NOT_ALLOWED: "Token not allowed",
  TOKEN_PAUSED: "Token paused",
  POLICY_BLOCKED: "Blocked by token policy",
  MARKET_CLOSED: "Market closed",
  FEED_STALE: "Price feed out of date",
  BAD_PRICE: "Bad price data",
  MULTIPLIER_COOLDOWN: "Corporate action cooldown",
  PREMIUM_TOO_HIGH: "Pool price too far from oracle",
  SIZE_LIMIT: "Over the size limit",
  CONCENTRATION: "Too much in one stock",
  PAYEE_NOT_ALLOWED: "Payee not approved",
  INSUFFICIENT_BALANCE: "Not enough funds",
  SWAP_FAILED: "Swap failed",
  TRANSFER_FAILED: "Transfer failed",
  CREDIT_FAILED: "Aave call failed",
  HEALTH_FACTOR_LOW: "Health factor too low",
  DERISK_WINDOW: "Pre-pause safety margin",
};

/** The plain-text form for places that can't hold markup: "Market closed (MARKET_CLOSED)". */
export function reasonText(code: ReasonCode): string {
  return `${REASON_LABEL[code]} (${code})`;
}
```

3b. In the same file, replace this line (line 60 before 3a, line 89 after it):

```ts
  CONCENTRATION: "The buy would push one stock past its maximum weight.",
```

with:

```ts
  CONCENTRATION: "The buy would push one stock past its maximum weight, or its weight can't be measured.",
```

Leave the `REASON_MEANING_DOCS` block and its comment ("REASON_MEANING with four lines widened to match the code") unchanged. It still overrides exactly four lines, and CONCENTRATION is not one of them.

3c. In `web/README.md`, under `### Reference entries`, replace this row (line 113):

```md
| a member of `Reason` | concepts/refusal-codes | a `### <CODE>` heading under its group's heading, with its Id line, and the code in `REASONS`, in the enum's order, and in `REASON_GROUPS` in `content/reasons.ts` (`test/refusal-codes.test.ts`, `test/facts.test.ts`) |
```

with:

```md
| a member of `Reason` | concepts/refusal-codes | a `### <CODE>` heading under its group's heading, with its Id line, and the code in `REASONS`, in the enum's order, in `REASON_GROUPS`, and in `REASON_LABEL` with a plain label of at most 32 characters and no underscore, in `content/reasons.ts` (`test/refusal-codes.test.ts`, `test/facts.test.ts`, `test/reason-label.test.ts`) |
```

- [ ] **Step 4: Run the tests and see them pass**

`test/readme.test.ts` checks every path the README names in code against `git ls-files`, so stage the new test file before running it. From `web/`:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals/web
git add -- test/reason-label.test.ts
npx vitest run test/reason-label.test.ts
```

Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

Then run the tests that read `content/reasons.ts` or `web/README.md`:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals/web
npx vitest run test/readme.test.ts test/facts.test.ts test/refusal-codes.test.ts test/page.test.tsx test/docs-components.test.tsx test/component-text.test.ts test/component-text-parity.test.tsx test/simulator.test.tsx
```

Expected: every file passes.
- `readme.test.ts` now also finds `test/reason-label.test.ts` tracked.
- `page.test.tsx:41` renders the Refusals section with the new CONCENTRATION sentence from `REASON_MEANING` itself.
- `docs-components.test.tsx` and both component-text tests render the ReasonTable from `REASON_MEANING_DOCS`. The HTML and Markdown read the same constant, so the parity test stays equal.
- `simulator.test.tsx` renders `REASON_MEANING` in its verdict and pins no meaning text.

Then the type check and the whole web suite:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals/web
npm run typecheck
npm test
```

Expected: `tsc --noEmit` prints no error, and `vitest run` reports every test file passed. No e2e spec pins the CONCENTRATION sentence or uses `REASON_LABEL` yet, so this task needs no e2e run.

- [ ] **Step 5: Commit**

Run in one Git Bash call from `web/`. The message file is a temp file outside the repository:

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals/web
git add -- content/reasons.ts test/reason-label.test.ts README.md
git diff --cached --name-only
msg="$(mktemp)"
cat > "$msg" <<'EOF'
fix(web): add a plain label for each refusal code

REASON_LABEL in content/reasons.ts gives OK and each refusal code a short
plain label, and reasonText(code) gives the plain-text form
"Market closed (MARKET_CLOSED)" for places that can't hold markup
(spec 2026-11-20, sections 3 and 4). Nothing renders them yet.

REASON_MEANING.CONCENTRATION now names the fail-closed case, as
concepts/refusal-codes already does. The docs ReasonTable inherits it
through REASON_MEANING_DOCS.

test/reason-label.test.ts holds the labels' keys to REASONS, their
length and characters, and reasonText's form. The web README's row for
a new member of Reason now requires its REASON_LABEL entry.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$msg"
rm -f "$msg"
git status --short
```

Expected: `git diff --cached --name-only` lists exactly `web/README.md`, `web/content/reasons.ts` and `web/test/reason-label.test.ts`. The commit succeeds, and `git status --short` prints nothing.

---

### Task 2: Add the ReasonTag component (plain label, then the code)

**Files:**
- Create: `web/components/ui/ReasonTag.tsx`
- Test: `web/test/reason-tag.test.tsx` (new)

No existing file changes in this task. No existing test pins text that this task changes. `grep -rn "ReasonTag\|data-reason-tag" web/test web/e2e web/components web/lib` finds nothing today.

**Interfaces:**
- Consumes (from Task 1, `web/content/reasons.ts`): `REASON_LABEL: Readonly<Record<ReasonCode, string>>`, `type ReasonCode`, `REASONS`.
- Produces (`web/components/ui/ReasonTag.tsx`), for Tasks 4 and later:
  - `export type ReasonTagTone = "verdict" | "refuse" | "neutral"`
  - `export type ReasonTagLayout = "stacked" | "inline"`
  - `export interface ReasonTagProps { code: ReasonCode; tone?: ReasonTagTone; layout?: ReasonTagLayout; className?: string }`
  - `export function ReasonTag({ code, tone = "neutral", layout = "stacked", className }: ReasonTagProps)`. The return type is inferred, because `@types/react` 19 has no global `JSX` namespace.
  - DOM: `<span data-reason-tag={code} class="<layout classes>[ <className>]"><span class="<label tone>">{REASON_LABEL[code]}</span><span class="font-mono text-[11px] <code tone>">{code}</span></span>`. Its `textContent` is exactly `REASON_LABEL[code] + code`, for example `Market closedMARKET_CLOSED`. So a parent's `toHaveTextContent("Market closed")` and `toHaveTextContent("MARKET_CLOSED")` both still match.
  - Root classes: stacked is `inline-flex flex-col gap-0.5`. Inline is `inline-flex flex-wrap items-baseline gap-x-1.5`.
  - Tone classes, label / code: `verdict` is `font-semibold` / `opacity-80`. `refuse` is `text-refuse` / `text-refuse`. `neutral` is `text-ink` / `text-ink-2`. The spec's `accent` tone is dropped: its only intended surface, the landing ledger, renders its code as a plain `<code>` beside the badge (Task 3).
  - The label takes its size, weight and font family from the root's `className` or from the parent. The only `font-mono` parent in PR 1 is the simulator's tape row (Task 6), which keeps the mono label by design; elsewhere, pass `className="font-sans"` to set a label in sans inside a mono parent: the code keeps its own `font-mono`. The code span sets no font weight of its own, so it inherits the parent's.
  - The component has no hooks and no `"use client"`, so server sections (Problem, Refusals) and client components (DecisionEngine, Simulator) can both render it.

**Checked before writing:**
- Colour tokens. `web/app/globals.css` `@theme` defines `--color-refuse: #C2410C` (line 26), `--color-ink: #0B0D12` (line 19) and `--color-ink-2: #5A6170` (line 20). So `text-refuse`, `text-ink` and `text-ink-2` exist. `test/tokens.test.ts` pins their values.
- Tailwind scanning. `web/app/globals.css:8` has `@source "../components/{charts,sections,ui}";`, so the literal class strings in `components/ui/ReasonTag.tsx` reach the landing stylesheet. Docs CSS (`app/(docs)/docs.css`) does not scan `components/ui`. The spec does not use ReasonTag in the docs.
- `<code>` or `<span className="font-mono">`: use the span.
  - `globals.css` has no rule for `code`. Tailwind's preflight only sets the mono font family and `font-size: 1em` on `code`, and the utilities would override both.
  - No landing component renders a `<code>` element today. Every code and mono value on the landing is a `<span className="font-mono …">`: `components/DecisionEngine.tsx:98`, `components/sections/Problem.tsx:21`, `components/sections/Refusals.tsx:28-34`, `components/sections/Mandate.tsx:37` and `components/Simulator.tsx:365`.
  - So the span matches the house pattern, including the label-over-`k` pairing that `Mandate.tsx:35-38` uses. It adds nothing new to the accessibility tree inside the `role="status"` regions that `lib/check-out.ts` reads. It also cannot pick up the inline-code chip style that the docs' `code` elements get.

- [ ] **Step 1: Write the failing test**

Create `web/test/reason-tag.test.tsx` with this content:

```tsx
import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { ReasonTag, type ReasonTagLayout, type ReasonTagTone } from "@/components/ui/ReasonTag";
import { REASON_LABEL, type ReasonCode, REASONS } from "@/content/reasons";

const CODES: readonly ReasonCode[] = ["OK", ...REASONS];

/** Renders one tag and returns its root and its two children: the label, then the code. */
function setup(props: ComponentProps<typeof ReasonTag>) {
  const { container } = render(<ReasonTag {...props} />);
  const root = container.firstElementChild as HTMLElement;
  const [label, code] = [...root.children] as [HTMLElement, HTMLElement];
  return { root, label, code };
}

describe("ReasonTag", () => {
  it("renders the plain label, then the code", () => {
    const { root, label, code } = setup({ code: "MARKET_CLOSED" });
    expect(root.tagName).toBe("SPAN");
    expect(root.children).toHaveLength(2);
    expect(label.textContent).toBe("Market closed");
    expect(code.textContent).toBe("MARKET_CLOSED");
  });

  it("marks its root with the code it shows", () => {
    const { root } = setup({ code: "PREMIUM_TOO_HIGH" });
    expect(root).toHaveAttribute("data-reason-tag", "PREMIUM_TOO_HIGH");
  });

  it.each(CODES)("%s reads as its label and its code, with no other characters", (c) => {
    const { root } = setup({ code: c });
    expect(root.textContent).toBe(`${REASON_LABEL[c]}${c}`);
  });

  it("keeps the label and the code in the accessible text: nothing is aria-hidden", () => {
    const { root } = setup({ code: "MARKET_CLOSED", tone: "verdict" });
    expect(root).not.toHaveAttribute("aria-hidden");
    expect(root.querySelector("[aria-hidden]")).toBeNull();
  });

  it("defaults to the neutral tone, stacked", () => {
    const { root, label, code } = setup({ code: "SIZE_LIMIT" });
    expect(root.className).toBe("inline-flex flex-col gap-0.5");
    expect(label.className).toBe("text-ink");
    expect(code.className).toBe("font-mono text-[11px] text-ink-2");
  });

  it.each<[ReasonTagLayout, string]>([
    ["stacked", "inline-flex flex-col gap-0.5"],
    ["inline", "inline-flex flex-wrap items-baseline gap-x-1.5"],
  ])("layout %s lays the root out as %j", (layout, rootClass) => {
    const { root } = setup({ code: "MARKET_CLOSED", layout });
    expect(root.className).toBe(rootClass);
  });

  it.each<[ReasonTagTone, string, string]>([
    ["verdict", "font-semibold", "font-mono text-[11px] opacity-80"],
    ["refuse", "text-refuse", "font-mono text-[11px] text-refuse"],
    ["neutral", "text-ink", "font-mono text-[11px] text-ink-2"],
  ])("tone %s gives the label %j and the code %j", (tone, labelClass, codeClass) => {
    const { label, code } = setup({ code: "MARKET_CLOSED", tone });
    expect(label.className).toBe(labelClass);
    expect(code.className).toBe(codeClass);
  });

  it("adds the caller's classes to the root", () => {
    const { root } = setup({ code: "OK", tone: "verdict", layout: "stacked", className: "text-right text-[15px]" });
    expect(root.className).toBe("inline-flex flex-col gap-0.5 text-right text-[15px]");
  });
});
```

How this test meets the brief:
- Label then code: the first test checks the two children in order.
- The `data-reason-tag` attribute: the second test.
- Exact `textContent` for every code, including `OK`: the `it.each(CODES)` test.
- Nothing aria-hidden: the fourth test.
- Stacked and inline root classes: the layout `it.each`.
- Each tone's exact classes: the tone `it.each`. The verdict tone sets no `text-*` colour, so the label and code inherit the box's white.
- Defaults: the "defaults" test.
- Passing `className` through: the last test.

- [ ] **Step 2: Run it and see it fail**

From `web/`:

```bash
npx vitest run test/reason-tag.test.tsx
```

Expected: the file fails before any test runs, with:

```
Error: Failed to resolve import "@/components/ui/ReasonTag" from "test/reason-tag.test.tsx". Does the file exist?
...
 Test Files  1 failed (1)
      Tests  no tests
```

Task 1 must already be merged into the branch, because `REASON_LABEL` comes from `@/content/reasons`.

- [ ] **Step 3: Implement**

Create `web/components/ui/ReasonTag.tsx` with this content:

```tsx
import { REASON_LABEL, type ReasonCode } from "@/content/reasons";

/** The background the tag sits on (spec 2026-11-20 section 4). Each label and code must keep 4.5:1 contrast on it. */
export type ReasonTagTone = "verdict" | "refuse" | "neutral";
/** "stacked": the label over the code. "inline": the code after the label, wrapping under it only when out of room. */
export type ReasonTagLayout = "stacked" | "inline";

export interface ReasonTagProps {
  code: ReasonCode;
  tone?: ReasonTagTone;
  layout?: ReasonTagLayout;
  /** Added to the root: the label's size, weight and alignment come from here or the parent. */
  className?: string;
}

const TONE: Record<ReasonTagTone, { label: string; code: string }> = {
  // On the ink or accent verdict box: both inherit its white; the code takes the opacity of the box's small labels.
  verdict: { label: "font-semibold", code: "opacity-80" },
  refuse: { label: "text-refuse", code: "text-refuse" },
  neutral: { label: "text-ink", code: "text-ink-2" },
};

const LAYOUT: Record<ReasonTagLayout, string> = {
  stacked: "inline-flex flex-col gap-0.5",
  inline: "inline-flex flex-wrap items-baseline gap-x-1.5",
};

/**
 * A reason as a person reads it: the plain label (REASON_LABEL), then the onchain code in small mono type. No
 * separator sits between them in the text; both layouts are flex boxes, so the two are separate boxes and assistive
 * tech reads them as two words. Nothing is aria-hidden: the code is part of the accessible text.
 */
export function ReasonTag({ code, tone = "neutral", layout = "stacked", className }: ReasonTagProps) {
  const t = TONE[tone];
  return (
    <span data-reason-tag={code} className={className ? `${LAYOUT[layout]} ${className}` : LAYOUT[layout]}>
      <span className={t.label}>{REASON_LABEL[code]}</span>
      <span className={`font-mono text-[11px] ${t.code}`}>{code}</span>
    </span>
  );
}
```

Why it is built this way:
- **`opacity-80` in the verdict tone.** The verdict boxes already set their small mono labels at this opacity: `DecisionEngine.tsx:94` and `:99`, and `Simulator.tsx:362`.
- **`gap-0.5` in the stacked layout.** It matches the label-over-`k` stack in `Mandate.tsx:35`.
- **Flex in both layouts.** A flex root makes the label and the code two separate boxes, so screen readers read them as two words even though the DOM puts no space between them.
- **`flex-wrap` in the inline layout.** It keeps the code on the label's line when there is room, and stops a long pair (for example `Pool price too far from oracle` and `PREMIUM_TOO_HIGH`) from overflowing at 375 px.

- [ ] **Step 4: Run the tests and see them pass**

From `web/`:

```bash
npx vitest run test/reason-tag.test.tsx
```

Expected: `Test Files  1 passed (1)` and `Tests  30 passed (30)`. The 30 tests are 1 + 1 + 20 codes + 1 + 1 + 2 layouts + 3 tones + 1.

Then confirm that nothing else moved and that the new files type-check under the repository's strict settings (`noUncheckedIndexedAccess` included):

```bash
npx vitest run
npm run typecheck
```

Expected: the whole vitest suite is green, and `typecheck` (`next typegen && tsc --noEmit`) exits 0. No other test or e2e file needs an update: this task adds files and changes no rendered text.

- [ ] **Step 5: Commit**

From `web/`. Write the message to a file outside the worktree, then commit only the two new files:

```bash
cat > "${TMPDIR:-/tmp}/reason-tag-commit.txt" <<'EOF'
feat(web): add ReasonTag, a reason's plain label with its code

ReasonTag shows a reason the way a person should read it: the plain
label from REASON_LABEL first, then the onchain code in 11px mono. It has
three tones for the backgrounds it sits on (the ink or accent verdict
box, the refuse colour on a light surface, and a plain surface) and two
layouts, stacked and inline. Nothing is aria-hidden, so the code stays in
the accessible text. The hero, the simulator and the landing sections
switch to it in the next commits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git add -- components/ui/ReasonTag.tsx test/reason-tag.test.tsx
git commit -F "${TMPDIR:-/tmp}/reason-tag-commit.txt"
```

---

### Task 3: Decision labels in the landing ledger and the docs fork ledger

**Files:**
- Modify: `web/content/decisions.ts:3,99-101`
- Modify: `web/components/LedgerTable.tsx:4-5,21-23,84-93`
- Modify: `web/lib/docs/content-data.ts:4,28-31,40`
- Modify: `web/components/docs/content.tsx:147`
- Modify: `web/lib/docs/component-text.ts:295`
- Modify: `web/content/docs/get-started/read-a-decision.mdx:7,26-27,92,120-121`
- Test: `web/test/decisions.test.ts:4,30-37` (plus a new test after line 44)
- Test: `web/test/ledger-table.test.tsx:5,9-15,33` (plus three new tests after line 63)
- Test: `web/test/docs-components.test.tsx:52-58`
- Test: `web/test/component-text.test.ts:275-280`
- Test: `web/e2e/smoke.spec.ts:71`
- Test (no edit; it must stay green): `web/test/component-text-parity.test.tsx`

**Interfaces:**
- Consumes: `REASON_LABEL: Readonly<Record<ReasonCode, string>>` from `web/content/reasons.ts` (Task 1), for example `REASON_LABEL.MARKET_CLOSED === "Market closed"` and `REASON_LABEL.OK === "All checks passed"`. Also uses the existing `REASON_MEANING: Readonly<Record<RefusalCode, string>>` and the types `ReasonCode` and `RefusalCode` from the same file. This task does not use `ReasonTag`, because the badge already holds the label. The ledger's code tag is a plain `<code>` beside the badge, not a ReasonTag, so the spec's `accent` tone is dropped (spec section 4 is amended in the same commit as this plan).
- Produces:
  - `decisionLabel(r: DecisionRow): string` in `web/content/decisions.ts`. It returns `` `${r.allowed ? "Allowed" : "Refused"} · ${REASON_LABEL[r.reason]}` ``, for example `"Refused · Market closed"` or `"Allowed · All checks passed"`.
  - `ForkLedgerData.rows[i].code: ReasonCode` in `web/lib/docs/content-data.ts`, next to `decision` (which is the `decisionLabel()` text).
  - The docs ForkLedger Decision cell reads `Refused · Market closed (MARKET_CLOSED)`. In HTML the code is in a `<code>`. In Markdown the cell is ``Refused · Market closed (`MARKET_CLOSED`)``.
  - In the landing ledger's Decision cell, the badge holds `decisionLabel(r)` and a `<code>` holding `r.reason` follows it. The Note cell falls back to `REASON_MEANING[code]` for a refused row that has no note. An allowed row with no note keeps the cell empty.

---

- [ ] **Step 1: Write the failing test**

Run every command from `web/`.

**1a. `web/test/decisions.test.ts`**

Below line 4 (`import { FACTS } from "@/content/facts";`), insert:

```ts
import { REASON_LABEL, REASONS } from "@/content/reasons";
```

Replace lines 30-37:

```ts
  it("formats like the comp", () => {
    const rows = getDecisions();
    expect(rows.map((r) => [r.timeLabel, intentLabel(r), decisionLabel(r), gasLabel(r)])).toEqual([
      ["Thu 5 Nov 10:30", "BUY NVDAc · $20", "ALLOWED · OK", "758,192"],
      ["Thu 5 Nov 10:30", "SUPPLY NVDAc · $15", "ALLOWED · OK", "286,707"],
      ["Thu 5 Nov 10:30", "BORROW USDC · $5", "ALLOWED · OK", "484,173"],
      ["Sat 7 Nov", "BUY GOOGLc · $10", "REFUSED · MARKET_CLOSED", "111,116"],
    ]);
```

with:

```ts
  it("formats each row as the ledger shows it", () => {
    const rows = getDecisions();
    expect(rows.map((r) => [r.timeLabel, intentLabel(r), decisionLabel(r), gasLabel(r)])).toEqual([
      ["Thu 5 Nov 10:30", "BUY NVDAc · $20", "Allowed · All checks passed", "758,192"],
      ["Thu 5 Nov 10:30", "SUPPLY NVDAc · $15", "Allowed · All checks passed", "286,707"],
      ["Thu 5 Nov 10:30", "BORROW USDC · $5", "Allowed · All checks passed", "484,173"],
      ["Sat 7 Nov", "BUY GOOGLc · $10", "Refused · Market closed", "111,116"],
    ]);
```

The notes assertion that follows (old lines 38-43) stays as it is. Insert this test after the `  });` that closes that test (old line 44) and before `  it("hands out copies", () => {`:

```ts

  it("labels a decision with its verdict and the plain label of its reason, never the bare code", () => {
    const row = getDecisions()[0]!;
    expect(decisionLabel({ ...row, allowed: true, reason: "OK" })).toBe(`Allowed · ${REASON_LABEL.OK}`);
    for (const code of REASONS) {
      const label = decisionLabel({ ...row, allowed: false, reason: code });
      expect(label).toBe(`Refused · ${REASON_LABEL[code]}`);
      expect(label).not.toContain(code);
    }
  });
```

**1b. `web/test/ledger-table.test.tsx`**

Below line 5 (`import { type DecisionRow, getDecisions } from "@/content/decisions";`), insert:

```tsx
import { REASON_MEANING } from "@/content/reasons";
```

Replace lines 9-15:

```tsx
function setup(rows: readonly DecisionRow[] = getDecisions()) {
  render(<LedgerTable rows={rows} heading={<h2>Every answer is public. Especially no.</h2>} />);
  return {
    bodyRows: () => within(screen.getByRole("table")).getAllByRole("row").slice(1),
    chip: (name: string) => screen.getByRole("button", { name }),
  };
}
```

with:

```tsx
function setup(rows: readonly DecisionRow[] = getDecisions()) {
  render(<LedgerTable rows={rows} heading={<h2>Every answer is public. Especially no.</h2>} />);
  const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return {
    bodyRows,
    chip: (name: string) => screen.getByRole("button", { name }),
    /** The text of one column in each body row: 0 time, 1 intent, 2 decision, 3 note, 4 gas used. */
    column: (i: number) => bodyRows().map((row) => within(row).getAllByRole("cell")[i]!.textContent),
  };
}
```

Replace line 33:

```tsx
    expect(bodyRows()[0]).toHaveTextContent("REFUSED · MARKET_CLOSED");
```

with:

```tsx
    expect(bodyRows()[0]).toHaveTextContent("Refused · Market closed");
```

Insert these tests after the `  });` that closes `it("scrolls the table in its own focusable region", ...)` (line 63) and before the final `});` (line 64):

```tsx

  it("shows the verdict and the reason's plain label in the badge, and the code beside it", () => {
    const { bodyRows } = setup();
    const [first, , , last] = bodyRows();
    expect(within(first!).getByText("Allowed · All checks passed")).toBeInTheDocument();
    expect(within(first!).getByText("OK").tagName).toBe("CODE");
    expect(within(last!).getByText("Refused · Market closed")).toBeInTheDocument();
    expect(within(last!).getByText("MARKET_CLOSED").tagName).toBe("CODE");
  });

  it("shows what the code means in a refused row that has no note", () => {
    const refused = getDecisions().find((r) => !r.allowed)!;
    const { column } = setup([{ ...refused, note: undefined }]);
    expect(column(3)).toEqual([REASON_MEANING.MARKET_CLOSED]);
  });

  it("leaves the note empty in an allowed row that has no note", () => {
    const allowed = getDecisions()
      .filter((r) => r.allowed)
      .map((r) => ({ ...r, note: undefined }));
    const { column } = setup(allowed);
    expect(column(3)).toEqual(allowed.map(() => ""));
  });

  it("keeps a row's own note over the meaning of its code", () => {
    const { column } = setup();
    expect(column(3)).toEqual(getDecisions().map((r) => r.note));
  });
```

**1c. `web/test/docs-components.test.tsx`**

Replace lines 52-58:

```tsx
  it("ForkLedger has one row per fork decision and names the fork block", () => {
    render(<ForkLedger />);
    const rows = within(screen.getByRole("region", { name: "Decisions from the fork run" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + getDecisions().length);
    expect(screen.getByText("REFUSED · MARKET_CLOSED")).toBeInTheDocument();
    expect(screen.getByText(/block 53,551,627/)).toBeInTheDocument();
  });
```

with:

```tsx
  it("ForkLedger has one row per fork decision, each decision a plain label with its code, and names the fork block", () => {
    render(<ForkLedger />);
    const rows = within(screen.getByRole("region", { name: "Decisions from the fork run" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + getDecisions().length);
    const decisions = rows.slice(1).map((row) => within(row).getAllByRole("cell")[2]!);
    expect(decisions.map((td) => td.textContent)).toEqual([
      "Allowed · All checks passed (OK)",
      "Allowed · All checks passed (OK)",
      "Allowed · All checks passed (OK)",
      "Refused · Market closed (MARKET_CLOSED)",
    ]);
    expect(decisions.map((td) => td.querySelector("code")?.textContent)).toEqual(["OK", "OK", "OK", "MARKET_CLOSED"]);
    expect(screen.getByText(/block 53,551,627/)).toBeInTheDocument();
  });
```

**1d. `web/test/component-text.test.ts`**

Replace lines 275-280:

```ts
  it("ForkLedger gives one row per fork decision, then the caption naming the fork block", () => {
    const out = lines(text("ForkLedger"));
    expect(out[0]).toBe("| Time (ET) | Intent | Decision | Gas | Note |");
    expect(out.filter((l) => l.startsWith("| "))).toHaveLength(2 + getDecisions().length);
    expect(out.at(-1)).toContain(`block ${factFor("forkBlock").text}`);
  });
```

with:

```ts
  it("ForkLedger gives one row per fork decision, each decision a label with its code, then the caption naming the fork block", () => {
    const out = lines(text("ForkLedger"));
    expect(out[0]).toBe("| Time (ET) | Intent | Decision | Gas | Note |");
    expect(out.filter((l) => l.startsWith("| "))).toHaveLength(2 + getDecisions().length);
    expect(out.filter((l) => l.includes(" | Allowed · All checks passed (`OK`) | "))).toHaveLength(getDecisions().filter((r) => r.allowed).length);
    expect(out.filter((l) => l.includes(" | Refused · Market closed (`MARKET_CLOSED`) | "))).toHaveLength(1);
    expect(out.at(-1)).toContain(`block ${factFor("forkBlock").text}`);
  });
```

**1e. `web/e2e/smoke.spec.ts`**

Replace line 71:

```ts
  await expect(rows.first()).toContainText("REFUSED · MARKET_CLOSED");
```

with:

```ts
  await expect(rows.first()).toContainText("Refused · Market closed");
  await expect(rows.first().locator("code")).toHaveText("MARKET_CLOSED");
```

`web/test/component-text-parity.test.tsx` gets no edit. Its `ForkLedger` cases compare the rendered cells with the Markdown cells, which keeps the HTML and the Markdown equal.

- [ ] **Step 2: Run it and see it fail**

```bash
npx vitest run test/decisions.test.ts test/ledger-table.test.tsx test/docs-components.test.tsx test/component-text.test.ts
```

Expected failures:
- `decisions.test.ts › formats each row as the ledger shows it`: the deep-equal diff shows `"ALLOWED · OK"` and `"REFUSED · MARKET_CLOSED"` received where `"Allowed · All checks passed"` and `"Refused · Market closed"` were expected.
- `decisions.test.ts › labels a decision ...`: expected `"Allowed · All checks passed"`, received `"ALLOWED · OK"`.
- `ledger-table.test.tsx › filters to 3 allowed and 1 refused`: the row's text holds `REFUSED · MARKET_CLOSED`, not `Refused · Market closed`.
- `ledger-table.test.tsx › shows the verdict and the reason's plain label ...`: `Unable to find an element with the text: Allowed · All checks passed`.
- `ledger-table.test.tsx › shows what the code means in a refused row that has no note`: expected `[""]` to equal `["NYSE is closed for the mandate's session: a weekend, a holiday or after hours."]`.
- `docs-components.test.tsx › ForkLedger has one row ...`: the cell texts are `ALLOWED · OK` and `REFUSED · MARKET_CLOSED`.
- `component-text.test.ts › ForkLedger gives one row ...`: expected an array of length 3, got length 0.

Two of the new tests already pass, because they guard behaviour that must not change: `leaves the note empty in an allowed row that has no note` and `keeps a row's own note over the meaning of its code`. The e2e change runs in Step 4, after a build.

- [ ] **Step 3: Implement**

**3a. `web/content/decisions.ts`**

Replace line 3:

```ts
import type { ReasonCode } from "./reasons";
```

with:

```ts
import { REASON_LABEL, type ReasonCode } from "./reasons";
```

The import stays relative. `lib/docs/content-data.ts` imports this file, and `source.config.ts` loads that one through the fumadocs-mdx bundler, which does not resolve `@/`.

Replace lines 99-101:

```ts
export function decisionLabel(r: DecisionRow): string {
  return `${r.allowed ? "ALLOWED" : "REFUSED"} · ${r.reason}`;
}
```

with:

```ts
/** The verdict, then the plain label of its reason: "Refused · Market closed", "Allowed · All checks passed". */
export function decisionLabel(r: DecisionRow): string {
  return `${r.allowed ? "Allowed" : "Refused"} · ${REASON_LABEL[r.reason]}`;
}
```

**3b. `web/components/LedgerTable.tsx`**

Replace lines 4-5:

```tsx
import { decisionLabel, type DecisionRow, gasLabel, intentLabel } from "@/content/decisions";
import { formatInt } from "@/content/format";
```

with:

```tsx
import { decisionLabel, type DecisionRow, gasLabel, intentLabel } from "@/content/decisions";
import { formatInt } from "@/content/format";
import { REASON_MEANING } from "@/content/reasons";
```

Replace lines 21-23:

```tsx
function rowKey(r: DecisionRow): string {
  return r.txHash ?? `${r.timeLabel}|${intentLabel(r)}`;
}
```

with:

```tsx
function rowKey(r: DecisionRow): string {
  return r.txHash ?? `${r.timeLabel}|${intentLabel(r)}`;
}

/**
 * The row's own note. Rows read from mainnet may carry none; then a refused row shows what its code means and an
 * allowed row shows nothing. The vault sets allowed only with OK, so a refused row's reason is a refusal code; the
 * `!== "OK"` test says so to the compiler, which narrows the reason to RefusalCode, the key type of REASON_MEANING.
 */
function noteOf(r: DecisionRow): string | undefined {
  if (r.note !== undefined) return r.note;
  return !r.allowed && r.reason !== "OK" ? REASON_MEANING[r.reason] : undefined;
}
```

Replace lines 84-93:

```tsx
                  <td className="px-2 py-[18px]">
                    <span
                      className={`inline-block rounded-lg px-2.5 py-1.5 font-mono text-xs font-semibold ${
                        r.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"
                      }`}
                    >
                      {decisionLabel(r)}
                    </span>
                  </td>
                  <td className="px-2 py-[18px] text-sm leading-normal text-ink-2">{r.note}</td>
```

with:

```tsx
                  <td className="px-2 py-[18px]">
                    {/* The code sits beside the badge, as a tag, and wraps under it when the column is narrow. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={`inline-block rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                          r.allowed ? "bg-accent-tint text-accent" : "bg-refuse-tint text-refuse"
                        }`}
                      >
                        {decisionLabel(r)}
                      </span>
                      <code className="font-mono text-[11px] text-ink-2">{r.reason}</code>
                    </div>
                  </td>
                  <td className="px-2 py-[18px] text-sm leading-normal text-ink-2">{noteOf(r)}</td>
```

The badge drops `font-mono` because it now holds words. The mono face stays on the code, the same split `ReasonTag` uses. `text-ink-2` (`#5A6170`) on the card's white is the pair the Time and Note columns already use. Nothing is `aria-hidden`.

**3c. `web/lib/docs/content-data.ts`**

Replace line 4:

```ts
import { REASON_GROUPS, type RefusalCode } from "../../content/reasons";
```

with:

```ts
import { type ReasonCode, REASON_GROUPS, type RefusalCode } from "../../content/reasons";
```

Replace lines 28-31:

```ts
export interface ForkLedgerData {
  readonly caption: string;
  readonly rows: readonly { readonly time: string; readonly intent: string; readonly decision: string; readonly gas: string; readonly note?: string }[];
}
```

with:

```ts
export interface ForkLedgerData {
  readonly caption: string;
  /** decision is decisionLabel(), "Refused · Market closed"; code is the reason code the docs print after it, in brackets. */
  readonly rows: readonly { readonly time: string; readonly intent: string; readonly decision: string; readonly code: ReasonCode; readonly gas: string; readonly note?: string }[];
}
```

Replace line 40:

```ts
      decision: decisionLabel(r),
```

with:

```ts
      decision: decisionLabel(r),
      code: r.reason,
```

**3d. `web/components/docs/content.tsx`**

Replace line 147:

```tsx
            <td><code>{r.decision}</code></td>
```

with:

```tsx
            <td>{r.decision} (<code>{r.code}</code>)</td>
```

**3e. `web/lib/docs/component-text.ts`**

Replace line 295:

```ts
      t.rows.map((r) => [r.time, r.intent, code(r.decision), r.gas, r.note ?? ""]),
```

with:

```ts
      t.rows.map((r) => [r.time, r.intent, `${r.decision} (${code(r.code)})`, r.gas, r.note ?? ""]),
```

**3f. `web/content/docs/get-started/read-a-decision.mdx`**

Replace line 7:

```
lastReviewed: 2026-11-18
```

with:

```
lastReviewed: 2026-11-20
```

The page's last-reviewed date follows its last commit (commit `f7f112d`).

Replace lines 26-27:

```
- **`ALLOWED · OK`.** The intent passed every check for its [action](/docs/help/glossary#action), and the action ran.
- **`REFUSED · <reason>`.** The vault said no, or the action failed inside it. The intent moved no funds, and the [reason](/docs/help/glossary#reason) is on the public record. [Reading a refusal](#reading-a-refusal) explains the reasons.
```

with:

```
- **Allowed · All checks passed (`OK`).** The intent passed every check for its [action](/docs/help/glossary#action), and the action ran.
- **Refused, then the reason.** For example, Refused · Market closed (`MARKET_CLOSED`): a plain label, then the reason's code. The vault said no, or the action failed inside it. The intent moved no funds, and the [reason](/docs/help/glossary#reason) is on the public record. [Reading a refusal](#reading-a-refusal) explains the reasons.
```

Do not put a bare `<label>` placeholder outside inline code. MDX would parse it as a JSX tag.

Replace line 92:

```
| Decision | `allowed` and `reason`, with the reason by name. |
```

with:

```
| Decision | `allowed` as Allowed or Refused, then `reason` as a plain label followed by its code, the name the `Reason` enum gives it. |
```

Replace lines 120-121:

```
- **The first row (BUY [NVDAc](/docs/help/glossary#b20), ALLOWED · OK).** The log has `allowed = true` and `reason = 0`. Its journal line would carry `preview: "OK"` and `gate: "execute"`.
- **The last row (BUY GOOGLc, REFUSED · MARKET_CLOSED).** The log has `allowed = false` and `reason = 6`. Its journal line would carry `preview: "MARKET_CLOSED"` and `gate: "log-refusal"`: the agent sent the refusal on purpose, to put it onchain.
```

with:

```
- **The first row, BUY [NVDAc](/docs/help/glossary#b20): Allowed · All checks passed (`OK`).** The log has `allowed = true` and `reason = 0`. Its journal line would carry `preview: "OK"` and `gate: "execute"`.
- **The last row, BUY GOOGLc: Refused · Market closed (`MARKET_CLOSED`).** The log has `allowed = false` and `reason = 6`. Its journal line would carry `preview: "MARKET_CLOSED"` and `gate: "log-refusal"`: the agent sent the refusal on purpose, to put it onchain.
```

The new lines follow the PR 2 rule for watcher pages: the label comes right before the code, and the code is in brackets. They use only `·`, which is in `ALLOWED_SYMBOLS`, and they add no number.

- [ ] **Step 4: Run the tests and see them pass**

```bash
npx vitest run test/decisions.test.ts test/ledger-table.test.tsx test/docs-components.test.tsx test/component-text.test.ts test/component-text-parity.test.tsx
```

Expected: all five files pass. In the parity file, `ForkLedger has the columns and the cells of the rendered table` passes because both sides read `Refused · Market closed (MARKET_CLOSED)` once the backticks are removed. `ForkLedger ends with the caption of the rendered figure` also passes.

```bash
npx vitest run test/docs-content.test.ts test/docs-frontmatter.test.ts test/remark-component-text.test.ts test/search.test.ts
npm run typecheck
npx vitest run
```

Expected: everything passes, and `tsc` reports no error. This confirms that `r.reason` narrows to `RefusalCode` in `noteOf`, and that the `code: ReasonCode` field compiles.

Check that no copy of the old format is left in `web/`:

```bash
git grep -n -e "REFUSED · " -e "ALLOWED · " -- .
```

Expected: no output. The simulator's `Refused · CONCENTRATION` strings are capitalised differently and belong to the simulator task.

Build, run the ship check, then run the e2e files that cover the ledger and the docs pages that show `ForkLedger`:

```bash
npm run build
npm run check:out
npx playwright test e2e/smoke.spec.ts e2e/docs.spec.ts
```

Expected: `the ledger filters` passes with the new assertions, and the rest of both files passes too.

Look at the result in a browser. Run `npx serve -L -n -l 4173 out`, then open `http://localhost:4173/#ledger` and `http://localhost:4173/docs/get-started/read-a-decision`, at desktop width and at 375 px.
- The badge reads `Refused · Market closed`, with `MARKET_CLOSED` as a small grey mono tag beside it, or under it where the column is narrow.
- The allowed rows read `Allowed · All checks passed` with `OK`.
- The docs table cell reads `Refused · Market closed (MARKET_CLOSED)`, with the code in code style.

Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

Run this in Git Bash, from `web/`:

```bash
git add -- content/decisions.ts components/LedgerTable.tsx lib/docs/content-data.ts components/docs/content.tsx lib/docs/component-text.ts content/docs/get-started/read-a-decision.mdx test/decisions.test.ts test/ledger-table.test.tsx test/docs-components.test.tsx test/component-text.test.ts e2e/smoke.spec.ts
msg=$(mktemp)
cat > "$msg" <<'EOF'
fix(web): show each decision as a plain label with its code beside it

decisionLabel() now reads "Refused · Market closed" or "Allowed · All
checks passed" instead of "REFUSED · MARKET_CLOSED", taking the label
from REASON_LABEL.

The landing ledger's badge shows that label, and the reason code
follows it as a small mono tag. A refused row without a note shows
what its code means (REASON_MEANING); an allowed row without one leaves
the cell empty. Rows read from mainnet may carry no note.

The docs fork ledger cell reads "Refused · Market closed
(MARKET_CLOSED)" in the HTML table and in its Markdown copy, with the
code in code formatting, so the two stay equal. Read a decision quotes
the new format.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "$msg"
rm -f "$msg"
```

---

### Task 4: Hero verdict shows the plain label over the code

The hero's decision engine (`components/DecisionEngine.tsx`) puts the bare reason code (`MARKET_CLOSED`, `OK`) next to "Refused" or "Allowed", and that code is the only explanation a visitor gets. After this task the right-hand column of the verdict box shows a stacked `ReasonTag`. The plain label ("Market closed", or "All checks passed" for the Thu moment) sits over the code, right-aligned, above the outcome line, which does not change. The live region's first child keeps `data-verdict` and then `data-reason`, so `lib/check-out.ts` still finds the Sat 7 Nov verdict in the exported HTML.

**Files:**
- Modify: `web/components/DecisionEngine.tsx:3-6` (imports) and `web/components/DecisionEngine.tsx:97-100` (verdict right column)
- Modify: `web/test/decision-engine.test.tsx:26-30` and `web/test/decision-engine.test.tsx:41-43`
- Modify: `web/e2e/smoke.spec.ts:52-56`, plus a new test inserted after the `});` that closes "the moment toggle works by mouse and keyboard" (line 63 today, line 65 after 1c)
- Test: `web/test/decision-engine.test.tsx`, `web/e2e/smoke.spec.ts` (also run unchanged: `web/test/check-out.test.ts`, `web/test/page.test.tsx`, `web/test/engine.test.ts`, `npm run check:out`)

**Interfaces:**
- Consumes:
  - From Task 2: `import { ReasonTag } from "@/components/ui/ReasonTag";` with `export function ReasonTag({ code, tone = "neutral", layout = "stacked", className }: ReasonTagProps)` (return type inferred), where `ReasonTagProps = { code: ReasonCode; tone?: ReasonTagTone; layout?: ReasonTagLayout; className?: string }`, `ReasonTagTone = "verdict" | "refuse" | "neutral"` and `ReasonTagLayout = "stacked" | "inline"`. It renders `<span data-reason-tag={code}>` with two child elements: the label span (`REASON_LABEL[code]`), then the code in `font-mono text-[11px]`. `stacked` puts the label over the code. `verdict` makes the label `font-semibold` in the box's inherited white and puts the code at `opacity-80`.
  - From Task 1 (indirectly, through `ReasonTag`): `REASON_LABEL.MARKET_CLOSED === "Market closed"` and `REASON_LABEL.OK === "All checks passed"`.
  - Existing: `MOMENTS.sat.reason === "MARKET_CLOSED"` and `MOMENTS.thu.reason === "OK"` (`web/content/engine.ts:74,94`), typed `ReasonCode`.
- Produces: no new exports. DOM contract: inside `#top [role="status"] > div[data-verdict][data-reason]`, the right-hand column holds `[data-reason-tag]` followed directly by the outcome `<span>` (the new e2e test reads `el.nextElementSibling`).

- [ ] **Step 1: Write the failing test**

  Run every command from `web/`.

  1a. `web/test/decision-engine.test.tsx`, first test ("opens on Saturday…"). Replace lines 26-30 as they read today:

  ```ts
      expect(ui.verdict()).toHaveTextContent("Refused");
      expect(ui.verdict()).toHaveTextContent("MARKET_CLOSED");
      expect(ui.verdict()).toHaveTextContent("Decision logged · gas 111,116");
      expect(ui.verdict().firstElementChild).toHaveAttribute("data-verdict", "refused");
      expect(ui.verdict().firstElementChild).toHaveAttribute("data-reason", "MARKET_CLOSED");
  ```

  with:

  ```ts
      // The live region reads, in order: the decision, the plain label, its code, then the outcome (spec 2026-11-20 section 5).
      expect(ui.verdict()).toHaveTextContent(/^VAULT DECISION\s*Refused\s*Market closed\s*MARKET_CLOSED\s*Decision logged · gas 111,116$/);
      expect(ui.verdict().querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
      expect(ui.verdict().firstElementChild).toHaveAttribute("data-verdict", "refused");
      expect(ui.verdict().firstElementChild).toHaveAttribute("data-reason", "MARKET_CLOSED");
      // lib/check-out.ts finds this verdict in the exported HTML by this markup: data-verdict, then data-reason, on the first child.
      expect(ui.verdict().outerHTML).toMatch(/role="status"[^>]*><div[^>]*\sdata-verdict="refused"[^>]*\sdata-reason="MARKET_CLOSED"/);
  ```

  1b. Same file, second test ("Thursday passes all nine and is allowed"). Replace lines 41-43 as they read today:

  ```ts
      expect(ui.verdict()).toHaveTextContent("Allowed");
      expect(ui.verdict()).toHaveTextContent("Swap executed · gas 758,192");
      expect(ui.verdict().firstElementChild).toHaveAttribute("data-verdict", "allowed");
  ```

  with:

  ```ts
      expect(ui.verdict()).toHaveTextContent(/^VAULT DECISION\s*Allowed\s*All checks passed\s*OK\s*Swap executed · gas 758,192$/);
      expect(ui.verdict().querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "OK");
      expect(ui.verdict().firstElementChild).toHaveAttribute("data-verdict", "allowed");
  ```

  No import changes are needed (`render`, `screen` and `within` are already imported on line 1). The other three tests (lines 46-72) assert only "Refused"/"Allowed" and the live region node, so they stay as they are.

  1c. `web/e2e/smoke.spec.ts`, test "the moment toggle works by mouse and keyboard". Replace lines 52-56 as they read today:

  ```ts
    await expect(verdict).toContainText("Refused");
    await expect(verdict).toContainText("MARKET_CLOSED");

    await thu.click();
    await expect(verdict).toContainText("Allowed");
  ```

  with:

  ```ts
    await expect(verdict).toContainText("Refused");
    await expect(verdict).toContainText("Market closed");
    await expect(verdict).toContainText("MARKET_CLOSED");

    await thu.click();
    await expect(verdict).toContainText("Allowed");
    await expect(verdict).toContainText("All checks passed");
  ```

  1d. `web/e2e/smoke.spec.ts`: insert this new test after the `});` that closes "the moment toggle works by mouse and keyboard" (line 65 once 1c is in) and before `test("the ledger filters", …`, with one blank line on each side:

  ```ts
  test("the hero verdict reads the plain label over its code, right-aligned above the outcome line", async ({ page }) => {
    // Reduced motion shows the verdict at its final size at once, so its lines are measured unscaled.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const hero = page.locator("#top");
    const tag = hero.locator('[role="status"] [data-reason-tag]');
    // Where the text of each line ends: the tag's label, its code, then the outcome line under the tag.
    const expectOneRightEdge = async () => {
      const edges = await tag.evaluate((el) =>
        [...el.children, el.nextElementSibling].map((line) => {
          const range = document.createRange();
          range.selectNodeContents(line!);
          return Math.round(range.getBoundingClientRect().right);
        }),
      );
      expect(edges).toHaveLength(3);
      expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
    };

    await expect(tag).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
    await expect(tag).toHaveText(/^Market closed\s*MARKET_CLOSED$/);
    await expectOneRightEdge();

    await hero.getByRole("button", { name: "Thu 5 Nov · 10:30" }).click();
    await expect(tag).toHaveAttribute("data-reason-tag", "OK");
    await expect(tag).toHaveText(/^All checks passed\s*OK$/);
    await expectOneRightEdge();
  });
  ```

  Leave the ledger test (Task 3 already updated it) alone.

- [ ] **Step 2: Run it and see it fail**

  ```bash
  npx vitest run test/decision-engine.test.tsx
  ```

  Expected: `Tests  2 failed | 3 passed (5)`. Both failures are text mismatches from `toHaveTextContent`. The new `outerHTML` assertion passes already: it is a guard for the ship check, not part of the red step.

  ```
  FAIL  test/decision-engine.test.tsx > DecisionEngine > opens on Saturday: refused at check 4, checks 5-9 not reached
  Error: expect(element).toHaveTextContent()
  Expected element to have text content:
    /^VAULT DECISION\s*Refused\s*Market closed\s*MARKET_CLOSED\s*Decision logged · gas 111,116$/
  Received:
    VAULT DECISIONRefusedMARKET_CLOSEDDecision logged · gas 111,116

  FAIL  test/decision-engine.test.tsx > DecisionEngine > Thursday passes all nine and is allowed
  Expected element to have text content:
    /^VAULT DECISION\s*Allowed\s*All checks passed\s*OK\s*Swap executed · gas 758,192$/
  Received:
    VAULT DECISIONAllowedOKSwap executed · gas 758,192
  ```

  The e2e changes need a build and are run in Step 4. Before the change, the new e2e test fails at `toHaveAttribute("data-reason-tag", …)` because no `[data-reason-tag]` element exists.

- [ ] **Step 3: Implement**

  3a. `web/components/DecisionEngine.tsx`, lines 3-6. Replace:

  ```tsx
  import { useState } from "react";
  import { type CheckMark, MOMENT_ORDER, type MomentId, MOMENTS } from "@/content/engine";
  import { FACTS } from "@/content/facts";
  import { formatInt } from "@/content/format";
  ```

  with:

  ```tsx
  import { useState } from "react";
  import { ReasonTag } from "@/components/ui/ReasonTag";
  import { type CheckMark, MOMENT_ORDER, type MomentId, MOMENTS } from "@/content/engine";
  import { FACTS } from "@/content/facts";
  import { formatInt } from "@/content/format";
  ```

  3b. Same file, lines 97-100 (the right-hand column of the verdict box). Replace:

  ```tsx
            <div className="flex flex-col gap-0.5 text-right">
              <span className="font-mono text-[13px] font-semibold">{moment.reason}</span>
              <span className="font-mono text-[11px] opacity-80">{moment.outcome}</span>
            </div>
  ```

  with:

  ```tsx
            <div className="flex flex-col gap-1.5 text-right">
              <ReasonTag code={moment.reason} tone="verdict" layout="stacked" />
              <span className="font-mono text-[11px] opacity-80">{moment.outcome}</span>
            </div>
  ```

  Why `gap-1.5`: the tag's code and the outcome line are now both 11px mono at `opacity-80`. The wider gap keeps the code with its label instead of letting it run into the outcome line. `text-right` stays on the column. The tag is a stretched flex item, and both of its lines inherit the right alignment, as the bare code and the outcome line do today.

  Leave lines 83-92 exactly as they are: the live-region comment; `<div role="status" aria-live="polite" aria-atomic="true" className="mx-3 mb-3">`; and its only child `<div key={`verdict-${state.run}`} data-verdict={…} data-reason={moment.reason} className={…}>`, with `data-verdict` before `data-reason`. Leave the left column (lines 93-96) unchanged too.

  After the change, the live region (`aria-atomic="true"`) reads in this order. Sat: "VAULT DECISION, Refused, Market closed, MARKET_CLOSED, Decision logged · gas 111,116". Thu: "VAULT DECISION, Allowed, All checks passed, OK, Swap executed · gas 758,192". Nothing is `aria-hidden`. The code stays in the announcement after its label, as the spec requires (section 4).

- [ ] **Step 4: Run the tests and see them pass**

  ```bash
  npx vitest run test/decision-engine.test.tsx test/check-out.test.ts test/page.test.tsx test/engine.test.ts
  ```

  Expected: all four files pass. `decision-engine` passes 5 of 5. `check-out.test.ts` uses its own synthetic HTML (lines 18-36) and is unchanged. `page.test.tsx` renders the whole landing page, including the hero. `engine.test.ts` compares `MOMENTS` values (`"MARKET_CLOSED"`, `"OK"`) and is unchanged.

  ```bash
  npm run typecheck
  npx vitest run
  ```

  Expected: no type errors (this also type-checks `e2e/smoke.spec.ts`, which `tsconfig.json` includes), and the whole unit suite passes.

  ```bash
  npm run build
  npm run check:out
  ```

  Expected: `check:out` prints `out/ is ready to deploy (...)`. It reports no `the Sat 7 Nov verdict (refused · MARKET_CLOSED) is not in the exported HTML`, which shows that `checkExport` (`lib/check-out.ts:32-35`) still finds `role="status"`, then `<div … data-verdict="refused" … data-reason="MARKET_CLOSED"`.

  ```bash
  npx playwright test e2e/smoke.spec.ts -g "fits|moment toggle|hero verdict|reduced motion"
  ```

  Expected: 8 passed. These are the 5 "fits" widths, "the moment toggle works by mouse and keyboard", the new "the hero verdict reads the plain label over its code…" and "reduced motion shows the final state at once", which still counts 10 elements because the status still has exactly one direct child. Then run the whole file, `npx playwright test e2e/smoke.spec.ts`: every test passes.

  Open `test-results/screens/landing-360.png` and `test-results/screens/landing-1440.png`. On the dark verdict box, check that **Market closed** sits over `MARKET_CLOSED`, aligned right above `Decision logged · gas 111,116`, with nothing clipped. Then run `npm run dev`, open `/`, click "Thu 5 Nov · 10:30" at desktop width and at 375 px, and check that **All checks passed** sits over `OK` on the blue box, aligned right.

- [ ] **Step 5: Commit**

  ```bash
  git add -- components/DecisionEngine.tsx test/decision-engine.test.tsx e2e/smoke.spec.ts
  cat > "${TMPDIR:-/tmp}/task-4-commit.txt" <<'EOF'
  fix(web): show the plain label over the code in the hero verdict

  The decision engine's verdict box showed the bare reason code
  (MARKET_CLOSED, OK) as the only words beside Refused or Allowed. It now
  renders a stacked ReasonTag: the plain label (Market closed, All checks
  passed) over the code, right-aligned above the outcome line, which is
  unchanged.

  The live region's first child keeps data-verdict and then data-reason,
  so lib/check-out.ts still finds the Sat 7 Nov verdict in the exported
  HTML; the unit test now guards that markup. The unit test pins the live
  region's text in reading order, and a new smoke test checks that the
  label, the code and the outcome line end at the same right edge.

  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  EOF
  git commit -F "${TMPDIR:-/tmp}/task-4-commit.txt"
  ```

---

### Task 5: Plain labels in the Problem, Refusals and How it works sections

Spec: `docs/superpowers/specs/2026-11-20-readable-refusals-design.md`, section 5, rows "The problem, three cards", "Refusals, 19 codes" and "How it works, decoded event". All paths below are relative to the repository root. Run `npx` and `npm` commands from `web/`.

**Files:**
- Modify: `web/components/sections/Problem.tsx:4` (import), `web/components/sections/Problem.tsx:19-22` (card badge)
- Modify: `web/components/sections/Refusals.tsx:1-4` (imports and a new constant), `web/components/sections/Refusals.tsx:28-34` (item title)
- Modify: `web/components/sections/HowItWorks.tsx:5` (import), `web/components/sections/HowItWorks.tsx:37` and `:42` (decoded rows), `web/components/sections/HowItWorks.tsx:80` (dd)
- Test: `web/test/page.test.tsx:4` and `:34-43`
- Test: `web/test/problem-how.test.tsx:43-53` and `:101-104`
- Test: `web/e2e/smoke.spec.ts`: add one test after the `});` that closes `test("the ledger filters", …)`, which Tasks 3 and 4 have moved

**Interfaces:**
- Consumes:
  - From Task 1, `web/content/reasons.ts`: `export const REASON_LABEL: Readonly<Record<ReasonCode, string>>`. The values used here are `MARKET_CLOSED: "Market closed"`, `PREMIUM_TOO_HIGH: "Pool price too far from oracle"` and `MULTIPLIER_COOLDOWN: "Corporate action cooldown"`. `page.test.tsx` reads `REASON_MEANING`, so it also picks up Task 1's new `REASON_MEANING.CONCENTRATION`.
  - From Task 2, `web/components/ui/ReasonTag.tsx`: `export function ReasonTag({ code, tone = "neutral", layout = "stacked", className }: ReasonTagProps)` (return type inferred), where `ReasonTagProps = { code: ReasonCode; tone?: ReasonTagTone; layout?: ReasonTagLayout; className?: string }`, `ReasonTagTone = "verdict" | "refuse" | "neutral"` and `ReasonTagLayout = "stacked" | "inline"`. The inline layout's root is `inline-flex flex-wrap items-baseline gap-x-1.5`. It renders `<span data-reason-tag={code}>`, whose first element child is the label span (`REASON_LABEL[code]`) and whose last element child is the code span (`font-mono text-[11px]`). Tone `refuse` puts `text-refuse` on both spans. Tone `neutral` puts `text-ink` on the label and `text-ink-2` on the code.
- Produces: no new exports. Later tasks do not depend on anything in this task. The local row type in `HowItWorks.tsx` gains an optional `note?: string`.

- [ ] **Step 1: Write the failing test**

**1a. `web/test/page.test.tsx`.** Line 4: replace

```tsx
import { REASON_MEANING, REASONS, type RefusalCode } from "@/content/reasons";
```

with

```tsx
import { REASON_LABEL, REASON_MEANING, REASONS, type RefusalCode } from "@/content/reasons";
```

Lines 34-43: replace

```tsx
  it("lists all nineteen refusals once and highlights only MARKET_CLOSED", () => {
    const c = setup();
    const section = c.querySelector("#reasons") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Nineteen typed ways to say no.");
    const items = [...section.querySelectorAll<HTMLElement>("li[data-code]")];
    expect(items.map((li) => li.dataset.code).sort()).toEqual([...REASONS].sort());
    // Each code is followed by its plain-English meaning.
    for (const li of items) expect(li).toHaveTextContent(`${li.dataset.code}${REASON_MEANING[li.dataset.code as RefusalCode]}`);
    expect([...section.querySelectorAll<HTMLElement>("li[data-hot]")].map((li) => li.dataset.code)).toEqual(["MARKET_CLOSED"]);
  });
```

with

```tsx
  it("lists all nineteen refusals once, each titled by its plain label, and highlights only MARKET_CLOSED", () => {
    const c = setup();
    const section = c.querySelector("#reasons") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Nineteen typed ways to say no.");
    const items = [...section.querySelectorAll<HTMLElement>("li[data-code]")];
    expect(items.map((li) => li.dataset.code).sort()).toEqual([...REASONS].sort());
    // Each item reads its plain label first, then its code as a tag, then the plain-English meaning.
    for (const li of items) {
      const code = li.dataset.code as RefusalCode;
      expect(li.children).toHaveLength(2);
      const [tag, meaning] = [...li.children];
      expect(tag).toHaveAttribute("data-reason-tag", code);
      expect(tag!.firstElementChild!.textContent).toBe(REASON_LABEL[code]);
      expect(tag!.lastElementChild!.textContent).toBe(code);
      expect(meaning!.textContent).toBe(REASON_MEANING[code]);
    }
    expect([...section.querySelectorAll<HTMLElement>("li[data-hot]")].map((li) => li.dataset.code)).toEqual(["MARKET_CLOSED"]);
  });
```

**1b. `web/test/problem-how.test.tsx`, the Problem test.** Lines 43-53: replace

```tsx
  it("shows the three traps with their refusal codes and fact-backed numbers", () => {
    render(<Problem />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Tokenized stocks trade 24/7. Their prices don't.");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "The price feed sleeps every weekend.",
      "The pool can drift from fair value.",
      "A split quietly changes the math.",
    ]);
    for (const code of ["MARKET_CLOSED", "PREMIUM_TOO_HIGH", "MULTIPLIER_COOLDOWN"]) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
```

with

```tsx
  it("shows the three traps, each named in plain words over its refusal code, with fact-backed numbers", () => {
    const { container } = render(<Problem />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Tokenized stocks trade 24/7. Their prices don't.");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "The price feed sleeps every weekend.",
      "The pool can drift from fair value.",
      "A split quietly changes the math.",
    ]);
    // Each card's badge: the plain label over the code, both in the refuse colour.
    const badges = [...container.querySelectorAll("article [data-reason-tag]")];
    expect(badges.map((b) => [b.firstElementChild?.textContent, b.lastElementChild?.textContent])).toEqual([
      ["Market closed", "MARKET_CLOSED"],
      ["Pool price too far from oracle", "PREMIUM_TOO_HIGH"],
      ["Corporate action cooldown", "MULTIPLIER_COOLDOWN"],
    ]);
    for (const b of badges) {
      expect(b.firstElementChild).toHaveClass("text-refuse");
      expect(b.lastElementChild).toHaveClass("text-refuse");
    }
```

Lines 54-58, which check `1.000537939576369481`, `24h pause` and the two body texts, stay as they are.

**1c. `web/test/problem-how.test.tsx`, the HowItWorks test.** Line 101: replace

```tsx
      ["reason", "MARKET_CLOSED"],
```

with

```tsx
      ["reason", "MARKET_CLOSED // Market closed"],
```

Line 104: replace

```tsx
    expect(within(decoded).getByText(/Base Builder Code \(ERC-8021\)/)).toBeInTheDocument();
```

with

```tsx
    // The value stays the decoded code; its plain label follows as a muted comment.
    expect(within(decoded).getByText("// Market closed")).toHaveClass("text-ink-2");
    expect(within(decoded).getByText(/Base Builder Code \(ERC-8021\)/)).toBeInTheDocument();
```

**1d. `web/e2e/smoke.spec.ts`.** jsdom loads no Tailwind CSS, so this browser test checks the filled highlight. Insert it after the `});` that closes `test("the ledger filters", …)`, which Tasks 3 and 4 have moved, with one blank line before it:

```ts

test("the Refusals section fills only the recorded refusal's label in red", async ({ page }) => {
  await page.goto("/");
  const hot = page.locator('#reasons li[data-hot] [data-reason-tag="MARKET_CLOSED"]');
  const label = hot.locator("> :first-child");
  await expect(label).toHaveText("Market closed");
  // --color-refuse #C2410C, white text on it.
  await expect(label).toHaveCSS("background-color", "rgb(194, 65, 12)");
  await expect(label).toHaveCSS("color", "rgb(255, 255, 255)");
  // The code beside it stays a muted tag: --color-ink-2 #5A6170, nothing filled.
  await expect(hot.locator("> :last-child")).toHaveCSS("color", "rgb(90, 97, 112)");
  await expect(hot.locator("> :last-child")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // Any other refusal's label has no fill.
  await expect(page.locator('#reasons li[data-code="FEED_STALE"] [data-reason-tag] > :first-child')).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
});
```

- [ ] **Step 2: Run it and see it fail**

From `web/`:

```bash
npx vitest run test/page.test.tsx test/problem-how.test.tsx
```

You should see three failures:
- `landing page > lists all nineteen refusals once, each titled by its plain label, …`: `expect(element).toHaveAttribute("data-reason-tag", "MARKET_CLOSED")` fails. The first `li` still holds the old code pill span, which has no `data-reason-tag`.
- `Problem > shows the three traps, …`: `expected [] to deeply equal [ [ 'Market closed', 'MARKET_CLOSED' ], … ]`. No badge has `data-reason-tag` yet.
- `HowItWorks > walks the four steps …`: the `pairs` `toEqual` fails because it gets `["reason", "MARKET_CLOSED"]` where the test expects `["reason", "MARKET_CLOSED // Market closed"]`.

All other tests in the two files pass. The e2e test runs against the static export and is checked after the build in Step 4.

- [ ] **Step 3: Implement**

**3a. `web/components/sections/Problem.tsx`.** Line 4: replace

```tsx
import { SectionHeading } from "@/components/ui/SectionHeading";
```

with

```tsx
import { ReasonTag } from "@/components/ui/ReasonTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
```

Lines 19-22: replace

```tsx
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs text-ink-2">{tag}</span>
        <span className="font-mono text-[11px] text-refuse">{code}</span>
      </div>
```

with

```tsx
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-xs text-ink-2">{tag}</span>
        {/* The trap's plain label in the refuse colour, its code under it, both right-aligned. */}
        <ReasonTag code={code} tone="refuse" layout="stacked" className="items-end text-right text-sm font-medium" />
      </div>
```

The badge now has two lines. `items-baseline` lines the tag up with the label's first line, as the Refusals group headers already do. The rest of the card does not change. The three `code=` props (lines 45, 53 and 61) and `CardProps.code: RefusalCode` also stay as they are: `RefusalCode` can be passed where `ReasonCode` is expected.

**3b. `web/components/sections/Refusals.tsx`.** Lines 1-4: replace

```tsx
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { HIGHLIGHT_REASON, REASON_GROUPS, REASON_MEANING } from "@/content/reasons";
```

with

```tsx
import { ReasonTag } from "@/components/ui/ReasonTag";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { numberWord } from "@/content/format";
import { HIGHLIGHT_REASON, REASON_GROUPS, REASON_MEANING } from "@/content/reasons";

/**
 * The fork run's refusal keeps its filled red highlight, now on its label. ReasonTag renders the label as its first
 * child and the code as its last, so these child selectors fill the label only and leave the code a muted tag.
 */
const HOT_LABEL =
  "[&>:first-child]:rounded-md [&>:first-child]:bg-refuse [&>:first-child]:px-2 [&>:first-child]:py-[3px] [&>:first-child]:text-white";
```

Lines 28-34: replace

```tsx
                    <span
                      className={`rounded-md px-2 py-[5px] font-mono text-[11px] ${
                        hot ? "bg-refuse text-white" : "border border-line bg-surface-soft text-ink-body"
                      }`}
                    >
                      {code}
                    </span>
```

with

```tsx
                    <ReasonTag
                      code={code}
                      tone="neutral"
                      layout="inline"
                      className={hot ? `text-sm font-medium ${HOT_LABEL}` : "text-sm font-medium"}
                    />
```

The `li` on line 27 (`data-code`, `data-hot`, `flex flex-col items-start gap-1`) and the `REASON_MEANING` span on line 35 do not change. ReasonTag's inline layout wraps, so at 360 px the code drops under a long label such as "Pool price too far from oracle". The `[&>:first-child]:…` selectors have specificity (0,2,0), so they override the neutral tone's `text-ink` on the label whatever the order of the CSS. `web/app/globals.css` already scans `components/sections` and `components/ui`, so Tailwind generates these classes.

**3c. `web/components/sections/HowItWorks.tsx`.** Line 5: replace

```tsx
import { numberWord } from "@/content/format";
```

with

```tsx
import { numberWord } from "@/content/format";
import { REASON_LABEL } from "@/content/reasons";
```

Line 37: replace

```tsx
  const decoded: readonly { k: string; v: string; tone?: "hot" | "muted" }[] = [
```

with

```tsx
  const decoded: readonly { k: string; v: string; tone?: "hot" | "muted"; note?: string }[] = [
```

Line 42: replace

```tsx
    { k: "reason", v: refused.reason, tone: "hot" },
```

with

```tsx
    // The card shows the decoded log, so the value stays the code; its plain label follows as a comment.
    { k: "reason", v: refused.reason, tone: "hot", note: REASON_LABEL[refused.reason] },
```

Line 80: replace

```tsx
                  <dd className={`m-0 [overflow-wrap:anywhere] ${d.tone ? toneClass[d.tone] : ""}`}>{d.v}</dd>
```

with

```tsx
                  <dd className={`m-0 [overflow-wrap:anywhere] ${d.tone ? toneClass[d.tone] : ""}`}>
                    {d.v}
                    {d.note ? <span className="font-normal text-ink-2">{` // ${d.note}`}</span> : null}
                  </dd>
```

The leading space inside the template string puts a real space between the code and `//`. The dd text is then `MARKET_CLOSED // Market closed`, and a narrow card can wrap at that space. `font-normal text-ink-2` overrides the inherited `font-semibold text-refuse` of the hot tone. The `Reason  reason,` line in `CodePanel` does not change.

- [ ] **Step 4: Run the tests and see them pass**

From `web/`:

```bash
npx vitest run test/page.test.tsx test/problem-how.test.tsx
```

Expected: both files pass, 15 tests.

The full unit suite and the typecheck catch any other pin on these sections. A search of `web/test` and `web/e2e` found none besides the two files above. `test/top.test.tsx` only reads the `#reasons` nav link.

```bash
npx vitest run
npm run typecheck
```

Expected: all green.

Build the static export, run the ship check, then run the fit checks and the new highlight test. The `fits …px` tests fail if a `.card` in these sections overflows at 360, 768, 1024, 1440 or 1920 px.

```bash
npm run build
npm run check:out
npx playwright test e2e/smoke.spec.ts -g "fits|Refusals"
```

Expected: 6 passed (five `fits` widths and the Refusals highlight test). Open `web/test-results/screens/landing-360.png` and `landing-1440.png`, which the `fits` tests write, and check three things:
- each Problem card shows its label in the refuse colour, right-aligned over its code;
- each Refusals item shows its label with a muted code beside it (or under it, when narrow), and only "Market closed" sits in a red pill;
- the decoded card reads `MARKET_CLOSED // Market closed`, with the comment in grey.

- [ ] **Step 5: Commit**

From the repository root:

```bash
msg="$(mktemp)"
cat > "$msg" <<'EOF'
fix(web): name refusals in plain words in the problem, refusals and decoded cards

The landing showed raw reason codes as the only words a visitor reads.
Each problem card's badge now shows the plain label in the refuse colour
with the code under it. Each of the nineteen Refusals items is titled by
its label, with the code as a muted tag beside it and the meaning below;
the Saturday refusal keeps its red highlight, now on "Market closed".
The How it works decoded card keeps the decoded value MARKET_CLOSED and
adds a muted "// Market closed" after it.

data-code, data-hot and the code strings are unchanged. Unit tests pin
the label, code and meaning order, and a smoke test checks in the browser
that only the highlighted label is filled.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git add -- web/components/sections/Problem.tsx web/components/sections/Refusals.tsx web/components/sections/HowItWorks.tsx web/test/page.test.tsx web/test/problem-how.test.tsx web/e2e/smoke.spec.ts
git commit -F "$msg"
rm -f "$msg"
```

---

### Task 6: Simulator. Plain labels in the verdict box, the tape, the Execute notice and the Post on X text

The simulator (`web/components/Simulator.tsx`, the landing page's `#try` section) shows the vault's refusal codes on their own: the verdict box puts `CONCENTRATION` beside **Refused**, the tape reads `Refused · CONCENTRATION`, the Execute notice reads `…: Refused · CONCENTRATION` and the Post on X text ends `said no: MARKET_CLOSED.` After this task:

- the verdict box shows a stacked `ReasonTag` (tone `verdict`) beside **Refused** / **Allowed** where the bare code was. An allowed verdict reads **All checks passed** over `OK`. The meaning line under it stays as it is.
- refused tape rows read `Refused · Too much in one stock`, with the code as an inline tag after it. Allowed rows still read `Allowed`, with no tag.
- the Execute notice reads `Executed 10:30 BUY NVDAc · $50: Refused · Too much in one stock (CONCENTRATION)` (via `reasonText`).
- the Post on X text reads `… Maat's simulator said no: Market closed (MARKET_CLOSED).` (via `reasonText`).

Do not change:
- the `data-verdict` / `data-reason` div. It stays the first child of `role="status"`, with `data-verdict` before `data-reason`. `lib/check-out.ts` reads it with a regex.
- the share link's query (`encodeScenario`).
- `data-allowed` on tape rows.

All commands run from `web/` (`E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals/web`).

**Files:**
- Modify: `web/components/Simulator.tsx:3-8` (imports), `web/components/Simulator.tsx:178-180` (Execute notice), `web/components/Simulator.tsx:360-366` (verdict box), `web/components/Simulator.tsx:435-437` (tape row)
- Modify: `web/content/simulator.ts:20` (import), `web/content/simulator.ts:400` (`postText`)
- Test: `web/test/simulator.test.ts:257-266`
- Test: `web/test/simulator.test.tsx:9-20, 36-44, 46-52, 60-65, 83, 199`
- Test: `web/e2e/simulator.spec.ts:28, 37, 59, 107, 114`

**Interfaces:**
- Consumes:
  - From Task 1 (`web/content/reasons.ts`): `export function reasonText(code: ReasonCode): string`, which returns e.g. `"Market closed (MARKET_CLOSED)"`. The `REASON_LABEL` values this task's tests spell out: `OK: "All checks passed"`, `MARKET_CLOSED: "Market closed"`, `CONCENTRATION: "Too much in one stock"`, `TOKEN_NOT_ALLOWED: "Token not allowed"`.
  - From Task 2 (`web/components/ui/ReasonTag.tsx`): `export function ReasonTag({ code, tone = "neutral", layout = "stacked", className }: ReasonTagProps)` (return type inferred), with `ReasonTagProps = { code: ReasonCode; tone?: ReasonTagTone; layout?: ReasonTagLayout; className?: string }`, `ReasonTagTone = "verdict" | "refuse" | "neutral"` and `ReasonTagLayout = "stacked" | "inline"`. It renders `<span data-reason-tag={code}>`, which contains the label span (`REASON_LABEL[code]`) and then the code span (`font-mono text-[11px]`). Nothing in it is aria-hidden.
- Produces: no new exports. The DOM that later checks and screenshots rely on:
  - the verdict box (first child of `#try [role="status"]`) contains one `[data-reason-tag="<code>"]`.
  - each refused tape row (`li[data-allowed="false"]` in the list named "Today's decisions") contains one `[data-reason-tag="<code>"]`.
  - the README task that retakes `docs/assets/readme/simulator-size-limit.png` captures this text.

- [ ] **Step 1: Write the failing test**

Edit `web/test/simulator.test.ts`, test "writes the post for a refusal and for a yes" (describe "simulator: presets and copy"), lines 257-266.

Replace:
```ts
    const sat = { ...DEFAULT_SCENARIO, etDay: day("2026-11-07"), intent: buy("NVDAc", 50) };
    expect(postText(sat, evaluate(replay(sat.etDay, []), sat.intent))).toBe(
      "I tried to buy $50 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: MARKET_CLOSED.",
    );
    expect(postText(DEFAULT_SCENARIO, { allowed: true, reason: "OK" })).toBe(
      "I asked Maat's simulator to buy $20 of NVDAc on Thu 5 Nov at 10:30 ET. All nine checks passed. Can you make it say no?",
    );
    expect(postText({ ...DEFAULT_SCENARIO, intent: buy("OTHER", 5) }, { allowed: false, reason: "TOKEN_NOT_ALLOWED" })).toContain(
      "$5 of a token outside the mandate",
    );
```
with:
```ts
    const sat = { ...DEFAULT_SCENARIO, etDay: day("2026-11-07"), intent: buy("NVDAc", 50) };
    expect(postText(sat, evaluate(replay(sat.etDay, []), sat.intent))).toBe(
      "I tried to buy $50 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: Market closed (MARKET_CLOSED).",
    );
    expect(postText(DEFAULT_SCENARIO, { allowed: true, reason: "OK" })).toBe(
      "I asked Maat's simulator to buy $20 of NVDAc on Thu 5 Nov at 10:30 ET. All nine checks passed. Can you make it say no?",
    );
    expect(postText({ ...DEFAULT_SCENARIO, intent: buy("OTHER", 5) }, { allowed: false, reason: "TOKEN_NOT_ALLOWED" })).toBe(
      "I tried to buy $5 of a token outside the mandate on Thu 5 Nov at 10:30 ET. Maat's simulator said no: Token not allowed (TOKEN_NOT_ALLOWED).",
    );
```
(`buy("OTHER", 5)` uses the helper's default time `"10:30"`, and `DEFAULT_SCENARIO.etDay` is Thu 5 Nov, as the allowed case on the line above shows.)

Edit `web/test/simulator.test.tsx`.

(a) `setup()`, lines 9-13. Replace:
```ts
  const verdict = () => screen.getByRole("status").firstElementChild as HTMLElement;
  return {
    user,
    verdict,
    reason: () => verdict().getAttribute("data-reason"),
```
with:
```ts
  const verdict = () => screen.getByRole("status").firstElementChild as HTMLElement;
  return {
    user,
    verdict,
    reason: () => verdict().getAttribute("data-reason"),
    // The plain label over its code, inside the verdict box.
    tag: () => verdict().querySelector<HTMLElement>("[data-reason-tag]"),
```

(b) "opens on a yes: the fork's BUY at the fork moment", lines 40-41. Replace:
```ts
    expect(screen.getByRole("status")).toHaveTextContent("It says yes. Change one thing to make it say no.");
    expect(ui.button("NVDAc")).toHaveAttribute("aria-pressed", "true");
```
with:
```ts
    expect(screen.getByRole("status")).toHaveTextContent("It says yes. Change one thing to make it say no.");
    expect(ui.tag()).toHaveAttribute("data-reason-tag", "OK");
    expect(ui.tag()?.textContent).toMatch(/^All checks passed\s*OK$/);
    // The live region reads, in order: the verdict, the plain label, its code, then the meaning line (Review Focus 3).
    expect(screen.getByRole("status")).toHaveTextContent(
      /^IF EXECUTED NOW · SIMULATED\s*Allowed\s*All checks passed\s*OK\s*It says yes\. Change one thing to make it say no\.$/,
    );
    expect(ui.button("NVDAc")).toHaveAttribute("aria-pressed", "true");
```

(c) "says no on Saturday, and explains the code", lines 46-52. Replace:
```ts
  it("says no on Saturday, and explains the code", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(ui.marks()).toEqual(["PASS", "PASS", "PASS", "FAIL", ...Array(5).fill("SKIP")]);
    expect(screen.getByRole("status")).toHaveTextContent("NYSE is closed for the mandate's session");
  });
```
with:
```ts
  it("says no on Saturday, names the rule over its code, and explains it", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(ui.marks()).toEqual(["PASS", "PASS", "PASS", "FAIL", ...Array(5).fill("SKIP")]);
    expect(screen.getByRole("status")).toHaveTextContent("Refused");
    expect(ui.tag()).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
    expect(ui.tag()?.textContent).toMatch(/^Market closed\s*MARKET_CLOSED$/);
    expect(screen.getByRole("status")).toHaveTextContent("NYSE is closed for the mandate's session");
    // The live region reads, in order: the verdict, the plain label, its code, then the meaning line (Review Focus 3).
    expect(screen.getByRole("status")).toHaveTextContent(
      /^IF EXECUTED NOW · SIMULATED\s*Refused\s*Market closed\s*MARKET_CLOSED\s*NYSE is closed for the mandate's session: a weekend, a holiday or after hours\.$/,
    );
  });
```

The two ordered checks come after the `ui.tag()` checks, so Step 2's failure for each test is still the `null` tag. `toHaveTextContent` collapses whitespace, and the anchored regex fails on any stray character between the parts. The status region holds only the verdict box, so nothing else reads before or after it.

(d) "refuses the second $50 of NVDAc in a day, then resets the day", lines 60-65. Replace:
```ts
    const tape = ui.tape();
    if (!tape) throw new Error("no tape");
    expect(within(tape).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "10:30 BUY NVDAc · $50Allowed",
      "10:30 BUY NVDAc · $50Refused · CONCENTRATION",
    ]);
```
with:
```ts
    const tape = ui.tape();
    if (!tape) throw new Error("no tape");
    const rows = within(tape).getAllByRole("listitem");
    // \s* leaves the gap between the label and the code to ReasonTag's inline layout.
    expect(rows.map((li) => li.textContent)).toEqual([
      "10:30 BUY NVDAc · $50Allowed",
      expect.stringMatching(/^10:30 BUY NVDAc · \$50Refused · Too much in one stock\s*CONCENTRATION$/),
    ]);
    expect(rows[0]?.querySelector("[data-reason-tag]")).toBeNull();
    expect(rows[1]?.querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "CONCENTRATION");
```

(e) "says what an Execute did, while the verdict previews the next one", line 83. Replace:
```ts
    expect(notice).toHaveTextContent("Executed 10:30 BUY NVDAc · $50: Refused · CONCENTRATION");
```
with:
```ts
    expect(notice).toHaveTextContent("Executed 10:30 BUY NVDAc · $50: Refused · Too much in one stock (CONCENTRATION)");
```

(f) "prefills a post on X with the verdict and the link", line 199. Replace:
```ts
    expect(url.searchParams.get("text")).toBe("I tried to buy $20 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: MARKET_CLOSED.");
```
with:
```ts
    expect(url.searchParams.get("text")).toBe(
      "I tried to buy $20 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: Market closed (MARKET_CLOSED).",
    );
```
Line 200, the `url` parameter (`http://localhost:3000/?day=2026-11-07&at=1030&buy=NVDAc-20#try`), stays as it is: the share link must not change. This test is Review Focus 2's check: `searchParams.get` decodes the `text` parameter of the X intent href the simulator builds from `postText`, and the result must equal the post text exactly, brackets included.

Edit `web/e2e/simulator.spec.ts`.

(g) Line 28. Replace:
```ts
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.checks.nth(3)).toHaveAttribute("data-mark", "FAIL");

  await ui.button("Thu 5 Nov · 10:30").click();
```
with:
```ts
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.verdict.locator('[data-reason-tag="MARKET_CLOSED"]')).toContainText("Market closed");
  await expect(ui.checks.nth(3)).toHaveAttribute("data-mark", "FAIL");

  await ui.button("Thu 5 Nov · 10:30").click();
```

(h) Line 37. Replace:
```ts
  await expect(ui.tape.nth(1)).toContainText("Refused · CONCENTRATION");
```
with:
```ts
  await expect(ui.tape.nth(1)).toContainText("Refused · Too much in one stock");
  await expect(ui.tape.nth(1).locator('[data-reason-tag="CONCENTRATION"]')).toContainText("CONCENTRATION");
```

(i) Line 59. Replace:
```ts
  expect(post.searchParams.get("text")).toBe("I tried to buy $10 of GOOGLc on Thu 26 Nov at 10:30 ET. Maat's simulator said no: MARKET_CLOSED.");
```
with:
```ts
  expect(post.searchParams.get("text")).toBe(
    "I tried to buy $10 of GOOGLc on Thu 26 Nov at 10:30 ET. Maat's simulator said no: Market closed (MARKET_CLOSED).",
  );
```
Line 60, the `url` parameter, stays as it is.

(j) Line 107. Replace:
```ts
    await expect(ui.root.getByText("Executed 10:30 BUY Other token · $999,999,999.99: Refused · TOKEN_NOT_ALLOWED")).toBeVisible();
```
with:
```ts
    await expect(
      ui.root.getByText("Executed 10:30 BUY Other token · $999,999,999.99: Refused · Token not allowed (TOKEN_NOT_ALLOWED)"),
    ).toBeVisible();
```
The comment on line 104, "The longest Execute notice: the longest token label, amount and reason that go together.", is still true. In this monospace text, "Other token" (11 characters) plus "Token not allowed (TOKEN_NOT_ALLOWED)" (37) is 48. The next longest pair is "GOOGLc" (6) plus "Not enough funds (INSUFFICIENT_BALANCE)" (39), which is 45. The simulator returns no other code that is longer.

(k) Line 114. Replace:
```ts
    await expect(ui.tape.first()).toContainText("Refused · TOKEN_NOT_ALLOWED");
```
with:
```ts
    await expect(ui.tape.first()).toContainText("Refused · Token not allowed");
    await expect(ui.tape.first().locator('[data-reason-tag="TOKEN_NOT_ALLOWED"]')).toContainText("TOKEN_NOT_ALLOWED");
```

These tests stay unchanged on purpose:
- every `ui.reason()` / `toHaveAttribute("data-reason", …)` assertion and every `r.reason` / `e.reason` comparison.
- `test/check-out.test.ts`, which uses synthetic HTML.
- `test/page.test.tsx`, which has no assertion on simulator verdict text.
- `e2e/smoke.spec.ts`, which reads the hero's verdict, not the simulator's.

- [ ] **Step 2: Run it and see it fail**

```
npx vitest run test/simulator.test.ts test/simulator.test.tsx
```
Expected: 6 failures (the other tests in both files pass):
- `simulator.test.ts` › simulator: presets and copy › writes the post for a refusal and for a yes. `AssertionError: expected 'I tried to buy $50 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: MARKET_CLOSED.' to be '… said no: Market closed (MARKET_CLOSED).'`
- `simulator.test.tsx` › Simulator › opens on a yes: the fork's BUY at the fork moment. `toHaveAttribute` fails with "received value must be an HTMLElement or an SVGElement. Received has value: null", because the verdict box has no `[data-reason-tag]` yet.
- `simulator.test.tsx` › Simulator › says no on Saturday, names the rule over its code, and explains it. The same null error.
- `simulator.test.tsx` › Simulator › refuses the second $50 of NVDAc in a day, then resets the day. `toEqual` receives `"10:30 BUY NVDAc · $50Refused · CONCENTRATION"` for the second row.
- `simulator.test.tsx` › Simulator › says what an Execute did, while the verdict previews the next one. The notice holds `Executed 10:30 BUY NVDAc · $50: Refused · CONCENTRATION`.
- `simulator.test.tsx` › Simulator › prefills a post on X with the verdict and the link. `text` ends `said no: MARKET_CLOSED.`

The e2e edits are checked in Step 4. They need a fresh `npm run build`.

- [ ] **Step 3: Implement**

`web/components/Simulator.tsx`

(1) Imports, lines 3-4. Replace:
```tsx
import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { isoOfDay, localTime, parseIsoDay, sessionWindow, WINDOW } from "@/content/calendar";
```
with:
```tsx
import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { isoOfDay, localTime, parseIsoDay, sessionWindow, WINDOW } from "@/content/calendar";
```

(2) Imports, line 8. Replace:
```tsx
import { REASON_MEANING } from "@/content/reasons";
```
with:
```tsx
import { REASON_MEANING, reasonText } from "@/content/reasons";
```

(3) Execute notice, lines 178-180, inside `run`. Replace:
```tsx
    setNotice(
      `Executed ${clockLabel(s.intent.minute)} ${simIntentLabel(s.intent)}: ${result.allowed ? "Allowed" : `Refused · ${result.reason}`}`,
    );
```
with:
```tsx
    setNotice(
      `Executed ${clockLabel(s.intent.minute)} ${simIntentLabel(s.intent)}: ${result.allowed ? "Allowed" : `Refused · ${reasonText(result.reason)}`}`,
    );
```

(4) Verdict box, lines 360-366. Replace:
```tsx
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px] opacity-80">IF EXECUTED NOW · SIMULATED</span>
                <span className="text-[26px] font-semibold tracking-[-0.03em]">{result.allowed ? "Allowed" : "Refused"}</span>
              </div>
              <span className="font-mono text-[13px] font-semibold [overflow-wrap:anywhere]">{result.reason}</span>
            </div>
```
with:
```tsx
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px] opacity-80">IF EXECUTED NOW · SIMULATED</span>
                <span className="text-[26px] font-semibold tracking-[-0.03em]">{result.allowed ? "Allowed" : "Refused"}</span>
              </div>
              <ReasonTag code={result.reason} tone="verdict" layout="stacked" className="text-right [overflow-wrap:anywhere]" />
            </div>
```
Leave the lines above it as they are: the `<div role="status" …>` and its first child `<div data-verdict={…} data-reason={result.reason} className=…>` at lines 354-359. Leave the meaning `<p>` at lines 367-369 as it is too: it shows `"It says yes. Change one thing to make it say no."` for `OK` and `REASON_MEANING[result.reason]` otherwise.

(5) Tape row, lines 435-437. Replace:
```tsx
                  <span className={e.allowed ? "text-accent" : "font-semibold text-refuse"}>
                    {e.allowed ? "Allowed" : `Refused · ${e.reason}`}
                  </span>
```
with:
```tsx
                  {e.allowed ? (
                    <span className="text-accent">Allowed</span>
                  ) : (
                    <span className="font-semibold text-refuse">
                      {"Refused · "}
                      {/* The code is the muted tag: it drops the semibold of the words before it. */}
                      <ReasonTag code={e.reason} tone="refuse" layout="inline" className="[&>:last-child]:font-normal" />
                    </span>
                  )}
```
The allowed branch renders the same `<span className="text-accent">Allowed</span>` as before. `[&>:last-child]` targets ReasonTag's code span, which is its last element child. By design the tape row keeps the label in the row's `font-mono` (no `font-sans`), because the tape reads like a log line, while the code tag stays muted at 11 px and normal weight: Task 2's code span sets no font weight of its own, so `[&>:last-child]:font-normal` is what drops the row's semibold from it.

`web/content/simulator.ts`

(6) Line 20. Replace:
```ts
import type { ReasonCode, RefusalCode } from "./reasons";
```
with:
```ts
import { type ReasonCode, type RefusalCode, reasonText } from "./reasons";
```

(7) `postText`, line 400. Replace:
```ts
  if (!r.allowed) return `I tried to buy ${what} on ${when}. Maat's simulator said no: ${r.reason}.`;
```
with:
```ts
  if (!r.allowed) return `I tried to buy ${what} on ${when}. Maat's simulator said no: ${reasonText(r.reason)}.`;
```
`r.reason` is `ReasonCode` (`SimResult.reason`), which is what `reasonText` takes. Do not touch `encodeScenario`, `decodeScenario` or `postUrl`.

- [ ] **Step 4: Run the tests and see them pass**

```
npx vitest run test/simulator.test.ts test/simulator.test.tsx test/page.test.tsx test/check-out.test.ts
```
Expected: all pass. The two simulator files had 61 tests before this task and still have 61: no `it` blocks are added.

```
npm run typecheck
npm test
```
Expected: no type errors, and the whole vitest suite green.

```
npm run build
npm run check:out
npx playwright test e2e/simulator.spec.ts e2e/smoke.spec.ts
```
Expected:
- `check:out` passes. The simulator's default verdict is still found by `role="status"…data-verdict="allowed"…data-reason="OK"`.
- every test in `e2e/simulator.spec.ts` passes, including "the longest simulator strings fit at 360px" and "at 1024px". At both widths these measure the verdict box with `INSUFFICIENT_BALANCE` and `TOKEN_NOT_ALLOWED`, the longest notice and the longest tape row.
- `e2e/smoke.spec.ts` passes. Its fit test measures the whole landing page, simulator included, at 360 to 1920 px.

Then look at `#try` in the browser at desktop width and at 375 px, for the default (**All checks passed** over `OK`), Sat 7 Nov (**Market closed** over `MARKET_CLOSED`) and a second $50 NVDAc execute (tape row `Refused · Too much in one stock CONCENTRATION`).

- [ ] **Step 5: Commit**

```
git add -- components/Simulator.tsx content/simulator.ts test/simulator.test.ts test/simulator.test.tsx e2e/simulator.spec.ts
cat > "${TMPDIR:-/tmp}/task6-commit.txt" <<'EOF'
fix(web): show plain refusal labels in the simulator

The simulator showed the vault's refusal codes on their own: the verdict
box put CONCENTRATION beside Refused, the tape read "Refused ·
CONCENTRATION", and the Post on X text ended "said no: MARKET_CLOSED."
A visitor who does not read code could not tell what happened.

- Verdict box: a stacked ReasonTag (tone "verdict") beside Refused or
  Allowed, the plain label over the code; an allowed verdict reads
  "All checks passed" over OK. The meaning line below is unchanged. The
  data-verdict and data-reason attributes keep their element and order,
  so lib/check-out.ts still finds them.
- Tape: a refused row reads "Refused · <label>" with the code as an
  inline tag; an allowed row still reads "Allowed".
- The Execute notice and the Post on X text use reasonText(), as in
  "Refused · Too much in one stock (CONCENTRATION)" and
  "said no: Market closed (MARKET_CLOSED)."

The share link's query is unchanged. Spec:
docs/superpowers/specs/2026-11-20-readable-refusals-design.md, section 5.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "${TMPDIR:-/tmp}/task6-commit.txt"
```

---

### Task 7: Plain refusal label on the OG image, the X banner and the README hero

**Files:**
- Modify: `web/brand/render.tsx:5` (imports), `:18-19` (`OG_ALT`), `:219` (OG verdict code), `:226-242` (`Badge`), `:346` (banner badge), `:356-360` (`renderBrand`)
- Modify: `web/test/brand.test.ts:4-7` (imports), `:11-15` (helper), `:54-59` (alt pin, plus two new tests)
- Modify: `README.md:3` (hero alt text)
- Regenerate with `npm run brand`, then commit: `web/brand/out/og.png`, `web/app/opengraph-image.png`, `web/app/opengraph-image.alt.txt`, `web/brand/out/x-banner.png`
- Test: `web/test/brand.test.ts`

**Interfaces:**
- Consumes (Task 1, `web/content/reasons.ts`): `REASON_LABEL: Readonly<Record<ReasonCode, string>>` (`REASON_LABEL.MARKET_CLOSED === "Market closed"`) and `reasonText(code: ReasonCode): string` (`reasonText("MARKET_CLOSED") === "Market closed (MARKET_CLOSED)"`). Also the existing `type RefusalCode` from the same file. `content/reasons.ts` imports nothing, so `brand/render.tsx` can import it by relative path, the same way it already imports `../lib/site`. The `tsx` brand script, vitest and the `next build` bundle of `app/og/[...slug]/route.ts` all resolve it.
- Produces (`web/brand/render.tsx`):
  - `export function ogSvg(onNodeDetected?: SatoriOptions["onNodeDetected"], f?: SatoriOptions["fonts"]): Promise<string>`: the landing's link preview as SVG.
  - `export function xBannerSvg(onNodeDetected?: SatoriOptions["onNodeDetected"], f?: SatoriOptions["fonts"]): Promise<string>`: the X header as SVG.
  - `Badge` takes a new optional `code?: string`. `Badge` is internal to the file.
  - No later task depends on these.

Context: `npm run brand` (`tsx scripts/brand.ts`) writes every file that `renderBrand()` returns and prints `wrote <path>` for each one. CI never runs it, and `test/brand.test.ts` checks only the PNGs' sizes, so this task re-renders the PNGs itself and looks at them. At commit `4296aaf`, a fresh in-memory render matched all 14 committed files byte for byte. After this change, exactly four files should differ.

- [ ] **Step 1: Write the failing test**

In `web/test/brand.test.ts`, replace the imports at lines 4-7:

```ts
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { MARK, PALETTE } from "@/brand/mark";
import { type BrandFile, pngSize, renderBrand } from "@/brand/render";
```

with:

```ts
import { fileURLToPath } from "node:url";
import type { SatoriNode } from "satori";
import { beforeAll, describe, expect, it } from "vitest";
import { MARK, PALETTE } from "@/brand/mark";
import { type BrandFile, ogSvg, pngSize, renderBrand, xBannerSvg } from "@/brand/render";
```

Replace the end of the `file` helper (lines 13-15):

```ts
  if (!f) throw new Error(`not rendered: ${path}`);
  return f;
};
```

with:

```ts
  if (!f) throw new Error(`not rendered: ${path}`);
  return f;
};

/** Draws an image with satori's node callback and returns a finder for the box of each text it drew. */
async function drawnText(draw: (onNode: (node: SatoriNode) => void) => Promise<string>) {
  const boxes: { text: string; left: number; top: number; right: number; bottom: number }[] = [];
  await draw((n) => {
    if (n.textContent) boxes.push({ text: n.textContent, left: n.left, top: n.top, right: n.left + n.width, bottom: n.top + n.height });
  });
  return (text: string) => {
    const box = boxes.find((b) => b.text === text);
    if (!box) throw new Error(`not drawn: "${text}"; drawn: ${boxes.map((b) => `"${b.text}"`).join(", ")}`);
    return box;
  };
}
```

Replace the alt-text test at lines 54-59:

```ts
  it("the committed OG alt text has no trailing newline", () => {
    // Reads the file on disk: the in-memory string cannot catch a newline added when it was written.
    expect(readFileSync(join(WEB, "app/opengraph-image.alt.txt"), "utf8")).toBe(
      "Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses with MARKET_CLOSED.",
    );
  });
```

with:

```ts
  it("the committed OG alt text has no trailing newline", () => {
    // Reads the file on disk: the in-memory string cannot catch a newline added when it was written.
    expect(readFileSync(join(WEB, "app/opengraph-image.alt.txt"), "utf8")).toBe(
      "Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses: Market closed (MARKET_CLOSED).",
    );
  });

  it("the OG card's verdict names the refusal in plain words, with its code small under it", async () => {
    const at = await drawnText((onNode) => ogSvg(onNode));
    const refused = at("Refused");
    const label = at("Market closed");
    const code = at("MARKET_CLOSED");
    expect(label.left, "the label sits right of Refused").toBeGreaterThan(refused.right);
    // Og(): the card's right edge is 72 px from the image's.
    expect(label.right, "the label stays inside the card").toBeLessThanOrEqual(1200 - 72);
    expect(code.top, "the code sits under the label").toBeGreaterThanOrEqual(label.bottom);
    expect(code.right, "the code lines up with the label's right edge").toBe(label.right);
    expect(code.bottom - code.top, "the code is smaller than the label").toBeLessThan(label.bottom - label.top);
  }, 30_000);

  it("the X banner's failing badge names the refusal in plain words, with its code small beside it", async () => {
    const at = await drawnText((onNode) => xBannerSvg(onNode));
    const label = at("FAIL · Market closed");
    const code = at("MARKET_CLOSED");
    expect(code.left, "the code sits right of the label").toBeGreaterThan(label.right);
    expect(code.bottom - code.top, "the code is smaller than the label").toBeLessThan(label.bottom - label.top);
    // Banner(): the content starts at x = 560, clear of the avatar, and keeps 96 px from the right edge.
    expect(label.left).toBeGreaterThanOrEqual(560);
    expect(code.right).toBeLessThanOrEqual(1500 - 96);
  }, 30_000);
```

The literal strings are deliberate. If someone later changes the `MARKET_CLOSED` label in `REASON_LABEL`, this file fails, and that is the reminder to run `npm run brand` again.

- [ ] **Step 2: Run it and see it fail**

From `web/`:

```bash
npx vitest run test/brand.test.ts
```

Expected: `Tests  3 failed | 13 passed (16)`. The three failures:
- `the committed OG alt text has no trailing newline`: `AssertionError`. The file on disk still ends `…and the vault refuses with MARKET_CLOSED.`, but the test expects `…and the vault refuses: Market closed (MARKET_CLOSED).`
- `the OG card's verdict names the refusal in plain words…`: `TypeError: … ogSvg is not a function`.
- `the X banner's failing badge names the refusal in plain words…`: `TypeError: … xBannerSvg is not a function`.

- [ ] **Step 3: Implement**

All edits are in `web/brand/render.tsx` unless a step names another file.

3a. Imports (line 5). Replace:

```tsx
import { OG_IMAGE_SIZE, type OgCard } from "../lib/docs/og";
```

with:

```tsx
import { REASON_LABEL, type RefusalCode, reasonText } from "../content/reasons";
import { OG_IMAGE_SIZE, type OgCard } from "../lib/docs/og";
```

3b. Alt text (lines 18-19). Replace:

```tsx
const OG_ALT =
  "Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses with MARKET_CLOSED.";
```

with:

```tsx
/** The refusal the OG card and the X banner show: check 04, the market session, fails. */
const REFUSAL: RefusalCode = "MARKET_CLOSED";
const OG_ALT = `Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses: ${reasonText(REFUSAL)}.`;
```

The first sentence stays exactly as it is. Only the refusal clause changes.

3c. OG verdict (line 219, inside `Og()`, the last child of the ink verdict box). Replace:

```tsx
          <span style={{ fontFamily: "Geist Mono", fontSize: 18, fontWeight: 600 }}>MARKET_CLOSED</span>
```

with:

```tsx
          {/* The plain label first, the onchain code small under it, as the site's stacked ReasonTag shows a refusal. */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.02em" }}>{REASON_LABEL[REFUSAL]}</span>
            <span style={{ fontFamily: "Geist Mono", fontSize: 13, fontWeight: 500, opacity: 0.8 }}>{REFUSAL}</span>
          </div>
```

The code uses the same style as the box's small `VAULT DECISION` label on the left: Geist Mono, 13 px, weight 500, opacity 0.8. The label is a semibold sans, like `Refused`. In a satori layout with the same styles (satori 0.63.2, Geist fonts), the label measured 932 to 1091 px across and the code ended at the same 1091 px, under it. `Refused`'s column ends at 880 px. The card's inner edge is 1091 px.

3d. Badge (lines 226-242). Replace:

```tsx
function Badge({ text, fail }: { text: string; fail?: boolean }) {
  return (
    <span
      style={{
        fontFamily: "Geist Mono",
        fontSize: 20,
        fontWeight: 600,
        padding: "8px 14px",
        borderRadius: 10,
        color: fail ? PALETTE.paper : PALETTE.accent,
        backgroundColor: fail ? PALETTE.refuse : PALETTE.accentTint,
      }}
    >
      {text}
    </span>
  );
}
```

with:

```tsx
/** A check's result. `code`, when given, follows the text in smaller type: the onchain code after its plain label. */
function Badge({ text, code, fail }: { text: string; code?: string; fail?: boolean }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        fontFamily: "Geist Mono",
        fontSize: 20,
        fontWeight: 600,
        padding: "8px 14px",
        borderRadius: 10,
        color: fail ? PALETTE.paper : PALETTE.accent,
        backgroundColor: fail ? PALETTE.refuse : PALETTE.accentTint,
      }}
    >
      <span>{text}</span>
      {code === undefined ? null : <span style={{ fontSize: 14, fontWeight: 500 }}>{code}</span>}
    </span>
  );
}
```

The code stays full white, like the badge's text. An opacity would lower its contrast on the refuse orange. A `PASS` badge drawn this way gets the same glyph paths at the same place as today. Checked with satori 0.63.2: the only difference in its SVG is one extra unused mask.

3e. Banner badge (line 346). Replace:

```tsx
          <Badge text="FAIL · MARKET_CLOSED" fail />
```

with:

```tsx
          <Badge text={`FAIL · ${REASON_LABEL[REFUSAL]}`} code={REFUSAL} fail />
```

In the same satori layout, the badge row ends at 1110 px. The banner's right margin is 1404 px (1500 - 96).

3f. Expose the two layouts and use them in `renderBrand` (lines 356-360). Replace:

```tsx
export async function renderBrand(): Promise<BrandFile[]> {
  const f = fonts();
  const lockup = await satori(<Lockup mark={60} />, { width: LOCKUP_WIDTH, height: 60, fonts: f });
  const og = png(await satori(<Og />, { width: 1200, height: 630, fonts: f }), 1200);
  const banner = png(await satori(<Banner />, { width: 1500, height: 500, fonts: f }), 1500);
```

with:

```tsx
/** The landing's link preview (brand/out/og.png, app/opengraph-image.png) as SVG. `onNodeDetected` gets the box of every element, so a test can see what it shows. */
export function ogSvg(onNodeDetected?: SatoriOptions["onNodeDetected"], f: SatoriOptions["fonts"] = fonts()): Promise<string> {
  return satori(<Og />, { width: 1200, height: 630, fonts: f, onNodeDetected });
}

/** The X header (brand/out/x-banner.png) as SVG, with the same `onNodeDetected` as ogSvg. */
export function xBannerSvg(onNodeDetected?: SatoriOptions["onNodeDetected"], f: SatoriOptions["fonts"] = fonts()): Promise<string> {
  return satori(<Banner />, { width: 1500, height: 500, fonts: f, onNodeDetected });
}

export async function renderBrand(): Promise<BrandFile[]> {
  const f = fonts();
  const lockup = await satori(<Lockup mark={60} />, { width: LOCKUP_WIDTH, height: 60, fonts: f });
  const og = png(await ogSvg(undefined, f), 1200);
  const banner = png(await xBannerSvg(undefined, f), 1500);
```

3g. `README.md` line 3 (repository root). Replace:

```html
<img src="web/brand/out/og.png" alt="Maat. The AI agent that knows when not to trade. A vault decision card shows check 03 Vault policy PASS, check 04 Market session FAIL, and the verdict Refused: MARKET_CLOSED. Tested on a local fork of Base mainnet; not deployed to mainnet." width="100%">
```

with:

```html
<img src="web/brand/out/og.png" alt="Maat. The AI agent that knows when not to trade. A vault decision card shows check 03 Vault policy PASS, check 04 Market session FAIL, and the verdict Refused: Market closed (MARKET_CLOSED). Tested on a local fork of Base mainnet; not deployed to mainnet." width="100%">
```

No test reads this line. The README's other lines that name codes (54, 82-83, 86) are not part of this task.

3h. Re-render the brand files. From `web/`:

```bash
npm run brand
```

Expected output: 14 lines, in this order:

```
wrote brand/src/mark.svg
wrote brand/src/mark-light.svg
wrote brand/src/lockup.svg
wrote brand/out/favicon-32.png
wrote brand/out/icon-512.png
wrote brand/out/apple-icon-180.png
wrote brand/out/og.png
wrote brand/out/x-avatar.png
wrote brand/out/x-banner.png
wrote app/icon.png
wrote app/apple-icon.png
wrote app/favicon.ico
wrote app/opengraph-image.png
wrote app/opengraph-image.alt.txt
```

Then, from `web/`:

```bash
git status --short
cmp brand/out/og.png app/opengraph-image.png && echo "og identical"
cat app/opengraph-image.alt.txt; echo
```

`git status --short` should list exactly these files:

```
 M ../README.md
 M app/opengraph-image.alt.txt
 M app/opengraph-image.png
 M brand/out/og.png
 M brand/out/x-banner.png
 M brand/render.tsx
 M test/brand.test.ts
```

The other ten files are rewritten byte for byte as they were. If `git status` lists any of them, the change is not part of this task: run `git restore -- <that path>` and do not commit it. `cmp` prints `og identical`. The alt file reads `Maat: the AI agent that knows when not to trade. The market session check fails, and the vault refuses: Market closed (MARKET_CLOSED).` with no newline after it.

3i. Check the two images by eye. Open `web/brand/out/og.png` and `web/brand/out/x-banner.png` with the Read tool.
- `og.png` (1200x630): on the right is the card with `03 Vault policy PASS` and `04 Market session FAIL`. In the dark verdict box at the bottom, `VAULT DECISION` sits over `Refused` on the left. On the right, **Market closed** is in white semibold, with `MARKET_CLOSED` in small dimmed mono under it. Both are right-aligned to the box's padding. Nothing touches `Refused`, nothing is clipped, and nothing wraps to a second line. The headline, lockup and tagline on the left are unchanged.
- `x-banner.png` (1500x500): `Every trade is weighed.`, then one row: `PASS`, `PASS`, and the orange badge `FAIL · Market closed` with `MARKET_CLOSED` in smaller white mono after it, on the same baseline, all inside the badge. The row stays right of x = 560 and well inside the right edge. The mono line under it is unchanged.

If either image looks wrong, fix the styles in 3c or 3d and repeat 3h and 3i.

- [ ] **Step 4: Run the tests and see them pass**

From `web/`:

```bash
npx vitest run test/brand.test.ts test/docs-og.test.ts
```

Expected: `Test Files  2 passed (2)`, `Tests  34 passed (34)`: 16 in `brand.test.ts` and 18 in `docs-og.test.ts`. `docs-og.test.ts` runs too because it imports `brand/render.tsx`. `committed SVGs and alt text match a fresh render` passes only after 3h.

Then:

```bash
npm run typecheck
npm test
```

Expected: `tsc --noEmit` prints no errors, and every vitest file passes. No other file in `web/test` or `web/e2e` pins the alt text or `FAIL · MARKET_CLOSED`: a search for `refuses with MARKET_CLOSED` and `FAIL · MARKET_CLOSED` found them only in `test/brand.test.ts`, `brand/render.tsx`, `app/opengraph-image.alt.txt` and historical plans and specs, which stay as written. The landing's `og:image:alt` comes from `app/opengraph-image.alt.txt` (`app/(site)/layout.tsx:18`), and no e2e test or ship check reads it.

- [ ] **Step 5: Commit**

From `web/`, in Bash:

```bash
git add -- brand/render.tsx test/brand.test.ts brand/out/og.png brand/out/x-banner.png app/opengraph-image.png app/opengraph-image.alt.txt ../README.md
cat > "${TMPDIR:-/tmp}/task7-msg.txt" <<'EOF'
fix(web): name the refusal in plain words on the OG image and X banner

The link preview, the README hero and the X header showed the bare
reason code MARKET_CLOSED. The OG card's verdict now reads "Market
closed" with MARKET_CLOSED small under it, the banner's failing badge
reads "FAIL · Market closed" with the code small beside it, and the
alt text ends "the vault refuses: Market closed (MARKET_CLOSED)." The
label comes from REASON_LABEL, so the images say what the site says.

ogSvg and xBannerSvg expose the two layouts to satori's node callback,
so test/brand.test.ts now checks what each image draws and where, not
only its size. The PNGs are re-rendered with npm run brand, and the
README hero's alt text names the label too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git commit -F "${TMPDIR:-/tmp}/task7-msg.txt"
git show --stat HEAD
```

Expected: `git show --stat HEAD` lists exactly the seven files from `git add`.

**Owner step after merge (not a task step):** upload the new `web/brand/out/x-banner.png` as the header of @maatonbase on X.

---

### Task 8: README labels, retaken README screenshots, an axe pass on the landing, final verification

Facts this task relies on. Each was checked on a build of `75c2ddb`. Its `TryIt.tsx`, `Ledger.tsx`, `LedgerTable.tsx` and `Simulator.tsx` are byte-identical to this branch's base `4296aaf`.

- **Landing themes.** The landing has a single light theme. There is no `dark` class, no `prefers-color-scheme` rule in `web/app/globals.css`, and `web/app/(site)/layout.tsx` sets `themeColor: "white"`. The axe test therefore runs once, with no dark run.
- **axe already fails on `/`.** axe on `/` reports one serious violation today, before any ReasonTag work: `link-in-text-block` on `p:nth-child(4) > a:nth-child(2)` and `p:nth-child(4) > a:nth-child(3)`. These are the two contract links in the simulator's "Source of truth." note (`web/components/sections/TryIt.tsx:51-52`). axe measured their contrast with the surrounding text at 1.08:1 (`#1f3bff` against `#5a6170`), and they have no other styling to set them apart. Setting them to `font-weight: 500` cleared it, with zero serious or critical violations at both 1280 px and 375 px. The other landing links in running text already use `font-medium` (`AnnouncementBar.tsx:14`, `Ledger.tsx:18`).
- **ReasonTag tone contrast.** Computed from the tokens in `globals.css`, every pair is at least 4.5:1:

  | Tone | Text on background | Ratio |
  | --- | --- | --- |
  | `verdict` code | white at `opacity-80` on accent `#1F3BFF` | 4.80:1 (lowest verdict pair) |
  | `verdict` code | white at `opacity-80` on ink | 12.46:1 |
  | `refuse` | `#C2410C` on white | 5.18:1 |
  | `neutral` | ink-2 `#5A6170` on white | 6.22:1 |
  | `neutral` | ink-2 on surface-soft | 5.80:1 |
  | `MARKET_CLOSED` highlight | white on refuse | 5.18:1 |
  | fallback for `verdict` | white at `opacity-90` on accent | 5.69:1 |

  The landing ledger's code tag is not a ReasonTag (Task 3): it is a plain `<code>` in `text-ink-2` on the table's white, beside the badge in `web/components/LedgerTable.tsx`, the same 6.22:1 pair as the neutral row.

- **The README screenshots.** Both were added in `8629a41` ("docs: rewrite the README…"). No script is committed. Both are 8-bit RGB PNGs with no metadata: `simulator-size-limit.png` is 1240 x 1428 and `fork-ledger.png` is 1240 x 653. 1240 is the width of `.wrap` (`max-width: 1240px`).
  - The frame was found by pixel matching: a 1440 x 900 window at device scale 1, the section's `.wrap` width, from 18 px above its first child to 18 px (simulator) or 28 px (ledger) below its last child.
  - The script in Step 3c, run against that build, gives back both committed PNGs pixel for pixel.
- **Simulator share link.** The `$51` state is the share link `?day=2026-11-05&at=1030&buy=NVDAc-51` (`encodeScenario`/`decodeScenario`, `web/content/simulator.ts:349-395`).
  - The committed simulator shot shows the "Now" chip. The simulator offers it only while the clock is inside `WINDOW` (`web/content/calendar.ts:146-149`), which ends on Fri 1 Jan 2027.
  - The script pins the clock to an instant inside that window.
- **README test counts.** The counts in `README.md` (259 e2e and the rest) are tied to CI run 44553264467 and stay unchanged.

**Files:**
- Modify: `web/e2e/smoke.spec.ts:1-2` (import), and append two tests after the last test, `reduced motion shows the final state at once`
- Modify: `web/components/sections/TryIt.tsx:49-53`
- Modify: `README.md:54`, `README.md:82`, `README.md:83`, `README.md:86`
- Modify (retaken binaries): `docs/assets/readme/simulator-size-limit.png`, `docs/assets/readme/fork-ledger.png`
- Modify, only if Step 3d is needed: `web/components/ui/ReasonTag.tsx`, `web/components/LedgerTable.tsx`, `web/test/reason-tag.test.tsx`, `web/test/problem-how.test.tsx`, and the Refusals test in `web/e2e/smoke.spec.ts`
- Create, not committed: `readme-shots.mjs`, in the scratchpad directory your system prompt names (outside the repository)
- Test: `web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes:
  - `REASON_LABEL: Readonly<Record<ReasonCode, string>>` and `reasonText(code: ReasonCode): string` from `web/content/reasons.ts` (Task 1).
  - `export function ReasonTag({ code, tone = "neutral", layout = "stacked", className }: ReasonTagProps)` (return type inferred) with `ReasonTagTone = "verdict" | "refuse" | "neutral"` from `web/components/ui/ReasonTag.tsx` (Task 2). Its tone classes: verdict code `opacity-80`; refuse `text-refuse`; neutral label `text-ink`, code `text-ink-2`.
  - `decisionLabel(r)`, which returns `"Refused · Market closed"` or `"Allowed · All checks passed"` (Task 3). The landing ledger shows it in the badge, with the code beside it as a plain `<code className="font-mono text-[11px] text-ink-2">`, not a ReasonTag (Task 3).
  - Every landing, simulator, ledger and docs-ledger change of the earlier PR 1 tasks (spec section 5). This task's build, screenshots and browser check need all of them in place.
  - The `data-verdict`, `data-reason` and `data-code` attributes, unchanged.
- Produces:
  - The e2e tests `"the landing has no serious or critical axe violations"` and `"the landing does not scroll sideways at 375 px"` in `web/e2e/smoke.spec.ts`.
  - The retaken README screenshots.
  - Nothing later tasks import.

- [ ] **Step 1: Write the failing test**

Before any edit, note the e2e count from `web/`, so Step 4b can check that this task adds exactly two tests:

```bash
npx playwright test --list | tail -1
```

In `web/e2e/smoke.spec.ts`, replace lines 1-2:

```ts
import { expect, test } from "@playwright/test";
import { collectErrors, measureFit } from "./helpers";
```

with:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { collectErrors, measureFit } from "./helpers";
```

Append this after the file's last test. That test ends with:

```ts
  expect(opacities).toHaveLength(10);
  expect(opacities.every((o) => o === "1")).toBe(true);
});
```

The code to append (keep one blank line before it):

```ts

// The same check as e2e/docs-a11y.spec.ts, on the landing. The landing has one theme (no dark variant), so it runs
// once. Its default state holds every ReasonTag tone: the hero's refused verdict on ink and the simulator's allowed
// verdict on accent (verdict), the problem cards (refuse) and the Refusals list (neutral); and the ledger's code tags
// (`text-ink-2` on white, components/LedgerTable.tsx).
test("the landing has no serious or critical axe violations", async ({ page }) => {
  // Reduced motion shows the hero's intro in its final state at once, so axe never measures a row mid-fade.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Hydrated: Post on X carries the absolute share link only once the simulator has read the page's address.
  await expect(page.locator("#try").getByRole("link", { name: "Post on X" })).toHaveAttribute("href", /&url=/);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) }));
  expect(blocking).toEqual([]);
});

// Review Focus 1: on a phone, the longest labels ("Pool price too far from oracle", "Price feed out of date") wrap
// inside the Refusals items, the ledger cell and the simulator verdict, and the page never scrolls sideways.
test("the landing does not scroll sideways at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});
```

- [ ] **Step 2: Run it and see it fail**

Run from `web/` in Git Bash. e2e serves the existing `out/`, so build first; the build takes a few minutes:

```bash
NEXT_TELEMETRY_DISABLED=1 npm run build
npx playwright test e2e/smoke.spec.ts -g "axe|375 px"
```

Expected: 1 failed, 1 passed. The 375 px test passes already: Tasks 3 to 6 are in place, and it guards their wrapping from here on, as Task 3's guard tests do. The axe test fails, and its `toEqual([])` diff shows exactly one received entry:

```
{ id: "link-in-text-block", impact: "serious", nodes: ["p:nth-child(4) > a:nth-child(2)", "p:nth-child(4) > a:nth-child(3)"] }
```

These are the two links in the simulator's "Source of truth." note. If the received array holds anything more, note it and handle it in Step 3d. A `color-contrast` entry whose node lies inside `[data-reason-tag]` is the most likely case.

- [ ] **Step 3: Implement**

**3a. Set the two source links apart by weight.**

In `web/components/sections/TryIt.tsx`, replace lines 49-53:

```tsx
          <p className="m-0">
            <strong className="font-medium text-ink">Source of truth.</strong> The contracts decide, not this page. Read{" "}
            <a href={repoFileUrl("contracts/src/MarketCalendar.sol")}>MarketCalendar.sol</a> and{" "}
            <a href={repoFileUrl("contracts/src/MandateVault.sol")}>MandateVault.sol</a>.
          </p>
```

with:

```tsx
          {/* Medium weight: inside ink-2 text the accent colour alone does not set a link apart (axe link-in-text-block). */}
          <p className="m-0">
            <strong className="font-medium text-ink">Source of truth.</strong> The contracts decide, not this page. Read{" "}
            <a className="font-medium" href={repoFileUrl("contracts/src/MarketCalendar.sol")}>MarketCalendar.sol</a> and{" "}
            <a className="font-medium" href={repoFileUrl("contracts/src/MandateVault.sol")}>MandateVault.sol</a>.
          </p>
```

The visible text and the link targets are unchanged. `font-medium` is already generated for the landing (TryIt uses it on `<strong>`).

This fix of an existing violation stays in PR 1, as its own commit (5a), because the spec's axe test on `/` cannot pass without it. The PR body (Task 9 Step 3) must name it as a fix of a pre-existing `link-in-text-block` violation, separate from the label work.

**3b. README text.** Make four single-line replacements in `README.md`. Each line count stays the same.

Line 54. Replace:

```
  GOOGLc buy was refused with `MARKET_CLOSED` and logged on the fork (111,116 gas). [Fork evidence](#base-mainnet-fork-evidence).
```

with:

```
  GOOGLc buy was refused as market closed (`MARKET_CLOSED`) and logged on the fork (111,116 gas). [Fork evidence](#base-mainnet-fork-evidence).
```

Line 82. Replace:

```
  <a href="docs/assets/readme/simulator-size-limit.png"><img src="docs/assets/readme/simulator-size-limit.png" width="49%" alt="The Try to make it say no simulator. A BUY of NVDAc for $51 on Thu 5 Nov at 10:30 ET passes checks 01 to 07, fails check 08 Size limits because $51 is over the $50 per-trade cap, skips check 09, and shows the simulated result Refused, SIZE_LIMIT."></a>
```

with:

```
  <a href="docs/assets/readme/simulator-size-limit.png"><img src="docs/assets/readme/simulator-size-limit.png" width="49%" alt="The Try to make it say no simulator. A BUY of NVDAc for $51 on Thu 5 Nov at 10:30 ET passes checks 01 to 07, fails check 08 Size limits because $51 is over the $50 per-trade cap, skips check 09, and shows the simulated result Refused: Over the size limit (SIZE_LIMIT)."></a>
```

Line 83. Replace:

```
  <a href="docs/assets/readme/fork-ledger.png"><img src="docs/assets/readme/fork-ledger.png" width="49%" alt="The decision ledger, headed Every answer is public. Especially no. Four rows: BUY NVDAc $20 allowed, gas 758,192; SUPPLY NVDAc $15 allowed, 286,707; BORROW USDC $5 allowed, 484,173; BUY GOOGLc $10 on Sat 7 Nov refused with MARKET_CLOSED, 111,116. A note says the rows were recorded on a fork of Base mainnet at block 53,551,627."></a>
```

with:

```
  <a href="docs/assets/readme/fork-ledger.png"><img src="docs/assets/readme/fork-ledger.png" width="49%" alt="The decision ledger, headed Every answer is public. Especially no. Four rows: BUY NVDAc $20, Allowed · All checks passed (OK), gas 758,192; SUPPLY NVDAc $15, allowed, 286,707; BORROW USDC $5, allowed, 484,173; BUY GOOGLc $10 on Sat 7 Nov, Refused · Market closed (MARKET_CLOSED), 111,116. A note says the rows were recorded on a fork of Base mainnet at block 53,551,627."></a>
```

Line 86. Replace:

```
Left: the simulator refusing a $51 buy with `SIZE_LIMIT`. Right: the fork ledger.
```

with:

```
Left: the simulator refusing a $51 buy as over the size limit (`SIZE_LIMIT`). Right: the fork ledger.
```

No test pins these lines. `test/readme.test.ts` reads only the Documentation table and the links.

**3c. Retake the two screenshots from a local build of this branch.**

They must be taken after 3a, because the simulator shot includes the "Source of truth." links.

1. Rebuild. From `web/`:

   ```bash
   NEXT_TELEMETRY_DISABLED=1 npm run build
   ```

2. Serve the export on its own port, so it never clashes with Playwright's 4173. Run this in the background (Bash `run_in_background`) and leave it running:

   ```bash
   npx serve -L -n --no-port-switching -l 4180 out
   ```

3. Save the script below as `readme-shots.mjs` in your scratchpad directory. It is not committed. It finds `@playwright/test` through `web/package.json`, so it runs from anywhere, provided the working directory is `web/`.

   ```js
   // readme-shots.mjs: retakes the README's two screenshots from a local build of web/. Not committed.
   // Run from web/ after `npm run build`, while `npx serve -L -n --no-port-switching -l 4180 out` serves the export.
   import { writeFileSync } from "node:fs";
   import { createRequire } from "node:module";
   import { join } from "node:path";

   const require = createRequire(join(process.cwd(), "package.json"));
   const { chromium } = require("@playwright/test");

   const BASE = "http://localhost:4180";
   const OUT = join(process.cwd(), "..", "docs", "assets", "readme");

   // A shot spans the section's .wrap (1240 px wide at this window), from 18 px above its first child to `below` px
   // under its last child. On the build of 75c2ddb these frames give back the committed PNGs pixel for pixel.
   async function frame(page, id, below) {
     return page.evaluate(
       ([id, below]) => {
         const wrap = document.querySelector(`#${id} > .wrap`);
         const box = wrap.getBoundingClientRect();
         const top = wrap.firstElementChild.getBoundingClientRect().top + window.scrollY;
         const bottom = wrap.lastElementChild.getBoundingClientRect().bottom + window.scrollY;
         const y = Math.floor(top) - 18;
         return { x: Math.round(box.left), y, width: Math.round(box.width), height: Math.ceil(bottom) + below - y };
       },
       [id, below],
     );
   }

   const browser = await chromium.launch();
   try {
     const context = await browser.newContext({
       viewport: { width: 1440, height: 900 },
       deviceScaleFactor: 1,
       locale: "en-US",
       colorScheme: "light",
       reducedMotion: "reduce",
     });
     const page = await context.newPage();
     // The committed shot shows the Now chip, which the simulator offers only while the clock is inside its date window
     // (WINDOW in content/calendar.ts, which ends on Fri 1 Jan 2027). A fixed instant inside it keeps the chip.
     await page.clock.setFixedTime(new Date("2026-11-20T12:00:00-05:00"));
     // The $51 share link: NVDAc, Thu 5 Nov, 10:30 ET (encodeScenario in content/simulator.ts).
     await page.goto(`${BASE}/?day=2026-11-05&at=1030&buy=NVDAc-51#try`);
     await page.evaluate(() => document.fonts.ready);
     // Hydrated: the share link is decoded, Post on X carries the absolute link, and the Now chip is offered.
     await page.locator('#try [role="status"] > div[data-reason="SIZE_LIMIT"]').waitFor();
     await page.waitForFunction(() => document.querySelector('#try a[href*="&url="]') !== null);
     await page.locator("#try").getByRole("button", { name: "Now", exact: true }).waitFor();
     await page.locator("#ledger tbody tr").nth(3).waitFor();

     const shots = [
       { file: "simulator-size-limit.png", clip: await frame(page, "try", 18) },
       { file: "fork-ledger.png", clip: await frame(page, "ledger", 28) },
     ];
     for (const { file, clip } of shots) {
       const png = await page.screenshot({ fullPage: true, clip, animations: "disabled" });
       writeFileSync(join(OUT, file), png);
       console.log(`${file}: ${clip.width}x${clip.height}`);
     }
   } finally {
     await browser.close();
   }
   ```

4. Run it from `web/`. Set `SCRATCHPAD` to the absolute scratchpad path from your system prompt:

   ```bash
   node "$SCRATCHPAD/readme-shots.mjs"
   ```

   Expected: two lines, `simulator-size-limit.png: 1240x…` and `fork-ledger.png: 1240x…`. The width is 1240. The heights may differ from 1428 and 653, because the content changed.

5. Open both PNGs with the Read tool and check them.
   - **`docs/assets/readme/simulator-size-limit.png`**
     - The same layout as before: TRY IT heading, `$51` and `Thu 5 Nov · 10:30` chips pressed, the "Now" chip present, checks 01-07 PASS, 08 Size limits FAIL with `$51 > $50 per trade`, 09 SKIP `not reached`.
     - The dark verdict box shows `Refused` on the left. On the right is **Over the size limit** over `SIZE_LIMIT` in small mono. Under it is "Over the per-trade cap or the daily cap."
     - `MarketCalendar.sol` and `MandateVault.sol` in the last note are medium weight.
   - **`docs/assets/readme/fork-ledger.png`**
     - Rows 1-3: the badge `Allowed · All checks passed` (blue on the blue tint), with `OK` beside it in small grey mono.
     - Row 4 (Sat 7 Nov, BUY GOOGLc · $10): the badge `Refused · Market closed` (orange on the orange tint), with `MARKET_CLOSED` beside it in small grey mono.
     - Either tag may wrap under its badge.
     - Notes, gas figures, the fork footnote and "How to rerun this fork yourself" are unchanged and nothing is clipped.
   - If a badge is cut off, fix Task 3's layout in `web/components/LedgerTable.tsx`, not this frame.
6. Stop the background server (TaskStop on its id, or Ctrl+C).

**3d. Only if the axe run in Step 4 still reports something.**

1. Read the node targets in the failure. For a `color-contrast` node inside `[data-reason-tag="…"]`, find its tone from where it sits:
   - hero or simulator verdict box: `verdict`
   - problem card or simulator tape row: `refuse`
   - Refusals list: `neutral`

   A node at `#ledger td code` is the ledger code tag: not a ReasonTag; change its `text-ink-2` in `web/components/LedgerTable.tsx`.
2. Change only that tone's code class, in `web/components/ui/ReasonTag.tsx` unless the line says otherwise:
   - `verdict`: `opacity-80` becomes `opacity-90` (5.69:1 on accent).
   - `refuse`: the code's `text-refuse` becomes `text-ink`.
   - `neutral`: the code's `text-ink-2` becomes `text-ink-body`.
   - ledger code tag: in `web/components/LedgerTable.tsx`, the `<code>`'s `text-ink-2` becomes `text-ink-body`.
3. Keep the label classes and leave nothing `aria-hidden`.
4. Update every assertion that names the changed class or colour: `web/test/reason-tag.test.tsx` (the defaults test and the tone `it.each`), `web/test/problem-how.test.tsx` (`toHaveClass("text-refuse")` on the code, if the refuse tone changed), and the Refusals test in `web/e2e/smoke.spec.ts` (`rgb(90, 97, 112)`: use `rgb(61, 67, 80)` for ink-body `#3D4350` if the neutral tone changed). Then run:

   ```bash
   npx vitest run test/reason-tag.test.tsx test/problem-how.test.tsx
   ```

5. Rebuild with `NEXT_TELEMETRY_DISABLED=1 npm run build`, then rerun `npx playwright test e2e/smoke.spec.ts -g Refusals`. Re-run 3c, because the verdict box is in the simulator shot and the ledger code tags are in the ledger shot.

For any other rule, fix the element it names and say so in the commit body.

- [ ] **Step 4: Run the tests and see them pass**

Run everything from `web/`, in Git Bash, in this order.

**4a. The new tests and the README test:**

```bash
npx playwright test e2e/smoke.spec.ts -g "axe|375 px"
npx vitest run test/readme.test.ts test/page.test.tsx
```

Expected: `2 passed` for the axe and 375 px tests, and both vitest files pass.

**4b. The full verification, as CI runs it.** Count the e2e tests first, so you can compare at the end:

```bash
npx playwright test --list | tail -1
npm run typecheck
npm test
NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_SITE_URL=https://maatonbase.xyz npm run build
npm run check:out
npx playwright test --workers=1 --forbid-only
git status --porcelain
```

Expected outcomes:
- **`npm run typecheck`:** exits 0 with no errors.
- **`npm test`:** every file passes, 0 failed.
- **`npm run build`:** exits 0 and writes `out/index.html`.
- **`npm run check:out`:** prints `out/ is ready to deploy (landing and 49 docs pages checked)` and the search-index budget line. Lines starting `✗` mean a failure. The most likely one is the `role="status"` / `data-verdict` / `data-reason` order on the hero or simulator, which must not change.
- **`npx playwright test`:** every test passes, 0 failed, 0 flaky, and the total equals the `--list` count taken at the start of Step 4b, which is two more than the count taken before Step 1. The `fits …px` smoke tests cover clipping of the new tags at 360-1920 px.
- **`git status --porcelain`:** prints nothing beyond this task's uncommitted files. Before Step 5 that means the five paths from Steps 1 and 3 (`web/e2e/smoke.spec.ts`, `web/components/sections/TryIt.tsx`, `README.md`, `docs/assets/readme/simulator-size-limit.png`, `docs/assets/readme/fork-ledger.png`), plus the files Step 3d changed, if it ran. CI's clean step fails on anything else.

**4c. Browser check.**

1. Serve the export again in the background with `npx serve -L -n --no-port-switching -l 4180 out`.
2. Open `http://localhost:4180/` in the Browser pane (`preview_start` with `url`).
3. Check each item below twice: at desktop width (`resize_window` 1440 x 900), then at 375 px (`resize_window` preset `mobile`, then reload).
4. At each width, run this in the page and expect `{ overflow: ≤ 0, clipped: [] }`:

   ```js
   ({
     overflow: document.documentElement.scrollWidth - innerWidth,
     clipped: [...document.querySelectorAll(".card")]
       .filter((el) => !el.hasAttribute("data-scroll-x") && el.scrollWidth > el.clientWidth + 1)
       .map((el) => el.textContent.trim().slice(0, 60)),
   })
   ```

5. Also read the console errors (`read_console_messages`, `onlyErrors`) and expect none.

Expected on each surface:
- **Hero (`#top`).**
  - On load (Sat 7 Nov): the dark box shows `VAULT DECISION` / `Refused` on the left. On the right is **Market closed** over `MARKET_CLOSED` in small mono, and under them the outcome line `Decision logged · gas 111,116`.
  - Click `Thu 5 Nov · 10:30`: the box turns blue, with `Allowed` and **All checks passed** over `OK`, and the outcome line `Swap executed · gas …`.
  - At 375 px the box wraps with nothing cut off.
- **Problem, three cards.** Top right of each card, in the refuse colour, is the label over its code:
  - **Market closed** / `MARKET_CLOSED`
  - **Pool price too far from oracle** / `PREMIUM_TOO_HIGH`
  - **Corporate action cooldown** / `MULTIPLIER_COOLDOWN`

  The `01 · MARKET HOURS` style tag stays on the left. At 375 px the longest label wraps without overlapping the tag.
- **How it works.** The decoded event reads `reason MARKET_CLOSED` followed by a muted `// Market closed`.
- **Refusals.**
  - 19 items in 5 groups. Each title is the label (for example **Price feed out of date**), with the code as a small muted mono tag beside it and the meaning below.
  - Only **Market closed** carries the highlight on its label (white on the refuse colour).
  - In devtools, each `li` still has `data-code="…"`.
- **Simulator (`#try`).**
  - Default: blue box, `Allowed`, **All checks passed** over `OK`, and "It says yes. Change one thing to make it say no."
  - Click `$51`:
    - Check 08 Size limits reads FAIL `$51 > $50 per trade`, and check 09 reads SKIP.
    - The dark box shows `Refused` with **Over the size limit** over `SIZE_LIMIT`, and "Over the per-trade cap or the daily cap." below.
    - Click `Execute`. The notice reads `Executed 10:30 BUY NVDAc · $51: Refused · Over the size limit (SIZE_LIMIT)`. The tape row reads `10:30 BUY NVDAc · $51` and `Refused · Over the size limit` with an inline `SIZE_LIMIT` tag.
  - Click `Reset day`, `$20`, then `Sat 7 Nov`:
    - Check 04 Market session reads FAIL `Saturday · NYSE closed`.
    - The box shows `Refused` with **Market closed** over `MARKET_CLOSED`, and "NYSE is closed for the mandate's session: a weekend, a holiday or after hours."
    - Click `Execute`. The notice reads `Executed 10:30 BUY NVDAc · $20: Refused · Market closed (MARKET_CLOSED)` and the tape row shows `Refused · Market closed` with a `MARKET_CLOSED` tag.
    - The `Post on X` link's `href`, decoded, has the text `I tried to buy $20 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: Market closed (MARKET_CLOSED).`
- **Ledger (`#ledger`).**
  - The badges match the retaken screenshot: `Allowed · All checks passed` + `OK` three times, and `Refused · Market closed` + `MARKET_CLOSED` once.
  - `Refused` filters to 1 row and `Allowed` to 3.
  - At 375 px the table scrolls sideways inside its own card and the page does not.
- **`/docs/get-started/read-a-decision`.**
  - The fork ledger table's Decision column reads `Allowed · All checks passed (OK)` on three rows and `Refused · Market closed (MARKET_CLOSED)` on the last, with the code in code formatting.
  - The bullets under "Read a ledger row" and the two row readings under "From a ledger row to its reasoning" quote the same format.
  - At 375 px the table scrolls inside its region, not the page.
  - Repeat once in the dark theme: run `localStorage.setItem("theme","dark")` and reload. The cell text stays readable.

Stop the server when done.

- [ ] **Step 5: Commit**

Make two commits from `web/`, each with its message in a file in your scratchpad.

**5a. The axe test and the link fix.** Save this message as `$SCRATCHPAD/msg-task8-axe.txt`:

```
fix(web): run axe on the landing and set its two source links apart by weight

PR 1 puts a plain label and a small code tag on every reason the landing
shows, and the spec asks for an axe pass on / so their contrast is checked.
Until now axe ran on docs pages only.

e2e/smoke.spec.ts now runs axe on / with reduced motion, after hydration,
and fails on any serious or critical violation, as e2e/docs-a11y.spec.ts
does for the docs. The landing has one theme, so it runs once. Its default
state shows every ReasonTag tone. A second test checks that / does not
scroll sideways at 375 px, where the longest labels must wrap.

Its first run found one existing violation, link-in-text-block: the two
contract links in the simulator's "Source of truth." note stood apart from
the ink-2 text around them by colour alone (1.08:1). They are now medium
weight, as the other links in the landing's running text are.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Then:

```bash
git add -- components/sections/TryIt.tsx e2e/smoke.spec.ts
git commit -F "$SCRATCHPAD/msg-task8-axe.txt"
```

If Step 3d changed a class:
- Also add every file it changed to the `git add`: `components/ui/ReasonTag.tsx` or `components/LedgerTable.tsx`, and the tests 3d.4 updated (`test/reason-tag.test.tsx`, `test/problem-how.test.tsx`; `e2e/smoke.spec.ts` is already staged).
- Add this paragraph before the trailer, naming what you changed: `The run also flagged the <tone> tone's code; its class is now <new class>.` (or, for the ledger, `the ledger's code tag; its class is now <new class>.`). Write the real tone and class, not the brackets.

**5b. The README.** Save this message as `$SCRATCHPAD/msg-task8-readme.txt`:

```
docs(readme): name the label next to each reason code, and retake the screenshots

The 60-second summary, the alt text of the two screenshots and their
caption now give the plain label with the code, as the site does: "refused
as market closed (MARKET_CLOSED)", "Refused: Over the size limit
(SIZE_LIMIT)" and "Refused · Market closed (MARKET_CLOSED)".

docs/assets/readme/simulator-size-limit.png and fork-ledger.png are
retaken from a local build of this branch in the same frame as before: a
1440 x 900 window at device scale 1, the section's 1240 px .wrap from
18 px above its first child to 18 px (simulator) or 28 px (ledger) below
its last child, and the simulator opened from the $51 share link
?day=2026-11-05&at=1030&buy=NVDAc-51. On a build of 75c2ddb that frame
gives back the previous PNGs pixel for pixel.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Then:

```bash
git add -- ../README.md ../docs/assets/readme/simulator-size-limit.png ../docs/assets/readme/fork-ledger.png
git commit -F "$SCRATCHPAD/msg-task8-readme.txt"
git status --porcelain
```

Expected: the last command prints nothing.

---

### Task 9: Review the branch, open the PR and merge

**Files:** none changed unless the review finds a defect (then the fix gets its own commit, with the files it touches).

**Interfaces:**
- Consumes: the commits of Tasks 1 to 8 on `fix/web-readable-refusals`.
- Produces: a merged pull request to `main`.

- [ ] **Step 1: Adversarial review of the whole diff**

Run an independent review of `git diff origin/main...HEAD` (for example the `code-review` skill, or a workflow with one reviewer per lens: correctness against the spec, test coverage of each changed string, accessibility and contrast, and the brand images). Fix every confirmed finding in its own commit, then rerun the commands of Task 8 Step 4.

- [ ] **Step 2: Push the branch**

```bash
cd E:/APP2028/stocks-maxxing-hackathon/.claude/worktrees/readable-refusals
git push -u origin fix/web-readable-refusals
```

Expected: the branch is created on `origin`; no force push.

- [ ] **Step 3: Open the pull request**

Write the body to `$SCRATCHPAD/pr-body.md` (the scratchpad variable Task 8 sets up), then:

```bash
gh pr create --base main --head fix/web-readable-refusals --title "fix(web): show plain labels before refusal codes" --body-file "$SCRATCHPAD/pr-body.md"
```

The body says what changed (the label map, `ReasonTag`, each surface, the re-rendered images and screenshots), names Task 8's separate fix of the pre-existing axe `link-in-text-block` violation in `web/components/sections/TryIt.tsx` (its own commit, kept in this PR because the spec's axe test on `/` cannot pass without it), links the spec, lists the commands run with their results, and names the owner's step after merge: upload `web/brand/out/x-banner.png` to @maatonbase on X. It ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 4: Read CI once**

```bash
gh pr checks
```

(With no number, `gh` acts on the pull request of the checked-out branch, `fix/web-readable-refusals`.)

If any check is still running, stop and ask the owner to reply when they want it read again; do not poll.

- [ ] **Step 5: Merge**

Merge only when the `summary` check is green, the head is the tested commit and the diff touches only this plan's files:

```bash
gh pr merge --merge --match-head-commit "$(git rev-parse HEAD)"
```

Expected: a merge commit on `main`; the branch is kept.
