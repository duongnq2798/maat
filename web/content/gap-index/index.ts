import { NAV_TOKENS } from "@/content/b20-nav";
import { holidayName, isoOfDay, localTime } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { clockLabel, dayLabel, formatInt } from "@/content/format";
import { SENDERS, type Sender } from "@/lib/gap/decisions";
import { EditionFileSchema, type Decisions, type EditionFile } from "@/lib/gap/schema";
import { formatEt } from "@/lib/live/format";
import edition0 from "./edition-0.json";

/** Parsed when the module loads, so a committed file the schema refuses fails the build, naming the file. */
function parse(name: string, json: unknown): EditionFile {
  const r = EditionFileSchema.safeParse(json);
  if (!r.success) throw new Error(`content/gap-index/${name} does not parse: ${r.error.message}`);
  return r.data;
}

/** Every published edition of the Weekend Gap Index, latest first. A new edition file is imported here. */
export const PUBLISHED: readonly EditionFile[] = [parse("edition-0.json", edition0)].sort((a, b) => b.edition - a.edition);

const BASKET: readonly string[] = FACTS.basket.value;

/** The order of a window's tabs and table rows: the basket as listed, then the other tokens alphabetically. */
export const TAB_ORDER: readonly string[] = [
  ...BASKET,
  ...NAV_TOKENS.map((t) => t.symbol)
    .filter((s) => !BASKET.includes(s))
    .sort(),
];

/** Hours to two decimals, as the edition holds them: 49.4 → "49.40 h". */
export function formatHours(h: number): string {
  return `${h.toFixed(2)} h`;
}

const MINUS = "−";

/** Signed basis points with a true minus: 254 → "+254 bps", -1262 → "−1,262 bps", 0 → "0 bps". */
export function signedBps(n: number): string {
  if (n === 0) return "0 bps";
  return `${n > 0 ? "+" : MINUS}${formatInt(Math.abs(n))} bps`;
}

/** A largest gap with its side: pool above the held answer is "+", below is "−", and at it, "0 bps". */
export function gapBps(g: { bps: number; above: boolean }): string {
  return signedBps(g.above ? g.bps : -g.bps);
}

/** Where the pool sat against the held answer at a largest gap; a gap of 0 bps is at it, whatever its flag says. */
export function gapSide(g: { bps: number; above: boolean }): "above" | "below" | "at" {
  if (g.bps === 0) return "at";
  return g.above ? "above" : "below";
}

/** A block time in New York with its day: "Fri 13 Nov 18:36 ET". */
export function etDateTime(ts: number): string {
  return `${dayLabel(isoOfDay(localTime(ts).etDay))} ${formatEt(ts)}`;
}

/** What a gap compares, printed beside every gap; the TWAP's length is the default mandate's. */
export const SPOT_NOT_TWAP = `the pool's spot price after a swap, not the ${FACTS.mandate.value.twapWindowSec / 60}-minute TWAP the vault checks`;

export type CompleteWindow = Extract<EditionFile["windows"][number], { status: "complete" }>;

const capitalized = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** "a", "a and b", "a, b and c". */
function andList(parts: readonly string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * What closed a window, when it is not a plain weekend: its early close, then each holiday and the weekend in the order
 * they come, and its length. Null for a regular Friday close to the Monday open, so edition 0's windows print nothing.
 */
export function closureNote(w: { closeTs: number; openTs: number }): string | null {
  const close = localTime(w.closeTs);
  const open = localTime(w.openTs);
  const parts: string[] = [];
  const early = close.minuteOfDay < FACTS.nyseSessionMin.value.close;
  if (early) parts.push(`early close at ${clockLabel(close.minuteOfDay)} ET`);
  let weekend = false;
  for (let day = close.etDay + 1; day < open.etDay; day++) {
    const holiday = holidayName(day);
    if (holiday !== undefined) parts.push(`${holiday}, ${dayLabel(isoOfDay(day))}`);
    else if (!weekend) {
      parts.push("the weekend");
      weekend = true;
    }
  }
  if (!early && parts.length === 1 && weekend) return null;
  return `${capitalized(parts.join(", then "))} · ${formatHours((w.openTs - w.closeTs) / 3600)} closed`;
}

const SENT_BY: Record<Sender, string> = {
  agent: "from the agent",
  probe: "probe",
  brief: "brief-driven",
  owner: "from the owner by hand",
  unlabelled: "through another contract",
};
const sentBy = (s: Sender, n: number) => (s === "probe" && n !== 1 ? "probes" : SENT_BY[s]);

/** One sentence on a window's Decisions: how many, from whom as /ledger labels them, and how many MARKET_CLOSED refused. */
export function decisionsSentence(d: Decisions): string {
  if (d.count === 0) return "The vault recorded no Decision in this window.";
  const senders = SENDERS.filter((s) => d.bySender[s].count > 0);
  const who = andList(senders.map((s) => `${formatInt(d.bySender[s].count)} ${sentBy(s, d.bySender[s].count)}`));
  const head = `The vault recorded ${formatInt(d.count)} ${d.count === 1 ? "Decision" : "Decisions"} in this window: ${who}.`;
  if (d.marketClosed === d.count) {
    const them = d.count === 1 ? "it" : d.count === 2 ? "both" : `all ${formatInt(d.count)}`;
    return `${head} It refused ${them} with MARKET_CLOSED.`;
  }
  const refused = senders.map((s) => `${formatInt(d.bySender[s].marketClosed)} of the ${formatInt(d.bySender[s].count)} ${sentBy(s, d.bySender[s].count)}`);
  return `${head} Refused with MARKET_CLOSED: ${andList(refused)}.`;
}

/** A complete window's rows in tab order. */
export function rowsInTabOrder(w: CompleteWindow): CompleteWindow["tokens"] {
  return TAB_ORDER.flatMap((s) => w.tokens.filter((t) => t.symbol === s));
}
