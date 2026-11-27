"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { browserStorage } from "@/lib/chain/cache";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { nextLook, readLook, saveLook, sinceLastLook, type Since } from "@/lib/chain/since";

export interface LookDeps {
  /** Where the look is kept (default: this browser's localStorage); null keeps none. */
  storage?: Storage | null;
  now?: () => number;
}

/**
 * "Since your last look" (lib/chain/since.ts). The look this browser kept from the viewer's previous visit is read once,
 * when the page opens, and each read of the ledger is weighed against it; after each complete read, the newest
 * Decision and the time become the look the next visit reads. Storage that is blocked or absent leaves the page as it
 * is without this: no line and no mark.
 */
export function useLastLook(snapshot: LedgerSnapshot | null, loading: boolean, deps: LookDeps = {}): Since | null {
  const depsRef = useRef(deps);
  // On the server there is no window, so this is null; the browser reads its own storage when it hydrates.
  const [storage] = useState(() => (depsRef.current.storage !== undefined ? depsRef.current.storage : browserStorage()));
  const [previous] = useState(() => readLook(storage));

  useEffect(() => {
    if (!snapshot || loading) return;
    const look = nextLook(snapshot, (depsRef.current.now ?? Date.now)());
    if (look) saveLook(storage, look);
  }, [snapshot, loading, storage]);

  return useMemo(() => (snapshot ? sinceLastLook(previous, snapshot) : null), [previous, snapshot]);
}
