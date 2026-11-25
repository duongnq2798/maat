// @vitest-environment node
import { getAddress, keccak256, parseAbi, toBytes, toFunctionSelector, type Address } from "viem";
import { describe, expect, it } from "vitest";
import * as team from "@/app/(site)/proof/team";
import { teamLines, traceTeam, type TeamInputs } from "@/app/(site)/proof/team";
import { PROOF_SENDS } from "@/content/proof-sends";
import { PROOF_STOPS } from "@/content/proof-stops";
import { PROOF_TEAM } from "@/content/proof-team";
import addresses from "@/content/generated/base-addresses.json";
import { docsData } from "@/lib/docs/generated";
import { approvalLog, newRpcLog, proofChainRpc, transferLog, txHash, type FakeTx, type ProofChain } from "./helpers/fake-proof-chain";

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
      `web/content/proof-sends.ts lists 0 of the 1 transactions ${lower(FUNDED)} sent by block 62,120,000; node scripts/recount.mjs --sends ${lower(FUNDED)} prints them.`,
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

  it("refuses a committed transaction that is not that wallet's at that nonce", async () => {
    const swapped = { ...INPUTS, sends: [{ wallet: OWNER, txs: [txHash(2), txHash(1), ...[3, 4, 5, 6].map(txHash)] }, ...INPUTS.sends.slice(1)] };
    await expect(trace(CHAIN, swapped)).rejects.toThrow(`web/content/proof-sends.ts: ${txHash(2)} is not transaction 0 of ${lower(OWNER)}`);
  });

  it("notes a wallet with code, whose ETH can leave inside another wallet's transaction", async () => {
    const t = await trace({ ...CHAIN, vault: { ...CHAIN.vault!, payees: [OWNER, SMART] } });
    expect(byAddress(t)[lower(SMART)]).toMatchObject({ hop: 0, why: ["on the vault's payees()"] });
    expect(t.notes).toEqual([`${lower(SMART)} has code at block 62,120,000, so ETH it sends inside a transaction another wallet sent is not seen.`]);
    expect(t.gaps).toEqual([]);
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

describe("what the trace hard-codes, since the script has no keccak", () => {
  it("uses the vault's selectors and the token event topics", () => {
    const vault = parseAbi(["function owner() view returns (address)", "function executor() view returns (address)", "function payees() view returns (address[])"]);
    expect(team.OWNER_SELECTOR).toBe(toFunctionSelector(vault[0]));
    expect(team.EXECUTOR_SELECTOR).toBe(toFunctionSelector(vault[1]));
    expect(team.PAYEES_SELECTOR).toBe(toFunctionSelector(vault[2]));
    expect(team.TRANSFER_TOPIC).toBe(keccak256(toBytes("Transfer(address,address,uint256)")));
    expect(team.APPROVAL_TOPIC).toBe(keccak256(toBytes("Approval(address,address,uint256)")));
    expect(team.APPROVAL_FOR_ALL_TOPIC).toBe(keccak256(toBytes("ApprovalForAll(address,address,bool)")));
  });
});

describe("the committed team lists", () => {
  it("lists the owner's sent transactions, the first four being the deploys in deployments/README.md", () => {
    const owner = PROOF_SENDS.find((s) => lower(s.wallet) === lower(OWNER));
    expect(owner?.txs).toHaveLength(9);
    const deploys = docsData.deployments.filter((r) => r.network === "Base mainnet" && r.tx !== "").map((r) => lower(r.tx));
    expect(owner?.txs.slice(0, 4).map(lower)).toEqual(deploys.slice(0, 4));
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
