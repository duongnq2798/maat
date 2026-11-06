import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReasonName } from "../types.js";

interface Data {
  version: 1;
  compute: Record<string, string>; // day -> usd6
  paidUsd6: string;
  refusals: Record<string, ReasonName[]>; // day -> reasons logged onchain
  txByDay: Record<string, number>;
}

const empty = (): Data => ({ version: 1, compute: {}, paidUsd6: "0", refusals: {}, txByDay: {} });

/** Agent memory that must survive restarts: compute bill, refusal-log rate limit, daily tx count. */
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

  async save(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.file);
  }
}
