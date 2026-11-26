import { DAY_SECONDS, etOffsetSeconds, etToTimestamp, holidayName, isoOfDay, localTime, nextOpen, regularSession, sessionWindow, WEEKDAY_NAMES } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { clockLabel, dayLabel } from "@/content/format";

/**
 * The NYSE week /now draws (culture plan 2026-11-26, Move 8a): Monday to Sunday in New York time, each day split into
 * the REGULAR session and the windows MarketCalendar counts as closed, all read from content/calendar.ts, the repo's
 * tested port of contracts/src/MarketCalendar.sol. Nothing here reads a clock: every function takes the time it draws.
 */

/** Minutes in an ET wall-clock day, the length of one row of the grid. */
export const DAY_MIN = 1440;

const REGULAR_CLOSE = FACTS.nyseSessionMin.value.close;

/**
 * One stretch of an ET day. "open" is the REGULAR session; every other kind is a window in which MarketCalendar answers
 * closed, so the vault refuses a trade with MARKET_CLOSED: before the open and after the close of a trading day
 * ("overnight"), a Saturday or Sunday, a holiday, and on an early close the hours a full day would still be open.
 */
export type SpanKind = "open" | "overnight" | "weekend" | "holiday" | "early-close";

export interface WeekSpan {
  kind: SpanKind;
  /** Minutes after ET midnight, from 0. */
  fromMin: number;
  /** Minutes after ET midnight, up to DAY_MIN; the span ends just before it. */
  toMin: number;
}

export interface WeekDay {
  /** 0 for Monday to 6 for Sunday. */
  index: number;
  /** ET day number (day 0 = 1970-01-01). */
  etDay: number;
  /** "2026-11-26". */
  iso: string;
  /** "Thu 26 Nov". */
  label: string;
  /** "Thursday". */
  name: string;
  holiday: string | null;
  /** The REGULAR session, or null when NYSE is closed all day. */
  session: { openMin: number; closeMin: number } | null;
  /** In order, tiling 0 to DAY_MIN. */
  spans: WeekSpan[];
  /** "Open 09:30–16:00 ET", "Open 09:30–13:00 ET, early close", "Closed: Thanksgiving", "Closed: weekend". */
  detail: string;
}

export interface Week {
  /** The ET day number of its Monday. */
  monday: number;
  /** Unix seconds of Monday 00:00 ET. */
  startTs: number;
  /** Unix seconds of the next Monday 00:00 ET: the week ends just before it. */
  endTs: number;
  days: WeekDay[];
}

function spansOf(holiday: string | null, session: WeekDay["session"]): WeekSpan[] {
  if (holiday !== null) return [{ kind: "holiday", fromMin: 0, toMin: DAY_MIN }];
  if (session === null) return [{ kind: "weekend", fromMin: 0, toMin: DAY_MIN }];
  const { openMin, closeMin } = session;
  const spans: WeekSpan[] = [];
  if (openMin > 0) spans.push({ kind: "overnight", fromMin: 0, toMin: openMin });
  spans.push({ kind: "open", fromMin: openMin, toMin: closeMin });
  if (closeMin < REGULAR_CLOSE) spans.push({ kind: "early-close", fromMin: closeMin, toMin: REGULAR_CLOSE });
  const lateFrom = Math.max(closeMin, REGULAR_CLOSE);
  if (lateFrom < DAY_MIN) spans.push({ kind: "overnight", fromMin: lateFrom, toMin: DAY_MIN });
  return spans;
}

function detailOf(holiday: string | null, session: WeekDay["session"]): string {
  if (holiday !== null) return `Closed: ${holiday}`;
  if (session === null) return "Closed: weekend";
  const hours = `${clockLabel(session.openMin)}–${clockLabel(session.closeMin)} ET`;
  return session.closeMin < REGULAR_CLOSE ? `Open ${hours}, early close` : `Open ${hours}`;
}

/** The week, Monday to Sunday in New York time, that holds unix second `ts`. */
export function weekAt(ts: number): Week {
  const { etDay, weekday } = localTime(ts);
  const monday = etDay - ((weekday + 6) % 7);
  const days = Array.from({ length: 7 }, (_, index): WeekDay => {
    const day = monday + index;
    const holiday = holidayName(day) ?? null;
    const window = holiday === null ? sessionWindow(day) : undefined;
    const session = window === undefined ? null : { openMin: window.openMin, closeMin: window.closeMin };
    const iso = isoOfDay(day);
    return {
      index,
      etDay: day,
      iso,
      label: dayLabel(iso),
      name: WEEKDAY_NAMES[(index + 1) % 7] ?? "",
      holiday,
      session,
      spans: spansOf(holiday, session),
      detail: detailOf(holiday, session),
    };
  });
  return { monday, startTs: etToTimestamp(monday, 0), endTs: etToTimestamp(monday + 7, 0), days };
}

/** Where unix second `ts` falls in New York: its ET day and the minute of that day, with the seconds as a fraction. */
function etPlace(ts: number): { etDay: number; minute: number } {
  const local = ts - etOffsetSeconds(ts);
  const etDay = Math.floor(local / DAY_SECONDS);
  return { etDay, minute: (local - etDay * DAY_SECONDS) / 60 };
}

/** The now line: its row, its minute (with the seconds) and "10:00 ET"; null when `ts` is outside `week`. */
export function nowMark(week: Week, ts: number): { index: number; minute: number; label: string } | null {
  if (ts < week.startTs || ts >= week.endTs) return null;
  const { etDay, minute } = etPlace(ts);
  return { index: etDay - week.monday, minute, label: `${clockLabel(Math.floor(minute))} ET` };
}

/**
 * The Decisions of `week` on its rows, oldest first: each one's row and minute. A Decision whose block time was not
 * read, or that falls outside the week, has no place and is left out.
 */
export function placeTicks<T extends { timestamp: number | null }>(week: Week, decisions: readonly T[]): { item: T; index: number; minute: number }[] {
  return decisions
    .filter((d): d is T & { timestamp: number } => d.timestamp !== null && d.timestamp >= week.startTs && d.timestamp < week.endTs)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((item) => {
      const { etDay, minute } = etPlace(item.timestamp);
      return { item, index: etDay - week.monday, minute };
    });
}

/** "Mon 09:30 ET": the weekday and the ET clock of unix second `ts`. */
function weekdayClock(ts: number): string {
  const t = localTime(ts);
  return `${(WEEKDAY_NAMES[t.weekday] ?? "").slice(0, 3)} ${clockLabel(t.minuteOfDay)} ET`;
}

/**
 * The large line /now shows while NYSE is closed, from the session of the live reading and its block's time:
 * "NYSE closed · the vault refuses trades until Mon 09:30 ET", the next REGULAR open as the repo calendar counts it.
 * Null in session, and null when the reading's calendar says closed while the repo calendar says open: the repo calendar
 * cannot then say when it opens (the status line says "MarketCalendar: closed").
 */
export function closedLine(session: { open: boolean }, blockTs: number): string | null {
  if (session.open || regularSession(blockTs).open) return null;
  let opensAt: number;
  try {
    opensAt = nextOpen(blockTs);
  } catch {
    return null;
  }
  return `NYSE closed · the vault refuses trades until ${weekdayClock(opensAt)}`;
}

/** The plain line in session: "NYSE open until 16:00 ET", with "· early close" on one. Null unless both calendars say open. */
export function openLine(session: { open: boolean }, blockTs: number): string | null {
  const s = regularSession(blockTs);
  if (!session.open || !s.open) return null;
  const line = `NYSE open until ${clockLabel(s.closeMin)} ET`;
  return s.closeMin < REGULAR_CLOSE ? `${line} · early close` : line;
}

/** The session line of a reading: closed, open, or null when the two calendars disagree. */
export function sessionLine(session: { open: boolean }, blockTs: number): { tone: "closed" | "open"; text: string } | null {
  const closed = closedLine(session, blockTs);
  if (closed !== null) return { tone: "closed", text: closed };
  const open = openLine(session, blockTs);
  return open === null ? null : { tone: "open", text: open };
}

/** A minute of the day as a share of the row, for a CSS left or width: 570 → "39.5833%". */
export function pct(minutes: number): string {
  return `${Number(((minutes / DAY_MIN) * 100).toFixed(4))}%`;
}
