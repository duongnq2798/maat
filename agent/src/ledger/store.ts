import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Hex } from "viem";
import type { BriefDayCount } from "../briefs/caps.js";
import { briefKey, type Brief } from "../briefs/inbox.js";
import type { RefusalKey } from "../refusals.js";

/** An execute() the agent is about to send or has sent but not yet settled. Bigints are decimal strings. */
export interface PendingTx {
  intentId: Hex;
  txHash?: Hex;
  action: string;
  amount: string;
  gateKind: "execute" | "log-refusal";
  /** The preview verdict at send time; a log-refusal stored without `refusal` records this reason as logged. */
  preview: string;
  day: string;
  /** The key a log-refusal records on settle. Older code stored none: such an entry records `day` and `preview`. */
  refusal?: RefusalKey;
  /** The state block the round read before sending: the getLogs lower bound, and the age origin without `timestamp`. */
  block: string;
  /** That block's timestamp (unix seconds): the age origin of the pending window. Older code stored none. */
  timestamp?: string;
}

interface Data {
  version: 1;
  compute: Record<string, string>; // day -> usd6
  paidUsd6: string;
  refusals: Record<string, string[]>; // RefusalKey day (NYSE date, or UTC day number) -> reasons logged onchain
  txByDay: Record<string, number>;
  pending: PendingTx[];
  probes: Record<string, string>; // MAAT_PROBES instant -> outcome, "started" while it runs
  briefs: BriefData; // MaatInbox briefs: where the next read starts, each brief decided, and the counts per UTC day
}

/** A brief the agent decided, under its identity (briefs/inbox.ts briefKey). Bigints are decimal strings. */
export interface BriefRecord {
  id: number;
  from: string;
  txHash: string;
  logIndex: number;
  block: string;
  /** "skipped", "replied" or "unanswered"; "started" from the save before the Claude call until its answer is journaled. */
  outcome: string;
}

interface BriefData {
  /** The block the next read of Brief logs starts at; absent until the first read, which starts at the deploy block. */
  from?: string;
  done: Record<string, BriefRecord>;
  /** UTC day -> briefs sent to Claude, by sender (lowercase), brief-driven txs, and the Claude spend of brief rounds. */
  days: Record<string, { sent: number; senders: Record<string, number>; txs: number; llmUsd6: string }>;
}

const empty = (): Data => ({ version: 1, compute: {}, paidUsd6: "0", refusals: {}, txByDay: {}, pending: [], probes: {}, briefs: { done: {}, days: {} } });

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

  /** What the agent spent on Claude on UTC day `day`, failed calls included. */
  computeOn(day: bigint): bigint {
    return BigInt(this.data.compute[day.toString()] ?? "0");
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

  hasLoggedRefusal(k: RefusalKey): boolean {
    return this.data.refusals[k.day]?.includes(k.reason) ?? false;
  }

  recordRefusalLog(k: RefusalKey): void {
    this.data.refusals[k.day] = [...(this.data.refusals[k.day] ?? []), k.reason];
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

  /** What became of the probe at `at` (its ISO instant), or "started" if the agent stopped while it ran. */
  probeOutcome(at: string): string | undefined {
    return this.data.probes[at];
  }

  recordProbe(at: string, outcome: string): void {
    this.data.probes[at] = outcome;
  }

  /** The probes that ran on UTC day `day` (YYYY-MM-DD): every record but a missed or capped one, which never ran. */
  probesRunOn(day: string): number {
    return Object.entries(this.data.probes).filter(([at, o]) => at.startsWith(`${day}T`) && o !== "missed" && o !== "capped").length;
  }

  /** The block the next read of Brief logs starts at; undefined before the first read. */
  briefFrom(): bigint | undefined {
    return this.data.briefs.from === undefined ? undefined : BigInt(this.data.briefs.from);
  }

  /**
   * Moves the next read's start to `block` and forgets every decided brief below it, which no read reaches again. A
   * brief still "started" is kept: the next round journals it as unanswered first.
   */
  setBriefFrom(block: bigint): void {
    this.data.briefs.from = block.toString();
    for (const [key, r] of Object.entries(this.data.briefs.done)) if (BigInt(r.block) < block && r.outcome !== "started") delete this.data.briefs.done[key];
  }

  /** What the agent decided for the brief under `key`, or undefined when it has not. */
  briefOutcome(key: string): string | undefined {
    return this.data.briefs.done[key]?.outcome;
  }

  recordBrief(b: Omit<Brief, "text">, outcome: string): void {
    this.data.briefs.done[briefKey(b)] = { id: b.id, from: b.from, txHash: b.txHash, logIndex: b.logIndex, block: b.block.toString(), outcome };
  }

  /**
   * Forgets a brief whose log no longer exists, so a brief that later takes its id is answered as a new one. The
   * refusals logged under its id (refusals.ts briefRefusalKey) go too, so that brief's own refusal is logged onchain.
   */
  forgetBrief(key: string): void {
    const r = this.data.briefs.done[key];
    delete this.data.briefs.done[key];
    if (r === undefined) return;
    for (const day of Object.keys(this.data.refusals)) {
      if (day.startsWith("brief:") && day.slice("brief:".length).split(",").includes(String(r.id))) delete this.data.refusals[day];
    }
  }

  /** Every decided brief the store still holds, with its key. */
  briefsDone(): readonly (BriefRecord & { key: string })[] {
    return Object.entries(this.data.briefs.done).map(([key, r]) => ({ key, ...r }));
  }

  /** UTC day `day` of briefs: sent to Claude, per sender, brief-driven txs and the Claude spend of brief rounds. */
  briefDay(day: bigint): BriefDayCount {
    const d = this.data.briefs.days[day.toString()];
    return { sent: d?.sent ?? 0, senders: { ...(d?.senders ?? {}) }, txs: d?.txs ?? 0, llmUsd6: BigInt(d?.llmUsd6 ?? "0") };
  }

  private briefDayRecord(day: bigint) {
    const k = day.toString();
    return (this.data.briefs.days[k] ??= { sent: 0, senders: {}, txs: 0, llmUsd6: "0" });
  }

  recordBriefSent(day: bigint, from: string): void {
    const d = this.briefDayRecord(day);
    const f = from.toLowerCase();
    d.sent++;
    d.senders[f] = (d.senders[f] ?? 0) + 1;
  }

  recordBriefTx(day: bigint): void {
    this.briefDayRecord(day).txs++;
  }

  recordBriefLlm(day: bigint, usd6: bigint): void {
    const d = this.briefDayRecord(day);
    d.llmUsd6 = (BigInt(d.llmUsd6) + usd6).toString();
  }

  async save(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.file);
  }
}
