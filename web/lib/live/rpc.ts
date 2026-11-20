import type { Hex } from "@/content/b20-nav";

/**
 * Keyless Base RPCs the browser calls, in order: the same list as the W2 ledger. base-rpc.publicnode.com answers with
 * CORS open; mainnet.base.org rate-limits hard, so it is the fallback. No environment variable is read here: nothing
 * private can reach the browser bundle.
 */
export const LIVE_RPCS: readonly string[] = ["https://base-rpc.publicnode.com", "https://mainnet.base.org"];

export interface CallOptions {
  /**
   * Throws when an answer cannot be used, such as a multicall body cut short: that endpoint then counts as failed and
   * the next one is tried, as for an endpoint that did not answer.
   */
  validate?: (data: Hex) => void;
  /** The endpoint to try first, such as the one that answered the multicall this call goes with; the rest follow in order. */
  first?: string;
}

export interface LiveReader {
  call(tx: { to: Hex; data: Hex }, block: "latest" | bigint, opts?: CallOptions): Promise<{ data: Hex; endpoint: string }>;
}

export interface RpcFailure {
  endpoint: string;
  message: string;
  /** The endpoint answered, but with data the page cannot use: not hex, empty, or it did not decode. */
  badAnswer?: true;
}

/** An answer that came back but cannot be used. */
class BadAnswer extends Error {}

export class RpcError extends Error {
  constructor(readonly failures: readonly RpcFailure[]) {
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
    async call(tx, block, { validate, first } = {}) {
      const tag = block === "latest" ? "latest" : `0x${block.toString(16)}`;
      const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "eth_call", params: [{ to: tx.to, data: tx.data }, tag] });
      const failures: RpcFailure[] = [];
      const order = first !== undefined && urls.includes(first) ? [first, ...urls.filter((u) => u !== first)] : urls;
      for (const endpoint of order) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const res = await doFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ctl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
          if (json.error) throw new Error(json.error.message ?? "JSON-RPC error");
          if (typeof json.result !== "string" || !HEX.test(json.result)) throw new BadAnswer("the result is not hex");
          if (json.result === "0x") throw new BadAnswer("the call returned no data");
          const data = json.result as Hex;
          try {
            validate?.(data);
          } catch (e) {
            throw new BadAnswer(`the answer did not decode: ${e instanceof Error ? e.message : String(e)}`);
          }
          return { data, endpoint };
        } catch (e) {
          if (ctl.signal.aborted) failures.push({ endpoint, message: `no answer in ${timeoutMs / 1000} s` });
          else if (e instanceof BadAnswer) failures.push({ endpoint, message: e.message, badAnswer: true });
          else failures.push({ endpoint, message: e instanceof Error ? e.message : String(e) });
        } finally {
          clearTimeout(timer);
        }
      }
      throw new RpcError(failures);
    },
  };
}
