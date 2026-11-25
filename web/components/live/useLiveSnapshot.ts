"use client";

import { type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import { classify, type LiveState, type Reading, REFRESH_MS } from "@/lib/live/freshness";
import { createReader, LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
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
  /**
   * False while the visitor holds the reading (HOLD, WCAG 2.2.2). No read starts, the refresh timer and the 5 s
   * reclassify interval do not run, and the frame on screen does not change: a read already in flight finishes, and its
   * answer waits until the hold ends. A read that `refresh` asks for is shown at once, held or not. When it turns true
   * again, the clocks are read at once, so a reading that aged while held shows its age, and it reads at once if the
   * last read started `refreshMs` ago or more. Default true.
   */
  active?: boolean;
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
 * back after more than `refreshMs` reads at once. A tab or page that comes back looks at the clocks at once, so a reading
 * that aged while it slept is not shown as live while the new read runs. One read at a time. A failed read keeps the last
 * good reading, which `classify` then marks as not live. `refresh` reads now (a Retry or Refresh button), and
 * `refreshing` stays true until that read settles, while the state stays as it was; `endpoints` are the keyless RPCs the
 * default reader tries, in order. While `active` is false (HOLD) nothing runs and nothing on screen changes (see
 * LiveSnapshotOptions.active). A page runs this once: the landing through LiveSnapshotProvider.
 */
export function useLiveSnapshot(opts: LiveSnapshotOptions = {}): {
  state: LiveState;
  refresh: () => void;
  refreshing: boolean;
  endpoints: readonly string[];
} {
  const refreshMs = opts.refreshMs ?? REFRESH_MS;
  const active = opts.active ?? true;
  const [seen, setSeen] = useState<Seen>({ last: undefined, failed: false, refreshing: false, nowMs: 0, wallSec: 0 });

  // The latest options, read when a read starts, so a new function each render does not restart the loop.
  const options = useRef(opts);
  useEffect(() => {
    options.current = opts;
  });
  // The default reader, made on the first read in this browser, never at module scope or during a render.
  const fallback = useRef<LiveReader | null>(null);
  const readNow = useRef<(() => void) | null>(null);
  // Pauses and resumes the loop below; the second effect calls them when `active` changes.
  const control = useRef<{ pause: () => void; resume: () => void } | null>(null);

  useEffect(() => {
    let disposed = false;
    let inflight = false;
    let lastAttemptAt = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tick: ReturnType<typeof setInterval> | undefined;
    // Held: no read starts and no timer runs. An answer that settles meanwhile waits in `pending`.
    let paused = options.current.active === false;
    let pending: SetStateAction<Seen> | null = null;
    // A read the visitor asked for (Retry, Refresh) is shown at once, held or not.
    let forceCommit = false;

    const now = () => (options.current.nowMs ?? (() => performance.now()))();
    const wall = () => (options.current.wallSec ?? (() => Date.now() / 1000))();
    const reader = () => options.current.reader ?? (fallback.current ??= createReader());

    // The next read, refreshMs after the last one started; a hidden tab skips it and reads when it is shown again.
    const schedule = () => {
      clearTimeout(timer);
      timer = undefined;
      if (paused) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          if (document.visibilityState === "visible") void read();
        },
        Math.max(0, lastAttemptAt + refreshMs - now()),
      );
    };

    // One read, as the next state to show. It never throws.
    const attempt = async (): Promise<SetStateAction<Seen>> => {
      try {
        const snapshot = await readSnapshot(reader());
        // Both clocks as the answer arrived: the age runs from them, and the head's lag is fixed by the wall clock then.
        const at = { nowMs: now(), wallSec: wall() };
        return { last: judge(snapshot, at), failed: false, refreshing: false, ...at };
      } catch (e) {
        // An RPC that did not answer is said on the page, and the browser logs the failed request. An answer that did
        // not decode, or a throw in the verdict, is said nowhere else: one warning tells a developer why.
        if (!(e instanceof RpcError) || e.failures.some((f) => f.badAnswer)) console.warn("live: the reading failed:", e);
        const error = e instanceof Error ? e.message : String(e);
        // Clocks are read here, not in the updater, which React may call twice.
        const at = { nowMs: now(), wallSec: wall() };
        return (s: Seen) => ({ last: s.last, failed: true, error, refreshing: false, ...at });
      }
    };

    const read = async () => {
      if (inflight || disposed) return;
      inflight = true;
      clearTimeout(timer);
      timer = undefined;
      lastAttemptAt = now();
      const next = await attempt();
      inflight = false;
      if (disposed) return;
      if (paused && !forceCommit) {
        pending = next;
      } else {
        pending = null;
        setSeen(next);
      }
      forceCommit = false;
      schedule();
    };

    // Look at the clocks again, so the age and the stale state move on without a new read.
    const restamp = () => {
      const at = { nowMs: now(), wallSec: wall() };
      setSeen((s) => (s.last === undefined ? s : { ...s, ...at }));
    };

    // The tab is visible again, or the page is back from the back/forward cache (pageshow, which some browsers send
    // without a visibilitychange). The timers did not run while it slept, so the clocks are read at once: an old reading
    // never shows as live, even for the 5 s until the next tick. A held reading stays as it is.
    const onShow = () => {
      if (paused || document.visibilityState !== "visible") return;
      restamp();
      if (inflight) return;
      // A pending timer still reads on time; one that fired while hidden left none, so read now.
      if (timer === undefined || now() - lastAttemptAt >= refreshMs) void read();
    };

    const startTick = () => {
      clearInterval(tick);
      tick = setInterval(restamp, RECLASSIFY_MS);
    };

    const pause = () => {
      if (paused) return;
      paused = true;
      clearTimeout(timer);
      timer = undefined;
      clearInterval(tick);
      tick = undefined;
    };

    const resume = () => {
      if (!paused) return;
      paused = false;
      if (pending !== null) {
        setSeen(pending);
        pending = null;
      }
      startTick();
      restamp();
      // A read still in flight schedules the next one when it settles.
      if (inflight) return;
      if (now() - lastAttemptAt >= refreshMs && document.visibilityState === "visible") void read();
      else schedule();
    };

    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    readNow.current = () => {
      forceCommit = true;
      void read();
    };
    control.current = { pause, resume };
    if (!paused) {
      startTick();
      void read();
    }

    return () => {
      disposed = true;
      readNow.current = null;
      control.current = null;
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, [refreshMs]);

  useEffect(() => {
    if (active) control.current?.resume();
    else control.current?.pause();
  }, [active]);

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
