import type { RawLog } from "./decode";

/** The one keyless endpoint the index reads. Free; about 5 blocks per second on Base; no environment variable is read. */
export const GAP_RPC = "https://base-rpc.publicnode.com";
/** The most blocks one eth_getLogs call may cover on that endpoint. */
export const SPAN = 50_000;
const MAX_ADDRESSES = 10;

export class RpcRefused extends Error {
  constructor(method: string, reason: string) {
    super(`${method} refused: ${reason}`);
    this.name = "RpcRefused";
  }
}

export interface LogQuery {
  address: string | readonly string[];
  topic0: string;
  from: number;
  to: number;
}

export interface LogReader {
  getLogs(q: LogQuery): Promise<RawLog[]>;
  blockTs(n: number): Promise<number>;
  blockAt(ts: number): Promise<number>;
  head(): Promise<{ block: number; ts: number }>;
  call(to: string, data: string): Promise<string>;
}

export interface LogReaderOptions {
  url?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxSpan?: number;
  minSpan?: number;
  timeoutMs?: number;
}

const hex = (n: number) => `0x${n.toString(16)}`;
const position = (l: RawLog) => [Number(BigInt(l.blockNumber)), Number(BigInt(l.logIndex))] as const;
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createLogReader(opts: LogReaderOptions = {}): LogReader {
  const url = opts.url ?? GAP_RPC;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxSpan = opts.maxSpan ?? SPAN;
  const minSpan = opts.minSpan ?? 1_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let id = 0;

  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new RpcRefused(method, timedOut ? `no answer in ${timeoutMs} ms` : reasonOf(e));
    }
    if (!res.ok) throw new RpcRefused(method, `HTTP ${res.status}`);
    let json: { result?: unknown; error?: { message?: string } };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new RpcRefused(method, "the body is not JSON");
    }
    if (json.error) throw new RpcRefused(method, json.error.message ?? "JSON-RPC error");
    return json.result;
  }

  async function logsOnce(address: string | readonly string[], topic0: string, from: number, to: number): Promise<RawLog[]> {
    const result = await rpc("eth_getLogs", [{ address, topics: [topic0], fromBlock: hex(from), toBlock: hex(to) }]);
    if (!Array.isArray(result)) throw new RpcRefused("eth_getLogs", "the result is not a list");
    return result as RawLog[];
  }

  async function span(address: string | readonly string[], topic0: string, from: number, to: number): Promise<RawLog[]> {
    let reason = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await logsOnce(address, topic0, from, to);
      } catch (e) {
        reason = reasonOf(e);
        if (attempt < 3) await sleep(1000 * attempt);
      }
    }
    const len = to - from + 1;
    if (len <= minSpan) throw new Error(`eth_getLogs refused blocks ${from}-${to}: ${reason}`);
    const mid = from + Math.floor(len / 2);
    return [...(await span(address, topic0, from, mid - 1)), ...(await span(address, topic0, mid, to))];
  }

  async function blockTs(n: number): Promise<number> {
    const b = (await rpc("eth_getBlockByNumber", [hex(n), false])) as { timestamp?: string } | null;
    if (!b || typeof b.timestamp !== "string") throw new RpcRefused("eth_getBlockByNumber", `no block ${n}`);
    return Number(BigInt(b.timestamp));
  }

  async function head(): Promise<{ block: number; ts: number }> {
    const n = await rpc("eth_blockNumber", []);
    if (typeof n !== "string") throw new RpcRefused("eth_blockNumber", "the result is not hex");
    const block = Number(BigInt(n));
    return { block, ts: await blockTs(block) };
  }

  return {
    async getLogs({ address, topic0, from, to }) {
      const count = typeof address === "string" ? 1 : address.length;
      if (count > MAX_ADDRESSES) throw new Error(`eth_getLogs takes at most ${MAX_ADDRESSES} addresses, got ${count}`);
      const out: RawLog[] = [];
      for (let a = from; a <= to; a += maxSpan) out.push(...(await span(address, topic0, a, Math.min(a + maxSpan - 1, to))));
      return out.sort((x, y) => {
        const [bx, ix] = position(x);
        const [by, iy] = position(y);
        return bx - by || ix - iy;
      });
    },
    blockTs,
    head,
    async blockAt(ts) {
      const h = await head();
      if (ts > h.ts) throw new Error(`timestamp ${ts} is after the head (block ${h.block}, ${h.ts})`);
      let lo = 0;
      let hi = h.block;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if ((await blockTs(mid)) >= ts) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    },
    async call(to, data) {
      const r = await rpc("eth_call", [{ to, data }, "latest"]);
      if (typeof r !== "string") throw new RpcRefused("eth_call", "the result is not hex");
      return r;
    },
  };
}
