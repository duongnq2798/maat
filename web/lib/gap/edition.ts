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
  // Live feeds with no update after the window: every token is measured first, then one error names them all.
  const waiting: string[] = [];
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
      // Every phase's aggregator is read in one call; which one a row records is decided below, from the logs it uses.
      const updatesIn = async (from: number, to: number): Promise<FeedUpdate[]> => {
        calls++;
        return (await source.updates(aggregators, from, to)).sort(byPosition);
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

      // The aggregator and phase a row records are those of the logs it used: the update before, the updates inside and
      // the update after. A range that mixes two aggregators is not handled.
      const used = [...new Set(updates.map((u) => u.address.toLowerCase()))];
      if (used.length > 1) throw new Error(`${nav.symbol} ${w.id}: phase changed inside a measured range (${used.join(", ")})`);
      // Only a token whose ranges hold no update at all falls back to the latest phase, so only that row depends on the
      // time the aggregators were read.
      const aggregator = used[0] ?? aggregators.at(-1)!;
      const phase = aggregators.indexOf(aggregator) + 1;
      if (phase === 0) throw new Error(`${nav.symbol} ${w.id}: ${aggregator} is not one of the proxy's phase aggregators`);

      const live = feedLiveIn(updates, w);
      if (live && !after) {
        waiting.push(`${nav.symbol} ${w.id}`);
        continue;
      }

      const freeze = live ? findFreeze(updates, w) : null;
      const swapsRead = freeze
        ? { from: Math.min(fromBlock, freeze.from.block), to: Math.max(toBlock, freeze.to.block) }
        : { from: fromBlock, to: toBlock };
      calls++;
      const swaps = await source.swaps(nav.pool, swapsRead.from, swapsRead.to);

      const figures = measureToken({ window: span, updates, swaps });
      tokens.push(toTokenRow(nav, { aggregator, phase }, figures, freeze ? swapsRead : null));
      log(`${nav.symbol} ${w.id}: ${calls} reads, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
    out.push({ status: "complete", ...base, blocks: { from: fromBlock, to: toBlock }, tokens });
  }

  if (waiting.length) throw new Error(`${waiting.join(", ")}: the feed has not updated since the window; run again later`);

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
