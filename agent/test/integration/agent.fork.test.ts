import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, decodeFunctionData, getAddress, http, size, slice, type Address, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creditAdapterAbi, mandateVaultAbi } from "../../src/abi/index.js";
import { builderSuffix, codesIn } from "../../src/exec/builderCode.js";
import { GAS_FLOOR, type GasFunction } from "../../src/exec/calls.js";
import { GuardedSender, RpcSender } from "../../src/exec/sender.js";
import { Journal, type JournalRow } from "../../src/ledger/journal.js";
import { Store } from "../../src/ledger/store.js";
import { FixedProposer } from "../../src/llm/proposer.js";
import type { Batch } from "../../src/llm/schema.js";
import { BILL_MIN_USD6, runOnce, type RunDeps } from "../../src/loop/runOnce.js";
import { DEFAULT_POLICY } from "../../src/policy.js";
import { decodeExecuteInput } from "../../src/rationale/calldata.js";
import { ACTIONS, type OnchainIntent } from "../../src/types.js";
import { startAnvil } from "./anvil.js";
import { deployStack } from "./deploy.js";

const RPC = process.env.BASE_RPC_URL;
const BLOCK_SESSION = 53_551_627n;
const CODE = "bc_maattest";
const SUFFIX = builderSuffix(CODE);

describe.skipIf(!RPC)("agent on a Base fork", () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>>;
  let stack: Awaited<ReturnType<typeof deployStack>>;
  let pub: PublicClient;
  let journal: Journal;
  let deps: (batch: Batch, runId: string, own?: { store: Store; journal: Journal }) => Promise<RunDeps & { journal: Journal }>;
  const measured: { runId: string; fn: GasFunction; action?: string; gas: bigint; gasUsed: bigint }[] = [];

  beforeAll(async () => {
    anvil = await startAnvil({ forkUrl: RPC!, block: BLOCK_SESSION, port: 8547 });
    stack = await deployStack(anvil.url);
    pub = createPublicClient({ chain: base, transport: http(anvil.url, { timeout: 600_000 }) }) as PublicClient;
    // No gas override here: runOnce must pick a limit that does not starve the vault's swallowed inner calls.
    const wallet = createWalletClient({ chain: base, transport: http(anvil.url, { timeout: 600_000 }) });
    const dir = await mkdtemp(join(tmpdir(), "maat-fork-"));
    const store = await Store.open(dir);
    journal = new Journal(dir);
    const sender = new GuardedSender(new RpcSender(wallet, stack.executor), { vault: stack.vault, suffix: SUFFIX });
    deps = async (batch, runId, own) => ({
      vault: stack.vault,
      executor: stack.executor,
      expensePayee: stack.payee,
      mode: "live",
      defaultDailyComputeUsd6: 500_000n,
      maxTxPerDay: 40,
      billMinUsd6: BILL_MIN_USD6,
      maxLlmUsd6PerDay: 750_000n,
      // The first test supplies and borrows: the credit path is what it checks against the fork.
      policy: { ...DEFAULT_POLICY, creditActions: true },
      stateClient: pub,
      previewClient: pub,
      txClient: {
        estimateGas: pub.estimateGas,
        getTransaction: pub.getTransaction,
        getLogs: pub.getLogs,
        getBlockNumber: pub.getBlockNumber,
        readContract: pub.readContract,
        // The public RPC makes the first swap on a cold fork take minutes; RunOnce's 120 s default is too short here.
        waitForTransactionReceipt: (a) => pub.waitForTransactionReceipt({ ...a, timeout: 600_000 }),
      },
      proposer: new FixedProposer(batch),
      sender,
      store: own?.store ?? store,
      journal: own?.journal ?? journal,
      commit: "unknown",
      runId,
    });
  });

  afterAll(async () => {
    await anvil?.stop();
    // MAAT_GAS_LOG=<file>: write gas limit and gasUsed per sent tx (the evidence behind the floors in calls.ts).
    const out = process.env.MAAT_GAS_LOG;
    if (out) await writeFile(out, JSON.stringify(measured, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  });

  const intents = async (j: Journal, runId: string) =>
    (await j.read()).filter((e): e is Extract<JournalRow, { kind: "intent" }> => e.kind === "intent" && e.runId === runId);
  const nonce = () => pub.getTransactionCount({ address: stack.executor as Address });

  /** Every sent tx: to the vault, Builder Code, an execute's maat:v1 blob, explicit gas >= its floor, not starved, and successful. */
  const checkSent = async (runId: string, hashes: Hex[]) => {
    for (const hash of hashes) {
      const tx = await pub.getTransaction({ hash });
      const receipt = await pub.getTransactionReceipt({ hash });
      const call = decodeFunctionData({ abi: mandateVaultAbi, data: slice(tx.input, 0, size(tx.input) - size(SUFFIX)) });
      const fn = call.functionName as GasFunction;
      expect(Object.keys(GAS_FLOOR)).toContain(fn);
      expect(codesIn(tx.input)).toEqual([CODE]);
      // An execute carries its blob between the call and the suffix, and the intent hashes exactly that blob.
      if (fn === "execute") expect(decodeExecuteInput(tx.input)).toMatchObject({ status: "v1", hashTick: true, codes: [CODE] });
      expect(getAddress(tx.from)).toBe(getAddress(stack.executor));
      expect(getAddress(tx.to!)).toBe(getAddress(stack.vault));
      expect(receipt.status).toBe("success");
      expect(tx.gas).toBeGreaterThanOrEqual(GAS_FLOOR[fn]);
      expect(receipt.gasUsed).toBeLessThan(tx.gas);
      const action = fn === "execute" ? ACTIONS[(call.args![0] as OnchainIntent).action] : undefined;
      measured.push({ runId, fn, ...(action ? { action } : {}), gas: tx.gas, gasUsed: receipt.gasUsed });
    }
  };

  it("buys, supplies and borrows in one round; every tx carries the Builder Code and explicit gas; preview matches execute", async () => {
    const d = await deps(
      {
        summary: "build the position",
        intents: [
          { action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "NVDAc underweight" },
          { action: "SUPPLY", symbol: "NVDAc", amountUsd: 15, rationale: "use as collateral" },
          { action: "BORROW", symbol: "USDC", amountUsd: 5, rationale: "compute runway" },
        ],
      },
      "fork-1",
    );
    const r = await runOnce(d);
    expect(r.status).toBe("done");
    // The vault constructor seeds lastMultiplier from uiMultiplier(), so a fresh vault needs no housekeeping.
    expect((await d.journal.read()).filter((e) => e.kind === "housekeeping")).toEqual([]);
    expect(r.sent).toHaveLength(3);
    await checkSent("fork-1", r.sent);
    const rows = await intents(d.journal, "fork-1");
    expect(rows.map((x) => [x.action, x.preview, x.decision?.allowed, x.decision?.reason])).toEqual([
      ["BUY", "OK", true, "OK"],
      ["SUPPLY", "OK", true, "OK"],
      ["BORROW", "OK", true, "OK"],
    ]);
    expect((await d.journal.read()).filter((e) => e.kind === "mismatch")).toEqual([]);
    expect(d.store.pending()).toEqual([]);
    const debt = await pub.readContract({ address: stack.creditAdapter, abi: creditAdapterAbi, functionName: "debt" });
    expect(debt).toBeGreaterThanOrEqual(5_000_000n);
    expect(debt).toBeLessThanOrEqual(5_000_010n);
  });

  it("logs a market-closed refusal onchain once per NYSE date and closed phase, with preview == Decision", async () => {
    // Saturday: market closed, equity feeds frozen.
    const test = createTestClient({ chain: base, transport: http(anvil.url, { timeout: 600_000 }), mode: "anvil" });
    const now = (await pub.getBlock()).timestamp;
    await test.setNextBlockTimestamp({ timestamp: now + 2n * 86_400n });
    await test.mine({ blocks: 1 });

    const batch: Batch = { summary: "try", intents: [{ action: "BUY", symbol: "GOOGLc", amountUsd: 10, rationale: "GOOGLc underweight" }] };
    const first = await runOnce(await deps(batch, "fork-2"));
    expect(first.status).toBe("done");
    expect(first.sent).toHaveLength(1);
    await checkSent("fork-2", first.sent);
    const [row] = await intents(journal, "fork-2");
    expect(row?.gate).toBe("log-refusal");
    expect(row?.decision?.allowed).toBe(false);
    expect(row?.decision?.reason).toBe(row?.preview); // contract verdict == off-chain preview
    expect(["MARKET_CLOSED", "FEED_STALE"]).toContain(row?.preview);
    // A MARKET_CLOSED log names the closed phase in the rationale it hashes.
    expect(row?.rationale).toBe(row?.preview === "MARKET_CLOSED" ? "GOOGLc underweight (market closed, weekend)" : "GOOGLc underweight");

    const before = await nonce();
    const second = await runOnce(await deps(batch, "fork-3"));
    expect(second).toMatchObject({ status: "done", sent: [] });
    const [again] = await intents(journal, "fork-3");
    expect(again?.preview).toBe(row?.preview);
    // The fork block is Thursday 2026-11-05 10:30 ET and the clock moved 2 days ahead, so both rounds fall on Saturday, NYSE date 2026-11-07.
    const phase = row?.preview === "MARKET_CLOSED" ? " (weekend)" : "";
    expect(again?.gate).toBe(`${row?.preview} already logged for NYSE date 2026-11-07${phase}`);
    expect(again?.txHash).toBeUndefined();
    expect(await nonce()).toBe(before);
  });

  it("dry-run would send but sends nothing", async () => {
    // A fresh Store and Journal: nothing is logged today there, so the same round in live mode would send.
    const dir = await mkdtemp(join(tmpdir(), "maat-fork-dry-"));
    const own = { store: await Store.open(dir), journal: new Journal(dir) };
    const before = await nonce();
    const d = await deps({ summary: "s", intents: [{ action: "SELL", symbol: "NVDAc", amountUsd: 1, rationale: "r" }] }, "fork-4", own);
    const r = await runOnce({ ...d, mode: "dry-run", sender: null });
    expect(r).toMatchObject({ status: "done", sent: [] });
    const [row] = await intents(own.journal, "fork-4");
    expect(row?.gate).toMatch(/^dry-run: would (execute|log-refusal)$/);
    expect(row?.txHash).toBeUndefined();
    expect(await nonce()).toBe(before);
  });
});
