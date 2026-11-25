import { describe, expect, it } from "vitest";
import { CACHE_SAFETY_BLOCKS, cacheKey, loadCache, saveCache, type LedgerCache } from "@/lib/chain/cache";

const VAULT = "0xb20000000000000000000078ee7ce2fE4908108C";
const entry: LedgerCache = {
  v: 1,
  vault: VAULT,
  from: "59735280",
  to: "59800000",
  logs: [{ blockNumber: "59790000", logIndex: 3, transactionHash: `0x${"aa".repeat(32)}`, topics: [`0x${"11".repeat(32)}`], data: "0x" }],
  blockTimes: { "59790000": 1_764_000_000 },
  gasUsed: { [`0x${"aa".repeat(32)}`]: "111116" },
};

function memoryStorage(): Storage {
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

const throwing: Storage = {
  length: 0,
  clear: () => {
    throw new Error("denied");
  },
  getItem: () => {
    throw new Error("denied");
  },
  key: () => null,
  removeItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new DOMException("quota", "QuotaExceededError");
  },
};

describe("ledger cache", () => {
  it("keys the entry by the lowercased vault", () => {
    expect(cacheKey(VAULT)).toBe("maat:ledger:v1:0xb20000000000000000000078ee7ce2fe4908108c");
  });

  it("round-trips an entry", () => {
    const s = memoryStorage();
    saveCache(entry, s);
    expect(loadCache(VAULT, s)).toEqual(entry);
  });

  it.each([
    ["invalid JSON", "{"],
    ["another version", JSON.stringify({ ...entry, v: 2 })],
    ["another vault", JSON.stringify({ ...entry, vault: "0x0000000000000000000000000000000000000001" })],
    ["a bad shape", JSON.stringify({ ...entry, logs: "nope" })],
  ])("drops %s and removes it", (_name, raw) => {
    const s = memoryStorage();
    s.setItem(cacheKey(VAULT), raw);
    expect(loadCache(VAULT, s)).toBeNull();
    expect(s.getItem(cacheKey(VAULT))).toBeNull();
  });

  it("survives a storage that throws, and no storage at all", () => {
    expect(loadCache(VAULT, throwing)).toBeNull();
    expect(() => saveCache(entry, throwing)).not.toThrow();
    expect(loadCache(VAULT, null)).toBeNull();
    expect(() => saveCache(entry, null)).not.toThrow();
  });

  it("leaves the newest 150 blocks out of the cache (about 30 s of Base blocks)", () => {
    expect(CACHE_SAFETY_BLOCKS).toBe(150n);
  });
});
