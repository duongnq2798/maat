import type { LiveSnapshot } from "./snapshot";
import type { Headline, Session, TokenVerdict } from "./verdict";

/** A reading is shown as live only while it was read less than this ago, on both of the visitor's clocks (spec 5). */
export const LIVE_MAX_AGE_MS = 90_000;
/**
 * ...and when its block was at most this far behind the visitor's wall clock as it was read: an RPC serving an old head
 * is not live.
 */
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
  /** The visitor's wall clock (Date.now() / 1000) when the answer arrived, s. */
  wallAtReadSec: number;
}

export type LiveState =
  | { status: "reading" }
  | { status: "error"; message: string }
  | {
      status: "live" | "stale" | "behind";
      reading: Reading;
      /** How long ago the reading arrived: the larger of the two clocks, so a device that slept still ages it. */
      ageMs: number;
      /** How far the block was behind the wall clock when it was read. It does not grow while the reading ages. */
      lagSec: number;
      refreshFailed: boolean;
    };

/**
 * What to call the last good reading now. In order: no reading yet → reading, or error when the first read failed;
 * the latest refresh failed → stale; the block was more than HEAD_MAX_LAG_SEC behind the wall clock when it was read →
 * behind; it was read LIVE_MAX_AGE_MS ago or more, on the monotonic clock or on the wall clock (performance.now() can
 * pause while a device sleeps) → stale; else live.
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
  const ageMs = Math.max(0, nowMs - last.readAtMs, (wallSec - last.wallAtReadSec) * 1000);
  const lagSec = last.wallAtReadSec - last.snapshot.timestamp;
  const seen = { reading: last, ageMs, lagSec, refreshFailed: lastAttemptFailed };
  if (lastAttemptFailed) return { status: "stale", ...seen };
  if (lagSec > HEAD_MAX_LAG_SEC) return { status: "behind", ...seen };
  if (ageMs >= LIVE_MAX_AGE_MS) return { status: "stale", ...seen };
  return { status: "live", ...seen };
}
