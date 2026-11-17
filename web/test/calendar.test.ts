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
