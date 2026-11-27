// @vitest-environment node
import { getAddress, type Address, type Hash, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { snapshotSeed, teamLines, traceTeam, VAULT_TOPICS, type TeamInputs, type VaultSeed } from "@/app/(site)/proof/team";
import committed from "@/content/generated/decisions-snapshot.json";
import { parseSnapshot, SNAPSHOT_REORG_WINDOW } from "@/lib/chain/snapshot";
import {
  decisionLog,
  executorSetLog,
  multiplierLog,
  newRpcLog,
  proofChainRpc,
  revenueLog,
  transferLog,
  txHash,
  txReads,
  vaultSnapshot,
  type FakeTx,
  type ProofChain,
  type ProofRpcLog,
} from "./helpers/fake-proof-chain";

// The team trace with the vault's logs seeded from the committed snapshot or the ledger's browser cache: each seeded log
// is checked against its transaction receipt, so a seed can leave a log out but never add or change one, and the scan
// asks the RPC only for the blocks the seed does not cover.

const DEPLOY = 62_000_000n;
const HEAD = 62_120_000n;
const N = 62_100_000n;
const OWNER: Address = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
const EXECUTOR: Address = "0x9bC6E49d42e0659f3ef667B09B67506B348e115A";
const VAULT: Address = "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b";
const FUNDED: Address = "0x00000000000000000000000000000000000f0001";
const NEWBIE: Address = "0x00000000000000000000000000000000000f000a";
const TOKEN: Address = "0x00000000000000000000000000000000000c0001";
const lower = (a: string) => a.toLowerCase();

/**
 * The owner deploys the vault (nonce 0) and sends ETH to FUNDED (1), its committed sends; then it hands the executor
 * the role (2), the executor sends three Decisions, and the owner moves a token to NEWBIE in a call that makes the
 * vault log MultiplierChangeDetected (3). Twenty outsiders call notifyRevenue. All of it is below the snapshot's block N.
 */
const TXS: FakeTx[] = [
  { hash: txHash(1), from: OWNER, nonce: 0, to: null, block: DEPLOY, contractAddress: VAULT },
  { hash: txHash(2), from: OWNER, nonce: 1, to: FUNDED, value: 10n ** 15n, block: DEPLOY + 10n },
  { hash: txHash(3), from: OWNER, nonce: 2, to: VAULT, block: DEPLOY + 20n, logs: [executorSetLog(VAULT, EXECUTOR)] },
  ...[0, 1, 2].map((i) => ({ hash: txHash(4 + i), from: EXECUTOR, nonce: i, to: VAULT, block: DEPLOY + 30n + BigInt(i), logs: [decisionLog(VAULT, i + 1)] })),
  {
    hash: txHash(7),
    from: OWNER,
    nonce: 3,
    to: TOKEN,
    block: DEPLOY + 40n,
    logs: [multiplierLog(VAULT, TOKEN), transferLog(TOKEN, OWNER, NEWBIE)],
  },
  ...Array.from({ length: 20 }, (_, i) => ({
    hash: txHash(100 + i),
    from: `0x${(0x7000 + i).toString(16).padStart(40, "0")}` as Address,
    nonce: 0,
    to: VAULT,
    block: DEPLOY + 50n + BigInt(i),
    logs: [revenueLog(VAULT)],
  })),
];
const CHAIN: ProofChain = {
  chainId: 8453,
  head: HEAD,
  headTime: 1_795_619_778n,
  inbox: "0x00000000000000000000000000000000000B0001",
  deployTx: txHash(99),
  deployBlock: DEPLOY,
  briefs: [],
  uids: {},
  attestations: {},
  vault: { address: VAULT, owner: OWNER, executor: EXECUTOR, payees: [OWNER] },
  txs: TXS,
};
const INPUTS: TeamInputs = {
  team: [
    { address: OWNER, role: "owner" },
    { address: EXECUTOR, role: "agent executor" },
  ],
  sends: [{ wallet: OWNER, txs: [txHash(1), txHash(2)] }],
  stops: [],
  deployments: [{ contract: "MandateVault", address: VAULT, tx: txHash(1) }],
};

const SNAPSHOT = vaultSnapshot(CHAIN, VAULT, DEPLOY, N);
const seedOf = (raw: unknown) => snapshotSeed(raw, VAULT);
const vaultRanges = (seen: ProofRpcLog) => seen.logRanges.filter((r) => r.address === lower(VAULT));
const lowest = (seen: ProofRpcLog) => vaultRanges(seen).reduce((m, r) => (r.from < m ? r.from : m), HEAD + 1n);

async function run(seed: TeamInputs["vaultSeed"], c: ProofChain = CHAIN, inputs: TeamInputs = INPUTS) {
  const seen = newRpcLog();
  const trace = await traceTeam(proofChainRpc(c, seen), { ...inputs, vaultSeed: seed }, HEAD);
  return { trace, seen, lines: teamLines(trace) };
}

/** `SNAPSHOT` with `edit` applied to a copy of its logs. */
function edited(edit: (logs: (typeof SNAPSHOT)["logs"]) => (typeof SNAPSHOT)["logs"]) {
  return { ...SNAPSHOT, logs: edit(SNAPSHOT.logs.map((l) => ({ ...l, topics: [...l.topics] }))) };
}
const decisionAt = (logs: (typeof SNAPSHOT)["logs"]) => logs.findIndex((l) => l.topics[0] === VAULT_TOPICS[0]);

describe("snapshotSeed, the committed snapshot as the team trace takes it", () => {
  it("takes the logs below the snapshot's reorg window, and the block and hash it must match", () => {
    const seed = seedOf(committed)!;
    expect(seed.source).toBe("snapshot");
    expect(seed.from).toBe(BigInt(committed.floor));
    expect(seed.to).toBe(BigInt(committed.block) - SNAPSHOT_REORG_WINDOW - 1n);
    expect(seed.anchor).toEqual({ block: BigInt(committed.block), hash: committed.blockHash.toLowerCase() });
    expect(seed.logs).toEqual(committed.logs.filter((l) => BigInt(l.blockNumber) <= seed.to));
  });

  it("refuses every file the ledger's parseSnapshot refuses, and only those", () => {
    const base = committed as unknown as Record<string, unknown>;
    const log0 = committed.logs[0]!;
    const cases: unknown[] = [
      null,
      "0x",
      [],
      base,
      { ...base, v: 2 },
      { ...base, chainId: 1 },
      { ...base, vault: "0x0000000000000000000000000000000000000001" },
      { ...base, vault: "0x3F95" },
      { ...base, floor: "61,698,517" },
      { ...base, floor: String(BigInt(committed.block) + 1n) },
      { ...base, block: "0x3b5" },
      { ...base, blockHash: "0x1234" },
      { ...base, logs: "none" },
      { ...base, logs: [{ ...log0, blockNumber: String(BigInt(committed.floor) - 1n) }] },
      { ...base, logs: [{ ...log0, blockNumber: String(BigInt(committed.block) + 1n) }] },
      { ...base, logs: [{ ...log0, logIndex: -1 }] },
      { ...base, logs: [{ ...log0, logIndex: 1.5 }] },
      { ...base, logs: [{ ...log0, transactionHash: "0x12" }] },
      { ...base, logs: [{ ...log0, topics: ["nope"] }] },
      { ...base, logs: [{ ...log0, data: "zz" }] },
      { ...base, extra: "a key the file does not define" },
    ];
    for (const raw of cases) expect([raw, seedOf(raw) === null]).toEqual([raw, parseSnapshot(raw, VAULT) === null]);
  });
});

describe("the team trace with the vault's logs seeded from a snapshot", () => {
  it("gives the same team set, stops, notes and gaps as a scan from the deploy block, and scans only above the seed", async () => {
    const full = await run(undefined);
    const seeded = await run(seedOf(SNAPSHOT));
    expect(full.trace.gaps).toEqual([]);
    expect(seeded.lines).toEqual(full.lines);
    expect(byAddress(seeded.trace)[lower(NEWBIE)]).toMatchObject({ hop: 1 });
    expect(lowest(full.seen)).toBe(DEPLOY);
    expect(lowest(seeded.seen)).toBe(N - SNAPSHOT_REORG_WINDOW);
    expect(seeded.trace.seed).toEqual({ source: "snapshot", from: DEPLOY, to: N - SNAPSHOT_REORG_WINDOW - 1n, anchor: N });
    expect(seeded.trace.seedRejected).toBeNull();
    expect(full.trace.seed).toBeNull();
  });

  it("still stops on a window of the vault's logs above the seed that it cannot read, and on one below a rejected seed", async () => {
    const above = { ...CHAIN, failLogs: [{ from: N - SNAPSHOT_REORG_WINDOW, to: HEAD, address: VAULT }] };
    await expect(run(seedOf(SNAPSHOT), above)).rejects.toThrow("upstream request timed out");
    const below = { ...CHAIN, failLogs: [{ from: DEPLOY, to: DEPLOY + 100n, address: VAULT }] };
    const ghost = edited((logs) => [...logs, { ...logs[decisionAt(logs)]!, transactionHash: `0x${"ab".repeat(32)}` as Hash }]);
    await expect(run(seedOf(ghost), below)).rejects.toThrow("upstream request timed out");
  });

  it("takes the seed as a promise, as the page passes the snapshot it is still fetching", async () => {
    const seeded = await run(Promise.resolve(seedOf(SNAPSHOT)));
    expect(lowest(seeded.seen)).toBe(N - SNAPSHOT_REORG_WINDOW);
  });

  it("reads no transaction of an outsider's notifyRevenue the snapshot holds, as the scan reads none", async () => {
    expect(SNAPSHOT.logs.filter((l) => l.topics[0] === lower(revenueLog(VAULT).topics[0]!))).toHaveLength(20);
    const seeded = await run(seedOf(SNAPSHOT));
    const full = await run(undefined);
    expect(txReads(seeded.seen)).toBe(txReads(full.seen));
  });

  it("rejects a seed with an invented log and reads the vault's logs from its deploy block instead", async () => {
    // A Decision the vault never emitted, in the owner's plain ETH send, which its receipt does not hold.
    const invented = edited((logs) => [...logs, { blockNumber: String(DEPLOY + 10n), logIndex: 0, transactionHash: txHash(2), topics: decisionLog(VAULT, 9).topics.map(lower) as Hex[], data: decisionLog(VAULT, 9).data! }]);
    const full = await run(undefined);
    const seeded = await run(seedOf(invented));
    expect(seeded.trace.seed).toBeNull();
    expect(seeded.trace.seedRejected).toBe(`the receipt of ${txHash(2)} has no log of the vault at index 0 as the snapshot has it in block 62,000,010`);
    expect(lowest(seeded.seen)).toBe(DEPLOY);
    expect(seeded.lines).toEqual(full.lines);
  });

  it("rejects a seed that leaves out a Decision log of a transaction it holds another log of, and counts every Decision", async () => {
    // execute() can log MultiplierChangeDetected before its Decision (MandateVault._syncMultiplier). A seed that keeps
    // the first and drops the second leaves no team send missing, so only the receipt shows the Decision it left out.
    const txs = TXS.map((t) => (t.hash === txHash(4) ? { ...t, logs: [multiplierLog(VAULT, TOKEN), decisionLog(VAULT, 1)] } : t));
    const chain: ProofChain = { ...CHAIN, txs };
    const snapshot = vaultSnapshot(chain, VAULT, DEPLOY, N);
    const dropped = { ...snapshot, logs: snapshot.logs.filter((l) => !(l.transactionHash === txHash(4) && l.topics[0] === VAULT_TOPICS[0])) };
    expect(dropped.logs).toHaveLength(snapshot.logs.length - 1);
    const full = await run(undefined, chain);
    const seeded = await run(seedOf(dropped), chain);
    expect(full.trace.decisions).toHaveLength(3);
    expect(seeded.trace.seed).toBeNull();
    expect(seeded.trace.seedRejected).toBe(`the snapshot leaves out the log of the vault at index 1 of ${txHash(4)}, which its receipt holds in block 62,000,030`);
    expect(seeded.trace.decisions).toEqual(full.trace.decisions);
    expect(seeded.lines).toEqual(full.lines);
    expect(lowest(seeded.seen)).toBe(DEPLOY);
  });

  it("rejects a seeded log of a transaction the RPC does not have", async () => {
    const ghost: Hash = `0x${"ab".repeat(32)}`;
    const seeded = await run(seedOf(edited((logs) => [...logs, { ...logs[decisionAt(logs)]!, transactionHash: ghost }])));
    expect(seeded.trace.seedRejected).toBe(`the RPC has no receipt for ${ghost}, which the snapshot gives a log of the vault`);
    expect(lowest(seeded.seen)).toBe(DEPLOY);
  });

  it("rejects a seeded log altered in its data, a topic, its log index or its block", async () => {
    const full = await run(undefined);
    const alterations: ((l: (typeof SNAPSHOT)["logs"][number]) => void)[] = [
      (l) => (l.data = `0x${"0".repeat(63)}1`),
      (l) => (l.topics[1] = `0x${"0".repeat(63)}9`),
      (l) => (l.logIndex += 1),
      (l) => (l.blockNumber = String(BigInt(l.blockNumber) + 1n)),
    ];
    for (const alter of alterations) {
      const seeded = await run(seedOf(edited((logs) => logs.map((l, i) => (i === decisionAt(logs) ? (alter(l), l) : l)))));
      expect(seeded.trace.seed).toBeNull();
      expect(seeded.trace.seedRejected).toMatch(/^the receipt of 0x[0-9a-f]{64} has no log of the vault at index \d+ as the snapshot has it in block [\d,]+$/);
      expect(lowest(seeded.seen)).toBe(DEPLOY);
      expect(seeded.lines).toEqual(full.lines);
    }
  });

  it("rejects a snapshot whose block has another hash on the RPC", async () => {
    const seeded = await run(seedOf({ ...SNAPSHOT, blockHash: `0x${"cd".repeat(32)}` }));
    expect(seeded.trace.seedRejected).toBe("block 62,100,000 has another hash on this RPC");
    expect(lowest(seeded.seen)).toBe(DEPLOY);
  });

  it("does not use a snapshot of a block past the one it counts to, nor one of another vault", async () => {
    const late = await run(seedOf(vaultSnapshot(CHAIN, VAULT, DEPLOY, HEAD + 1_000n)));
    expect(late.trace.seed).toBeNull();
    expect(late.trace.seedRejected).toBe("its block 62,121,000 is past block 62,120,000, the block counted to");
    expect(lowest(late.seen)).toBe(DEPLOY);
    const other = getAddress("0x00000000000000000000000000000000000c0003");
    expect(snapshotSeed({ ...SNAPSHOT, vault: other }, VAULT)).toBeNull();
    const elsewhere = await run({ ...seedOf(SNAPSHOT)!, vault: lower(other) });
    expect(elsewhere.trace.seed).toBeNull();
    expect(lowest(elsewhere.seen)).toBe(DEPLOY);
  });

  it("reads the seed's blocks from Base when the snapshot omits a team send's vault log, and gives the lines of a scan from the deploy block", async () => {
    // Without the setExecutor log, the owner's third send is in no log the seeded trace reads and not in its committed list.
    const omitted = edited((logs) => logs.filter((l) => l.transactionHash !== txHash(3)));
    const full = await run(undefined);
    const seeded = await run(seedOf(omitted));
    expect(seeded.trace.seed).toBeNull();
    expect(seeded.trace.seedRejected).toBe(`with its logs, ${lower(OWNER)} sent 4 transactions by block 62,120,000 and 1 is missing`);
    expect(seeded.trace.gaps).toEqual([]);
    expect(seeded.lines).toEqual(full.lines);
    expect(lowest(seeded.seen)).toBe(DEPLOY);
  });

  it("still leaves the count incomplete, with the lines of a scan from the deploy block, when a team send is in no log and no committed list", async () => {
    const inputs: TeamInputs = { ...INPUTS, sends: [{ wallet: OWNER, txs: [txHash(1)] }] };
    const full = await run(undefined, CHAIN, inputs);
    const seeded = await run(seedOf(SNAPSHOT), CHAIN, inputs);
    expect(full.trace.gaps).toEqual([
      `${lower(OWNER)} sent 4 transactions by block 62,120,000, and 1 is missing: in no vault or MaatInbox log the trace reads, and not in web/content/proof-sends.ts. node scripts/recount.mjs --sends ${lower(OWNER)} --rpc https://mainnet.base.org --logs-rpc https://base-rpc.publicnode.com prints it.`,
    ]);
    expect(seeded.lines).toEqual(full.lines);
    expect(seeded.trace.seed).toBeNull();
  });

  it("still stops on a window of the seed's blocks it cannot read when it reads them again", async () => {
    const omitted = edited((logs) => logs.filter((l) => l.transactionHash !== txHash(3)));
    const below = { ...CHAIN, failLogs: [{ from: DEPLOY, to: DEPLOY + 100n, address: VAULT }] };
    await expect(run(seedOf(omitted), below)).rejects.toThrow("upstream request timed out");
  });

  it("scans the blocks between the vault's deploy and a seed that starts after it", async () => {
    const later = vaultSnapshot(CHAIN, VAULT, DEPLOY + 25n, N);
    const seeded = await run(seedOf(later));
    expect(seeded.trace.seed).toMatchObject({ from: DEPLOY + 25n });
    expect(vaultRanges(seeded.seen).some((r) => r.from === DEPLOY && r.to === DEPLOY + 24n)).toBe(true);
    expect(seeded.lines).toEqual((await run(undefined)).lines);
  });
});

describe("the team trace with the vault's logs seeded from the ledger's browser cache", () => {
  const cache = (logs = SNAPSHOT.logs): VaultSeed => ({ source: "cache", vault: lower(VAULT), from: DEPLOY, to: HEAD - 150n, anchor: null, logs });

  it("checks each cached log against its receipt and scans only above the cache", async () => {
    const seeded = await run(cache());
    expect(seeded.trace.seed).toEqual({ source: "cache", from: DEPLOY, to: HEAD - 150n, anchor: null });
    expect(lowest(seeded.seen)).toBe(HEAD - 149n);
    expect(seeded.lines).toEqual((await run(undefined)).lines);
  });

  it("rejects a cache with an invented log", async () => {
    const forged = edited((logs) => [...logs, { blockNumber: String(DEPLOY + 10n), logIndex: 0, transactionHash: txHash(2), topics: decisionLog(VAULT, 9).topics.map(lower) as Hex[], data: decisionLog(VAULT, 9).data! }]);
    const seeded = await run(cache(forged.logs));
    expect(seeded.trace.seed).toBeNull();
    expect(seeded.trace.seedRejected).toBe(`the receipt of ${txHash(2)} has no log of the vault at index 0 as the ledger's cache has it in block 62,000,010`);
    expect(lowest(seeded.seen)).toBe(DEPLOY);
  });

  it("reads the cache's blocks from Base when it omits a team send's vault log, so a stale cache cannot keep the count incomplete", async () => {
    const seeded = await run(cache(SNAPSHOT.logs.filter((l) => l.transactionHash !== txHash(3))));
    expect(seeded.trace.seed).toBeNull();
    expect(seeded.trace.gaps).toEqual([]);
    expect(lowest(seeded.seen)).toBe(DEPLOY);
    expect(seeded.lines).toEqual((await run(undefined)).lines);
  });
});

const byAddress = (t: Awaited<ReturnType<typeof traceTeam>>) => Object.fromEntries(t.members.map((m) => [m.address, m]));
