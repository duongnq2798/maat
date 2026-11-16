import { randomUUID } from "node:crypto";
import {
  getAbiItem,
  getAddress,
  parseEventLogs,
  TransactionNotFoundError,
  zeroAddress,
  type Address,
  type Hex,
  type Log,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { logWindows } from "../chain/logWindows.js";
import { previewIntent, type PreviewClient } from "../chain/preview.js";
import { readVaultState, StateUnavailable, type StateClient, type VaultState } from "../chain/state.js";
import { encodeExecute, encodeSyncMultiplier, gasLimit, type GasFunction } from "../exec/calls.js";
import { SendRefused, type GuardedSender } from "../exec/sender.js";
import { buildIntent, type Proposal } from "../intent.js";
import type { Journal } from "../ledger/journal.js";
import type { PendingTx, Store } from "../ledger/store.js";
import type { Proposer } from "../llm/proposer.js";
import { DEFAULT_POLICY, evaluatePolicy, type PolicyParams } from "../policy.js";
import { gate } from "../refusals.js";
import { REASONS, type ReasonName } from "../types.js";
import { usdc6ToUsd } from "../units.js";

/** What runOnce needs from the chain around a send: gas estimates, receipts, and pending-tx reconciliation. */
export type TxClient = Pick<PublicClient, "waitForTransactionReceipt" | "estimateGas" | "getTransaction" | "getLogs" | "getBlockNumber" | "readContract">;
export const BILL_MIN_USD6 = 100_000n;
export const RECEIPT_TIMEOUT_MS = 120_000;
/** A pending send with no onchain trace is given up after this much chain time: 10 minutes. */
export const PENDING_WINDOW_SECONDS = 600n;
/** The same window for an entry older code stored without a timestamp: 10 minutes of Base's 200 ms blocks. */
export const LEGACY_PENDING_WINDOW_BLOCKS = 3_000n;

export interface RunDeps {
  vault: Address;
  executor: Address;
  expensePayee: Address;
  mode: "dry-run" | "live";
  defaultDailyComputeUsd6: bigint;
  maxTxPerDay: number;
  stateClient: StateClient;
  previewClient: PreviewClient;
  txClient: TxClient;
  proposer: Proposer;
  /** Required in live mode. Only a GuardedSender: the vault-only, gas-bounded, Builder-Code path. */
  sender: GuardedSender | null;
  store: Store;
  journal: Pick<Journal, "append">;
  policy?: PolicyParams;
  runId?: string;
}

export interface RunReport {
  runId: string;
  status: "no-state" | "wrong-executor" | "pending-tx" | "done" | "halted";
  block?: bigint;
  marketOpen?: boolean | null;
  sent: Hex[];
  skipped: number;
  proposals: number;
  haltReason?: string;
}

type Decision = { allowed: boolean; reason: string };

class Halt extends Error {}

const DECISION_EVENT = getAbiItem({ abi: mandateVaultAbi, name: "Decision" });
const firstLine = (e: unknown) => (e as Error).message.split("\n")[0];

function decisionIn(logs: readonly Log[], vault: Address, id: Hex): Decision | undefined {
  const parsed = parseEventLogs({ abi: mandateVaultAbi, eventName: "Decision", logs: logs as Log[] });
  const l = parsed.find((x) => getAddress(x.address) === getAddress(vault) && x.args.intentId.toLowerCase() === id.toLowerCase());
  return l && { allowed: l.args.allowed, reason: REASONS[Number(l.args.reason)] ?? `REASON_${l.args.reason}` };
}

/** syncMultiplier is only sent when uiMultiplier != lastMultiplier, so a missing event means the vault's read failed. */
function multiplierSynced(receipt: TransactionReceipt, vault: Address, token: Address): boolean {
  const logs = parseEventLogs({ abi: mandateVaultAbi, eventName: "MultiplierChangeDetected", logs: receipt.logs });
  return logs.some((x) => getAddress(x.address) === getAddress(vault) && getAddress(x.args.token) === getAddress(token));
}

export async function runOnce(d: RunDeps): Promise<RunReport> {
  if (d.mode === "live" && d.sender === null) throw new Error("live mode needs a sender");
  const runId = d.runId ?? `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const report: RunReport = { runId, status: "done", sent: [], skipped: 0, proposals: 0 };
  const j = d.journal;

  let s: VaultState;
  try {
    s = await readVaultState(d.stateClient, d.vault);
  } catch (e) {
    if (!(e instanceof StateUnavailable)) throw e;
    await j.append({ kind: "error", runId, message: `state unavailable: ${e.message}` });
    return { ...report, status: "no-state" };
  }
  report.block = s.blockNumber;
  report.marketOpen = s.marketOpen;
  if (getAddress(s.executor) !== getAddress(d.executor)) {
    await j.append({ kind: "error", runId, message: `vault executor is ${s.executor}, agent is ${d.executor}` });
    return { ...report, status: "wrong-executor" };
  }
  const day = s.day;
  const sender = d.mode === "live" ? d.sender : null;

  const reread = async () => {
    try {
      return await readVaultState(d.stateClient, d.vault);
    } catch (e) {
      throw new Halt(`state unavailable after a transaction: ${(e as Error).message}`);
    }
  };

  const checkCap = () => {
    if (d.store.txCount(day) >= d.maxTxPerDay) throw new Halt(`daily tx cap ${d.maxTxPerDay} reached`);
  };

  // The estimate goes through the public client as the executor; a failed estimate halts (no fallback limit).
  const gasFor = async (fn: GasFunction, data: Hex): Promise<bigint> => {
    try {
      return gasLimit(fn, await d.txClient.estimateGas({ account: d.executor, to: d.vault, data }));
    } catch (e) {
      throw new Halt(`gas estimate failed for ${fn}: ${firstLine(e)}`);
    }
  };

  const receiptOf = async (hash: Hex): Promise<TransactionReceipt> => {
    try {
      return await d.txClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch (e) {
      throw new Halt(`no receipt for ${hash}: ${firstLine(e)}`);
    }
  };

  /** The vault's Decision for `id` in blocks [from, to], one bounded eth_getLogs window at a time, oldest first. */
  const decisionInLogs = async (id: Hex, from: bigint, to: bigint): Promise<Decision | undefined> => {
    for (const { fromBlock, toBlock } of logWindows(from, to)) {
      const logs = await d.txClient.getLogs({ address: d.vault, event: DECISION_EVENT, args: { intentId: id }, fromBlock, toBlock });
      const decision = decisionIn(logs, d.vault, id);
      if (decision) return decision;
    }
    return undefined;
  };

  /** Applies a mined execute()'s Decision to the store, clears the pending entry, and checks it against the preview. */
  const settle = async (p: PendingTx, decision: Decision): Promise<void> => {
    if (p.action === "PAY_EXPENSE" && decision.allowed) d.store.recordPaid(BigInt(p.amount));
    if (p.gateKind === "log-refusal") d.store.recordRefusalLog(BigInt(p.day), p.preview as ReasonName);
    d.store.clearPending(p.intentId);
    await d.store.save();
    if (decision.reason !== p.preview) {
      const message = `mismatch: preview ${p.preview}, vault ${decision.reason}`;
      await j.append({ kind: "mismatch", runId, intentId: p.intentId, preview: p.preview, decision, message });
      // The guard and the vault disagree about an action we meant to take: stop and let a human look.
      if (p.gateKind === "execute") throw new Halt(message);
    }
  };

  /** Settles a send left over from an earlier round. "pending" means it may still land: do nothing this round. */
  const reconcile = async (p: PendingTx): Promise<"settled" | "pending"> => {
    const base = { kind: "reconcile" as const, runId, intentId: p.intentId, action: p.action, ...(p.txHash ? { txHash: p.txHash } : {}) };
    const drop = async (note: string) => {
      await j.append({ ...base, outcome: "dropped", note });
      d.store.clearPending(p.intentId);
      await d.store.save();
      return "settled" as const;
    };
    const wait = async (note: string) => {
      await j.append({ ...base, outcome: "pending", note });
      return "pending" as const;
    };
    const apply = async (decision: Decision, note: string) => {
      await j.append({ ...base, outcome: "applied", decision, note });
      await settle(p, decision);
      return "settled" as const;
    };

    // A known transaction is looked up first, so it cannot be mined between the usedIntent read and this one.
    let tx: { blockNumber: bigint | null } | null = null;
    if (p.txHash) {
      try {
        tx = await d.txClient.getTransaction({ hash: p.txHash });
      } catch (e) {
        if (!(e instanceof TransactionNotFoundError)) throw e;
      }
    }
    // A mined send carries its own Decision: its receipt is read before any log search.
    const receipt = tx && tx.blockNumber !== null ? await receiptOf(p.txHash!) : null;
    const mined = receipt ? decisionIn(receipt.logs, d.vault, p.intentId) : undefined;
    if (mined) return apply(mined, "Decision read from the tx receipt");
    // usedIntent is read at a fresh head, so a used intent's Decision lies between the send's block and that head.
    const head = await d.txClient.getBlockNumber({ cacheTime: 0 });
    const used = await d.txClient.readContract({ address: d.vault, abi: mandateVaultAbi, functionName: "usedIntent", args: [p.intentId], blockNumber: head });
    if (used) {
      const decision = await decisionInLogs(p.intentId, BigInt(p.block), head);
      if (!decision) throw new Halt(`intent ${p.intentId} is used but no Decision was found from block ${p.block} to ${head}`);
      return apply(decision, "Decision found in the vault's logs");
    }
    if (receipt) {
      if (receipt.status === "reverted") return drop("tx reverted; the intent was not used");
      return wait("tx mined but usedIntent is still false; the RPC may lag");
    }
    if (tx) return wait("tx is still in the mempool");
    // Aged in chain time, so a faster block interval cannot shrink the window. Entries without a timestamp age in blocks.
    const timed = p.timestamp !== undefined;
    const age = timed ? s.timestamp - BigInt(p.timestamp!) : s.blockNumber - BigInt(p.block);
    const window = timed ? PENDING_WINDOW_SECONDS : LEGACY_PENDING_WINDOW_BLOCKS;
    const unit = timed ? "s" : "blocks";
    if (age < window) return wait(`no onchain trace yet (${age} of ${window} ${unit})`);
    return drop(`intent not used and no tx found after ${age} ${unit}`);
  };

  try {
    for (const p of [...d.store.pending()]) {
      if ((await reconcile(p)) === "pending") {
        report.status = "pending-tx";
        return report;
      }
    }

    // Housekeeping: record multiplier changes the vault would otherwise only see on a trade of that token.
    for (const t of s.tokens) {
      const hasMarket = t.config.feed !== zeroAddress || t.config.pool !== zeroAddress;
      if (!hasMarket || t.uiMultiplier === null || t.lastMultiplier === null || t.uiMultiplier === t.lastMultiplier) continue;
      if (!sender) {
        await j.append({ kind: "housekeeping", runId, call: "syncMultiplier", token: t.address, note: "dry-run" });
        continue;
      }
      checkCap();
      const data = encodeSyncMultiplier(t.address);
      const gas = await gasFor("syncMultiplier", data);
      d.store.recordTx(day);
      const hash = await sender.send({ to: d.vault, data, idempotencyKey: `sync:${runId}:${t.address}`, gas });
      report.sent.push(hash);
      const r = await receiptOf(hash);
      if (r.status !== "success") throw new Halt(`tx ${hash} reverted`);
      await j.append({ kind: "housekeeping", runId, call: "syncMultiplier", token: t.address, txHash: hash, gas, gasUsed: r.gasUsed });
      if (!multiplierSynced(r, d.vault, t.address)) throw new Halt(`syncMultiplier ${t.address}: no MultiplierChangeDetected in ${hash}`);
    }
    let dirty = report.sent.length > 0;
    if (dirty) {
      s = await reread();
      dirty = false;
    }

    const unpaid = d.store.unpaidUsd6();
    const policy = evaluatePolicy(
      s,
      { dailyComputeUsd6: d.store.dailyComputeUsd6(day, d.defaultDailyComputeUsd6), unpaidUsd6: unpaid },
      d.policy ?? DEFAULT_POLICY,
    );
    const out = await d.proposer.propose({ state: s, policy, billUsd6: unpaid });
    d.store.recordCompute(day, out.costUsd6);
    await j.append({
      kind: "run",
      runId,
      block: s.blockNumber,
      day,
      mode: d.mode,
      ok: out.ok,
      summary: out.ok ? out.summary : "",
      costUsd6: out.costUsd6,
      suggestions: policy.suggestions.length,
      proposals: out.ok ? out.proposals.length : 0,
      ...(out.ok ? {} : { error: out.error }),
    });

    const queue: Proposal[] = [];
    if (unpaid >= BILL_MIN_USD6) {
      const usd = usdc6ToUsd(unpaid);
      queue.push({ action: "PAY_EXPENSE", symbol: "USDC", amountUsd: usd, rationale: `Compute bill: $${usd.toFixed(6)} of Claude API usage unpaid as of UTC day ${day}` });
    }
    if (out.ok) queue.push(...out.proposals);
    report.proposals = queue.length;

    for (const [index, p] of queue.entries()) {
      if (dirty) {
        s = await reread();
        dirty = false;
      }
      const b = buildIntent(p, s, { runId, index, expensePayee: d.expensePayee });
      if (!b.ok) {
        await j.append({ kind: "skip", runId, index, symbol: p.symbol, action: p.action, error: b.error });
        report.skipped++;
        continue;
      }
      const pv = await previewIntent(d.previewClient, d.vault, d.executor, b.intent);
      const preview = pv.result;
      const logged = preview !== "OK" && preview !== "UNKNOWN" && d.store.hasLoggedRefusal(day, preview);
      const g = gate(preview, logged);
      const row = {
        kind: "intent" as const,
        runId,
        index,
        intentId: b.intent.id,
        action: p.action,
        symbol: p.symbol,
        amountUsd6: b.amountUsd6,
        rationale: p.rationale,
        rationaleHash: b.intent.rationaleHash,
        preview,
        ...(pv.error === undefined ? {} : { previewError: pv.error }),
      };
      if (!g.send || !sender) {
        await j.append({ ...row, gate: g.send ? `dry-run: would ${g.kind}` : g.why });
        report.skipped++;
        continue;
      }

      // Persist the intent as pending before it can leave the process, so a crash, a receipt timeout or a send that
      // fails after broadcast is reconciled next round instead of being billed or logged twice.
      checkCap();
      const data = encodeExecute(b.intent);
      const gas = await gasFor("execute", data);
      const entry: PendingTx = {
        intentId: b.intent.id,
        action: p.action,
        amount: b.intent.amount.toString(),
        gateKind: g.kind,
        preview,
        day: day.toString(),
        block: s.blockNumber.toString(),
        timestamp: s.timestamp.toString(),
      };
      d.store.addPending(entry);
      d.store.recordTx(day);
      await d.store.save();
      let hash: Hex;
      try {
        hash = await sender.send({ to: d.vault, data, idempotencyKey: b.intent.id, gas });
      } catch (e) {
        if (e instanceof SendRefused) d.store.clearPending(entry.intentId); // refused before anything was broadcast
        throw e;
      }
      report.sent.push(hash);
      d.store.setPendingHash(entry.intentId, hash);
      await d.store.save();
      await j.append({ ...row, kind: "sent", gate: g.kind, txHash: hash, gas });

      const receipt = await receiptOf(hash);
      dirty = true;
      if (receipt.status !== "success") {
        d.store.clearPending(entry.intentId); // a reverted execute() leaves the intent unused
        throw new Halt(`tx ${hash} reverted`);
      }
      const decision = decisionIn(receipt.logs, d.vault, b.intent.id);
      if (!decision) throw new Halt(`no Decision for intent ${b.intent.id} in tx ${hash}`);
      await j.append({ ...row, gate: g.kind, txHash: hash, gasUsed: receipt.gasUsed, decision });
      await settle(entry, decision);
    }
  } catch (e) {
    report.status = "halted";
    // The first line only: viem lists the RPC URL, which may carry a key, on the lines below it.
    report.haltReason = firstLine(e);
    await j.append({ kind: "error", runId, message: `halted: ${report.haltReason}` });
  } finally {
    await d.store.save();
  }
  return report;
}
