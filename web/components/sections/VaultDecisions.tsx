"use client";

import { createContext, lazy, type ReactNode, Suspense, useContext, useEffect, useState } from "react";
import type { LedgerDeps } from "@/components/ledger/useLedger";
import { RECORDED_ROWS, type VaultRow } from "./vault-rows";

/**
 * What the landing shows of the mainnet vault:
 * - "live": every Decision since the deploy, read from Base by this browser;
 * - "reading": the read is under way (or JavaScript has not run yet), and the recorded Decisions stand in;
 * - "recorded": the read failed, so the recorded Decisions show.
 */
export type VaultStatus = "live" | "reading" | "recorded";

export interface VaultView {
  status: VaultStatus;
  /** Newest first. */
  decisions: readonly VaultRow[];
  /** The block the live read reached, decimal, or null before one lands. */
  head: string | null;
  /** Starts the read again after it failed; null while there is nothing to retry. */
  retry: (() => void) | null;
}

/** The view before the read lands, in the static HTML and where no provider runs: the recorded Decisions. */
export const RECORDED_VIEW: VaultView = { status: "reading", decisions: RECORDED_ROWS, head: null, retry: null };

const VaultContext = createContext<VaultView | null>(null);

/** The ledger's loader, in its own chunk: the landing's first load carries no RPC client and no ABI. */
const VaultReader = lazy(() => import("./VaultReader"));

/**
 * Reads the mainnet vault once for the whole landing, so the bar and the engine card show the same Decisions. The read
 * is /ledger's own loader (useLedger, in VaultReader.tsx), loaded once the page has hydrated; until it lands, and if it
 * fails, the recorded Decisions show. `deps` is for tests.
 */
export function VaultDecisionsProvider({ deps, children }: { deps?: LedgerDeps; children: ReactNode }) {
  const [view, setView] = useState<VaultView>(RECORDED_VIEW);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <VaultContext value={view}>
      {children}
      {mounted ? (
        <Suspense fallback={null}>
          <VaultReader deps={deps} onView={setView} />
        </Suspense>
      ) : null}
    </VaultContext>
  );
}

/** The landing's view of the vault; the recorded Decisions where no provider runs. */
export function useVault(): VaultView {
  return useContext(VaultContext) ?? RECORDED_VIEW;
}

/** The visitor's clock in unix seconds, ticking every `everyMs`; null on the server and in the first render. */
export function useNowSec(everyMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    tick();
    const timer = setInterval(tick, everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
