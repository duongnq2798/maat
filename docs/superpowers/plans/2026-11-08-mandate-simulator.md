# Maat Web: "Try to make it say no" Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `#try` section on the landing page where a visitor picks a token, an amount and an ET moment, sees the nine mandate checks and the reason code live, executes trades through one simulated day, and shares the result on X.

**Architecture:** A pure TypeScript port of the offline-decidable checks lives in `web/content/` (`calendar.ts` ports `DateLib` and `MarketCalendar`; `simulator.ts` ports the BUY path of `MandateVault._check`). One client component, `web/components/Simulator.tsx`, holds the state; a server section, `web/components/sections/TryIt.tsx`, frames it. Parity tests read the Solidity source and the Foundry vectors with `web/test/helpers/solidity.ts`.

**Tech Stack:** Next.js 16.4.5 static export, React 19.3.1, Tailwind 4.3.5, TypeScript 7.0.2, Vitest 5.1.0 with Testing Library, Playwright 1.65.0. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-08-mandate-simulator-design.md`

## Global Constraints

- Fully client-side and static: keep `output: "export"`; no RPC, wallet, analytics or third-party scripts; `npm run check:out` must pass.
- Every number comes from `web/content/facts.ts`; every rule and value the simulator mirrors is parity-tested against the Solidity source.
- Reuse `CHECK_LABELS` (`web/content/engine.ts`), `FACTS.mandate` (`web/content/facts.ts`) and `REASON_MEANING` (`web/content/reasons.ts`).
- Signal design system from `web/app/globals.css`: classes `card`, `pill-dark`, `pill-line`; tokens `accent`, `refuse`.
- All copy and code comments in English. No Vietnamese anywhere in the repo.
- No new dependency. No paid Claude API calls. Never set or print `BASE_RPC_URL`.
- Work on branch `feat/mandate-simulator`; commit locally after each task; never push or merge.
- Run every `npm` command from `web/`.

## Review Focus

1. **Amounts typed the way people type them** (`$1,000`, `50.`, ` 20 `, a stray letter mid-typing): accepted forms parse; anything else shows the inline error and disables Execute, and the preview keeps the last valid amount instead of going blank. Tests: Task 3 `parseUsd`, Task 4 "keeps the preview and blocks Execute".
2. **A stale or hand-edited share link** (date outside the window, unknown token, impossible time, junk or over-long tape, `%2C` commas): falls back field by field, never throws, logs no console error. Tests: Task 3 share links, Task 6 garbage link.
3. **"Now" for a visitor outside New York, or after the window ends**: ET comes from UTC through the port, never the browser's time zone; the chip hides outside the window. Tests: Task 4 fake-`Date` tests.
4. **Keyboard only**: arrow keys move the slider one minute and flip the verdict at 16:00; a typed date outside the window is ignored. Tests: Task 4 date test, Task 6 keyboard scenario.
5. **The longest strings at 360 px** (Other token, $999,999,999.99, the balance row, the manual copy field): no page scroll, no clipped card. Test: Task 6 fit test.

---

## File map

| File | Responsibility |
|---|---|
| `web/content/facts.ts` (modify) | New facts `calendar`, `basket`, `forkVaultUsd` |
| `web/content/calendar.ts` (create) | `DateLib` + `MarketCalendar` port (REGULAR), ISO helpers, date window |
| `web/content/format.ts` (modify) | `minuteOfClock`, `andList` |
| `web/content/simulator.ts` (create) | `evaluate`, `execute`, `replay`, `daySummary`, presets, labels, share codec, X text |
| `web/components/Simulator.tsx` (create) | Client component |
| `web/app/globals.css` (modify) | `.time-range` slider |
| `web/components/sections/TryIt.tsx` (create) | Section, heading, footnote |
| `web/app/page.tsx`, `web/components/sections/Nav.tsx`, `web/components/sections/Hero.tsx` (modify) | Placement |
| `web/lib/site.ts` (modify) | `repoFileUrl` |
| `web/lib/check-out.ts` (modify) | Default simulator verdict in the export |
| `web/e2e/helpers.ts` (create), `web/e2e/smoke.spec.ts` (modify), `web/e2e/simulator.spec.ts` (create) | e2e |
| Tests: `web/test/facts.test.ts`, `calendar.test.ts` (create), `format.test.ts`, `simulator.test.ts` (create), `simulator.test.tsx` (create), `page.test.tsx`, `top.test.tsx`, `site.test.ts`, `check-out.test.ts` | |

---

### Task 0: Workspace

- [ ] **Step 1: Confirm the branch and install**

Run (repo root): `git status --short --branch`
Expected: `## feat/mandate-simulator` and a clean tree (the spec and this plan already committed).

Run (in `web/`): `npm ci`
Expected: installs from `package-lock.json`, no new packages.

Run (in `web/`): `npx vitest run`
Expected: all existing tests PASS. This is the baseline.

---

### Task 1: Facts for the calendar, the basket and the fork vault

**Files:**
- Modify: `web/content/facts.ts`
- Test: `web/test/facts.test.ts`

**Interfaces:**
- Produces: `Holiday { date: string; name: string }`, `EarlyClose { date: string; closeMin: number }`; `FACTS.calendar.value: { holidays: readonly Holiday[]; earlyCloses: readonly EarlyClose[] }`; `FACTS.basket.value: readonly ["NVDAc", "GOOGLc", "AAPLc"]`; `FACTS.forkVaultUsd.value: 200`.

- [ ] **Step 1: Write the failing parity tests**

In `web/test/facts.test.ts`, add `const forkDeploy = readRepo("agent/test/integration/deploy.ts");` next to the other `readRepo` lines, then add inside `describe("parity with the contracts and the fork run (spec §5.4)", ...)`:

```ts
  it("market calendar: holidays, with the names in its comments, and early closes", () => {
    const iso = (y = "", m = "", d = "") => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const holidays = [...calendar.matchAll(/_addHoliday\((\d+),\s*(\d+),\s*(\d+)\);\s*\/\/\s*([^\r\n]+)/g)].map((m) => ({
      date: iso(m[1], m[2], m[3]),
      name: (m[4] ?? "").trim(),
    }));
    const earlyCloses = [...calendar.matchAll(/_setEarlyClose\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\);/g)].map((m) => ({
      date: iso(m[1], m[2], m[3]),
      closeMin: Number(m[4]),
    }));
    expect(holidays.length * earlyCloses.length).toBeGreaterThan(0);
    expect({ holidays, earlyCloses }).toEqual(FACTS.calendar.value);
  });

  it("basket: the tokens MaatConfig.basket() lists, in order, each with a measured premium", () => {
    const body = /function basket\(\)[^{]*\{([\s\S]*?)\n\s*\}/.exec(config)?.[1];
    if (!body) throw new Error("basket() not found in contracts/script/MaatConfig.sol");
    const listed = [...body.matchAll(/toks\[\d+\]\s*=\s*A\.(\w+);/g)].map((m) => m[1]);
    expect(listed).toEqual(FACTS.basket.value.map((s) => s.toUpperCase()));
    expect(Object.keys(FACTS.premiumsBps.value).sort()).toEqual([...FACTS.basket.value].sort());
  });

  it("the fork vault starts with $200 USDC: owner.fund() in the fork deploy", () => {
    const funds = [...forkDeploy.matchAll(/functionName:\s*"fund",\s*args:\s*\[([\d_]+)n\]/g)].map((m) =>
      solidityNumber(m[1] ?? ""),
    );
    expect(funds).toEqual([FACTS.forkVaultUsd.value * 1e6]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/facts.test.ts`
Expected: FAIL. `FACTS.calendar` and `FACTS.basket` are undefined (`TypeError` or a `toEqual` mismatch).

- [ ] **Step 3: Add the facts**

In `web/content/facts.ts`, after `interface MandateFacts`:

```ts
export interface Holiday {
  /** ET date, "YYYY-MM-DD". */
  date: string;
  name: string;
}

export interface EarlyClose {
  /** ET date, "YYYY-MM-DD". */
  date: string;
  /** Minutes after midnight ET. */
  closeMin: number;
}
```

At the end of the `FACTS` object, after `feedEdgeMin`:

```ts
  calendar: fact<{ holidays: readonly Holiday[]; earlyCloses: readonly EarlyClose[] }>(
    {
      holidays: [
        { date: "2026-11-26", name: "Thanksgiving" },
        { date: "2026-12-25", name: "Christmas" },
        { date: "2027-01-01", name: "New Year" },
      ],
      earlyCloses: [
        { date: "2026-11-27", closeMin: 780 },
        { date: "2026-12-24", closeMin: 780 },
      ],
    },
    "contracts/src/MarketCalendar.sol constructor: _addHoliday (names from its comments) and _setEarlyClose",
  ),
  basket: fact(["NVDAc", "GOOGLc", "AAPLc"] as const, "contracts/script/MaatConfig.sol basket(), in listing order"),
  forkVaultUsd: fact(
    200,
    "agent/test/integration/deploy.ts: owner.fund(200_000_000n), the USDC the fork vault starts with",
  ),
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run test/facts.test.ts`
Expected: PASS, including "every fact names its source" for the three new facts.

- [ ] **Step 5: Commit**

```bash
git add web/content/facts.ts web/test/facts.test.ts
git commit -m "feat(web): calendar, basket and fork vault facts, parity-tested"
```

---

### Task 2: Calendar port

**Files:**
- Create: `web/content/calendar.ts`
- Test: `web/test/calendar.test.ts`

**Interfaces:**
- Consumes: `FACTS.calendar`, `FACTS.nyseSessionMin`, `FACTS.forkDay` (Task 1).
- Produces:
  - `DAY_SECONDS = 86_400`
  - `daysFromCivil(y, m, d): number`, `civilFromDays(n): [y, m, d]`, `weekday(n): number` (0 = Sunday), `nthSunday(y, m, n): number`
  - `DST = { start: { month: 3, nth: 2, hourUtc: 7 }, end: { month: 11, nth: 1, hourUtc: 6 } }`
  - `etOffsetSeconds(ts): number`
  - `interface LocalTime { etDay: number; weekday: number; minuteOfDay: number }`, `localTime(ts): LocalTime`
  - `etToTimestamp(etDay, minuteOfDay): number`
  - `parseIsoDay(iso): number | undefined`, `isoOfDay(n): string`
  - `holidayName(etDay): string | undefined`
  - `sessionWindow(etDay): { openMin: number; closeMin: number } | undefined`
  - `type Session` (the union below), `regularSession(ts): Session`
  - `WINDOW: { first: number; last: number }` (ET day numbers)
  - `WEEKDAY_NAMES: readonly ["Sunday", ..., "Saturday"]`

- [ ] **Step 1: Write the failing tests**

Create `web/test/calendar.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  civilFromDays,
  DST,
  daysFromCivil,
  etOffsetSeconds,
  etToTimestamp,
  isoOfDay,
  localTime,
  nthSunday,
  parseIsoDay,
  regularSession,
  sessionWindow,
  WINDOW,
  weekday,
} from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { readRepo } from "./helpers/solidity";

const source = readRepo("contracts/src/MarketCalendar.sol");
const foundry = readRepo("contracts/test/MarketCalendar.t.sol");

/** The body of one Foundry test function (its closing brace is indented four spaces). */
function testBody(name: string): string {
  const m = new RegExp(`function ${name}\\(\\)[^{]*\\{([\\s\\S]*?)\\n\\s{4}\\}`).exec(foundry);
  if (!m?.[1]) throw new Error(`${name} not found in contracts/test/MarketCalendar.t.sol`);
  return m[1];
}

const STAMPS = new Map(
  [...foundry.matchAll(/uint256 internal constant (\w+) = (\d+);/g)].map((m) => [m[1] ?? "", Number(m[2])]),
);
function stamp(name = ""): number {
  const ts = STAMPS.get(name);
  if (ts === undefined) throw new Error(`no constant ${name} in contracts/test/MarketCalendar.t.sol`);
  return ts;
}

const day = (iso: string): number => {
  const d = parseIsoDay(iso);
  if (d === undefined) throw new Error(`bad test date ${iso}`);
  return d;
};

describe("calendar port: parity with MarketCalendar.sol", () => {
  it("uses the DST rule of etOffsetSeconds", () => {
    const rule = (name: string) => {
      const m = new RegExp(
        `${name}\\s*=\\s*DateLib\\.nthSunday\\(y,\\s*(\\d+),\\s*(\\d+)\\)\\s*\\*\\s*1 days\\s*\\+\\s*(\\d+) hours`,
      ).exec(source);
      if (!m) throw new Error(`${name} not found in MarketCalendar.etOffsetSeconds`);
      return { month: Number(m[1]), nth: Number(m[2]), hourUtc: Number(m[3]) };
    };
    expect({ start: rule("dstStart"), end: rule("dstEnd") }).toEqual(DST);
    expect(source).toMatch(/\?\s*4 hours\s*:\s*5 hours/);
  });

  describe("runs the Foundry vectors of contracts/test/MarketCalendar.t.sol", () => {
    it("DateLib", () => {
      const civil = [...testBody("test_daysFromCivil").matchAll(/daysFromCivil\((\d+), (\d+), (\d+)\), (\d+)\)/g)];
      expect(civil.length).toBeGreaterThan(0);
      for (const [, y, m, d, n] of civil) expect(daysFromCivil(Number(y), Number(m), Number(d))).toBe(Number(n));

      const back = [
        ...testBody("test_civilFromDaysRoundTrip").matchAll(
          /civilFromDays\((\d+)\);\s*assertEq\(y, (\d+)\);\s*assertEq\(m, (\d+)\);\s*assertEq\(d, (\d+)\);/g,
        ),
      ];
      expect(back.length).toBeGreaterThan(0);
      for (const [, n, y, m, d] of back) expect(civilFromDays(Number(n))).toEqual([Number(y), Number(m), Number(d)]);

      const body = testBody("test_weekdayAndNthSunday");
      const days = [...body.matchAll(/weekday\((\d+)\), (\d+)\)/g)];
      const sundays = [...body.matchAll(/nthSunday\((\d+), (\d+), (\d+)\), (\d+)\)/g)];
      expect(days.length * sundays.length).toBeGreaterThan(0);
      for (const [, n, w] of days) expect(weekday(Number(n))).toBe(Number(w));
      for (const [, y, m, k, n] of sundays) expect(nthSunday(Number(y), Number(m), Number(k))).toBe(Number(n));
    });

    it("etOffsetSeconds at the DST boundaries", () => {
      const vectors = [...testBody("test_dstBoundaries").matchAll(/etOffsetSeconds\((\d+)\), (\d+) hours\)/g)];
      expect(vectors.length).toBeGreaterThan(0);
      for (const [, ts, h] of vectors) expect(etOffsetSeconds(Number(ts)), ts).toBe(Number(h) * 3600);
    });

    // Only the tests that use the constructor's calendar: test_ownerCanOnlyMakeItStricter adds a holiday mid-test.
    it.each(["test_regularSession", "test_holidaysAndEarlyClose"])("isOpen(ts, REGULAR) in %s", (name) => {
      const vectors = [...testBody(name).matchAll(/assert(True|False)\(cal\.isOpen\((\w+), SessionMode\.REGULAR\)\)/g)];
      expect(vectors.length).toBeGreaterThan(0);
      for (const [, want, ts] of vectors) expect(regularSession(stamp(ts)).open, ts).toBe(want === "True");
    });
  });
});

describe("calendar port", () => {
  it("puts the fork block at the fork day and time in New York", () => {
    // contracts/script/BaseAddresses.sol, BLOCK_SESSION: Thu 2026-11-05 15:30 UTC (10:30 ET).
    const t = localTime(Date.UTC(2026, 10, 5, 15, 30) / 1000);
    expect(t).toEqual({ etDay: day(FACTS.forkDay.value), weekday: 4, minuteOfDay: 630 });
  });

  it("round-trips the minutes that matter on every day of the window", () => {
    for (let d = WINDOW.first; d <= WINDOW.last; d++) {
      for (const minute of [0, 569, 570, 779, 780, 959, 960, 1199, 1200, 1439]) {
        const t = localTime(etToTimestamp(d, minute));
        expect([t.etDay, t.minuteOfDay]).toEqual([d, minute]);
      }
    }
  });

  it("maps the DST changes like a wall clock", () => {
    // 1 Nov 2026 01:30 ET happens twice; the first one is EDT, 05:30 UTC.
    expect(etToTimestamp(day("2026-11-01"), 90)).toBe(Date.UTC(2026, 10, 1, 5, 30) / 1000);
    // 8 Mar 2026 02:30 ET never happens; it comes out as 03:30 EDT.
    expect(localTime(etToTimestamp(day("2026-03-08"), 150)).minuteOfDay).toBe(210);
  });

  it("reads and writes ISO dates, and rejects the rest", () => {
    expect(parseIsoDay("2026-11-26")).toBe(20783);
    expect(isoOfDay(20783)).toBe("2026-11-26");
    for (const bad of ["2026-13-01", "2026-02-30", "26-11-2026", "", "2026-11-5"]) {
      expect(parseIsoDay(bad), bad).toBeUndefined();
    }
  });

  it("offers the fork day through the last date the calendar lists", () => {
    expect([isoOfDay(WINDOW.first), isoOfDay(WINDOW.last)]).toEqual([FACTS.forkDay.value, "2027-01-01"]);
  });

  it("says why the market is closed, checking in the contract's order", () => {
    const at = (iso: string, minute: number) => regularSession(etToTimestamp(day(iso), minute));
    expect(at("2026-11-05", 630)).toEqual({ open: true, closeMin: 960 });
    expect(at("2026-11-07", 630)).toEqual({ open: false, why: "weekend" });
    expect(at("2026-11-26", 630)).toEqual({ open: false, why: "holiday", holiday: "Thanksgiving" });
    expect(at("2026-11-05", 569)).toEqual({ open: false, why: "before-open", openMin: 570 });
    expect(at("2026-11-05", 960)).toEqual({ open: false, why: "after-close", closeMin: 960 });
    expect(at("2026-11-27", 779)).toEqual({ open: true, closeMin: 780 });
    expect(at("2026-11-27", 780)).toEqual({ open: false, why: "after-close", closeMin: 780 });
  });

  it("gives the session of a day, or nothing when NYSE is closed all day", () => {
    expect(sessionWindow(day("2026-11-05"))).toEqual({ openMin: 570, closeMin: 960 });
    expect(sessionWindow(day("2026-11-27"))).toEqual({ openMin: 570, closeMin: 780 });
    expect(sessionWindow(day("2026-11-07"))).toBeUndefined();
    expect(sessionWindow(day("2026-12-25"))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/calendar.test.ts`
Expected: FAIL with "Failed to resolve import @/content/calendar".

- [ ] **Step 3: Write the port**

Create `web/content/calendar.ts`:

```ts
import { FACTS } from "./facts";

/**
 * contracts/src/lib/DateLib.sol and contracts/src/MarketCalendar.sol, REGULAR mode only.
 * test/calendar.test.ts runs the Foundry vectors of contracts/test/MarketCalendar.t.sol through this file.
 */

export const DAY_SECONDS = 86_400;
const HOUR = 3600;

/** Integer division as Solidity's int256 does it: toward zero. */
const div = (a: number, b: number) => Math.trunc(a / b);

/** DateLib.daysFromCivil: the day number of a date, day 0 = 1970-01-01. */
export function daysFromCivil(y: number, m: number, d: number): number {
  const yy = y - (m <= 2 ? 1 : 0);
  const era = div(yy >= 0 ? yy : yy - 399, 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12; // March = 0
  const doy = div(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + div(yoe, 4) - div(yoe, 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** DateLib.civilFromDays. */
export function civilFromDays(dayNumber: number): [y: number, m: number, d: number] {
  const z = dayNumber + 719_468;
  const era = div(z, 146_097);
  const doe = z - era * 146_097;
  const yoe = div(doe - div(doe, 1460) + div(doe, 36_524) - div(doe, 146_096), 365);
  const yy = yoe + era * 400;
  const doy = doe - (365 * yoe + div(yoe, 4) - div(yoe, 100));
  const mp = div(5 * doy + 2, 153);
  const d = doy - div(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? yy + 1 : yy, m, d];
}

/** DateLib.weekday: 0 = Sunday ... 6 = Saturday. */
export function weekday(dayNumber: number): number {
  return (dayNumber + 4) % 7;
}

/** DateLib.nthSunday: the day number of the n-th (1-based) Sunday of month m. */
export function nthSunday(y: number, m: number, n: number): number {
  const first = daysFromCivil(y, m, 1);
  return first + ((7 - weekday(first)) % 7) + (n - 1) * 7;
}

/** The US DST rule in etOffsetSeconds: from the 2nd Sunday of March 07:00 UTC to the 1st Sunday of November 06:00 UTC. */
export const DST = {
  start: { month: 3, nth: 2, hourUtc: 7 },
  end: { month: 11, nth: 1, hourUtc: 6 },
} as const;

/** MarketCalendar.etOffsetSeconds: seconds to subtract from UTC, 4 h during US DST and 5 h otherwise. */
export function etOffsetSeconds(ts: number): number {
  const [y] = civilFromDays(Math.floor(ts / DAY_SECONDS));
  const start = nthSunday(y, DST.start.month, DST.start.nth) * DAY_SECONDS + DST.start.hourUtc * HOUR;
  const end = nthSunday(y, DST.end.month, DST.end.nth) * DAY_SECONDS + DST.end.hourUtc * HOUR;
  return ts >= start && ts < end ? 4 * HOUR : 5 * HOUR;
}

export interface LocalTime {
  /** ET day number. */
  etDay: number;
  weekday: number;
  minuteOfDay: number;
}

/** MarketCalendar.localTime. */
export function localTime(ts: number): LocalTime {
  const local = ts - etOffsetSeconds(ts);
  const etDay = Math.floor(local / DAY_SECONDS);
  return { etDay, weekday: weekday(etDay), minuteOfDay: Math.floor((local % DAY_SECONDS) / 60) };
}

/**
 * The UTC timestamp of an ET wall-clock minute: the inverse of localTime, which the contract never needs.
 * In the hour that repeats when DST ends it returns the first (EDT) instant; a minute skipped when DST
 * starts comes out an hour later, as on a clock that springs forward.
 */
export function etToTimestamp(etDay: number, minuteOfDay: number): number {
  const local = etDay * DAY_SECONDS + minuteOfDay * 60;
  for (const offset of [4 * HOUR, 5 * HOUR]) {
    if (etOffsetSeconds(local + offset) === offset) return local + offset;
  }
  return local + 5 * HOUR;
}

export function isoOfDay(dayNumber: number): string {
  const [y, m, d] = civilFromDays(dayNumber);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2026-11-26" to its day number, or undefined when it is not a real date. */
export function parseIsoDay(iso: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const dayNumber = daysFromCivil(Number(m[1]), Number(m[2]), Number(m[3]));
  return isoOfDay(dayNumber) === iso ? dayNumber : undefined;
}

function dayOf(iso: string): number {
  const dayNumber = parseIsoDay(iso);
  if (dayNumber === undefined) throw new Error(`not a date: ${iso}`);
  return dayNumber;
}

const OPEN = FACTS.nyseSessionMin.value.open;
const CLOSE = FACTS.nyseSessionMin.value.close;
const HOLIDAYS = new Map(FACTS.calendar.value.holidays.map((h) => [dayOf(h.date), h.name]));
const EARLY_CLOSES = new Map(FACTS.calendar.value.earlyCloses.map((e) => [dayOf(e.date), e.closeMin]));

export function holidayName(etDay: number): string | undefined {
  return HOLIDAYS.get(etDay);
}

/** The REGULAR session of an ET day, or undefined when NYSE is closed all day. */
export function sessionWindow(etDay: number): { openMin: number; closeMin: number } | undefined {
  const wd = weekday(etDay);
  if (HOLIDAYS.has(etDay) || wd === 0 || wd === 6) return undefined;
  return { openMin: OPEN, closeMin: EARLY_CLOSES.get(etDay) ?? CLOSE };
}

export type Session =
  | { open: true; closeMin: number }
  | { open: false; why: "holiday"; holiday: string }
  | { open: false; why: "weekend" }
  | { open: false; why: "before-open"; openMin: number }
  | { open: false; why: "after-close"; closeMin: number };

/** MarketCalendar.isOpen(ts, REGULAR), with the reason when it is closed, checked in the contract's order. */
export function regularSession(ts: number): Session {
  const { etDay, weekday: wd, minuteOfDay } = localTime(ts);
  const holiday = HOLIDAYS.get(etDay);
  if (holiday !== undefined) return { open: false, why: "holiday", holiday };
  if (wd === 0 || wd === 6) return { open: false, why: "weekend" };
  const closeMin = EARLY_CLOSES.get(etDay) ?? CLOSE;
  if (minuteOfDay < OPEN) return { open: false, why: "before-open", openMin: OPEN };
  if (minuteOfDay >= closeMin) return { open: false, why: "after-close", closeMin };
  return { open: true, closeMin };
}

/** The dates the simulator offers: from the fork day to the last date the calendar lists. */
export const WINDOW = {
  first: dayOf(FACTS.forkDay.value),
  last: Math.max(...HOLIDAYS.keys(), ...EARLY_CLOSES.keys()),
} as const;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run test/calendar.test.ts`
Expected: PASS (all Foundry vectors included).

- [ ] **Step 5: Commit**

```bash
git add web/content/calendar.ts web/test/calendar.test.ts
git commit -m "feat(web): port MarketCalendar to TypeScript, checked against its Foundry vectors"
```

---

### Task 3: Simulator logic

**Files:**
- Modify: `web/content/format.ts`
- Create: `web/content/simulator.ts`
- Test: `web/test/format.test.ts`, `web/test/simulator.test.ts`

**Interfaces:**
- Consumes: Task 2's calendar exports; `CHECK_LABELS`, `EngineCheck` (`engine.ts`); `getDecisions` (`decisions.ts`); `FACTS`.
- Produces (format.ts): `minuteOfClock("10:30"): 630`, `andList(["a","b","c"]): "a, b and c"`.
- Produces (simulator.ts):
  - `type BasketToken`, `type SimToken = BasketToken | "OTHER"`, `TOKENS: readonly SimToken[]`, `tokenLabel(t): string`
  - `interface SimIntent { token: SimToken; usd6: number; minute: number }`
  - `interface TapeEntry { intent: SimIntent; allowed: boolean; reason: ReasonCode }`
  - `interface SimDay { etDay: number; tape: readonly TapeEntry[] }`
  - `interface SimCheck extends EngineCheck { fixed: boolean }`
  - `interface SimResult { checks: readonly SimCheck[]; balance?: string; allowed: boolean; reason: ReasonCode }`
  - `MAX_TAPE = 10`, `AMOUNT_CHIPS_USD = [10, 20, 50, 51, 100]`
  - `evaluate(day, intent): SimResult`, `execute(day, intent): SimDay`, `replay(etDay, intents): SimDay`
  - `interface DaySummary { spent6: number; weightBps: Record<BasketToken, number> }`, `daySummary(day): DaySummary`
  - `formatUsd(usd6): string`, `amountText(usd6): string`, `parseUsd(text): number | undefined`
  - `simIntentLabel(i): string`, `momentLabel(etDay, minute): string`, `dayNote(etDay): string`
  - `interface Preset { id; label; etDay; minute }`, `PRESETS: readonly Preset[]`
  - `interface Scenario { etDay: number; intent: SimIntent; tape: readonly SimIntent[] }`, `DEFAULT_SCENARIO: Scenario`
  - `encodeScenario(s): string`, `decodeScenario(search): Scenario`
  - `postText(s, r): string`, `postUrl(text, link): string`

- [ ] **Step 1: Write the failing format tests**

In `web/test/format.test.ts`, extend the import to `import { andList, clockLabel, dayLabel, formatInt, minuteOfClock, numberWord } from "@/content/format";` and add inside the `describe`:

```ts
  it("reads a 24 h clock back into minutes", () => {
    expect([minuteOfClock("10:30"), minuteOfClock("00:00"), minuteOfClock("23:59")]).toEqual([630, 0, 1439]);
    for (const bad of ["24:00", "9:30", "10:60", ""]) expect(() => minuteOfClock(bad), bad).toThrow();
  });

  it("joins a list the way the copy reads", () => {
    expect([andList([]), andList(["a"]), andList(["a", "b"]), andList(["a", "b", "c"])]).toEqual([
      "",
      "a",
      "a and b",
      "a, b and c",
    ]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/format.test.ts`
Expected: FAIL, `minuteOfClock is not a function`.

- [ ] **Step 3: Add the helpers to `web/content/format.ts`**

```ts
/** "HH:MM" (24 h) → minutes after midnight: the inverse of clockLabel. */
export function minuteOfClock(label: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(label);
  if (!m) throw new Error(`not a 24 h clock time (HH:MM): ${label}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** ["a", "b", "c"] → "a, b and c". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
```

Run: `npx vitest run test/format.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing simulator tests**

Create `web/test/simulator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isoOfDay, parseIsoDay, WINDOW } from "@/content/calendar";
import { getDecisions } from "@/content/decisions";
import { CHECK_LABELS, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { minuteOfClock } from "@/content/format";
import {
  AMOUNT_CHIPS_USD,
  amountText,
  DEFAULT_SCENARIO,
  daySummary,
  dayNote,
  decodeScenario,
  encodeScenario,
  evaluate,
  execute,
  formatUsd,
  MAX_TAPE,
  momentLabel,
  PRESETS,
  parseUsd,
  postText,
  postUrl,
  replay,
  type SimIntent,
  type SimResult,
  type SimToken,
  simIntentLabel,
} from "@/content/simulator";

const THU = "2026-11-05";
const day = (iso: string): number => {
  const d = parseIsoDay(iso);
  if (d === undefined) throw new Error(`bad test date ${iso}`);
  return d;
};
const buy = (token: SimToken, usd: number, at = "10:30"): SimIntent => ({
  token,
  usd6: Math.round(usd * 100) * 10_000,
  minute: minuteOfClock(at),
});
const on = (iso: string, before: SimIntent[] = []) => replay(day(iso), before);
const marks = (r: SimResult) => r.checks.map((c) => c.mark);
const failAt = (r: SimResult) => r.checks.findIndex((c) => c.mark === "FAIL");

describe("simulator: one BUY against the default mandate", () => {
  it("allows the fork's BUY at the fork moment, all nine checks passing", () => {
    const r = evaluate(on(THU), buy("NVDAc", 20));
    expect([r.allowed, r.reason, r.balance]).toEqual([true, "OK", undefined]);
    expect(r.checks.map((c) => c.label)).toEqual([...CHECK_LABELS]);
    expect(r.checks.map((c) => [c.mark, c.detail])).toEqual([
      ["PASS", "NVDAc in mandate"],
      ["PASS", "transfers active"],
      ["PASS", "authorized"],
      ["PASS", "Thursday · open until 16:00"],
      ["PASS", "14s ≤ 3600s"],
      ["PASS", "no change 24h"],
      ["PASS", "53 ≤ 100 bps"],
      ["PASS", "$20 ≤ $50 · $20 of $100 today"],
      ["PASS", "NVDAc 10% ≤ 40%"],
    ]);
    expect(r.checks.map((c) => c.fixed)).toEqual([false, true, true, false, true, true, true, false, false]);
  });

  it("refuses a token outside the mandate at check 1", () => {
    const r = evaluate(on(THU), buy("OTHER", 20));
    expect([r.allowed, r.reason]).toEqual([false, "TOKEN_NOT_ALLOWED"]);
    expect(marks(r)).toEqual(["FAIL", ...Array(8).fill("SKIP")]);
    expect(r.checks[0]?.detail).toBe("not in the mandate");
    expect(r.checks.slice(1).every((c) => c.detail === "not reached")).toBe(true);
  });

  it.each([
    ["Saturday", "2026-11-07", "10:30", "Saturday · NYSE closed"],
    ["Sunday", "2026-11-08", "10:30", "Sunday · NYSE closed"],
    ["Thanksgiving", "2026-11-26", "10:30", "Thanksgiving · NYSE closed"],
    ["Christmas", "2026-12-25", "10:30", "Christmas · NYSE closed"],
    ["before the open", THU, "09:29", "09:29 · opens 09:30"],
    ["at the close", THU, "16:00", "16:00 · closed at 16:00"],
    ["Friday evening", "2026-11-06", "19:00", "19:00 · closed at 16:00"],
    ["at an early close", "2026-11-27", "13:00", "13:00 · early close 13:00"],
  ])("refuses at check 4 when the market is closed: %s", (_name, iso, at, detail) => {
    const r = evaluate(on(iso), buy("NVDAc", 20, at));
    expect([r.allowed, r.reason, failAt(r)]).toEqual([false, "MARKET_CLOSED", 3]);
    expect(r.checks[3]?.detail).toBe(detail);
    expect(marks(r).slice(4)).toEqual(Array(5).fill("SKIP"));
  });

  it.each([
    [THU, "09:30", "Thursday · open until 16:00"],
    [THU, "15:59", "Thursday · open until 16:00"],
    ["2026-11-27", "12:59", "Friday · open until 13:00"],
  ])("is open on %s at %s", (iso, at, detail) => {
    const r = evaluate(on(iso), buy("GOOGLc", 10, at));
    expect(r.reason).toBe("OK");
    expect(r.checks[3]?.detail).toBe(detail);
  });

  it("shows each token's measured premium", () => {
    expect(evaluate(on(THU), buy("GOOGLc", 10)).checks[6]?.detail).toBe("49 ≤ 100 bps");
    expect(evaluate(on(THU), buy("AAPLc", 10)).checks[6]?.detail).toBe("29 ≤ 100 bps");
  });

  it.each([
    ["a zero amount", 0, "amount is zero"],
    ["more than the vault holds", 250, "$250 > $200 USDC"],
  ])("checks the balance between checks 7 and 8: %s", (_name, usd, balance) => {
    const r = evaluate(on(THU), buy("NVDAc", usd));
    expect([r.allowed, r.reason, r.balance]).toEqual([false, "INSUFFICIENT_BALANCE", balance]);
    expect(marks(r)).toEqual([...Array(7).fill("PASS"), "SKIP", "SKIP"]);
  });

  it("refuses past the per-trade cap at check 8, to the cent", () => {
    const r = evaluate(on(THU), buy("NVDAc", 51));
    expect([r.reason, failAt(r), r.checks[7]?.detail]).toEqual(["SIZE_LIMIT", 7, "$51 > $50 per trade"]);
    expect(evaluate(on(THU), buy("NVDAc", 50.01)).reason).toBe("SIZE_LIMIT");
    expect(evaluate(on(THU), buy("NVDAc", 50)).reason).toBe("OK");
  });
});

describe("simulator: one day of trades", () => {
  it("refuses past the daily cap once allowed buys add up", () => {
    const r = evaluate(on(THU, [buy("NVDAc", 50), buy("GOOGLc", 50)]), buy("AAPLc", 1));
    expect([r.reason, failAt(r), r.checks[7]?.detail]).toEqual(["SIZE_LIMIT", 7, "$101 > $100 today"]);
  });

  it("refuses a buy that would push one stock past 40%", () => {
    const r = evaluate(on(THU, [buy("NVDAc", 50)]), buy("NVDAc", 50));
    expect([r.reason, failAt(r)]).toEqual(["CONCENTRATION", 8]);
    expect(r.checks[7]?.detail).toBe("$50 ≤ $50 · $100 of $100 today");
    expect(r.checks[8]?.detail).toBe("NVDAc 50% > 40%");
  });

  it("allows a weight of exactly 40%", () => {
    const r = evaluate(on(THU, [buy("NVDAc", 50)]), buy("NVDAc", 30));
    expect([r.reason, r.checks[8]?.detail]).toEqual(["OK", "NVDAc 40% ≤ 40%"]);
  });

  it("logs refusals without moving money", () => {
    const d = on(THU, [buy("OTHER", 50), buy("NVDAc", 51), buy("NVDAc", 20, "17:00")]);
    expect(d.tape.map((e) => e.reason)).toEqual(["TOKEN_NOT_ALLOWED", "SIZE_LIMIT", "MARKET_CLOSED"]);
    expect(daySummary(d).spent6).toBe(0);
    expect(evaluate(d, buy("NVDAc", 50)).checks[7]?.detail).toBe("$50 ≤ $50 · $50 of $100 today");
  });

  it("recomputes every verdict when it rebuilds a day", () => {
    const d = on(THU, [buy("NVDAc", 50), buy("NVDAc", 50), buy("GOOGLc", 50)]);
    expect(d.tape.map((e) => [e.allowed, e.reason])).toEqual([
      [true, "OK"],
      [false, "CONCENTRATION"],
      [true, "OK"],
    ]);
    expect(daySummary(d)).toEqual({ spent6: 100_000_000, weightBps: { NVDAc: 2500, GOOGLc: 2500, AAPLc: 0 } });
  });

  it(`keeps at most ${MAX_TAPE} entries`, () => {
    const full = on(THU, Array.from({ length: MAX_TAPE }, () => buy("OTHER", 1)));
    expect(full.tape).toHaveLength(MAX_TAPE);
    expect(execute(full, buy("NVDAc", 1))).toBe(full);
  });
});

describe("simulator: parity with the Decision engine replay", () => {
  const fork = day(FACTS.forkDay.value);
  const minute = minuteOfClock(FACTS.forkTimeEt.value);
  const forkBuy = (allowed: boolean): SimIntent => {
    const r = getDecisions().find((d) => d.source === "base-fork" && d.action === "BUY" && d.allowed === allowed);
    if (!r) throw new Error(`the fork ledger has no ${allowed ? "allowed" : "refused"} BUY`);
    return { token: r.symbol as SimToken, usd6: r.amountUsd * 1_000_000, minute };
  };

  it("gives the Thursday moment for the fork's allowed BUY", () => {
    const r = evaluate(replay(fork, []), forkBuy(true));
    expect([marks(r), r.reason]).toEqual([MOMENTS.thu.checks.map((c) => c.mark), MOMENTS.thu.reason]);
  });

  it("gives the Saturday moment for the refused BUY two days later", () => {
    const r = evaluate(replay(fork + FACTS.weekendOffsetDays.value, []), forkBuy(false));
    expect([marks(r), r.reason]).toEqual([MOMENTS.sat.checks.map((c) => c.mark), MOMENTS.sat.reason]);
    expect(r.checks[3]?.detail).toBe(MOMENTS.sat.checks[3]?.detail);
  });

  it("opens on the Thursday moment", () => {
    expect(DEFAULT_SCENARIO).toEqual({ etDay: fork, intent: forkBuy(true), tape: [] });
  });
});

describe("simulator: presets and copy", () => {
  it("offers the moments of the brief, all inside the window", () => {
    expect(PRESETS.map((p) => [p.label, isoOfDay(p.etDay), p.minute])).toEqual([
      ["Thu 5 Nov · 10:30", "2026-11-05", 630],
      ["Sat 7 Nov", "2026-11-07", 630],
      ["Fri 6 Nov · 19:00", "2026-11-06", 1140],
      ["Thanksgiving", "2026-11-26", 630],
      ["Fri 27 Nov · 13:30", "2026-11-27", 810],
    ]);
    for (const p of PRESETS) expect(p.etDay >= WINDOW.first && p.etDay <= WINDOW.last, p.id).toBe(true);
  });

  it("offers amounts on either side of the caps", () => {
    expect(AMOUNT_CHIPS_USD).toEqual([10, 20, 50, 51, 100]);
  });

  it("labels an intent, a moment and a day", () => {
    expect(simIntentLabel(buy("OTHER", 12.5))).toBe("BUY Other token · $12.50");
    expect(momentLabel(day(THU), 630)).toBe("Thu 5 Nov · 10:30 ET");
    expect(dayNote(day(THU))).toBe("Thursday");
    expect(dayNote(day("2026-11-07"))).toBe("Saturday · closed all day");
    expect(dayNote(day("2026-11-26"))).toBe("Thursday · Thanksgiving, closed all day");
    expect(dayNote(day("2026-11-27"))).toBe("Friday · closes 13:00");
  });

  it("reads amounts the way people type them", () => {
    expect(["50", "$1,000", " 20 ", "12.5", "50.", "0", "999999999.99"].map((t) => parseUsd(t))).toEqual([
      50e6, 1000e6, 20e6, 12.5e6, 50e6, 0, 999_999_999.99e6,
    ]);
    for (const bad of ["", "abc", "-5", "1e5", "0.001", "1234567890", ".5"]) expect(parseUsd(bad), bad).toBeUndefined();
  });

  it("formats dollars like the rest of the page", () => {
    expect([formatUsd(50e6), formatUsd(12.5e6), formatUsd(1000e6), formatUsd(0)]).toEqual(["$50", "$12.50", "$1,000", "$0"]);
    expect([amountText(50e6), amountText(12.5e6)]).toEqual(["50", "12.50"]);
  });

  it("writes the post for a refusal and for a yes", () => {
    const sat = { ...DEFAULT_SCENARIO, etDay: day("2026-11-07"), intent: buy("NVDAc", 50) };
    expect(postText(sat, evaluate(replay(sat.etDay, []), sat.intent))).toBe(
      "I tried to buy $50 of NVDAc on Sat 7 Nov at 10:30 ET. Maat said no: MARKET_CLOSED.",
    );
    expect(postText(DEFAULT_SCENARIO, { allowed: true, reason: "OK" })).toBe(
      "I asked Maat to buy $20 of NVDAc on Thu 5 Nov at 10:30 ET. All nine checks passed. Can you make it say no?",
    );
    expect(postText({ ...DEFAULT_SCENARIO, intent: buy("OTHER", 5) }, { allowed: false, reason: "TOKEN_NOT_ALLOWED" })).toContain(
      "$5 of a token outside the mandate",
    );
  });

  it("links to X's post intent, adding the share link once it is absolute", () => {
    expect(postUrl("a b", "https://maat.example/?day=2026-11-07#try")).toBe(
      "https://x.com/intent/post?text=a%20b&url=https%3A%2F%2Fmaat.example%2F%3Fday%3D2026-11-07%23try",
    );
    expect(postUrl("a b", "?day=2026-11-07#try")).toBe("https://x.com/intent/post?text=a%20b");
  });
});

describe("simulator: share links", () => {
  it("writes the default scenario", () => {
    expect(encodeScenario(DEFAULT_SCENARIO)).toBe("?day=2026-11-05&at=1030&buy=NVDAc-20");
  });

  it("round-trips a day with a tape", () => {
    const s = {
      etDay: day("2026-11-27"),
      intent: buy("OTHER", 12.5, "13:30"),
      tape: [buy("NVDAc", 50, "09:30"), buy("AAPLc", 0.99, "12:59")],
    };
    expect(encodeScenario(s)).toBe("?day=2026-11-27&at=1330&buy=other-12.50&tape=0930-NVDAc-50,1259-AAPLc-0.99");
    expect(decodeScenario(encodeScenario(s))).toEqual(s);
  });

  it("falls back to the default, field by field", () => {
    expect(decodeScenario("")).toEqual(DEFAULT_SCENARIO);
    expect(decodeScenario("?day=2031-01-01&at=2400&buy=TSLA-5")).toEqual(DEFAULT_SCENARIO);
    expect(decodeScenario("?day=2026-11-04")).toEqual(DEFAULT_SCENARIO);
    expect(decodeScenario("?day=2026-11-07&buy=NVDAc-abc")).toEqual({ ...DEFAULT_SCENARIO, etDay: day("2026-11-07") });
    expect(decodeScenario("?tape=1030-NVDAc-50,junk,0960-NVDAc-5,1031-AAPLc-1").tape).toEqual([
      buy("NVDAc", 50),
      buy("AAPLc", 1, "10:31"),
    ]);
  });

  it(`keeps the first ${MAX_TAPE} entries of a long tape, and reads encoded commas`, () => {
    const tape = Array.from({ length: MAX_TAPE + 2 }, (_, i) => `1030-NVDAc-${i + 1}`).join(",");
    expect(decodeScenario(`?tape=${tape}`).tape).toHaveLength(MAX_TAPE);
    expect(decodeScenario("?tape=1030-NVDAc-50%2C1031-AAPLc-1").tape).toHaveLength(2);
  });
});
```

- [ ] **Step 5: Run them to verify they fail**

Run: `npx vitest run test/simulator.test.ts`
Expected: FAIL with "Failed to resolve import @/content/simulator".

- [ ] **Step 6: Write `web/content/simulator.ts`**

```ts
import {
  DAY_SECONDS,
  etToTimestamp,
  holidayName,
  isoOfDay,
  type LocalTime,
  localTime,
  parseIsoDay,
  regularSession,
  type Session,
  sessionWindow,
  WEEKDAY_NAMES,
  WINDOW,
  weekday,
} from "./calendar";
import { getDecisions } from "./decisions";
import { CHECK_LABELS, type EngineCheck } from "./engine";
import { FACTS } from "./facts";
import { clockLabel, dayLabel, minuteOfClock, numberWord } from "./format";
import type { ReasonCode, RefusalCode } from "./reasons";

/**
 * BUY intents against the default mandate, one ET day at a time (spec 2026-11-08 §3). Only what can be decided
 * offline is computed; checks 2, 3, 5, 6 and 7 hold the fork's values. The contract is the source of truth.
 */

export type BasketToken = (typeof FACTS.basket.value)[number];
export type SimToken = BasketToken | "OTHER";

export const TOKENS: readonly SimToken[] = [...FACTS.basket.value, "OTHER"];

export function tokenLabel(t: SimToken): string {
  return t === "OTHER" ? "Other token" : t;
}

function isBasketToken(s: string): s is BasketToken {
  return (FACTS.basket.value as readonly string[]).includes(s);
}

export interface SimIntent {
  readonly token: SimToken;
  /** USDC in, 6 decimals, as the vault counts it. */
  readonly usd6: number;
  /** ET minute of the day. */
  readonly minute: number;
}

export interface TapeEntry {
  readonly intent: SimIntent;
  readonly allowed: boolean;
  readonly reason: ReasonCode;
}

export interface SimDay {
  /** ET day number, day 0 = 1970-01-01. */
  readonly etDay: number;
  readonly tape: readonly TapeEntry[];
}

export interface SimCheck extends EngineCheck {
  /** A fork value the simulator does not compute. */
  readonly fixed: boolean;
}

export interface SimResult {
  readonly checks: readonly SimCheck[];
  /** Set when the vault's balance check, between checks 7 and 8, refuses the intent. */
  readonly balance?: string;
  readonly allowed: boolean;
  readonly reason: ReasonCode;
}

const m = FACTS.mandate.value;
const USD6 = 1_000_000;
const BPS = 10_000;
const START6 = FACTS.forkVaultUsd.value * USD6;
const TRADE_CAP6 = m.perTradeCapUsd * USD6;
const DAILY_CAP6 = m.dailyCapUsd * USD6;

export const MAX_TAPE = 10;
/** $51 trips the per-trade cap; $100 trips both caps. */
export const AMOUNT_CHIPS_USD = [10, 20, m.perTradeCapUsd, m.perTradeCapUsd + 1, m.dailyCapUsd] as const;

/** 50_000_000 → "$50", 12_500_000 → "$12.50", 1_000_000_000 → "$1,000". */
export function formatUsd(usd6: number): string {
  const cents = Math.round(usd6 / 10_000);
  const digits = cents % 100 === 0 ? 0 : 2;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 50_000_000 → "50", 12_500_000 → "12.50": the amount field and share links. */
export function amountText(usd6: number): string {
  const cents = Math.round(usd6 / 10_000);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** An amount as people type it ("50", "$1,000", "12.5", "50.") in USDC with 6 decimals, or undefined. */
export function parseUsd(text: string): number | undefined {
  const match = /^(\d{1,9})(?:\.(\d{0,2}))?$/.exec(text.replace(/[$,\s]/g, ""));
  if (!match) return undefined;
  return Number(match[1]) * USD6 + Number((match[2] ?? "").padEnd(2, "0")) * 10_000;
}

const pct = (bps: number) => `${bps / 100}%`;

export function simIntentLabel(i: SimIntent): string {
  return `BUY ${tokenLabel(i.token)} · ${formatUsd(i.usd6)}`;
}

export function momentLabel(etDay: number, minute: number): string {
  return `${dayLabel(isoOfDay(etDay))} · ${clockLabel(minute)} ET`;
}

/** "Thursday", "Saturday · closed all day", "Thursday · Thanksgiving, closed all day", "Friday · closes 13:00". */
export function dayNote(etDay: number): string {
  const name = WEEKDAY_NAMES[weekday(etDay)] ?? "";
  const holiday = holidayName(etDay);
  if (holiday !== undefined) return `${name} · ${holiday}, closed all day`;
  const session = sessionWindow(etDay);
  if (!session) return `${name} · closed all day`;
  return session.closeMin < FACTS.nyseSessionMin.value.close ? `${name} · closes ${clockLabel(session.closeMin)}` : name;
}

function sessionDetail(s: Session, t: LocalTime): string {
  const name = WEEKDAY_NAMES[t.weekday] ?? "";
  const at = clockLabel(t.minuteOfDay);
  if (s.open) return `${name} · open until ${clockLabel(s.closeMin)}`;
  switch (s.why) {
    case "holiday":
      return `${s.holiday} · NYSE closed`;
    case "weekend":
      return `${name} · NYSE closed`;
    case "before-open":
      return `${at} · opens ${clockLabel(s.openMin)}`;
    case "after-close":
      return s.closeMin < FACTS.nyseSessionMin.value.close
        ? `${at} · early close ${clockLabel(s.closeMin)}`
        : `${at} · closed at ${clockLabel(s.closeMin)}`;
  }
}

interface Book {
  usdc6: number;
  held6: Record<BasketToken, number>;
}

/** The vault after the day's allowed buys, holdings at cost. */
function book(tape: readonly TapeEntry[]): Book {
  const held6 = Object.fromEntries(FACTS.basket.value.map((t) => [t, 0])) as Record<BasketToken, number>;
  let usdc6 = START6;
  for (const e of tape) {
    if (!e.allowed || e.intent.token === "OTHER") continue;
    held6[e.intent.token] += e.intent.usd6;
    usdc6 -= e.intent.usd6;
  }
  return { usdc6, held6 };
}

const totalOf = (b: Book) => b.usdc6 + Object.values(b.held6).reduce((sum, v) => sum + v, 0);

/** MandateVault.spentOnDay[today()]: the allowed buys in the same UTC day as ts. */
function spentOnUtcDay(day: SimDay, ts: number): number {
  const utcDay = Math.floor(ts / DAY_SECONDS);
  return day.tape
    .filter((e) => e.allowed && Math.floor(etToTimestamp(day.etDay, e.intent.minute) / DAY_SECONDS) === utcDay)
    .reduce((sum, e) => sum + e.intent.usd6, 0);
}

/** MandateVault._check for a BUY, in contract order: the first failure stops the run. */
export function evaluate(day: SimDay, intent: SimIntent): SimResult {
  const ts = etToTimestamp(day.etDay, intent.minute);
  const checks: SimCheck[] = [];
  const check = (pass: boolean, detail: string, fixed = false): boolean => {
    checks.push({ label: CHECK_LABELS[checks.length] ?? "", detail, mark: pass ? "PASS" : "FAIL", fixed });
    return pass;
  };
  const stop = (reason: RefusalCode, balance?: string): SimResult => {
    while (checks.length < CHECK_LABELS.length) {
      checks.push({ label: CHECK_LABELS[checks.length] ?? "", detail: "not reached", mark: "SKIP", fixed: false });
    }
    return { checks, allowed: false, reason, ...(balance === undefined ? {} : { balance }) };
  };

  const { token, usd6 } = intent;
  if (token === "OTHER") {
    check(false, "not in the mandate");
    return stop("TOKEN_NOT_ALLOWED");
  }
  check(true, `${token} in mandate`);
  check(true, "transfers active", true);
  check(true, "authorized", true);
  const session = regularSession(ts);
  if (!check(session.open, sessionDetail(session, localTime(ts)))) return stop("MARKET_CLOSED");
  check(true, `${FACTS.feedAgeSec.value}s ≤ ${m.maxStalenessSec}s`, true);
  check(true, `no change ${m.multiplierCooldownSec / 3600}h`, true);
  check(true, `${FACTS.premiumsBps.value[token]} ≤ ${m.maxPremiumBps} bps`, true);

  // The vault checks the balance after the market checks and before the caps.
  const b = book(day.tape);
  if (usd6 === 0) return stop("INSUFFICIENT_BALANCE", "amount is zero");
  if (usd6 > b.usdc6) return stop("INSUFFICIENT_BALANCE", `${formatUsd(usd6)} > ${formatUsd(b.usdc6)} USDC`);

  const spent6 = spentOnUtcDay(day, ts) + usd6;
  const size =
    usd6 > TRADE_CAP6
      ? `${formatUsd(usd6)} > ${formatUsd(TRADE_CAP6)} per trade`
      : spent6 > DAILY_CAP6
        ? `${formatUsd(spent6)} > ${formatUsd(DAILY_CAP6)} today`
        : `${formatUsd(usd6)} ≤ ${formatUsd(TRADE_CAP6)} · ${formatUsd(spent6)} of ${formatUsd(DAILY_CAP6)} today`;
  if (!check(usd6 <= TRADE_CAP6 && spent6 <= DAILY_CAP6, size)) return stop("SIZE_LIMIT");

  // _weightAfterBuyBps, with holdings at cost: (held + in) * BPS / total, rounded down.
  const total6 = totalOf(b);
  const weight = total6 === 0 ? BPS : Math.floor(((b.held6[token] + usd6) * BPS) / total6);
  const over = weight > m.maxWeightBps;
  if (!check(!over, `${token} ${pct(weight)} ${over ? ">" : "≤"} ${pct(m.maxWeightBps)}`)) return stop("CONCENTRATION");
  return { checks, allowed: true, reason: "OK" };
}

/** execute(): the intent and its verdict join the day's tape; only an allowed buy moves money. */
export function execute(day: SimDay, intent: SimIntent): SimDay {
  if (day.tape.length >= MAX_TAPE) return day;
  const { allowed, reason } = evaluate(day, intent);
  return { ...day, tape: [...day.tape, { intent, allowed, reason }] };
}

/** A day rebuilt from its intents: every verdict is recomputed, none is taken on trust. */
export function replay(etDay: number, intents: readonly SimIntent[]): SimDay {
  return intents.reduce<SimDay>((d, i) => execute(d, i), { etDay, tape: [] });
}

export interface DaySummary {
  readonly spent6: number;
  readonly weightBps: Readonly<Record<BasketToken, number>>;
}

export function daySummary(day: SimDay): DaySummary {
  const b = book(day.tape);
  const total6 = totalOf(b);
  const weightBps = Object.fromEntries(
    FACTS.basket.value.map((t) => [t, Math.floor((b.held6[t] * BPS) / total6)]),
  ) as Record<BasketToken, number>;
  return { spent6: START6 - b.usdc6, weightBps };
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly etDay: number;
  readonly minute: number;
}

function dayNumber(iso: string): number {
  const d = parseIsoDay(iso);
  if (d === undefined) throw new Error(`not a date: ${iso}`);
  return d;
}

const forkDay = dayNumber(FACTS.forkDay.value);
const forkMinute = minuteOfClock(FACTS.forkTimeEt.value);
const thanksgiving = FACTS.calendar.value.holidays.find((h) => h.name === "Thanksgiving");
const earlyClose = FACTS.calendar.value.earlyCloses[0];
if (!thanksgiving || !earlyClose) throw new Error("the calendar lists no Thanksgiving or no early close");

/** The moments of the brief. A chip without a time sets the fork's time of day. */
export const PRESETS: readonly Preset[] = [
  {
    id: "fork",
    label: `${dayLabel(FACTS.forkDay.value)} · ${FACTS.forkTimeEt.value}`,
    etDay: forkDay,
    minute: forkMinute,
  },
  {
    id: "weekend",
    label: dayLabel(FACTS.forkDay.value, FACTS.weekendOffsetDays.value),
    etDay: forkDay + FACTS.weekendOffsetDays.value,
    minute: forkMinute,
  },
  { id: "after-hours", label: `${dayLabel(FACTS.forkDay.value, 1)} · 19:00`, etDay: forkDay + 1, minute: 19 * 60 },
  { id: "holiday", label: thanksgiving.name, etDay: dayNumber(thanksgiving.date), minute: forkMinute },
  {
    id: "early-close",
    label: `${dayLabel(earlyClose.date)} · ${clockLabel(earlyClose.closeMin + 30)}`,
    etDay: dayNumber(earlyClose.date),
    minute: earlyClose.closeMin + 30,
  },
];

export interface Scenario {
  readonly etDay: number;
  readonly intent: SimIntent;
  /** Intents executed earlier that day, in order. */
  readonly tape: readonly SimIntent[];
}

const forkBuy = getDecisions().find((r) => r.source === "base-fork" && r.allowed && r.action === "BUY");
if (!forkBuy || !isBasketToken(forkBuy.symbol)) throw new Error("the fork ledger has no allowed BUY of a basket token");
const forkToken: BasketToken = forkBuy.symbol;

/** The fork's allowed BUY at the fork moment: the simulator opens on a yes. */
export const DEFAULT_SCENARIO: Scenario = {
  etDay: forkDay,
  intent: { token: forkToken, usd6: forkBuy.amountUsd * USD6, minute: forkMinute },
  tape: [],
};

const hhmm = (minute: number) => clockLabel(minute).replace(":", "");
const leg = (i: SimIntent) => `${i.token === "OTHER" ? "other" : i.token}-${amountText(i.usd6)}`;

/** A share link's query: ?day=2026-11-07&at=1030&buy=NVDAc-50&tape=1030-NVDAc-50,1100-GOOGLc-20 */
export function encodeScenario(s: Scenario): string {
  const parts = [`day=${isoOfDay(s.etDay)}`, `at=${hhmm(s.intent.minute)}`, `buy=${leg(s.intent)}`];
  if (s.tape.length > 0) parts.push(`tape=${s.tape.map((i) => `${hhmm(i.minute)}-${leg(i)}`).join(",")}`);
  return `?${parts.join("&")}`;
}

function parseMinute(text: string): number | undefined {
  const match = /^([01]\d|2[0-3])([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function parseLeg(text: string): Pick<SimIntent, "token" | "usd6"> | undefined {
  const match = /^([A-Za-z]+)-([\d.]+)$/.exec(text);
  if (!match) return undefined;
  const symbol = match[1] ?? "";
  const token: SimToken | undefined = symbol === "other" ? "OTHER" : isBasketToken(symbol) ? symbol : undefined;
  const usd6 = parseUsd(match[2] ?? "");
  return token === undefined || usd6 === undefined ? undefined : { token, usd6 };
}

/** A share link back to its scenario. Anything malformed falls back to the default, field by field. */
export function decodeScenario(search: string): Scenario {
  const q = new URLSearchParams(search);
  const d = DEFAULT_SCENARIO;
  const day = parseIsoDay(q.get("day") ?? "");
  const buy = parseLeg(q.get("buy") ?? "");
  const tape = (q.get("tape") ?? "")
    .split(",")
    .flatMap((entry): SimIntent[] => {
      const [at = "", ...rest] = entry.split("-");
      const minute = parseMinute(at);
      const part = parseLeg(rest.join("-"));
      return minute === undefined || part === undefined ? [] : [{ ...part, minute }];
    })
    .slice(0, MAX_TAPE);
  return {
    etDay: day !== undefined && day >= WINDOW.first && day <= WINDOW.last ? day : d.etDay,
    intent: {
      token: buy?.token ?? d.intent.token,
      usd6: buy?.usd6 ?? d.intent.usd6,
      minute: parseMinute(q.get("at") ?? "") ?? d.intent.minute,
    },
    tape,
  };
}

/** The post a visitor shares on X. */
export function postText(s: Scenario, r: Pick<SimResult, "allowed" | "reason">): string {
  const what = `${formatUsd(s.intent.usd6)} of ${s.intent.token === "OTHER" ? "a token outside the mandate" : s.intent.token}`;
  const when = `${dayLabel(isoOfDay(s.etDay))} at ${clockLabel(s.intent.minute)} ET`;
  if (!r.allowed) return `I tried to buy ${what} on ${when}. Maat said no: ${r.reason}.`;
  const nine = numberWord(FACTS.checksPerTrade.value).toLowerCase();
  return `I asked Maat to buy ${what} on ${when}. All ${nine} checks passed. Can you make it say no?`;
}

/** X's web intent: a plain link, no script. The share link rides along once it is absolute (after hydration). */
export function postUrl(text: string, link: string): string {
  const url = /^https?:\/\//.test(link) ? `&url=${encodeURIComponent(link)}` : "";
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}${url}`;
}
```

- [ ] **Step 7: Run them to verify they pass**

Run: `npx vitest run test/simulator.test.ts test/format.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add web/content/format.ts web/content/simulator.ts web/test/format.test.ts web/test/simulator.test.ts
git commit -m "feat(web): simulate the BUY checks of the default mandate over one day"
```

---

### Task 4: Simulator component

**Files:**
- Create: `web/components/Simulator.tsx`
- Modify: `web/app/globals.css`
- Test: `web/test/simulator.test.tsx`

**Interfaces:**
- Consumes: everything Task 3 produces; `isoOfDay`, `localTime`, `parseIsoDay`, `sessionWindow`, `WINDOW` (Task 2); `REASON_MEANING`; `CheckMark`.
- Produces: `export function Simulator(): JSX.Element`, a client component with no props. DOM contract used by Tasks 5 and 6:
  - Token, amount and preset chips: buttons with `aria-pressed`, named by their text.
  - Amount: `textbox` named "Amount in US dollars". Day: date input labeled "Day". Time: `slider` named "Time" with `aria-valuetext` "HH:MM ET".
  - Checks: `list` named "Simulated checks", each `li` with `data-check` (1 to 9, or `balance`) and `data-mark`.
  - Verdict: `role="status"` wrapping a `div` with `data-verdict` (`allowed` or `refused`) and `data-reason`.
  - Buttons "Execute", "Copy link" (then "Link copied"), "Reset day"; link "Post on X".
  - Tape: `list` named "Today's decisions".

- [ ] **Step 1: Write the failing component tests**

Create `web/test/simulator.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulator } from "@/components/Simulator";

function setup() {
  const user = userEvent.setup();
  render(<Simulator />);
  const verdict = () => screen.getByRole("status").firstElementChild as HTMLElement;
  return {
    user,
    verdict,
    reason: () => verdict().getAttribute("data-reason"),
    marks: () =>
      within(screen.getByRole("list", { name: "Simulated checks" }))
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-mark")),
    button: (name: string) => screen.getByRole("button", { name }),
    tape: () => screen.queryByRole("list", { name: "Today's decisions" }),
  };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

describe("Simulator", () => {
  it("opens on a yes: the fork's BUY at the fork moment", () => {
    const ui = setup();
    expect(ui.verdict()).toHaveAttribute("data-verdict", "allowed");
    expect(ui.marks()).toEqual(Array(9).fill("PASS"));
    expect(screen.getByRole("status")).toHaveTextContent("It says yes. Change one thing to make it say no.");
    expect(ui.button("NVDAc")).toHaveAttribute("aria-pressed", "true");
    expect(ui.button("Thu 5 Nov · 10:30")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("default mandate · not the contract")).toBeInTheDocument();
  });

  it("says no on Saturday, and explains the code", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(ui.marks()).toEqual(["PASS", "PASS", "PASS", "FAIL", ...Array(5).fill("SKIP")]);
    expect(screen.getByRole("status")).toHaveTextContent("NYSE is closed for the mandate's session");
  });

  it("refuses the second $50 of NVDAc in a day, then resets the day", async () => {
    const ui = setup();
    await ui.user.click(ui.button("$50"));
    await ui.user.click(ui.button("Execute"));
    expect(ui.reason()).toBe("CONCENTRATION");
    await ui.user.click(ui.button("Execute"));
    const tape = ui.tape();
    if (!tape) throw new Error("no tape");
    expect(within(tape).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "10:30 BUY NVDAc · $50Allowed",
      "10:30 BUY NVDAc · $50Refused · CONCENTRATION",
    ]);
    expect(screen.getByText("$50 of $100")).toBeInTheDocument();
    await ui.user.click(ui.button("Reset day"));
    expect(ui.tape()).toBeNull();
    expect(ui.reason()).toBe("OK");
  });

  it("starts a new day when the date changes", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Execute"));
    expect(ui.tape()).not.toBeNull();
    await ui.user.click(ui.button("Fri 6 Nov · 19:00"));
    expect(ui.tape()).toBeNull();
    expect(ui.reason()).toBe("MARKET_CLOSED");
  });

  it("shows the balance row past the vault's USDC, and blocks Execute while the amount does not parse", async () => {
    const ui = setup();
    const amount = screen.getByRole("textbox", { name: "Amount in US dollars" });
    await ui.user.clear(amount);
    await ui.user.type(amount, "$1,000");
    expect(ui.reason()).toBe("INSUFFICIENT_BALANCE");
    const checks = screen.getByRole("list", { name: "Simulated checks" });
    expect(checks.querySelector('[data-check="balance"]')).toHaveTextContent("$1,000 > $200 USDC");
    await ui.user.type(amount, "x");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use dollars with up to two decimals, like 50 or 12.50.")).toBeInTheDocument();
    expect(ui.button("Execute")).toBeDisabled();
    expect(ui.reason()).toBe("INSUFFICIENT_BALANCE");
  });

  it("tells the time in New York on the slider, and closes at 16:00", () => {
    const ui = setup();
    const time = screen.getByRole("slider", { name: "Time" });
    expect(time).toHaveAttribute("aria-valuetext", "10:30 ET");
    fireEvent.change(time, { target: { value: "959" } });
    expect(ui.reason()).toBe("OK");
    fireEvent.change(time, { target: { value: "960" } });
    expect([ui.reason(), time.getAttribute("aria-valuetext")]).toEqual(["MARKET_CLOSED", "16:00 ET"]);
  });

  it("takes a date inside the window and ignores one outside it", () => {
    const ui = setup();
    const dayInput = screen.getByLabelText("Day");
    fireEvent.change(dayInput, { target: { value: "2026-11-26" } });
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(screen.getByText("Thursday · Thanksgiving, closed all day")).toBeInTheDocument();
    fireEvent.change(dayInput, { target: { value: "2027-02-01" } });
    expect(dayInput).toHaveValue("2026-11-26");
  });

  it("opens a share link on its own scenario, recomputing every verdict", () => {
    window.history.replaceState(null, "", "/?day=2026-11-05&at=1030&buy=NVDAc-50&tape=1030-NVDAc-50#try");
    const ui = setup();
    expect(ui.reason()).toBe("CONCENTRATION");
    const tape = ui.tape();
    if (!tape) throw new Error("no tape");
    expect(within(tape).getAllByRole("listitem")).toHaveLength(1);
  });

  it("prefills a post on X with the verdict and the link", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    const url = new URL(screen.getByRole("link", { name: "Post on X" }).getAttribute("href") ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://x.com/intent/post");
    expect(url.searchParams.get("text")).toBe("I tried to buy $20 of NVDAc on Sat 7 Nov at 10:30 ET. Maat said no: MARKET_CLOSED.");
    expect(url.searchParams.get("url")).toBe("http://localhost:3000/?day=2026-11-07&at=1030&buy=NVDAc-20#try");
  });

  it("copies the share link, or shows it when the clipboard says no", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    await ui.user.click(ui.button("Copy link"));
    const link = "http://localhost:3000/?day=2026-11-07&at=1030&buy=NVDAc-20#try";
    expect(await navigator.clipboard.readText()).toBe(link);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    await ui.user.click(ui.button("Link copied"));
    expect(screen.getByRole("textbox", { name: "Copy this link:" })).toHaveValue(link);
  });

  it("offers Now in New York time, whatever the visitor's time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T20:00:00Z")); // Sat 15:00 ET
    const ui = setup();
    await ui.user.click(await screen.findByRole("button", { name: "Now" }));
    expect(screen.getByText("15:00 ET")).toBeInTheDocument();
    expect(ui.reason()).toBe("MARKET_CLOSED");
  });

  it("hides Now outside the dates the calendar lists", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-01T15:00:00Z"));
    setup();
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/simulator.test.tsx`
Expected: FAIL with "Failed to resolve import @/components/Simulator".

- [ ] **Step 3: Add the slider styles**

In `web/app/globals.css`, inside `@layer components`, after the `.pill-line:hover` rule:

```css
  /* Time slider: the track shades the NYSE session of the chosen day, from --open to --close (set inline). */
  .time-range {
    --open: 0%;
    --close: 0%;
    appearance: none;
    width: 100%;
    height: 28px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  .time-range::-webkit-slider-runnable-track {
    height: 10px;
    border: 1px solid var(--color-line);
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--color-line-soft) var(--open),
      var(--color-accent-soft) var(--open) var(--close),
      var(--color-line-soft) var(--close)
    );
  }
  .time-range::-moz-range-track {
    height: 10px;
    border: 1px solid var(--color-line);
    border-radius: 999px;
    background: linear-gradient(
      to right,
      var(--color-line-soft) var(--open),
      var(--color-accent-soft) var(--open) var(--close),
      var(--color-line-soft) var(--close)
    );
  }
  .time-range::-webkit-slider-thumb {
    appearance: none;
    width: 22px;
    height: 22px;
    margin-top: -7px;
    border: 3px solid var(--color-bg);
    border-radius: 999px;
    background: var(--color-ink);
    box-shadow: 0 0 0 1px var(--color-ink);
  }
  .time-range::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border: 3px solid var(--color-bg);
    border-radius: 999px;
    background: var(--color-ink);
    box-shadow: 0 0 0 1px var(--color-ink);
  }
```

- [ ] **Step 4: Write `web/components/Simulator.tsx`**

```tsx
"use client";

import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { isoOfDay, localTime, parseIsoDay, sessionWindow, WINDOW } from "@/content/calendar";
import type { CheckMark } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { clockLabel, dayLabel } from "@/content/format";
import { REASON_MEANING } from "@/content/reasons";
import {
  AMOUNT_CHIPS_USD,
  amountText,
  DEFAULT_SCENARIO,
  daySummary,
  dayNote,
  decodeScenario,
  encodeScenario,
  evaluate,
  formatUsd,
  MAX_TAPE,
  momentLabel,
  PRESETS,
  parseUsd,
  postText,
  postUrl,
  replay,
  type Scenario,
  type SimIntent,
  simIntentLabel,
  TOKENS,
  tokenLabel,
} from "@/content/simulator";

const MARK_STYLE: Record<CheckMark, string> = {
  PASS: "bg-accent-tint text-accent",
  FAIL: "bg-refuse text-white",
  SKIP: "bg-line-soft text-ink-2",
};
const FIELDSET = "m-0 min-w-0 border-0 p-0";
const LEGEND = "mb-3 p-0 font-mono text-[11px] text-ink-2";
const DAY_MINUTES = 1440;
const USD6 = 1_000_000;
const pct = (bps: number) => `${bps / 100}%`;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] font-medium ${
        on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}

interface RowProps {
  n: string;
  label: string;
  detail: string;
  mark: CheckMark;
  check: string;
  fixed?: boolean;
}

function Row({ n, label, detail, mark, check, fixed = false }: RowProps) {
  return (
    <li
      data-check={check}
      data-mark={mark}
      data-fixed={fixed || undefined}
      className={`grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-3 rounded-[10px] px-2.5 py-[9px] ${
        mark === "FAIL" ? "bg-refuse-tint" : ""
      }`}
    >
      <span aria-hidden="true" className="font-mono text-[11px] text-ink-2">
        {n}
      </span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={`text-sm font-medium ${mark === "SKIP" ? "text-ink-2" : ""}`}>
          {label}
          {fixed ? (
            <span className="ml-2 rounded border border-line px-1.5 py-px font-mono text-[10px] font-normal text-ink-2">
              fork
            </span>
          ) : null}
        </span>
        <span className="font-mono text-xs text-ink-2">{detail}</span>
      </span>
      <span className={`rounded-md py-1 text-center font-mono text-[11px] font-semibold ${MARK_STYLE[mark]}`}>{mark}</span>
    </li>
  );
}

type Copy = "idle" | "copied" | "manual";

export function Simulator() {
  const [s, setS] = useState<Scenario>(DEFAULT_SCENARIO);
  const [amount, setAmount] = useState(amountText(DEFAULT_SCENARIO.intent.usd6));
  const [origin, setOrigin] = useState("");
  const [now, setNow] = useState<{ etDay: number; minute: number }>();
  const [copy, setCopy] = useState<Copy>("idle");

  // After hydration, so the static HTML always holds the default: a share link's scenario, this page's
  // address, and the visitor's clock read in New York time through the calendar port.
  useEffect(() => {
    const shared = decodeScenario(window.location.search);
    setS(shared);
    setAmount(amountText(shared.intent.usd6));
    setOrigin(`${window.location.origin}${window.location.pathname}`);
    const t = localTime(Math.floor(Date.now() / 1000));
    if (t.etDay >= WINDOW.first && t.etDay <= WINDOW.last) setNow({ etDay: t.etDay, minute: t.minuteOfDay });
  }, []);

  const day = useMemo(() => replay(s.etDay, s.tape), [s.etDay, s.tape]);
  const result = evaluate(day, s.intent);
  const summary = daySummary(day);
  const link = `${origin}${encodeScenario(s)}#try`;
  const invalid = parseUsd(amount) === undefined;
  const full = s.tape.length >= MAX_TAPE;
  const session = sessionWindow(s.etDay);

  useEffect(() => setCopy("idle"), [link]);

  const setIntent = (patch: Partial<SimIntent>) => setS((p) => ({ ...p, intent: { ...p.intent, ...patch } }));
  // Another date is another day: the tape starts over.
  const setMoment = (etDay: number, minute: number) =>
    setS((p) => ({ ...p, etDay, tape: etDay === p.etDay ? p.tape : [], intent: { ...p.intent, minute } }));
  const onAmount = (text: string) => {
    setAmount(text);
    const usd6 = parseUsd(text);
    if (usd6 !== undefined) setIntent({ usd6 });
  };
  const onDay = (iso: string) => {
    const d = parseIsoDay(iso);
    if (d !== undefined && d >= WINDOW.first && d <= WINDOW.last) setMoment(d, s.intent.minute);
  };
  const run = () => setS((p) => (p.tape.length >= MAX_TAPE ? p : { ...p, tape: [...p.tape, p.intent] }));
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("copied");
    } catch {
      setCopy("manual");
    }
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-6">
      <div className="card flex flex-col gap-7 p-[22px]">
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>TOKEN · BUY</legend>
          <div className="flex flex-wrap gap-2">
            {TOKENS.map((t) => (
              <Chip key={t} on={s.intent.token === t} onClick={() => setIntent({ token: t })}>
                {tokenLabel(t)}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>AMOUNT · USD</legend>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-h-10 items-center rounded-full border border-line-strong bg-white pl-3.5 pr-2 focus-within:border-ink">
              <span aria-hidden="true" className="font-mono text-sm text-ink-2">
                $
              </span>
              <input
                aria-label="Amount in US dollars"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => onAmount(e.target.value)}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? "sim-amount-error" : undefined}
                className="w-[7.5rem] border-0 bg-transparent px-1.5 py-2 font-mono text-sm text-ink"
              />
            </div>
            {AMOUNT_CHIPS_USD.map((usd) => (
              <Chip
                key={usd}
                on={!invalid && s.intent.usd6 === usd * USD6}
                onClick={() => {
                  setAmount(String(usd));
                  setIntent({ usd6: usd * USD6 });
                }}
              >
                {formatUsd(usd * USD6)}
              </Chip>
            ))}
          </div>
          {invalid ? (
            <p id="sim-amount-error" className="m-0 mt-2 text-[13px] text-refuse">
              Use dollars with up to two decimals, like 50 or 12.50.
            </p>
          ) : null}
        </fieldset>

        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>MOMENT · NEW YORK TIME</legend>
          <div role="group" aria-label="Moment presets" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Chip key={p.id} on={s.etDay === p.etDay && s.intent.minute === p.minute} onClick={() => setMoment(p.etDay, p.minute)}>
                {p.label}
              </Chip>
            ))}
            {now ? (
              <Chip
                on={s.etDay === now.etDay && s.intent.minute === now.minute}
                onClick={() => setMoment(now.etDay, now.minute)}
              >
                Now
              </Chip>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <label htmlFor="sim-day" className="text-sm font-medium">
              Day
            </label>
            <input
              id="sim-day"
              type="date"
              min={isoOfDay(WINDOW.first)}
              max={isoOfDay(WINDOW.last)}
              value={isoOfDay(s.etDay)}
              onChange={(e) => onDay(e.target.value)}
              className="min-h-10 rounded-full border border-line-strong bg-white px-3.5 font-mono text-sm text-ink"
            />
            <span className="font-mono text-xs text-ink-2">{dayNote(s.etDay)}</span>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="sim-time" className="text-sm font-medium">
                Time
              </label>
              <span className="font-mono text-sm font-semibold">{clockLabel(s.intent.minute)} ET</span>
            </div>
            <input
              id="sim-time"
              type="range"
              min={0}
              max={DAY_MINUTES - 1}
              step={1}
              value={s.intent.minute}
              onChange={(e) => setIntent({ minute: Number(e.target.value) })}
              aria-valuetext={`${clockLabel(s.intent.minute)} ET`}
              className="time-range"
              style={
                {
                  "--open": `${((session?.openMin ?? 0) / DAY_MINUTES) * 100}%`,
                  "--close": `${((session?.closeMin ?? 0) / DAY_MINUTES) * 100}%`,
                } as CSSProperties
              }
            />
            <div className="flex justify-between gap-3 font-mono text-[11px] text-ink-2">
              <span>00:00</span>
              <span>
                {session ? `NYSE ${clockLabel(session.openMin)}–${clockLabel(session.closeMin)}` : "NYSE closed all day"}
              </span>
              <span>23:59</span>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-head px-5 py-4">
          <span className="font-mono text-xs font-semibold">SIMULATOR</span>
          <span className="font-mono text-[11px] text-ink-2">default mandate · not the contract</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-2 pt-5">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[11px] text-ink-2">INTENT</span>
            <span className="text-[26px] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere]">
              {simIntentLabel(s.intent)}
            </span>
          </div>
          <span className="font-mono text-xs text-ink-2">{momentLabel(s.etDay, s.intent.minute)}</span>
        </div>

        <ol aria-label="Simulated checks" className="m-0 list-none px-3 pb-3 pt-2">
          {result.checks.map((c, i) => (
            <Fragment key={c.label}>
              {i === 7 && result.balance !== undefined ? (
                <Row n="—" label="Balance" detail={result.balance} mark="FAIL" check="balance" />
              ) : null}
              <Row
                n={String(i + 1).padStart(2, "0")}
                label={c.label}
                detail={c.detail}
                mark={c.mark}
                check={String(i + 1)}
                fixed={c.fixed}
              />
            </Fragment>
          ))}
        </ol>

        {/* The live region itself never remounts; only its text changes. */}
        <div role="status" aria-live="polite" aria-atomic="true" className="mx-3 mb-3">
          <div
            data-verdict={result.allowed ? "allowed" : "refused"}
            data-reason={result.reason}
            className={`flex flex-col gap-2 rounded-[14px] px-[18px] py-4 text-white ${result.allowed ? "bg-accent" : "bg-ink"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px] opacity-80">VAULT DECISION · SIMULATED</span>
                <span className="text-[26px] font-semibold tracking-[-0.03em]">{result.allowed ? "Allowed" : "Refused"}</span>
              </div>
              <span className="font-mono text-[13px] font-semibold [overflow-wrap:anywhere]">{result.reason}</span>
            </div>
            <p className="m-0 text-sm leading-normal opacity-90">
              {result.reason === "OK" ? "It says yes. Change one thing to make it say no." : REASON_MEANING[result.reason]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 px-5 pb-5">
          <button
            type="button"
            onClick={run}
            disabled={invalid || full}
            className="pill-dark cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-ink"
          >
            Execute
          </button>
          <a className="pill-line" href={postUrl(postText(s, result), link)} target="_blank" rel="noopener noreferrer">
            Post on X<span aria-hidden="true"> ↗</span>
          </a>
          <button type="button" onClick={copyLink} className="pill-line cursor-pointer bg-white">
            {copy === "copied" ? "Link copied" : "Copy link"}
          </button>
        </div>
        {copy === "manual" ? (
          <div className="flex flex-col gap-1.5 px-5 pb-5">
            <label htmlFor="sim-link" className="text-[13px] text-ink-2">
              Copy this link:
            </label>
            <input
              id="sim-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-10 w-full min-w-0 rounded-[10px] border border-line-strong bg-white px-3 font-mono text-xs text-ink"
            />
          </div>
        ) : null}

        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-2">TODAY · {dayLabel(isoOfDay(s.etDay)).toUpperCase()}</span>
            <button
              type="button"
              onClick={() => setS((p) => ({ ...p, tape: [] }))}
              disabled={s.tape.length === 0}
              className="min-h-9 cursor-pointer rounded-full border border-line-strong bg-white px-3.5 text-xs font-medium text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset day
            </button>
          </div>
          {day.tape.length === 0 ? (
            <p className="m-0 mt-3 text-sm leading-normal text-ink-2">
              Nothing executed yet. The day starts with {formatUsd(FACTS.forkVaultUsd.value * USD6)} USDC and no stock;
              another date starts a new day.
            </p>
          ) : (
            <ol aria-label="Today's decisions" className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
              {day.tape.map((e, i) => (
                // The tape only grows or empties, so the index is a stable key.
                <li key={i} data-allowed={e.allowed} className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs">
                  <span className="[overflow-wrap:anywhere]">
                    <span className="text-ink-2">{clockLabel(e.intent.minute)}</span> {simIntentLabel(e.intent)}
                  </span>
                  <span className={e.allowed ? "text-accent" : "font-semibold text-refuse"}>
                    {e.allowed ? "Allowed" : `Refused · ${e.reason}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <dl className="m-0 mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <div>
              <dt className="font-mono text-[11px] text-ink-2">SPENT TODAY</dt>
              <dd className="m-0 mt-1 font-mono text-sm font-semibold">
                {formatUsd(summary.spent6)} of {formatUsd(FACTS.mandate.value.dailyCapUsd * USD6)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] text-ink-2">WEIGHT · MAX {pct(FACTS.mandate.value.maxWeightBps)}</dt>
              <dd className="m-0 mt-1 font-mono text-sm">
                {FACTS.basket.value.map((t) => `${t} ${pct(summary.weightBps[t])}`).join(" · ")}
              </dd>
            </div>
          </dl>
          {full ? <p className="m-0 mt-3 text-[13px] text-ink-2">The day is full: reset it to keep going.</p> : null}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/simulator.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: no errors.

```bash
git add web/components/Simulator.tsx web/app/globals.css web/test/simulator.test.tsx
git commit -m "feat(web): the simulator component, with a share link and one day of trades"
```

---

### Task 5: The `#try` section, placement and export check

**Files:**
- Create: `web/components/sections/TryIt.tsx`
- Modify: `web/lib/site.ts`, `web/app/page.tsx`, `web/components/sections/Nav.tsx`, `web/components/sections/Hero.tsx`, `web/lib/check-out.ts`
- Test: `web/test/site.test.ts`, `web/test/page.test.tsx`, `web/test/top.test.tsx`, `web/test/check-out.test.ts`

**Interfaces:**
- Consumes: `Simulator` (Task 4); `DEFAULT_SCENARIO`, `evaluate`, `replay` (Task 3); `andList` (Task 3); `FACTS`.
- Produces: `TryIt()` section with `id="try"`; `repoFileUrl(path: string): string` in `web/lib/site.ts`.

- [ ] **Step 1: Write the failing tests**

In `web/test/site.test.ts`, import `repoFileUrl` next to `SITE, siteUrl` and add:

```ts
describe("links into the source", () => {
  it.each(["contracts/src/MarketCalendar.sol", "contracts/src/MandateVault.sol"])("%s exists and links at main", (path) => {
    expect(repoFileUrl(path)).toBe(`${SITE.repoUrl}/blob/main/${path}`);
    expect(() => readRepo(path)).not.toThrow();
  });
});
```

In `web/test/page.test.tsx`:
- In "every in-page link has a target", change the expected ids to `["how", "ledger", "main", "mandate", "reasons", "top", "try"]`.
- In "orders the sections like the comp", use the selector `"#top, #how, #reasons, #try, #ledger, #mandate"` and expect `["top", "how", "reasons", "try", "ledger", "mandate"]`.
- Add:

```tsx
  it("lets a visitor try the mandate, labeled as a simulation of the default one", () => {
    const c = setup();
    const section = c.querySelector("#try") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Try to make it say no.");
    expect(section).toHaveTextContent("A simulation of the default mandate, running in your browser.");
    expect(section).toHaveTextContent("The contract is the source of truth.");
    expect(within(section).getByText("default mandate · not the contract")).toBeInTheDocument();
    expect(section).toHaveTextContent("Thanksgiving on Thu 26 Nov, Christmas on Fri 25 Dec and New Year on Fri 1 Jan");
    expect(section).toHaveTextContent("53 bps for NVDAc, 49 bps for GOOGLc and 29 bps for AAPLc");
    expect(section).toHaveTextContent("Each day starts with $200 USDC and no stock");
    expect(within(section).getByRole("link", { name: "MarketCalendar.sol" })).toHaveAttribute(
      "href",
      `${SITE.repoUrl}/blob/main/contracts/src/MarketCalendar.sol`,
    );
    expect(within(section).getByRole("link", { name: "MandateVault.sol" })).toHaveAttribute(
      "href",
      `${SITE.repoUrl}/blob/main/contracts/src/MandateVault.sol`,
    );
  });
```

In `web/test/top.test.tsx`:
- In the nav test, insert `["Try it", "#try"],` after `["Refusals", "#reasons"],`.
- In the hero test, replace the "How it weighs a trade" line with:

```tsx
    expect(screen.getByRole("link", { name: "Try to make it say no" })).toHaveAttribute("href", "#try");
```

In `web/test/check-out.test.ts`:
- In `GOOD`, insert before `'<section id="ledger"></section>',`:

```ts
  '<section id="try"><div role="status" aria-live="polite" aria-atomic="true" class="s">',
  '<div data-verdict="allowed" data-reason="OK" class="v"></div></div></section>',
```

- Add these rows to the `it.each` table:

```ts
    ["no simulator section", GOOD.replace('id="try"', 'id="trial"'), /#try is missing/],
    [
      "the wrong simulator verdict",
      GOOD.replace('data-verdict="allowed" data-reason="OK"', 'data-verdict="refused" data-reason="OK"'),
      /simulator's default verdict/,
    ],
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run test/site.test.ts test/page.test.tsx test/top.test.tsx test/check-out.test.ts`
Expected: FAIL. `repoFileUrl` is not exported, there is no `#try`, there is no "Try it" link, and the two new check-out rows are not flagged.

- [ ] **Step 3: Add `repoFileUrl` to `web/lib/site.ts`**

After the `SITE` object:

```ts
/** A file of the repo on GitHub, at main. */
export function repoFileUrl(path: string): string {
  return `${REPO}/blob/main/${path}`;
}
```

- [ ] **Step 4: Create `web/components/sections/TryIt.tsx`**

```tsx
import { Simulator } from "@/components/Simulator";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FACTS } from "@/content/facts";
import { andList, clockLabel, dayLabel, formatInt } from "@/content/format";
import { repoFileUrl } from "@/lib/site";

export function TryIt() {
  const { holidays, earlyCloses } = FACTS.calendar.value;
  const session = FACTS.nyseSessionMin.value;
  const premiums = FACTS.premiumsBps.value;
  const notes = [
    {
      title: "Simulated",
      body: `The market session (NYSE ${clockLabel(session.open)}–${clockLabel(session.close)} ET, weekends, and the holidays the calendar lists: ${andList(
        holidays.map((h) => `${h.name} on ${dayLabel(h.date)}`),
      )}; early closes at ${andList(earlyCloses.map((e) => `${clockLabel(e.closeMin)} on ${dayLabel(e.date)}`))}), the token list, the per-trade and daily caps, and the weight.`,
    },
    {
      title: "Fixed at fork values",
      body: `Measured on Base at block ${formatInt(FACTS.forkBlock.value)}: token not paused, transfer path authorized, feed age ${FACTS.feedAgeSec.value} s, multiplier unchanged, and a pool premium of ${andList(
        FACTS.basket.value.map((t) => `${premiums[t]} bps for ${t}`),
      )}.`,
    },
    {
      title: "Starting point",
      body: `Each day starts with $${FACTS.forkVaultUsd.value} USDC and no stock, as the fork vault did. Holdings are valued at cost; the vault values them at the Chainlink price.`,
    },
  ];

  return (
    <section id="try" aria-labelledby="try-title" className="border-t border-line bg-surface-soft">
      <div className="wrap flex flex-col gap-12 py-20 md:py-32">
        <SectionHeading
          id="try-title"
          layout="split"
          eyebrow="Try it"
          title="Try to make it say no."
          lead="A simulation of the default mandate, running in your browser. Pick a stock, an amount and a moment. The contract is the source of truth."
        />
        <Simulator />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-x-10 gap-y-5 text-sm leading-relaxed text-ink-2">
          {notes.map((n) => (
            <p key={n.title} className="m-0">
              <strong className="font-medium text-ink">{n.title}.</strong> {n.body}
            </p>
          ))}
          <p className="m-0">
            <strong className="font-medium text-ink">Source of truth.</strong> The contracts decide, not this page. Read{" "}
            <a href={repoFileUrl("contracts/src/MarketCalendar.sol")}>MarketCalendar.sol</a> and{" "}
            <a href={repoFileUrl("contracts/src/MandateVault.sol")}>MandateVault.sol</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Place it**

`web/app/page.tsx`: add `import { TryIt } from "@/components/sections/TryIt";` (keep imports sorted) and render `<TryIt />` right after `<Refusals />`.

`web/components/sections/Nav.tsx`: in `LINKS`, after `{ href: "#reasons", label: "Refusals" },` add `{ href: "#try", label: "Try it" },`.

`web/components/sections/Hero.tsx`: replace

```tsx
            <a className="pill-line" href="#how">
              How it weighs a trade
            </a>
```

with

```tsx
            <a className="pill-line" href="#try">
              Try to make it say no
            </a>
```

- [ ] **Step 6: Check the export in `web/lib/check-out.ts`**

Add `import { DEFAULT_SCENARIO, evaluate, replay } from "../content/simulator";` and, after the Saturday checks, before the anchor loop:

```ts
  // The simulator opens on the fork's allowed BUY; no-JS readers see that verdict in its own live region.
  const sim = evaluate(replay(DEFAULT_SCENARIO.etDay, DEFAULT_SCENARIO.tape), DEFAULT_SCENARIO.intent);
  const simVerdict = sim.allowed ? "allowed" : "refused";
  const tryAt = html.indexOf(' id="try"');
  need(tryAt >= 0, "the simulator section #try is missing");
  need(
    tryAt >= 0 &&
      new RegExp(`role="status"[^>]*><div[^>]*\\sdata-verdict="${simVerdict}"[^>]*\\sdata-reason="${sim.reason}"`).test(
        html.slice(tryAt),
      ),
    `the simulator's default verdict (${simVerdict} · ${sim.reason}) is not in the exported HTML`,
  );
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run`
Expected: the whole suite PASSES.

- [ ] **Step 8: Commit**

```bash
git add web/components/sections/TryIt.tsx web/lib/site.ts web/app/page.tsx web/components/sections/Nav.tsx web/components/sections/Hero.tsx web/lib/check-out.ts web/test/site.test.ts web/test/page.test.tsx web/test/top.test.tsx web/test/check-out.test.ts
git commit -m "feat(web): add the Try it section after Refusals and point the hero at it"
```

---

### Task 6: e2e and full verification

**Files:**
- Create: `web/e2e/helpers.ts`, `web/e2e/simulator.spec.ts`
- Modify: `web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the DOM contract of Task 4 and the `#try` section of Task 5.
- Produces: `collectErrors(page): string[]` and `measureFit(page): Promise<{ overflow: number; clipped: string[] }>` in `web/e2e/helpers.ts`.

- [ ] **Step 1: Move the shared helpers**

Create `web/e2e/helpers.ts` with `collectErrors` and `measureFit` moved verbatim from `smoke.spec.ts`, each exported:

```ts
import type { Page } from "@playwright/test";

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Horizontal overflow of the page, and the `.card`s whose content is wider than the card (deliberate scroll regions excluded). */
export async function measureFit(page: Page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    clipped: [...document.querySelectorAll<HTMLElement>(".card")]
      .filter((el) => !el.hasAttribute("data-scroll-x") && el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent ?? "").trim().slice(0, 60)),
  }));
}
```

In `web/e2e/smoke.spec.ts`, delete the two local functions, change the first import to `import { expect, test } from "@playwright/test";`, and add `import { collectErrors, measureFit } from "./helpers";`.

- [ ] **Step 2: Scope the hero assertions in `smoke.spec.ts` to `#top`**

The simulator adds a second live region and buttons with the same names as the hero's moments, so page-wide locators would hit strict mode. Make these exact replacements:

- In the fit test: `const thu = page.locator("#top").getByRole("button", { name: "Thu 5 Nov · 10:30" });`, `await expect(page.locator("#top").getByRole("status").locator("> div")).toHaveAttribute("data-verdict", "allowed");` and `await expect(page.locator("#top").getByText("$20 ≤ $50 · $100/day")).toBeVisible();`.
- In "the moment toggle works by mouse and keyboard": `const hero = page.locator("#top");` then `const verdict = hero.getByRole("status");`, `const thu = hero.getByRole("button", { name: "Thu 5 Nov · 10:30" });`, `const sat = hero.getByRole("button", { name: "Sat 7 Nov" });`.
- In "reduced motion shows the final state at once": the selectors become `'#top [aria-label="Mandate checks"] li'` and `'#top [role="status"] > div'`.

- [ ] **Step 3: Write `web/e2e/simulator.spec.ts`**

```ts
import { expect, type Page, test } from "@playwright/test";
import { collectErrors, measureFit } from "./helpers";

function sim(page: Page) {
  const root = page.locator("#try");
  return {
    root,
    verdict: root.getByRole("status").locator("> div"),
    button: (name: string) => root.getByRole("button", { name, exact: true }),
    checks: root.getByRole("list", { name: "Simulated checks" }).getByRole("listitem"),
    tape: root.getByRole("list", { name: "Today's decisions" }).getByRole("listitem"),
    time: root.getByRole("slider", { name: "Time" }),
  };
}

test("a visitor makes it say no, by mouse and keyboard", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/#try");
  const ui = sim(page);
  await expect(ui.verdict).toHaveAttribute("data-verdict", "allowed");

  await ui.button("Sat 7 Nov").click();
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.checks.nth(3)).toHaveAttribute("data-mark", "FAIL");

  await ui.button("Thu 5 Nov · 10:30").click();
  await ui.button("$50").click();
  await ui.button("Execute").click();
  await expect(ui.verdict).toHaveAttribute("data-reason", "CONCENTRATION");
  await ui.button("Execute").click();
  await expect(ui.tape).toHaveCount(2);
  await expect(ui.tape.nth(1)).toContainText("Refused · CONCENTRATION");

  // One minute per arrow key: 15:59 is in session, 16:00 is not.
  await ui.button("Reset day").click();
  await ui.time.focus();
  for (let minute = 630; minute < 959; minute++) await page.keyboard.press("ArrowRight");
  await expect(ui.time).toHaveAttribute("aria-valuetext", "15:59 ET");
  await expect(ui.verdict).toHaveAttribute("data-reason", "OK");
  await page.keyboard.press("ArrowRight");
  await expect(ui.time).toHaveAttribute("aria-valuetext", "16:00 ET");
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");

  expect(errors).toEqual([]);
});

test("a share link reproduces its refusal, and a broken one falls back", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?day=2026-11-26&at=1030&buy=GOOGLc-10#try");
  const ui = sim(page);
  await expect(ui.verdict).toHaveAttribute("data-reason", "MARKET_CLOSED");
  await expect(ui.checks.nth(3)).toContainText("Thanksgiving · NYSE closed");
  const post = new URL((await ui.root.getByRole("link", { name: "Post on X" }).getAttribute("href")) ?? "");
  expect(post.searchParams.get("text")).toBe("I tried to buy $10 of GOOGLc on Thu 26 Nov at 10:30 ET. Maat said no: MARKET_CLOSED.");
  expect(post.searchParams.get("url")).toBe(`${new URL(page.url()).origin}/?day=2026-11-26&at=1030&buy=GOOGLc-10#try`);

  await page.goto("/?day=1999-01-01&at=9999&buy=TSLA-x&tape=junk#try");
  await expect(ui.verdict).toHaveAttribute("data-verdict", "allowed");
  expect(errors).toEqual([]);
});

for (const width of [360, 1024]) {
  test(`the longest simulator strings fit at ${width}px`, async ({ page }) => {
    // A clipboard that refuses, so the manual copy field shows.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?day=2026-11-05&at=1030&buy=NVDAc-999999999.99#try");
    const ui = sim(page);
    await expect(ui.verdict).toHaveAttribute("data-reason", "INSUFFICIENT_BALANCE");
    await expect(ui.root.locator('[data-check="balance"]')).toContainText("$999,999,999.99 > $200 USDC");
    let fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);

    await ui.button("Other token").click();
    await ui.button("Execute").click();
    await ui.button("Copy link").click();
    await expect(ui.root.getByRole("textbox", { name: "Copy this link:" })).toBeVisible();
    await expect(ui.tape.first()).toContainText("Refused · TOKEN_NOT_ALLOWED");
    fit = await measureFit(page);
    expect(fit.overflow).toBeLessThanOrEqual(0);
    expect(fit.clipped).toEqual([]);
  });
}
```

- [ ] **Step 4: Build and run the e2e suite**

Run: `npm run build && npm run check:out`
Expected: build succeeds; `out/ is ready to deploy`.

Run: `npm run e2e`
Expected: every smoke test and every simulator test PASSES. If Chromium is missing, run `npx playwright install chromium` first.

- [ ] **Step 5: Look at the screenshots**

Open `web/test-results/screens/landing-360.png` and `landing-1440.png`. Check that the `#try` section reads cleanly: two columns at 1440, stacked at 360, the shaded session on the slider track, the "fork" tags, and the footnote. Fix any visual defect in `Simulator.tsx` or `TryIt.tsx`, then rerun `npm run e2e`.

- [ ] **Step 6: Full verification**

Run: `npm run verify`
Expected: typecheck, all unit tests, build and `check:out` pass.

Run (repo root): `git grep -nP "[\x{0100}-\x{024F}\x{1E00}-\x{1EFF}]" -- web docs/superpowers/specs/2026-11-08-mandate-simulator-design.md docs/superpowers/plans/2026-11-08-mandate-simulator.md`
Expected: no output (no Vietnamese in the repo).

- [ ] **Step 7: Commit**

```bash
git add web/e2e/helpers.ts web/e2e/simulator.spec.ts web/e2e/smoke.spec.ts
git commit -m "test(web): e2e for the simulator; scope the hero checks to the hero"
```

Do not push. Report the branch, the commits and the verification output.
