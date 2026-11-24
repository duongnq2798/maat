import { localTime, nextOpen, regularSession, WEEKDAY_NAMES } from "@/content/calendar";
import { clockLabel } from "@/content/format";
import { formatAge } from "./format";
import type { Session } from "./verdict";

/**
 * The countdown after session.detail on the strip's second row (spec 2026-11-23 section 6.1, amendment A9): when the
 * NYSE next opens after the block, and how long that is from the visitor's clock `nowSec`, floored to the minute.
 * - null in session, and null when MarketCalendar's answer differs from the repo calendar's (the row then says
 *   "MarketCalendar: open" or "MarketCalendar: closed", and the repo calendar cannot say when it opens);
 * - "in 2 h 30 min" when the open is later on the block's own ET day and session.detail already names it
 *   ("Monday · opens 09:30 ET");
 * - "opens Mon 09:30 ET · in 1 d 23 h" otherwise, and "in under 1 min" for the last minute. That includes a trading
 *   morning when MarketCalendar cannot be read: the detail then says "MarketCalendar unreadable · counted closed",
 *   which names no open.
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
  const time = clockLabel(open.minuteOfDay);
  if (open.etDay === localTime(blockTs).etDay && session.detail.endsWith(`opens ${time} ET`)) return `in ${wait}`;
  const day = (WEEKDAY_NAMES[open.weekday] ?? "").slice(0, 3);
  return `opens ${day} ${time} ET · in ${wait}`;
}
