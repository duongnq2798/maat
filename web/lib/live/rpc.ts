import type { Hex } from "@/content/b20-nav";

/**
 * Keyless Base RPCs the browser calls, in order: the same list as the W2 ledger. base-rpc.publicnode.com answers with
 * CORS open; mainnet.base.org rate-limits hard, so it is the fallback. No environment variable is read here: nothing
 * private can reach the browser bundle.
 */
export const LIVE_RPCS: readonly string[] = ["https://base-rpc.publicnode.com", "https://mainnet.base.org"];

export interface LiveReader {
  call(tx: { to: Hex; data: Hex }, block: "latest" | bigint): Promise<{ data: Hex; endpoint: string }>;
}

export class RpcError extends Error {
  constructor(readonly failures: readonly { endpoint: string; message: string }[]) {
    super(failures.map((f) => `${f.endpoint}: ${f.message}`).join("; "));
    this.name = "RpcError";
  }
}

const HEX = /^0x[0-9a-fA-F]*$/;

export function createReader(opts: { urls?: readonly string[]; fetch?: typeof fetch; timeoutMs?: number } = {}): LiveReader {
  const urls = opts.urls ?? LIVE_RPCS;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const timeoutMs = opts.timeoutMs ?? 8000;
  let id = 0;
  return {
    async call(tx, block) {
      const tag = block === "latest" ? "latest" : `0x${block.toString(16)}`;
      const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "eth_call", params: [{ to: tx.to, data: tx.data }, tag] });
      const failures: { endpoint: string; message: string }[] = [];
      for (const endpoint of urls) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const res = await doFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ctl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
          if (json.error) throw new Error(json.error.message ?? "JSON-RPC error");
          if (typeof json.result !== "string" || !HEX.test(json.result)) throw new Error("the result is not hex");
          if (json.result === "0x") throw new Error("the call returned no data");
          return { data: json.result as Hex, endpoint };
        } catch (e) {
          failures.push({ endpoint, message: ctl.signal.aborted ? `no answer in ${timeoutMs / 1000} s` : e instanceof Error ? e.message : String(e) });
        } finally {
          clearTimeout(timer);
        }
      }
      throw new RpcError(failures);
    },
  };
}
