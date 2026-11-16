import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpRequestError, keccak256, size, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf } from "../src/addresses.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { GAS_FLOOR } from "../src/exec/calls.js";
import { GuardedSender } from "../src/exec/sender.js";
import { Journal, type JournalRow } from "../src/ledger/journal.js";
import { Store } from "../src/ledger/store.js";
import { FixedProposer, type Proposer } from "../src/llm/proposer.js";
import type { Batch } from "../src/llm/schema.js";
import { LEGACY_PENDING_WINDOW_BLOCKS, PENDING_WINDOW_SECONDS, runOnce, type RunDeps } from "../src/loop/runOnce.js";
import type { OnchainIntent } from "../src/types.js";
import { EXECUTOR, VAULT, standardScene, withCalendar, type FakeChain } from "./fakes/fakeChain.js";
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

  it("logs a market refusal once per UTC day while the calendar is unreadable, and journals why", async () => {
    const t = await setup({ batch: BUY20, preview: () => 6 });
    t.receipts.verdict = () => ({ allowed: false, reason: 6 });
    const why = `calendar unreadable: the refusal is keyed by UTC day ${DAY}`;
    expect((await runOnce(t.deps)).sent).toHaveLength(1);
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({
      preview: "MARKET_CLOSED",
      gate: "log-refusal",
      rationale: "underweight",
      note: why,
      decision: { allowed: false, reason: "MARKET_CLOSED" },
    });
    const again = await runOnce({ ...t.deps, runId: "run-2" });
    expect(again.sent).toEqual([]);
    expect((await t.journal.read()).filter((e) => e.kind === "intent").at(-1)).toMatchObject({ gate: `MARKET_CLOSED already logged for UTC day ${DAY}`, note: why });
  });

  it("loads an older state file's UTC-day refusals, which hold only while the calendar is unreadable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-run-"));
    await writeFile(join(dir, "state.json"), JSON.stringify({ version: 1, compute: {}, paidUsd6: "0", refusals: { [DAY.toString()]: ["MARKET_CLOSED"] }, txByDay: {} }));
    const store = await Store.open(dir);
    const unread = await setup({ batch: BUY20, preview: () => 6, store });
    expect((await runOnce(unread.deps)).sent).toEqual([]);
    expect((await unread.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ gate: `MARKET_CLOSED already logged for UTC day ${DAY}` });
    const read = await setup({ batch: BUY20, preview: () => 6, store, scene: withCalendar(standardScene()) });
    read.receipts.verdict = () => ({ allowed: false, reason: 6 });
    expect((await runOnce(read.deps)).sent).toHaveLength(1);
    expect(store.hasLoggedRefusal({ day: "2026-11-06", reason: "MARKET_CLOSED:overnight" })).toBe(true); // Friday 16:20 ET
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
  const SENT_AT = 1_794_000_000n; // the standard scene's block timestamp
  /** `timestamp: null` stores the entry the way older code did, without one. */
  const pendingEntry = (o: { block?: string; timestamp?: string | null; txHash?: `0x${string}` } = {}) => ({
    intentId: ID,
    action: "PAY_EXPENSE",
    amount: "300000",
    gateKind: "execute" as const,
    preview: "OK",
    day: DAY.toString(),
    block: o.block ?? "100",
    ...(o.timestamp === null ? {} : { timestamp: o.timestamp ?? SENT_AT.toString() }),
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
      expect(t.store.pending()[0]).toMatchObject({ block: "100", timestamp: SENT_AT.toString(), txHash: first.sent[0] });
      t.receipts.timeout = false;
      const second = await runOnce({ ...t.deps, runId: "run-2" });
      expect(second).toMatchObject({ status: "done", sent: [] });
      expect(t.receipts.calls()).toHaveLength(1);
      expect(t.store.unpaidUsd6()).toBe(0n);
      expect(t.store.pending()).toEqual([]);
      expect((await t.journal.read()).find((e) => e.kind === "reconcile")).toMatchObject({
        runId: "run-2",
        outcome: "applied",
        decision: { allowed: true, reason: "OK" },
        note: "Decision read from the tx receipt",
      });
      expect(t.receipts.logQueries).toEqual([]); // the mined tx's receipt settles it: no eth_getLogs
      expect(t.receipts.usedAt).toEqual([]); // and no usedIntent read
    });

    it("searches the logs when the mined tx's receipt holds no Decision for the intent", async () => {
      const t = await setup({ store: await billed() });
      t.receipts.timeout = true;
      await runOnce(t.deps);
      t.receipts.timeout = false;
      t.receipts.decisionInReceipt = false;
      expect(await runOnce({ ...t.deps, runId: "run-2" })).toMatchObject({ status: "done", sent: [] });
      expect((await t.journal.read()).find((e) => e.kind === "reconcile")).toMatchObject({ outcome: "applied", note: "Decision found in the vault's logs" });
      expect(t.receipts.logQueries).toHaveLength(1);
      expect(t.store.unpaidUsd6()).toBe(0n);
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

    const windows = (t: { receipts: FakeReceipts }) => t.receipts.logQueries.map((q) => [q.fromBlock, q.toBlock]);

    it("searches the logs in bounded windows from the send's block and stops at the Decision", async () => {
      const t = await setup({ store: await billed() });
      t.inner.failAfterBroadcast = new Error("socket hang up");
      await runOnce(t.deps);
      t.inner.failAfterBroadcast = undefined;
      t.receipts.minedAt = 100n + 20_000n;
      t.receipts.head = 100n + 40_000n;
      expect(await runOnce({ ...t.deps, runId: "run-2" })).toMatchObject({ status: "done", sent: [] });
      expect(windows(t)).toEqual([
        [100n, 9_099n],
        [9_100n, 18_099n],
        [18_100n, 27_099n],
      ]);
      expect(t.receipts.usedAt).toEqual([40_100n]); // usedIntent is read at the head the search ends at
      expect(t.receipts.headReads).toEqual([{ cacheTime: 0 }]); // a fresh head, not viem's cached block number
      expect(t.store.unpaidUsd6()).toBe(0n);
    });

    it("searches every window up to the head before it halts on a used intent with no Decision", async () => {
      const t = await setup({ store: await billed() });
      t.inner.failAfterBroadcast = new Error("socket hang up");
      await runOnce(t.deps);
      t.inner.failAfterBroadcast = undefined;
      t.receipts.verdict = () => null;
      t.receipts.head = 100n + 18_000n;
      const r = await runOnce({ ...t.deps, runId: "run-2" });
      expect(r.status).toBe("halted");
      expect(r.haltReason).toMatch(/is used but no Decision was found from block 100 to 18100$/);
      expect(windows(t)).toEqual([
        [100n, 9_099n],
        [9_100n, 18_099n],
        [18_100n, 18_100n],
      ]);
    });

    it("applies a mined log-refusal, so the refusal is not logged twice", async () => {
      const t = await setup({ batch: BUY20, preview: () => 6 });
      t.receipts.verdict = () => ({ allowed: false, reason: 6 });
      t.receipts.timeout = true;
      expect((await runOnce(t.deps)).status).toBe("halted");
      t.receipts.timeout = false;
      const second = await runOnce({ ...t.deps, runId: "run-2" });
      expect(second).toMatchObject({ status: "done", sent: [] });
      expect(t.store.hasLoggedRefusal({ day: DAY.toString(), reason: "MARKET_CLOSED" })).toBe(true);
      expect((await t.journal.read()).filter((e) => e.kind === "intent").at(-1)).toMatchObject({ runId: "run-2", gate: `MARKET_CLOSED already logged for UTC day ${DAY}` });
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
      t.scene.block = { number: 100n + LEGACY_PENDING_WINDOW_BLOCKS * 2n, timestamp: SENT_AT + PENDING_WINDOW_SECONDS * 2n };
      const r = await runOnce({ ...t.deps, runId: "run-2" });
      expect(r).toMatchObject({ status: "pending-tx", sent: [] });
      expect(t.inner.sent).toHaveLength(1);
    });

    it("waits out the window in chain time, however many blocks pass", async () => {
      const store = await billed();
      store.addPending(pendingEntry({ block: "100" }));
      const t = await setup({ store });
      t.scene.block = { number: 100n + LEGACY_PENDING_WINDOW_BLOCKS * 10n, timestamp: SENT_AT + PENDING_WINDOW_SECONDS - 1n };
      expect(await runOnce(t.deps)).toMatchObject({ status: "pending-tx", sent: [] });
      expect((await t.journal.read()).at(-1)).toMatchObject({ kind: "reconcile", outcome: "pending", note: "no onchain trace yet (599 of 600 s)" });
      expect(store.pending()).toHaveLength(1);
    });

    it("drops a pending entry older than the window that never reached the chain", async () => {
      const store = await billed();
      store.addPending(pendingEntry({ block: "100" }));
      const t = await setup({ store });
      t.scene.block = { ...t.scene.block, timestamp: SENT_AT + PENDING_WINDOW_SECONDS };
      const r = await runOnce(t.deps);
      expect(r.status).toBe("done");
      expect((await t.journal.read()).find((e) => e.kind === "reconcile")).toMatchObject({ outcome: "dropped", intentId: ID, note: "intent not used and no tx found after 600 s" });
      expect(t.receipts.calls()).toHaveLength(1); // billed again, once
      expect(t.receipts.calls()[0]?.args[0]).toMatchObject({ action: 6, amount: 300_000n });
      expect(store.unpaidUsd6()).toBe(0n);
    });

    it("ages an entry stored without a timestamp in blocks", async () => {
      const store = await billed();
      store.addPending(pendingEntry({ block: "100", timestamp: null }));
      const t = await setup({ store });
      t.scene.block = { number: 100n + LEGACY_PENDING_WINDOW_BLOCKS - 1n, timestamp: SENT_AT + PENDING_WINDOW_SECONDS * 2n };
      expect((await runOnce(t.deps)).status).toBe("pending-tx");
      expect((await t.journal.read()).at(-1)).toMatchObject({ outcome: "pending", note: "no onchain trace yet (2999 of 3000 blocks)" });
      t.scene.block = { ...t.scene.block, number: 100n + LEGACY_PENDING_WINDOW_BLOCKS };
      expect((await runOnce({ ...t.deps, runId: "run-2" })).status).toBe("done");
      expect((await t.journal.read()).find((e) => e.kind === "reconcile" && e.outcome === "dropped")).toMatchObject({
        runId: "run-2",
        note: "intent not used and no tx found after 3000 blocks",
      });
      expect(store.pending()).toEqual([]);
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

    it("keeps the RPC URL, which may carry a key, out of the halt reason and the journal", async () => {
      const store = await billed();
      store.addPending(pendingEntry());
      const t = await setup({ store });
      const url = "https://rpc.example.org/v2/SECRET-KEY";
      const readContract = (async () => {
        throw new HttpRequestError({ url, body: { method: "eth_call" }, details: "fetch failed" });
      }) as never;
      const r = await runOnce({ ...t.deps, txClient: { ...t.deps.txClient, readContract } });
      expect(r).toMatchObject({ status: "halted", haltReason: "HTTP request failed." });
      expect(JSON.stringify(await t.journal.read())).not.toContain("SECRET-KEY");
    });

    it("halts and journals a thrown value that is not an Error", async () => {
      const store = await billed();
      store.addPending(pendingEntry());
      const t = await setup({ store });
      const readContract = (async () => {
        throw "rate limited\nby https://rpc.example.org";
      }) as never;
      const r = await runOnce({ ...t.deps, txClient: { ...t.deps.txClient, readContract } });
      expect(r).toMatchObject({ status: "halted", haltReason: "rate limited" });
      expect((await t.journal.read()).at(-1)).toMatchObject({ kind: "error", message: "halted: rate limited" });
    });
  });

  describe("refusal logs per NYSE date", () => {
    const NOV25 = 1_795_564_800n; // 2026-11-25T00:00Z, a Wednesday; New York is on EST (UTC-5) from November 1
    const utc = (hours: number, minutes = 0) => NOV25 + BigInt(hours) * 3600n + BigInt(minutes) * 60n;
    const WED_1559_ET = utc(20, 59);
    const WED_1630_ET = utc(21, 30);
    const WED_2330_ET = utc(28, 30); // 04:30 UTC on Thursday 26 November
    const THU_1000_ET = utc(39); // Thanksgiving
    const THU_1400_ET = utc(43);
    const THU_2100_ET = utc(50); // 02:00 UTC on Friday 27 November
    const FRI_0800_ET = utc(61);
    const FRI_1400_ET = utc(67); // after the 13:00 ET early close
    const CLOSED = (note: string) => `underweight (market closed, ${note})`;

    type Row = Extract<JournalRow, { kind: "intent" | "sent" }>;
    const isRow = (e: JournalRow): e is Row => e.kind === "intent" || e.kind === "sent";

    /** The calendar answers like MarketCalendar; every preview and Decision is `reason`. */
    async function week(reason = 6, mode: "dry-run" | "live" = "live") {
      const scene = withCalendar(standardScene());
      const t = await setup({ batch: BUY20, preview: () => reason, scene, mode });
      t.receipts.verdict = () => ({ allowed: false, reason });
      let n = 0;
      const round = (ts: bigint, over: Partial<RunDeps> = {}) => {
        scene.block = { ...scene.block, timestamp: ts };
        return runOnce({ ...t.deps, ...over, runId: `run-${++n}` });
      };
      const intents = async () => (await t.journal.read()).filter((e): e is Extract<Row, { kind: "intent" }> => e.kind === "intent");
      return { ...t, round, intents };
    }

    it("logs Wednesday's after-close refusal once for NYSE date 2026-11-25, also after midnight UTC", async () => {
      const t = await week();
      expect((await t.round(WED_1630_ET)).sent).toHaveLength(1);
      expect((await t.round(WED_2330_ET)).sent).toEqual([]);
      expect((await t.intents()).map((r) => [r.gate, r.rationale])).toEqual([
        ["log-refusal", CLOSED("outside regular hours")],
        ["MARKET_CLOSED already logged for NYSE date 2026-11-25 (overnight)", "underweight"],
      ]);
      expect(t.store.hasLoggedRefusal({ day: "2026-11-25", reason: "MARKET_CLOSED:overnight" })).toBe(true);
    });

    it("leaves a MARKET_CLOSED to the next round while the calendar at the state block is open, so the log names its phase", async () => {
      // The preview reads a later block than the state, here one past the 16:00 ET close.
      const t = await week();
      expect((await t.round(WED_1559_ET)).sent).toEqual([]);
      expect((await t.round(WED_1630_ET)).sent).toHaveLength(1);
      expect((await t.intents()).map((r) => [r.gate, r.rationale])).toEqual([
        ["MARKET_CLOSED but the calendar is open at the state block; left to a round that reads the closed phase", "underweight"],
        ["log-refusal", CLOSED("outside regular hours")],
      ]);
    });

    it("logs the Thanksgiving refusal once, naming the holiday, through Thursday evening ET", async () => {
      const t = await week();
      expect((await t.round(THU_1000_ET)).sent).toHaveLength(1);
      expect((await t.round(THU_1400_ET)).sent).toEqual([]);
      expect((await t.round(THU_2100_ET)).sent).toEqual([]);
      const already = "MARKET_CLOSED already logged for NYSE date 2026-11-26 (holiday)";
      expect((await t.intents()).map((r) => [r.gate, r.rationale])).toEqual([
        ["log-refusal", CLOSED("NYSE holiday: Thanksgiving")],
        [already, "underweight"],
        [already, "underweight"],
      ]);
    });

    it("logs Friday's overnight and early-close refusals, whatever the week logged before", async () => {
      const t = await week();
      for (const ts of [WED_1630_ET, WED_2330_ET, THU_1000_ET, THU_1400_ET, THU_2100_ET]) await t.round(ts);
      expect((await t.round(FRI_0800_ET)).sent).toHaveLength(1);
      expect((await t.round(FRI_1400_ET)).sent).toHaveLength(1);
      expect((await t.intents()).filter((r) => r.gate === "log-refusal").map((r) => [r.runId, r.rationale])).toEqual([
        ["run-1", CLOSED("outside regular hours")],
        ["run-3", CLOSED("NYSE holiday: Thanksgiving")],
        ["run-6", CLOSED("outside regular hours")],
        ["run-7", CLOSED("early close 13:00 ET")],
      ]);
      expect(t.inner.sent).toHaveLength(4);
      expect(t.store.hasLoggedRefusal({ day: "2026-11-27", reason: "MARKET_CLOSED:overnight" })).toBe(true);
      expect(t.store.hasLoggedRefusal({ day: "2026-11-27", reason: "MARKET_CLOSED:early-close" })).toBe(true);
    });

    it("logs any other loggable reason at most once per NYSE date", async () => {
      const t = await week(7); // FEED_STALE
      expect((await t.round(WED_1630_ET)).sent).toHaveLength(1);
      expect((await t.round(WED_2330_ET)).sent).toEqual([]);
      expect((await t.round(THU_1000_ET)).sent).toHaveLength(1);
      expect((await t.intents()).map((r) => [r.gate, r.rationale])).toEqual([
        ["log-refusal", "underweight"],
        ["FEED_STALE already logged for NYSE date 2026-11-25", "underweight"],
        ["log-refusal", "underweight"],
      ]);
    });

    it("hashes the rationale it journals and sends, Claude's text and the phase note together", async () => {
      const t = await week();
      await t.round(THU_1000_ET);
      const rows = (await t.journal.read()).filter(isRow);
      expect(rows.map((r) => r.kind)).toEqual(["sent", "intent"]);
      const sent = t.receipts.calls()[0]!.args[0] as OnchainIntent;
      for (const r of rows) {
        expect(r.rationale).toBe(CLOSED("NYSE holiday: Thanksgiving"));
        expect(r.rationaleHash).toBe(keccak256(toBytes(r.rationale)));
        expect(sent.rationaleHash).toBe(r.rationaleHash);
      }
    });

    it("journals in dry-run the noted rationale a log would carry, with its hash", async () => {
      const t = await week(6, "dry-run");
      await t.round(FRI_1400_ET);
      const [row] = await t.intents();
      expect(row).toMatchObject({ gate: "dry-run: would log-refusal", rationale: CLOSED("early close 13:00 ET") });
      expect(row!.rationaleHash).toBe(keccak256(toBytes(row!.rationale)));
    });

    it("records the key stored at send time when a round after a restart settles the send", async () => {
      const t = await week();
      t.receipts.timeout = true;
      expect((await t.round(WED_2330_ET)).status).toBe("halted");
      const refusal = { day: "2026-11-25", reason: "MARKET_CLOSED:overnight" };
      expect(t.store.pending()).toEqual([expect.objectContaining({ gateKind: "log-refusal", refusal })]);
      t.receipts.timeout = false;
      const store = await Store.open(t.dir);
      expect(await t.round(THU_1000_ET, { store })).toMatchObject({ status: "done" });
      expect((await t.journal.read()).find((e) => e.kind === "reconcile")).toMatchObject({ outcome: "applied" });
      expect(store.hasLoggedRefusal(refusal)).toBe(true);
      expect(store.hasLoggedRefusal({ day: "2026-11-26", reason: "MARKET_CLOSED:holiday" })).toBe(true);
      expect(t.inner.sent).toHaveLength(2);
    });

    it("settles a pending log-refusal that older code stored with only its UTC day", async () => {
      const t = await week();
      t.receipts.timeout = true;
      await t.round(WED_2330_ET);
      t.receipts.timeout = false;
      const file = join(t.dir, "state.json");
      const raw = JSON.parse(await readFile(file, "utf8"));
      delete raw.pending[0].refusal;
      await writeFile(file, JSON.stringify(raw));
      const store = await Store.open(t.dir);
      expect(store.pending()[0]).not.toHaveProperty("refusal");
      expect(await t.round(THU_1000_ET, { store })).toMatchObject({ status: "done" });
      expect(store.pending()).toEqual([]);
      expect(store.hasLoggedRefusal({ day: (WED_2330_ET / 86_400n).toString(), reason: "MARKET_CLOSED" })).toBe(true);
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
      expect(rows.filter((e) => e.kind === "intent").at(-1)).toMatchObject({ gate: `MARKET_CLOSED already logged for UTC day ${DAY}` });
    });
  });

  it("refuses live mode without a sender", async () => {
    const t = await setup({ batch: BUY20 });
    await expect(runOnce({ ...t.deps, sender: null })).rejects.toThrow(/live mode needs a sender/);
  });
});
