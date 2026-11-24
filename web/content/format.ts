export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

const WORDS: Readonly<Record<number, string>> = { 9: "Nine", 19: "Nineteen" };

/** Counts the copy spells out. A new count fails the build until the sentence is rewritten. */
export function numberWord(n: number): string {
  const word = WORDS[n];
  if (word === undefined) throw new Error(`no word for ${n}; update the copy that spells it out`);
  return word;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-11-05" → "Thu 5 Nov". Noon UTC keeps the calendar day stable in every time zone. */
export function dayLabel(isoDate: string, plusDays = 0): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`bad date: ${isoDate}`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Minutes after midnight → zero-padded 24 h "HH:MM": 570 → "09:30", 1200 → "20:00". */
export function clockLabel(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new Error(`not a minute of the day (0-1439): ${minutes}`);
  }
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

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

/** The units a limit is written in on the instrument surfaces. */
export type LimitUnit = "s" | "bps";

/**
 * A limit as every new instrument surface writes it (spec 2026-11-23 section 5.1): "100 bps", and seconds with the
 * whole hours, or else the whole minutes, after them: "90,000 s (25 h)", "1,800 s (30 min)". Under a minute, or
 * when neither divides it, the seconds stand alone: "45 s", "90 s". The Mandate sheet keeps its own "90000 s" and
 * NowBoard its formatAge until phase P4.
 */
export function formatLimit(value: number, unit: LimitUnit): string {
  if (!Number.isInteger(value) || value < 0) throw new Error(`a limit is a whole number of ${unit}, 0 or more: ${value}`);
  if (unit === "bps") return `${formatInt(value)} bps`;
  const seconds = `${formatInt(value)} s`;
  if (value >= 3600 && value % 3600 === 0) return `${seconds} (${formatInt(value / 3600)} h)`;
  if (value >= 60 && value % 60 === 0) return `${seconds} (${formatInt(value / 60)} min)`;
  return seconds;
}
