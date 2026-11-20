"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { classify, type LiveState, type Reading, REFRESH_MS } from "@/lib/live/freshness";
import { createReader, LIVE_RPCS, type LiveReader } from "@/lib/live/rpc";
import { type LiveSnapshot, readSnapshot } from "@/lib/live/snapshot";
import { headline, judgeToken, sessionAt } from "@/lib/live/verdict";

export interface LiveSnapshotOptions {
  /** Answers the multicall; the keyless public RPCs (LIVE_RPCS) when left out. */
  reader?: LiveReader;
  refreshMs?: number;
  /** The visitor's monotonic clock, ms: performance.now(). */
  nowMs?: () => number;
  /** The visitor's wall clock, s: Date.now() / 1000. */
  wallSec?: () => number;
}

/** How often the age and the stale state move on without a new read. */
const RECLASSIFY_MS = 5_000;

interface Seen {
  last: Reading | undefined;
  /** Whether the latest read that settled failed. */
  failed: boolean;
  error?: string;
  /** Whether a read that refresh() asked for has not settled yet. */
  refreshing: boolean;
  /** The clocks when this was last looked at, so the render itself reads no clock. */
  nowMs: number;
  wallSec: number;
}

function judge(snapshot: LiveSnapshot, at: { nowMs: number; wallSec: number }): Reading {
  const session = sessionAt(snapshot);
  const verdicts = snapshot.tokens.map((t) => judgeToken(t, { timestamp: snapshot.timestamp, session }));
  return { snapshot, verdicts, headline: headline(verdicts), session, readAtMs: at.nowMs, wallAtReadSec: at.wallSec };
}

/**
 * Base mainnet, read in the browser. Nothing runs during the server render: the static HTML and the first client render
 * are the reading state. After mount it reads once, then every `refreshMs` while the tab is visible; a tab that comes
 * back after more than `refreshMs` reads at once. One read at a time. A failed read keeps the last good reading, which
 * `classify` then marks as not live. `refresh` reads now (a Retry or Refresh button), and `refreshing` stays true until
 * that read settles, while the state stays as it was; `endpoints` are the keyless RPCs the default reader tries, in order.
 */
export function useLiveSnapshot(opts: LiveSnapshotOptions = {}): {
  state: LiveState;
  refresh: () => void;
  refreshing: boolean;
  endpoints: readonly string[];
} {
  const refreshMs = opts.refreshMs ?? REFRESH_MS;
  const [seen, setSeen] = useState<Seen>({ last: undefined, failed: false, refreshing: false, nowMs: 0, wallSec: 0 });

  // The latest options, read when a read starts, so a new function each render does not restart the loop.
  const options = useRef(opts);
  useEffect(() => {
    options.current = opts;
  });
  // The default reader, made on the first read in this browser, never at module scope or during a render.
  const fallback = useRef<LiveReader | null>(null);
  const readNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false;
    let inflight = false;
    let lastAttemptAt = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const now = () => (options.current.nowMs ?? (() => performance.now()))();
    const wall = () => (options.current.wallSec ?? (() => Date.now() / 1000))();
    const reader = () => options.current.reader ?? (fallback.current ??= createReader());

    // The next read, refreshMs after the last one started; a hidden tab skips it and reads when it is shown again.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          timer = undefined;
          if (document.visibilityState === "visible") void read();
        },
        Math.max(0, lastAttemptAt + refreshMs - now()),
      );
    };

    const read = async () => {
      if (inflight || disposed) return;
      inflight = true;
      clearTimeout(timer);
      timer = undefined;
      lastAttemptAt = now();
      try {
        const snapshot = await readSnapshot(reader());
        // Both clocks as the answer arrived: the age runs from them, and the head's lag is fixed by the wall clock then.
        const at = { nowMs: now(), wallSec: wall() };
        if (!disposed) setSeen({ last: judge(snapshot, at), failed: false, refreshing: false, ...at });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        // Clocks are read here, not in the updater, which React may call twice.
        const at = { nowMs: now(), wallSec: wall() };
        if (!disposed) setSeen((s) => ({ last: s.last, failed: true, error, refreshing: false, ...at }));
      } finally {
        inflight = false;
        if (!disposed) schedule();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible" || inflight) return;
      // A pending timer still reads on time; one that fired while hidden left none, so read now.
      if (timer === undefined || now() - lastAttemptAt >= refreshMs) void read();
    };

    const tick = setInterval(() => {
      const at = { nowMs: now(), wallSec: wall() };
      setSeen((s) => (s.last === undefined ? s : { ...s, ...at }));
    }, RECLASSIFY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    readNow.current = () => void read();
    void read();

    return () => {
      disposed = true;
      readNow.current = null;
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshMs]);

  const refresh = useCallback(() => {
    const readOnce = readNow.current;
    if (readOnce === null) return;
    // A read already in flight answers this request too: it clears `refreshing` when it settles.
    setSeen((s) => ({ ...s, refreshing: true }));
    readOnce();
  }, []);

  return {
    state: classify(seen.last, seen.failed, seen.nowMs, seen.wallSec, seen.error),
    refresh,
    refreshing: seen.refreshing,
    endpoints: LIVE_RPCS,
  };
}
