import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, http, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creditAdapterAbi } from "../../src/abi/index.js";
import { builderSuffix, codesIn } from "../../src/exec/builderCode.js";
import { GuardedSender, RpcSender } from "../../src/exec/sender.js";
import { Journal, type JournalRow } from "../../src/ledger/journal.js";
import { Store } from "../../src/ledger/store.js";
import { FixedProposer } from "../../src/llm/proposer.js";
import type { Batch } from "../../src/llm/schema.js";
import { runOnce, type RunDeps } from "../../src/loop/runOnce.js";
import { startAnvil } from "./anvil.js";
import { deployStack } from "./deploy.js";

const RPC = process.env.BASE_RPC_URL;
const BLOCK_SESSION = 53_551_627n;
const CODE = "bc_maattest";

describe.skipIf(!RPC)("agent on a Base fork", () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>>;
  let stack: Awaited<ReturnType<typeof deployStack>>;
  let pub: PublicClient;
  let journal: Journal;
  let deps: (batch: Batch, runId: string) => Promise<RunDeps & { journal: Journal }>;

  beforeAll(async () => {
    anvil = await startAnvil({ forkUrl: RPC!, block: BLOCK_SESSION, port: 8547 });
    stack = await deployStack(anvil.url);
    pub = createPublicClient({ chain: base, transport: http(anvil.url, { timeout: 600_000 }) }) as PublicClient;
    const node = createWalletClient({ chain: base, transport: http(anvil.url, { timeout: 600_000 }) });
    // eth_estimateGas only checks the top-level call. execute() wraps the swap in try/catch, so an estimate that
    // starves the swap still "succeeds" and the vault logs SWAP_FAILED. Give the sender explicit headroom.
    const wallet = { ...node, sendTransaction: (a: Parameters<typeof node.sendTransaction>[0]) => node.sendTransaction({ ...a, gas: 3_000_000n } as typeof a) } as typeof node;
    const dir = await mkdtemp(join(tmpdir(), "maat-fork-"));
    const store = await Store.open(dir);
    journal = new Journal(dir);
    const sender = new GuardedSender(new RpcSender(wallet, stack.executor), { vault: stack.vault, suffix: builderSuffix(CODE) });
    deps = async (batch, runId) => ({
      vault: stack.vault,
      executor: stack.executor,
      expensePayee: stack.payee,
      mode: "live",
      defaultDailyComputeUsd6: 500_000n,
      maxTxPerDay: 40,
      stateClient: pub,
      previewClient: pub,
      // The public RPC makes the first swap on a cold fork take minutes; RunOnce's 120 s default is too short here.
      txClient: { estimateGas: pub.estimateGas, waitForTransactionReceipt: (a) => pub.waitForTransactionReceipt({ ...a, timeout: 600_000 }) },
      proposer: new FixedProposer(batch),
      sender,
      store,
      journal,
      runId,
    });
  });

  afterAll(async () => {
    await anvil?.stop();
  });

  const intents = async (j: Journal, runId: string) =>
    (await j.read()).filter((e): e is Extract<JournalRow, { kind: "intent" }> => e.kind === "intent" && e.runId === runId);

  it("buys, supplies and borrows in one round; every tx carries the Builder Code; preview matches execute", async () => {
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
    for (const hash of r.sent) {
      const tx = await pub.getTransaction({ hash });
      expect(codesIn(tx.input)).toEqual([CODE]);
      expect(tx.from.toLowerCase()).toBe(stack.executor.toLowerCase());
    }
    const rows = await intents(d.journal, "fork-1");
    expect(rows.map((x) => [x.action, x.preview, x.decision?.allowed, x.decision?.reason])).toEqual([
      ["BUY", "OK", true, "OK"],
      ["SUPPLY", "OK", true, "OK"],
      ["BORROW", "OK", true, "OK"],
    ]);
    const debt = await pub.readContract({ address: stack.creditAdapter, abi: creditAdapterAbi, functionName: "debt" });
    expect(debt).toBeGreaterThanOrEqual(5_000_000n);
    expect(debt).toBeLessThanOrEqual(5_000_010n);
  });

  it("logs a market-closed refusal onchain once per day, with preview == Decision", async () => {
    // Saturday: market closed, equity feeds frozen.
    const test = createTestClient({ chain: base, transport: http(anvil.url, { timeout: 600_000 }), mode: "anvil" });
    const now = (await pub.getBlock()).timestamp;
    await test.setNextBlockTimestamp({ timestamp: now + 2n * 86_400n });
    await test.mine({ blocks: 1 });

    const batch: Batch = { summary: "try", intents: [{ action: "BUY", symbol: "GOOGLc", amountUsd: 10, rationale: "GOOGLc underweight" }] };
    const first = await runOnce(await deps(batch, "fork-2"));
    expect(first.sent).toHaveLength(1);
    const [row] = await intents(journal, "fork-2");
    expect(row?.gate).toBe("log-refusal");
    expect(row?.decision?.allowed).toBe(false);
    expect(row?.decision?.reason).toBe(row?.preview); // contract verdict == off-chain preview
    expect(["MARKET_CLOSED", "FEED_STALE"]).toContain(row?.preview);

    const second = await runOnce(await deps(batch, "fork-3"));
    expect(second.sent).toEqual([]);
  });

  it("dry-run sends nothing", async () => {
    const before = await pub.getTransactionCount({ address: stack.executor as Address });
    const d = await deps({ summary: "s", intents: [{ action: "SELL", symbol: "NVDAc", amountUsd: 1, rationale: "r" }] }, "fork-4");
    await runOnce({ ...d, mode: "dry-run", sender: null });
    expect(await pub.getTransactionCount({ address: stack.executor as Address })).toBe(before);
  });
});
