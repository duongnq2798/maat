// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/data/briefs-snapshot.json/route";
import { inboxDeployment, readBriefs } from "@/lib/chain/inbox";
import { checkBriefsSnapshot, takeBriefsSnapshot } from "@/lib/chain/load";
import { BRIEFS_SNAPSHOT_URL, fetchBriefsSnapshotJson, parseBriefsSnapshot, parseSnapshot, SNAPSHOT_REORG_WINDOW, type BriefsSnapshot } from "@/lib/chain/snapshot";
import deployments from "@/content/generated/deployments.json";
import fixture from "./fixtures/briefs-snapshot.json";
import decisionsFixture from "./fixtures/decisions-snapshot.json";
import { fakeBlockHash, fakeLedgerClient, hash32, type FakeChain } from "./helpers/fake-ledger";
import { BRIEFS_AT, BRIEFS_BLOCK, BRIEFS_DEPLOY, BRIEFS_DEPLOY_TX, BRIEFS_HEAD, BRIEFS_INBOX, briefLog, briefsChain } from "./helpers/briefs-chain";

// The committed Brief snapshot (content/generated/briefs-snapshot.json), tested as test/chain-snapshot.test.ts tests the
// decisions snapshot: what npm run snapshot writes, what a read takes from it, and what makes a read drop it.

const W = SNAPSHOT_REORG_WINDOW;
const OTHER_INBOX: Address = "0x00000000000000000000000000000000000B0009";
const ALICE: Address = "0x00000000000000000000000000000000000A11cE";

const read = (chain: FakeChain = briefsChain(), snapshot?: unknown) => {
  const client = fakeLedgerClient(chain);
  return { client, result: readBriefs(client, { inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, snapshot }) };
};
const lowest = (calls: readonly { from: bigint }[]) => calls.reduce((m, c) => (c.from < m ? c.from : m), BRIEFS_HEAD + 1n);
const ids = (r: Awaited<ReturnType<typeof readBriefs>>) => r.briefs.map((b) => b.id);
const fixtureCopy = () => structuredClone(fixture) as unknown as BriefsSnapshot;
/** The fixture with no brief: an inbox nobody has briefed yet still has a snapshot, of no log. */
const empty = () => ({ ...fixtureCopy(), logs: [] });

describe("the fixture Brief snapshot", () => {
  it("is what takeBriefsSnapshot writes for the fixture inbox at block N", async () => {
    // To write it again: JSON.stringify(<this snapshot>, null, 2) + "\n" into test/fixtures/briefs-snapshot.json.
    const written = await takeBriefsSnapshot({ client: fakeLedgerClient(briefsChain()), inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: BRIEFS_AT });
    expect(written).toEqual(fixture);
    expect(written).toMatchObject({ inbox: BRIEFS_INBOX, block: String(BRIEFS_BLOCK), floor: String(BRIEFS_DEPLOY), blockHash: fakeBlockHash(BRIEFS_BLOCK) });
    expect(written.logs.map((l) => l.transactionHash)).toEqual([hash32(9001), hash32(9002), hash32(9003)]);
  });
});

describe("parseBriefsSnapshot", () => {
  it("accepts the snapshot of the inbox it is asked about, in any case", () => {
    expect(parseBriefsSnapshot(fixture, BRIEFS_INBOX)).toMatchObject({ block: String(BRIEFS_BLOCK), inbox: getAddress(BRIEFS_INBOX) });
    expect(parseBriefsSnapshot(fixture, BRIEFS_INBOX.toLowerCase() as Address)).not.toBeNull();
  });

  it("accepts a snapshot of no log, as the file is while nobody has briefed the agent", () => {
    expect(parseBriefsSnapshot(empty(), BRIEFS_INBOX)?.logs).toEqual([]);
  });

  const bad: [string, unknown][] = [
    ["null", null],
    ["a string", "{"],
    ["another version", { ...fixture, v: 2 }],
    ["another chain", { ...fixture, chainId: 1 }],
    ["another inbox", { ...fixture, inbox: OTHER_INBOX }],
    ["a decisions snapshot, which names a vault and no inbox", { ...decisionsFixture, vault: BRIEFS_INBOX }],
    ["a floor above its block", { ...fixture, floor: String(BRIEFS_BLOCK + 1n) }],
    ["a log above its block", { ...fixture, logs: [...fixture.logs, briefLog(9, ALICE, "late", BRIEFS_BLOCK + 1n)] }],
    ["a log below its floor", { ...fixture, logs: [...fixture.logs, briefLog(9, ALICE, "early", BRIEFS_DEPLOY - 1n)] }],
    ["a short block hash", { ...fixture, blockHash: "0x1234" }],
    ["a block number that is not decimal", { ...fixture, block: "0x10" }],
    ["no logs list", { ...fixture, logs: undefined }],
  ];
  it.each(bad)("rejects %s", (_, raw) => {
    expect(parseBriefsSnapshot(raw, BRIEFS_INBOX)).toBeNull();
  });

  it("is never taken for a decisions snapshot, nor a decisions snapshot for it", () => {
    expect(parseSnapshot(fixture, BRIEFS_INBOX)).toBeNull();
  });
});

describe("readBriefs from a Brief snapshot", () => {
  it("scans only from N minus the reorg window to the head on a cold read, and says which blocks the file gave", async () => {
    const { client, result } = read(briefsChain(), fixture);
    const r = await result;
    expect(lowest(client.logCalls)).toBe(BRIEFS_BLOCK - W);
    expect(r.complete).toBe(true);
    expect(r.fromSnapshot).toEqual({ block: BRIEFS_BLOCK, from: BRIEFS_DEPLOY, to: BRIEFS_BLOCK - W - 1n });
    expect(ids(r)).toEqual([1, 2, 3, 4]);
  });

  it("reads N's hash and the receipt of each transaction the file names below the window once, and no logs there", async () => {
    const { client, result } = read(briefsChain(), fixture);
    await result;
    expect(client.blockCalls.filter((b) => b === BRIEFS_BLOCK)).toHaveLength(1);
    for (const id of [1, 2]) expect(client.receiptCalls.filter((h) => h === hash32(9000 + id))).toHaveLength(1);
    // Brief 3 is in the window: the scan finds it, so its receipt is not read.
    expect(client.receiptCalls).not.toContain(hash32(9003));
    expect(client.logCalls.every((c) => c.from >= BRIEFS_BLOCK - W)).toBe(true);
  });

  it("gives the same briefs as a full scan of the same chain", async () => {
    const full = await read().result;
    const fromFile = await read(briefsChain(), fixture).result;
    expect(full.fromSnapshot).toBeNull();
    expect({ ...fromFile, fromSnapshot: null }).toEqual(full);
  });

  it("drops a brief inside the window that the chain no longer has, and keeps the one it still has", async () => {
    const snap = fixtureCopy();
    // Brief 9 was in the file at N - 20, then reorged out; brief 3 at N - 10 is still on the chain.
    snap.logs.push(briefLog(9, ALICE, "reorged out", BRIEFS_BLOCK - 20n));
    expect(ids(await read(briefsChain(), snap).result)).toEqual([1, 2, 3, 4]);
  });

  it("accepts the snapshot as a promise, as the pages pass their fetch", async () => {
    const { client, result } = read(briefsChain(), Promise.resolve(fixture));
    expect((await result).fromSnapshot?.block).toBe(BRIEFS_BLOCK);
    expect(lowest(client.logCalls)).toBe(BRIEFS_BLOCK - W);
  });

  it("works with a snapshot of no log while there is no brief: one block read, no receipt, and only the tail scanned", async () => {
    const quiet = briefsChain({ logs: [], gas: {} });
    const written = await takeBriefsSnapshot({ client: fakeLedgerClient(quiet), inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: BRIEFS_AT });
    expect(written.logs).toEqual([]);
    const { client, result } = read(quiet, written);
    const r = await result;
    expect(r).toMatchObject({ briefs: [], complete: true, fromSnapshot: { block: BRIEFS_BLOCK, from: BRIEFS_DEPLOY, to: BRIEFS_BLOCK - W - 1n } });
    expect(client.blockCalls).toEqual([BRIEFS_BLOCK]);
    // The deploy receipt gives the floor; no brief receipt is read.
    expect(client.receiptCalls).toEqual([BRIEFS_DEPLOY_TX]);
    expect(lowest(client.logCalls)).toBe(BRIEFS_BLOCK - W);
  });

  it("finds a brief sent after a snapshot of no log", async () => {
    const r = await read(briefsChain(), empty()).result;
    // Briefs 1 and 2 are below the window: a file that leaves them out hides them, which is why npm run snapshot checks
    // every file on a second RPC before it writes it. Brief 3 is in the window and brief 4 after N, so the scan finds both.
    expect(ids(r)).toEqual([3, 4]);
    expect(r.complete).toBe(true);
  });

  it("never says complete when a chunk after the snapshot fails, and keeps the briefs the file gave", async () => {
    const r = await read(briefsChain({ failLogs: true }), fixture).result;
    expect(r.complete).toBe(false);
    expect(r.fromSnapshot?.block).toBe(BRIEFS_BLOCK);
    expect(ids(r)).toEqual([1, 2]);
  });

  const unusable: [string, () => FakeChain, () => unknown][] = [
    ["no snapshot", () => briefsChain(), () => undefined],
    ["a missing file (null)", () => briefsChain(), () => null],
    ["a fetch that failed", () => briefsChain(), () => Promise.reject(new Error("offline"))],
    ["a corrupt file", () => briefsChain(), () => ({ v: 1, logs: "nope" })],
    ["another inbox's snapshot", () => briefsChain(), () => ({ ...fixture, inbox: OTHER_INBOX })],
    ["a block hash Base does not give", () => briefsChain(), () => ({ ...fixture, blockHash: hash32(777) })],
    ["a block Base cannot read", () => briefsChain({ failBlocks: [BRIEFS_BLOCK] }), () => fixture],
    ["a block above the head", () => briefsChain({ head: BRIEFS_BLOCK - 1n }), () => fixture],
  ];
  it.each(unusable)("falls back to a scan from the deploy block with %s", async (_, chain, snapshot) => {
    const full = await read(chain()).result;
    const { client, result } = read(chain(), snapshot());
    const r = await result;
    expect(lowest(client.logCalls)).toBe(BRIEFS_DEPLOY);
    expect(r.fromSnapshot).toBeNull();
    expect(r.briefs).toEqual(full.briefs);
    expect(r.complete).toBe(true);
  });
});

/** The fixture with a brief below the window that the chain does not have: Base has no receipt for its transaction. */
const invented = () => {
  const snap = fixtureCopy();
  snap.logs.splice(1, 0, briefLog(9, ALICE, "never sent", BRIEFS_DEPLOY + 1_000n));
  return snap;
};

describe("readBriefs checks each log it takes from the file against Base", () => {
  const changed: [string, () => BriefsSnapshot, () => FakeChain][] = [
    ["a brief Base does not have", invented, () => briefsChain()],
    [
      "a log whose text differs from its receipt's",
      () => {
        const snap = fixtureCopy();
        snap.logs[1] = briefLog(2, ALICE, "a different text", BRIEFS_DEPLOY + 60_000n);
        return snap;
      },
      () => briefsChain(),
    ],
    [
      "a log in another block than its receipt",
      () => {
        const snap = fixtureCopy();
        snap.logs[0]!.blockNumber = String(BRIEFS_DEPLOY + 6n);
        return snap;
      },
      () => briefsChain(),
    ],
    [
      "a log at an index its receipt has no log at",
      () => {
        const snap = fixtureCopy();
        snap.logs[0]!.logIndex = 1;
        return snap;
      },
      () => briefsChain(),
    ],
    ["a log another contract emitted", fixtureCopy, () => briefsChain({ logAddress: OTHER_INBOX })],
    ["a receipt that cannot be read", fixtureCopy, () => briefsChain({ failReceipts: [hash32(9002)] })],
  ];

  it.each(changed)("drops the whole file for %s, and scans from the deploy block", async (_, snapshot, chain) => {
    const { client, result } = read(chain(), snapshot());
    const r = await result;
    expect(r.fromSnapshot).toBeNull();
    expect(lowest(client.logCalls)).toBe(BRIEFS_DEPLOY);
    expect(ids(r)).not.toContain(9);
    expect(r.briefs).toEqual((await read(chain()).result).briefs);
  });
});

describe("checkBriefsSnapshot", () => {
  it("passes a snapshot whose block hash and every log Base gives, reading each receipt", async () => {
    const client = fakeLedgerClient(briefsChain());
    expect(await checkBriefsSnapshot(client, BRIEFS_INBOX, fixture)).toEqual({ ok: true });
    expect(client.blockCalls).toEqual([BRIEFS_BLOCK]);
    expect([...new Set(client.receiptCalls)].sort()).toEqual([hash32(9001), hash32(9002), hash32(9003)]);
  });

  it("passes a snapshot of no log by block N's hash alone", async () => {
    const client = fakeLedgerClient(briefsChain({ logs: [], gas: {} }));
    expect(await checkBriefsSnapshot(client, BRIEFS_INBOX, empty())).toEqual({ ok: true });
    expect(client.blockCalls).toEqual([BRIEFS_BLOCK]);
    expect(client.receiptCalls).toEqual([]);
  });

  const failing: [string, () => FakeChain, () => unknown, RegExp][] = [
    ["a file of another inbox", () => briefsChain(), () => ({ ...fixture, inbox: OTHER_INBOX }), /^not a Brief snapshot of 0x/],
    ["another hash for block N", () => briefsChain(), () => ({ ...fixture, blockHash: hash32(777) }), /^block 59885280 has another hash on this RPC/],
    ["a block N that cannot be read", () => briefsChain({ failBlocks: [BRIEFS_BLOCK] }), () => fixture, /^block 59885280 could not be read: /],
    ["a brief Base does not have", () => briefsChain(), invented, /^the receipt of 0x0{60}2331 could not be read: /],
    [
      "a log that differs from its receipt's",
      () => briefsChain(),
      () => {
        const snap = fixtureCopy();
        snap.logs[2]!.data = snap.logs[1]!.data;
        return snap;
      },
      /^the receipt of 0x0{60}232b has no log of the inbox at index 0 as the file has it in block 59885270$/,
    ],
  ];
  it.each(failing)("says what is wrong with %s", async (_, chain, raw, reason) => {
    const out = await checkBriefsSnapshot(fakeLedgerClient(chain()), BRIEFS_INBOX, raw());
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.reason).toMatch(reason);
  });
});

describe("takeBriefsSnapshot", () => {
  it("builds on a previous snapshot, scanning only from its block minus the window", async () => {
    const at = { number: BRIEFS_HEAD - 5n, hash: fakeBlockHash(BRIEFS_HEAD - 5n) };
    const client = fakeLedgerClient(briefsChain());
    const next = await takeBriefsSnapshot({ client, inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: at, previous: fixture });
    expect(lowest(client.logCalls)).toBe(BRIEFS_BLOCK - W);
    const fresh = await takeBriefsSnapshot({ client: fakeLedgerClient(briefsChain()), inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: at });
    expect(next).toEqual(fresh);
    expect(next.logs.map((l) => l.transactionHash)).toEqual([hash32(9001), hash32(9002), hash32(9003), hash32(9004)]);
  });

  it("starts again from the deploy block when the previous snapshot's hash is not Base's", async () => {
    const client = fakeLedgerClient(briefsChain());
    await takeBriefsSnapshot({ client, inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: BRIEFS_AT, previous: { ...fixture, blockHash: hash32(777) } });
    expect(lowest(client.logCalls)).toBe(BRIEFS_DEPLOY);
  });

  it("builds on a previous snapshot only when Base's receipts give its logs", async () => {
    const client = fakeLedgerClient(briefsChain());
    const next = await takeBriefsSnapshot({ client, inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: BRIEFS_AT, previous: invented() });
    expect(lowest(client.logCalls)).toBe(BRIEFS_DEPLOY);
    expect(next).toEqual(fixture);
  });

  it("refuses to write a snapshot with a hole in it", async () => {
    await expect(
      takeBriefsSnapshot({ client: fakeLedgerClient(briefsChain({ failLogs: true })), inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: BRIEFS_AT }),
    ).rejects.toThrow(/could not be read/);
  });

  it("holds only the logs, N and its hash", async () => {
    const written = await takeBriefsSnapshot({ client: fakeLedgerClient(briefsChain()), inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX, block: BRIEFS_AT });
    expect(Object.keys(written)).toEqual(["v", "chainId", "inbox", "floor", "block", "blockHash", "logs"]);
  });
});

describe("the committed Brief snapshot", () => {
  const file = join(process.cwd(), "content/generated/briefs-snapshot.json");
  const decisions = join(process.cwd(), "content/generated/decisions-snapshot.json");

  it("is one of the MaatInbox deployments/README.md records, taken at the decisions snapshot's block", () => {
    const inbox = inboxDeployment(deployments);
    if (!inbox) {
      expect(existsSync(file)).toBe(false);
      return;
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const parsed = parseBriefsSnapshot(raw, inbox.inbox);
    expect(parsed).not.toBeNull();
    const vault = JSON.parse(readFileSync(decisions, "utf8")) as { block: string; blockHash: string };
    expect({ block: parsed!.block, blockHash: parsed!.blockHash }).toEqual({ block: vault.block, blockHash: vault.blockHash });
  });
});

describe("fetchBriefsSnapshotJson", () => {
  it("reads /data/briefs-snapshot.json", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture)));
    expect(await fetchBriefsSnapshotJson(fetchImpl as unknown as typeof fetch)).toEqual(fixture);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe(BRIEFS_SNAPSHOT_URL);
    expect(BRIEFS_SNAPSHOT_URL).toBe("/data/briefs-snapshot.json");
  });

  it("gives null for a missing file, a page that is not JSON or a network error", async () => {
    expect(await fetchBriefsSnapshotJson((async () => new Response("no", { status: 404 })) as unknown as typeof fetch)).toBeNull();
    expect(await fetchBriefsSnapshotJson((async () => new Response("<html>")) as unknown as typeof fetch)).toBeNull();
    expect(await fetchBriefsSnapshotJson((async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch)).toBeNull();
  });
});

describe("/data/briefs-snapshot.json", () => {
  it("serves the committed Brief snapshot as it is, or null while there is none", async () => {
    const file = join(process.cwd(), "content/generated/briefs-snapshot.json");
    const body = await GET().text();
    expect(body).toBe(existsSync(file) ? readFileSync(file, "utf8") : "null\n");
    expect(GET().headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});

describe("npm run snapshot", () => {
  it("writes the Brief snapshot with the decisions snapshot, at the same block, and checks both before it writes either", () => {
    const script = readFileSync(join(process.cwd(), "scripts/decisions-snapshot.ts"), "utf8");
    expect(script).toContain('new URL("../content/generated/briefs-snapshot.json", import.meta.url)');
    expect(script).toMatch(/takeBriefsSnapshot\(\{\s*\.\.\.tuning,/);
    expect(script).toMatch(/takeSnapshot\(\{\s*\.\.\.tuning,/);
    // Both checks come before the first write.
    const firstWrite = script.indexOf("writeJson(OUT");
    expect(script.indexOf("checkSnapshot(checker")).toBeLessThan(firstWrite);
    expect(script.indexOf("checkBriefsSnapshot(checker")).toBeLessThan(firstWrite);
  });

  it("is documented as writing both snapshots", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(readme).toMatch(/`npm run snapshot` \| [^\n]*the decisions snapshot and the Brief snapshot in `content\/generated\/`/);
  });
});
