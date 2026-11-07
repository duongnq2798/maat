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
