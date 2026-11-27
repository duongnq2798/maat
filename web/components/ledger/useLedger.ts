"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isAddress, isHash, type Address, type Hash } from "viem";
import { z } from "zod";
import { browserStorage, memoryStorage } from "@/lib/chain/cache";
import type { TxInput } from "@/lib/chain/ledger";
import { FACTS } from "@/content/facts";
import {
  errorText,
  loadLedger,
  snapshotPreview,
  verifyVault,
  type LedgerClient,
  type LedgerSnapshot,
  type RecordedDetails,
  type SnapshotPreview,
} from "@/lib/chain/load";
import { staticRationaleSource, type RationaleSource } from "@/lib/chain/rationale";
import { createLedgerClient, rpcUrls } from "@/lib/chain/rpc";
import { fetchSnapshotJson } from "@/lib/chain/snapshot";

/** How often the page rereads Base while the tab is visible. */
export const REFRESH_MS = 60_000;

export type LedgerState =
  | {
      mode: "loading-config";
      /**
       * The committed snapshot's Decisions, shown at once while Base confirms the file and the tail scan runs; absent
       * until the file is fetched, and when it holds none.
       */
      preview?: SnapshotPreview;
    }
  | { mode: "waiting" }
  | { mode: "error"; message: string; vault?: Address }
  | {
      mode: "mainnet";
      snapshot: LedgerSnapshot;
      /** The RPCs the page asks, in order. */
      endpoints: readonly string[];
      /** True while a read is under way (the first scan, or a refresh). */
      loading: boolean;
      /** Why the last refresh failed; the snapshot is the previous one. */
      refreshError: string | null;
    };

export interface VaultConfig {
  vault: Address | null;
  deployTx: Hash | null;
}

export interface LedgerDeps {
  fetchDeployments?: () => Promise<VaultConfig>;
  client?: LedgerClient;
  endpoints?: readonly string[];
  rationaleSource?: RationaleSource;
  /** The committed snapshot the first read starts from (default: /data/decisions-snapshot.json); null scans every block. */
  fetchSnapshot?: () => Promise<unknown>;
  storage?: Storage | null;
  now?: () => number;
  refreshMs?: number;
}

/** The block time and gas of each Decision this build records, which the preview's rows take before Base is read. */
const RECORDED: RecordedDetails = {
  blockTimes: Object.fromEntries(FACTS.mainnetDecisions.value.map((l) => [l.blockNumber, l.blockTime])),
  gasUsed: Object.fromEntries(FACTS.mainnetDecisions.value.map((l) => [l.transactionHash.toLowerCase(), l.gasUsed])),
};

const deploymentsSchema = z.object({
  vault: z.string().refine((v) => isAddress(v, { strict: false })).nullable(),
  deployTx: z.string().refine((v) => isHash(v)).nullable(),
});

/** The vault the build recorded, from /data/deployments.json (fetched at runtime so a test can serve its own). */
export async function fetchDeploymentsJson(): Promise<VaultConfig> {
  let body: unknown;
  try {
    const res = await fetch("/data/deployments.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new Error(`Could not read /data/deployments.json: ${errorText(e)}`);
  }
  const parsed = deploymentsSchema.safeParse(body);
  if (!parsed.success) throw new Error("/data/deployments.json does not have the shape this page reads.");
  return parsed.data as VaultConfig;
}

/**
 * The ledger page's data: nothing on Base until the deployments file names a vault, then the vault's treasury and
 * events, reread every `refreshMs` while the tab is visible.
 */
export function useLedger(deps: LedgerDeps = {}): LedgerState & { retry: () => void } {
  const depsRef = useRef(deps);
  const [state, setState] = useState<LedgerState>({ mode: "loading-config" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const d = depsRef.current;
    const controller = new AbortController();
    const { signal } = controller;
    let timer: ReturnType<typeof setInterval> | undefined;
    const storage = d.storage !== undefined ? d.storage : (browserStorage() ?? memoryStorage());

    const start = async () => {
      setState({ mode: "loading-config" });
      let config: VaultConfig;
      try {
        config = await (d.fetchDeployments ?? fetchDeploymentsJson)();
      } catch (e) {
        if (!signal.aborted) setState({ mode: "error", message: errorText(e) });
        return;
      }
      if (signal.aborted) return;
      const { vault, deployTx } = config;
      if (!vault) {
        setState({ mode: "waiting" });
        return;
      }

      const endpoints = d.endpoints ?? rpcUrls();
      const client = d.client ?? createLedgerClient(endpoints);
      const rationaleSource = d.rationaleSource ?? staticRationaleSource();
      // Fetched while the vault is checked; only the first read needs it, since later ones have the cache.
      const committed = (d.fetchSnapshot ?? fetchSnapshotJson)().catch(() => null);
      // Its Decisions show as soon as it arrives, labelled as confirming, until the first read of Base replaces them.
      void committed.then((raw) => {
        const preview = signal.aborted ? null : snapshotPreview(raw, vault, RECORDED);
        if (preview) setState((s) => (s.mode === "loading-config" ? { mode: "loading-config", preview } : s));
      });
      try {
        await verifyVault(client, vault);
      } catch (e) {
        if (!signal.aborted) setState({ mode: "error", message: errorText(e), vault });
        return;
      }

      let floor: bigint | undefined;
      // Decision transactions read so far: a refresh reads only the new ones.
      const txs = new Map<string, TxInput>();
      let inFlight = false;
      const read = async (first: boolean) => {
        inFlight = true;
        if (!first) setState((s) => (s.mode === "mainnet" ? { ...s, loading: true } : s));
        try {
          const snapshot = await loadLedger({
            client,
            vault,
            deployTx,
            rationaleSource,
            storage,
            floor,
            txs,
            snapshot: first ? committed : undefined,
            now: d.now,
            signal,
            onProgress: first ? (p) => !signal.aborted && setState({ mode: "mainnet", snapshot: p, endpoints, loading: true, refreshError: null }) : undefined,
          });
          floor = snapshot.scan.floor;
          if (!signal.aborted) setState({ mode: "mainnet", snapshot, endpoints, loading: false, refreshError: null });
        } catch (e) {
          if (signal.aborted) return;
          if (first) setState({ mode: "error", message: errorText(e), vault });
          else setState((s) => (s.mode === "mainnet" ? { ...s, loading: false, refreshError: errorText(e) } : s));
        } finally {
          inFlight = false;
        }
      };

      await read(true);
      if (signal.aborted) return;
      timer = setInterval(() => {
        if (!inFlight && document.visibilityState === "visible") void read(false);
      }, d.refreshMs ?? REFRESH_MS);
    };

    void start();
    return () => {
      controller.abort();
      if (timer !== undefined) clearInterval(timer);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
