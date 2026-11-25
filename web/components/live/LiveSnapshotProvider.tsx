"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import type { LiveState } from "@/lib/live/freshness";
import type { LiveReader } from "@/lib/live/rpc";
import { useLiveSnapshot } from "./useLiveSnapshot";

/** What every live surface on a page reads: the one snapshot, its refresh, and HOLD. */
export interface LiveSnapshotValue {
  state: LiveState;
  refresh: () => void;
  refreshing: boolean;
  /** True while the visitor holds the reading (HoldKey): no read, no timer, a frozen frame. */
  hold: boolean;
  setHold: (hold: boolean) => void;
}

const LiveSnapshotContext = createContext<LiveSnapshotValue | null>(null);

/**
 * Runs exactly one useLiveSnapshot for the page (spec 2026-11-23 section 3.8) and gives it to every live surface under
 * it: the strip, HoldKey, the ThumbBar's lamp. HOLD is state here, and turns the hook's `active` off. The landing mounts
 * it in app/(site)/page.tsx; `reader` is for tests.
 */
export function LiveSnapshotProvider({ reader, children }: { reader?: LiveReader; children: ReactNode }) {
  const [hold, setHold] = useState(false);
  const { state, refresh, refreshing } = useLiveSnapshot({ reader, active: !hold });
  return <LiveSnapshotContext value={{ state, refresh, refreshing, hold, setHold }}>{children}</LiveSnapshotContext>;
}

/** The page's live snapshot. Throws outside a LiveSnapshotProvider: a live surface must never start a loop of its own. */
export function useLive(): LiveSnapshotValue {
  const live = useContext(LiveSnapshotContext);
  if (live === null) throw new Error("useLive needs a LiveSnapshotProvider above it");
  return live;
}

/** The page's live snapshot, or null where no provider runs (a page that reads no chain shows its unlit frame). */
export function useLiveIfAny(): LiveSnapshotValue | null {
  return useContext(LiveSnapshotContext);
}
