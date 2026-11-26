import { createPublicClient, fallback, http, type Transport } from "viem";
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

/**
 * RPCs whose eth_getLogs limit is far below the smallest chunk the ledger scans (`MIN_SPAN` in load.ts). They still
 * serve every other read; for logs they are skipped, so a failed chunk reports the error of the RPC that could have
 * served it (a rate limit stays a rate limit) instead of their range limit, which would split the chunk.
 */
const NO_LOG_SCAN: ReadonlySet<string> = new Set(["https://mainnet.base.org"]);

/** True unless `url` is one of the RPCs the ledger never asks for logs (NO_LOG_SCAN). */
export const scansLogs = (url: string): boolean => !NO_LOG_SCAN.has(url);

/**
 * One RPC, with each eth_getLogs in an HTTP request of its own and every other call batched. base-rpc.publicnode.com
 * serves the eth_getLogs of one batch one after another (measured 2026-11-25: 8 windows of 50,000 blocks in one request
 * took 927 to 2,019 ms, 32 requests of one window each, sent at once, 567 to 960 ms), while the other reads are cheap
 * and batch well.
 */
function logsApart(url: string, methods?: { exclude: string[] }): Transport {
  const batched = http(url, { batch: { batchSize: 50 }, methods });
  const single = http(url, { methods });
  return (config) => {
    const transport = batched(config);
    const alone = single(config);
    return { ...transport, request: ((args, options) => (args.method === "eth_getLogs" ? alone : transport).request(args, options)) as typeof transport.request };
  };
}

/**
 * A read-only Base client over `urls`, falling back in order, with each eth_getLogs sent on its own and the other
 * JSON-RPC calls batched. A call that fails on every RPC is retried once, with viem's backoff; the scan retries a failed
 * chunk once more on its own.
 */
export function createLedgerClient(urls: readonly string[] = rpcUrls()): LedgerClient {
  return createPublicClient({
    chain: base,
    transport: fallback(
      urls.map((u) => logsApart(u, !scansLogs(u) ? { exclude: ["eth_getLogs"] } : undefined)),
      { retryCount: 1 },
    ),
  }) as unknown as LedgerClient;
}
