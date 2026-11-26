"use client";

import { useEffect, useMemo, useRef } from "react";
import { type LedgerDeps, useLedger } from "@/components/ledger/useLedger";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { SNAPSHOT_REORG_WINDOW, SNAPSHOT_URL } from "@/lib/chain/snapshot";
import { LIVE_RPCS } from "@/lib/live/rpc";
import type { WeekDecision, WeekDecisionsView, WeekSnapshot } from "./MarketWeek";

/**
 * The vault's Decisions as /now's week draws them, newest first: each one's time, verdict, intent, the sender /ledger
 * names (§4 of the maat:v1 spec, owner first, so an operator Decision is never the agent's), and its Weighing number,
 * its place among all of them in chain order.
 */
export function weekDecisions(snapshot: LedgerSnapshot): WeekDecision[] {
  const n = snapshot.decisions.length;
  return snapshot.decisions.map((d, i) => {
    const trail = snapshot.trails.get(d.key);
    return {
      key: d.key,
      txHash: d.txHash,
      timestamp: d.timestamp,
      timeLabel: d.timeLabel,
      allowed: d.allowed,
      reason: d.reason,
      intent: `${d.action} ${d.symbol} · ${d.amountLabel}`,
      sender: trail === undefined ? "sender not read" : (trail.label ?? "sender unknown"),
      ordinal: n - i,
    };
  });
}

/**
 * Where the read took its oldest logs from: the committed snapshot of block N, whose logs up to N minus the reorg window
 * the loader takes once Base gives the same hash for block N and the same logs in their receipts (as /ledger's status
 * line says), or null when every block from the deploy was scanned.
 */
export function weekSnapshot(snapshot: LedgerSnapshot): WeekSnapshot | null {
  const from = snapshot.scan.fromSnapshot;
  return from === null ? null : { url: SNAPSHOT_URL, block: from.block, logsTo: from.block - SNAPSHOT_REORG_WINDOW - 1n };
}

/**
 * /now's read of the mainnet vault: /ledger's own loader (useLedger), on the keyless RPCs the board reads (LIVE_RPCS),
 * so the page reads no environment variable. A read counts once it is whole: every block from the deploy to the head
 * scanned or taken from the committed snapshot, and every Decision's transaction asked for, so each tick has its sender
 * and its number. A refresh that misses a chunk keeps the last whole read: its ticks stay, true up to its own head. Only
 * a first read that is not whole says so. Renders nothing; it reports through `onView`. Loaded once the page has
 * mounted, in its own chunk.
 */
export default function NowDecisions({ deps, onView }: { deps?: LedgerDeps; onView: (view: WeekDecisionsView) => void }) {
  const ledger = useLedger({ endpoints: LIVE_RPCS, ...deps });
  const snapshot = ledger.mode === "mainnet" ? ledger.snapshot : null;
  const whole = snapshot !== null && snapshot.scan.done && snapshot.txState === "read";
  const read = useMemo<WeekDecisionsView | null>(
    () => (whole && snapshot !== null ? { state: "read", decisions: weekDecisions(snapshot), snapshot: weekSnapshot(snapshot) } : null),
    [whole, snapshot],
  );
  const message = ledger.mode === "error" ? ledger.message : null;
  const settled = ledger.mode === "mainnet" && !ledger.loading;
  const { mode, retry } = ledger;
  // The last whole read of this attempt: a mainnet read that is not whole (a refresh under way, or one that missed
  // blocks) leaves it in place.
  const kept = useRef<WeekDecisionsView | null>(null);

  useEffect(() => {
    if (read !== null) kept.current = read;
    else if (mode !== "mainnet") kept.current = null;
    if (kept.current !== null) onView(kept.current);
    else if (mode === "waiting") onView({ state: "none" });
    else if (message !== null) onView({ state: "error", message, retry });
    else if (settled) onView({ state: "error", message: "some blocks up to the head could not be read", retry });
    else onView({ state: "reading" });
  }, [read, mode, message, settled, retry, onView]);

  return null;
}
