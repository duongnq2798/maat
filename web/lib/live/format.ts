import { localTime } from "@/content/calendar";
import { clockLabel } from "@/content/format";

/** "60013066" → "60,013,066". Digits only: a sign is kept in front. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A block number: 60_013_066n → "60,013,066". */
export function formatBlock(n: bigint): string {
  return n < 0n ? `-${group((-n).toString())}` : group(n.toString());
}

const UNITS = [
  ["d", 86_400],
  ["h", 3600],
  ["min", 60],
  ["s", 1],
] as const;

/** An age in whole seconds, in its two largest units: "14 s", "3 min 4 s", "2 h 5 min", "2 d 3 h". Below 0 is "0 s". */
export function formatAge(sec: number): string {
  let rest = Math.max(0, Math.floor(sec));
  const parts: string[] = [];
  for (const [unit, size] of UNITS) {
    const n = Math.floor(rest / size);
    rest -= n * size;
    if (parts.length > 0 || n > 0 || size === 1) parts.push(`${n} ${unit}`);
    if (parts.length === 2) break;
  }
  // "3 min 0 s" reads as "3 min"; the first part is never 0 unless the age is.
  const [first, second] = parts;
  return second === undefined || second.startsWith("0 ") ? (first ?? "0 s") : `${first} ${second}`;
}

/** A USD value with 8 decimals (a Chainlink answer, a TWAP) in dollars and cents, rounded half up: "$136.08". */
export function formatUsd8(v: bigint): string {
  const sign = v < 0n ? "-" : "";
  const cents = ((v < 0n ? -v : v) + 500_000n) / 1_000_000n;
  return `${sign}$${group((cents / 100n).toString())}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** A WAD (18 decimals) multiplier with up to 6 decimals, rounded half up, without trailing zeros: "1.000538", "8". */
export function formatMultiplier(wad: bigint): string {
  const sign = wad < 0n ? "-" : "";
  const micro = ((wad < 0n ? -wad : wad) + 500_000_000_000n) / 1_000_000_000_000n;
  const frac = (micro % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${sign}${micro / 1_000_000n}${frac ? `.${frac}` : ""}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A block time in UTC to the second: "16:43:08 UTC". */
export function formatUtc(sec: number): string {
  const d = new Date(sec * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/** A block time in New York to the minute, as MarketCalendar reads it: "11:43 ET". */
export function formatEt(sec: number): string {
  return `${clockLabel(localTime(sec).minuteOfDay)} ET`;
}

/** A date and minute in UTC: "2026-11-20 05:00 UTC". */
export function formatDateUtc(sec: number): string {
  const d = new Date(sec * 1000);
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
