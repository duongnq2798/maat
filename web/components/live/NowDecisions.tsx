"use client";

import { useEffect, useMemo } from "react";
import { type LedgerDeps, useLedger } from "@/components/ledger/useLedger";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { LIVE_RPCS } from "@/lib/live/rpc";
import type { WeekDecision, WeekDecisionsView } from "./MarketWeek";

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
 * /now's read of the mainnet vault: /ledger's own loader (useLedger), on the keyless RPCs the board reads (LIVE_RPCS),
 * so the page reads no environment variable. A read counts once it is whole: every block from the deploy to the head
 * scanned and every Decision's transaction asked for, so each tick has its sender and its number. A refresh that misses
 * a chunk keeps the last whole read. Renders nothing; it reports through `onView`. Loaded once the page has mounted, in
 * its own chunk.
 */
export default function NowDecisions({ deps, onView }: { deps?: LedgerDeps; onView: (view: WeekDecisionsView) => void }) {
  const ledger = useLedger({ endpoints: LIVE_RPCS, ...deps });
  const snapshot = ledger.mode === "mainnet" ? ledger.snapshot : null;
  const whole = snapshot !== null && snapshot.scan.done && snapshot.txState === "read";
  const decisions = useMemo(() => (whole && snapshot !== null ? weekDecisions(snapshot) : null), [whole, snapshot]);
  const message = ledger.mode === "error" ? ledger.message : null;
  const settled = ledger.mode === "mainnet" && !ledger.loading;
  const { mode, retry } = ledger;

  useEffect(() => {
    if (decisions !== null) onView({ state: "read", decisions });
    else if (mode === "waiting") onView({ state: "none" });
    else if (message !== null) onView({ state: "error", message, retry });
    else if (settled) onView({ state: "error", message: "some blocks from the deploy to the head could not be read", retry });
    else onView({ state: "reading" });
  }, [decisions, mode, message, settled, retry, onView]);

  return null;
}
