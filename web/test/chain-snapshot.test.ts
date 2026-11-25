// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/data/decisions-snapshot.json/route";
import { CACHE_SAFETY_BLOCKS, memoryStorage, saveCache } from "@/lib/chain/cache";
import { loadLedger, takeSnapshot } from "@/lib/chain/load";
import type { RationaleSource } from "@/lib/chain/rationale";
import { fetchSnapshotJson, parseSnapshot, SNAPSHOT_REORG_WINDOW, SNAPSHOT_URL, type DecisionsSnapshot } from "@/lib/chain/snapshot";
import fixture from "./fixtures/decisions-snapshot.json";
import { decisionLog, FAKE_VAULT, fakeBlockHash, fakeLedgerClient, hash32, type FakeChain } from "./helpers/fake-ledger";
import { SNAP_AT, SNAP_BLOCK, SNAP_DEPLOY, SNAP_DEPLOY_TX, SNAP_HEAD, snapshotChain } from "./helpers/snapshot-chain";

const W = SNAPSHOT_REORG_WINDOW;
const NOW_MS = 1_795_707_000_000 + 6 * 3600_000;
const noRationales: RationaleSource = { name: "none", lookup: async () => new Map() };
const OTHER_VAULT = "0x00000000000000000000000000000000000Bb002";

const load = (chain: FakeChain = snapshotChain(), extra: Partial<Parameters<typeof loadLedger>[0]> = {}) => {
  const client = fakeLedgerClient(chain);
  const result = loadLedger({
    client,
    vault: FAKE_VAULT,
    deployTx: SNAP_DEPLOY_TX,
    storage: memoryStorage(),
    rationaleSource: noRationales,
    now: () => NOW_MS,
    ...extra,
  });
  return { client, result };
};

const lowest = (calls: readonly { from: bigint }[]) => calls.reduce((m, c) => (c.from < m ? c.from : m), SNAP_HEAD);
const highest = (calls: readonly { to: bigint }[]) => calls.reduce((m, c) => (c.to > m ? c.to : m), 0n);
const fixtureCopy = () => structuredClone(fixture) as unknown as DecisionsSnapshot;

describe("the fixture snapshot", () => {
  it("is what takeSnapshot writes for the fixture chain at block N", async () => {
    // To write it again: JSON.stringify(<this snapshot>, null, 2) + "\n" into test/fixtures/decisions-snapshot.json.
    const written = await takeSnapshot({ client: fakeLedgerClient(snapshotChain()), vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT });
    expect(written).toEqual(fixture);
    expect(written).toMatchObject({ block: String(SNAP_BLOCK), floor: String(SNAP_DEPLOY), blockHash: fakeBlockHash(SNAP_BLOCK) });
    expect(written.logs.map((l) => l.transactionHash)).toEqual([hash32(1), hash32(2), hash32(3)]);
  });
});

describe("parseSnapshot", () => {
  it("accepts the snapshot of the vault it is asked about", () => {
    expect(parseSnapshot(fixture, FAKE_VAULT)).toMatchObject({ block: String(SNAP_BLOCK), vault: getAddress(FAKE_VAULT) });
    expect(parseSnapshot(fixture, FAKE_VAULT.toLowerCase() as typeof FAKE_VAULT)).not.toBeNull();
  });

  const bad: [string, unknown][] = [
    ["null", null],
    ["a string", "{"],
    ["another version", { ...fixture, v: 2 }],
    ["another chain", { ...fixture, chainId: 1 }],
    ["another vault", { ...fixture, vault: OTHER_VAULT }],
    ["a floor above its block", { ...fixture, floor: String(SNAP_BLOCK + 1n) }],
    ["a log above its block", { ...fixture, logs: [...fixture.logs, decisionLog(9, SNAP_BLOCK + 1n)] }],
    ["a log below its floor", { ...fixture, logs: [...fixture.logs, decisionLog(9, SNAP_DEPLOY - 1n)] }],
    ["a short block hash", { ...fixture, blockHash: "0x1234" }],
    ["a block number that is not decimal", { ...fixture, block: "0x10" }],
    ["no logs list", { ...fixture, logs: undefined }],
  ];
  it.each(bad)("rejects %s", (_, raw) => {
    expect(parseSnapshot(raw, FAKE_VAULT)).toBeNull();
  });
});

describe("loadLedger from a snapshot", () => {
  it("scans only from N minus the reorg window to the head on a cold load", async () => {
    const { client, result } = load(snapshotChain(), { snapshot: fixture });
    const s = await result;
    expect(client.logCalls.length).toBeGreaterThan(0);
    expect(lowest(client.logCalls)).toBe(SNAP_BLOCK - W);
    expect(highest(client.logCalls)).toBe(SNAP_HEAD);
    expect(s.scan).toEqual({
      floor: SNAP_DEPLOY,
      head: SNAP_HEAD,
      scannedFrom: SNAP_DEPLOY,
      gaps: [],
      done: true,
      fromSnapshot: { block: SNAP_BLOCK, blockHash: fakeBlockHash(SNAP_BLOCK) },
    });
    expect(s.decisions.map((d) => d.txHash)).toEqual([hash32(4), hash32(3), hash32(2), hash32(1)]);
  });

  it("checks the block hash once and reads nothing else for the Decisions below the window", async () => {
    // A chain that would fail every read for Decisions 1 and 2: the file's times, gas and transactions stand in.
    const chain = snapshotChain();
    const stripped = snapshotChain({
      times: Object.fromEntries(Object.entries(chain.times!).filter(([b]) => BigInt(b) >= SNAP_BLOCK - W)),
      gas: { [hash32(3)]: chain.gas![hash32(3)]!, [hash32(4)]: chain.gas![hash32(4)]! },
      txs: { [hash32(3)]: chain.txs![hash32(3)]!, [hash32(4)]: chain.txs![hash32(4)]! },
    });
    const { client, result } = load(stripped, { snapshot: fixture });
    const s = await result;
    const full = await load(chain).result;
    expect(s.decisions).toEqual(full.decisions);
    expect(s.txs).toEqual(full.txs);
    expect(client.blockCalls.filter((b) => b < SNAP_BLOCK - W)).toEqual([]);
    expect(client.blockCalls.filter((b) => b === SNAP_BLOCK)).toHaveLength(1);
  });

  it("drops a row inside the window that the chain no longer has, and keeps the one it still has", async () => {
    const snap = fixtureCopy();
    // Decision 9 was in the file at N - 20, then reorged out; Decision 3 at N - 10 is still on the chain.
    snap.logs.push(decisionLog(9, SNAP_BLOCK - 20n));
    snap.blockTimes[String(SNAP_BLOCK - 20n)] = 1_795_717_000;
    snap.gasUsed[hash32(9)] = "111116";
    const s = await load(snapshotChain(), { snapshot: snap }).result;
    expect(s.decisions.map((d) => d.txHash)).toEqual([hash32(4), hash32(3), hash32(2), hash32(1)]);
    expect(s.events.some((e) => e.txHash === hash32(9))).toBe(false);
  });

  it("drops the file's time and gas for a window row the chain moved, and reads them again", async () => {
    const snap = fixtureCopy();
    snap.blockTimes[String(SNAP_BLOCK - 10n)] = 1;
    snap.gasUsed[hash32(3)] = "1";
    const s = await load(snapshotChain(), { snapshot: snap }).result;
    const full = await load(snapshotChain()).result;
    expect(s.decisions).toEqual(full.decisions);
  });

  it("gives the same ledger as a full scan of the same chain", async () => {
    const full = await load(snapshotChain()).result;
    const fromSnap = await load(snapshotChain(), { snapshot: fixture }).result;
    expect(full.scan.fromSnapshot).toBeNull();
    expect({ ...fromSnap, scan: { ...fromSnap.scan, fromSnapshot: null } }).toEqual(full);
  });

  it("accepts the snapshot as a promise, as the page passes its fetch", async () => {
    const { client, result } = load(snapshotChain(), { snapshot: Promise.resolve(fixture) });
    expect((await result).scan.fromSnapshot?.block).toBe(SNAP_BLOCK);
    expect(lowest(client.logCalls)).toBe(SNAP_BLOCK - W);
  });

  const unusable: [string, () => FakeChain, () => unknown][] = [
    ["no snapshot", () => snapshotChain(), () => undefined],
    ["a missing file (null)", () => snapshotChain(), () => null],
    ["a fetch that failed", () => snapshotChain(), () => Promise.reject(new Error("offline"))],
    ["a corrupt file", () => snapshotChain(), () => ({ v: 1, logs: "nope" })],
    ["another vault's snapshot", () => snapshotChain(), () => ({ ...fixture, vault: OTHER_VAULT })],
    ["a block hash Base does not give", () => snapshotChain(), () => ({ ...fixture, blockHash: hash32(777) })],
    ["a block Base cannot read", () => snapshotChain({ failBlocks: [SNAP_BLOCK] }), () => fixture],
    ["a block above the head", () => snapshotChain({ head: SNAP_BLOCK - 1n }), () => fixture],
  ];
  it.each(unusable)("falls back to the full scan with %s", async (_, chain, snapshot) => {
    const full = await load(chain()).result;
    const { client, result } = load(chain(), { snapshot: snapshot() });
    const s = await result;
    expect(lowest(client.logCalls)).toBe(SNAP_DEPLOY);
    expect(s.scan.fromSnapshot).toBeNull();
    expect(s.decisions).toEqual(full.decisions);
    expect(s.scan.done).toBe(true);
  });

  it("leaves the snapshot alone when the browser cache already covers it", async () => {
    const storage = memoryStorage();
    await load(snapshotChain(), { storage }).result;
    const { client, result } = load(snapshotChain(), { storage, snapshot: fixture });
    const s = await result;
    expect(client.blockCalls).not.toContain(SNAP_BLOCK);
    expect(s.scan.fromSnapshot).toBeNull();
    expect(lowest(client.logCalls)).toBeGreaterThan(SNAP_HEAD - CACHE_SAFETY_BLOCKS);
  });

  it("joins an older browser cache with the snapshot, so only the window and what follows are read", async () => {
    const storage = memoryStorage();
    saveCache({ v: 1, vault: FAKE_VAULT, from: String(SNAP_DEPLOY), to: String(SNAP_DEPLOY + 1_000n), logs: [decisionLog(1, SNAP_DEPLOY + 5n)], blockTimes: {}, gasUsed: {} }, storage);
    const { client, result } = load(snapshotChain(), { storage, snapshot: fixture });
    const s = await result;
    expect(lowest(client.logCalls)).toBe(SNAP_BLOCK - W);
    expect(s.decisions.map((d) => d.txHash)).toEqual([hash32(4), hash32(3), hash32(2), hash32(1)]);
    expect(s.scan.done).toBe(true);
  });

  it("reports the window as unread when its scan fails, and shows none of the file's rows in it", async () => {
    const s = await load(snapshotChain({ failLogs: true }), { snapshot: fixture }).result;
    expect(s.decisions.map((d) => d.txHash)).toEqual([hash32(2), hash32(1)]);
    expect(s.scan).toMatchObject({ done: false, gaps: [{ from: SNAP_BLOCK - W, to: SNAP_HEAD }], scannedFrom: null });
  });
});

describe("takeSnapshot", () => {
  it("builds on a previous snapshot, scanning only from its block minus the window", async () => {
    const at = { number: SNAP_HEAD - 5n, hash: fakeBlockHash(SNAP_HEAD - 5n) };
    const client = fakeLedgerClient(snapshotChain());
    const next = await takeSnapshot({ client, vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: at, previous: fixture });
    expect(lowest(client.logCalls)).toBe(SNAP_BLOCK - W);
    const fresh = await takeSnapshot({ client: fakeLedgerClient(snapshotChain()), vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: at });
    expect(next).toEqual(fresh);
    expect(next.logs.map((l) => l.transactionHash)).toEqual([hash32(1), hash32(2), hash32(3), hash32(4)]);
  });

  it("starts again from the deploy block when the previous snapshot's hash is not Base's", async () => {
    const client = fakeLedgerClient(snapshotChain());
    await takeSnapshot({ client, vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT, previous: { ...fixture, blockHash: hash32(777) } });
    expect(lowest(client.logCalls)).toBe(SNAP_DEPLOY);
  });

  it("refuses to write a snapshot with a hole in it", async () => {
    await expect(
      takeSnapshot({ client: fakeLedgerClient(snapshotChain({ failLogs: true })), vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT }),
    ).rejects.toThrow(/could not be read/);
  });

  it("refuses to write a snapshot missing a Decision's time, gas or transaction", async () => {
    const chain = snapshotChain();
    delete chain.gas![hash32(2)];
    await expect(takeSnapshot({ client: fakeLedgerClient(chain), vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT })).rejects.toThrow(
      /gas of 1 Decision/,
    );
  });

  it("scans in chunks of the span it is given, for an RPC that caps eth_getLogs at 200 blocks", async () => {
    const client = fakeLedgerClient(snapshotChain({ maxLogRange: 200n }));
    const s = await takeSnapshot({ client, vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT, span: 200n, minSpan: 200n });
    expect(client.logCalls.every((c) => c.to - c.from + 1n <= 200n)).toBe(true);
    expect(s).toEqual(fixture);
  });
});

describe("fetchSnapshotJson", () => {
  it("reads /data/decisions-snapshot.json", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture)));
    expect(await fetchSnapshotJson(fetchImpl as unknown as typeof fetch)).toEqual(fixture);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe(SNAPSHOT_URL);
    expect(SNAPSHOT_URL).toBe("/data/decisions-snapshot.json");
  });

  it("gives null for a missing file, a page that is not JSON or a network error", async () => {
    expect(await fetchSnapshotJson((async () => new Response("no", { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchSnapshotJson((async () => new Response("<html>")) as unknown as typeof fetch)).toBeNull();
    expect(await fetchSnapshotJson((async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch)).toBeNull();
  });
});

describe("/data/decisions-snapshot.json", () => {
  it("serves the committed snapshot as it is, or null while there is none", async () => {
    const file = join(process.cwd(), "content/generated/decisions-snapshot.json");
    const body = await GET().text();
    expect(body).toBe(existsSync(file) ? readFileSync(file, "utf8") : "null\n");
    expect(GET().headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});
