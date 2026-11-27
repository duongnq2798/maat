import type { RawLog } from "./decode";

/**
 * The one keyless endpoint the index reads. Free; no environment variable is read. It serves headers and logs from block
 * 51,000,000 only (2026-09-07); older blocks answer 403. Base made a block every 2 s until about block 53,556,000 (about
 * 2026-11-05) and every 0.2 s (5 per second, whole-second timestamps) after.
 */
export const GAP_RPC = "https://base-rpc.publicnode.com";
/**
 * The first block that endpoint serves (below it, it answers 403: older blocks need an archive node), and that block's
 * timestamp, 1788789347 (2026-09-07T13:55:47Z).
 */
export const GAP_RPC_FIRST_BLOCK = 51_000_000;
export const GAP_RPC_FIRST_BLOCK_TS = 1_788_789_347;
/** The most blocks one eth_getLogs call may cover on that endpoint. */
export const SPAN = 50_000;
const MAX_ADDRESSES = 10;
/**
 * The RPCs the finalized block is asked of, each FINALIZED_READS times at once: some of the servers behind each answer
 * an older finalized block than others. Only the finalized block is read from mainnet.base.org, which caps eth_getLogs
 * at a 200-block range (lib/chain/scan.ts): logs and every other read go to GAP_RPC.
 */
export const FINALIZED_RPCS: readonly string[] = [GAP_RPC, "https://mainnet.base.org"];
export const FINALIZED_READS = 3;

export class RpcRefused extends Error {
  constructor(
    method: string,
    readonly reason: string,
  ) {
    super(`${method} refused: ${reason}`);
    this.name = "RpcRefused";
  }
}

/** A block and its timestamp. */
export interface Head {
  block: number;
  ts: number;
}
/** A finalized block, and, from a reader that asks several times, the RPC that answered it and how many reads answered at all. */
export interface FinalizedHead extends Head {
  rpc?: string;
  answers?: number;
  reads?: number;
}

export interface LogQuery {
  address: string | readonly string[];
  topic0: string;
  from: number;
  to: number;
}

/** What the index reads of a transaction: who sent it, to what, with which calldata, all lowercase. */
export interface TxRead {
  from: string;
  to: string | null;
  input: string;
}

export interface LogReader {
  getLogs(q: LogQuery): Promise<RawLog[]>;
  blockTs(n: number): Promise<number>;
  blockAt(ts: number): Promise<number>;
  head(): Promise<{ block: number; ts: number }>;
  /**
   * The latest block Base has finalized: no reorg can change a window read through it. createLogReader returns the
   * newest of several answers, since a finalized block is as final as any older one.
   */
  finalized(): Promise<FinalizedHead>;
  transaction(hash: string): Promise<TxRead>;
  call(to: string, data: string): Promise<string>;
}

export interface LogReaderOptions {
  url?: string;
  /** Where finalized() asks: FINALIZED_RPCS, or only `url` when one is given. */
  finalizedRpcs?: readonly string[];
  /** How many times finalized() asks each of them at once: FINALIZED_READS. */
  finalizedReads?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxSpan?: number;
  minSpan?: number;
  timeoutMs?: number;
}

const hex = (n: number) => `0x${n.toString(16)}`;
const position = (l: RawLog) => [Number(BigInt(l.blockNumber)), Number(BigInt(l.logIndex))] as const;
const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const HEX = /^0x[0-9a-f]+$/i;

/** A block's number and timestamp from an eth_getBlockByNumber answer, or RpcRefused when the answer is not a block. */
function blockOf(b: unknown): Head {
  const o = (typeof b === "object" && b !== null ? b : {}) as { number?: unknown; timestamp?: unknown };
  const n = typeof o.number === "string" && HEX.test(o.number) ? Number(BigInt(o.number)) : NaN;
  const ts = typeof o.timestamp === "string" && HEX.test(o.timestamp) ? Number(BigInt(o.timestamp)) : NaN;
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(ts)) throw new RpcRefused("eth_getBlockByNumber", "no finalized block");
  return { block: n, ts };
}

export function createLogReader(opts: LogReaderOptions = {}): LogReader {
  const url = opts.url ?? GAP_RPC;
  const finalizedRpcs = opts.finalizedRpcs ?? (opts.url === undefined ? FINALIZED_RPCS : [opts.url]);
  const finalizedReads = opts.finalizedReads ?? FINALIZED_READS;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxSpan = opts.maxSpan ?? SPAN;
  const minSpan = opts.minSpan ?? 1_000;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let id = 0;

  /** Every read but the finalized block's goes to `url`. */
  const rpc = (method: string, params: unknown[]) => rpcAt(url, method, params);

  async function rpcAt(target: string, method: string, params: unknown[]): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(target, {
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
    // Every RPC is asked finalizedReads times at once, each read once: the newest block answered wins, and a read that
    // fails or answers no block is only not counted. When no read answers, as in a short network drop, all are asked
    // again after 1 s and then 2 s, as the other single reads retry. It throws only when no read of the three tries answers.
    async finalized() {
      const asks = finalizedRpcs.flatMap((u) => Array.from({ length: finalizedReads }, () => u));
      for (let attempt = 1; ; attempt++) {
        const settled = await Promise.allSettled(asks.map(async (u) => ({ rpc: u, ...blockOf(await rpcAt(u, "eth_getBlockByNumber", ["finalized", false])) })));
        const answered = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
        const newest = answered.reduce<(typeof answered)[number] | undefined>((best, a) => (best && best.block >= a.block ? best : a), undefined);
        if (newest) return { block: newest.block, ts: newest.ts, rpc: newest.rpc, answers: answered.length, reads: asks.length };
        if (attempt >= 3) {
          const first = settled.find((s) => s.status === "rejected")?.reason;
          const why = first instanceof RpcRefused ? first.reason : reasonOf(first);
          throw new RpcRefused("eth_getBlockByNumber", `no finalized block in ${attempt} tries of ${asks.length} reads of ${finalizedRpcs.join(" and ")}: ${why}`);
        }
        await sleep(1000 * attempt);
      }
    },
    async transaction(hash) {
      const t = (await retried(() => rpc("eth_getTransactionByHash", [hash]))) as { from?: string; to?: string | null; input?: string } | null;
      if (!t || typeof t.from !== "string" || typeof t.input !== "string") throw new RpcRefused("eth_getTransactionByHash", `no transaction ${hash}`);
      return { from: t.from.toLowerCase(), to: typeof t.to === "string" ? t.to.toLowerCase() : null, input: t.input.toLowerCase() };
    },
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
