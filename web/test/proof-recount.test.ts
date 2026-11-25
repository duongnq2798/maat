// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { keccak256, toBytes, toFunctionSelector, type Address, type Hash, type Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { countBriefs, reportLines, type ProofLists } from "@/app/(site)/proof/count";
import { readProof } from "@/app/(site)/proof/load";
import { DECISION_NOTE, TEAM_SET_NOTE } from "@/app/(site)/proof/team";
import { COINBASE_INDEXER, EAS_ADDRESS, easAbi, indexerAbi, VERIFIED_ACCOUNT_SCHEMA, type Attestation } from "@/app/(site)/proof/verified";
import type { TeamWallet } from "@/content/proof-team";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { parseDeployments } from "@/lib/docs/docs-data";
import * as recount from "../../scripts/recount.mjs";
import { proofChainClient, serveProofChain, type FakeTx, type ProofChain } from "./helpers/fake-proof-chain";
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
/** On the vault's payees(), so on the team. */
const PAYEE: Address = "0x00000000000000000000000000000000000e0001";
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

/** The owner deploys the vault and the inbox, then sends ETH to FUNDED. */
const TXS: FakeTx[] = [
  { hash: VAULT_TX, from: OWNER, nonce: 0, to: null, block: DEPLOY - 10n, contractAddress: VAULT },
  { hash: DEPLOY_TX, from: OWNER, nonce: 1, to: null, block: DEPLOY, contractAddress: INBOX },
  { hash: FUND_TX, from: OWNER, nonce: 2, to: FUNDED, value: 10n ** 15n, block: DEPLOY + 5n },
];

/**
 * One fixture for the page and the script: Alice twice, Bob, Carol (hidden), the owner twice, the executor once, the
 * owner-funded wallet once and the vault's payee once, spread over 120,000 blocks. Alice holds a Verified Account;
 * Bob's was revoked; Carol has none. The same Brief is given twice by the RPC (same tx and log index), which both
 * readers keep once.
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
  ],
  uids: { [lower(ALICE)]: UID_ALICE, [lower(BOB)]: UID_BOB },
  attestations: {
    [UID_ALICE]: attestation(UID_ALICE, ALICE),
    [UID_BOB]: attestation(UID_BOB, BOB, { revocationTime: 1_795_100_000n }),
  },
  vault: { address: VAULT, owner: OWNER, executor: OWNER, payees: [PAYEE] },
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

/** A checkout with only the files the script reads: the deployments table and the five lists. */
function fixtureRoot(inboxRow: boolean, lists: ProofLists = LISTS): string {
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

/** The report lines of the script's output: from "Outside briefs:" to the end. */
const reportOf = (stdout: string) => {
  const lines = stdout.replace(/\r\n/g, "\n").trimEnd().split("\n");
  return lines.slice(lines.findIndex((l) => l.startsWith("Outside briefs: ")));
};
/** The lines printed before the report. */
const preambleOf = (stdout: string) => {
  const lines = stdout.replace(/\r\n/g, "\n").trimEnd().split("\n");
  return lines.slice(0, lines.findIndex((l) => l.startsWith("Outside briefs: ")));
};

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

  it("gives the same report as the page on one fixture", async () => {
    const page = await readProof(proofChainClient(CHAIN), CONFIG, LISTS);
    expect(page.complete).toBe(true);
    expect(page.head).toBe(HEAD);
    const expected = reportLines(page.count, page.verified!, "counted", page.team);
    expect(expected.slice(0, 6)).toEqual([
      "Outside briefs: 4",
      "Outside wallets: 3",
      "Outside wallets with a Verified Account: 1",
      "Team briefs: 5",
      "Hidden briefs: 1",
      "Bounty claimants: 1",
    ]);

    const out = await recountRun(["--rpc", rpc.url, "--root", root]);
    expect(out.stderr).toBe("");
    expect(out.code).toBe(0);
    expect(reportOf(out.stdout)).toEqual(expected);
    expect(out.stdout).toContain(`MaatInbox ${lower(INBOX)}: Brief logs from block 62,000,000 to block 62,120,000`);
  });

  it("puts a wallet the owner funded, and the vault's payee, on the team, in the page and in the script", async () => {
    const page = await readProof(proofChainClient(CHAIN), CONFIG, LISTS);
    expect(page.count.outsideWallets.map((w) => w.address)).toEqual([lower(ALICE), lower(BOB), lower(CAROL)]);
    expect(page.count.teamWallets.map((w) => w.address)).toEqual([lower(OWNER), lower(EXECUTOR), lower(FUNDED), lower(PAYEE)]);
    const out = await recountRun(["--rpc", rpc.url, "--root", root]);
    expect(out.stdout).toContain(`Team wallet ${lower(FUNDED)}: 1 brief`);
    expect(out.stdout).toContain(`Team set ${lower(FUNDED)}: hop 1, ETH from ${lower(OWNER)} in ${FUND_TX}`);
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

  it("counts to --to-block and no further, and takes the block as the page prints it", async () => {
    for (const block of [String(HEAD - 2n), (HEAD - 2n).toLocaleString("en-US"), "62_119_998"]) {
      const out = await recountRun(["--rpc", rpc.url, "--root", root, "--to-block", block]);
      expect(out.code).toBe(0);
      expect(reportOf(out.stdout).slice(0, 6)).toEqual([
        "Outside briefs: 4",
        "Outside wallets: 3",
        "Outside wallets with a Verified Account: 1",
        "Team briefs: 4",
        "Hidden briefs: 1",
        "Bounty claimants: 1",
      ]);
    }
    expect((await recountRun(["--rpc", rpc.url, "--root", root, "--to-block", "62.1M"])).code).toBe(1);
  });
});

describe("the recount when a team wallet sent a transaction its committed list does not hold", () => {
  it("prints the gap, gives no number on a brief line, as the page does, and exits 1", async () => {
    const short: ProofLists = { ...LISTS, sends: [{ wallet: OWNER, txs: [VAULT_TX, DEPLOY_TX] }] };
    const rpc = await serveProofChain(CHAIN);
    try {
      const page = await readProof(proofChainClient(CHAIN), CONFIG, short);
      expect(page.complete).toBe(false);
      expect(page.problems).toEqual([
        `web/content/proof-sends.ts lists 2 of the 3 transactions ${lower(OWNER)} sent by block 62,120,000; node scripts/recount.mjs --sends ${lower(OWNER)} prints them.`,
      ]);
      const out = await recountRun(["--rpc", rpc.url, "--root", fixtureRoot(true, short)]);
      expect(out.code).toBe(1);
      const lines = reportOf(out.stdout);
      expect(lines).toEqual(reportLines(page.count, page.verified, "incomplete", page.team));
      expect(lines.slice(0, 6)).toEqual([
        "Outside briefs: incomplete",
        "Outside wallets: incomplete",
        "Outside wallets with a Verified Account: incomplete",
        "Team briefs: incomplete",
        "Hidden briefs: incomplete",
        "Bounty claimants: 1",
      ]);
      expect(lines).toContain(`Incomplete: ${page.problems[0]}`);
      expect(out.stderr).toContain("recount: the count is incomplete");
    } finally {
      await rpc.close();
    }
  });
});

describe("node scripts/recount.mjs --sends", () => {
  it("prints a wallet's sent transactions in nonce order, found by its nonce at past blocks", async () => {
    const rpc = await serveProofChain(CHAIN);
    try {
      const out = await recountRun(["--rpc", rpc.url, "--sends", OWNER]);
      expect(out.stderr).toBe("");
      expect(out.code).toBe(0);
      expect(out.stdout).toContain(`  { wallet: "${lower(OWNER)}", txs: ["${VAULT_TX}", "${DEPLOY_TX}", "${FUND_TX}"] },`);
      expect(out.stdout).toContain("3 transactions sent by block 62,120,000");
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
      expect(reportOf(out.stdout)).toEqual(reportLines(page.count, page.verified!, "counted", page.team));
      expect(capped.seen.logRanges.every((r) => r.to - r.from + 1n <= 200n)).toBe(true);
    } finally {
      await capped.close();
    }
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
      expect(reportOf(out.stdout)).toEqual([
        "Outside briefs: not deployed",
        "Outside wallets: not deployed",
        "Outside wallets with a Verified Account: not deployed",
        "Team briefs: not deployed",
        "Hidden briefs: not deployed",
        "Bounty claimants: 1",
        `Bounty claimant ${lower(CAROL)}: a fork test that previewIntent allows`,
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
});

