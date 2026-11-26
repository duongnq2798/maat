import { etToTimestamp, isoOfDay, localTime, parseIsoDay, sessionWindow } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { clockLabel, dayLabel } from "@/content/format";

/**
 * One closed NYSE window (spec section 2): a regular-session close to the next open, with a day without a session between.
 * The close may be an early close, and the window may start on any weekday, as before a holiday.
 */
export interface ClosedWindow {
  /** The ISO ET date of the close, e.g. "2026-11-13". */
  id: string;
  closeTs: number;
  openTs: number;
  closeLabel: string;
  openLabel: string;
}

const label = (day: number, minute: number) => `${dayLabel(isoOfDay(day))} ${clockLabel(minute)} ET`;

export function closedWindows(fromIso: string, toIso: string): ClosedWindow[] {
  const from = parseIsoDay(fromIso);
  const to = parseIsoDay(toIso);
  if (from === undefined || to === undefined || from > to) throw new Error(`bad range ${fromIso}..${toIso}`);
  const out: ClosedWindow[] = [];
  for (let day = from; day <= to; day++) {
    const today = sessionWindow(day);
    if (!today) continue;
    let next = day + 1;
    while (!sessionWindow(next)) {
      next++;
      if (next - day > 7) throw new Error(`no session within a week after ${isoOfDay(day)}`);
    }
    if (next - day < 2) continue; // an overnight gap between two session days, not a window
    const after = sessionWindow(next)!;
    out.push({
      id: isoOfDay(day),
      closeTs: etToTimestamp(day, today.closeMin),
      openTs: etToTimestamp(next, after.openMin),
      closeLabel: label(day, today.closeMin),
      openLabel: label(next, after.openMin),
    });
  }
  return out;
}

/** One instant at which MarketCalendar.isOpen(ts, REGULAR) must give `open` for a window's edges to hold. */
export interface CalendarCheck {
  ts: number;
  open: boolean;
}

/**
 * The instants that pin a window to MarketCalendar on Base: open the second before the close, closed at the close,
 * closed at 09:30 ET of every day between, closed the second before the open, and open at the open. Every REGULAR
 * session of the contract starts at 09:30 ET, so a day that is closed then has no session at all.
 */
export function calendarChecks(w: Pick<ClosedWindow, "closeTs" | "openTs">): CalendarCheck[] {
  const closeDay = localTime(w.closeTs).etDay;
  const openDay = localTime(w.openTs).etDay;
  const between: CalendarCheck[] = [];
  for (let day = closeDay + 1; day < openDay; day++) between.push({ ts: etToTimestamp(day, FACTS.nyseSessionMin.value.open), open: false });
  return [
    { ts: w.closeTs - 1, open: true },
    { ts: w.closeTs, open: false },
    ...between,
    { ts: w.openTs - 1, open: false },
    { ts: w.openTs, open: true },
  ];
}
