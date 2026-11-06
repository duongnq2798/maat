import { randomUUID } from "node:crypto";
import { getAddress, parseEventLogs, zeroAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { previewIntent, type PreviewClient } from "../chain/preview.js";
import { readVaultState, StateUnavailable, type StateClient, type VaultState } from "../chain/state.js";
import { encodeExecute, encodeSyncMultiplier, gasLimit, type GasFunction } from "../exec/calls.js";
import type { TxSender } from "../exec/sender.js";
import { buildIntent, type Proposal } from "../intent.js";
import type { Journal } from "../ledger/journal.js";
import type { Store } from "../ledger/store.js";
import type { Proposer } from "../llm/proposer.js";
import { DEFAULT_POLICY, evaluatePolicy, type PolicyParams } from "../policy.js";
import { gate } from "../refusals.js";
import { REASONS, type ReasonName } from "../types.js";
import { usdc6ToUsd } from "../units.js";

/** What runOnce needs from the chain around a send. */
export type TxClient = Pick<PublicClient, "waitForTransactionReceipt" | "estimateGas">;
export const BILL_MIN_USD6 = 100_000n;
export const RECEIPT_TIMEOUT_MS = 120_000;

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
  sender: TxSender | null;
  store: Store;
  journal: Pick<Journal, "append">;
  policy?: PolicyParams;
  runId?: string;
}

export interface RunReport {
  runId: string;
  status: "no-state" | "wrong-executor" | "done" | "halted";
  block?: bigint;
  marketOpen?: boolean | null;
  sent: Hex[];
  skipped: number;
  proposals: number;
  haltReason?: string;
}

class Halt extends Error {}

function decisionOf(receipt: TransactionReceipt, vault: Address, id: Hex): { allowed: boolean; reason: string } | undefined {
  const logs = parseEventLogs({ abi: mandateVaultAbi, eventName: "Decision", logs: receipt.logs });
  const l = logs.find((x) => getAddress(x.address) === getAddress(vault) && x.args.intentId === id);
  return l && { allowed: l.args.allowed, reason: REASONS[Number(l.args.reason)] ?? `REASON_${l.args.reason}` };
}

/** syncMultiplier is only sent when uiMultiplier != lastMultiplier, so a missing event means the vault's read failed. */
function multiplierSynced(receipt: TransactionReceipt, vault: Address, token: Address): boolean {
  const logs = parseEventLogs({ abi: mandateVaultAbi, eventName: "MultiplierChangeDetected", logs: receipt.logs });
  return logs.some((x) => getAddress(x.address) === getAddress(vault) && getAddress(x.args.token) === getAddress(token));
}

export async function runOnce(d: RunDeps): Promise<RunReport> {
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
  const live = d.mode === "live" && d.sender !== null;

  const reread = async () => {
    try {
      return await readVaultState(d.stateClient, d.vault);
    } catch (e) {
      throw new Halt(`state unavailable after a transaction: ${(e as Error).message}`);
    }
  };

  // The estimate goes through the public client as the executor; a failed estimate halts (no fallback limit).
  const gasFor = async (fn: GasFunction, data: Hex): Promise<bigint> => {
    try {
      return gasLimit(fn, await d.txClient.estimateGas({ account: d.executor, to: d.vault, data }));
    } catch (e) {
      throw new Halt(`gas estimate failed for ${fn}: ${(e as Error).message.split("\n")[0]}`);
    }
  };

  const sendAndWait = async (fn: GasFunction, data: Hex, key: string): Promise<TransactionReceipt> => {
    if (d.store.txCount(day) >= d.maxTxPerDay) throw new Halt(`daily tx cap ${d.maxTxPerDay} reached`);
    const gas = await gasFor(fn, data);
    const hash = await d.sender!.send({ to: d.vault, data, idempotencyKey: key, gas });
    d.store.recordTx(day);
    report.sent.push(hash);
    const receipt = await d.txClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new Halt(`tx ${hash} reverted`);
    return receipt;
  };

  try {
    // Housekeeping: record multiplier changes the vault would otherwise only see on a trade of that token.
    for (const t of s.tokens) {
      const hasMarket = t.config.feed !== zeroAddress || t.config.pool !== zeroAddress;
      if (!hasMarket || t.uiMultiplier === null || t.uiMultiplier === t.lastMultiplier) continue;
      if (!live) {
        await j.append({ kind: "housekeeping", runId, call: "syncMultiplier", token: t.address, note: "dry-run" });
        continue;
      }
      const r = await sendAndWait("syncMultiplier", encodeSyncMultiplier(t.address), `sync:${runId}:${t.address}`);
      await j.append({ kind: "housekeeping", runId, call: "syncMultiplier", token: t.address, txHash: r.transactionHash, gasUsed: r.gasUsed });
      if (!multiplierSynced(r, d.vault, t.address)) throw new Halt(`syncMultiplier ${t.address}: no MultiplierChangeDetected in ${r.transactionHash}`);
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
      const preview = await previewIntent(d.previewClient, d.vault, d.executor, b.intent);
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
      };
      if (!g.send || !live) {
        await j.append({ ...row, gate: g.send ? `dry-run: would ${g.kind}` : g.why });
        report.skipped++;
        continue;
      }
      const receipt = await sendAndWait("execute", encodeExecute(b.intent), b.intent.id);
      dirty = true;
      const decision = decisionOf(receipt, d.vault, b.intent.id);
      if (g.kind === "log-refusal") d.store.recordRefusalLog(day, preview as ReasonName);
      if (p.action === "PAY_EXPENSE" && decision?.allowed) d.store.recordPaid(b.intent.amount);
      await j.append({ ...row, gate: g.kind, txHash: receipt.transactionHash, ...(decision ? { decision } : {}) });
    }
  } catch (e) {
    report.status = "halted";
    report.haltReason = (e as Error).message;
    await j.append({ kind: "error", runId, message: `halted: ${report.haltReason}` });
  } finally {
    await d.store.save();
  }
  return report;
}
