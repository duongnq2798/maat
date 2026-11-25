// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CACHE_SAFETY_BLOCKS, cacheKey, loadCache } from "@/lib/chain/cache";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { loadLedger, verifyVault, VaultCheckError, type LedgerSnapshot } from "@/lib/chain/load";
import type { RationaleSource } from "@/lib/chain/rationale";
import { DEFAULT_RPCS, rpcUrls } from "@/lib/chain/rpc";
import { decisionLog, FAKE_VAULT, fakeLedgerClient, hash32, memoryStorage } from "./helpers/fake-ledger";

const DEPLOY = SCAN_FLOOR_BLOCK + 10_000n;
const HEAD = DEPLOY + 120_000n;
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC
const LOGS = [decisionLog(1, DEPLOY + 5n), decisionLog(2, DEPLOY + 60_000n, { reason: "MARKET_CLOSED", amount: 10_000_000n }), decisionLog(3, HEAD - 10n)];
const TIMES = { [String(DEPLOY + 5n)]: T0, [String(DEPLOY + 60_000n)]: T0 + 3600, [String(HEAD - 10n)]: T0 + 7200, [String(HEAD)]: T0 + 7300 };
const noRationales: RationaleSource = { name: "none", lookup: async () => new Map() };

const chain = (over: Partial<Parameters<typeof fakeLedgerClient>[0]> = {}) =>
  fakeLedgerClient({ head: HEAD, logs: LOGS, times: TIMES, gas: { [hash32(1)]: 758_192n }, deployTx: { hash: hash32(42), block: DEPLOY }, ...over });

describe("rpcUrls", () => {
  it("tries publicnode, then mainnet.base.org", () => {
    expect(rpcUrls({})).toEqual(["https://base-rpc.publicnode.com", "https://mainnet.base.org"]);
    expect(rpcUrls({})).toEqual([...DEFAULT_RPCS]);
  });

  it("puts an https NEXT_PUBLIC_BASE_RPC_URL first and ignores anything else", () => {
    expect(rpcUrls({ NEXT_PUBLIC_BASE_RPC_URL: " https://rpc.example/key " })[0]).toBe("https://rpc.example/key");
    expect(rpcUrls({ NEXT_PUBLIC_BASE_RPC_URL: "http://rpc.example" })).toEqual([...DEFAULT_RPCS]);
    expect(rpcUrls({ NEXT_PUBLIC_BASE_RPC_URL: "https://mainnet.base.org" })).toEqual(["https://mainnet.base.org", "https://base-rpc.publicnode.com"]);
  });
});

describe("verifyVault", () => {
  it("accepts a contract whose TIMELOCK is 24 h", async () => {
    await expect(verifyVault(chain(), FAKE_VAULT)).resolves.toBeUndefined();
  });

  it("rejects an address with no code, or a contract that is not a MandateVault", async () => {
    await expect(verifyVault(chain({ bytecode: "0x" }), FAKE_VAULT)).rejects.toThrow(/no contract/);
    await expect(verifyVault(chain({ timelock: 3600n }), FAKE_VAULT)).rejects.toBeInstanceOf(VaultCheckError);
  });
});

const load = (client = chain(), storage: Storage | null = memoryStorage(), extra: Partial<Parameters<typeof loadLedger>[0]> = {}) =>
  loadLedger({ client, vault: FAKE_VAULT, deployTx: hash32(42), storage, rationaleSource: noRationales, now: () => (T0 + 7300) * 1000, ...extra });

describe("loadLedger", () => {
  it("reads every decision since the deploy block, newest first, with its time and gas", async () => {
    const s = await load();
    expect(s.decisions.map((d) => d.intentId)).toEqual([hash32(1003), hash32(1002), hash32(1001)]);
    expect(s.decisions[2]).toMatchObject({ timeLabel: "Thu 26 Nov 10:30", gasUsed: 758_192n, amountLabel: "$20.00" });
    expect(s.scan).toEqual({ floor: DEPLOY, head: HEAD, scannedFrom: DEPLOY, gaps: [], done: true, fromSnapshot: null });
    expect(s.summary).toMatchObject({ allowed: 2, refused: 1 });
    expect(s.treasury?.usdc).toEqual({ ok: true, value: 30_000_000n });
  });

  it("scans in chunks of at most 50,000 blocks, newest first, starting at the deploy block", async () => {
    const client = chain();
    await load(client);
    expect(client.logCalls.every((c) => c.to - c.from + 1n <= 50_000n)).toBe(true);
    expect(client.logCalls[0]!.to).toBe(HEAD);
    expect(client.logCalls.reduce((m, c) => (c.from < m ? c.from : m), HEAD)).toBe(DEPLOY);
  });

  it("starts at the floor block when the deployments table has no deploy tx", async () => {
    const client = chain();
    await load(client, memoryStorage(), { deployTx: null });
    expect(client.logCalls.reduce((m, c) => (c.from < m ? c.from : m), HEAD)).toBe(SCAN_FLOOR_BLOCK);
  });

  it("caches up to 150 blocks below the head, and the next load scans only what is newer", async () => {
    const storage = memoryStorage();
    await load(chain(), storage);
    const cached = loadCache(FAKE_VAULT, storage)!;
    expect(cached.from).toBe(String(DEPLOY));
    expect(cached.to).toBe(String(HEAD - CACHE_SAFETY_BLOCKS));
    expect(cached.logs).toHaveLength(2);

    const later = chain({ head: HEAD + 1000n, logs: [...LOGS, decisionLog(4, HEAD + 500n)], times: { ...TIMES, [String(HEAD + 500n)]: T0 + 7400 } });
    const s = await load(later, storage);
    expect(later.logCalls.every((c) => c.from > HEAD - CACHE_SAFETY_BLOCKS)).toBe(true);
    expect(s.decisions.map((d) => d.intentId)).toEqual([hash32(1004), hash32(1003), hash32(1002), hash32(1001)]);
    expect(s.scan.done).toBe(true);
  });

  it("still works when the browser has no storage", async () => {
    expect((await load(chain(), null)).decisions).toHaveLength(3);
  });

  it("reports the unscanned blocks when the RPC refuses every log request, and keeps the treasury", async () => {
    const s = await load(chain({ failLogs: true }));
    expect(s.decisions).toEqual([]);
    expect(s.scan).toMatchObject({ scannedFrom: null, gaps: [{ from: DEPLOY, to: HEAD }], done: false });
    expect(s.treasury).not.toBeNull();
  });

  it("still lists decisions when the treasury cannot be read", async () => {
    const s = await load(chain({ failTreasury: true }));
    expect(s.treasury).toBeNull();
    expect(s.treasuryError).toMatch(/multicall failed/);
    expect(s.decisions).toHaveLength(3);
  });

  it("looks up rationales for the decisions it found", async () => {
    const asked: string[][] = [];
    const src: RationaleSource = {
      name: "test",
      lookup: async (ids) => {
        asked.push([...ids]);
        return new Map([[ids[0]!, "text"]]);
      },
    };
    const s = await load(chain(), memoryStorage(), { rationaleSource: src });
    expect(asked.at(-1)).toHaveLength(3);
    expect(s.rationales.size).toBe(1);
  });

  it("reports progress before it finishes", async () => {
    const seen: LedgerSnapshot[] = [];
    await load(chain(), memoryStorage(), { onProgress: (p) => seen.push(p) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]!.scan.done).toBe(false);
  });

  it("marks rationales as still being checked until it has looked them up", async () => {
    const seen: LedgerSnapshot[] = [];
    const s = await load(chain(), memoryStorage(), { onProgress: (p) => seen.push(p) });
    expect(seen.map((p) => p.rationaleState)).toEqual(seen.map(() => "checking"));
    expect(s.rationaleState).toBe("read");
  });

  it("says the rationales could not be read when the lookup fails, not that none were exported", async () => {
    const failing: RationaleSource = { name: "down", lookup: async () => Promise.reject(new Error("404")) };
    const s = await load(chain(), memoryStorage(), { rationaleSource: failing });
    expect(s.rationaleState).toBe("unavailable");
    expect(s.rationales.size).toBe(0);
  });

  it("drops a cache that claims blocks above the head", async () => {
    const storage = memoryStorage();
    storage.setItem(
      cacheKey(FAKE_VAULT),
      JSON.stringify({ v: 1, vault: FAKE_VAULT, from: String(DEPLOY), to: String(HEAD + 10_000n), logs: [], blockTimes: {}, gasUsed: {} }),
    );
    const s = await load(chain(), storage);
    expect(s.decisions).toHaveLength(3);
  });
});
