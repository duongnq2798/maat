"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readJournal, type JournalRead } from "@/lib/chain/ledger";

/** The agent-journal branch as the page has read it: not asked yet, being read, or read. */
export type JournalView = { state: "idle" } | { state: "loading" } | JournalRead;

/**
 * Reads the public agent-journal branch once `enabled` turns true, and again on `reload`. The page enables it when the
 * Rounds tab opens or a Decision carries a maat:v1 blob, so a visit that needs neither never calls GitHub.
 */
export function useJournal(enabled: boolean, read: () => Promise<JournalRead> = readJournal): JournalView & { reload: () => void } {
  const readRef = useRef(read);
  const [view, setView] = useState<JournalView>({ state: "idle" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setView({ state: "loading" });
    readRef
      .current()
      .catch((e: unknown): JournalRead => ({ state: "error", message: e instanceof Error ? e.message : String(e) }))
      .then((r) => {
        if (live) setView(r);
      });
    return () => {
      live = false;
    };
  }, [enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...view, reload };
}
