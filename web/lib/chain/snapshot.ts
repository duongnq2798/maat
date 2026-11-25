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

/**
 * Every log of one vault from its deploy block to block N, as JSON holds it. Block numbers are decimal strings, as in
 * the browser cache. It holds no block time, gas or transaction: a load reads those from Base, as for any other row.
 */
export interface DecisionsSnapshot {
  v: 1;
  chainId: typeof BASE_CHAIN_ID;
  vault: Address;
  /** The block the scan started at: the vault's deploy block, or SCAN_FLOOR_BLOCK without a deploy tx. */
  floor: string;
  /** N: every log of the vault in [floor, block] is in `logs`. */
  block: string;
  /** The hash Base gave for block N; a load uses the snapshot only while Base still gives it. */
  blockHash: Hash;
  logs: CachedLog[];
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimal = z.string().regex(/^\d+$/);
// Any other key in the file is dropped, so nothing but these reaches the page.
const schema = z.object({
  v: z.literal(1),
  chainId: z.literal(BASE_CHAIN_ID),
  vault: address,
  floor: decimal,
  block: decimal,
  blockHash: hash,
  logs: z.array(z.object({ blockNumber: decimal, logIndex: z.number().int().nonnegative(), transactionHash: hash, topics: z.array(hex), data: hex })),
});

/**
 * The snapshot in `raw` when it is one of `vault` on Base mainnet whose logs all lie in [floor, block], or null: a
 * load with no snapshot, or a bad one, scans the whole range.
 */
export function parseSnapshot(raw: unknown, vault: Address): DecisionsSnapshot | null {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return null;
  const s = parsed.data;
  if (s.vault.toLowerCase() !== vault.toLowerCase()) return null;
  const floor = BigInt(s.floor);
  const block = BigInt(s.block);
  if (floor > block) return null;
  if (s.logs.some((l) => BigInt(l.blockNumber) < floor || BigInt(l.blockNumber) > block)) return null;
  return { ...s, vault: getAddress(s.vault), blockHash: s.blockHash as Hash, logs: s.logs as CachedLog[] };
}

/**
 * What a browser cache entry records of the snapshot it took logs from: a hash of the file's range, N's hash and every
 * log, so a file that is replaced, even at the same block, or removed no longer matches it.
 */
export function snapshotId(s: DecisionsSnapshot): Hash {
  return keccak256(stringToHex(JSON.stringify([s.vault.toLowerCase(), s.floor, s.block, s.blockHash.toLowerCase(), s.logs])));
}

/** The snapshot the site serves at SNAPSHOT_URL, as parsed JSON, or null when it cannot be read. Never throws. */
export async function fetchSnapshotJson(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<unknown> {
  try {
    const res = await fetchImpl(SNAPSHOT_URL, { cache: "no-cache" });
    return res.ok ? ((await res.json()) as unknown) : null;
  } catch {
    return null;
  }
}
