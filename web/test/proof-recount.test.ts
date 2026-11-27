// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { encodeFunctionResult, keccak256, toBytes, toFunctionSelector, type Address, type Hash, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { countBriefs, countDecisions, proofLines, reportLines, type ProofLists } from "@/app/(site)/proof/count";
import { readProof } from "@/app/(site)/proof/load";
import { DECISION_NOTE, DECISION_TOPIC, TEAM_SET_NOTE, teamLines } from "@/app/(site)/proof/team";
import { COINBASE_INDEXER, EAS_ADDRESS, easAbi, indexerAbi, VERIFIED_ACCOUNT_SCHEMA, type Attestation } from "@/app/(site)/proof/verified";
import type { TeamWallet } from "@/content/proof-team";
import { memoryStorage, saveCache } from "@/lib/chain/cache";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { senderLabel } from "@/lib/chain/ledger";
import { canon, decodeExecuteInput, EXECUTE_SELECTOR } from "@/lib/chain/rationale";
import { parseSnapshot, snapshotId } from "@/lib/chain/snapshot";
import { parseDeployments } from "@/lib/docs/docs-data";
import * as recount from "../../scripts/recount.mjs";
import {
  decisionLog,
  executorSetLog,
  multiplierLog,
  proofChainClient,
  revenueLog,
  serveProofChain,
  transferLog,
  txReads,
  vaultSnapshot,
  type FakeTx,
  type ProofChain,
  type ProofRpcLog,
} from "./helpers/fake-proof-chain";
import { AGENT_TEST_SUFFIX, executeCalldata, txInput, VECTORS } from "./helpers/maat-v1";
import { REPO_ROOT, readRepo } from "./helpers/solidity";

// Each case starts node; on a busy machine that alone can take seconds.
vi.setConfig({ testTimeout: 60_000 });

const run = promisify(execFile);
const SCRIPT = join(REPO_ROOT, "scripts", "recount.mjs");

const INBOX: Address = "0x00000000000000000000000000000000000B0001";
const VAULT: Address = "0x00000000000000000000000000000000000B0002";
const DEPLOY_TX: Hash = `0x${"d1".repeat(32)}`;
const VAULT_TX: Hash = `0x${"d2".repeat(32)}`;
const FUND_TX: Hash = `0x${"f1".repeat(32)}`;
const DEPLOY = 62_000_000n;
const HEAD = DEPLOY + 120_000n;
const OWNER: Address = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
const EXECUTOR: Address = "0x9bC6E49d42e0659f3ef667B09B67506B348e115A";
const ALICE: Address = "0x00000000000000000000000000000000000A11cE";
const BOB: Address = "0x0000000000000000000000000000000000000B0b";
const CAROL: Address = "0x000000000000000000000000000000000000ca01";
/** A wallet the owner sent ETH to: hop 1 of the team set, so its briefs are team briefs. */
const FUNDED: Address = "0x00000000000000000000000000000000000f0001";
/** A wallet the owner sent a token to, in a send the vault's logs give: hop 1 as well. */
const KID: Address = "0x00000000000000000000000000000000000f0002";
/** On the vault's payees(), so on the team. */
const PAYEE: Address = "0x00000000000000000000000000000000000e0001";
/** An outsider who calls the vault's notifyRevenue, which anyone may call. */
const DAVE: Address = "0x000000000000000000000000000000000000da7e";
const TOKEN: Address = "0x00000000000000000000000000000000000c0001";
/** A contract the owner calls, which calls the vault's syncMultiplier on a multiplier change and moves the owner's TOKEN. */
const MULTI: Address = "0x00000000000000000000000000000000000c0002";
const SET_EXECUTOR_TX: Hash = `0x${"e1".repeat(32)}`;
const MULTI_TX: Hash = `0x${"e2".repeat(32)}`;
const DECISION_TXS: Hash[] = ["e3", "e4", "e5"].map((b) => `0x${b.repeat(32)}` as Hash);
const REVENUE_TX: Hash = `0x${"e6".repeat(32)}`;
const UID_ALICE: Hex = `0x${"a1".repeat(32)}`;
const UID_BOB: Hex = `0x${"b0".repeat(32)}`;
const ZERO32: Hex = `0x${"0".repeat(64)}`;
const lower = (a: string) => a.toLowerCase();

const attestation = (uid: Hex, recipient: Address, over: Partial<Attestation> = {}): Attestation => ({
  uid,
  schema: VERIFIED_ACCOUNT_SCHEMA,
  time: 1_795_000_000n,
  expirationTime: 0n,
  revocationTime: 0n,
  refUID: ZERO32,
  recipient,
  attester: "0x357458739F90461b99789350868CD7CF330Dd7EE",
  revocable: true,
  data: `0x${"0".repeat(63)}1`,
  ...over,
});

/**
 * The owner deploys the vault and the inbox and sends ETH to FUNDED: the three sends of its committed list, which
 * leave no vault log. Then it hands the executor the role with setExecutor and calls MULTI, which logs on the vault
 * and moves the owner's TOKEN to KID; the executor sends three Decisions; and DAVE, an outsider, calls notifyRevenue.
 * Those leave vault logs, and no list holds them. Each brief is a send of its sender as well.
 */
const TXS: FakeTx[] = [
  { hash: VAULT_TX, from: OWNER, nonce: 0, to: null, block: DEPLOY - 10n, contractAddress: VAULT },
  { hash: DEPLOY_TX, from: OWNER, nonce: 1, to: null, block: DEPLOY, contractAddress: INBOX },
  { hash: FUND_TX, from: OWNER, nonce: 2, to: FUNDED, value: 10n ** 15n, block: DEPLOY + 5n },
  { hash: SET_EXECUTOR_TX, from: OWNER, nonce: 3, to: VAULT, block: DEPLOY + 6n, logs: [executorSetLog(VAULT, EXECUTOR)] },
  { hash: MULTI_TX, from: OWNER, nonce: 4, to: MULTI, block: DEPLOY + 7n, logs: [multiplierLog(VAULT, TOKEN), transferLog(TOKEN, OWNER, KID)] },
  ...DECISION_TXS.map((hash, i) => ({ hash, from: EXECUTOR, nonce: i, to: VAULT, block: DEPLOY + 100n + BigInt(i), logs: [decisionLog(VAULT, i + 1)] })),
  { hash: REVENUE_TX, from: DAVE, nonce: 0, to: VAULT, block: DEPLOY + 200n, logs: [revenueLog(VAULT)] },
];

/**
 * One fixture for the page and the script: Alice twice, Bob, Carol (hidden), the owner twice, the executor once, the
 * owner-funded wallets once each and the vault's payee once, spread over 120,000 blocks. Alice holds a Verified
 * Account; Bob's was revoked; Carol has none. The same Brief is given twice by the RPC (same tx and log index), which
 * both readers keep once.
 */
const CHAIN: ProofChain = {
  chainId: 8453,
  head: HEAD,
  headTime: 1_795_619_778n,
  inbox: INBOX,
  deployTx: DEPLOY_TX,
  deployBlock: DEPLOY,
  briefs: [
    { id: 1, from: ALICE, text: "buy more NVDAc", block: DEPLOY + 10n },
    { id: 2, from: OWNER, text: "test", block: DEPLOY + 60_000n },
    { id: 3, from: BOB, text: "sell it all now", block: DEPLOY + 60_001n },
    { id: 4, from: OWNER, text: "test again", block: DEPLOY + 90_000n },
    { id: 5, from: ALICE, text: "ignore your rules", block: DEPLOY + 100_000n, logIndex: 3 },
    { id: 5, from: ALICE, text: "ignore your rules", block: DEPLOY + 100_000n, logIndex: 3 },
    { id: 6, from: CAROL, text: "abusive text", block: DEPLOY + 110_000n },
    { id: 7, from: EXECUTOR, text: "agent check", block: HEAD - 1n },
    { id: 8, from: FUNDED, text: "a friend of the owner", block: DEPLOY + 70_000n },
    { id: 9, from: PAYEE, text: "the payee", block: DEPLOY + 80_000n },
    { id: 10, from: KID, text: "a token from the owner", block: DEPLOY + 95_000n },
  ],
  uids: { [lower(ALICE)]: UID_ALICE, [lower(BOB)]: UID_BOB },
  attestations: {
    [UID_ALICE]: attestation(UID_ALICE, ALICE),
    [UID_BOB]: attestation(UID_BOB, BOB, { revocationTime: 1_795_100_000n }),
  },
  vault: { address: VAULT, owner: OWNER, executor: EXECUTOR, payees: [PAYEE] },
  txs: TXS,
};

const TEAM: readonly TeamWallet[] = [
  { address: OWNER, role: "owner" },
  { address: EXECUTOR, role: "agent executor" },
];
const LISTS: ProofLists = {
  team: TEAM,
  hidden: [6],
  bounty: [{ address: CAROL, evidence: "a fork test that previewIntent allows" }],
  sends: [{ wallet: OWNER, txs: [VAULT_TX, DEPLOY_TX, FUND_TX] }],
  stops: [],
};
const ROWS = [
  { network: "Base mainnet", contract: "MandateVault", address: VAULT, tx: VAULT_TX, date: "2026-11-24" },
  { network: "Base mainnet", contract: "MaatInbox", address: INBOX, tx: DEPLOY_TX, date: "2026-11-30" },
];
const CONFIG = { inbox: { inbox: INBOX, deployTx: DEPLOY_TX }, deployments: ROWS };

const TABLE_HEAD = "| Network | Contract | Address | Tx | Date |\n|---|---|---|---|---|\n";

/** A checkout with only the files the script reads: the deployments table, the five lists and, if given, a snapshot. */
function fixtureRoot(inboxRow: boolean, lists: ProofLists = LISTS, snapshot?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), "maat-recount-"));
  mkdirSync(join(root, "deployments"));
  mkdirSync(join(root, "web", "content"), { recursive: true });
  const row = (r: (typeof ROWS)[number]) => `| ${r.network} | ${r.contract} | [\`${r.address}\`](https://basescan.org/address/${r.address}) | [\`${r.tx}\`](https://basescan.org/tx/${r.tx}) | ${r.date} |\n`;
  const rows = ROWS.filter((r) => inboxRow || r.contract !== "MaatInbox").map(row).join("");
  writeFileSync(join(root, "deployments", "README.md"), `# Deployments\n\n${TABLE_HEAD}${rows}\nText after the table.\n`);
  writeFileSync(join(root, "web", "package.json"), JSON.stringify({ type: "module" }));
  const ts = (name: string, value: unknown) => `export const ${name}: readonly unknown[] = ${JSON.stringify(value)};\n`;
  writeFileSync(join(root, "web", "content", "proof-team.ts"), ts("PROOF_TEAM", lists.team));
  writeFileSync(join(root, "web", "content", "ask-hidden.ts"), ts("HIDDEN_BRIEFS", lists.hidden));
  writeFileSync(join(root, "web", "content", "proof-bounty.ts"), ts("PROOF_BOUNTY", lists.bounty));
  writeFileSync(join(root, "web", "content", "proof-sends.ts"), ts("PROOF_SENDS", lists.sends));
  writeFileSync(join(root, "web", "content", "proof-stops.ts"), ts("PROOF_STOPS", lists.stops));
  if (snapshot !== undefined) {
    mkdirSync(join(root, "web", "content", "generated"));
    writeFileSync(join(root, "web", "content", "generated", "decisions-snapshot.json"), JSON.stringify(snapshot));
  }
  roots.push(root);
  return root;
}

/** Runs the script and returns its exit code and output; a failing exit does not throw. */
async function recountRun(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof err.code === "number" ? err.code : 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** The report's first line: the rule's first line, Owner by hand. */
const FIRST_LINE = "Owner by hand Decisions: ";
/** The report lines of the script's output: from its first line to the end. */
const reportOf = (stdout: string) => {
  const lines = stdout.replace(/\r\n/g, "\n").trimEnd().split("\n");
  return lines.slice(lines.findIndex((l) => l.startsWith(FIRST_LINE)));
};
/** The lines printed before the report. */
const preambleOf = (stdout: string) => {
  const lines = stdout.replace(/\r\n/g, "\n").trimEnd().split("\n");
  return lines.slice(0, lines.findIndex((l) => l.startsWith(FIRST_LINE)));
};
/** The report the page gives for one read, which the script must print. */
const pageLines = (p: Awaited<ReturnType<typeof readProof>>) => reportLines(p.count, p.verified, p.complete ? "counted" : "incomplete", p.team, p.decisions);
/** CHAIN's three Decisions: the executor's bare calls to the vault, all allowed, so all agent Decisions. */
const DECISION_LINES = ["Owner by hand Decisions: 0 (0 allowed, 0 refused)", "Agent Decisions: 3 (3 allowed, 0 refused)", "Probe Decisions: 0 (0 allowed, 0 refused)"];
const BRIEF_DRIVEN_NONE = "Brief-driven Decisions: 0 (0 allowed, 0 refused)";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

describe("node scripts/recount.mjs prints the numbers the page computes, from the chain alone", () => {
  let rpc: Awaited<ReturnType<typeof serveProofChain>>;
  let root: string;
  beforeAll(async () => {
    rpc = await serveProofChain(CHAIN);
    root = fixtureRoot(true);
  });
  afterAll(() => rpc.close());

  it("gives the same report as the page on one fixture, whose team sends the committed list lacks are in the vault's logs", async () => {
    const page = await readProof(proofChainClient(CHAIN), CONFIG, LISTS);
    expect(page.problems).toEqual([]);
    expect(page.complete).toBe(true);
    expect(page.head).toBe(HEAD);
    const expected = pageLines(page);
    expect(expected.slice(0, 13)).toEqual([
      ...DECISION_LINES,
      "Outside briefs: 4",
      "Outside wallets: 3",
      "Outside wallets with a Verified Account: 1",
      BRIEF_DRIVEN_NONE,
      "Team briefs: 6",
      "Hidden briefs: 1",
      "Bounty claimants: 1",
      `Decision ${DECISION_TXS[0]} log 0 in block 62,000,100: agent, vault allowed`,
      `Decision ${DECISION_TXS[1]} log 0 in block 62,000,101: agent, vault allowed`,
      `Decision ${DECISION_TXS[2]} log 0 in block 62,000,102: agent, vault allowed`,
    ]);
    expect(expected.filter((l) => l.startsWith("Incomplete: "))).toEqual([]);

    const out = await recountRun(["--rpc", rpc.url, "--root", root]);
    expect(out.stderr).toBe("");
    expect(out.code).toBe(0);
    expect(reportOf(out.stdout)).toEqual(expected);
    expect(out.stdout).toContain(`MaatInbox ${lower(INBOX)}: Brief logs from block 62,000,000 to block 62,120,000`);
    expect(out.stdout).toContain(`MandateVault ${lower(VAULT)}: its Decision logs to block 62,120,000`);
  });

  it("puts a wallet the owner funded, and the vault's payee, on the team, in the page and in the script", async () => {
    const page = await readProof(proofChainClient(CHAIN), CONFIG, LISTS);
    expect(page.count.outsideWallets.map((w) => w.address)).toEqual([lower(ALICE), lower(BOB), lower(CAROL)]);
    expect(page.count.teamWallets.map((w) => w.address)).toEqual([lower(OWNER), lower(EXECUTOR), lower(FUNDED), lower(PAYEE), lower(KID)]);
    const out = await recountRun(["--rpc", rpc.url, "--root", root]);
    expect(out.stdout).toContain(`Team wallet ${lower(FUNDED)}: 1 brief`);
    expect(out.stdout).toContain(`Team set ${lower(FUNDED)}: hop 1, ETH from ${lower(OWNER)} in ${FUND_TX}`);
    // A send found from the vault's logs, not from the committed list, still adds the wallet it moved a token to.
    expect(out.stdout).toContain(`Team set ${lower(KID)}: hop 1, ${lower(TOKEN)} from ${lower(OWNER)} in ${MULTI_TX}`);
    expect(out.stdout).not.toContain(lower(DAVE));
    expect(out.stdout).toContain(`Team set ${lower(PAYEE)}: hop 0, on the vault's payees()`);
    expect(out.stdout).toContain(`Hop stop ${lower(VAULT)}: MandateVault (deployments/README.md)`);
  });

  it("prints the team-set note and the Decision note right before the brief lines, as the page shows them", async () => {
    const out = await recountRun(["--rpc", rpc.url, "--root", root]);
    expect(preambleOf(out.stdout).slice(-2)).toEqual([TEAM_SET_NOTE, DECISION_NOTE]);
  });

  it("asks the indexer and EAS at the block it counted to", async () => {
    const before = rpc.seen.calls.length;
    await recountRun(["--rpc", rpc.url, "--root", root]);
    const calls = rpc.seen.calls.slice(before).filter((c) => c.to === lower(COINBASE_INDEXER) || c.to === lower(EAS_ADDRESS));
    expect(calls.map((c) => c.functionName)).toEqual(["getAttestationUid", "getAttestationUid", "getAttestationUid", "getAttestation", "getAttestation"]);
    expect(new Set(rpc.seen.calls.slice(before).map((c) => c.block))).toEqual(new Set([`0x${HEAD.toString(16)}`]));
  });

  it("asks the indexer and EAS about 25 wallets at a time, as the trace reads transactions, and keeps the wallets' order", async () => {
    const wallets = Array.from({ length: 60 }, (_, i) => `0x${(0xa000 + i).toString(16).padStart(40, "0")}`);
    const uidOf = (i: number): Hex => `0x${(i + 1).toString(16).padStart(64, "0")}`;
    const most = { getAttestationUid: 0, getAttestation: 0 };
    let inFlight = 0;
    const call = async (_method: string, params: unknown[]) => {
      const { to, data } = params[0] as { to: string; data: Hex };
      const fn = to === lower(COINBASE_INDEXER) ? "getAttestationUid" : "getAttestation";
      inFlight += 1;
      most[fn] = Math.max(most[fn], inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (fn === "getAttestationUid") {
        const i = wallets.indexOf(`0x${data.slice(34, 74)}`);
        return i % 2 === 0 ? uidOf(i) : ZERO32;
      }
      const i = Number(BigInt(`0x${data.slice(10, 74)}`)) - 1;
      return encodeFunctionResult({ abi: easAbi, functionName: "getAttestation", result: attestation(uidOf(i), wallets[i] as Address) });
    };
    const out = await recount.verifiedAccounts(call, wallets, "0x1", 1_800_000_000n);
    expect([...out.keys()]).toEqual(wallets);
    expect([...out.values()]).toEqual(wallets.map((_, i) => (i % 2 === 0 ? uidOf(i) : null)));
    expect(most).toEqual({ getAttestationUid: 25, getAttestation: 25 });
  });

  it("reads no transaction of an outsider's notifyRevenue, on the page or in the recount, and still gives the same report", async () => {
    // 40 outsiders each make the vault emit RevenueReceived, as anyone may for a unit of USDC and the gas.
    const spam: FakeTx[] = Array.from({ length: 40 }, (_, i) => ({
      hash: `0x${(0x7000 + i).toString(16).padStart(64, "0")}` as Hash,
      from: `0x${(0x7000 + i).toString(16).padStart(40, "0")}` as Address,
      nonce: 0,
      to: VAULT,
      block: DEPLOY + 300n + BigInt(i),
      logs: [revenueLog(VAULT)],
    }));
    const spammed: ProofChain = { ...CHAIN, txs: [...TXS, ...spam] };
    const pageReads = async (c: ProofChain) => {
      const client = proofChainClient(c);
      const page = await readProof(client, CONFIG, LISTS);
      return { page, reads: txReads(client.seen) };
    };
    const [clean, noisy] = [await pageReads(CHAIN), await pageReads(spammed)];
    expect(noisy.page.complete).toBe(true);
    expect(noisy.reads).toBe(clean.reads);
    const [quiet, loud] = [await serveProofChain(CHAIN), await serveProofChain(spammed)];
    try {
      const out = await recountRun(["--rpc", loud.url, "--root", root]);
      expect(out.code).toBe(0);
      expect(reportOf(out.stdout)).toEqual(pageLines(noisy.page));
      expect((await recountRun(["--rpc", quiet.url, "--root", root])).code).toBe(0);
      expect(txReads(quiet.seen)).toBeGreaterThan(0);
      expect(txReads(loud.seen)).toBe(txReads(quiet.seen));
    } finally {
      await Promise.all([quiet.close(), loud.close()]);
    }
  });

  it("reads the Brief logs and the vault's logs 16 windows at a time each, as the page does", async () => {
    // Each answer waits long enough that all 16 requests of a round arrive first, even on a busy machine.
    const long: ProofChain = { ...CHAIN, head: DEPLOY + 40n * 50_000n - 1n, logDelayMs: 150 };
    const server = await serveProofChain(long);
    try {
      const out = await recountRun(["--rpc", server.url, "--root", root]);
      expect(out.code).toBe(0);
      const page = await readProof(proofChainClient(long), CONFIG, LISTS);
      expect(reportOf(out.stdout)).toEqual(pageLines(page));
      expect(server.seen.logsInFlight[lower(INBOX)]).toBe(16);
      expect(server.seen.logsInFlight[lower(VAULT)]).toBe(16);
    } finally {
      await server.close();
    }
  });

  it("counts to --to-block and no further, and takes the block as the page prints it", async () => {
    for (const block of [String(HEAD - 2n), (HEAD - 2n).toLocaleString("en-US"), "62_119_998"]) {
      const out = await recountRun(["--rpc", rpc.url, "--root", root, "--to-block", block]);
      expect(out.code).toBe(0);
      expect(reportOf(out.stdout).slice(0, 10)).toEqual([
        ...DECISION_LINES,
        "Outside briefs: 4",
        "Outside wallets: 3",
        "Outside wallets with a Verified Account: 1",
        BRIEF_DRIVEN_NONE,
        "Team briefs: 5",
        "Hidden briefs: 1",
        "Bounty claimants: 1",
      ]);
    }
    // Before the executor's first Decision, no Decision line counts one.
    const early = await recountRun(["--rpc", rpc.url, "--root", root, "--to-block", String(DEPLOY + 99n)]);
    expect(reportOf(early.stdout).slice(0, 3)).toEqual([
      "Owner by hand Decisions: 0 (0 allowed, 0 refused)",
      "Agent Decisions: 0 (0 allowed, 0 refused)",
      "Probe Decisions: 0 (0 allowed, 0 refused)",
    ]);
    expect((await recountRun(["--rpc", rpc.url, "--root", root, "--to-block", "62.1M"])).code).toBe(1);
  });
});

/** A maat:v1 blob from V5's fields with other brief ids in `q`. */
const briefBlob = (q: number[]) => `maat:v1:${canon({ ...(JSON.parse(VECTORS.V5.blob.slice(8)) as object), q })}`;
const labelledTx = (n: number) => `0x${(0xc100 + n).toString(16).padStart(64, "0")}` as Hash;
/**
 * A Decision of every label after CHAIN's three: the owner sending execute itself with a probe's blob (owner by hand,
 * first match wins), a probe, two brief-driven Decisions, and three agent ones: a model's own intent, a probe's blob that
 * is not in canonical form, and a probe's blob in a transaction to another contract, which carries no blob the vault
 * reads. Each one is a send the trace finds from the vault's logs.
 */
const LABELLED: FakeTx[] = [
  { hash: labelledTx(1), from: OWNER, nonce: 5, to: VAULT, block: DEPLOY + 110n, input: txInput(VECTORS.V4.blob), logs: [decisionLog(VAULT, 11, TOKEN, { allowed: false, reason: 6 })] },
  { hash: labelledTx(2), from: EXECUTOR, nonce: 3, to: VAULT, block: DEPLOY + 111n, input: txInput(VECTORS.V4.blob), logs: [decisionLog(VAULT, 12, TOKEN, { allowed: false, reason: 6 })] },
  { hash: labelledTx(3), from: EXECUTOR, nonce: 4, to: VAULT, block: DEPLOY + 112n, input: txInput(VECTORS.V5.blob), logs: [decisionLog(VAULT, 13)] },
  { hash: labelledTx(4), from: EXECUTOR, nonce: 5, to: VAULT, block: DEPLOY + 113n, input: txInput(briefBlob([1, 3])), logs: [decisionLog(VAULT, 14, TOKEN, { allowed: false, reason: 11 })] },
  { hash: labelledTx(5), from: EXECUTOR, nonce: 6, to: VAULT, block: DEPLOY + 114n, input: txInput(VECTORS.V1.blob, { code: null }), logs: [decisionLog(VAULT, 15, TOKEN, { allowed: false, reason: 9 })] },
  { hash: labelledTx(6), from: EXECUTOR, nonce: 7, to: VAULT, block: DEPLOY + 115n, input: txInput(VECTORS.V4.blob.replace('{"b":', '{ "b":')), logs: [decisionLog(VAULT, 16)] },
  { hash: labelledTx(7), from: EXECUTOR, nonce: 8, to: MULTI, block: DEPLOY + 116n, input: txInput(VECTORS.V4.blob), logs: [decisionLog(VAULT, 17, TOKEN, { allowed: false, reason: 6 })] },
];
const LABELLED_CHAIN: ProofChain = { ...CHAIN, txs: [...TXS, ...LABELLED] };

describe("the Decision lines, on the page and in the recount, with a Decision of every label", () => {
  it("label each Decision once, first match wins, split each line into allowed and refused, and print the same lines", async () => {
    const page = await readProof(proofChainClient(LABELLED_CHAIN), CONFIG, LISTS);
    expect(page.complete).toBe(true);
    const expected = pageLines(page);
    expect(expected.slice(0, 20)).toEqual([
      "Owner by hand Decisions: 1 (0 allowed, 1 refused)",
      "Agent Decisions: 6 (4 allowed, 2 refused)",
      "Probe Decisions: 1 (0 allowed, 1 refused)",
      "Outside briefs: 4",
      "Outside wallets: 3",
      "Outside wallets with a Verified Account: 1",
      "Brief-driven Decisions: 2 (1 allowed, 1 refused)",
      "Team briefs: 6",
      "Hidden briefs: 1",
      "Bounty claimants: 1",
      `Decision ${DECISION_TXS[0]} log 0 in block 62,000,100: agent, vault allowed`,
      `Decision ${DECISION_TXS[1]} log 0 in block 62,000,101: agent, vault allowed`,
      `Decision ${DECISION_TXS[2]} log 0 in block 62,000,102: agent, vault allowed`,
      `Decision ${labelledTx(1)} log 0 in block 62,000,110: owner by hand, vault refused`,
      `Decision ${labelledTx(2)} log 0 in block 62,000,111: probe, vault refused`,
      `Decision ${labelledTx(3)} log 0 in block 62,000,112: brief-driven citing #7, vault allowed`,
      `Decision ${labelledTx(4)} log 0 in block 62,000,113: brief-driven citing #1, #3, vault refused`,
      `Decision ${labelledTx(5)} log 0 in block 62,000,114: agent, vault refused`,
      `Decision ${labelledTx(6)} log 0 in block 62,000,115: agent, vault allowed`,
      `Decision ${labelledTx(7)} log 0 in block 62,000,116: agent, vault refused`,
    ]);
    const rpc = await serveProofChain(LABELLED_CHAIN);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true)]);
      expect([out.code, out.stderr]).toEqual([0, ""]);
      expect(reportOf(out.stdout)).toEqual(expected);
      expect(preambleOf(out.stdout).slice(-2)).toEqual([TEAM_SET_NOTE, DECISION_NOTE]);
    } finally {
      await rpc.close();
    }
  });

  it("print only the ten lines as CSV with --csv, with the page's numbers, and the same exit code", async () => {
    const page = await readProof(proofChainClient(LABELLED_CHAIN), CONFIG, LISTS);
    const fromPage = proofLines(page.count, page.verified, page.decisions).map((l) =>
      [l.label, l.value === null ? "not read" : String(l.value), l.split ? String(l.split.allowed) : "", l.split ? String(l.split.refused) : ""].join(","),
    );
    const rpc = await serveProofChain(LABELLED_CHAIN);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true), "--csv"]);
      expect([out.code, out.stderr]).toEqual([0, ""]);
      const csv = out.stdout.replace(/\r\n/g, "\n").trimEnd().split("\n");
      expect(csv).toEqual([recount.CSV_HEAD, ...fromPage]);
      expect(csv).toEqual([
        "line,count,allowed,refused",
        "Owner by hand Decisions,1,0,1",
        "Agent Decisions,6,4,2",
        "Probe Decisions,1,0,1",
        "Outside briefs,4,,",
        "Outside wallets,3,,",
        "Outside wallets with a Verified Account,1,,",
        "Brief-driven Decisions,2,1,1",
        "Team briefs,6,,",
        "Hidden briefs,1,,",
        "Bounty claimants,1,,",
      ]);
      // Incomplete: the brief lines give the word, the Decision lines keep their number, and the exit code is 1.
      const short: ProofLists = { ...LISTS, sends: [{ wallet: OWNER, txs: [VAULT_TX, DEPLOY_TX] }] };
      const incomplete = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, short), "--csv"]);
      expect(incomplete.code).toBe(1);
      expect(incomplete.stdout.replace(/\r\n/g, "\n").trimEnd().split("\n").slice(1, 5)).toEqual([
        "Owner by hand Decisions,1,0,1",
        "Agent Decisions,6,4,2",
        "Probe Decisions,1,0,1",
        "Outside briefs,incomplete,,",
      ]);
      expect(incomplete.stderr).toContain("recount: the count is incomplete: ");
      expect((await recountRun(["--rpc", rpc.url, "--csv", "--sends", OWNER])).code).toBe(2);
    } finally {
      await rpc.close();
    }
  });

  it("give the Decision lines no number while no vault's logs were read, on the page and in the recount", () => {
    const trace = { vault: null, owner: null, decisions: [] };
    expect(countDecisions(trace)).toBeNull();
    expect(recount.countDecisions(trace)).toBeNull();
    expect(recount.reportLines(countBriefs([], LISTS), new Map(), "counted", [], null)).toEqual(reportLines(countBriefs([], LISTS), new Map(), "counted"));
  });

  it("label every trace the page labels the same way in the recount, rows included", async () => {
    const page = await readProof(proofChainClient(LABELLED_CHAIN), CONFIG, LISTS);
    const script = recount.countDecisions(page.team);
    expect(script).toEqual(page.decisions);
    // The script's default of null for its decisions makes TypeScript type the parameter as null alone.
    expect(recount.reportLines(page.count, page.verified!, "counted", teamLines(page.team), script as never)).toEqual(pageLines(page));
  });
});

/** The gap of a team wallet one send short, as the page and the recount word it. */
const ONE_MISSING = `${lower(OWNER)} sent 7 transactions by block 62,120,000, and 1 is missing: in no vault or MaatInbox log the trace reads, and not in web/content/proof-sends.ts. node scripts/recount.mjs --sends ${lower(OWNER)} --rpc https://mainnet.base.org --logs-rpc https://base-rpc.publicnode.com prints it.`;

describe("the recount when a team wallet sent a transaction that no vault or inbox log gives and its committed list does not hold", () => {
  it("prints the gap, naming the wallet and how many sends are missing, gives no number on a brief line, as the page does, and exits 1", async () => {
    // FUND_TX, a plain ETH send, leaves no log; DAVE's notifyRevenue is a vault log, but not a send of the owner's.
    const short: ProofLists = { ...LISTS, sends: [{ wallet: OWNER, txs: [VAULT_TX, DEPLOY_TX] }] };
    const rpc = await serveProofChain(CHAIN);
    try {
      const page = await readProof(proofChainClient(CHAIN), CONFIG, short);
      expect(page.complete).toBe(false);
      expect(page.problems).toEqual([ONE_MISSING]);
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, short)]);
      expect(out.code).toBe(1);
      const lines = reportOf(out.stdout);
      expect(lines).toEqual(pageLines(page));
      // The Decision lines come from the vault's logs, which were all read, so they keep their number.
      expect(lines.slice(0, 10)).toEqual([
        ...DECISION_LINES,
        "Outside briefs: incomplete",
        "Outside wallets: incomplete",
        "Outside wallets with a Verified Account: incomplete",
        BRIEF_DRIVEN_NONE,
        "Team briefs: incomplete",
        "Hidden briefs: incomplete",
        "Bounty claimants: 1",
      ]);
      expect(lines).toContain(`Incomplete: ${page.problems[0]}`);
      expect(out.stderr).toContain(`recount: the count is incomplete: ${ONE_MISSING}`);
    } finally {
      await rpc.close();
    }
  });

  it("takes a team send whose only vault log is RevenueReceived from the committed list alone, as the page does, and --sends prints it", async () => {
    // The owner calls notifyRevenue itself: its RevenueReceived log is one the trace does not read.
    const revenueTx: Hash = `0x${"e7".repeat(32)}`;
    const chain: ProofChain = { ...CHAIN, txs: [...TXS, { hash: revenueTx, from: OWNER, nonce: 5, to: VAULT, block: DEPLOY + 8n, logs: [revenueLog(VAULT)] }] };
    const gap = `${lower(OWNER)} sent 8 transactions by block 62,120,000, and 1 is missing: in no vault or MaatInbox log the trace reads, and not in web/content/proof-sends.ts. node scripts/recount.mjs --sends ${lower(OWNER)} --rpc https://mainnet.base.org --logs-rpc https://base-rpc.publicnode.com prints it.`;
    const listed: ProofLists = { ...LISTS, sends: [{ wallet: OWNER, txs: [VAULT_TX, DEPLOY_TX, FUND_TX, revenueTx] }] };
    const rpc = await serveProofChain(chain);
    try {
      const page = await readProof(proofChainClient(chain), CONFIG, LISTS);
      expect(page.problems).toEqual([gap]);
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true)]);
      expect(out.code).toBe(1);
      expect(reportOf(out.stdout)).toEqual(pageLines(page));
      const sends = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true), "--sends", OWNER]);
      expect(sends.stdout.replace(/\r\n/g, "\n").trimEnd().split("\n")).toEqual([
        `// 8 transactions sent by block 62,120,000, read from ${rpc.url}.`,
        "// 4 left a vault or MaatInbox log the team trace reads; the other 4 go in web/content/proof-sends.ts, in nonce order:",
        `  { wallet: "${lower(OWNER)}", txs: ["${VAULT_TX}", "${DEPLOY_TX}", "${FUND_TX}", "${revenueTx}"] },`,
      ]);
      expect((await readProof(proofChainClient(chain), CONFIG, listed)).complete).toBe(true);
      expect((await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, listed)])).code).toBe(0);
    } finally {
      await rpc.close();
    }
  });

  it("counts a send that is both committed and in the vault's logs once, so it hides no missing send", async () => {
    const both: ProofLists = { ...LISTS, sends: [{ wallet: OWNER, txs: [VAULT_TX, DEPLOY_TX, SET_EXECUTOR_TX] }] };
    const rpc = await serveProofChain(CHAIN);
    try {
      const page = await readProof(proofChainClient(CHAIN), CONFIG, both);
      expect(page.problems).toEqual([ONE_MISSING]);
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, both)]);
      expect(out.code).toBe(1);
      expect(reportOf(out.stdout)).toEqual(pageLines(page));
    } finally {
      await rpc.close();
    }
  });
});

/** The snapshot `npm run snapshot` would write for CHAIN at block N: every vault log from the vault's deploy block. */
const N = DEPLOY + 100_000n;
const SNAPSHOT = vaultSnapshot(CHAIN, VAULT, DEPLOY - 10n, N);
const SNAPSHOT_FILE = "web/content/generated/decisions-snapshot.json";
/** The lowest block of an eth_getLogs of the vault. */
const lowestVault = (seen: ProofRpcLog) => seen.logRanges.filter((r) => r.address === lower(VAULT)).reduce((m, r) => (r.from < m ? r.from : m), HEAD + 1n);

describe("the page and the recount, with the vault's logs from the committed snapshot and without it", () => {
  it("print the same lines either way; --snapshot reads the vault's logs only above the file's reorg window and says so", async () => {
    const root = fixtureRoot(true, LISTS, SNAPSHOT);
    const [plain, seeded] = [await serveProofChain(CHAIN), await serveProofChain(CHAIN)];
    try {
      const page = await readProof(proofChainClient(CHAIN), CONFIG, LISTS);
      const pageSeeded = await readProof(proofChainClient(CHAIN), CONFIG, LISTS, undefined, { snapshot: SNAPSHOT, storage: null });
      const expected = pageLines(page);
      expect(page.complete).toBe(true);
      expect(page.team.seed).toBeNull();
      expect(pageSeeded.team.seed).toEqual({ source: "snapshot", from: DEPLOY - 10n, to: N - 151n, anchor: N });
      expect(pageLines(pageSeeded)).toEqual(expected);
      const a = await recountRun(["--rpc", plain.url, "--root", root]);
      const b = await recountRun(["--rpc", seeded.url, "--root", root, "--snapshot"]);
      expect([a.code, b.code, a.stderr, b.stderr]).toEqual([0, 0, "", ""]);
      expect(reportOf(a.stdout)).toEqual(expected);
      expect(reportOf(b.stdout)).toEqual(expected);
      expect(lowestVault(plain.seen)).toBe(DEPLOY - 10n);
      expect(lowestVault(seeded.seen)).toBe(N - 150n);
      expect(a.stdout).not.toContain(SNAPSHOT_FILE);
      expect(preambleOf(b.stdout)).toContain(
        `Vault logs to block 62,099,849 from ${SNAPSHOT_FILE}, the snapshot of block 62,100,000: the RPC gives that block the same hash, and each log's transaction receipt holds it. The vault's other blocks, to block 62,120,000, are read from the RPC.`,
      );
      expect(preambleOf(b.stdout).slice(-2)).toEqual([TEAM_SET_NOTE, DECISION_NOTE]);
    } finally {
      await Promise.all([plain.close(), seeded.close()]);
    }
  });

  it("drop a file with an invented log, say why, read the vault's logs from its deploy block and print the same lines", async () => {
    // A Decision the vault never emitted, in the owner's plain ETH send.
    const forged = decisionLog(VAULT, 9);
    const invented = { ...SNAPSHOT, logs: [...SNAPSHOT.logs, { blockNumber: String(DEPLOY + 5n), logIndex: 0, transactionHash: FUND_TX, topics: forged.topics.map(lower), data: forged.data! }] };
    const why = `the receipt of ${FUND_TX} has no log of the vault at index 0 as the snapshot has it in block 62,000,005`;
    const rpc = await serveProofChain(CHAIN);
    try {
      const expected = pageLines(await readProof(proofChainClient(CHAIN), CONFIG, LISTS));
      const page = await readProof(proofChainClient(CHAIN), CONFIG, LISTS, undefined, { snapshot: invented, storage: null });
      expect(page.team.seed).toBeNull();
      expect(page.team.seedRejected).toBe(why);
      expect(pageLines(page)).toEqual(expected);
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, LISTS, invented), "--snapshot"]);
      expect(out.code).toBe(0);
      expect(reportOf(out.stdout)).toEqual(expected);
      expect(preambleOf(out.stdout)).toContain(`${SNAPSHOT_FILE} was not used (${why}), so the vault's logs are read from its deploy block.`);
      expect(lowestVault(rpc.seen)).toBe(DEPLOY - 10n);
    } finally {
      await rpc.close();
    }
  });

  it("read the file's blocks from the RPC when it omits a team send's vault log, say why, and print the lines of a scan from the deploy block", async () => {
    const omitted = { ...SNAPSHOT, logs: SNAPSHOT.logs.filter((l) => l.transactionHash !== SET_EXECUTOR_TX) };
    const why = `with its logs, ${lower(OWNER)} sent 7 transactions by block 62,120,000 and 1 is missing`;
    const rpc = await serveProofChain(CHAIN);
    try {
      const expected = pageLines(await readProof(proofChainClient(CHAIN), CONFIG, LISTS));
      const page = await readProof(proofChainClient(CHAIN), CONFIG, LISTS, undefined, { snapshot: omitted, storage: null });
      expect([page.complete, page.team.seed, page.team.seedRejected]).toEqual([true, null, why]);
      expect(pageLines(page)).toEqual(expected);
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, LISTS, omitted), "--snapshot"]);
      expect([out.code, out.stderr]).toEqual([0, ""]);
      expect(reportOf(out.stdout)).toEqual(expected);
      expect(preambleOf(out.stdout)).toContain(`${SNAPSHOT_FILE} was not used (${why}), so the vault's logs are read from its deploy block.`);
      expect(lowestVault(rpc.seen)).toBe(DEPLOY - 10n);
    } finally {
      await rpc.close();
    }
  });

  it("leave the count incomplete, with the same lines on the page and in the recount, with the file or without it, when a team send is in no log and no list", async () => {
    const short: ProofLists = { ...LISTS, sends: [{ wallet: OWNER, txs: [VAULT_TX, DEPLOY_TX] }] };
    const root = fixtureRoot(true, short, SNAPSHOT);
    const rpc = await serveProofChain(CHAIN);
    try {
      const page = await readProof(proofChainClient(CHAIN), CONFIG, short);
      const pageSeeded = await readProof(proofChainClient(CHAIN), CONFIG, short, undefined, { snapshot: SNAPSHOT, storage: null });
      expect([page.complete, pageSeeded.complete]).toEqual([false, false]);
      expect(pageSeeded.problems).toEqual([ONE_MISSING]);
      expect(pageLines(pageSeeded)).toEqual(pageLines(page));
      const a = await recountRun(["--rpc", rpc.url, "--root", root]);
      const b = await recountRun(["--rpc", rpc.url, "--root", root, "--snapshot"]);
      expect([a.code, b.code]).toEqual([1, 1]);
      expect(reportOf(a.stdout)).toEqual(pageLines(page));
      expect(reportOf(b.stdout)).toEqual(pageLines(page));
      expect(reportOf(b.stdout).slice(0, 4)).toEqual([...DECISION_LINES, "Outside briefs: incomplete"]);
    } finally {
      await rpc.close();
    }
  });

  it("skip a ledger cache that took its logs from a file the site no longer serves, as the ledger does, and use one of the file served", async () => {
    // The cache reaches higher than the file, and lacks the owner's setExecutor log.
    const cacheOf = (logs: typeof SNAPSHOT.logs, snapshot?: Hash) => {
      const storage = memoryStorage();
      saveCache({ v: 1, vault: VAULT, from: String(DEPLOY - 10n), to: String(HEAD - 150n), logs, blockTimes: {}, gasUsed: {}, ...(snapshot ? { snapshot } : {}) }, storage);
      return storage;
    };
    const all = vaultSnapshot(CHAIN, VAULT, DEPLOY - 10n, HEAD - 150n).logs;
    const stale = cacheOf(
      all.filter((l) => l.transactionHash !== SET_EXECUTOR_TX),
      `0x${"ab".repeat(32)}`,
    );
    const expected = pageLines(await readProof(proofChainClient(CHAIN), CONFIG, LISTS));
    const other = await readProof(proofChainClient(CHAIN), CONFIG, LISTS, undefined, { snapshot: SNAPSHOT, storage: stale });
    expect([other.complete, other.team.seed?.source]).toEqual([true, "snapshot"]);
    expect(pageLines(other)).toEqual(expected);
    const served = snapshotId(parseSnapshot(SNAPSHOT, VAULT)!);
    const same = await readProof(proofChainClient(CHAIN), CONFIG, LISTS, undefined, { snapshot: SNAPSHOT, storage: cacheOf(all, served) });
    expect([same.complete, same.team.seed?.source]).toEqual([true, "cache"]);
    expect(pageLines(same)).toEqual(expected);
    // With no file served, a cache that took its logs from one is not used either.
    const none = await readProof(proofChainClient(CHAIN), CONFIG, LISTS, undefined, { snapshot: null, storage: cacheOf(all, served) });
    expect(none.team.seed).toBeNull();
    expect(pageLines(none)).toEqual(expected);
  });

  it("say --snapshot was not used when the trace reads no block of the vault by the block counted to", async () => {
    const rpc = await serveProofChain(CHAIN);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, LISTS, SNAPSHOT), "--snapshot", "--to-block", String(DEPLOY - 20n)]);
      expect(out.code).toBe(0);
      expect(preambleOf(out.stdout)).toContain(`${SNAPSHOT_FILE} was not used: the trace reads no block of the vault by block 61,999,980, the block counted to.`);
      expect(out.stdout).not.toContain("(null)");
    } finally {
      await rpc.close();
    }
  });

  it("say when --snapshot finds no committed file, and read the vault's logs from its deploy block", async () => {
    const rpc = await serveProofChain(CHAIN);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true), "--snapshot"]);
      expect(out.code).toBe(0);
      expect(preambleOf(out.stdout)).toContain(`${SNAPSHOT_FILE} was not used (it could not be read as JSON), so the vault's logs are read from its deploy block.`);
      expect(lowestVault(rpc.seen)).toBe(DEPLOY - 10n);
    } finally {
      await rpc.close();
    }
  });
});

describe("node scripts/recount.mjs --sends", () => {
  it("prints only the sends a wallet's committed list needs: the ones no vault or inbox log gives, in nonce order", async () => {
    const rpc = await serveProofChain(CHAIN);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true), "--sends", OWNER]);
      expect(out.stderr).toBe("");
      expect(out.code).toBe(0);
      expect(out.stdout.replace(/\r\n/g, "\n").trimEnd().split("\n")).toEqual([
        `// 7 transactions sent by block 62,120,000, read from ${rpc.url}.`,
        "// 4 left a vault or MaatInbox log the team trace reads; the other 3 go in web/content/proof-sends.ts, in nonce order:",
        `  { wallet: "${lower(OWNER)}", txs: ["${VAULT_TX}", "${DEPLOY_TX}", "${FUND_TX}"] },`,
      ]);
    } finally {
      await rpc.close();
    }
  });

  it("reads eth_getLogs from --logs-rpc and every other call from --rpc, and refuses a logs RPC behind the block", async () => {
    const state = await serveProofChain(CHAIN);
    const logs = await serveProofChain(CHAIN);
    const behind = await serveProofChain({ ...CHAIN, head: HEAD - 5n });
    try {
      const out = await recountRun(["--rpc", state.url, "--logs-rpc", logs.url, "--root", fixtureRoot(true), "--sends", OWNER]);
      expect(out.code).toBe(0);
      expect(out.stdout).toContain(`// 7 transactions sent by block 62,120,000, read from ${state.url}, with eth_getLogs from ${logs.url}.`);
      expect(out.stdout).toContain(`  { wallet: "${lower(OWNER)}", txs: ["${VAULT_TX}", "${DEPLOY_TX}", "${FUND_TX}"] },`);
      expect(state.seen.methods).not.toContain("eth_getLogs");
      expect(new Set(logs.seen.methods)).toEqual(new Set(["eth_chainId", "eth_blockNumber", "eth_getLogs"]));
      const late = await recountRun(["--rpc", state.url, "--logs-rpc", behind.url, "--root", fixtureRoot(true)]);
      expect(late.code).toBe(1);
      expect(late.stderr).toContain(`the RPC ${behind.url} is at block 62119995, before block 62120000, the block counted to`);
    } finally {
      await Promise.all([state.close(), logs.close(), behind.close()]);
    }
  });

  it("says a wallet whose every send left a vault or inbox log needs no entry", async () => {
    const rpc = await serveProofChain(CHAIN);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true), "--sends", EXECUTOR]);
      expect(out.code).toBe(0);
      expect(out.stdout.replace(/\r\n/g, "\n").trimEnd().split("\n")).toEqual([
        `// 4 transactions sent by block 62,120,000, read from ${rpc.url}.`,
        "// 4 left a vault or MaatInbox log the team trace reads, so the wallet needs no entry in web/content/proof-sends.ts.",
      ]);
    } finally {
      await rpc.close();
    }
  });
});

describe("the recount on an RPC that caps eth_getLogs at 200 blocks and rate-limits, as mainnet.base.org does", () => {
  it("narrows its window, waits out the rate limit and still prints the same report", async () => {
    // A shorter chain, so the 200-block windows stay few.
    const short: ProofChain = {
      ...CHAIN,
      head: DEPLOY + 1_000n,
      briefs: CHAIN.briefs.map((b) => ({ ...b, block: DEPLOY + (b.block - DEPLOY) / 200n })),
      maxLogRange: 200n,
      rateLimitFirst: 2,
    };
    const capped = await serveProofChain(short);
    const root = fixtureRoot(true);
    try {
      const page = await readProof(proofChainClient({ ...short, maxLogRange: 50_000n }), CONFIG, LISTS);
      const out = await recountRun(["--rpc", capped.url, "--root", root]);
      expect(out.code).toBe(0);
      expect(reportOf(out.stdout)).toEqual(pageLines(page));
      expect(capped.seen.logRanges.every((r) => r.to - r.from + 1n <= 200n)).toBe(true);
    } finally {
      await capped.close();
    }
  });
});

describe("the recount's RPC client on a keyless RPC that rate-limits by the request", () => {
  /**
   * fetch of an RPC that answers in `latencyMs` and takes a request from a bucket of `capacity` that refills at
   * `perSecond`; on an empty bucket it answers HTTP 429, with Retry-After when given. Time is vi's fake clock.
   */
  function limitedRpc(opts: { capacity: number; perSecond: number; latencyMs: number; retryAfter?: string }) {
    let tokens = opts.capacity;
    let last = Date.now();
    const seen = { ok: 0, limited: 0, inFlight: 0, mostInFlightOnceLimited: 0, sentAt: [] as number[] };
    const fetchImpl = async (_url: string, init: { body: string }) => {
      const now = Date.now();
      tokens = Math.min(opts.capacity, tokens + ((now - last) / 1000) * opts.perSecond);
      last = now;
      seen.sentAt.push(now);
      seen.inFlight += 1;
      if (seen.limited > 0) seen.mostInFlightOnceLimited = Math.max(seen.mostInFlightOnceLimited, seen.inFlight);
      const allowed = tokens >= 1;
      if (allowed) tokens -= 1;
      await new Promise((r) => setTimeout(r, opts.latencyMs));
      seen.inFlight -= 1;
      if (!allowed) {
        seen.limited += 1;
        return new Response("Too Many Requests", { status: 429, headers: opts.retryAfter ? { "retry-after": opts.retryAfter } : {} });
      }
      seen.ok += 1;
      const { id, method } = JSON.parse(init.body) as { id: number; method: string };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: method }), { status: 200, headers: { "content-type": "application/json" } });
    };
    vi.stubGlobal("fetch", fetchImpl);
    return seen;
  }
  /** `p`, with the fake clock moved on until it settles. */
  async function settle<T>(p: Promise<T>): Promise<T> {
    let done = false;
    p.then(
      () => (done = true),
      () => (done = true),
    );
    while (!done) await vi.advanceTimersByTimeAsync(100);
    return p;
  }
  beforeAll(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterAll(() => vi.useRealTimers());

  it("reads 680 transactions and their receipts 25 at a time past a limit of 20 requests a second, sending fewer at once once limited", async () => {
    const seen = limitedRpc({ capacity: 50, perSecond: 20, latencyMs: 300 });
    const call = recount.rpcClient("https://rpc.test");
    const hashes = Array.from({ length: 680 }, (_, i) => `0x${i.toString(16).padStart(64, "0")}`);
    const { mapLimit } = await import("@/app/(site)/proof/team");
    const out = await settle(mapLimit(hashes, 25, (h) => Promise.all([call("eth_getTransactionByHash", [h]), call("eth_getTransactionReceipt", [h])])));
    expect(out.flat()).toHaveLength(1_360);
    expect(seen.ok).toBe(1_360);
    expect(seen.limited).toBeGreaterThan(0);
    expect(seen.mostInFlightOnceLimited).toBeLessThan(50);
  });

  it("waits as long as Retry-After says before it tries again", async () => {
    const seen = limitedRpc({ capacity: 1, perSecond: 1 / 3, latencyMs: 300, retryAfter: "3" });
    const call = recount.rpcClient("https://rpc.test");
    await settle(call("eth_blockNumber", []));
    expect(await settle(call("eth_chainId", []))).toBe("eth_chainId");
    expect(seen.limited).toBe(1);
    expect(seen.sentAt[2]! - seen.sentAt[1]!).toBeGreaterThanOrEqual(3_300);
  });

  it("gives up on an RPC that never stops rate-limiting, and says how long it waited", async () => {
    limitedRpc({ capacity: 0, perSecond: 0, latencyMs: 300 });
    const call = recount.rpcClient("https://rpc.test");
    const start = Date.now();
    await expect(settle(call("eth_blockNumber", []))).rejects.toThrow(/^eth_blockNumber: HTTP 429, \d+ times in \d+ s$/);
    expect(Date.now() - start).toBeGreaterThanOrEqual(120_000);
  });
});

describe("the recount while deployments/README.md records no MaatInbox", () => {
  it("says counting starts when the inbox is recorded and prints not deployed on every brief line, as the page does", async () => {
    const rpc = await serveProofChain(CHAIN);
    const root = fixtureRoot(false);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--root", root]);
      expect(out.code).toBe(0);
      expect(out.stdout).toContain("MaatInbox is not recorded in deployments/README.md yet, so there is no brief to count. Counting starts when the inbox is recorded.");
      expect(out.stdout).toContain(`chain id 8453, head block ${HEAD.toLocaleString("en-US")}`);
      expect(reportOf(out.stdout)).toEqual(reportLines(countBriefs([], LISTS), new Map(), "not-deployed"));
      // No trace runs without an inbox, so no Decision is read either, as on the page.
      expect(reportOf(out.stdout)).toEqual([
        "Owner by hand Decisions: not read",
        "Agent Decisions: not read",
        "Probe Decisions: not read",
        "Outside briefs: not deployed",
        "Outside wallets: not deployed",
        "Outside wallets with a Verified Account: not deployed",
        "Brief-driven Decisions: not read",
        "Team briefs: not deployed",
        "Hidden briefs: not deployed",
        "Bounty claimants: 1",
        `Bounty claimant ${lower(CAROL)}: a fork test that previewIntent allows`,
      ]);
      const csv = await recountRun(["--rpc", rpc.url, "--root", root, "--csv"]);
      expect(csv.code).toBe(0);
      expect(csv.stdout.replace(/\r\n/g, "\n").trimEnd().split("\n")).toEqual([
        "line,count,allowed,refused",
        "Owner by hand Decisions,not read,,",
        "Agent Decisions,not read,,",
        "Probe Decisions,not read,,",
        "Outside briefs,not deployed,,",
        "Outside wallets,not deployed,,",
        "Outside wallets with a Verified Account,not deployed,,",
        "Brief-driven Decisions,not read,,",
        "Team briefs,not deployed,,",
        "Hidden briefs,not deployed,,",
        "Bounty claimants,1,,",
      ]);
      expect(preambleOf(out.stdout)).toContain(DECISION_NOTE);
      expect(rpc.seen.methods).not.toContain("eth_getLogs");
    } finally {
      await rpc.close();
    }
  });
});

describe("the recount refuses what it cannot count", () => {
  it("stops on an RPC that is not Base mainnet", async () => {
    const rpc = await serveProofChain({ ...CHAIN, chainId: 1 });
    try {
      const out = await recountRun(["--rpc", rpc.url]);
      expect(out.code).toBe(1);
      expect(out.stderr).toContain("chain id 1, not Base mainnet (8453)");
    } finally {
      await rpc.close();
    }
  });

  it("stops on an unknown option, and prints its usage on --help", async () => {
    expect((await recountRun(["--nope"])).code).toBe(2);
    const help = await recountRun(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("node scripts/recount.mjs [--rpc <url>]");
    expect(help.stdout).toContain("--sends <wallet>");
  });
});

describe("what the script hard-codes, since it has no keccak", () => {
  it("uses the Brief topic, the two selectors and the addresses the page uses", () => {
    expect(recount.BRIEF_TOPIC).toBe(keccak256(toBytes("Brief(uint256,address,string)")));
    expect(recount.GET_ATTESTATION_UID).toBe(toFunctionSelector(indexerAbi[0]));
    expect(recount.GET_ATTESTATION).toBe(toFunctionSelector(easAbi[0]));
    expect(recount.COINBASE_INDEXER).toBe(COINBASE_INDEXER.toLowerCase());
    expect(recount.EAS).toBe(EAS_ADDRESS.toLowerCase());
    expect(recount.VERIFIED_ACCOUNT_SCHEMA).toBe(VERIFIED_ACCOUNT_SCHEMA);
    expect(recount.SCAN_FLOOR_BLOCK).toBe(SCAN_FLOOR_BLOCK);
  });

  it("reads the deployments table as docs:gen does", () => {
    const text = readRepo("deployments/README.md");
    expect(recount.parseDeployments(text)).toEqual(parseDeployments(text));
  });

  it("labels a Decision as the page does, with the page's decoder and senderLabel, on every vector and broken blob", () => {
    expect(recount.EXECUTE_SELECTOR).toBe(EXECUTE_SELECTOR);
    expect(DECISION_TOPIC).toBe(keccak256(toBytes("Decision(bytes32,uint8,address,uint256,bool,uint8,bytes32)")));
    const v1 = JSON.parse(VECTORS.V1.blob.slice(8)) as Record<string, unknown>;
    const { m: _m, ...noModel } = v1;
    const make = (o: Record<string, unknown>) => `maat:v1:${canon(o)}`;
    const probeText = "PROBE v1, not a Claude proposal.";
    const blobs = [
      ...Object.values(VECTORS).map((v) => v.blob),
      make({ ...noModel, k: "probe", t: probeText }),
      make({ ...noModel, k: "bill", t: "Compute bill: $1.000000 of Claude API usage unpaid as of UTC day 20781" }),
      make({ ...v1, q: [2, 5] }),
      make({ ...v1, c: "unknown" }),
      // Each breaks a rule of §2.6, so the blob is invalid and its k or q labels nothing.
      make({ ...v1, k: "probe" }),
      make({ ...noModel, k: "probe" }),
      make({ ...noModel, k: "probe", q: [1], t: probeText }),
      make({ ...v1, q: [] }),
      make({ ...v1, q: [3, 3] }),
      make({ ...v1, q: [1, 2, 3, 4] }),
      make({ ...v1, x: 1 }),
      make({ ...v1, m: "us.anthropic.claude-sonnet-5-5" }),
      make({ ...v1, r: "run.example.com" }),
      make({ ...v1, s: [["NVDAc", "1", 1]] }),
      make({ ...v1, t: "" }),
      make({ ...v1, s: Array.from({ length: 16 }, () => ["NVDAc", "36893488147419105055", 1_795_539_382, 19]) }),
      VECTORS.V5.blob.replace('{"b":', '{ "b":'),
      VECTORS.V4.blob.replace("PROBE v1", "PROBE\tv1"),
      "maat:v1:{not json",
      "maat:v1:[1,2]",
      // Not a maat:v1 blob at all.
      "hello world",
    ];
    const bare = executeCalldata({ rationaleHash: VECTORS.V1.hash });
    const inputs: Hex[] = [
      ...blobs.flatMap((b) => [txInput(b), txInput(b, { code: null })]),
      bare,
      `${bare}${AGENT_TEST_SUFFIX.slice(2)}`,
      `${bare}ff00${"8021".repeat(8)}`,
      txInput(VECTORS.V5.blob).replace(/00(8021){8}$/, `01${"8021".repeat(8)}`) as Hex,
      "0x",
      `0xdeadbeef${"00".repeat(228)}`,
      bare.slice(0, -2) as Hex,
    ];
    const labels = new Set<string>();
    for (const input of inputs) {
      const page = decodeExecuteInput(input);
      const script = recount.decisionBlob(input);
      if (page === null) {
        expect(script, input).toBeNull();
        continue;
      }
      expect(script?.status, input).toBe(page.blob.status);
      if (page.blob.status === "v1") {
        const { k, q } = page.blob.fields;
        expect((script as { fields?: unknown }).fields, input).toEqual({ ...(k ? { k } : {}), ...(q ? { q } : {}) });
      }
      for (const from of [OWNER, EXECUTOR]) {
        const label = senderLabel(from, OWNER, page.blob);
        expect(recount.senderLabel(lower(from), OWNER, script), input).toBe(label);
        labels.add(label);
      }
    }
    expect([...labels].sort()).toEqual(["agent", "brief-driven", "owner, by hand", "probe"]);
  });
});

