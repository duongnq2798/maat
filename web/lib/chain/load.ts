import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, getAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import addresses from "@/content/generated/base-addresses.json";
import { vaultAbi } from "./abi";
import { CACHE_SAFETY_BLOCKS, loadCache, saveCache, type CachedLog, type LedgerCache } from "./cache";
import { SCAN_FLOOR_BLOCK } from "./config";
import { decodeVaultLogs, type VaultEvent } from "./events";
import { summarize, toMainnetDecisions, type MainnetDecision, type Summary } from "./ledger";
import type { RationaleSource } from "./rationale";
import { scanLogs, type BlockRange } from "./scan";
import { readTreasury, type Treasury } from "./treasury";

/** The client calls the ledger makes; a viem PublicClient satisfies it, and tests pass a fake. */
export type LedgerClient = Pick<
  PublicClient,
  "getBlockNumber" | "getBytecode" | "readContract" | "multicall" | "getBlock" | "getLogs" | "getTransactionReceipt"
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

function scanState(floor: bigint, head: bigint, covered: readonly BlockRange[]): ScanState {
  const done = merge(covered.map((r) => ({ from: r.from < floor ? floor : r.from, to: r.to > head ? head : r.to })).filter((r) => r.from <= r.to));
  const gaps: BlockRange[] = [];
  let hi = head;
  for (const r of done) {
    if (r.to < hi) gaps.push({ from: r.to + 1n, to: hi });
    hi = r.from - 1n;
  }
  if (hi >= floor) gaps.push({ from: floor, to: hi });
  const top = done[0];
  return { floor, head, scannedFrom: top && top.to === head ? top.from : null, gaps, done: gaps.length === 0 };
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

/**
 * Reads the vault's treasury and every event since its deploy block from Base, reusing what `storage` remembers. A
 * treasury read failure or a failed log chunk does not throw: the snapshot reports it, so the page shows what it has.
 */
export async function loadLedger(opts: LoadOptions): Promise<LedgerSnapshot> {
  const { client, vault, rationaleSource, signal, onProgress } = opts;
  const storage = opts.storage;
  const now = opts.now ?? Date.now;

  let treasury: Treasury | null = null;
  let treasuryError: string | null = null;
  try {
    treasury = await readTreasury(client, vault);
  } catch (e) {
    treasuryError = errorText(e);
  }
  const head = treasury?.blockNumber ?? (await client.getBlockNumber());
  const floor = opts.floor ?? (await deployBlock(client, opts.deployTx));

  const cache = usableCache(loadCache(vault, storage), head);
  const blockTimes: Record<string, number> = { ...cache?.blockTimes };
  const gasUsed: Record<string, string> = { ...cache?.gasUsed };
  const logs = new Map<string, CachedLog>((cache?.logs ?? []).map((l) => [keyOf(l), l]));
  const covered: BlockRange[] = cache ? [{ from: BigInt(cache.from), to: BigInt(cache.to) }] : [];
  const usdc = treasury?.usdcAddress ?? USDC;
  const decimals = Object.fromEntries(
    (treasury?.tokens ?? []).flatMap((t) => (t.decimals.ok ? [[t.address.toLowerCase(), t.decimals.value] as const] : [])),
  );
  let rationales = new Map<Hex, string>();

  const snapshot = (): LedgerSnapshot => {
    const events = decodeVaultLogs([...logs.values()]);
    return {
      vault,
      treasury,
      treasuryError,
      events,
      decisions: toMainnetDecisions(events, { blockTimes, gasUsed, decimals, usdc }),
      summary: summarize(events, { blockTimes, usdc, nowSec: Math.floor(now() / 1000) }),
      rationales,
      scan: scanState(floor, head, covered),
      updatedAt: now(),
    };
  };

  const ranges: BlockRange[] = cache
    ? [
        { from: BigInt(cache.to) + 1n, to: head },
        { from: floor, to: BigInt(cache.from) - 1n },
      ]
    : [{ from: floor, to: head }];
  onProgress?.(snapshot());
  for (const range of ranges) {
    if (range.from > range.to) continue;
    await scanLogs<CachedLog>({
      ...range,
      minSpan: MIN_SPAN,
      maxFailed: MAX_FAILED,
      signal,
      getLogs: async (r) =>
        (await client.getLogs({ address: vault, fromBlock: r.from, toBlock: r.to })).flatMap((l) =>
          l.blockNumber === null || l.transactionHash === null || l.logIndex === null
            ? []
            : [{ blockNumber: l.blockNumber.toString(), logIndex: l.logIndex, transactionHash: l.transactionHash, topics: [...l.topics] as Hex[], data: l.data }],
        ),
      onChunk: (chunk) => {
        for (const l of chunk.logs) logs.set(keyOf(l), l);
        covered.push({ from: chunk.from, to: chunk.to });
        onProgress?.(snapshot());
      },
    });
  }

  // Block times and gas for decisions this browser has not seen yet; a failed read leaves the row without it.
  const decisionEvents = decodeVaultLogs([...logs.values()]).filter((e) => e.name === "Decision");
  const blocks = [...new Set(decisionEvents.map((e) => e.blockNumber.toString()))].filter((b) => blockTimes[b] === undefined);
  const txs = [...new Set(decisionEvents.map((e) => e.txHash))].filter((h) => gasUsed[h] === undefined);
  await inBatches(blocks, async (b) => {
    const block = await client.getBlock({ blockNumber: BigInt(b) });
    blockTimes[b] = Number(block.timestamp);
  });
  await inBatches(txs, async (h) => {
    const receipt = await client.getTransactionReceipt({ hash: h });
    gasUsed[h] = receipt.gasUsed.toString();
  });
  if (signal?.aborted) throw new DOMException("The ledger load was aborted.", "AbortError");

  try {
    rationales = await rationaleSource.lookup(decisionEvents.map((e) => e.intentId));
  } catch {
    rationales = new Map();
  }

  const result = snapshot();
  const entry = cacheEntry(vault, head, covered, logs, blockTimes, gasUsed);
  if (entry) saveCache(entry, storage);
  return result;
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
