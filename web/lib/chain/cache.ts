import type { Address, Hash, Hex } from "viem";
import { z } from "zod";

/**
 * Blocks below the head that stay out of the cache, so a reorg near the tip is rescanned rather than remembered:
 * 150 Base blocks is about 30 s.
 */
export const CACHE_SAFETY_BLOCKS = 150n;

/** A vault log as JSON can hold it (block numbers as decimal strings). */
export interface CachedLog {
  blockNumber: string;
  logIndex: number;
  transactionHash: Hash;
  topics: Hex[];
  data: Hex;
}

/** What one browser remembers of one vault: a contiguous scanned range and what was found in it. */
export interface LedgerCache {
  v: 1;
  vault: Address;
  from: string;
  to: string;
  logs: CachedLog[];
  /** Block number → unix seconds. */
  blockTimes: Record<string, number>;
  /** Transaction hash → gas used, decimal. */
  gasUsed: Record<string, string>;
  /**
   * snapshotId of the committed snapshot whose logs the range took, if it took any (lib/chain/snapshot.ts). A first
   * read keeps such an entry only while the site serves that same file.
   */
  snapshot?: Hash;
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const decimal = z.string().regex(/^\d+$/);
const schema = z.object({
  v: z.literal(1),
  vault: hex,
  from: decimal,
  to: decimal,
  logs: z.array(z.object({ blockNumber: decimal, logIndex: z.number().int(), transactionHash: hex, topics: z.array(hex), data: hex })),
  blockTimes: z.record(decimal, z.number()),
  gasUsed: z.record(hex, decimal),
  snapshot: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

export function cacheKey(vault: Address): string {
  return `maat:ledger:v1:${vault.toLowerCase()}`;
}

/** The browser's localStorage, or null on the server or when the browser blocks it. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** A Storage that lives as long as the page: the cache between refreshes when localStorage is blocked. */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

/** The cached entry for `vault`, or null. An entry that fails to parse, or belongs elsewhere, is removed. */
export function loadCache(vault: Address, storage: Storage | null = browserStorage()): LedgerCache | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(cacheKey(vault));
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.vault.toLowerCase() === vault.toLowerCase()) return parsed.data as LedgerCache;
  } catch {
    // Unreadable storage or invalid JSON: fall through and drop the entry.
  }
  try {
    storage.removeItem(cacheKey(vault));
  } catch {
    // Storage that refuses even a removal is simply not used.
  }
  return null;
}

/** Stores the entry; a full or blocked storage is ignored, since the page can always rescan. */
export function saveCache(entry: LedgerCache, storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(cacheKey(entry.vault), JSON.stringify(entry));
  } catch {
    // Quota exceeded or storage disabled.
  }
}
