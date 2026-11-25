// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/data/decisions-snapshot.json/route";
import { CACHE_SAFETY_BLOCKS, memoryStorage, saveCache } from "@/lib/chain/cache";
import { checkSnapshot, loadLedger, takeSnapshot } from "@/lib/chain/load";
import type { RationaleSource } from "@/lib/chain/rationale";
import { DEFAULT_RPCS, scansLogs } from "@/lib/chain/rpc";
import {
  fetchSnapshotJson,
  parseSnapshot,
  SNAPSHOT_CHECK_RPC,
  SNAPSHOT_REORG_WINDOW,
  SNAPSHOT_RPC,
  SNAPSHOT_URL,
  type DecisionsSnapshot,
} from "@/lib/chain/snapshot";
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

  it("reads N's hash and the receipt of each transaction the file names below the window once, and no logs there", async () => {
    const { client, result } = load(snapshotChain(), { snapshot: fixture });
    await result;
    expect(client.blockCalls.filter((b) => b === SNAP_BLOCK)).toHaveLength(1);
    for (const n of [1, 2]) expect(client.receiptCalls.filter((h) => h === hash32(n))).toHaveLength(1);
    expect(client.logCalls.every((c) => c.from >= SNAP_BLOCK - W)).toBe(true);
  });

  it("takes only logs from the file: each Decision's block time, gas and transaction are read from Base", async () => {
    // A file that also carries a time, a gas and a transaction for Decision 1, none of them Base's.
    const snap = {
      ...fixtureCopy(),
      blockTimes: { [String(SNAP_DEPLOY + 5n)]: 1 },
      gasUsed: { [hash32(1)]: "1" },
      txs: { [hash32(1)]: { from: OTHER_VAULT, to: FAKE_VAULT, input: "0xdeadbeef" } },
    };
    const s = await load(snapshotChain(), { snapshot: snap }).result;
    const full = await load(snapshotChain()).result;
    expect(s.scan.fromSnapshot?.block).toBe(SNAP_BLOCK);
    expect(s.decisions).toEqual(full.decisions);
    expect(s.txs).toEqual(full.txs);
    expect(s.trails).toEqual(full.trails);
  });

  it("drops a row inside the window that the chain no longer has, and keeps the one it still has", async () => {
    const snap = fixtureCopy();
    // Decision 9 was in the file at N - 20, then reorged out; Decision 3 at N - 10 is still on the chain.
    snap.logs.push(decisionLog(9, SNAP_BLOCK - 20n));
    const s = await load(snapshotChain(), { snapshot: snap }).result;
    expect(s.decisions.map((d) => d.txHash)).toEqual([hash32(4), hash32(3), hash32(2), hash32(1)]);
    expect(s.events.some((e) => e.txHash === hash32(9))).toBe(false);
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

  it("starts from the snapshot when the browser cache covers it but ends above this RPC's head", async () => {
    // A cache from an RPC that was ahead: this RPC's head is below its end, so the load cannot use it.
    const storage = memoryStorage();
    saveCache({ v: 1, vault: FAKE_VAULT, from: String(SNAP_DEPLOY), to: String(SNAP_HEAD - CACHE_SAFETY_BLOCKS), logs: [], blockTimes: {}, gasUsed: {} }, storage);
    const { client, result } = load(snapshotChain({ head: SNAP_HEAD - 1_000n }), { storage, snapshot: fixture });
    const s = await result;
    expect(s.scan.fromSnapshot?.block).toBe(SNAP_BLOCK);
    expect(lowest(client.logCalls)).toBe(SNAP_BLOCK - W);
    expect(s.decisions.map((d) => d.txHash)).toEqual([hash32(3), hash32(2), hash32(1)]);
  });
});

/** The fixture with a Decision below the window that the chain does not have: Base has no receipt for its transaction. */
const invented = () => {
  const snap = fixtureCopy();
  snap.logs.splice(1, 0, decisionLog(9, SNAP_DEPLOY + 1_000n));
  return snap;
};

describe("loadLedger checks each log it takes from the file against Base", () => {
  const changed: [string, () => DecisionsSnapshot, () => FakeChain][] = [
    ["a Decision Base does not have", invented, () => snapshotChain()],
    [
      "a log whose data differs from its receipt's (another amount)",
      () => {
        const snap = fixtureCopy();
        snap.logs[1] = decisionLog(2, SNAP_DEPLOY + 60_000n, { reason: "MARKET_CLOSED", amount: 99_000_000n });
        return snap;
      },
      () => snapshotChain(),
    ],
    [
      "a log whose topics differ from its receipt's (another intent)",
      () => {
        const snap = fixtureCopy();
        snap.logs[1]!.topics[1] = hash32(1999);
        return snap;
      },
      () => snapshotChain(),
    ],
    [
      "a log in another block than its receipt",
      () => {
        const snap = fixtureCopy();
        snap.logs[0]!.blockNumber = String(SNAP_DEPLOY + 6n);
        return snap;
      },
      () => snapshotChain(),
    ],
    [
      "a log at an index its receipt has no log at",
      () => {
        const snap = fixtureCopy();
        snap.logs[0]!.logIndex = 1;
        return snap;
      },
      () => snapshotChain(),
    ],
    ["a receipt that cannot be read", fixtureCopy, () => snapshotChain({ failReceipts: [hash32(2)] })],
  ];

  it.each(changed)("drops the whole file for %s, and scans from the deploy block", async (_, snapshot, chain) => {
    const full = await load(chain()).result;
    const { client, result } = load(chain(), { snapshot: snapshot() });
    const s = await result;
    expect(s.scan.fromSnapshot).toBeNull();
    expect(lowest(client.logCalls)).toBe(SNAP_DEPLOY);
    expect(s.events.some((e) => e.txHash === hash32(9))).toBe(false);
    expect(s.decisions).toEqual(full.decisions);
  });

  it("never shows a row the file invented, not even before the check, and keeps none in the browser cache", async () => {
    const storage = memoryStorage();
    const seen: string[][] = [];
    await load(snapshotChain(), { storage, snapshot: invented(), onProgress: (p) => seen.push(p.decisions.map((d) => d.txHash)) }).result;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.flat()).not.toContain(hash32(9));
    const again = await load(snapshotChain(), { storage, snapshot: null }).result;
    expect(again.events.some((e) => e.txHash === hash32(9))).toBe(false);
  });
});

describe("the browser cache of a load that started from a snapshot", () => {
  /** The fixture without Decision 2: Base cannot show a log the file leaves out, so only another file brings it back. */
  const omitted = () => {
    const snap = fixtureCopy();
    snap.logs.splice(1, 1);
    return snap;
  };
  const rows = (s: Awaited<ReturnType<typeof loadLedger>>) => s.decisions.map((d) => d.txHash);

  it("is kept by a refresh, which passes no snapshot, and while the site serves the same file", async () => {
    const storage = memoryStorage();
    expect(rows(await load(snapshotChain(), { storage, snapshot: omitted() }).result)).toEqual([hash32(4), hash32(3), hash32(1)]);
    const refresh = load(snapshotChain(), { storage });
    expect(rows(await refresh.result)).toEqual([hash32(4), hash32(3), hash32(1)]);
    expect(lowest(refresh.client.logCalls)).toBeGreaterThan(SNAP_HEAD - CACHE_SAFETY_BLOCKS - 1n);
    const same = load(snapshotChain(), { storage, snapshot: omitted() });
    expect(rows(await same.result)).toEqual([hash32(4), hash32(3), hash32(1)]);
    expect(same.client.blockCalls).not.toContain(SNAP_BLOCK);
    expect(lowest(same.client.logCalls)).toBeGreaterThan(SNAP_HEAD - CACHE_SAFETY_BLOCKS - 1n);
  });

  it("is dropped once the site serves another file, so the row the old one left out comes back", async () => {
    const storage = memoryStorage();
    await load(snapshotChain(), { storage, snapshot: omitted() }).result;
    const fixed = load(snapshotChain(), { storage, snapshot: fixture });
    const s = await fixed.result;
    expect(rows(s)).toEqual([hash32(4), hash32(3), hash32(2), hash32(1)]);
    expect(s.scan.fromSnapshot?.block).toBe(SNAP_BLOCK);
    expect(lowest(fixed.client.logCalls)).toBe(SNAP_BLOCK - W);
  });

  it("is dropped once the site serves no file, and the load scans from the deploy block", async () => {
    const storage = memoryStorage();
    await load(snapshotChain(), { storage, snapshot: omitted() }).result;
    const none = load(snapshotChain(), { storage, snapshot: null });
    expect(rows(await none.result)).toEqual([hash32(4), hash32(3), hash32(2), hash32(1)]);
    expect(lowest(none.client.logCalls)).toBe(SNAP_DEPLOY);
  });
});

describe("checkSnapshot", () => {
  it("passes a snapshot whose block hash and every log Base gives, reading each receipt", async () => {
    const client = fakeLedgerClient(snapshotChain());
    expect(await checkSnapshot(client, FAKE_VAULT, fixture)).toEqual({ ok: true });
    expect(client.blockCalls).toEqual([SNAP_BLOCK]);
    expect([...new Set(client.receiptCalls)].sort()).toEqual([hash32(1), hash32(2), hash32(3)]);
  });

  const failing: [string, () => FakeChain, () => unknown, RegExp][] = [
    ["a file of another vault", () => snapshotChain(), () => ({ ...fixture, vault: OTHER_VAULT }), /^not a decisions snapshot of 0x/],
    ["another hash for block N", () => snapshotChain(), () => ({ ...fixture, blockHash: hash32(777) }), /^block 59845280 has another hash on this RPC/],
    ["a block N that cannot be read", () => snapshotChain({ failBlocks: [SNAP_BLOCK] }), () => fixture, /^block 59845280 could not be read: /],
    ["a log Base does not have", () => snapshotChain(), invented, /^the receipt of 0x0{63}9 could not be read: /],
    [
      "a log that differs from its receipt's",
      () => snapshotChain(),
      () => {
        const snap = fixtureCopy();
        snap.logs[2]!.data = snap.logs[1]!.data;
        return snap;
      },
      /^the receipt of 0x0{63}3 has no log of the vault at index 0 as the file has it in block 59845270$/,
    ],
  ];
  it.each(failing)("says what is wrong with %s", async (_, chain, raw, reason) => {
    const out = await checkSnapshot(fakeLedgerClient(chain()), FAKE_VAULT, raw());
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.reason).toMatch(reason);
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

  it("builds on a previous snapshot only when Base's receipts give its logs", async () => {
    const client = fakeLedgerClient(snapshotChain());
    const next = await takeSnapshot({ client, vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT, previous: invented() });
    expect(lowest(client.logCalls)).toBe(SNAP_DEPLOY);
    expect(next).toEqual(fixture);
  });

  it("holds only the logs, N and its hash: each Decision's time, gas and transaction are left to Base", async () => {
    const written = await takeSnapshot({ client: fakeLedgerClient(snapshotChain()), vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT });
    expect(Object.keys(written).sort()).toEqual(["block", "blockHash", "chainId", "floor", "logs", "v", "vault"]);
  });

  it("scans in chunks of the span it is given, for an RPC that caps eth_getLogs at 200 blocks", async () => {
    const client = fakeLedgerClient(snapshotChain({ maxLogRange: 200n }));
    const s = await takeSnapshot({ client, vault: FAKE_VAULT, deployTx: SNAP_DEPLOY_TX, block: SNAP_AT, span: 200n, minSpan: 200n });
    expect(client.logCalls.every((c) => c.to - c.from + 1n <= 200n)).toBe(true);
    expect(s).toEqual(fixture);
  });
});

describe("npm run snapshot's RPCs", () => {
  it("reads the logs from one the page scans logs with, and checks the file on another", () => {
    expect(DEFAULT_RPCS).toContain(SNAPSHOT_RPC);
    expect(scansLogs(SNAPSHOT_RPC)).toBe(true);
    // mainnet.base.org refuses eth_getLogs, but it answers the block and receipt reads of the check.
    expect(scansLogs("https://mainnet.base.org")).toBe(false);
    expect(SNAPSHOT_CHECK_RPC).toBe("https://mainnet.base.org");
  });

  it("are the ones scripts/decisions-snapshot.ts and the README name", () => {
    const script = readFileSync(join(process.cwd(), "scripts/decisions-snapshot.ts"), "utf8");
    expect(script).toMatch(/rpc: \{ type: "string", default: SNAPSHOT_RPC \}/);
    expect(script).toMatch(/check: \{ type: "string", default: SNAPSHOT_CHECK_RPC \}/);
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain(`\`npm run snapshot\` | reads the vault's logs from Base through \`${SNAPSHOT_RPC}\``);
    expect(readme).not.toMatch(/npm run snapshot[^\n]*`https:\/\/mainnet\.base\.org` unless/);
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
