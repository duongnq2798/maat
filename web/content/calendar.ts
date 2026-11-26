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

/** The dates the simulator offers: from the fork day to the last date the calendar lists. */
export const WINDOW = {
  first: dayOf(FACTS.forkDay.value),
  last: Math.max(...HOLIDAYS.keys(), ...EARLY_CLOSES.keys()),
} as const;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
