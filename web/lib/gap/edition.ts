import { NAV_TOKENS, type NavToken } from "@/content/b20-nav";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { encodeCall } from "@/lib/live/abi";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC, byPosition, type FeedUpdate } from "./decode";
import type { LogSource } from "./logs";
import { feedLiveIn, findFreeze, LOOKBACK_SEC, measureToken } from "./measure";
import { GAP_RPC, SPAN, type LogReader } from "./rpc";
import { toTokenRow, type EditionFile, type TokenRow } from "./schema";

export type LogSourceFactory = (headBlock: number) => LogSource;

const PHASE_ID = "0x58303b10";
const PHASE_AGGREGATORS = "0xc1597304";

export interface EditionDeps {
  reader: LogReader;
  source: LogSourceFactory;
  log: (line: string) => void;
}
export interface EditionOptions {
  edition: number;
  windows?: string[];
  tokens?: string[];
}

/** Every phase's aggregator, phase 1 first; the current one is last. */
async function readAggregators(reader: LogReader, nav: NavToken): Promise<string[]> {
  const phases = Number(BigInt(await reader.call(nav.feed, PHASE_ID)));
  if (!Number.isSafeInteger(phases) || phases < 1) throw new Error(`${nav.symbol}: phaseId() returned ${phases}`);
  const aggregators: string[] = [];
  for (let p = 1; p <= phases; p++) {
    const r = await reader.call(nav.feed, encodeCall(PHASE_AGGREGATORS, BigInt(p)));
    aggregators.push(`0x${r.slice(-40)}`.toLowerCase());
  }
  return aggregators;
}

export async function measureEdition(deps: EditionDeps, opts: EditionOptions): Promise<EditionFile> {
  const def = EDITIONS.find((e) => e.edition === opts.edition);
  if (!def) throw new Error(`unknown edition ${opts.edition}`);
  const all = editionWindows(def);
  for (const id of opts.windows ?? []) if (!all.some((w) => w.id === id)) throw new Error(`edition ${def.edition} has no window ${id}`);
  for (const sym of opts.tokens ?? []) if (!NAV_TOKENS.some((t) => t.symbol === sym)) throw new Error(`unknown token ${sym}`);
  const windows = opts.windows ? all.filter((w) => opts.windows!.includes(w.id)) : all;
  const navs = opts.tokens ? NAV_TOKENS.filter((t) => opts.tokens!.includes(t.symbol)) : NAV_TOKENS;

  const { reader, log } = deps;
  const head = await reader.head();
  const source = deps.source(head.block);
  const aggregatorsOf = new Map<string, string[]>();

  const out: EditionFile["windows"] = [];
  for (const w of windows) {
    const base = { id: w.id, closeTs: w.closeTs, openTs: w.openTs, closeLabel: w.closeLabel, openLabel: w.openLabel };
    if (w.openTs > head.ts) {
      log(`window ${w.id}: pending, it opens after the head`);
      out.push({ status: "pending", ...base });
      continue;
    }
    const fromBlock = await reader.blockAt(w.closeTs);
    const toBlock = (await reader.blockAt(w.openTs)) - 1;
    const ahead = w.openTs + LOOKBACK_SEC > head.ts ? head.block : await reader.blockAt(w.openTs + LOOKBACK_SEC);
    const span = { closeTs: w.closeTs, openTs: w.openTs, fromBlock, toBlock };

    const tokens: TokenRow[] = [];
    for (const nav of navs) {
      const started = Date.now();
      let calls = 0;
      let aggregators = aggregatorsOf.get(nav.symbol);
      if (!aggregators) {
        aggregators = await readAggregators(reader, nav);
        calls += 1 + aggregators.length;
        aggregatorsOf.set(nav.symbol, aggregators);
      }
      const current = aggregators.at(-1)!;
      const updatesIn = async (from: number, to: number): Promise<FeedUpdate[]> => {
        calls++;
        const rows = await source.updates(aggregators, from, to);
        for (const u of rows) {
          if (u.address.toLowerCase() !== current) throw new Error(`${nav.symbol}: phase changed inside a measured range (block ${u.block}, ${u.address})`);
        }
        return rows.sort(byPosition);
      };

      const inside = await updatesIn(fromBlock, toBlock);
      // Backwards span by span: stop at the first span that holds an update (the last one wins), or once a span starts
      // more than the look-back before the close, so no header far below the data is read.
      let before: FeedUpdate | undefined;
      for (let hi = fromBlock - 1; hi >= 0 && !before; hi -= SPAN) {
        const lo = Math.max(0, hi - SPAN + 1);
        before = (await updatesIn(lo, hi)).at(-1);
        if (!before) {
          calls++;
          if ((await reader.blockTs(lo)) < w.closeTs - LOOKBACK_SEC) break;
        }
      }
      let after: FeedUpdate | undefined;
      for (let lo = toBlock + 1; lo <= ahead && !after; lo += SPAN) {
        after = (await updatesIn(lo, Math.min(ahead, lo + SPAN - 1)))[0];
      }

      const updates = [...(before ? [before] : []), ...inside, ...(after ? [after] : [])];
      const live = feedLiveIn(updates, w);
      if (live && !after) throw new Error(`${nav.symbol}: the feed has not updated since the window; run again later`);

      const freeze = live ? findFreeze(updates, w) : null;
      const swapsRead = freeze
        ? { from: Math.min(fromBlock, freeze.from.block), to: Math.max(toBlock, freeze.to.block) }
        : { from: fromBlock, to: toBlock };
      calls++;
      const swaps = await source.swaps(nav.pool, swapsRead.from, swapsRead.to);

      const figures = measureToken({ window: span, updates, swaps });
      tokens.push(toTokenRow(nav, { aggregator: current, phase: aggregators.length }, figures, freeze ? swapsRead : null));
      log(`${nav.symbol} ${w.id}: ${calls} reads, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    out.push({ status: "complete", ...base, blocks: { from: fromBlock, to: toBlock }, tokens });
  }

  return {
    edition: def.edition,
    title: def.title,
    from: def.from,
    to: def.to,
    rpc: GAP_RPC,
    topics: { answerUpdated: ANSWER_UPDATED_TOPIC, swap: SWAP_TOPIC },
    head,
    windows: out,
  };
}
