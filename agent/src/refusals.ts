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

/** `key` is what the refusal is logged under (null when refusalKey has none) and `logged` whether it already was. */
export function gate(preview: PreviewResult, key: RefusalKey | null, logged: boolean): Gate {
  if (preview === "OK") return { send: true, kind: "execute" };
  if (preview === "UNKNOWN") return { send: false, why: "guard state unknown (RPC)" };
  if (!LOGGABLE_REASONS.has(preview)) return { send: false, why: `${preview} not worth a log tx` };
  if (!key) return { send: false, why: `${preview} but the calendar is open at the state block; left to a round that reads the closed phase` };
  return logged ? { send: false, why: `${preview} already logged for ${keyText(key)}` } : { send: true, kind: "log-refusal" };
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

/**
 * Names for the holidays MarketCalendar's constructor adds, keyed by NYSE date, in its order and with its comments'
 * words (a parity test reads contracts/src/MarketCalendar.sol). A holiday the owner adds later is "NYSE holiday".
 */
export const HOLIDAY_NAMES: Readonly<Record<string, string>> = {
  "2026-11-26": "Thanksgiving",
  "2026-12-25": "Christmas",
  "2027-01-01": "New Year",
  "2027-01-18": "Martin Luther King Jr. Day",
  "2027-02-15": "Washington's Birthday",
  "2027-03-26": "Good Friday",
  "2027-05-31": "Memorial Day",
  "2027-06-18": "Juneteenth (observed)",
  "2027-07-05": "Independence Day (observed)",
  "2027-09-06": "Labor Day",
  "2027-11-25": "Thanksgiving",
  "2027-12-24": "Christmas (observed)",
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
 * (the preview ran at a later block) has no phase and so no key: a later round, whose state block is closed, logs it.
 */
export function refusalKey(reason: ReasonName, s: KeyState): RefusalKey | null {
  if (s.calendar === null) return { day: s.day.toString(), reason };
  const day = isoDate(s.calendar.etDay);
  if (reason !== "MARKET_CLOSED") return { day, reason };
  const phase = closedPhase(s.calendar, s.mandate.sessionMode);
  return phase ? { day, reason: `${reason}:${phase}` } : null;
}

function keyText(k: RefusalKey): string {
  const ids = k.day.startsWith("brief:") ? k.day.slice("brief:".length).split(",") : null;
  if (ids) return `${ids.length === 1 ? "brief" : "briefs"} ${ids.join(", ")}`;
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

/**
 * The key a brief-driven intent's refusal is logged under: the ids of the briefs it adopts ("brief:3,5"), not the
 * NYSE date, so each adopted brief's refusal is logged as its own attempt and "vault refused" counts real ones.
 */
export function briefRefusalKey(q: readonly number[], reason: string): RefusalKey {
  return { day: `brief:${q.join(",")}`, reason };
}
