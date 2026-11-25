import { etToTimestamp, isoOfDay, parseIsoDay, sessionWindow } from "@/content/calendar";
import { clockLabel, dayLabel } from "@/content/format";

/** One closed NYSE window (spec section 2): a regular-session close to the next open, with a day without a session between. */
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
