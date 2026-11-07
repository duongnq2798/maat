import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { size } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf, USDC } from "../src/addresses.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { GAS_FLOOR } from "../src/exec/calls.js";
import { GuardedSender } from "../src/exec/sender.js";
import { Journal } from "../src/ledger/journal.js";
import { Store } from "../src/ledger/store.js";
import { FixedProposer, type Proposer } from "../src/llm/proposer.js";
import type { Batch } from "../src/llm/schema.js";
import { PENDING_WINDOW_BLOCKS, runOnce, type RunDeps } from "../src/loop/runOnce.js";
import type { OnchainIntent } from "../src/types.js";
import { EXECUTOR, VAULT, standardScene, type FakeChain } from "./fakes/fakeChain.js";
import { FakeReceipts } from "./fakes/fakeReceipts.js";
import { FakeSender } from "./fakes/fakeSender.js";

const PAYEE = "0x3333333333333333333333333333333333333333" as const;
const SUFFIX = builderSuffix("bc_maattest");
const DAY = 1_794_000_000n / 86_400n;
const BUY20: Batch = { summary: "buy", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "underweight" }] };

async function setup(o: { mode?: "dry-run" | "live"; batch?: Batch; proposer?: Proposer; preview?: (i: OnchainIntent) => number | Promise<number>; scene?: FakeChain; store?: Store; maxTxPerDay?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "maat-run-"));
  const scene = o.scene ?? standardScene();
  const store = o.store ?? (await Store.open(dir));
  const journal = new Journal(dir);
  const inner = new FakeSender(EXECUTOR);
  const receipts = new FakeReceipts(inner, VAULT, size(SUFFIX));
  const previews: OnchainIntent[] = [];
  let reads = 0;
  const stateClient = scene.client();
  const getBlock = stateClient.getBlock;
  stateClient.getBlock = ((...a: Parameters<typeof getBlock>) => (reads++, getBlock(...a))) as typeof getBlock;
  const deps: RunDeps = {
    vault: VAULT,
    executor: EXECUTOR,
    expensePayee: PAYEE,
    mode: o.mode ?? "live",
    defaultDailyComputeUsd6: 500_000n,
    maxTxPerDay: o.maxTxPerDay ?? 40,
    stateClient,
    previewClient: {
      readContract: (async (p: { args: readonly [OnchainIntent] }) => (previews.push(p.args[0]), (o.preview ?? (() => 0))(p.args[0]))) as never,
    },
    txClient: receipts.client(),
    proposer: o.proposer ?? new FixedProposer(o.batch ?? { summary: "hold", intents: [] }),
    sender: (o.mode ?? "live") === "live" ? new GuardedSender(inner, { vault: VAULT, suffix: SUFFIX }) : null,
    store,
    journal,
    runId: "run-1",
  };
  return { dir, deps, inner, receipts, store, journal, scene, previews, reads: () => reads };
}

describe("runOnce", () => {
  it("does nothing when the vault state is unavailable", async () => {
    let asked = 0;
    const t = await setup({ scene: standardScene().fail(VAULT, "mandate"), proposer: { propose: async () => (asked++, { ok: false, error: "x", costUsd6: 0n }) } });
    const r = await runOnce(t.deps);
    expect(r.status).toBe("no-state");
    expect(asked).toBe(0);
    expect(t.inner.sent).toEqual([]);
    expect((await t.journal.read()).at(-1)).toMatchObject({ kind: "error" });
  });

  it("stops when the vault's executor is someone else", async () => {
    const t = await setup({ batch: BUY20, scene: standardScene().set(VAULT, "executor", "0x9999999999999999999999999999999999999999") });
    expect((await runOnce(t.deps)).status).toBe("wrong-executor");
    expect(t.inner.sent).toEqual([]);
  });

  it("dry-run previews and journals but never sends", async () => {
    const t = await setup({ mode: "dry-run", batch: BUY20 });
    const r = await runOnce(t.deps);
    expect(r).toMatchObject({ status: "done", sent: [], skipped: 1, proposals: 1 });
    expect(t.previews).toHaveLength(1);
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ preview: "OK", gate: "dry-run: would execute" });
    expect(existsSync(join(t.dir, "state.json"))).toBe(true);
  });

  it("executes an allowed intent with the Builder Code and records the Decision", async () => {
    const t = await setup({ batch: BUY20 });
    const r = await runOnce(t.deps);
    expect(r.status).toBe("done");
    expect(r.sent).toHaveLength(1);
    expect(codesIn(t.inner.sent[0]!.data)).toEqual(["bc_maattest"]);
    expect(t.receipts.calls()[0]?.functionName).toBe("execute");
    expect(t.previews[0]).toMatchObject({ action: 0, token: addressOf("NVDAc"), amount: 20_000_000n });
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ gate: "execute", decision: { allowed: true, reason: "OK" } });
    expect(t.store.txCount(DAY)).toBe(1);
  });

  it("logs a market refusal onchain once per day", async () => {
    const t = await setup({ batch: BUY20, preview: () => 6 });
    t.receipts.verdict = () => ({ allowed: false, reason: 6 });
    expect((await runOnce(t.deps)).sent).toHaveLength(1);
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ preview: "MARKET_CLOSED", gate: "log-refusal", decision: { allowed: false, reason: "MARKET_CLOSED" } });
    const again = await runOnce({ ...t.deps, runId: "run-2" });
    expect(again.sent).toEqual([]);
    expect((await t.journal.read()).filter((e) => e.kind === "intent").at(-1)).toMatchObject({ gate: "MARKET_CLOSED already logged today" });
  });

  it("does not spend gas on a bookkeeping refusal", async () => {
    const t = await setup({ batch: BUY20, preview: () => 14 });
    expect((await runOnce(t.deps)).sent).toEqual([]);
  });

  it("does nothing for an intent whose preview is unknown", async () => {
    const t = await setup({ batch: BUY20, preview: () => Promise.reject(new Error("rpc")) });
    expect((await runOnce(t.deps)).sent).toEqual([]);
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ preview: "UNKNOWN", previewError: "rpc", gate: "guard state unknown (RPC)" });
  });

  it("pays the compute bill first and marks it paid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-run-"));
    const store = await Store.open(dir);
    store.recordCompute(DAY - 1n, 300_000n);
    const t = await setup({ batch: BUY20, store });
    await runOnce(t.deps);
    const [first, second] = t.receipts.calls();
    expect(first?.functionName).toBe("execute");
    expect(first?.args[0]).toMatchObject({ action: 6, amount: 300_000n, payee: PAYEE });
    expect(second?.args[0]).toMatchObject({ action: 0 });
    expect(store.unpaidUsd6()).toBe(0n);
  });

  it("bills a failed Claude call and still settles bills", async () => {
    const t = await setup({ proposer: { propose: async () => ({ ok: false, error: "invalid proposal JSON: x", costUsd6: 30_000n }) } });
    const r = await runOnce(t.deps);
    expect(r.sent).toEqual([]);
    expect(t.store.unpaidUsd6()).toBe(30_000n);
    expect((await t.journal.read()).find((e) => e.kind === "run")).toMatchObject({ ok: false, error: "invalid proposal JSON: x", costUsd6: "30000" });
  });

  it("syncs a changed multiplier before trading", async () => {
    const t = await setup({ batch: BUY20, scene: standardScene().set(addressOf("NVDAc"), "uiMultiplier", 2n * 10n ** 18n) });
    await runOnce(t.deps);
    expect(t.receipts.calls().map((c) => c.functionName)).toEqual(["syncMultiplier", "execute"]);
    expect(codesIn(t.inner.sent[0]!.data)).toEqual(["bc_maattest"]);
  });

  it("records new USDC as revenue with notifyRevenue before trading", async () => {
    const t = await setup({ batch: BUY20, scene: standardScene().set(USDC, "balanceOf", 130_000_000n) });
    t.receipts.revenue = 30_000_000n;
    await runOnce(t.deps);
    expect(t.receipts.calls().map((c) => c.functionName)).toEqual(["notifyRevenue", "execute"]);
    expect(codesIn(t.inner.sent[0]!.data)).toEqual(["bc_maattest"]);
    const row = (await t.journal.read()).find((e) => e.kind === "housekeeping");
    expect(row).toMatchObject({ call: "notifyRevenue", amount: "30000000", txHash: `0x${"1".padStart(64, "0")}` });
    expect(t.store.txCount(DAY)).toBe(2);
  });

  it("leaves revenue below the threshold for later", async () => {
    const t = await setup({ scene: standardScene().set(USDC, "balanceOf", 100_049_999n) });
    expect((await runOnce(t.deps)).sent).toEqual([]);
    const t2 = await setup({ scene: standardScene().set(USDC, "balanceOf", 100_049_999n) });
    t2.deps.revenueMinUsd6 = 49_999n;
    expect((await runOnce(t2.deps)).sent).toHaveLength(1);
  });

  it("journals revenue in dry-run without sending", async () => {
    const t = await setup({ mode: "dry-run", scene: standardScene().set(USDC, "balanceOf", 130_000_000n) });
    await runOnce(t.deps);
    expect(t.inner.sent).toEqual([]);
    expect((await t.journal.read()).find((e) => e.kind === "housekeeping")).toMatchObject({ call: "notifyRevenue", amount: "30000000", note: "dry-run" });
  });

  it("does not halt when someone else recorded the revenue first", async () => {
    const t = await setup({ scene: standardScene().set(USDC, "balanceOf", 130_000_000n) });
    const r = await runOnce(t.deps); // receipts.revenue stays null: the receipt carries no RevenueReceived
    expect(r.status).toBe("done");
    expect((await t.journal.read()).find((e) => e.kind === "housekeeping")).toMatchObject({ amount: "0", note: "already recorded by another caller" });
  });

  it("skips housekeeping for a token whose lastMultiplier is unreadable", async () => {
    const t = await setup({ scene: standardScene().fail(VAULT, "lastMultiplier") });
    expect((await runOnce(t.deps)).sent).toEqual([]);
    expect((await t.journal.read()).filter((e) => e.kind === "housekeeping")).toEqual([]);
  });

  it("re-reads state after each transaction", async () => {
    const t = await setup({ batch: { summary: "two", intents: [BUY20.intents[0]!, { ...BUY20.intents[0]!, symbol: "AAPLc" }] } });
    await runOnce(t.deps);
    expect(t.inner.sent).toHaveLength(2);
    expect(t.reads()).toBe(2); // initial read + one before the second intent
  });

  it("halts the round when a send fails", async () => {
    const t = await setup({ batch: { summary: "two", intents: [BUY20.intents[0]!, { ...BUY20.intents[0]!, symbol: "AAPLc" }] } });
    t.inner.fail = new Error("cdp 500");
    const r = await runOnce(t.deps);
    expect(r.status).toBe("halted");
    expect(r.haltReason).toMatch(/cdp 500/);
    expect(t.previews).toHaveLength(1);
    expect(existsSync(join(t.dir, "state.json"))).toBe(true);
  });

  it("halts the round on a reverted receipt", async () => {
    const t = await setup({ batch: { summary: "two", intents: [BUY20.intents[0]!, { ...BUY20.intents[0]!, symbol: "AAPLc" }] } });
    t.receipts.status = "reverted";
    const r = await runOnce(t.deps);
    expect(r).toMatchObject({ status: "halted" });
    expect(r.sent).toHaveLength(1);
  });

  it("respects the daily tx cap", async () => {
    const t = await setup({ batch: BUY20, maxTxPerDay: 0 });
    const r = await runOnce(t.deps);
    expect(r).toMatchObject({ status: "halted", haltReason: "daily tx cap 0 reached", sent: [] });
  });

  it("skips an invalid proposal and continues", async () => {
    const t = await setup({ batch: { summary: "x", intents: [{ action: "BORROW", symbol: "NVDAc", amountUsd: 5, rationale: "r" }, BUY20.intents[0]!] } });
    const r = await runOnce(t.deps);
    expect(r.sent).toHaveLength(1);
    expect((await t.journal.read()).find((e) => e.kind === "skip")).toMatchObject({ error: "symbol NVDAc does not fit BORROW" });
  });

  it("sends every transaction with an explicit gas limit at or above its floor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-run-"));
    const store = await Store.open(dir);
    store.recordCompute(DAY - 1n, 300_000n);
    const t = await setup({ batch: BUY20, store, scene: standardScene().set(addressOf("NVDAc"), "uiMultiplier", 2n * 10n ** 18n) });
    t.receipts.estimate = () => 100_000n; // a starved-path estimate: the floor must win
    expect((await runOnce(t.deps)).status).toBe("done");
    const fns = t.receipts.calls().map((c) => c.functionName as keyof typeof GAS_FLOOR);
    expect(fns).toEqual(["syncMultiplier", "execute", "execute"]);
    t.inner.sent.forEach((tx, i) => expect(tx.gas).toBe(GAS_FLOOR[fns[i]!]));
    expect(t.receipts.estimates).toHaveLength(3);
    expect(t.receipts.estimates.every((e) => e.account === EXECUTOR && e.to === VAULT)).toBe(true);
  });

  it("halts without sending when the gas estimate fails", async () => {
    const t = await setup({ batch: BUY20 });
    t.receipts.estimate = () => Promise.reject(new Error("execution reverted"));
    const r = await runOnce(t.deps);
    expect(r).toMatchObject({ status: "halted", sent: [] });
    expect(r.haltReason).toMatch(/gas estimate failed for execute: execution reverted/);
    expect(t.inner.sent).toEqual([]);
  });

  it("halts when a syncMultiplier receipt carries no MultiplierChangeDetected", async () => {
    const t = await setup({ batch: BUY20, scene: standardScene().set(addressOf("NVDAc"), "uiMultiplier", 2n * 10n ** 18n) });
    t.receipts.syncEvent = false;
    const r = await runOnce(t.deps);
    expect(r.status).toBe("halted");
    expect(r.haltReason).toMatch(/no MultiplierChangeDetected/);
    expect(t.receipts.calls().map((c) => c.functionName)).toEqual(["syncMultiplier"]);
  });

  const billed = async (usd6 = 300_000n) => {
    const store = await Store.open(await mkdtemp(join(tmpdir(), "maat-run-")));
    store.recordCompute(DAY - 1n, usd6);
    return store;
  };
  const ID = `0x${"ab".repeat(32)}` as const;
  const pendingEntry = (o: { block?: string; txHash?: `0x${string}` } = {}) => ({
    intentId: ID,
    action: "PAY_EXPENSE",
    amount: "300000",
    gateKind: "execute" as const,
    preview: "OK",
    day: DAY.toString(),
    block: o.block ?? "100",
    ...(o.txHash ? { txHash: o.txHash } : {}),
  });

  describe("pending transactions", () => {
    it("journals a sent row with the hash and gas before the receipt arrives", async () => {
      const t = await setup({ batch: BUY20 });
      const r = await runOnce(t.deps);
      const rows = await t.journal.read();
      const sent = rows.findIndex((e) => e.kind === "sent");
      const decided = rows.findIndex((e) => e.kind === "intent");
      expect(sent).toBeGreaterThanOrEqual(0);
      expect(sent).toBeLessThan(decided);
      expect(rows[sent]).toMatchObject({ action: "BUY", symbol: "NVDAc", preview: "OK", gate: "execute", txHash: r.sent[0], gas: "2500000" });
      expect(t.store.pending()).toEqual([]);
    });

    it("does not bill again after a PAY_EXPENSE receipt timed out", async () => {
      const t = await setup({ store: await billed() });
      t.receipts.timeout = true;
      const first = await runOnce(t.deps);
      expect(first.status).toBe("halted");
      expect(t.store.pending()).toHaveLength(1);
      expect(t.store.pending()[0]?.txHash).toBe(first.sent[0]);
      t.receipts.timeout = false;
      const second = await runOnce({ ...t.deps, runId: "run-2" });
      expect(second).toMatchObject({ status: "done", sent: [] });
      expect(t.receipts.calls()).toHaveLength(1);
      expect(t.store.unpaidUsd6()).toBe(0n);
      expect(t.store.pending()).toEqual([]);
      expect((await t.journal.read()).find((e) => e.kind === "reconcile")).toMatchObject({ runId: "run-2", outcome: "applied", decision: { allowed: true, reason: "OK" } });
      expect(t.receipts.logQueries[0]).toMatchObject({ fromBlock: 100n });
    });

    it("reconciles a send that threw after broadcast instead of sending again", async () => {
      const t = await setup({ store: await billed() });
      t.inner.failAfterBroadcast = new Error("socket hang up");
      expect((await runOnce(t.deps)).status).toBe("halted");
      expect(t.store.pending()[0]).toMatchObject({ action: "PAY_EXPENSE", amount: "300000" });
      expect(t.store.pending()[0]?.txHash).toBeUndefined();
      t.inner.failAfterBroadcast = undefined;
      const second = await runOnce({ ...t.deps, runId: "run-2" });
      expect(second).toMatchObject({ status: "done", sent: [] });
      expect(t.inner.sent).toHaveLength(1);
      expect(t.store.unpaidUsd6()).toBe(0n);
    });

    it("applies a mined log-refusal, so the refusal is not logged twice", async () => {
      const t = await setup({ batch: BUY20, preview: () => 6 });
      t.receipts.verdict = () => ({ allowed: false, reason: 6 });
      t.receipts.timeout = true;
      expect((await runOnce(t.deps)).status).toBe("halted");
      t.receipts.timeout = false;
      const second = await runOnce({ ...t.deps, runId: "run-2" });
      expect(second).toMatchObject({ status: "done", sent: [] });
      expect(t.store.hasLoggedRefusal(DAY, "MARKET_CLOSED")).toBe(true);
      expect((await t.journal.read()).filter((e) => e.kind === "intent").at(-1)).toMatchObject({ runId: "run-2", gate: "MARKET_CLOSED already logged today" });
    });

    it("holds the round while a pending tx may still land", async () => {
      let asked = 0;
      const store = await billed();
      store.addPending(pendingEntry({ block: "90" }));
      const t = await setup({ store, proposer: { propose: async () => (asked++, { ok: false, error: "x", costUsd6: 0n }) } });
      const r = await runOnce(t.deps);
      expect(r).toMatchObject({ status: "pending-tx", sent: [] });
      expect(asked).toBe(0);
      expect(store.pending()).toHaveLength(1);
      expect((await t.journal.read()).at(-1)).toMatchObject({ kind: "reconcile", outcome: "pending", intentId: ID });
    });

    it("holds the round while the node still knows the tx, however old", async () => {
      const t = await setup({ store: await billed(), batch: BUY20 });
      t.receipts.timeout = true;
      const first = await runOnce(t.deps);
      t.receipts.timeout = false;
      t.receipts.mempool.add(first.sent[0]!);
      t.scene.block = { ...t.scene.block, number: 100n + PENDING_WINDOW_BLOCKS * 2n };
      const r = await runOnce({ ...t.deps, runId: "run-2" });
      expect(r).toMatchObject({ status: "pending-tx", sent: [] });
      expect(t.inner.sent).toHaveLength(1);
    });

    it("drops a pending entry older than the window that never reached the chain", async () => {
      const store = await billed();
      store.addPending(pendingEntry({ block: "100" }));
      const t = await setup({ store });
      t.scene.block = { ...t.scene.block, number: 100n + PENDING_WINDOW_BLOCKS };
      const r = await runOnce(t.deps);
      expect(r.status).toBe("done");
      expect((await t.journal.read()).find((e) => e.kind === "reconcile")).toMatchObject({ outcome: "dropped", intentId: ID });
      expect(t.receipts.calls()).toHaveLength(1); // billed again, once
      expect(t.receipts.calls()[0]?.args[0]).toMatchObject({ action: 6, amount: 300_000n });
      expect(store.unpaidUsd6()).toBe(0n);
    });

    it("drops a pending entry whose tx was mined and reverted", async () => {
      const t = await setup({ store: await billed() });
      t.receipts.timeout = true;
      t.receipts.status = "reverted";
      await runOnce(t.deps);
      t.receipts.timeout = false;
      const r = await runOnce({ ...t.deps, runId: "run-2" });
      expect((await t.journal.read()).find((e) => e.kind === "reconcile")).toMatchObject({ outcome: "dropped", note: expect.stringMatching(/reverted/) });
      expect(r.status).toBe("halted"); // in this fake the re-sent bill reverts too
      expect(t.inner.sent).toHaveLength(2);
      expect(t.store.pending()).toEqual([]);
    });
  });

  describe("preview / Decision mismatch", () => {
    const TWO: Batch = { summary: "two", intents: [BUY20.intents[0]!, { ...BUY20.intents[0]!, symbol: "AAPLc" }] };

    it("halts when the receipt has no Decision for the intent", async () => {
      const t = await setup({ batch: TWO });
      t.receipts.verdict = () => null;
      const r = await runOnce(t.deps);
      expect(r.status).toBe("halted");
      expect(r.haltReason).toMatch(/no Decision for intent/);
      expect(t.inner.sent).toHaveLength(1);
    });

    it("halts when the preview said OK but the vault refused", async () => {
      const t = await setup({ batch: TWO });
      t.receipts.verdict = () => ({ allowed: false, reason: 15 });
      const r = await runOnce(t.deps);
      expect(r).toMatchObject({ status: "halted", haltReason: "mismatch: preview OK, vault SWAP_FAILED" });
      expect(t.inner.sent).toHaveLength(1);
      const rows = await t.journal.read();
      expect(rows.find((e) => e.kind === "mismatch")).toMatchObject({ preview: "OK", decision: { allowed: false, reason: "SWAP_FAILED" }, message: "mismatch: preview OK, vault SWAP_FAILED" });
      expect(rows.find((e) => e.kind === "intent")).toMatchObject({ gate: "execute", decision: { allowed: false, reason: "SWAP_FAILED" } });
      expect(t.store.pending()).toEqual([]);
    });

    it("journals a log-refusal whose reason differs and continues", async () => {
      const t = await setup({ batch: TWO, preview: () => 6 });
      t.receipts.verdict = () => ({ allowed: false, reason: 7 });
      const r = await runOnce(t.deps);
      expect(r.status).toBe("done");
      expect(t.inner.sent).toHaveLength(1);
      const rows = await t.journal.read();
      expect(rows.find((e) => e.kind === "mismatch")).toMatchObject({ message: "mismatch: preview MARKET_CLOSED, vault FEED_STALE" });
      expect(rows.filter((e) => e.kind === "intent").at(-1)).toMatchObject({ gate: "MARKET_CLOSED already logged today" });
    });
  });

  it("refuses live mode without a sender", async () => {
    const t = await setup({ batch: BUY20 });
    await expect(runOnce({ ...t.deps, sender: null })).rejects.toThrow(/live mode needs a sender/);
  });
});
