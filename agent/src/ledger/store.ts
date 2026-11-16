import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hex } from "viem";
import type { ReasonName } from "../types.js";

/** An execute() the agent is about to send or has sent but not yet settled. Bigints are decimal strings. */
export interface PendingTx {
  intentId: Hex;
  txHash?: Hex;
  action: string;
  amount: string;
  gateKind: "execute" | "log-refusal";
  /** The preview verdict at send time; a log-refusal records this reason as logged. */
  preview: string;
  day: string;
  /** The state block the round read before sending: the getLogs lower bound, and the age origin without `timestamp`. */
  block: string;
  /** That block's timestamp (unix seconds): the age origin of the pending window. Older code stored none. */
  timestamp?: string;
}

interface Data {
  version: 1;
  compute: Record<string, string>; // day -> usd6
  paidUsd6: string;
  refusals: Record<string, ReasonName[]>; // day -> reasons logged onchain
  txByDay: Record<string, number>;
  pending: PendingTx[];
}

const empty = (): Data => ({ version: 1, compute: {}, paidUsd6: "0", refusals: {}, txByDay: {}, pending: [] });

/** Agent memory that must survive restarts: compute bill, refusal-log rate limit, daily tx count, unsettled sends. */
export class Store {
  private constructor(
    private readonly file: string,
    private data: Data,
  ) {}

  static async open(dir: string): Promise<Store> {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "state.json");
    let data = empty();
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (raw.version !== 1) throw new Error(`unsupported state version ${raw.version}`);
      data = { ...empty(), ...raw };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return new Store(file, data);
  }

  recordCompute(day: bigint, usd6: bigint): void {
    const k = day.toString();
    this.data.compute[k] = (BigInt(this.data.compute[k] ?? "0") + usd6).toString();
  }

  dailyComputeUsd6(today: bigint, fallbackUsd6: bigint): bigint {
    const days: bigint[] = [];
    for (let d = today - 7n; d < today; d++) {
      const v = this.data.compute[d.toString()];
      if (v !== undefined) days.push(BigInt(v));
    }
    if (days.length === 0) return fallbackUsd6;
    return days.reduce((a, b) => a + b, 0n) / BigInt(days.length);
  }

  unpaidUsd6(): bigint {
    const total = Object.values(this.data.compute).reduce((a, v) => a + BigInt(v), 0n);
    const paid = BigInt(this.data.paidUsd6);
    return total > paid ? total - paid : 0n;
  }

  recordPaid(usd6: bigint): void {
    this.data.paidUsd6 = (BigInt(this.data.paidUsd6) + usd6).toString();
  }

  hasLoggedRefusal(day: bigint, reason: ReasonName): boolean {
    return this.data.refusals[day.toString()]?.includes(reason) ?? false;
  }

  recordRefusalLog(day: bigint, reason: ReasonName): void {
    const k = day.toString();
    this.data.refusals[k] = [...(this.data.refusals[k] ?? []), reason];
  }

  txCount(day: bigint): number {
    return this.data.txByDay[day.toString()] ?? 0;
  }

  recordTx(day: bigint): void {
    const k = day.toString();
    this.data.txByDay[k] = (this.data.txByDay[k] ?? 0) + 1;
  }

  pending(): readonly PendingTx[] {
    return this.data.pending;
  }

  addPending(p: PendingTx): void {
    this.data.pending = [...this.data.pending.filter((x) => x.intentId !== p.intentId), p];
  }

  setPendingHash(intentId: Hex, txHash: Hex): void {
    this.data.pending = this.data.pending.map((x) => (x.intentId === intentId ? { ...x, txHash } : x));
  }

  clearPending(intentId: Hex): void {
    this.data.pending = this.data.pending.filter((x) => x.intentId !== intentId);
  }

  async save(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.file);
  }
}
