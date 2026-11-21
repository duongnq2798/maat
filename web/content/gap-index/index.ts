import { NAV_TOKENS } from "@/content/b20-nav";
import { isoOfDay, localTime } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { dayLabel, formatInt } from "@/content/format";
import { EditionFileSchema, type EditionFile } from "@/lib/gap/schema";
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

/** A complete window's rows in tab order. */
export function rowsInTabOrder(w: CompleteWindow): CompleteWindow["tokens"] {
  return TAB_ORDER.flatMap((s) => w.tokens.filter((t) => t.symbol === s));
}
