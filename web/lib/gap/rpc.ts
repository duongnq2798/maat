import type { RawLog } from "./decode";

/**
 * The one keyless endpoint the index reads. Free; no environment variable is read. It serves headers and logs from block
 * 51,000,000 only (2026-09-07); older blocks answer 403. Base made a block every 2 s until about block 53,556,000 (about
 * 2026-11-05) and every 0.2 s (5 per second, whole-second timestamps) after.
 */
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
    if (typeof json !== "object" || json === null) throw new RpcRefused(method, "the body is not a JSON-RPC object");
    if (json.error) throw new RpcRefused(method, json.error.message ?? "JSON-RPC error");
    return json.result;
  }

  /** The single-shot reads get the same three tries as a span, so one transient refusal does not fail a whole run. */
  async function retried<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (attempt >= 3) throw e;
        await sleep(1000 * attempt);
      }
    }
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
    const b = (await retried(() => rpc("eth_getBlockByNumber", [hex(n), false]))) as { timestamp?: string } | null;
    if (!b || typeof b.timestamp !== "string") throw new RpcRefused("eth_getBlockByNumber", `no block ${n}`);
    return Number(BigInt(b.timestamp));
  }

  async function head(): Promise<{ block: number; ts: number }> {
    const n = await retried(() => rpc("eth_blockNumber", []));
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
      // The first block whose timestamp is at least `ts`. `hi` always has a read timestamp >= ts. `lo` is a block below
      // the answer: its timestamp was read (< ts), or null when the endpoint refused it (below its served range).
      let hi = { block: h.block, ts: h.ts };
      let lo: { block: number; ts: number | null } | null = null;
      let prevHi: { block: number; ts: number } | null = null;
      let width = Infinity;
      let bisectNext = false;
      const readTs = async (n: number): Promise<number | null> => {
        try {
          return await blockTs(n);
        } catch (e) {
          if (e instanceof RpcRefused) return null;
          throw e;
        }
      };
      while (true) {
        if (lo && hi.block === lo.block + 1) {
          if (lo.ts === null) throw new Error(`block ${lo.block} is below what the endpoint serves, so the first block at or after ${ts} cannot be verified`);
          return hi.block;
        }
        if (!lo && hi.block === 0) return 0;
        const floor = lo ? lo.block + 1 : 0;
        let probe: number;
        if (!prevHi && !lo) {
          probe = hi.block - 100_000; // a second point to measure the chain's own rate
        } else if (lo && lo.ts !== null && !bisectNext) {
          // between two read points: interpolate their timestamps
          probe = lo.block + Math.floor(((ts - lo.ts) / (hi.ts - lo.ts)) * (hi.block - lo.block));
        } else if (!lo && prevHi && prevHi.ts > hi.ts) {
          probe = hi.block - Math.ceil(((hi.ts - ts) * (prevHi.block - hi.block)) / (prevHi.ts - hi.ts)); // extrapolate the same rate
        } else {
          probe = Math.floor((floor + hi.block) / 2);
        }
        probe = Math.min(hi.block - 1, Math.max(floor, probe));
        const t = await readTs(probe);
        if (t === null) lo = { block: probe, ts: null };
        else if (t >= ts) {
          prevHi = hi;
          hi = { block: probe, ts: t };
        } else lo = { block: probe, ts: t };
        const nowWidth = lo ? hi.block - lo.block : Infinity;
        bisectNext = nowWidth > width / 2;
        width = nowWidth;
      }
    },
    async call(to, data) {
      const r = await retried(() => rpc("eth_call", [{ to, data }, "latest"]));
      if (typeof r !== "string") throw new RpcRefused("eth_call", "the result is not hex");
      return r;
    },
  };
}
