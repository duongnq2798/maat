import type { PreviewResult } from "./chain/preview.js";
import type { CalendarDay } from "./chain/state.js";
import { SESSION_MODES, type ReasonName } from "./types.js";

/** Refusals worth one onchain Decision log per NYSE date, per closed phase for MARKET_CLOSED: the market-safety story (spec §3.5 step 3). */
export const LOGGABLE_REASONS: ReadonlySet<ReasonName> = new Set<ReasonName>([
  "MARKET_CLOSED",
  "FEED_STALE",
  "BAD_PRICE",
  "MULTIPLIER_COOLDOWN",
  "PREMIUM_TOO_HIGH",
  "TOKEN_PAUSED",
  "POLICY_BLOCKED",
  "SIZE_LIMIT",
  "CONCENTRATION",
  "HEALTH_FACTOR_LOW",
  "DERISK_WINDOW",
]);

export type Gate = { send: true; kind: "execute" | "log-refusal" } | { send: false; why: string };

/** `logged` is the key this refusal was already logged under, or null when it was not. */
export function gate(preview: PreviewResult, logged: RefusalKey | null): Gate {
  if (preview === "OK") return { send: true, kind: "execute" };
  if (preview === "UNKNOWN") return { send: false, why: "guard state unknown (RPC)" };
  if (!LOGGABLE_REASONS.has(preview)) return { send: false, why: `${preview} not worth a log tx` };
  return logged ? { send: false, why: `${preview} already logged for ${keyText(logged)}` } : { send: true, kind: "log-refusal" };
}

/**
 * A refusal is logged onchain at most once per key: the NYSE date and the reason, with the closed phase for
 * MARKET_CLOSED ("MARKET_CLOSED:holiday"). `day` is "2026-11-26", or a UTC day number such as "20783" when the
 * calendar could not be read (the only key older code wrote).
 */
export interface RefusalKey {
  day: string;
  reason: string;
}

/** Why MarketCalendar.isOpen is false. */
export type ClosedPhase = "holiday" | "weekend" | "early-close" | "overnight";

// MarketCalendar's constants, in minutes after midnight New York time.
const OPEN_MIN = 570; // 09:30
const CLOSE_MIN = 960; // 16:00
const FEED_EDGE_MIN = 1200; // 20:00
const REGULAR = SESSION_MODES.indexOf("REGULAR");

/** Names for the holidays MarketCalendar's constructor adds, keyed by NYSE date. */
export const HOLIDAY_NAMES: Readonly<Record<string, string>> = {
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Christmas",
  "2027-01-01": "New Year",
};

/** The closed phase at `c`, decided branch for branch as MarketCalendar.isOpen does; null when the session is open. */
export function closedPhase(c: CalendarDay, sessionMode: number): ClosedPhase | null {
  if (c.holiday) return "holiday";
  const { weekday: wd, minuteOfDay: m } = c;
  if (sessionMode === REGULAR) {
    if (wd === 0 || wd === 6) return "weekend";
    const close = c.earlyCloseMin !== 0 ? c.earlyCloseMin : CLOSE_MIN;
    if (m >= OPEN_MIN && m < close) return null;
    return m >= close && m < CLOSE_MIN ? "early-close" : "overnight";
  }
  if (wd === 6 || (wd === 0 && m < FEED_EDGE_MIN) || (wd === 5 && m >= FEED_EDGE_MIN)) return "weekend";
  return null;
}

/** "2026-11-26" for a day number counted from 1970-01-01. */
const isoDate = (day: bigint) => new Date(Number(day) * 86_400_000).toISOString().slice(0, 10);

type KeyState = { day: bigint; calendar: CalendarDay | null; mandate: { sessionMode: number } };

/**
 * The key a refusal at the state block is logged under. Without the calendar it falls back to the vault's UTC day,
 * so the agent still logs at most once per reason per UTC day. MARKET_CLOSED in a session the calendar reports open
 * (the preview ran at a later block) keeps no phase.
 */
export function refusalKey(reason: ReasonName, s: KeyState): RefusalKey {
  if (s.calendar === null) return { day: s.day.toString(), reason };
  const phase = reason === "MARKET_CLOSED" ? closedPhase(s.calendar, s.mandate.sessionMode) : null;
  return { day: isoDate(s.calendar.etDay), reason: phase ? `${reason}:${phase}` : reason };
}

function keyText(k: RefusalKey): string {
  const day = /^\d+$/.test(k.day) ? `UTC day ${k.day}` : `NYSE date ${k.day}`;
  const phase = k.reason.split(":")[1];
  return phase ? `${day} (${phase})` : day;
}

/** What a MARKET_CLOSED log adds to its rationale: the closed phase in words. Null when the calendar does not say closed. */
export function closedNote(s: Pick<KeyState, "calendar" | "mandate">): string | null {
  if (s.calendar === null) return null;
  switch (closedPhase(s.calendar, s.mandate.sessionMode)) {
    case "holiday": {
      const name = HOLIDAY_NAMES[isoDate(s.calendar.etDay)];
      return name ? `NYSE holiday: ${name}` : "NYSE holiday";
    }
    case "early-close": {
      const m = s.calendar.earlyCloseMin;
      return `early close ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")} ET`;
    }
    case "weekend":
      return "weekend";
    case "overnight":
      return "outside regular hours";
    case null:
      return null;
  }
}
