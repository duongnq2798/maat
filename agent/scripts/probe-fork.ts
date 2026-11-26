// Rehearses MAAT_PROBES on a base-anvil fork of Base mainnet. At each instant it warps the fork's clock there and runs
// runProbe against the vault as the running agent would, through GuardedSender(RpcSender) from the impersonated vault
// executor. Then it checks each transaction: the Decision is what the probe expected, keccak256(blob) is the
// rationaleHash, the blob is maat:v1 with k = probe, and `npm run verify` passes on it with the run's journal.
// Chainlink's equity feeds would be stale at a warped time, so each feed's code is replaced by
// contracts/test/mocks/MockFeed.sol, holding the feed's real latest answer and an updatedAt 60 s before the instant.
// It refuses an RPC that is not anvil on this machine, so it never sends on a real chain.
//   cd contracts && forge build test/mocks/MockFeed.sol
//   FOUNDRY_BASE=true <base-anvil> --base --fork-url https://mainnet.base.org --port 8551
//   cd agent && node --import tsx scripts/probe-fork.ts --vault <VAULT_ADDRESS>
// <base-anvil> is the binary test/integration/anvil.ts describes (MAAT_ANVIL_BIN). --rpc is http://127.0.0.1:8551 by
// default, --at the MAAT_PROBES instants (2026-11-27T17:58:00Z,2026-11-27T18:01:00Z by default, later than the fork's
// block) and --mock-feed the forge artifact. Exit code 0: every probe sent and passed. 1: one did not. 2: bad
// arguments, or an RPC that is not a local anvil fork of Base.
import { realpathSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  getAddress,
  http,
  isAddress,
  pad,
  parseEventLogs,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { base } from "viem/chains";
import { aggregatorV3Abi, mandateVaultAbi } from "../src/abi/index.js";
import { readVaultState } from "../src/chain/state.js";
import { builderSuffix } from "../src/exec/builderCode.js";
import { GuardedSender, RpcSender } from "../src/exec/sender.js";
import { gitCommit } from "../src/gitCommit.js";
import { Journal } from "../src/ledger/journal.js";
import { Store } from "../src/ledger/store.js";
import { FixedProposer } from "../src/llm/proposer.js";
import { runProbe } from "../src/loop/probeRound.js";
import { BILL_MIN_USD6, type RunDeps } from "../src/loop/runOnce.js";
import { DEFAULT_POLICY } from "../src/policy.js";
import { parseProbes, probeIso } from "../src/probes.js";
import { decodeExecuteInput } from "../src/rationale/calldata.js";
import { REASONS } from "../src/types.js";
import { main as verify } from "./verify-decision.js";

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_AT = "2026-11-27T17:58:00Z,2026-11-27T18:01:00Z";
const DEFAULT_MOCK = join(AGENT_DIR, "..", "contracts", "out", "MockFeed.sol", "MockFeed.json");
/** The agent tests' Builder Code: a rehearsal's calldata never carries the project's. */
const REHEARSAL_CODE = "bc_maattest";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
/** A fork read can fetch many slots from the forked RPC, well past viem's default 10 s. */
const TIMEOUT_MS = 180_000;

class Usage extends Error {}

const word = (n: bigint) => pad(toHex(n < 0n ? (1n << 256n) + n : n), { size: 32 });
const isoOf = (s: bigint) => probeIso(Number(s) * 1000);

export async function main(argv: readonly string[], out: (s: string) => void = console.log): Promise<number> {
  let rpc: string;
  let vault: Address;
  let at: number[];
  let mockFile: string;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { rpc: { type: "string" }, vault: { type: "string" }, at: { type: "string" }, "mock-feed": { type: "string" } },
      strict: true,
    });
    rpc = values.rpc ?? "http://127.0.0.1:8551";
    if (!LOCAL_HOSTS.has(new URL(rpc).hostname)) throw new Usage(`--rpc ${rpc} is not on this machine; the rehearsal only sends to a local anvil fork`);
    if (!values.vault || !isAddress(values.vault, { strict: false })) throw new Usage("--vault <VAULT_ADDRESS> is required");
    vault = getAddress(values.vault);
    const list = parseProbes(values.at ?? DEFAULT_AT);
    if (list.problems.length > 0 || list.at.length === 0) throw new Usage(`--at: ${list.problems.join("; ") || "no instant"}`);
    at = list.at;
    mockFile = resolve(values["mock-feed"] ?? DEFAULT_MOCK);
  } catch (e) {
    out(`probe-fork: ${(e as Error).message}`);
    return 2;
  }

  const transport = http(rpc, { timeout: TIMEOUT_MS });
  // As in runtime.ts: the cast only erases the OP-stack deposit-tx types the narrow client interfaces do not model.
  const pub = createPublicClient({ chain: base, transport }) as PublicClient;
  const testClient = createTestClient({ chain: base, mode: "anvil", transport });
  const wallet = createWalletClient({ chain: base, transport });
  const client = (await pub.request({ method: "web3_clientVersion" })) as string;
  const chainId = await pub.getChainId();
  if (!client.startsWith("anvil") || chainId !== base.id) {
    out(`probe-fork: ${rpc} is ${client} on chain ${chainId}, not an anvil fork of Base (${base.id})`);
    return 2;
  }
  let mock: Hex;
  try {
    mock = (JSON.parse(await readFile(mockFile, "utf8")) as { deployedBytecode: { object: Hex } }).deployedBytecode.object;
  } catch {
    out(`probe-fork: no MockFeed artifact at ${mockFile}; run \`forge build test/mocks/MockFeed.sol\` in contracts/`);
    return 2;
  }

  const fork = await pub.getBlock();
  out(`fork block ${fork.number}, timestamp ${fork.timestamp} (${isoOf(fork.timestamp)}), ${client}`);
  if (at.some((ms) => BigInt(ms / 1000) <= fork.timestamp)) {
    out(`probe-fork: every --at instant must be later than the fork's block, ${isoOf(fork.timestamp)}`);
    return 2;
  }
  const executor = getAddress(await pub.readContract({ address: vault, abi: mandateVaultAbi, functionName: "executor" }));
  const owner = getAddress(await pub.readContract({ address: vault, abi: mandateVaultAbi, functionName: "owner" }));
  out(`vault ${vault}, executor ${executor}, owner ${owner}`);
  await testClient.impersonateAccount({ address: executor });
  await testClient.setBalance({ address: executor, value: 10n ** 18n });

  // MockFeed's slots: 0 answer, 1 updatedAt, 2 decimals. setCode runs no constructor, so decimals is set by hand.
  const feeds: Address[] = [];
  for (const t of await pub.readContract({ address: vault, abi: mandateVaultAbi, functionName: "tokens" })) {
    const feed = getAddress((await pub.readContract({ address: vault, abi: mandateVaultAbi, functionName: "tokenConfig", args: [t] }))[1]);
    if (feed === zeroAddress) continue;
    const [, answer, , updatedAt] = await pub.readContract({ address: feed, abi: aggregatorV3Abi, functionName: "latestRoundData" });
    out(`token ${t}: feed ${feed}, real answer ${answer}, updatedAt ${updatedAt} (${isoOf(updatedAt)})`);
    await testClient.setCode({ address: feed, bytecode: mock });
    await testClient.setStorageAt({ address: feed, index: 0, value: word(answer) });
    await testClient.setStorageAt({ address: feed, index: 2, value: word(8n) });
    feeds.push(feed);
  }
  // The first full state read fetches the fork's slots from the forked RPC; done here, it is not a probe's read.
  const warm = await readVaultState(pub, vault);
  out(`warm-up state read at block ${warm.blockNumber}: market open ${warm.marketOpen}, USDC ${warm.usdcBalance}, equity ${warm.equityUsd6}`);

  const dir = await mkdtemp(join(tmpdir(), "maat-probe-fork-"));
  const commit = gitCommit(AGENT_DIR);
  const journal = new Journal(dir, { commit });
  const deps: RunDeps = {
    vault,
    executor,
    expensePayee: executor,
    mode: "live",
    defaultDailyComputeUsd6: 500_000n,
    maxTxPerDay: 40,
    billMinUsd6: BILL_MIN_USD6,
    maxLlmUsd6PerDay: 750_000n,
    policy: { ...DEFAULT_POLICY, creditActions: false },
    stateClient: pub,
    previewClient: pub,
    txClient: pub,
    proposer: new FixedProposer({ summary: "unused: a probe makes no Claude call", intents: [] }),
    sender: new GuardedSender(new RpcSender(wallet, executor), { vault, suffix: builderSuffix(REHEARSAL_CODE) }),
    store: await Store.open(dir),
    journal,
    commit,
  };
  out(`journal ${join(dir, "journal.jsonl")}, commit ${commit}`);

  let ok = true;
  for (const ms of at) {
    const atS = BigInt(ms / 1000);
    for (const feed of feeds) await testClient.setStorageAt({ address: feed, index: 1, value: word(atS - 60n) });
    await testClient.setNextBlockTimestamp({ timestamp: atS });
    await testClient.mine({ blocks: 1 });
    const b = await pub.getBlock();
    // The probe's clock is the fork's: the warped block's time plus the real time since.
    const real0 = Date.now();
    const clock = () => Number(b.timestamp) * 1000 + (Date.now() - real0);
    out(`\n== probe ${probeIso(ms)}: fork block ${b.number} at ${isoOf(b.timestamp)}`);
    const r = await runProbe(deps, ms, clock);
    out(`probe ${r.at}: ${r.outcome}${r.expected ? ` (expected ${r.expected})` : ""}, status ${r.status}, sent ${r.sent.length}${r.why ? `; ${r.why}` : ""}`);
    const hash = r.sent[0];
    if (r.outcome !== "sent" || !hash || !r.expected) {
      out("  FAIL no transaction sent");
      ok = false;
      continue;
    }
    const tx = await pub.getTransaction({ hash });
    const receipt = await pub.getTransactionReceipt({ hash });
    const mined = await pub.getBlock({ blockNumber: receipt.blockNumber });
    const d = decodeExecuteInput(tx.input);
    const decision = parseEventLogs({ abi: mandateVaultAbi, eventName: "Decision", logs: receipt.logs })[0]?.args;
    out(`  tx ${hash}, block ${receipt.blockNumber} at ${isoOf(mined.timestamp)}, from ${tx.from}`);
    out(`  ${(tx.input.length - 2) / 2} bytes = 228 + ${d?.blobBytes} blob + ${d ? (tx.input.length - 2) / 2 - d.suffixStart : "?"} suffix; blob ${d?.status}, k ${d?.fields?.k}`);
    out(`  Decision allowed ${decision?.allowed} reason ${decision ? REASONS[Number(decision.reason)] : "none"}, rationaleHash ${decision?.rationaleHash}`);
    out(`  keccak256(blob) ${d?.blobHash}`);
    out(`  blob ${d?.blob}`);
    const want = r.expected === "OK";
    const pass =
      decision !== undefined &&
      decision.allowed === want &&
      REASONS[Number(decision.reason)] === r.expected &&
      d?.status === "v1" &&
      d.fields?.k === "probe" &&
      d.hashTick === true &&
      decision.rationaleHash === d.rationaleHash;
    out(`  ${pass ? "PASS" : "FAIL"} the Decision is ${r.expected}, the blob is maat:v1 with k probe, keccak256(blob) = rationaleHash`);
    out(`  $ npm run verify -- --tx ${hash} --rpc ${rpc} --vault ${vault} --journal <journal>`);
    const code = await verify(["--tx", hash, "--rpc", rpc, "--vault", vault, "--journal", join(dir, "journal.jsonl")], {
      out: (s) => out(`  ${s}`),
      err: (s) => out(`  ${s}`),
    });
    out(`  exit ${code}`);
    ok &&= pass && code === 0;
  }
  out("\njournal rows:");
  for (const row of await journal.read()) {
    const parts = [row.kind, row.runId];
    if ("outcome" in row) parts.push(row.outcome);
    if ("gate" in row && row.gate) parts.push(`gate ${row.gate}`);
    if ("decision" in row && row.decision) parts.push(`decision ${JSON.stringify(row.decision)}`);
    if (row.kind === "error") parts.push(row.message);
    out(`  ${parts.join(" ")}`);
  }
  out(`\nprobe fork rehearsal: ${ok ? "PASS" : "FAIL"}`);
  return ok ? 0 : 1;
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) process.exitCode = await main(process.argv.slice(2));
