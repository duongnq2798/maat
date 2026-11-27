// @vitest-environment node
import { encodeEventTopics, type AbiEvent, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { vaultAbi } from "@/lib/chain/abi";
import type { RawLog } from "@/lib/gap/decode";
import { DECISION_TOPIC, decisionCounts, SENDERS, type WindowDecision } from "@/lib/gap/decisions";
import type { LogQuery, LogReader, TxRead } from "@/lib/gap/rpc";
import { OWNER_SELECTOR, readDecisions, readOwner } from "@/lib/gap/vault";
import { decisionLog, hash32 } from "./helpers/fake-ledger";
import { txInput, VECTORS } from "./helpers/maat-v1";

const VAULT = "0x3f956072d18ddd20d5efb74e9ccabf8deade699b";
const OWNER = `0x${"a1".repeat(20)}`;
const AGENT = `0x${"b2".repeat(20)}`;
const ROUTER = `0x${"c3".repeat(20)}`;

/** A vault's Decision logs and their transactions, served through the LogReader the script uses. */
class Vault implements Pick<LogReader, "getLogs" | "transaction" | "call" | "blockTs"> {
  logs: RawLog[] = [];
  txs = new Map<string, TxRead>();
  queries: LogQuery[] = [];

  add(n: number, block: number, sender: string, input: Hex, opts: { reason?: string; to?: string; logIndex?: number } = {}) {
    const l = decisionLog(n, BigInt(block), { reason: opts.reason });
    this.logs.push({
      address: VAULT,
      topics: l.topics,
      data: l.data,
      blockNumber: `0x${block.toString(16)}`,
      logIndex: `0x${(opts.logIndex ?? 0).toString(16)}`,
      transactionHash: l.transactionHash,
      blockTimestamp: `0x${(1_795_802_400 + block).toString(16)}`,
    });
    this.txs.set(l.transactionHash.toLowerCase(), { from: sender, to: opts.to ?? VAULT, input });
  }
  async getLogs(q: LogQuery) {
    this.queries.push(q);
    return this.logs.filter((l) => Number(l.blockNumber) >= q.from && Number(l.blockNumber) <= q.to);
  }
  async transaction(hash: string) {
    const t = this.txs.get(hash.toLowerCase());
    if (!t) throw new Error(`no transaction ${hash}`);
    return t;
  }
  async call(to: string, data: string) {
    if (to === VAULT && data === OWNER_SELECTOR) return `0x${"0".repeat(24)}${OWNER.slice(2)}`;
    throw new Error(`unexpected call ${to} ${data}`);
  }
  async blockTs(n: number) {
    return 1_795_802_400 + n;
  }
}
const reader = (v: Vault) => v as unknown as LogReader;
const agentInput = txInput(VECTORS.V1.blob);
const probeInput = txInput(VECTORS.V4.blob);
const briefInput = txInput(VECTORS.V5.blob);

describe("the vault's Decisions in a window", () => {
  it("reads the Decision topic of the vault's own ABI", () => {
    const ev = vaultAbi.find((x) => x.type === "event" && x.name === "Decision") as AbiEvent;
    expect(encodeEventTopics({ abi: [ev], eventName: "Decision" } as never)[0]).toBe(DECISION_TOPIC);
  });

  it("reads the owner the vault names", async () => {
    expect(await readOwner(reader(new Vault()), VAULT)).toBe(OWNER);
  });

  it("labels each Decision by its sender as /ledger does: owner by hand, probe, brief-driven, agent, or another contract", async () => {
    const v = new Vault();
    v.add(1, 100, OWNER, agentInput, { reason: "MARKET_CLOSED" }); // the owner, whatever the calldata carries
    v.add(2, 110, AGENT, agentInput, { reason: "MARKET_CLOSED" });
    v.add(3, 120, AGENT, probeInput, { reason: "MARKET_CLOSED" });
    v.add(4, 130, AGENT, briefInput, { reason: "MARKET_CLOSED" });
    v.add(5, 140, AGENT, agentInput, { reason: "MARKET_CLOSED", to: ROUTER }); // not a direct execute call to the vault
    v.add(6, 150, OWNER, agentInput, { reason: "OK" });
    const got = await readDecisions(reader(v), { vault: VAULT, owner: OWNER, from: 100, to: 150 });
    expect(got.map((d) => [d.block, d.sender, d.allowed, d.reason])).toEqual([
      [100, "owner", false, "MARKET_CLOSED"],
      [110, "agent", false, "MARKET_CLOSED"],
      [120, "probe", false, "MARKET_CLOSED"],
      [130, "brief", false, "MARKET_CLOSED"],
      [140, "unlabelled", false, "MARKET_CLOSED"],
      [150, "owner", true, "OK"],
    ]);
    expect(got[0]).toEqual({ block: 100, logIndex: 0, ts: 1_795_802_500, tx: hash32(1), sender: "owner", allowed: false, reason: "MARKET_CLOSED" });
  });

  it("reads the logs over the window's blocks only, from the vault alone, under the Decision topic", async () => {
    const v = new Vault();
    v.add(1, 99, AGENT, agentInput, { reason: "MARKET_CLOSED" }); // the block before the window
    v.add(2, 100, AGENT, agentInput, { reason: "MARKET_CLOSED" }); // its first block
    v.add(3, 200, AGENT, probeInput, { reason: "MARKET_CLOSED" }); // its last block
    v.add(4, 201, AGENT, probeInput, { reason: "OK" }); // the open's block
    const got = await readDecisions(reader(v), { vault: VAULT, owner: OWNER, from: 100, to: 200 });
    expect(v.queries).toEqual([{ address: VAULT, topic0: DECISION_TOPIC, from: 100, to: 200 }]);
    expect(got.map((d) => d.block)).toEqual([100, 200]);
  });

  it("refuses a log under the Decision topic that does not decode, rather than leave it out of a count", async () => {
    const v = new Vault();
    v.add(1, 100, AGENT, agentInput, { reason: "MARKET_CLOSED" });
    v.logs[0]!.data = "0x";
    await expect(readDecisions(reader(v), { vault: VAULT, owner: OWNER, from: 100, to: 200 })).rejects.toThrow(/does not decode as a Decision/);
  });

  it("counts the Decisions by sender, and those refused with MARKET_CLOSED", () => {
    const d = (sender: WindowDecision["sender"], reason: WindowDecision["reason"], block: number): WindowDecision => ({
      block,
      logIndex: 0,
      ts: block,
      tx: hash32(block),
      sender,
      allowed: reason === "OK",
      reason,
    });
    const counts = decisionCounts([
      d("agent", "MARKET_CLOSED", 1),
      d("agent", "MARKET_CLOSED", 2),
      d("agent", "FEED_STALE", 3),
      d("probe", "MARKET_CLOSED", 4),
      d("owner", "OK", 5),
    ]);
    expect(counts).toEqual({
      count: 5,
      marketClosed: 3,
      bySender: {
        agent: { count: 3, marketClosed: 2 },
        probe: { count: 1, marketClosed: 1 },
        brief: { count: 0, marketClosed: 0 },
        owner: { count: 1, marketClosed: 0 },
        unlabelled: { count: 0, marketClosed: 0 },
      },
    });
    expect(Object.keys(counts.bySender)).toEqual([...SENDERS]);
    expect(decisionCounts([]).count).toBe(0);
  });
});
