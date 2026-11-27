import { getAddress, keccak256, stringToHex, type Address, type Hash } from "viem";
import { z } from "zod";
import { CACHE_SAFETY_BLOCKS, type CachedLog } from "./cache";
import { BASE_CHAIN_ID } from "./config";

/**
 * Where the page fetches the committed snapshot: content/generated/decisions-snapshot.json, written by
 * `npm run snapshot` and served by app/data/decisions-snapshot.json/route.ts (`null` while the file does not exist).
 */
export const SNAPSHOT_URL = "/data/decisions-snapshot.json";

/**
 * Where /ask and /proof fetch the committed Brief snapshot: content/generated/briefs-snapshot.json, written by the same
 * `npm run snapshot` at the same block and served by app/data/briefs-snapshot.json/route.ts (`null` while there is none).
 */
export const BRIEFS_SNAPSHOT_URL = "/data/briefs-snapshot.json";

/**
 * The newest blocks of a snapshot that a load reads again instead of taking from the file: the margin the browser
 * cache keeps below the head (CACHE_SAFETY_BLOCKS), so a row the chain no longer has there is dropped.
 */
export const SNAPSHOT_REORG_WINDOW = CACHE_SAFETY_BLOCKS;

/** Where npm run snapshot reads the vault's logs: a keyless RPC that answers eth_getLogs over LOG_CHUNK blocks. */
export const SNAPSHOT_RPC = "https://base-rpc.publicnode.com";

/**
 * The second keyless RPC npm run snapshot checks a file against before it writes it, as a browser checks it: it
 * refuses eth_getLogs (lib/chain/rpc.ts) but answers block and receipt reads.
 */
export const SNAPSHOT_CHECK_RPC = "https://mainnet.base.org";

/** What every committed log snapshot holds: the logs of one contract in [floor, block], and block N's hash. */
export interface LogSnapshot {
  v: 1;
  chainId: typeof BASE_CHAIN_ID;
  /** The block the scan started at: the contract's deploy block, or SCAN_FLOOR_BLOCK without a deploy tx. */
  floor: string;
  /** N: every log of the contract in [floor, block] is in `logs`. */
  block: string;
  /** The hash Base gave for block N; a load uses the snapshot only while Base still gives it. */
  blockHash: Hash;
  logs: CachedLog[];
}

/**
 * Every log of one vault from its deploy block to block N, as JSON holds it. Block numbers are decimal strings, as in
 * the browser cache. It holds no block time, gas or transaction: a load reads those from Base, as for any other row.
 */
export interface DecisionsSnapshot extends LogSnapshot {
  vault: Address;
}

/**
 * Every log of the MaatInbox from its deploy block to block N, as JSON holds it: its Brief logs, the only event it
 * emits. With no brief sent, `logs` is empty and the file still says that blocks floor to N hold none.
 */
export interface BriefsSnapshot extends LogSnapshot {
  inbox: Address;
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimal = z.string().regex(/^\d+$/);
// Any other key in the file is dropped, so nothing but these reaches the page.
const common = {
  v: z.literal(1),
  chainId: z.literal(BASE_CHAIN_ID),
  floor: decimal,
  block: decimal,
  blockHash: hash,
  logs: z.array(z.object({ blockNumber: decimal, logIndex: z.number().int().nonnegative(), transactionHash: hash, topics: z.array(hex), data: hex })),
};
const schema = z.object({ ...common, vault: address });
const briefsSchema = z.object({ ...common, inbox: address });

/** True when the floor is at most N and every log lies in [floor, N]. */
function inRange(s: { floor: string; block: string; logs: readonly { blockNumber: string }[] }): boolean {
  const floor = BigInt(s.floor);
  const block = BigInt(s.block);
  return floor <= block && s.logs.every((l) => BigInt(l.blockNumber) >= floor && BigInt(l.blockNumber) <= block);
}

/**
 * The snapshot in `raw` when it is one of `vault` on Base mainnet whose logs all lie in [floor, block], or null: a
 * load with no snapshot, or a bad one, scans the whole range.
 */
export function parseSnapshot(raw: unknown, vault: Address): DecisionsSnapshot | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  if (s.vault.toLowerCase() !== vault.toLowerCase() || !inRange(s)) return null;
  return { ...s, vault: getAddress(s.vault), blockHash: s.blockHash as Hash, logs: s.logs as CachedLog[] };
}

/**
 * The Brief snapshot in `raw` when it is one of `inbox` on Base mainnet whose logs all lie in [floor, block], or null:
 * a read with no snapshot, or a bad one, scans from the inbox's deploy block.
 */
export function parseBriefsSnapshot(raw: unknown, inbox: Address): BriefsSnapshot | null {
  const parsed = briefsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  if (s.inbox.toLowerCase() !== inbox.toLowerCase() || !inRange(s)) return null;
  return { ...s, inbox: getAddress(s.inbox), blockHash: s.blockHash as Hash, logs: s.logs as CachedLog[] };
}

/**
 * What a browser cache entry records of the snapshot it took logs from: a hash of the file's range, N's hash and every
 * log, so a file that is replaced, even at the same block, or removed no longer matches it.
 */
export function snapshotId(s: DecisionsSnapshot): Hash {
  return keccak256(stringToHex(JSON.stringify([s.vault.toLowerCase(), s.floor, s.block, s.blockHash.toLowerCase(), s.logs])));
}

/** The snapshot the site serves at `url` (SNAPSHOT_URL by default), as parsed JSON, or null when it cannot be read. Never throws. */
export async function fetchSnapshotJson(fetchImpl: typeof fetch = (...a) => fetch(...a), url: string = SNAPSHOT_URL): Promise<unknown> {
  try {
    const res = await fetchImpl(url, { cache: "no-cache" });
    return res.ok ? ((await res.json()) as unknown) : null;
  } catch {
    return null;
  }
}

/** The Brief snapshot the site serves at BRIEFS_SNAPSHOT_URL, as parsed JSON, or null when it cannot be read. Never throws. */
export function fetchBriefsSnapshotJson(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<unknown> {
  return fetchSnapshotJson(fetchImpl, BRIEFS_SNAPSHOT_URL);
}
