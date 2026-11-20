import type { LiveSnapshot } from "./snapshot";
import type { Headline, Session, TokenVerdict } from "./verdict";

/** A reading is shown as live only while it is younger than this, on the visitor's monotonic clock (spec section 5). */
export const LIVE_MAX_AGE_MS = 90_000;
/** ...and while its block is at most this far behind the visitor's wall clock: an RPC serving an old head is not live. */
export const HEAD_MAX_LAG_SEC = 120;
/** How often a visible tab reads Base again. */
export const REFRESH_MS = 30_000;

/** One good answer, judged: what the strip and /now show. */
export interface Reading {
  snapshot: LiveSnapshot;
  verdicts: TokenVerdict[];
  headline: Headline;
  session: Session;
  /** The visitor's monotonic clock (performance.now()) when the answer arrived, ms. */
  readAtMs: number;
}

export type LiveState =
  | { status: "reading" }
  | { status: "error"; message: string }
  | { status: "live" | "stale" | "behind"; reading: Reading; ageMs: number; lagSec: number; refreshFailed: boolean };

/**
 * What to call the last good reading now. In order: no reading yet → reading, or error when the first read failed;
 * the latest refresh failed → stale; the block is more than HEAD_MAX_LAG_SEC behind the wall clock → behind; the
 * reading is older than LIVE_MAX_AGE_MS → stale; else live.
 */
export function classify(
  last: Reading | undefined,
  lastAttemptFailed: boolean,
  nowMs: number,
  wallSec: number,
  lastError?: string,
): LiveState {
  if (last === undefined) {
    return lastAttemptFailed ? { status: "error", message: lastError ?? "the read failed" } : { status: "reading" };
  }
  const ageMs = nowMs - last.readAtMs;
  const lagSec = wallSec - last.snapshot.timestamp;
  const seen = { reading: last, ageMs, lagSec, refreshFailed: lastAttemptFailed };
  if (lastAttemptFailed) return { status: "stale", ...seen };
  if (lagSec > HEAD_MAX_LAG_SEC) return { status: "behind", ...seen };
  if (ageMs > LIVE_MAX_AGE_MS) return { status: "stale", ...seen };
  return { status: "live", ...seen };
}
