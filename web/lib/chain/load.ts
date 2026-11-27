import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, getAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import addresses from "@/content/generated/base-addresses.json";
import { vaultAbi } from "./abi";
import { CACHE_SAFETY_BLOCKS, loadCache, saveCache, type CachedLog, type LedgerCache } from "./cache";
import { BASE_CHAIN_ID, SCAN_FLOOR_BLOCK } from "./config";
import { decodeVaultLogs, type DecisionEvent, type VaultEvent } from "./events";
import { decisionTrails, summarize, toMainnetDecisions, type DecisionTrail, type MainnetDecision, type Summary, type TxInput } from "./ledger";
import type { RationaleSource } from "./rationale";
import { scanLogs, type BlockRange } from "./scan";
import { parseBriefsSnapshot, parseSnapshot, SNAPSHOT_REORG_WINDOW, snapshotId, type BriefsSnapshot, type DecisionsSnapshot, type LogSnapshot } from "./snapshot";
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
/**
 * A load stops scanning after this many chunks fail, so an RPC that is down is not asked for every remaining chunk. The
 * scan reads the newest chunks first, so what stops it leaves out the oldest blocks, and the page names them.
 */
export const MAX_FAILED = 3;
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

/** What the committed snapshot holds before Base has confirmed it: its block N and its Decisions, newest first. */
export interface SnapshotPreview {
  block: bigint;
  decisions: MainnetDecision[];
}

/** A Decision's block time and gas this build records (content/facts.ts mainnetDecisions), by block and by tx. */
export interface RecordedDetails {
  blockTimes: Readonly<Record<string, number>>;
  gasUsed: Readonly<Record<string, string>>;
}

/**
 * The Decisions of the committed snapshot in `raw` (parsed JSON), newest first, for a page to show while a load
 * confirms the file on Base. They are not a reading of Base: a time and a gas come only from `recorded`, no transaction
 * is read, and the load's own Decisions replace them. Null when `raw` is no snapshot of `vault` or holds no Decision.
 */
export function snapshotPreview(raw: unknown, vault: Address, recorded: RecordedDetails = { blockTimes: {}, gasUsed: {} }): SnapshotPreview | null {
  const snapshot = parseSnapshot(raw, vault);
  if (!snapshot) return null;
  const decisions = toMainnetDecisions(decodeVaultLogs(snapshot.logs), { blockTimes: recorded.blockTimes, gasUsed: recorded.gasUsed, decimals: {}, usdc: USDC });
  return decisions.length === 0 ? null : { block: BigInt(snapshot.block), decisions };
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
   * The committed snapshot, as /data/decisions-snapshot.json holds it (parsed JSON), or a promise of it; a refresh
   * passes none. Once Base gives the hash it records for its block N and the receipt of each log below
   * N − SNAPSHOT_REORG_WINDOW holds that log as the file has it, the load takes those logs from it and scans only from
   * there to the head; each Decision's time, gas and transaction are read from Base as for any other. Without one,
   * with one that fails that check, or when the browser cache already covers it, the load scans as if there were none.
   * A cache entry that took logs from a file is dropped once the caller passes another file, or null.
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
const snapshotTop = (snapshot: LogSnapshot) => BigInt(snapshot.block) - SNAPSHOT_REORG_WINDOW - 1n;
/** The logs a load takes from `snapshot`: those below its reorg window. */
const belowWindow = (snapshot: LogSnapshot) => snapshot.logs.filter((l) => BigInt(l.blockNumber) <= snapshotTop(snapshot));
/** True when `cache` holds every block a load would take from `snapshot`. */
const covers = (cache: LedgerCache | null, snapshot: LogSnapshot) =>
  cache !== null && BigInt(cache.from) <= BigInt(snapshot.floor) && BigInt(cache.to) >= snapshotTop(snapshot);
const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The snapshot in `raw` (a value or a promise of one), or null: none, a fetch that failed, or a bad file. */
async function readSnapshot(raw: unknown, vault: Address): Promise<DecisionsSnapshot | null> {
  try {
    return parseSnapshot(await raw, vault);
  } catch {
    return null;
  }
}

/** The Brief snapshot in `raw` (a value or a promise of one), or null: none, a fetch that failed, or a bad file. */
export async function readBriefsSnapshot(raw: unknown, inbox: Address): Promise<BriefsSnapshot | null> {
  try {
    return parseBriefsSnapshot(await raw, inbox);
  } catch {
    return null;
  }
}

type Check = { ok: true; gasUsed: Record<string, string> } | { ok: false; reason: string };

/** The part of a receipt the check reads; a viem TransactionReceipt has it. */
interface ReceiptLogs {
  blockNumber: bigint;
  gasUsed: bigint;
  logs: readonly { address: string; logIndex: number | null; topics: readonly string[]; data: string }[];
}

/**
 * Checks `logs` of `snapshot` against Base: block N must have the hash the file records, and each log's transaction
 * receipt must hold, in the same block and at the same log index, the same log of `address` (the vault, or the inbox
 * when `what` says so). Returns the gas of each Decision transaction it read, or why the file fails. So a file that
 * passes can leave a log out, but it cannot add a log or change one. With no log, only block N's hash is read.
 */
async function check(client: LedgerClient, address: Address, snapshot: LogSnapshot, logs: readonly CachedLog[], what = "the vault"): Promise<Check> {
  const byTx = new Map<string, CachedLog[]>();
  for (const l of logs) byTx.set(l.transactionHash.toLowerCase(), [...(byTx.get(l.transactionHash.toLowerCase()) ?? []), l]);
  const decisionTxs = new Set(decodeVaultLogs([...logs]).flatMap((e) => (e.name === "Decision" ? [e.txHash.toLowerCase()] : [])));
  const gasUsed: Record<string, string> = {};

  const readBlock = async (): Promise<string | null> => {
    let hash: Hash | null;
    try {
      hash = (await client.getBlock({ blockNumber: BigInt(snapshot.block) })).hash;
    } catch (e) {
      return `block ${snapshot.block} could not be read: ${errorText(e)}`;
    }
    return hash !== null && sameHex(hash, snapshot.blockHash) ? null : `block ${snapshot.block} has another hash on this RPC`;
  };
  const readReceipt = async (own: readonly CachedLog[]): Promise<string | null> => {
    const hash = own[0]!.transactionHash;
    let receipt: ReceiptLogs;
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch (e) {
      return `the receipt of ${hash} could not be read: ${errorText(e)}`;
    }
    for (const l of own) {
      const r = receipt.blockNumber === BigInt(l.blockNumber) ? receipt.logs.find((x) => x.logIndex === l.logIndex) : undefined;
      const same =
        r !== undefined &&
        sameHex(r.address, address) &&
        sameHex(r.data, l.data) &&
        r.topics.length === l.topics.length &&
        r.topics.every((t, i) => sameHex(t, l.topics[i]!));
      if (!same) return `the receipt of ${hash} has no log of ${what} at index ${l.logIndex} as the file has it in block ${l.blockNumber}`;
    }
    if (decisionTxs.has(hash.toLowerCase())) for (const l of own) gasUsed[l.transactionHash] = receipt.gasUsed.toString();
    return null;
  };
  const readReceipts = async (): Promise<string | null> => {
    const groups = [...byTx.values()];
    for (let i = 0; i < groups.length; i += LOOKUP_BATCH) {
      const failed = (await Promise.all(groups.slice(i, i + LOOKUP_BATCH).map(readReceipt))).find((r) => r !== null);
      if (failed) return failed;
    }
    return null;
  };

  const [blockFailed, receiptFailed] = await Promise.all([readBlock(), readReceipts()]);
  const reason = blockFailed ?? receiptFailed;
  return reason === null ? { ok: true, gasUsed } : { ok: false, reason };
}

/** The gas of each Decision a load takes from `snapshot` once the file passes `check`, or null when it does not. */
async function confirmSnapshot(client: LedgerClient, address: Address, snapshot: LogSnapshot, what?: string): Promise<Record<string, string> | null> {
  const out = await check(client, address, snapshot, belowWindow(snapshot), what);
  return out.ok ? out.gasUsed : null;
}

/** What a read takes from a committed snapshot once Base confirms it: its block N, the blocks [from, to] and their logs. */
export interface TakenSnapshot {
  block: bigint;
  blockHash: Hash;
  /** The file's floor. */
  from: bigint;
  /** N - SNAPSHOT_REORG_WINDOW - 1: the window above it, up to N, is read again. */
  to: bigint;
  logs: CachedLog[];
}

/**
 * What a read of the inbox's Brief logs takes from `snapshot`, checked as a ledger load checks the decisions snapshot:
 * Base gives block N the hash the file records, and each log's transaction receipt below the window holds that log of
 * the inbox. Null when the file fails that check or holds no block below its window.
 */
export async function confirmBriefsSnapshot(client: LedgerClient, inbox: Address, snapshot: BriefsSnapshot): Promise<TakenSnapshot | null> {
  const from = BigInt(snapshot.floor);
  const to = snapshotTop(snapshot);
  if (from > to || (await confirmSnapshot(client, inbox, snapshot, "the inbox")) === null) return null;
  return { block: BigInt(snapshot.block), blockHash: snapshot.blockHash, from, to, logs: belowWindow(snapshot) };
}

/**
 * Checks the snapshot in `raw` against the RPC behind `client` as a load does, but over every log in the file, those of
 * the window too. npm run snapshot asks a second RPC this before it writes a file.
 */
export async function checkSnapshot(client: LedgerClient, vault: Address, raw: unknown): Promise<{ ok: true } | { ok: false; reason: string }> {
  const snapshot = parseSnapshot(raw, vault);
  if (!snapshot) return { ok: false, reason: `not a decisions snapshot of ${vault} on Base mainnet` };
  const out = await check(client, vault, snapshot, snapshot.logs);
  return out.ok ? { ok: true } : out;
}

/** checkSnapshot for the Brief snapshot of `inbox`: block N's hash and every log in the file, those of the window too. */
export async function checkBriefsSnapshot(client: LedgerClient, inbox: Address, raw: unknown): Promise<{ ok: true } | { ok: false; reason: string }> {
  const snapshot = parseBriefsSnapshot(raw, inbox);
  if (!snapshot) return { ok: false, reason: `not a Brief snapshot of ${inbox} on Base mainnet` };
  const out = await check(client, inbox, snapshot, snapshot.logs, "the inbox");
  return out.ok ? { ok: true } : out;
}

/** Adds to `reads` the logs `snapshot` holds below its reorg window and the gas `check` read, keeping what `reads` has. */
function seedSnapshot(reads: Reads, snapshot: LogSnapshot, gasUsed: Readonly<Record<string, string>>): void {
  for (const l of belowWindow(snapshot)) if (!reads.logs.has(keyOf(l))) reads.logs.set(keyOf(l), l);
  for (const [h, g] of Object.entries(gasUsed)) reads.gasUsed[h] ??= g;
  const floor = BigInt(snapshot.floor);
  const top = snapshotTop(snapshot);
  if (floor <= top) reads.covered.push({ from: floor, to: top });
}

interface ScanTuning {
  span?: bigint;
  minSpan?: bigint;
  concurrency?: number;
  signal?: AbortSignal;
  onChunk?: () => void;
}

/**
 * Reads the logs of `address` over every part of [floor, head] that `reads` does not cover: the newest gap first, each
 * newest chunk first. Once MAX_FAILED chunks have failed in all, no older chunk is asked for, so the gaps left open are
 * the oldest blocks, and the newest logs are in `reads`.
 */
async function scanGaps(client: LedgerClient, address: Address, floor: bigint, head: bigint, reads: Reads, tuning: ScanTuning): Promise<void> {
  let failed = 0;
  for (const gap of scanState(floor, head, reads.covered, null).gaps) {
    if (failed >= MAX_FAILED) return;
    const result = await scanLogs<CachedLog>({
      ...gap,
      span: tuning.span,
      minSpan: tuning.minSpan ?? MIN_SPAN,
      concurrency: tuning.concurrency,
      maxFailed: MAX_FAILED - failed,
      signal: tuning.signal,
      getLogs: async (r) =>
        (await client.getLogs({ address, fromBlock: r.from, toBlock: r.to })).flatMap((l) =>
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
    failed += result.failed.length;
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
  const stored = loadCache(vault, storage);

  // undefined when the caller passes no snapshot (a refresh), null when there is none it can use.
  const served = opts.snapshot === undefined ? Promise.resolve(undefined) : readSnapshot(opts.snapshot, vault);
  // An entry that took logs from a snapshot is kept only while the site serves that same file, so a file that is
  // replaced or removed takes with it what it left in this browser, a log it left out included.
  const kept = served.then((s) => (s === undefined || !stored?.snapshot || (s !== null && snapshotId(s) === stored.snapshot) ? stored : null));
  // The file is checked unless the cache already holds every block the load would take from it.
  const early = Promise.all([served, kept]).then(([s, c]) => (s && !covers(c, s) ? confirmSnapshot(client, vault, s) : null));

  // The treasury, the deploy block and the snapshot's check are independent reads, so they go out together.
  const [treasuryRead, floor, cached, earlyGas] = await Promise.all([
    readTreasury(client, vault).then(
      (t) => ({ treasury: t as Treasury | null, error: null as string | null }),
      (e: unknown) => ({ treasury: null, error: errorText(e) }),
    ),
    opts.floor ?? deployBlock(client, opts.deployTx),
    kept,
    early,
  ]);
  const { treasury, error: treasuryError } = treasuryRead;
  const head = treasury?.blockNumber ?? (await client.getBlockNumber());

  const cache = usableCache(cached, head);
  const file = await served;
  // A cache that covers the file spared its check, but one that ends above this RPC's head is not used: check it now.
  const gas = earlyGas ?? (file && covers(cached, file) && !cache ? await confirmSnapshot(client, vault, file) : null);
  const snapshot = file && gas && BigInt(file.block) <= head ? file : null;
  const reads: Reads = {
    covered: cache ? [{ from: BigInt(cache.from), to: BigInt(cache.to) }] : [],
    logs: new Map<string, CachedLog>((cache?.logs ?? []).map((l) => [keyOf(l), l])),
    blockTimes: { ...cache?.blockTimes },
    gasUsed: { ...cache?.gasUsed },
    txs: opts.txs ?? new Map<string, TxInput>(),
  };
  if (snapshot && gas) seedSnapshot(reads, snapshot, gas);
  const fromSnapshot = snapshot ? { block: BigInt(snapshot.block), blockHash: snapshot.blockHash } : null;
  const tag = snapshot ? snapshotId(snapshot) : cache?.snapshot;

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
  const entry = cacheEntry(vault, head, reads, tag);
  if (entry) saveCache(entry, storage);
  return result;
}

export interface SnapshotOptions {
  client: LedgerClient;
  vault: Address;
  deployTx: Hash | null;
  /** Block N as the RPC gave it. Pick one that cannot reorg, such as the RPC's finalized block. */
  block: { number: bigint; hash: Hash };
  /**
   * The snapshot to build on (parsed JSON): its logs below its reorg window are kept once the RPC gives its block's
   * hash and the receipt of each of those logs, as a load checks them.
   */
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

/** The Brief snapshot's options: SnapshotOptions with the inbox in place of the vault. */
export type BriefsSnapshotOptions = Omit<SnapshotOptions, "vault"> & { inbox: Address };

/**
 * The committed snapshot at `block`: every log of the vault from its deploy block to N, as loadLedger takes them.
 * Throws rather than return a snapshot with a hole in it.
 */
export async function takeSnapshot(opts: SnapshotOptions): Promise<DecisionsSnapshot> {
  const previous = opts.previous === undefined ? null : await readSnapshot(opts.previous, opts.vault);
  const { floor, block, blockHash, logs } = await takeLogs(opts, opts.vault, previous, "the vault");
  return { v: 1, chainId: BASE_CHAIN_ID, vault: getAddress(opts.vault), floor, block, blockHash, logs };
}

/**
 * The committed Brief snapshot at `block`: every log of the inbox from its deploy block to N, as readBriefs takes them,
 * taken and built on as takeSnapshot takes the vault's. With no brief sent its `logs` is empty. Throws rather than
 * return a snapshot with a hole in it.
 */
export async function takeBriefsSnapshot(opts: BriefsSnapshotOptions): Promise<BriefsSnapshot> {
  const previous = opts.previous === undefined ? null : await readBriefsSnapshot(opts.previous, opts.inbox);
  const { floor, block, blockHash, logs } = await takeLogs(opts, opts.inbox, previous, "the inbox");
  return { v: 1, chainId: BASE_CHAIN_ID, inbox: getAddress(opts.inbox), floor, block, blockHash, logs };
}

/** Every log of `address` from its deploy block to N, building on `previous` once Base confirms it. */
async function takeLogs(
  opts: Omit<SnapshotOptions, "vault" | "previous">,
  address: Address,
  previous: LogSnapshot | null,
  what: string,
): Promise<Pick<LogSnapshot, "floor" | "block" | "blockHash" | "logs">> {
  const { client, block } = opts;
  const n = block.number;
  // Unlike the page, the deploy block is not guessed when its receipt cannot be read: the scan would be far longer.
  const floor = opts.deployTx ? (await client.getTransactionReceipt({ hash: opts.deployTx })).blockNumber : SCAN_FLOOR_BLOCK;
  const reads: Reads = { covered: [], logs: new Map(), blockTimes: {}, gasUsed: {}, txs: new Map() };
  const gas = previous && BigInt(previous.block) <= n ? await confirmSnapshot(client, address, previous, what) : null;
  if (previous && gas) seedSnapshot(reads, previous, gas);

  const total = n - floor + 1n;
  const progress = () => {
    const s = scanState(floor, n, reads.covered, null);
    opts.onProgress?.(total - s.gaps.reduce((sum, g) => sum + (g.to - g.from + 1n), 0n), total);
  };
  await scanGaps(client, address, floor, n, reads, { span: opts.span, minSpan: opts.minSpan, concurrency: opts.concurrency, signal: opts.signal, onChunk: progress });
  const { gaps } = scanState(floor, n, reads.covered, null);
  if (gaps.length > 0) {
    throw new Error(`${gaps.map((g) => `blocks ${g.from} to ${g.to}`).join(", ")} could not be read; no snapshot written`);
  }

  const logs = [...reads.logs.values()].filter((l) => BigInt(l.blockNumber) >= floor && BigInt(l.blockNumber) <= n).sort(byBlock);
  return { floor: floor.toString(), block: n.toString(), blockHash: block.hash, logs };
}

async function deployBlock(client: LedgerClient, deployTx: Hash | null): Promise<bigint> {
  if (!deployTx) return SCAN_FLOOR_BLOCK;
  try {
    return (await client.getTransactionReceipt({ hash: deployTx })).blockNumber;
  } catch {
    return SCAN_FLOOR_BLOCK;
  }
}

/**
 * The largest contiguous range read, cut to CACHE_SAFETY_BLOCKS below the head so a reorg near the tip is reread, and
 * tagged with the snapshotId of the file whose logs it took, if any.
 */
function cacheEntry(vault: Address, head: bigint, reads: Readonly<Reads>, snapshot: Hash | undefined): LedgerCache | null {
  const { covered, logs, blockTimes, gasUsed } = reads;
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
    ...(snapshot ? { snapshot } : {}),
  };
}
