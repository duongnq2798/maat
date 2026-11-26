import fs from "node:fs";
import path from "node:path";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC, byPosition, decodeAnswerUpdated, decodeSwap, type FeedUpdate, type Swap } from "./decode";
import { SPAN, type LogReader } from "./rpc";

/** A span this close to the head may still reorg, so it is read again next time instead of cached. */
export const SETTLED = 1_000;

/** One aligned span the source read for one kind and address list: where its rows came from, and if its file holds it. */
export interface SpanRead {
  /** Its cache file's name, `${kind}-${addresses}-${spanFrom}-${spanTo}.json`, also when the span is not cached. */
  name: string;
  spanFrom: number;
  spanTo: number;
  /** "cache": read from its file; "rpc": read with one eth_getLogs call. */
  from: "cache" | "rpc";
  /** Its file in the cache now holds it: the span is SETTLED blocks below the head, and the file was read or written. */
  kept: boolean;
  /** Set only when the span was settled, read from Base, and its file could not be written: the write's error. */
  writeError?: string;
}

const toHex = (n: bigint) => (n < 0n ? `-0x${(-n).toString(16)}` : `0x${n.toString(16)}`);
const fromHex = (s: string) => (s.startsWith("-") ? -BigInt(s.slice(1)) : BigInt(s));

interface Row {
  block: number;
  logIndex: number;
  ts: number;
  tx: string;
  /** sqrtPriceX96 for a swap, the answer for a feed update, as a 0x hex string. */
  v: string;
  address?: string;
}
const HEXISH = /^-?0x[0-9a-f]+$/;
const isRow = (r: unknown, withAddress: boolean): r is Row => {
  if (typeof r !== "object" || r === null) return false;
  const o = r as Record<string, unknown>;
  return (
    Number.isSafeInteger(o.block) &&
    Number.isSafeInteger(o.logIndex) &&
    Number.isSafeInteger(o.ts) &&
    typeof o.tx === "string" &&
    typeof o.v === "string" &&
    HEXISH.test(o.v) &&
    (!withAddress || typeof o.address === "string")
  );
};

function readCache(file: string, withAddress: boolean): Row[] | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) && parsed.every((r) => isRow(r, withAddress)) ? (parsed as Row[]) : null;
  } catch {
    return null;
  }
}

function writeCache(file: string, rows: Row[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(rows));
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

export function createLogSource(reader: LogReader, opts: { cacheDir: string | null; headBlock: number; onSpan?: (s: SpanRead) => void }) {
  async function rows(kind: "swap" | "answer", addresses: readonly string[], topic0: string, from: number, to: number): Promise<Row[]> {
    const out: Row[] = [];
    const withAddress = kind === "answer";
    const lower = addresses.map((a) => a.toLowerCase());
    for (let k = Math.floor(from / SPAN); k * SPAN <= Math.min(to, opts.headBlock); k++) {
      const spanFrom = k * SPAN;
      const spanTo = Math.min(spanFrom + SPAN - 1, opts.headBlock);
      const cacheable = opts.cacheDir !== null && spanTo <= opts.headBlock - SETTLED;
      const name = `${kind}-${lower.join("_")}-${spanFrom}-${spanTo}.json`;
      const file = cacheable ? path.join(opts.cacheDir!, name) : null;
      let span = file ? readCache(file, withAddress) : null;
      const cached = span !== null;
      let kept = cached;
      let writeError: string | undefined;
      if (span === null) {
        const logs = await reader.getLogs({ address: addresses.length === 1 ? addresses[0]! : addresses, topic0, from: spanFrom, to: spanTo });
        span = (kind === "swap" ? logs.map(decodeSwap).sort(byPosition).map((s) => ({ block: s.block, logIndex: s.logIndex, ts: s.ts, tx: s.tx, v: toHex(s.sqrtPriceX96) }))
          : logs.map(decodeAnswerUpdated).sort(byPosition).map((u) => ({ block: u.block, logIndex: u.logIndex, ts: u.ts, tx: u.tx, v: toHex(u.answer), address: u.address })));
        if (file) {
          try {
            writeCache(file, span);
            kept = true;
          } catch (e) {
            // The cache only saves time: a failed write must not discard rows already read.
            writeError = e instanceof Error ? e.message : String(e);
            console.warn(`gap cache: could not write ${file}: ${writeError}`);
          }
        }
      }
      opts.onSpan?.({ name, spanFrom, spanTo, from: cached ? "cache" : "rpc", kept, ...(writeError === undefined ? {} : { writeError }) });
      for (const r of span) if (r.block >= from && r.block <= to) out.push(r);
    }
    return out;
  }

  return {
    async swaps(pool: string, from: number, to: number): Promise<Swap[]> {
      const r = await rows("swap", [pool], SWAP_TOPIC, from, to);
      return r.map((x) => ({ block: x.block, logIndex: x.logIndex, ts: x.ts, tx: x.tx, sqrtPriceX96: fromHex(x.v) }));
    },
    async updates(aggregators: readonly string[], from: number, to: number): Promise<FeedUpdate[]> {
      const r = await rows("answer", aggregators, ANSWER_UPDATED_TOPIC, from, to);
      return r.map((x) => ({ block: x.block, logIndex: x.logIndex, ts: x.ts, tx: x.tx, answer: fromHex(x.v), address: x.address! }));
    },
  };
}

export type LogSource = ReturnType<typeof createLogSource>;
