import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";
import type { LedgerClient } from "./load";

/**
 * Keyless Base RPCs the browser can call, in order. base-rpc.publicnode.com answers eth_getLogs over 50,000 blocks
 * with CORS open to any origin; mainnet.base.org caps eth_getLogs at 200 blocks and rate-limits hard, so it is the
 * fallback (both measured 2026-11-20).
 */
export const DEFAULT_RPCS = ["https://base-rpc.publicnode.com", "https://mainnet.base.org"] as const;

/**
 * The RPCs the ledger page tries: NEXT_PUBLIC_BASE_RPC_URL first when it is an https URL, then the defaults. The
 * variable is read literally so Next.js inlines it at build time; anything set there ships to every visitor.
 */
export function rpcUrls(env: { NEXT_PUBLIC_BASE_RPC_URL?: string } = { NEXT_PUBLIC_BASE_RPC_URL: process.env.NEXT_PUBLIC_BASE_RPC_URL }): string[] {
  const custom = env.NEXT_PUBLIC_BASE_RPC_URL?.trim() ?? "";
  const first = isHttps(custom) ? [custom] : [];
  return [...new Set([...first, ...DEFAULT_RPCS])];
}

function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** A read-only Base client over `urls`, falling back in order and batching JSON-RPC calls. */
export function createLedgerClient(urls: readonly string[] = rpcUrls()): LedgerClient {
  return createPublicClient({
    chain: base,
    transport: fallback(urls.map((u) => http(u, { batch: { batchSize: 50 }, retryCount: 1 }))),
  }) as unknown as LedgerClient;
}
