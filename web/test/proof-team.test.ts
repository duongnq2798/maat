// @vitest-environment node
import { getAddress, keccak256, parseAbi, toBytes, toEventSelector, toFunctionSelector, type Abi, type AbiEvent, type Address } from "viem";
import { describe, expect, it } from "vitest";
import * as team from "@/app/(site)/proof/team";
import { teamLines, traceTeam, type TeamInputs } from "@/app/(site)/proof/team";
import { PROOF_SENDS } from "@/content/proof-sends";
import { PROOF_STOPS } from "@/content/proof-stops";
import { PROOF_TEAM } from "@/content/proof-team";
import abi from "@/content/generated/abi.json";
import addresses from "@/content/generated/base-addresses.json";
import { docsData } from "@/lib/docs/generated";
import {
  approvalLog,
  decisionLog,
  executorSetLog,
  multiplierLog,
  newRpcLog,
  proofChainRpc,
  revenueLog,
  transferLog,
  txHash,
  txReads,
  type FakeTx,
  type ProofChain,
} from "./helpers/fake-proof-chain";

const HEAD = 62_120_000n;
const OWNER: Address = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
const EXECUTOR: Address = "0x9bC6E49d42e0659f3ef667B09B67506B348e115A";
const VAULT: Address = "0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b";
const PAYEE: Address = "0x00000000000000000000000000000000000e0001";
const DEPLOYER: Address = "0x00000000000000000000000000000000000d0001";
const FUNDED: Address = "0x00000000000000000000000000000000000f0001";
const TOKEN_KID: Address = "0x00000000000000000000000000000000000f0002";
const PULLED: Address = "0x00000000000000000000000000000000000f0003";
const HOP3: Address = "0x00000000000000000000000000000000000f0004";
const ROUTER: Address = "0x00000000000000000000000000000000000f0005";
const SPENDER: Address = "0x00000000000000000000000000000000000f0006";
const SMART: Address = "0x00000000000000000000000000000000000f0007";
const TOKEN: Address = "0x00000000000000000000000000000000000c0001";
const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);
const lower = (a: string) => a.toLowerCase();

/**
 * The owner deploys the vault (nonce 0), sends ETH to FUNDED (1), approves SPENDER for USDC (2), pays USDC into the
 * vault (3), sends a token to the committed stop ROUTER (4), sends ETH in a reverted transaction to HOP3 (5). SPENDER
 * pulls the owner's USDC to PULLED in a transaction of its own. FUNDED sends TOKEN to TOKEN_KID (hop 2), and TOKEN_KID
 * sends ETH to HOP3, which is three hops out and stays outside.
 */
const TXS: FakeTx[] = [
  { hash: txHash(1), from: OWNER, nonce: 0, to: null, block: 62_000_000n, contractAddress: VAULT },
  { hash: txHash(2), from: OWNER, nonce: 1, to: FUNDED, value: 10n ** 15n, block: 62_000_010n },
  { hash: txHash(3), from: OWNER, nonce: 2, to: USDC, block: 62_000_020n, logs: [approvalLog(USDC, OWNER, SPENDER)] },
  { hash: txHash(4), from: OWNER, nonce: 3, to: VAULT, block: 62_000_030n, logs: [transferLog(USDC, OWNER, VAULT)] },
  { hash: txHash(5), from: OWNER, nonce: 4, to: TOKEN, block: 62_000_040n, logs: [transferLog(TOKEN, OWNER, ROUTER)] },
  { hash: txHash(6), from: OWNER, nonce: 5, to: HOP3, value: 1n, block: 62_000_050n, status: 0 },
  { hash: txHash(7), from: DEPLOYER, nonce: 0, to: null, block: 62_000_060n, contractAddress: "0x00000000000000000000000000000000000B0001" },
  { hash: txHash(8), from: FUNDED, nonce: 0, to: TOKEN, block: 62_000_070n, logs: [transferLog(TOKEN, FUNDED, TOKEN_KID)] },
  { hash: txHash(9), from: TOKEN_KID, nonce: 0, to: HOP3, value: 5n, block: 62_000_080n },
];

const CHAIN: ProofChain = {
  chainId: 8453,
  head: HEAD,
  headTime: 1_795_619_778n,
  inbox: "0x00000000000000000000000000000000000B0001",
  deployTx: txHash(7),
  deployBlock: 62_000_060n,
  briefs: [],
  uids: {},
  attestations: {},
  vault: { address: VAULT, owner: OWNER, executor: OWNER, payees: [OWNER, PAYEE] },
  txs: TXS,
  tokenLogs: [{ ...transferLog(USDC, OWNER, PULLED), block: 62_000_090n, txHash: txHash(10) }],
  code: { [lower(SMART)]: "0x6080" },
};

const INPUTS: TeamInputs = {
  team: [
    { address: OWNER, role: "owner" },
    { address: EXECUTOR, role: "agent executor" },
  ],
  sends: [
    { wallet: OWNER, txs: [1, 2, 3, 4, 5, 6].map(txHash) },
    { wallet: DEPLOYER, txs: [txHash(7)] },
    { wallet: FUNDED, txs: [txHash(8)] },
    { wallet: TOKEN_KID, txs: [txHash(9)] },
  ],
  stops: [{ address: ROUTER, name: "a test router", source: "the fixture" }],
  deployments: [
    { contract: "MandateVault", address: VAULT, tx: txHash(1) },
    { contract: "MaatInbox", address: "0x00000000000000000000000000000000000B0001", tx: txHash(7) },
  ],
};

const trace = (c: ProofChain = CHAIN, inputs: TeamInputs = INPUTS, block = HEAD) => traceTeam(proofChainRpc(c), inputs, block);
const byAddress = (t: Awaited<ReturnType<typeof traceTeam>>) => Object.fromEntries(t.members.map((m) => [m.address, m]));

describe("the team set of inbox spec §5, traced from the chain", () => {
  it("starts from the committed list, the vault's owner(), executor() and payees(), and every deployer", async () => {
    const t = await trace();
    const m = byAddress(t);
    expect(m[lower(OWNER)]).toEqual({
      address: lower(OWNER),
      hop: 0,
      why: [
        "web/content/proof-team.ts (owner)",
        "the vault's owner()",
        "the vault's executor()",
        "on the vault's payees()",
        "deployer of MandateVault",
      ],
    });
    expect(m[lower(EXECUTOR)]).toMatchObject({ hop: 0, why: ["web/content/proof-team.ts (agent executor)"] });
    expect(m[lower(PAYEE)]).toMatchObject({ hop: 0, why: ["on the vault's payees()"] });
    expect(m[lower(DEPLOYER)]).toMatchObject({ hop: 0, why: ["deployer of MaatInbox"] });
  });

  it("adds a wallet a team wallet sent ETH or a token to, and the wallets those sent to, two hops and no more", async () => {
    const m = byAddress(await trace());
    expect(m[lower(FUNDED)]).toMatchObject({ hop: 1, why: [`ETH from ${lower(OWNER)} in ${txHash(2)}`] });
    expect(m[lower(PULLED)]).toMatchObject({ hop: 1, why: [`${lower(USDC)} from ${lower(OWNER)} in ${txHash(10)}`] });
    expect(m[lower(TOKEN_KID)]).toMatchObject({ hop: 2, why: [`${lower(TOKEN)} from ${lower(FUNDED)} in ${txHash(8)}`] });
    expect(m[lower(HOP3)]).toBeUndefined();
  });

  it("stops at the vault, the zero address and the committed stops, and lists each with its source", async () => {
    const t = await trace();
    const m = byAddress(t);
    expect(m[lower(VAULT)]).toBeUndefined();
    expect(m[lower(ROUTER)]).toBeUndefined();
    expect(t.stops).toEqual([
      { address: "0x0000000000000000000000000000000000000000", name: "the zero address", source: "a mint or a burn, not a wallet" },
      { address: lower(VAULT), name: "MandateVault", source: "deployments/README.md" },
      { address: lower(ROUTER), name: "a test router", source: "the fixture" },
    ]);
  });

  it("takes no funding from a reverted transaction", async () => {
    // The owner's nonce 5 sent ETH to HOP3 and reverted; HOP3 is only reached three hops out.
    expect(byAddress(await trace())[lower(HOP3)]).toBeUndefined();
  });

  it("is complete when every traced wallet's committed list matches its nonce, and says so in its lines", async () => {
    const t = await trace();
    expect(t.gaps).toEqual([]);
    expect(t.notes).toEqual([]);
    expect(teamLines(t)).toContain(`Team set ${lower(FUNDED)}: hop 1, ETH from ${lower(OWNER)} in ${txHash(2)}`);
    expect(teamLines(t)).toContain(`Hop stop ${lower(ROUTER)}: a test router (the fixture)`);
  });

  it("names the gap when a wallet sent more transactions than its committed list holds", async () => {
    const short = { ...INPUTS, sends: INPUTS.sends.filter((s) => s.wallet !== FUNDED) };
    const t = await trace(CHAIN, short);
    expect(t.gaps).toEqual([
      `${lower(FUNDED)} sent 1 transaction by block 62,120,000, and 1 is missing: in no vault or MaatInbox log the trace reads, and not in web/content/proof-sends.ts. node scripts/recount.mjs --sends ${lower(FUNDED)} --rpc https://mainnet.base.org --logs-rpc https://base-rpc.publicnode.com prints it.`,
    ]);
    expect(teamLines(t)).toContain(`Incomplete: ${t.gaps[0]}`);
    // Without FUNDED's list its token is not seen, so TOKEN_KID is not reached.
    expect(byAddress(t)[lower(TOKEN_KID)]).toBeUndefined();
  });

  it("counts only the transactions sent by the block it traces to", async () => {
    const t = await trace(CHAIN, INPUTS, 62_000_015n);
    expect(t.gaps).toEqual([]);
    const m = byAddress(t);
    expect(m[lower(FUNDED)]).toMatchObject({ hop: 1 });
    expect(m[lower(PULLED)]).toBeUndefined();
  });

  it("refuses a committed list out of nonce order", async () => {
    const swapped = { ...INPUTS, sends: [{ wallet: OWNER, txs: [txHash(2), txHash(1), ...[3, 4, 5, 6].map(txHash)] }, ...INPUTS.sends.slice(1)] };
    await expect(trace(CHAIN, swapped)).rejects.toThrow(
      `web/content/proof-sends.ts lists the transactions of ${lower(OWNER)} out of nonce order: ${txHash(1)} has nonce 0, after nonce 1.`,
    );
  });

  it("refuses a committed transaction another wallet sent, even one past the wallet's nonce", async () => {
    const wrong = { ...INPUTS, sends: [{ wallet: OWNER, txs: [...[1, 2, 3, 4, 5, 6].map(txHash), txHash(7)] }, ...INPUTS.sends.slice(1)] };
    await expect(trace(CHAIN, wrong)).rejects.toThrow(`web/content/proof-sends.ts: ${txHash(7)} is not a transaction ${lower(OWNER)} sent`);
  });

  it("notes a wallet with code, whose ETH can leave inside another wallet's transaction", async () => {
    const t = await trace({ ...CHAIN, vault: { ...CHAIN.vault!, payees: [OWNER, SMART] } });
    expect(byAddress(t)[lower(SMART)]).toMatchObject({ hop: 0, why: ["on the vault's payees()"] });
    expect(t.notes).toEqual([`${lower(SMART)} has code at block 62,120,000, so ETH it sends inside a transaction another wallet sent is not seen.`]);
    expect(t.gaps).toEqual([]);
  });

  it("names a gap for a wallet with an EIP-7702 delegation, whose code can send ETH inside its own transactions", async () => {
    const delegated = `0xef0100${"ab".repeat(20)}`;
    const t = await trace({ ...CHAIN, code: { [lower(OWNER)]: delegated as `0x${string}` } });
    expect(t.gaps).toEqual([
      `${lower(OWNER)} is delegated to code by EIP-7702 at block 62,120,000: that code can send ETH inside the wallet's own transactions, which no log shows, and its nonce counts authorizations as well as sends, so its sends cannot be checked.`,
    ]);
    expect(t.notes).toEqual([]);
    // Its sends are still read, so the wallets it funded stay on the team.
    expect(byAddress(t)[lower(FUNDED)]).toMatchObject({ hop: 1 });
  });

  it("names the gap for a recorded contract with no deploy transaction", async () => {
    const t = await trace(CHAIN, { ...INPUTS, deployments: [...INPUTS.deployments, { contract: "MarketCalendar", address: ROUTER, tx: "" }] });
    expect(t.gaps).toEqual(["deployments/README.md gives no transaction for MarketCalendar, so its deployer is not known."]);
  });

  it("reads the vault and the nonces at the block it traces to", async () => {
    const seen = newRpcLog();
    await traceTeam(proofChainRpc(CHAIN, seen), INPUTS, HEAD);
    expect(new Set(seen.calls.map((c) => c.block))).toEqual(new Set([`0x${HEAD.toString(16)}`]));
    expect(seen.calls.map((c) => c.functionName)).toEqual(["owner", "executor", "payees"]);
  });
});

const INBOX: Address = "0x00000000000000000000000000000000000B0001";
const OUTSIDER: Address = "0x00000000000000000000000000000000000f0008";
const OUTSIDER_KID: Address = "0x00000000000000000000000000000000000f0009";
const NEWBIE: Address = "0x00000000000000000000000000000000000f000a";
const PLAIN: Address = "0x00000000000000000000000000000000000f000b";
/** A contract the owner calls, which calls the vault's syncMultiplier on a multiplier change and moves the owner's TOKEN. */
const MULTI: Address = "0x00000000000000000000000000000000000c0002";

/** After the owner's six committed transactions: it hands the executor the role, and the executor sends 3 Decisions. */
const HANDOVER: FakeTx[] = [
  { hash: txHash(20), from: OWNER, nonce: 6, to: VAULT, block: 62_000_095n, logs: [executorSetLog(VAULT, EXECUTOR)] },
  ...[0, 1, 2].map((i) => ({ hash: txHash(21 + i), from: EXECUTOR, nonce: i, to: VAULT, block: 62_000_100n + BigInt(i), logs: [decisionLog(VAULT, i + 1, USDC)] })),
];
/** An outsider calls notifyRevenue, which anyone may call, and moves a token of its own in the same transaction. */
const OUTSIDE_CALL: FakeTx = {
  hash: txHash(24),
  from: OUTSIDER,
  nonce: 0,
  to: VAULT,
  block: 62_000_110n,
  logs: [revenueLog(VAULT), transferLog(TOKEN, OUTSIDER, OUTSIDER_KID)],
};
/** The owner's call through MULTI: a vault log and a Transfer of the owner's TOKEN to NEWBIE. */
const MULTI_CALL: FakeTx = {
  hash: txHash(25),
  from: OWNER,
  nonce: 7,
  to: MULTI,
  block: 62_000_120n,
  logs: [multiplierLog(VAULT, TOKEN), transferLog(TOKEN, OWNER, NEWBIE)],
};
/** The owner sends ETH to PLAIN: no log at all. */
const plainSend = (nonce: number): FakeTx => ({ hash: txHash(26), from: OWNER, nonce, to: PLAIN, value: 1n, block: 62_000_130n });
/** `n` outsiders each send 1 USDC unit to the vault and call notifyRevenue: one RevenueReceived log each. */
const revenueSpam = (n: number): FakeTx[] =>
  Array.from({ length: n }, (_, i) => ({ hash: txHash(1000 + i), from: `0x${(0x5000 + i).toString(16).padStart(40, "0")}` as Address, nonce: 0, to: VAULT, block: 62_000_200n + BigInt(i), logs: [revenueLog(VAULT)] }));
const withTxs = (...extra: FakeTx[]): ProofChain => ({ ...CHAIN, vault: { ...CHAIN.vault!, executor: EXECUTOR }, txs: [...TXS, ...extra] });
const SENDS_COMMAND = (w: Address) => `node scripts/recount.mjs --sends ${lower(w)} --rpc https://mainnet.base.org --logs-rpc https://base-rpc.publicnode.com`;
const missing = (w: Address, n: number, k: number) =>
  `${lower(w)} sent ${n} transactions by block 62,120,000, and ${k} ${k === 1 ? "is" : "are"} missing: in no vault or MaatInbox log the trace reads, and not in web/content/proof-sends.ts. ${SENDS_COMMAND(w)} prints ${k === 1 ? "it" : "them"}.`;

describe("the sends the trace finds from the vault's logs and the inbox's briefs", () => {
  it("is complete with the committed lists as they are while the executor sends Decisions and the owner sent setExecutor", async () => {
    const t = await trace(withTxs(...HANDOVER));
    expect(t.gaps).toEqual([]);
    expect(byAddress(t)[lower(EXECUTOR)]).toMatchObject({ hop: 0, why: ["web/content/proof-team.ts (agent executor)", "the vault's executor()"] });
  });

  it("names the wallet and how many sends are missing when a send left no vault or inbox log and is not committed", async () => {
    const t = await trace(withTxs(...HANDOVER, plainSend(7)));
    expect(t.gaps).toEqual([missing(OWNER, 8, 1)]);
    expect(teamLines(t)).toContain(`Incomplete: ${missing(OWNER, 8, 1)}`);
    // The missing send is not read, so the wallet it paid is not on the team.
    expect(byAddress(t)[lower(PLAIN)]).toBeUndefined();
  });

  it("never counts an outsider's vault log toward a team wallet, nor lets it cover a missing team send", async () => {
    const t = await trace(withTxs(...HANDOVER, plainSend(7), OUTSIDE_CALL));
    expect(t.gaps).toEqual([missing(OWNER, 8, 1)]);
    const m = byAddress(t);
    expect(m[lower(OUTSIDER)]).toBeUndefined();
    expect(m[lower(OUTSIDER_KID)]).toBeUndefined();
    expect(teamLines(t).join("\n")).not.toContain(txHash(24));
  });

  it("reads no transaction of an outsider's notifyRevenue, however many there are", async () => {
    const reads = async (n: number) => {
      const seen = newRpcLog();
      const t = await traceTeam(proofChainRpc(withTxs(...HANDOVER, ...revenueSpam(n)), seen), INPUTS, HEAD);
      expect(t.gaps).toEqual([]);
      return txReads(seen);
    };
    // Anyone may make the vault emit RevenueReceived, so its logs are not read: spam costs the trace nothing.
    expect(await reads(50)).toBe(await reads(0));
  });

  it("takes a team send whose only vault log is RevenueReceived from the committed list alone", async () => {
    const revenue: FakeTx = { hash: txHash(29), from: OWNER, nonce: 7, to: VAULT, block: 62_000_125n, logs: [revenueLog(VAULT)] };
    expect((await trace(withTxs(...HANDOVER, revenue))).gaps).toEqual([missing(OWNER, 8, 1)]);
    const listed = { ...INPUTS, sends: [{ wallet: OWNER, txs: [...[1, 2, 3, 4, 5, 6].map(txHash), txHash(29)] }, ...INPUTS.sends.slice(1)] };
    expect((await trace(withTxs(...HANDOVER, revenue), listed)).gaps).toEqual([]);
  });

  it("reads a send found from the vault's logs like a committed one, so a Transfer in it adds a wallet at hop 1", async () => {
    const t = await trace(withTxs(...HANDOVER, MULTI_CALL));
    expect(t.gaps).toEqual([]);
    expect(byAddress(t)[lower(NEWBIE)]).toEqual({ address: lower(NEWBIE), hop: 1, why: [`${lower(TOKEN)} from ${lower(OWNER)} in ${txHash(25)}`] });
  });

  it("counts a send that is both committed and in the vault's logs once", async () => {
    const both = { ...INPUTS, sends: [{ wallet: OWNER, txs: [...[1, 2, 3, 4, 5, 6].map(txHash), txHash(20)] }, ...INPUTS.sends.slice(1)] };
    // Counted twice, the setExecutor send would hide the plain send the list and the logs both lack.
    expect((await trace(withTxs(...HANDOVER, plainSend(7)), both)).gaps).toEqual([missing(OWNER, 8, 1)]);
    const t = await trace(withTxs(...HANDOVER, MULTI_CALL), both);
    expect(t.gaps).toEqual([]);
    expect(byAddress(t)[lower(NEWBIE)]?.why).toEqual([`${lower(TOKEN)} from ${lower(OWNER)} in ${txHash(25)}`]);
  });

  it("takes a brief as a send of its sender, and only when that wallet sent its transaction", async () => {
    const brief = (n: number, from: Address, nonce: number): FakeTx => ({ hash: txHash(n), from, nonce, to: INBOX, block: 62_000_140n + BigInt(n) });
    const chain = withTxs(...HANDOVER, plainSend(7), brief(27, EXECUTOR, 3), brief(28, OUTSIDER, 0));
    const briefs = [
      { from: EXECUTOR, txHash: txHash(27) },
      // A Brief that names the owner, in a transaction another wallet sent: it is not one of the owner's sends.
      { from: OWNER, txHash: txHash(28) },
    ];
    // The caller may hand the trace its Brief scan while that scan is still being read.
    const t = await trace(chain, { ...INPUTS, briefScan: Promise.resolve({ briefs, complete: true }) });
    expect(t.gaps).toEqual([missing(OWNER, 8, 1)]);
  });

  it("says a missing send may be a brief in the Brief logs that could not be read", async () => {
    const t = await trace(withTxs(...HANDOVER, plainSend(7)), { ...INPUTS, briefScan: { briefs: [], complete: false } });
    expect(t.gaps).toEqual([
      `${lower(OWNER)} sent 8 transactions by block 62,120,000, and 1 is missing: in no vault log the trace reads, in no Brief log that could be read, and not in web/content/proof-sends.ts. It may be a brief in the blocks that could not be read; ${SENDS_COMMAND(OWNER)} reads every Brief log and prints any send the list needs.`,
    ]);
  });

  it("reads the vault's logs 16 windows of 50,000 blocks at a time", async () => {
    // 40 windows from the vault's deploy block; each answer is held a little, so the windows in flight overlap.
    const c = { ...withTxs(...HANDOVER), head: 62_000_000n + 40n * 50_000n - 1n };
    const base = proofChainRpc(c);
    let now = 0;
    let most = 0;
    const rpc = async (method: string, params: unknown[]) => {
      if (method !== "eth_getLogs") return base(method, params);
      most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 5));
      now -= 1;
      return base(method, params);
    };
    const t = await traceTeam(rpc, INPUTS, c.head);
    expect(t.gaps).toEqual([]);
    expect(team.LOG_WORKERS).toBe(16);
    expect(most).toBe(16);
  });

  it("reads the vault's transactions 25 at a time, so 50 calls fill one batch of the page's client", async () => {
    // The executor sends 100 Decisions; each transaction and receipt answer is held a little, so the reads overlap.
    const decisions = Array.from({ length: 100 }, (_, i) => ({
      hash: txHash(3000 + i),
      from: EXECUTOR,
      nonce: i,
      to: VAULT,
      block: 62_000_100n + BigInt(i),
      logs: [decisionLog(VAULT, i + 1, USDC)],
    }));
    const c = { ...withTxs(HANDOVER[0]!, ...decisions) };
    const base = proofChainRpc(c);
    let now = 0;
    let most = 0;
    const rpc = async (method: string, params: unknown[]) => {
      if (method !== "eth_getTransactionByHash") return base(method, params);
      most = Math.max(most, ++now);
      await new Promise((r) => setTimeout(r, 5));
      now -= 1;
      return base(method, params);
    };
    const t = await traceTeam(rpc, INPUTS, c.head);
    expect(t.gaps).toEqual([]);
    expect(team.READ_WORKERS).toBe(25);
    expect(most).toBe(25);
  });

  it("stops on a chunk of the vault's logs it cannot read", async () => {
    const chain = { ...withTxs(...HANDOVER), failLogs: [{ from: 62_000_000n, to: 62_000_200n, address: VAULT }] };
    await expect(trace(chain)).rejects.toThrow("upstream request timed out");
  });

  it("gives the vault's Decisions it read, with each one's sender, recipient, calldata and verdict, and the vault's owner()", async () => {
    const refused: FakeTx = { hash: txHash(27), from: EXECUTOR, nonce: 3, to: VAULT, block: 62_000_140n, input: "0x4AD3993F", logs: [decisionLog(VAULT, 9, USDC, { allowed: false, reason: 6 })] };
    const t = await trace(withTxs(...HANDOVER, MULTI_CALL, OUTSIDE_CALL, refused));
    expect([t.vault, t.owner]).toEqual([lower(VAULT), lower(OWNER)]);
    // Only Decision logs: setExecutor, the multiplier change and the outsider's RevenueReceived are not Decisions.
    expect(t.decisions).toEqual([
      ...[0, 1, 2].map((i) => ({ txHash: txHash(21 + i), block: 62_000_100n + BigInt(i), logIndex: 0, from: lower(EXECUTOR), to: lower(VAULT), input: "0x", allowed: true, reason: 0 })),
      { txHash: txHash(27), block: 62_000_140n, logIndex: 0, from: lower(EXECUTOR), to: lower(VAULT), input: "0x4ad3993f", allowed: false, reason: 6 },
    ]);
  });

  it("reads no Decision, and gives no vault, when the table gives no deploy transaction for the vault", async () => {
    const t = await trace(withTxs(...HANDOVER), { ...INPUTS, deployments: INPUTS.deployments.map((r) => (r.contract === "MandateVault" ? { ...r, tx: "" } : r)) });
    expect([t.vault, t.owner, t.decisions]).toEqual([null, null, []]);
  });

  it("stops rather than label a Decision whose transaction the RPC gives no calldata for", async () => {
    const rpc = proofChainRpc(withTxs(...HANDOVER));
    const noInput = async (method: string, params: unknown[]) => {
      const out = await rpc(method, params);
      if (method !== "eth_getTransactionByHash" || out === null) return out;
      const { input: _input, ...rest } = out as { input: string };
      return rest;
    };
    await expect(traceTeam(noInput, INPUTS, HEAD)).rejects.toThrow(`the RPC gives no calldata for ${txHash(21)}, which left a Decision log`);
  });

  it("gives --sends the sends the logs cover, in nonce order, from the same reads", async () => {
    const chain = withTxs(...HANDOVER, MULTI_CALL, plainSend(8), OUTSIDE_CALL);
    const covered = await team.loggedSends(proofChainRpc(chain), INPUTS, OWNER, HEAD);
    expect(covered).toEqual([
      { hash: txHash(20), nonce: 6n, block: 62_000_095n },
      { hash: txHash(25), nonce: 7n, block: 62_000_120n },
    ]);
    expect(await team.loggedSends(proofChainRpc(chain), INPUTS, EXECUTOR, HEAD)).toEqual(
      [0, 1, 2].map((i) => ({ hash: txHash(21 + i), nonce: BigInt(i), block: 62_000_100n + BigInt(i) })),
    );
  });
});

describe("what the trace hard-codes, since the script has no keccak", () => {
  it("uses the vault's selectors and the token event topics", () => {
    const vault = parseAbi(["function owner() view returns (address)", "function executor() view returns (address)", "function payees() view returns (address[])"]);
    expect(team.OWNER_SELECTOR).toBe(toFunctionSelector(vault[0]));
    expect(team.EXECUTOR_SELECTOR).toBe(toFunctionSelector(vault[1]));
    expect(team.PAYEES_SELECTOR).toBe(toFunctionSelector(vault[2]));
    expect(team.TRANSFER_TOPIC).toBe(keccak256(toBytes("Transfer(address,address,uint256)")));
    expect(team.APPROVAL_TOPIC).toBe(keccak256(toBytes("Approval(address,address,uint256)")));
    expect(team.APPROVAL_FOR_ALL_TOPIC).toBe(keccak256(toBytes("ApprovalForAll(address,address,bool)")));
    expect(team.DECISION_TOPIC).toBe(keccak256(toBytes("Decision(bytes32,uint8,address,uint256,bool,uint8,bytes32)")));
  });

  it("reads every event of MandateVault's ABI but RevenueReceived, which anyone can make the vault emit", () => {
    const events = (abi.MandateVault as unknown as Abi).filter((e): e is AbiEvent => e.type === "event");
    expect(events.map((e) => e.name)).toContain("RevenueReceived");
    expect([...team.VAULT_TOPICS].sort()).toEqual(events.filter((e) => e.name !== "RevenueReceived").map((e) => toEventSelector(e)).sort());
  });
});

describe("the committed team lists", () => {
  it("lists the owner's sent transactions in nonce order, with every deploy in deployments/README.md among them", () => {
    const owner = PROOF_SENDS.find((s) => lower(s.wallet) === lower(OWNER));
    // Nonces 0 to 8, then nonce 10; nonce 9, the setExecutor, left an ExecutorSet log of the vault.
    expect(owner?.txs).toHaveLength(10);
    const txs = (owner?.txs ?? []).map(lower);
    const rows = docsData.deployments.filter((r) => r.network === "Base mainnet" && r.tx !== "");
    const deploys = rows.map((r) => lower(r.tx));
    // The owner deployed every row, in table order: Deploy.s.sol's four contracts at nonces 0 to 3, MaatInbox at nonce 10.
    expect(txs.filter((t) => deploys.includes(t))).toEqual(deploys);
    expect(txs.slice(0, 4)).toEqual(deploys.slice(0, 4));
    expect(txs.at(-1)).toBe(lower(rows.find((r) => r.contract === "MaatInbox")?.tx ?? ""));
    expect(new Set(PROOF_SENDS.map((s) => lower(s.wallet))).size).toBe(PROOF_SENDS.length);
  });

  it("has no hop stop yet beyond the vault and the zero address, which the trace adds itself", () => {
    expect(PROOF_STOPS).toEqual([]);
  });

  it("gives the trace inputs it accepts", async () => {
    const c: ProofChain = { ...CHAIN, vault: undefined, txs: [], tokenLogs: [] };
    const sends = PROOF_SENDS.map((s) => ({ ...s, txs: [] }));
    const t = await traceTeam(proofChainRpc(c), { team: PROOF_TEAM, sends, stops: PROOF_STOPS, deployments: [] }, HEAD);
    expect(t.members.map((m) => m.address)).toEqual(PROOF_TEAM.map((w) => lower(w.address)));
  });
});
