import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CalendarDay } from "../src/chain/state.js";
import { closedNote, closedPhase, gate, HOLIDAY_NAMES, LOGGABLE_REASONS, refusalKey } from "../src/refusals.js";
import { CALENDAR_MATH } from "./fakes/fakeChain.js";

const REGULAR = 0;
const FEED_24_5 = 1;
const NOV25 = 1_795_564_800; // 2026-11-25T00:00Z, a Wednesday; New York is on EST (UTC-5) from November 1
const HOUR = 3600;

/** The calendar's views at `ts`, as readVaultState carries them. */
function calendarAt(ts: number): CalendarDay {
  const [etDay, weekday, minuteOfDay] = CALENDAR_MATH.localTime(ts);
  return {
    etDay: BigInt(etDay),
    weekday,
    minuteOfDay,
    holiday: CALENDAR_MATH.holidays.has(etDay),
    earlyCloseMin: CALENDAR_MATH.earlyCloseMin.get(etDay) ?? 0,
  };
}

/** A plain trading day unless `over` says otherwise. */
const day = (weekday: number, minuteOfDay: number, over: Partial<CalendarDay> = {}): CalendarDay => ({
  etDay: 20_782n,
  weekday,
  minuteOfDay,
  holiday: false,
  earlyCloseMin: 0,
  ...over,
});
const hm = (h: number, m = 0) => h * 60 + m;

describe("gate", () => {
  const holiday = { day: "2026-11-26", reason: "MARKET_CLOSED:holiday" };
  it("executes OK intents", () => expect(gate("OK", null, false)).toEqual({ send: true, kind: "execute" }));
  it("does nothing when the guard is unknown", () => expect(gate("UNKNOWN", null, false)).toEqual({ send: false, why: "guard state unknown (RPC)" }));
  it("logs a market refusal once per key", () => {
    expect(gate("MARKET_CLOSED", holiday, false)).toEqual({ send: true, kind: "log-refusal" });
    expect(gate("MARKET_CLOSED", holiday, true)).toEqual({ send: false, why: "MARKET_CLOSED already logged for NYSE date 2026-11-26 (holiday)" });
    expect(gate("FEED_STALE", { day: "2026-11-25", reason: "FEED_STALE" }, true)).toEqual({ send: false, why: "FEED_STALE already logged for NYSE date 2026-11-25" });
    expect(gate("MARKET_CLOSED", { day: "20763", reason: "MARKET_CLOSED" }, true)).toEqual({ send: false, why: "MARKET_CLOSED already logged for UTC day 20763" });
  });
  it("leaves a refusal with no key to a later round", () => {
    expect(gate("MARKET_CLOSED", null, false)).toEqual({ send: false, why: "MARKET_CLOSED but the calendar is open at the state block; left to a round that reads the closed phase" });
  });
  it("never spends gas on bookkeeping refusals", () => {
    expect(gate("INSUFFICIENT_BALANCE", null, false)).toEqual({ send: false, why: "INSUFFICIENT_BALANCE not worth a log tx" });
    expect(gate("VAULT_PAUSED", null, false).send).toBe(false);
  });
  it("lists exactly the market-safety reasons", () => {
    expect([...LOGGABLE_REASONS].sort()).toEqual(
      ["BAD_PRICE", "CONCENTRATION", "DERISK_WINDOW", "FEED_STALE", "HEALTH_FACTOR_LOW", "MARKET_CLOSED", "MULTIPLIER_COOLDOWN", "POLICY_BLOCKED", "PREMIUM_TOO_HIGH", "SIZE_LIMIT", "TOKEN_PAUSED"],
    );
  });
});

describe("closedPhase", () => {
  it("names why a REGULAR session is closed", () => {
    expect(closedPhase(day(4, hm(10), { holiday: true }), REGULAR)).toBe("holiday");
    expect(closedPhase(day(6, hm(10), { holiday: true }), REGULAR)).toBe("holiday");
    expect(closedPhase(day(6, hm(11)), REGULAR)).toBe("weekend");
    expect(closedPhase(day(0, hm(11)), REGULAR)).toBe("weekend");
    expect(closedPhase(day(3, hm(9, 29)), REGULAR)).toBe("overnight");
    expect(closedPhase(day(3, hm(9, 30)), REGULAR)).toBeNull();
    expect(closedPhase(day(3, hm(15, 59)), REGULAR)).toBeNull();
    expect(closedPhase(day(3, hm(16)), REGULAR)).toBe("overnight");
    expect(closedPhase(day(3, hm(23, 30)), REGULAR)).toBe("overnight");
  });

  it("calls the time between an early close and 16:00 early-close, and the rest of that day overnight", () => {
    const early = { earlyCloseMin: hm(13) };
    expect(closedPhase(day(5, hm(8), early), REGULAR)).toBe("overnight");
    expect(closedPhase(day(5, hm(12, 59), early), REGULAR)).toBeNull();
    expect(closedPhase(day(5, hm(13), early), REGULAR)).toBe("early-close");
    expect(closedPhase(day(5, hm(15, 59), early), REGULAR)).toBe("early-close");
    expect(closedPhase(day(5, hm(16), early), REGULAR)).toBe("overnight");
  });

  it("closes the FEED_24_5 session only on holidays and the weekend window", () => {
    expect(closedPhase(day(3, hm(10), { holiday: true }), FEED_24_5)).toBe("holiday");
    expect(closedPhase(day(6, hm(12)), FEED_24_5)).toBe("weekend");
    expect(closedPhase(day(0, hm(19, 59)), FEED_24_5)).toBe("weekend");
    expect(closedPhase(day(0, hm(20)), FEED_24_5)).toBeNull();
    expect(closedPhase(day(5, hm(19, 59)), FEED_24_5)).toBeNull();
    expect(closedPhase(day(5, hm(20)), FEED_24_5)).toBe("weekend");
    expect(closedPhase(day(3, hm(3)), FEED_24_5)).toBeNull();
    expect(closedPhase(day(5, hm(14), { earlyCloseMin: hm(13) }), FEED_24_5)).toBeNull();
  });

  it("is null exactly when MarketCalendar.isOpen is true, every five minutes of Thanksgiving week", () => {
    for (const mode of [REGULAR, FEED_24_5]) {
      for (let ts = NOV25 - 3 * 24 * HOUR; ts < NOV25 + 5 * 24 * HOUR; ts += 300) {
        expect(closedPhase(calendarAt(ts), mode) === null, `ts ${ts} mode ${mode}`).toBe(CALENDAR_MATH.isOpen(ts, mode));
      }
    }
  });
});

describe("refusalKey", () => {
  const mandate = { sessionMode: REGULAR };
  const utcDay = (ts: number) => BigInt(Math.floor(ts / 86_400));
  const key = (reason: Parameters<typeof refusalKey>[0], ts: number) => refusalKey(reason, { day: utcDay(ts), calendar: calendarAt(ts), mandate });

  it("keys a refusal by NYSE date, and MARKET_CLOSED also by its closed phase", () => {
    expect(key("MARKET_CLOSED", NOV25 + 21 * HOUR + 30 * 60)).toEqual({ day: "2026-11-25", reason: "MARKET_CLOSED:overnight" });
    expect(key("MARKET_CLOSED", NOV25 + 28 * HOUR + 30 * 60)).toEqual({ day: "2026-11-25", reason: "MARKET_CLOSED:overnight" }); // 23:30 ET
    expect(key("MARKET_CLOSED", NOV25 + 39 * HOUR)).toEqual({ day: "2026-11-26", reason: "MARKET_CLOSED:holiday" });
    expect(key("MARKET_CLOSED", NOV25 + 50 * HOUR)).toEqual({ day: "2026-11-26", reason: "MARKET_CLOSED:holiday" }); // Thu 21:00 ET
    expect(key("MARKET_CLOSED", NOV25 + 61 * HOUR)).toEqual({ day: "2026-11-27", reason: "MARKET_CLOSED:overnight" });
    expect(key("MARKET_CLOSED", NOV25 + 67 * HOUR)).toEqual({ day: "2026-11-27", reason: "MARKET_CLOSED:early-close" });
    expect(key("FEED_STALE", NOV25 + 28 * HOUR + 30 * 60)).toEqual({ day: "2026-11-25", reason: "FEED_STALE" });
  });

  it("has no MARKET_CLOSED key while the calendar says the session is open", () => {
    expect(key("MARKET_CLOSED", NOV25 + 15 * HOUR)).toBeNull();
    expect(key("FEED_STALE", NOV25 + 15 * HOUR)).toEqual({ day: "2026-11-25", reason: "FEED_STALE" });
  });

  it("falls back to the UTC day when the calendar could not be read", () => {
    expect(refusalKey("MARKET_CLOSED", { day: 20_783n, calendar: null, mandate })).toEqual({ day: "20783", reason: "MARKET_CLOSED" });
  });
});

describe("closedNote", () => {
  const note = (calendar: CalendarDay | null, sessionMode = REGULAR) => closedNote({ calendar, mandate: { sessionMode } });

  it("names the closed phase for a MARKET_CLOSED rationale", () => {
    expect(note(calendarAt(NOV25 + 39 * HOUR))).toBe("NYSE holiday: Thanksgiving");
    expect(note(calendarAt(NOV25 + 67 * HOUR))).toBe("early close 13:00 ET");
    expect(note(calendarAt(NOV25 + 4 * 24 * HOUR + 15 * HOUR))).toBe("weekend"); // Sunday 29 November
    expect(note(calendarAt(NOV25 + 21 * HOUR + 30 * 60))).toBe("outside regular hours");
  });

  it("says only NYSE holiday for a date the name table does not hold", () => {
    // Friday 3 July 2026, a holiday the owner could add later with addHoliday.
    expect(note(day(5, hm(10), { etDay: 20_637n, holiday: true }))).toBe("NYSE holiday");
  });

  it("is null when the session is open or the calendar is unreadable", () => {
    expect(note(calendarAt(NOV25 + 15 * HOUR))).toBeNull();
    expect(note(null)).toBeNull();
  });
});

describe("parity with MarketCalendar.sol", () => {
  const sol = readFileSync(join(import.meta.dirname, "..", "..", "contracts", "src", "MarketCalendar.sol"), "utf8");
  const pad = (n = "") => n.padStart(2, "0");
  const civil = (y = "", m = "", d = "") => Date.UTC(Number(y), Number(m) - 1, Number(d)) / 86_400_000;
  const constant = (name: string) => Number(new RegExp(`${name} = (\\d+);`).exec(sol)?.[1]);

  it("names exactly the holidays its constructor adds, as its comments do", () => {
    const added = [...sol.matchAll(/_addHoliday\((\d+),\s*(\d+),\s*(\d+)\);\s*\/\/\s*([^\r\n]+)/g)].map((m) => [`${m[1]}-${pad(m[2])}-${pad(m[3])}`, m[4]!.trim()]);
    expect(added.length).toBeGreaterThan(0);
    expect(Object.entries(HOLIDAY_NAMES)).toEqual(added);
  });

  it("opens and closes at its OPEN_MIN, CLOSE_MIN and FEED_EDGE_MIN", () => {
    const [open, close, edge] = [constant("OPEN_MIN"), constant("CLOSE_MIN"), constant("FEED_EDGE_MIN")];
    expect([open, close, edge].every(Number.isInteger)).toBe(true);
    expect(closedPhase(day(3, open - 1), REGULAR)).toBe("overnight");
    expect(closedPhase(day(3, open), REGULAR)).toBeNull();
    expect(closedPhase(day(3, close - 1), REGULAR)).toBeNull();
    expect(closedPhase(day(3, close), REGULAR)).toBe("overnight");
    expect(closedPhase(day(0, edge - 1), FEED_24_5)).toBe("weekend");
    expect(closedPhase(day(0, edge), FEED_24_5)).toBeNull();
    expect(closedPhase(day(5, edge - 1), FEED_24_5)).toBeNull();
    expect(closedPhase(day(5, edge), FEED_24_5)).toBe("weekend");
  });

  it("gives the fake calendar the holidays and early closes its constructor sets", () => {
    const holidays = [...sol.matchAll(/_addHoliday\((\d+),\s*(\d+),\s*(\d+)\);/g)].map((m) => civil(m[1], m[2], m[3]));
    const early = [...sol.matchAll(/_setEarlyClose\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\);/g)].map((m) => [civil(m[1], m[2], m[3]), Number(m[4])]);
    expect(early.length).toBeGreaterThan(0);
    expect([...CALENDAR_MATH.holidays]).toEqual(holidays);
    expect([...CALENDAR_MATH.earlyCloseMin]).toEqual(early);
  });
});
