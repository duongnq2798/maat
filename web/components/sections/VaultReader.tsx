"use client";

import { useEffect, useState } from "react";
import { type LedgerDeps, useLedger } from "@/components/ledger/useLedger";
import { RECORDED_VIEW, type VaultView } from "./VaultDecisions";
import { liveRows } from "./vault-live";
import { RECORDED_ROWS, type VaultRow } from "./vault-rows";

interface Whole {
  decisions: readonly VaultRow[];
  head: string;
}

/**
 * The landing's read of the vault, with /ledger's own loader. A read counts once it is whole: every block from the
 * deploy to the head scanned, and the block times read. A later refresh that misses a chunk keeps the last whole read
 * rather than show a shorter history. Renders nothing; it reports its view through `onView`.
 */
export default function VaultReader({ deps, onView }: { deps?: LedgerDeps; onView: (view: VaultView) => void }) {
  const ledger = useLedger(deps);
  const [whole, setWhole] = useState<Whole | null>(null);
  const snapshot = ledger.mode === "mainnet" ? ledger.snapshot : null;
  const isWhole = snapshot !== null && snapshot.scan.done && snapshot.rationaleState !== "checking";

  useEffect(() => {
    if (snapshot && isWhole) setWhole({ decisions: liveRows(snapshot), head: snapshot.scan.head.toString() });
  }, [snapshot, isWhole]);

  const failed = !whole && (ledger.mode === "error" || ledger.mode === "waiting" || (ledger.mode === "mainnet" && !ledger.loading && !isWhole));
  const retry = ledger.retry;
  useEffect(() => {
    if (whole) onView({ status: "live", decisions: whole.decisions, head: whole.head, retry: null });
    else if (failed) onView({ status: "recorded", decisions: RECORDED_ROWS, head: null, retry });
    else onView(RECORDED_VIEW);
  }, [whole, failed, retry, onView]);

  return null;
}
