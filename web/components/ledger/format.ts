import { formatUnits } from "viem";
import { clockLabel } from "@/content/format";
import { localTime } from "@/content/calendar";

/** A token amount with at most four decimals: "0.081", "1,250.5". */
export function formatQty(raw: bigint, decimals: number): string {
  return Number(formatUnits(raw, decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** A Chainlink answer with 8 decimals as dollars: "$185.12". */
export function formatPrice8(price8: bigint): string {
  return (Number(price8) / 1e8).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "14 s", "3 min", "2 h 5 min", "1 d 4 h". */
export function formatAge(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d} d` : `${d} d ${h % 24} h`;
}

/** Basis points as a percent with one decimal: "33.3%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

/** "10:31:05 ET" for a time in milliseconds. */
export function etClock(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const t = localTime(sec);
  return `${clockLabel(t.minuteOfDay)}:${String(sec % 60).padStart(2, "0")} ET`;
}

/** The host of an RPC URL, never its path (a keyed URL keeps its key out of the page). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "a custom RPC";
  }
}
