import { NAV_TOKENS, type NavToken } from "@/content/b20-nav";
import { EDITIONS, editionWindows, type EditionDef } from "@/content/gap-index/editions";
import { encodeCall } from "@/lib/live/abi";
import { DECISION_TOPIC, decisionCounts } from "./decisions";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC, byPosition, type FeedUpdate } from "./decode";
import { createLogSource, SETTLED, type LogSource, type SpanRead } from "./logs";
import { feedLiveIn, findFreeze, LOOKBACK_SEC, measureToken, type Freeze } from "./measure";
import { GAP_RPC, RpcRefused, SPAN, type FinalizedHead, type Head, type LogReader } from "./rpc";
import { toTokenRow, type EditionFile, type TokenRow } from "./schema";
import { readDecisions, readOwner } from "./vault";
import { calendarChecks, type ClosedWindow } from "./windows";

export type LogSourceFactory = (headBlock: number) => LogSource;

const PHASE_ID = "0x58303b10";
const PHASE_AGGREGATORS = "0xc1597304";
/** MarketCalendar.isOpen(uint256,uint8), asked with SessionMode.REGULAR = 0 (contracts/src/Types.sol). */
const IS_OPEN = "0x3fef6f98";
const REGULAR = 0n;

export interface EditionDeps {
  reader: LogReader;
  source: LogSourceFactory;
  log: (line: string) => void;
  /** MarketCalendar on Base: when given, every selected window's edges are checked against its isOpen before any is measured. */
  calendar?: string;
  /** MandateVault on Base, for an edition that counts the vault's Decisions in each window. */
  vault?: string;
  /** Where the edition number is looked up: EDITIONS, unless a test gives its own. */
  editions?: readonly EditionDef[];
  /** The clock and the pause of a --wait: Date.now and setTimeout, unless a test gives its own. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}
export interface EditionOptions {
  edition: number;
  windows?: string[];
  tokens?: string[];
  /**
   * Read through this block instead of the latest finalized one, as a rerun of a committed file does with the file's
   * head block. It must already be finalized.
   */
  head?: number;
  /** Refuse, before any log is read, unless every selected window ends at or before the head: nothing is written. */
  complete?: boolean;
  /**
   * With complete: for up to this many minutes, read the finalized block again every 30 s, reading no log, while a
   * window's open is after it, and after a measurement in which a live feed had no update after its window by it, until
   * a newer block is finalized; then refuse as complete does.
   */
  waitMinutes?: number;
}

const WAIT_STEP_MS = 30_000;

const utcIso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");

/** A finalized block for the log, with the RPC that answered it and how many reads did, when the reader says. */
const finalizedText = (f: FinalizedHead) =>
  `finalized block ${f.block} (${utcIso(f.ts)})${f.rpc === undefined ? "" : ` from ${f.rpc}, newest of ${f.answers} answers to ${f.reads} reads`}`;

/** The block a run reads through, and the finalized block it was checked against. */
interface HeadRead {
  head: Head;
  finalized: FinalizedHead;
}

/** The block the run reads through, the latest finalized one or a pinned block that is finalized already, and that finalized block. */
async function readHead(reader: LogReader, pinned: number | undefined): Promise<HeadRead> {
  const finalized = await reader.finalized();
  if (pinned === undefined) return { head: { block: finalized.block, ts: finalized.ts }, finalized };
  if (!Number.isSafeInteger(pinned) || pinned < 0) throw new Error(`--head ${pinned} is not a block number`);
  if (pinned > finalized.block) throw new Error(`block ${pinned} is not finalized yet: the latest finalized block is ${finalized.block}`);
  return { head: { block: pinned, ts: await reader.blockTs(pinned) }, finalized };
}

/** Says which RPC answered the run's head and how many reads answered, when the reader says. */
function logHead(log: (line: string) => void, { head, finalized }: HeadRead, pinned: boolean): void {
  if (finalized.rpc === undefined) return;
  log(pinned ? `head: block ${head.block} (${utcIso(head.ts)}), pinned with --head; ${finalizedText(finalized)}` : `head: ${finalizedText(finalized)}`);
}

/**
 * --complete --wait: rereads of the finalized block on a 30 s beat from the start of the wait, at most twice a minute
 * for its minutes, one line each, reading no log. A beat that passed while the run measured is skipped, and a reread
 * that no RPC answers keeps the head the run has, so a short network drop costs one beat, not the run.
 */
function createWait(deps: Pick<EditionDeps, "reader" | "log" | "now" | "sleep">, minutes: number, windows: readonly ClosedWindow[]) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const times = Math.round((minutes * 60_000) / WAIT_STEP_MS);
  const last = windows.reduce<ClosedWindow | undefined>((l, w) => (l && l.openTs >= w.openTs ? l : w), undefined);
  const lastOpen = last?.openTs ?? -Infinity;
  const open = last ? `the last open, ${last.openLabel} (${utcIso(last.openTs)})` : "";
  const fromOpen = (ts: number) => (ts < lastOpen ? `${lastOpen - ts} s before ${open}` : ts === lastOpen ? `at ${open}` : `${ts - lastOpen} s after ${open}`);
  const line = (k: number, text: string) => deps.log(`--wait ${minutes}, reread ${k} of ${times}: ${text}`);
  const start = now();
  let k = 0;

  /** Rereads on the next beat that has not passed: null once the minutes are up, and `read: null` when no RPC answered. */
  async function reread(read: HeadRead): Promise<{ k: number; read: HeadRead | null } | null> {
    k = Math.max(k + 1, Math.ceil((now() - start) / WAIT_STEP_MS));
    if (k > times) return null;
    await sleep(Math.max(0, start + k * WAIT_STEP_MS - now()));
    try {
      return { k, read: await readHead(deps.reader, undefined) };
    } catch (e) {
      if (!(e instanceof RpcRefused)) throw e;
      line(k, `no answer (${e.message}); still ${finalizedText(read.finalized)}; ${fromOpen(read.head.ts)}`);
      return { k, read: null };
    }
  }

  return {
    /** While the head is before the last open: the first head at or after it, or the last one read once the minutes are up. */
    async forOpen(read: HeadRead): Promise<HeadRead> {
      if (read.head.ts >= lastOpen) return read;
      deps.log(`--wait ${minutes}: ${finalizedText(read.finalized)}; ${fromOpen(read.head.ts)}; reading it again every 30 s, ${times} times at most`);
      while (read.head.ts < lastOpen) {
        const r = await reread(read);
        if (!r) break;
        if (!r.read) continue;
        read = r.read;
        line(r.k, `${finalizedText(read.finalized)}; ${fromOpen(read.head.ts)}${read.head.ts >= lastOpen ? ": measuring" : ""}`);
      }
      return read;
    },
    /**
     * After a measurement in which a live feed had no update after its window by the head: the first newer head, as
     * the same head would read the same logs, or null once the minutes are up.
     */
    async forNewer(read: HeadRead, waiting: readonly string[]): Promise<HeadRead | null> {
      deps.log(`--wait ${minutes}: ${waiting.join(", ")}: the feed has not updated by ${finalizedText(read.finalized)}; reading it again every 30 s until Base finalizes a newer block or the wait ends`);
      for (;;) {
        const r = await reread(read);
        if (!r) return null;
        if (!r.read) continue;
        const newer = r.read.head.block > read.head.block;
        line(r.k, `${finalizedText(r.read.finalized)}; ${fromOpen(r.read.head.ts)}${newer ? ": newer, measuring again" : ""}`);
        if (newer) return r.read;
      }
    },
  };
}

/** Asks MarketCalendar at each instant of calendarChecks, and throws at the first answer the window does not allow. */
async function checkCalendar(reader: LogReader, calendar: string, w: ClosedWindow, log: (line: string) => void): Promise<void> {
  const checks = calendarChecks(w);
  for (const c of checks) {
    const r = await reader.call(calendar, encodeCall(IS_OPEN, BigInt(c.ts), REGULAR));
    const v = /^0x[0-9a-fA-F]{64}$/.test(r) ? BigInt(r) : -1n;
    if (v !== 0n && v !== 1n) throw new Error(`window ${w.id}: MarketCalendar ${calendar} answered isOpen(${c.ts}) with ${r}, not a bool`);
    if ((v === 1n) !== c.open) {
      throw new Error(`window ${w.id}: MarketCalendar ${calendar} answers isOpen(${c.ts}) = ${v === 1n} where the window needs ${c.open}`);
    }
  }
  log(`window ${w.id}: MarketCalendar ${calendar} agrees at ${checks.length} instants`);
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

/** A token's aggregators, read once a run: `tally.calls` counts the reads when they are read. */
async function aggregatorsFor(reader: LogReader, nav: NavToken, known: Map<string, string[]>, tally: { calls: number }): Promise<string[]> {
  let aggregators = known.get(nav.symbol);
  if (!aggregators) {
    aggregators = await readAggregators(reader, nav);
    tally.calls += 1 + aggregators.length;
    known.set(nav.symbol, aggregators);
  }
  return aggregators;
}

/** The edition, and the windows and tokens a run takes from it: all of them, or those --window and --token name. */
function selectRun(editions: readonly EditionDef[] | undefined, opts: Pick<EditionOptions, "edition" | "windows" | "tokens">) {
  const def = (editions ?? EDITIONS).find((e) => e.edition === opts.edition);
  if (!def) throw new Error(`unknown edition ${opts.edition}`);
  const all = editionWindows(def);
  for (const id of opts.windows ?? []) if (!all.some((w) => w.id === id)) throw new Error(`edition ${def.edition} has no window ${id}`);
  for (const sym of opts.tokens ?? []) if (!NAV_TOKENS.some((t) => t.symbol === sym)) throw new Error(`unknown token ${sym}`);
  const windows = opts.windows ? all.filter((w) => opts.windows!.includes(w.id)) : all;
  const navs = opts.tokens ? NAV_TOKENS.filter((t) => opts.tokens!.includes(t.symbol)) : NAV_TOKENS;
  return { def, windows, navs };
}

/** The blocks a window's rows read: from the first block at or after its close, through `toBlock`, and after it up to `ahead`. */
interface WindowBlocks {
  fromBlock: number;
  toBlock: number;
  ahead: number;
}

/** An ended window's blocks: through the last block before its open, and up to the look-back after the open or the head. */
async function endedBlocks(reader: LogReader, w: ClosedWindow, head: { block: number; ts: number }): Promise<WindowBlocks> {
  const fromBlock = await reader.blockAt(w.closeTs);
  const toBlock = (await reader.blockAt(w.openTs)) - 1;
  const ahead = w.openTs + LOOKBACK_SEC > head.ts ? head.block : await reader.blockAt(w.openTs + LOOKBACK_SEC);
  return { fromBlock, toBlock, ahead };
}

/** The feed updates a token's row uses: the last one before the window, those inside it, and the first one after it. */
interface FeedReads {
  before?: FeedUpdate;
  inside: FeedUpdate[];
  after?: FeedUpdate;
}

/**
 * Reads a token's feed updates around one window through the log source. The measurement and the warm-up both read
 * through here, so the warm-up asks the log source for the spans the measurement asks for. `tally.calls` counts the reads.
 */
async function readFeed(
  reader: LogReader,
  source: LogSource,
  aggregators: readonly string[],
  w: ClosedWindow,
  b: WindowBlocks,
  tally: { calls: number },
): Promise<FeedReads> {
  // Every phase's aggregator is read in one call; which one a row records is decided by the measurement, from the logs it uses.
  const updatesIn = async (from: number, to: number): Promise<FeedUpdate[]> => {
    tally.calls++;
    return (await source.updates(aggregators, from, to)).sort(byPosition);
  };

  const inside = await updatesIn(b.fromBlock, b.toBlock);
  // Backwards span by span: stop at the first span that holds an update (the last one wins), or once a span starts
  // more than the look-back before the close, so no header far below the data is read.
  let before: FeedUpdate | undefined;
  for (let hi = b.fromBlock - 1; hi >= 0 && !before; hi -= SPAN) {
    const lo = Math.max(0, hi - SPAN + 1);
    before = (await updatesIn(lo, hi)).at(-1);
    if (!before) {
      tally.calls++;
      if ((await reader.blockTs(lo)) < w.closeTs - LOOKBACK_SEC) break;
    }
  }
  let after: FeedUpdate | undefined;
  for (let lo = b.toBlock + 1; lo <= b.ahead && !after; lo += SPAN) {
    after = (await updatesIn(lo, Math.min(b.ahead, lo + SPAN - 1)))[0];
  }
  return { before, inside, after };
}

/** The blocks of swaps a row reads: the window's, widened to the freeze when it starts before the window or ends after it. */
const swapsRange = (freeze: Freeze | null, b: WindowBlocks) =>
  freeze ? { from: Math.min(b.fromBlock, freeze.from.block), to: Math.max(b.toBlock, freeze.to.block) } : { from: b.fromBlock, to: b.toBlock };

export async function measureEdition(deps: EditionDeps, opts: EditionOptions): Promise<EditionFile> {
  const { def, windows, navs } = selectRun(deps.editions, opts);
  if (def.decisions && !deps.vault) throw new Error(`edition ${def.edition} counts the vault's Decisions: it needs the MandateVault address`);

  const { reader, log } = deps;
  // A window is measured only once its open is at or before a finalized block, so no reorg can change its figures.
  let read = await readHead(reader, opts.head);
  if (deps.calendar) for (const w of windows) await checkCalendar(reader, deps.calendar, w, log);
  const wait = opts.complete && opts.waitMinutes ? createWait(deps, opts.waitMinutes, windows) : null;
  if (wait) read = await wait.forOpen(read);
  const aggregatorsOf = new Map<string, string[]>();

  /** Every window through the head: the windows of the file, and the live feeds with no update after their window by it. */
  async function measureThrough(head: Head): Promise<{ out: EditionFile["windows"]; waiting: string[] }> {
    const source = deps.source(head.block);
    const owner = def.decisions && windows.some((w) => w.openTs <= head.ts) ? await readOwner(reader, deps.vault!) : null;

    const out: EditionFile["windows"] = [];
    // Live feeds with no update after the window: every token is measured first, then one error names them all.
    const waiting: string[] = [];
    for (const w of windows) {
      const base = { id: w.id, closeTs: w.closeTs, openTs: w.openTs, closeLabel: w.closeLabel, openLabel: w.openLabel };
      if (w.openTs > head.ts) {
        log(`window ${w.id}: pending, it ends ${w.openLabel}, after block ${head.block} (${utcIso(head.ts)}), the block this run reads through`);
        out.push({ status: "pending", ...base });
        continue;
      }
      const blocks = await endedBlocks(reader, w, head);
      const { fromBlock, toBlock } = blocks;
      let decisions: Extract<EditionFile["windows"][number], { status: "complete" }>["decisions"];
      if (owner !== null) {
        const list = await readDecisions(reader, { vault: deps.vault!, owner, from: fromBlock, to: toBlock });
        decisions = { vault: deps.vault!.toLowerCase(), topic: DECISION_TOPIC, ...decisionCounts(list), list };
        log(`window ${w.id}: ${decisions.count} Decisions, ${decisions.marketClosed} refused with MARKET_CLOSED`);
      }
      const span = { closeTs: w.closeTs, openTs: w.openTs, fromBlock, toBlock };

      const tokens: TokenRow[] = [];
      for (const nav of navs) {
        const started = Date.now();
        const tally = { calls: 0 };
        const aggregators = await aggregatorsFor(reader, nav, aggregatorsOf, tally);
        const { before, inside, after } = await readFeed(reader, source, aggregators, w, blocks, tally);
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
        const swapsRead = swapsRange(freeze, blocks);
        tally.calls++;
        const swaps = await source.swaps(nav.pool, swapsRead.from, swapsRead.to);

        const figures = measureToken({ window: span, updates, swaps });
        tokens.push(toTokenRow(nav, { aggregator, phase }, figures, freeze ? swapsRead : null));
        log(`${nav.symbol} ${w.id}: ${tally.calls} reads, ${((Date.now() - started) / 1000).toFixed(1)} s`);
      }
      out.push({ status: "complete", ...base, blocks: { from: fromBlock, to: toBlock }, ...(decisions ? { decisions } : {}), tokens });
    }
    return { out, waiting };
  }

  // With --wait, a live feed that has not updated by the head is read again through a newer finalized block.
  for (;;) {
    logHead(log, read, opts.head !== undefined);
    const { head } = read;
    const notYet = windows.filter((w) => w.openTs > head.ts);
    if (opts.complete && notYet.length) {
      const which = notYet.map((w) => `window ${w.id} ends ${w.openLabel}`).join(", ");
      const [them, their] = notYet.length === 1 ? ["it is", "its open"] : ["they are", "the last of their opens"];
      throw new Error(
        `${which}, after block ${head.block}, the latest finalized one (${utcIso(head.ts)}): ${them} not measured yet, so nothing is written; run again once Base has finalized a block at or after ${their}`,
      );
    }
    const { out, waiting } = await measureThrough(head);
    if (!waiting.length) {
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
    const newer = wait && (await wait.forNewer(read, waiting));
    if (!newer) throw new Error(`${waiting.join(", ")}: the feed has not updated since the window; run again later`);
    read = newer;
  }
}

export interface WarmDeps {
  reader: LogReader;
  /** The cache the measuring run reads (web/.cache/gap for the script): the warm-up writes it through createLogSource. */
  cacheDir: string;
  log: (line: string) => void;
  /** MarketCalendar on Base: when given, every selected window's edges are checked first, as the measuring run checks them. */
  calendar?: string;
  /** Where the edition number is looked up: EDITIONS, unless a test gives its own. */
  editions?: readonly EditionDef[];
}
export type WarmOptions = Omit<EditionOptions, "complete">;

/**
 * One aligned span of a window's reads: how many of its files (one per token and kind) came from Base or the cache, are
 * kept, and were settled but could not be written to the cache.
 */
export interface WarmSpan {
  from: number;
  to: number;
  read: number;
  cached: number;
  kept: number;
  failed: number;
}
export interface WarmWindow {
  id: string;
  status: "complete" | "pending" | "not started";
  spans: WarmSpan[];
  /** The span files of this window that the cache now holds. */
  kept: number;
  /** The last block of the last span kept, or null when none is. */
  keptThrough: number | null;
  /** The span files of this window that were settled below the head but could not be written: a later run reads them from Base. */
  failed: number;
  /** The first of those writes' errors, or null when every settled file is kept. */
  writeError: string | null;
  /** The eth_getLogs calls the window's reads made: one per span read from Base. */
  getLogs: number;
}
export interface WarmResult {
  head: { block: number; ts: number };
  windows: WarmWindow[];
  /** The distinct span files of the run that were settled but could not be written, so a later run reads them from Base. */
  failed: number;
  /** The first of those writes' errors, or null when there is none. */
  writeError: string | null;
}

/** One file's reads in a run or a window: read from Base if any read was, kept if any read kept it, and its first write error. */
function mergeRead(seen: SpanRead | undefined, s: SpanRead): SpanRead {
  if (!seen) return s;
  const writeError = seen.writeError ?? s.writeError;
  return { ...s, from: seen.from === "rpc" ? "rpc" : s.from, kept: seen.kept || s.kept, ...(writeError === undefined ? {} : { writeError }) };
}

/**
 * Reads into the cache the logs that the measuring run of each window will read from spans already settled (SETTLED
 * blocks) below the head, the latest finalized block or --head, and measures nothing. An ended window is read as the
 * measuring run reads it. A pending window is read as if it ended at the head: its feed's updates from its close and the
 * last one before it, and its pool's swaps from that last update, the earliest block a freeze can start at, both through
 * the head. A window that has not closed by the head has nothing to read yet.
 */
export async function warmEdition(deps: WarmDeps, opts: WarmOptions): Promise<WarmResult> {
  const { windows, navs } = selectRun(deps.editions, opts);
  const { reader, log } = deps;
  const read = await readHead(reader, opts.head);
  logHead(log, read, opts.head !== undefined);
  const { head } = read;
  if (deps.calendar) for (const w of windows) await checkCalendar(reader, deps.calendar, w, log);
  let files = new Map<string, SpanRead>();
  // Every file of the run, across windows: two windows can read the same span file.
  const runFiles = new Map<string, SpanRead>();
  let getLogs = 0;
  const source = createLogSource(reader, {
    cacheDir: deps.cacheDir,
    headBlock: head.block,
    onSpan: (s) => {
      if (s.from === "rpc") getLogs++;
      // A file this window read from Base counts as read, even when a later read of it in the window hits the cache.
      files.set(s.name, mergeRead(files.get(s.name), s));
      runFiles.set(s.name, mergeRead(runFiles.get(s.name), s));
    },
  });
  const aggregatorsOf = new Map<string, string[]>();
  const through = `block ${head.block} (${utcIso(head.ts)}), the block this run reads through`;

  const out: WarmWindow[] = [];
  for (const w of windows) {
    if (w.closeTs > head.ts) {
      log(`window ${w.id}: not started: its close, ${w.closeLabel}, is after ${through}, so there is nothing to read yet`);
      out.push({ id: w.id, status: "not started", spans: [], kept: 0, keptThrough: null, failed: 0, writeError: null, getLogs: 0 });
      continue;
    }
    const started = Date.now();
    files = new Map();
    getLogs = 0;
    const ended = w.openTs <= head.ts;
    const blocks = ended ? await endedBlocks(reader, w, head) : { fromBlock: await reader.blockAt(w.closeTs), toBlock: head.block, ahead: head.block };
    log(
      ended
        ? `window ${w.id}: complete, blocks ${blocks.fromBlock}-${blocks.toBlock}, read through ${through}`
        : `window ${w.id}: pending, from block ${blocks.fromBlock} through ${through}: it ends ${w.openLabel}`,
    );
    for (const nav of navs) {
      const tokenStarted = Date.now();
      const tally = { calls: 0 };
      const aggregators = await aggregatorsFor(reader, nav, aggregatorsOf, tally);
      const { before, inside, after } = await readFeed(reader, source, aggregators, w, blocks, tally);
      const updates = [...(before ? [before] : []), ...inside, ...(after ? [after] : [])];
      const live = feedLiveIn(updates, w);
      // Once a window has ended, and a live feed has updated after it, the swaps are those the measuring run reads.
      // Otherwise its freeze may still end at an update not read yet: the swaps are read from the update before the
      // close, where the earliest freeze starts, through the head.
      const range =
        ended && (after || !live)
          ? swapsRange(live ? findFreeze(updates, w) : null, blocks)
          : { from: before ? Math.min(blocks.fromBlock, before.block) : blocks.fromBlock, to: head.block };
      await source.swaps(nav.pool, range.from, range.to);
      log(`${nav.symbol} ${w.id}: ${tally.calls + 1} reads, ${((Date.now() - tokenStarted) / 1000).toFixed(1)} s`);
    }

    const bySpan = new Map<number, WarmSpan>();
    let writeError: string | null = null;
    for (const f of files.values()) {
      const s = bySpan.get(f.spanFrom) ?? { from: f.spanFrom, to: f.spanTo, read: 0, cached: 0, kept: 0, failed: 0 };
      if (f.from === "rpc") s.read++;
      else s.cached++;
      if (f.kept) s.kept++;
      else if (f.writeError !== undefined) {
        s.failed++;
        writeError ??= f.writeError;
      }
      bySpan.set(f.spanFrom, s);
    }
    const spans = [...bySpan.values()].sort((a, b) => a.from - b.from);
    for (const s of spans) {
      const kept =
        s.to > head.block - SETTLED
          ? `not kept: within ${SETTLED} blocks of the head`
          : `${s.kept} kept${s.failed ? `, ${s.failed} could not be written to the cache` : ""}`;
      log(`window ${w.id}: blocks ${s.from}-${s.to}: ${s.read} read from Base, ${s.cached} from the cache, ${kept}`);
    }
    const kept = spans.reduce((n, s) => n + s.kept, 0);
    const failed = spans.reduce((n, s) => n + s.failed, 0);
    const keptThrough = spans.filter((s) => s.kept > 0).at(-1)?.to ?? null;
    const done = `${getLogs} eth_getLogs calls, ${((Date.now() - started) / 1000).toFixed(1)} s`;
    log(
      failed > 0
        ? `window ${w.id}: ${failed} span files settled below the head could not be written to the cache (${writeError}), so a later run reads them from Base again; the cache holds ${kept} of this window's span files (${done})`
        : keptThrough === null
          ? `window ${w.id}: no span file in the cache: every span it read is within ${SETTLED} blocks of the head (${done})`
          : `window ${w.id}: ${kept} span files in the cache, the last ending at block ${keptThrough}: a later run reads this window's feed and pool logs from Base only after it (${done})`,
    );
    out.push({ id: w.id, status: ended ? "complete" : "pending", spans, kept, keptThrough, failed, writeError, getLogs });
  }
  const notWritten = [...runFiles.values()].filter((f) => !f.kept && f.writeError !== undefined);
  return { head, windows: out, failed: notWritten.length, writeError: notWritten[0]?.writeError ?? null };
}
