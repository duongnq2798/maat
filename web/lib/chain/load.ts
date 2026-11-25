import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, getAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import addresses from "@/content/generated/base-addresses.json";
import { vaultAbi } from "./abi";
import { CACHE_SAFETY_BLOCKS, loadCache, saveCache, type CachedLog, type LedgerCache } from "./cache";
import { BASE_CHAIN_ID, SCAN_FLOOR_BLOCK } from "./config";
import { decodeVaultLogs, type DecisionEvent, type VaultEvent } from "./events";
import { decisionTrails, summarize, toMainnetDecisions, type DecisionTrail, type MainnetDecision, type Summary, type TxInput } from "./ledger";
import type { RationaleSource } from "./rationale";
import { scanLogs, type BlockRange } from "./scan";
import { parseSnapshot, SNAPSHOT_REORG_WINDOW, type DecisionsSnapshot } from "./snapshot";
import { readTreasury, type Treasury } from "./treasury";

/** The client calls the ledger makes; a viem PublicClient satisfies it, and tests pass a fake. */
export type LedgerClient = Pick<
  PublicClient,
  "getBlockNumber" | "getBytecode" | "readContract" | "multicall" | "getBlock" | "getLogs" | "getTransactionReceipt" | "getTransaction"
>;

/** MandateVault.TIMELOCK, 24 hours: how the page tells a MandateVault from any other contract at the address. */
const TIMELOCK_SEC = 86_400n;
/** Below this span a range error gives up instead of halving again (50,000 / 8), so a 200-block RPC fails fast. */
const MIN_SPAN = 6_250n;
/** A scan stops after this many chunks fail, so an RPC that is down is not asked for every remaining chunk. */
const MAX_FAILED = 3;
/** Block and receipt reads go out this many at a time (the http transport batches them). */
const LOOKUP_BATCH = 50;

const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);

export class VaultCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultCheckError";
  }
}

/** Throws VaultCheckError unless `vault` holds a contract whose TIMELOCK() is 24 h. RPC errors propagate as they are. */
export async function verifyVault(client: LedgerClient, vault: Address): Promise<void> {
  const code = await client.getBytecode({ address: vault });
  if (!code || code === "0x") throw new VaultCheckError(`${vault} has no contract on Base mainnet.`);
  let timelock: unknown;
  try {
    timelock = await client.readContract({ address: vault, abi: vaultAbi, functionName: "TIMELOCK" });
  } catch (e) {
    const reverted = e instanceof BaseError && e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError);
    if (!reverted) throw e;
  }
  if (timelock !== TIMELOCK_SEC) throw new VaultCheckError(`${vault} is not a MandateVault: TIMELOCK() did not return 24 hours.`);
}

export interface ScanState {
  /** The deploy block, or SCAN_FLOOR_BLOCK when the deploy tx is not recorded. */
  floor: bigint;
  head: bigint;
  /** The lowest block such that every block from it to the head was read, or null when the head was not. */
  scannedFrom: bigint | null;
  /** Ranges in [floor, head] not read yet, newest first. */
  gaps: BlockRange[];
  done: boolean;
  /** The committed snapshot this load started from, once Base gave the same hash for its block; null otherwise. */
  fromSnapshot: { block: bigint; blockHash: Hash } | null;
}

export interface LedgerSnapshot {
  vault: Address;
  treasury: Treasury | null;
  treasuryError: string | null;
  events: VaultEvent[];
  /** Newest first. */
  decisions: MainnetDecision[];
  summary: Summary;
  rationales: Map<Hex, string>;
  /** "checking" until the rationale source has been asked, "unavailable" when asking it failed. */
  rationaleState: "checking" | "read" | "unavailable";
  /** Each Decision transaction that was read, by lowercased hash: its sender, target and input. */
  txs: ReadonlyMap<string, TxInput>;
  /** "checking" until the Decision transactions have been asked for; a transaction whose read failed is then absent. */
  txState: "checking" | "read";
  /** Sender label, decoded calldata and Builder Code check of each Decision whose transaction was read, by its key. */
  trails: ReadonlyMap<string, DecisionTrail>;
  scan: ScanState;
  /** Milliseconds, from `now`. */
  updatedAt: number;
}

export interface LoadOptions {
  client: LedgerClient;
  vault: Address;
  deployTx: Hash | null;
  rationaleSource: RationaleSource;
  storage?: Storage | null;
  /** The floor a previous load found, which saves reading the deploy receipt again. */
  floor?: bigint;
  /**
   * Decision transactions a previous load read, by lowercased hash. The load adds the ones it reads to this map, so a
   * refresh asks only for new transactions. A transaction never changes, so nothing in it goes stale.
   */
  txs?: Map<string, TxInput>;
  /**
   * The committed snapshot, as /data/decisions-snapshot.json holds it (parsed JSON), or a promise of it. Once Base gives
   * the hash it records for its block N, the load takes the logs below N − SNAPSHOT_REORG_WINDOW from it and scans
   * only from there to the head. Without one, with one it cannot use, or when the browser cache already covers it, the
   * load scans as if there were none.
   */
  snapshot?: unknown;
  now?: () => number;
  signal?: AbortSignal;
  onProgress?: (snapshot: LedgerSnapshot) => void;
}

/** A short message for an error from viem or anywhere else. */
export function errorText(e: unknown): string {
  if (e instanceof BaseError) return e.shortMessage;
  return e instanceof Error ? e.message : String(e);
}

const keyOf = (l: CachedLog) => `${l.transactionHash.toLowerCase()}:${l.logIndex}`;

/** Merges overlapping or touching ranges, newest first. */
function merge(ranges: readonly BlockRange[]): BlockRange[] {
  const sorted = [...ranges].sort((a, b) => (a.to === b.to ? 0 : a.to > b.to ? -1 : 1));
  const out: BlockRange[] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r.to >= last.from - 1n) last.from = r.from < last.from ? r.from : last.from;
    else out.push({ ...r });
  }
  return out;
}

function scanState(floor: bigint, head: bigint, covered: readonly BlockRange[], fromSnapshot: ScanState["fromSnapshot"]): ScanState {
  const done = merge(covered.map((r) => ({ from: r.from < floor ? floor : r.from, to: r.to > head ? head : r.to })).filter((r) => r.from <= r.to));
  const gaps: BlockRange[] = [];
  let hi = head;
  for (const r of done) {
    if (r.to < hi) gaps.push({ from: r.to + 1n, to: hi });
    hi = r.from - 1n;
  }
  if (hi >= floor) gaps.push({ from: floor, to: hi });
  const top = done[0];
  return { floor, head, scannedFrom: top && top.to === head ? top.from : null, gaps, done: gaps.length === 0, fromSnapshot };
}

/** A usable cache for a chain whose head is `head`, or null. */
function usableCache(cache: LedgerCache | null, head: bigint): LedgerCache | null {
  if (!cache) return null;
  const from = BigInt(cache.from);
  const to = BigInt(cache.to);
  return from <= to && to <= head ? cache : null;
}

async function inBatches<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += LOOKUP_BATCH) await Promise.allSettled(items.slice(i, i + LOOKUP_BATCH).map(run));
}

/** What a read of the vault holds: the block ranges whose logs it has, those logs, and the reads for each Decision. */
interface Reads {
  covered: BlockRange[];
  logs: Map<string, CachedLog>;
  blockTimes: Record<string, number>;
  gasUsed: Record<string, string>;
  /** By lowercased transaction hash. */
  txs: Map<string, TxInput>;
}

/** The last block whose logs a load takes from `snapshot`; the window above it, up to N, is read again. */
const snapshotTop = (snapshot: DecisionsSnapshot) => BigInt(snapshot.block) - SNAPSHOT_REORG_WINDOW - 1n;

/**
 * The snapshot in `raw` (a value or a promise of one) once Base gives its block the hash it records, or null: no
 * snapshot, a bad one, a block Base does not have, a read of it that failed, or a `cache` that already covers it.
 */
async function confirmSnapshot(client: LedgerClient, vault: Address, raw: unknown, cache: LedgerCache | null): Promise<DecisionsSnapshot | null> {
  let snapshot: DecisionsSnapshot | null;
  try {
    snapshot = parseSnapshot(await raw, vault);
  } catch {
    return null;
  }
  if (!snapshot) return null;
  if (cache && BigInt(cache.from) <= BigInt(snapshot.floor) && BigInt(cache.to) >= snapshotTop(snapshot)) return null;
  try {
    const block = await client.getBlock({ blockNumber: BigInt(snapshot.block) });
    return block.hash?.toLowerCase() === snapshot.blockHash.toLowerCase() ? snapshot : null;
  } catch {
    return null;
  }
}

/** Adds to `reads` what `snapshot` holds below its reorg window, keeping anything `reads` already has. */
function seedSnapshot(reads: Reads, snapshot: DecisionsSnapshot): void {
  const top = snapshotTop(snapshot);
  const kept = snapshot.logs.filter((l) => BigInt(l.blockNumber) <= top);
  for (const l of kept) if (!reads.logs.has(keyOf(l))) reads.logs.set(keyOf(l), l);
  const keptTxs = new Set(kept.map((l) => l.transactionHash.toLowerCase()));
  for (const [b, t] of Object.entries(snapshot.blockTimes)) if (BigInt(b) <= top) reads.blockTimes[b] ??= t;
  for (const [h, g] of Object.entries(snapshot.gasUsed)) if (keptTxs.has(h.toLowerCase())) reads.gasUsed[h] ??= g;
  for (const [h, tx] of Object.entries(snapshot.txs)) if (keptTxs.has(h) && !reads.txs.has(h)) reads.txs.set(h, tx);
  const floor = BigInt(snapshot.floor);
  if (floor <= top) reads.covered.push({ from: floor, to: top });
}

interface ScanTuning {
  span?: bigint;
  minSpan?: bigint;
  concurrency?: number;
  signal?: AbortSignal;
  onChunk?: () => void;
}

/** Reads the vault's logs over every part of [floor, head] that `reads` does not cover, newest first. */
async function scanGaps(client: LedgerClient, vault: Address, floor: bigint, head: bigint, reads: Reads, tuning: ScanTuning): Promise<void> {
  for (const gap of scanState(floor, head, reads.covered, null).gaps) {
    await scanLogs<CachedLog>({
      ...gap,
      span: tuning.span,
      minSpan: tuning.minSpan ?? MIN_SPAN,
      concurrency: tuning.concurrency,
      maxFailed: MAX_FAILED,
      signal: tuning.signal,
      getLogs: async (r) =>
        (await client.getLogs({ address: vault, fromBlock: r.from, toBlock: r.to })).flatMap((l) =>
          l.blockNumber === null || l.transactionHash === null || l.logIndex === null
            ? []
            : [{ blockNumber: l.blockNumber.toString(), logIndex: l.logIndex, transactionHash: l.transactionHash, topics: [...l.topics] as Hex[], data: l.data }],
        ),
      onChunk: (chunk) => {
        for (const l of chunk.logs) reads.logs.set(keyOf(l), l);
        reads.covered.push({ from: chunk.from, to: chunk.to });
        tuning.onChunk?.();
      },
    });
  }
}

/** Reads the block time, gas and transaction of each Decision in `reads` that lacks one; a failed read leaves it out. */
async function readDecisionDetails(client: LedgerClient, reads: Reads): Promise<DecisionEvent[]> {
  const { blockTimes, gasUsed, txs } = reads;
  const decisionEvents = decodeVaultLogs([...reads.logs.values()]).filter((e): e is DecisionEvent => e.name === "Decision");
  const blocks = [...new Set(decisionEvents.map((e) => e.blockNumber.toString()))].filter((b) => blockTimes[b] === undefined);
  const unreceipted = [...new Set(decisionEvents.map((e) => e.txHash))].filter((h) => gasUsed[h] === undefined);
  // The input of each Decision transaction carries its blob and Builder Code (spec §1); the receipt carries neither.
  const unread = [...new Set(decisionEvents.map((e) => e.txHash.toLowerCase() as Hash))].filter((h) => !txs.has(h));
  await inBatches(blocks, async (b) => {
    const block = await client.getBlock({ blockNumber: BigInt(b) });
    blockTimes[b] = Number(block.timestamp);
  });
  await Promise.all([
    inBatches(unreceipted, async (h) => {
      const receipt = await client.getTransactionReceipt({ hash: h });
      gasUsed[h] = receipt.gasUsed.toString();
    }),
    inBatches(unread, async (h) => {
      const tx = await client.getTransaction({ hash: h });
      txs.set(h, { from: getAddress(tx.from), to: tx.to ? getAddress(tx.to) : null, input: tx.input });
    }),
  ]);
  return decisionEvents;
}

/**
 * Reads the vault's treasury and every event since its deploy block from Base, reusing what `storage` remembers and
 * the committed snapshot when it is given one. A treasury read failure or a failed log chunk does not throw: the
 * snapshot reports it, so the page shows what it has.
 */
export async function loadLedger(opts: LoadOptions): Promise<LedgerSnapshot> {
  const { client, vault, rationaleSource, signal, onProgress } = opts;
  const storage = opts.storage;
  const now = opts.now ?? Date.now;
  const cached = loadCache(vault, storage);

  // The treasury, the deploy block and the snapshot's block hash are independent reads, so they go out together.
  const [treasuryRead, floor, confirmed] = await Promise.all([
    readTreasury(client, vault).then(
      (t) => ({ treasury: t as Treasury | null, error: null as string | null }),
      (e: unknown) => ({ treasury: null, error: errorText(e) }),
    ),
    opts.floor ?? deployBlock(client, opts.deployTx),
    opts.snapshot === undefined ? null : confirmSnapshot(client, vault, opts.snapshot, cached),
  ]);
  const { treasury, error: treasuryError } = treasuryRead;
  const head = treasury?.blockNumber ?? (await client.getBlockNumber());

  const cache = usableCache(cached, head);
  const reads: Reads = {
    covered: cache ? [{ from: BigInt(cache.from), to: BigInt(cache.to) }] : [],
    logs: new Map<string, CachedLog>((cache?.logs ?? []).map((l) => [keyOf(l), l])),
    blockTimes: { ...cache?.blockTimes },
    gasUsed: { ...cache?.gasUsed },
    txs: opts.txs ?? new Map<string, TxInput>(),
  };
  const snapshot = confirmed && BigInt(confirmed.block) <= head ? confirmed : null;
  if (snapshot) seedSnapshot(reads, snapshot);
  const fromSnapshot = snapshot ? { block: BigInt(snapshot.block), blockHash: snapshot.blockHash } : null;

  const usdc = treasury?.usdcAddress ?? USDC;
  const decimals = Object.fromEntries(
    (treasury?.tokens ?? []).flatMap((t) => (t.decimals.ok ? [[t.address.toLowerCase(), t.decimals.value] as const] : [])),
  );
  let rationales = new Map<Hex, string>();
  let rationaleState: LedgerSnapshot["rationaleState"] = "checking";
  let txState: LedgerSnapshot["txState"] = "checking";

  const view = (): LedgerSnapshot => {
    const { blockTimes, gasUsed } = reads;
    const events = decodeVaultLogs([...reads.logs.values()]);
    const decisions = toMainnetDecisions(events, { blockTimes, gasUsed, decimals, usdc });
    const scan = scanState(floor, head, reads.covered, fromSnapshot);
    const read = new Map(reads.txs);
    return {
      vault,
      treasury,
      treasuryError,
      events,
      decisions,
      summary: summarize(events, { blockTimes, usdc, nowSec: Math.floor(now() / 1000) }),
      rationales,
      rationaleState,
      txs: read,
      txState,
      trails: decisionTrails(decisions, read, { vault, owner: treasury?.owner ?? null, complete: scan.done }),
      scan,
      updatedAt: now(),
    };
  };

  onProgress?.(view());
  await scanGaps(client, vault, floor, head, reads, { signal, onChunk: () => onProgress?.(view()) });

  // Block times, gas and transactions of decisions this browser has not seen yet.
  const decisionEvents = await readDecisionDetails(client, reads);
  txState = "read";
  if (signal?.aborted) throw new DOMException("The ledger load was aborted.", "AbortError");

  try {
    rationales = await rationaleSource.lookup(decisionEvents.map((e) => e.intentId));
    rationaleState = "read";
  } catch {
    rationales = new Map();
    rationaleState = "unavailable";
  }

  const result = view();
  const entry = cacheEntry(vault, head, reads.covered, reads.logs, reads.blockTimes, reads.gasUsed);
  if (entry) saveCache(entry, storage);
  return result;
}

export interface SnapshotOptions {
  client: LedgerClient;
  vault: Address;
  deployTx: Hash | null;
  /** Block N as the RPC gave it. Pick one that cannot reorg, such as the RPC's finalized block. */
  block: { number: bigint; hash: Hash };
  /** The snapshot to build on (parsed JSON): its logs below its reorg window are kept once Base gives its block's hash. */
  previous?: unknown;
  /** Blocks per eth_getLogs call (default LOG_CHUNK in scan.ts); mainnet.base.org needs MIN_LOG_CHUNK. */
  span?: bigint;
  /** Below this span a range error gives up (default 6,250, as the page's scan). */
  minSpan?: bigint;
  concurrency?: number;
  signal?: AbortSignal;
  /** After each chunk: the blocks of [floor, N] read so far, and their total. */
  onProgress?: (read: bigint, total: bigint) => void;
}

const byBlock = (a: CachedLog, b: CachedLog) => {
  const x = BigInt(a.blockNumber);
  const y = BigInt(b.blockNumber);
  return x === y ? a.logIndex - b.logIndex : x < y ? -1 : 1;
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The committed snapshot at `block`: every log of the vault from its deploy block to N, with each Decision's block
 * time, gas and transaction, as loadLedger takes them. Throws rather than return a snapshot with a hole in it.
 */
export async function takeSnapshot(opts: SnapshotOptions): Promise<DecisionsSnapshot> {
  const { client, vault, block } = opts;
  const n = block.number;
  // Unlike the page, the deploy block is not guessed when its receipt cannot be read: the scan would be far longer.
  const floor = opts.deployTx ? (await client.getTransactionReceipt({ hash: opts.deployTx })).blockNumber : SCAN_FLOOR_BLOCK;
  const reads: Reads = { covered: [], logs: new Map(), blockTimes: {}, gasUsed: {}, txs: new Map() };
  const previous = opts.previous === undefined ? null : await confirmSnapshot(client, vault, opts.previous, null);
  if (previous && BigInt(previous.block) <= n) seedSnapshot(reads, previous);

  const total = n - floor + 1n;
  const progress = () => {
    const s = scanState(floor, n, reads.covered, null);
    opts.onProgress?.(total - s.gaps.reduce((sum, g) => sum + (g.to - g.from + 1n), 0n), total);
  };
  await scanGaps(client, vault, floor, n, reads, { span: opts.span, minSpan: opts.minSpan, concurrency: opts.concurrency, signal: opts.signal, onChunk: progress });
  const { gaps } = scanState(floor, n, reads.covered, null);
  if (gaps.length > 0) {
    throw new Error(`${gaps.map((g) => `blocks ${g.from} to ${g.to}`).join(", ")} could not be read; no snapshot written`);
  }

  const decisions = await readDecisionDetails(client, reads);
  const missing = [
    ["block time", decisions.filter((e) => reads.blockTimes[e.blockNumber.toString()] === undefined).length],
    ["gas", decisions.filter((e) => reads.gasUsed[e.txHash] === undefined).length],
    ["transaction", decisions.filter((e) => !reads.txs.has(e.txHash.toLowerCase())).length],
  ] as const;
  const unread = missing.filter(([, count]) => count > 0).map(([what, count]) => `the ${what} of ${plural(count, "Decision")}`);
  if (unread.length > 0) throw new Error(`could not read ${unread.join(", ")}; no snapshot written`);

  const logs = [...reads.logs.values()].filter((l) => BigInt(l.blockNumber) >= floor && BigInt(l.blockNumber) <= n).sort(byBlock);
  const kept = decodeVaultLogs(logs).filter((e): e is DecisionEvent => e.name === "Decision");
  return {
    v: 1,
    chainId: BASE_CHAIN_ID,
    vault: getAddress(vault),
    floor: floor.toString(),
    block: n.toString(),
    blockHash: block.hash,
    logs,
    blockTimes: Object.fromEntries(kept.map((e) => [e.blockNumber.toString(), reads.blockTimes[e.blockNumber.toString()]!])),
    gasUsed: Object.fromEntries(kept.map((e) => [e.txHash, reads.gasUsed[e.txHash]!])),
    txs: Object.fromEntries(kept.map((e) => [e.txHash.toLowerCase(), reads.txs.get(e.txHash.toLowerCase())!])),
  };
}

async function deployBlock(client: LedgerClient, deployTx: Hash | null): Promise<bigint> {
  if (!deployTx) return SCAN_FLOOR_BLOCK;
  try {
    return (await client.getTransactionReceipt({ hash: deployTx })).blockNumber;
  } catch {
    return SCAN_FLOOR_BLOCK;
  }
}

/** The largest contiguous range read, cut to CACHE_SAFETY_BLOCKS below the head so a reorg near the tip is reread. */
function cacheEntry(
  vault: Address,
  head: bigint,
  covered: readonly BlockRange[],
  logs: ReadonlyMap<string, CachedLog>,
  blockTimes: Readonly<Record<string, number>>,
  gasUsed: Readonly<Record<string, string>>,
): LedgerCache | null {
  const safe = head - CACHE_SAFETY_BLOCKS;
  const best = merge(covered)
    .map((r) => ({ from: r.from, to: r.to > safe ? safe : r.to }))
    .filter((r) => r.from <= r.to)
    .sort((a, b) => (b.to - b.from > a.to - a.from ? 1 : b.to - b.from < a.to - a.from ? -1 : 0))[0];
  if (!best) return null;
  const kept = [...logs.values()].filter((l) => BigInt(l.blockNumber) >= best.from && BigInt(l.blockNumber) <= best.to);
  const txs = new Set(kept.map((l) => l.transactionHash));
  return {
    v: 1,
    vault,
    from: best.from.toString(),
    to: best.to.toString(),
    logs: kept,
    blockTimes: Object.fromEntries(Object.entries(blockTimes).filter(([b]) => BigInt(b) >= best.from && BigInt(b) <= best.to)),
    gasUsed: Object.fromEntries(Object.entries(gasUsed).filter(([h]) => txs.has(h as Hash))),
  };
}
