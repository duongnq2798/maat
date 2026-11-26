// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NAV_TOKENS } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { DECISION_TOPIC } from "@/lib/gap/decisions";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC, type RawLog } from "@/lib/gap/decode";
import { measureEdition, type EditionDeps, type EditionOptions } from "@/lib/gap/edition";
import { createLogSource } from "@/lib/gap/logs";
import { LOOKBACK_SEC } from "@/lib/gap/measure";
import { createLogReader, GAP_RPC, type LogQuery, type LogReader, type TxRead } from "@/lib/gap/rpc";
import { editionSchema } from "@/lib/gap/schema";
import { OWNER_SELECTOR } from "@/lib/gap/vault";
import { calendarChecks } from "@/lib/gap/windows";
import { word } from "@/lib/live/abi";
import { decisionLog, hash32 } from "./helpers/fake-ledger";
import { txInput, VECTORS } from "./helpers/maat-v1";

const NVDA = NAV_TOKENS.find((t) => t.symbol === "NVDAc")!;
const A1 = `0x${"a1".repeat(20)}`;
const A2 = `0x${"a2".repeat(20)}`;
const A3 = `0x${"a3".repeat(20)}`;
const HEAD = 2_000_000;
const WINDOWS = editionWindows(EDITIONS[0]!);
const W = WINDOWS.find((w) => w.id === "2026-11-13")!;
const NEXT = WINDOWS.find((w) => w.id === "2026-11-20")!;
const P100 = 100n * 100_000_000n;

const isqrt = (n: bigint): bigint => {
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
};
const sqrtFor = (price8: bigint): bigint => isqrt(((1n << 192n) * 10n ** 10n) / price8);

interface Ev {
  kind: "answer" | "swap";
  address: string;
  block: number;
  logIndex: number;
  value: bigint;
}

/**
 * A chain that ends at `headTs`, with 2-second blocks unless it is given Base's 5 blocks a second (whole-second
 * timestamps, so five blocks share each one), and the events it holds. Its finalized block is `finalizedLag` blocks
 * below its head.
 */
class Chain implements LogReader {
  events: Ev[] = [];
  swapReads: { from: number; to: number }[] = [];
  headers: number[] = [];
  phases = [A1, A2];
  finalizedLag = 0;
  constructor(
    readonly headTs: number,
    readonly blocksPerSecond = 0.5,
  ) {}

  ts = (n: number) => this.headTs - Math.floor((HEAD - n) / this.blocksPerSecond);
  at = (ts: number) => HEAD - Math.floor((this.headTs - ts) / 2);

  answer(block: number, whole: number, address = A2, logIndex = 0) {
    this.events.push({ kind: "answer", address, block, logIndex, value: BigInt(whole) * 100_000_000n });
  }
  swap(block: number, price8 = P100, logIndex = 0) {
    this.events.push({ kind: "swap", address: NVDA.pool, block, logIndex, value: sqrtFor(price8) });
  }

  async getLogs(q: LogQuery): Promise<RawLog[]> {
    const wanted = (typeof q.address === "string" ? [q.address] : q.address).map((a) => a.toLowerCase());
    const kind = q.topic0 === SWAP_TOPIC ? "swap" : "answer";
    if (kind === "swap") this.swapReads.push({ from: q.from, to: q.to });
    return this.events
      .filter((e) => e.kind === kind && wanted.includes(e.address.toLowerCase()) && e.block >= q.from && e.block <= q.to)
      .map((e): RawLog => {
        const common = {
          address: e.address,
          blockNumber: `0x${e.block.toString(16)}`,
          logIndex: `0x${e.logIndex.toString(16)}`,
          transactionHash: `0x${e.block.toString(16).padStart(60, "0")}${e.logIndex.toString(16).padStart(4, "0")}`,
          blockTimestamp: `0x${this.ts(e.block).toString(16)}`,
        };
        return kind === "answer"
          ? { ...common, topics: [ANSWER_UPDATED_TOPIC, `0x${word(e.value)}`], data: "0x" }
          : { ...common, topics: [SWAP_TOPIC], data: `0x${word(0n)}${word(0n)}${word(e.value)}${word(0n)}${word(0n)}` };
      });
  }
  async blockTs(n: number) {
    this.headers.push(n);
    return this.ts(n);
  }
  async blockAt(ts: number) {
    if (ts > this.headTs) throw new Error("after the head");
    let lo = 0;
    let hi = HEAD;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.ts(mid) >= ts) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
  async head() {
    return { block: HEAD, ts: this.headTs };
  }
  async finalized() {
    return { block: HEAD - this.finalizedLag, ts: this.ts(HEAD - this.finalizedLag) };
  }
  async transaction(hash: string): Promise<TxRead> {
    throw new Error(`no transaction ${hash}`);
  }
  async call(to: string, data: string) {
    expect(NAV_TOKENS.map((t) => t.feed)).toContain(to);
    if (data === "0x58303b10") return `0x${word(BigInt(this.phases.length))}`;
    const m = /^0xc1597304([0-9a-f]{64})$/.exec(data);
    if (!m) throw new Error(`unexpected call ${data}`);
    return `0x${word(BigInt(this.phases[Number(BigInt(`0x${m[1]}`)) - 1]!))}`;
  }
}

const run = (chain: Chain, opts: { windows?: string[]; tokens?: string[] } = {}) => {
  const lines: string[] = [];
  const done = measureEdition(
    { reader: chain, source: (headBlock) => createLogSource(chain, { cacheDir: null, headBlock }), log: (l) => lines.push(l) },
    { edition: 0, tokens: ["NVDAc"], ...opts },
  );
  return { done, lines };
};
const complete = (f: Awaited<ReturnType<typeof measureEdition>>) => {
  const w = f.windows[0]!;
  if (w.status !== "complete") throw new Error("expected a complete window");
  return w;
};

describe("measureEdition", () => {
  it("marks a window pending when the head is before its open", async () => {
    const chain = new Chain(NEXT.openTs - 3600);
    const { done, lines } = run(chain, { windows: ["2026-11-20"] });
    const f = await done;
    expect(f.windows).toEqual([{ status: "pending", id: NEXT.id, closeTs: NEXT.closeTs, openTs: NEXT.openTs, closeLabel: NEXT.closeLabel, openLabel: NEXT.openLabel }]);
    expect(f.head).toEqual({ block: HEAD, ts: chain.headTs });
    expect(chain.swapReads).toEqual([]);
    expect(lines.join("\n")).toContain("pending");
    expect(editionSchema({ partial: true }).safeParse(f).success).toBe(true);
  });

  it("finds the bounding updates backwards and forwards, across several spans", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    const to = chain.at(W.openTs) - 1;
    chain.answer(from - 120_000, 150); // 240000 s before the close: inside the look-back, three spans back
    chain.answer(from + 10, 160);
    chain.answer(to + 120_000, 165); // beyond the first forward span
    const f = await run(chain, { windows: [W.id] }).done;
    const w = complete(f);
    expect(w.blocks).toEqual({ from, to });
    const row = w.tokens[0]!;
    expect(row.feedLive).toBe(true);
    expect(row.aggregator).toBe(A2);
    expect(row.phase).toBe(2);
    expect(row.freeze?.from.block).toBe(from + 10);
    expect(row.freeze?.from.answer).toBe("160.00000000");
    expect(row.freeze?.to.block).toBe(to + 120_000);
    expect(row.freeze?.to.answer).toBe("165.00000000");
    expect(row.freeze?.returnMoveBps).toBe(312);
    expect(row.series.feed[0]).toEqual([W.closeTs, "150.00000000"]);
    expect(editionSchema({ partial: true }).safeParse(f).success).toBe(true);
  });

  it("reads swaps over the union of the window and the freeze", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    const to = chain.at(W.openTs) - 1;
    chain.answer(from - 5_000, 150, A2); // the freeze starts before the window
    chain.answer(to + 4_000, 155);
    chain.swap(from - 6_000); // before the freeze: not counted anywhere
    chain.swap(from - 100, 151n * 100_000_000n); // frozen, before the window
    chain.swap(from + 100, 152n * 100_000_000n);
    chain.swap(to + 1_000, 153n * 100_000_000n); // frozen, after the window
    const f = await run(chain, { windows: [W.id] }).done;
    const row = complete(f).tokens[0]!;
    expect(row.freeze?.swapsRead).toEqual({ from: from - 5_000, to: to + 4_000 });
    expect(row.freeze?.swapsWhileFrozen).toBe(3);
    expect(row.swapsInWindow).toBe(1);
    expect(row.largestGap?.pool).toBe("153.00000000");
    expect(row.largestGap?.held).toBe("150.00000000");
  });

  it("reads swaps over the window alone when there is no freeze, and records no freeze", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    const to = chain.at(W.openTs) - 1;
    chain.swap(from + 5);
    const f = await run(chain, { windows: [W.id] }).done;
    const row = complete(f).tokens[0]!;
    expect(row.feedLive).toBe(false);
    expect(row.freeze).toBeNull();
    expect(row.largestGap).toBeNull();
    expect(row.swapsInWindow).toBe(1);
    expect(Math.min(...chain.swapReads.map((r) => r.from))).toBeLessThanOrEqual(from);
    expect(Math.max(...chain.swapReads.map((r) => r.to))).toBeGreaterThanOrEqual(to);
    expect(Math.max(...chain.swapReads.map((r) => r.to))).toBeLessThan(to + 50_000); // nothing past the window's last span
    expect(row.series.feed).toEqual([]);
  });

  it("does not look back further than a week", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    chain.answer(from - LOOKBACK_SEC / 2 - 10_000, 150); // older than the look-back
    const f = await run(chain, { windows: [W.id] }).done;
    expect(complete(f).tokens[0]!.feedLive).toBe(false);
  });

  it("throws, naming the token, the window and both addresses, when two aggregators appear inside one token's ranges", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    chain.answer(from + 10, 160, A1);
    chain.answer(from + 20_000, 165);
    await expect(run(chain, { windows: [W.id] }).done).rejects.toThrow(`NVDAc ${W.id}: phase changed inside a measured range (${A1}, ${A2})`);
  });

  it("throws when the bounding update before the window is from another aggregator than the updates after it", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    const to = chain.at(W.openTs) - 1;
    chain.answer(from - 20_000, 150, A1);
    chain.answer(to + 10_000, 155, A2);
    await expect(run(chain, { windows: [W.id] }).done).rejects.toThrow("phase changed inside a measured range");
  });

  it("measures normally and records phase 2 when the proxy moved to phase 3 after the window", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    chain.phases = [A1, A2, A3];
    const from = chain.at(W.closeTs);
    const to = chain.at(W.openTs) - 1;
    chain.answer(from + 10, 160, A2);
    chain.answer(to + 10_000, 165, A2);
    chain.answer(to + 400_000, 170, A3); // the new phase, long after the window's reads end
    const row = complete(await run(chain, { windows: [W.id] }).done).tokens[0]!;
    expect(row.aggregator).toBe(A2);
    expect(row.phase).toBe(2);
    expect(row.feedLive).toBe(true);
    expect(row.freeze?.to.answer).toBe("165.00000000");
  });

  it("records the latest phase's aggregator when the token's ranges hold no update at all", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    chain.phases = [A1, A2, A3];
    const row = complete(await run(chain, { windows: [W.id] }).done).tokens[0]!;
    expect(row.feedLive).toBe(false);
    expect(row.aggregator).toBe(A3);
    expect(row.phase).toBe(3);
  });

  it("records the phase of an earlier aggregator when only its logs are used", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    const to = chain.at(W.openTs) - 1;
    chain.answer(from + 10, 160, A1);
    chain.answer(to + 10_000, 165, A1);
    const row = complete(await run(chain, { windows: [W.id] }).done).tokens[0]!;
    expect(row.aggregator).toBe(A1);
    expect(row.phase).toBe(1);
  });

  it("throws when a live feed has no update after the window", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    chain.answer(from + 10, 160);
    await expect(run(chain, { windows: [W.id] }).done).rejects.toThrow("the feed has not updated since the window; run again later");
  });

  it("measures every token before it throws once, naming each live feed with no update after the window", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    chain.answer(from + 10, 160);
    const { done } = run(chain, { windows: [W.id], tokens: ["NVDAc", "GOOGLc", "AAPLc"] });
    await expect(done).rejects.toThrow(`AAPLc ${W.id}, GOOGLc ${W.id}, NVDAc ${W.id}: the feed has not updated since the window; run again later`);
  });

  it("takes the later update on the near side and the earlier one on the far side when a span holds several", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    const to = chain.at(W.openTs) - 1;
    chain.answer(from - 30_000, 148);
    chain.answer(from - 20_000, 150); // the later one of two in the same span
    chain.answer(to + 10_000, 155); // the earlier one of two in the same span
    chain.answer(to + 20_000, 170);
    const row = complete(await run(chain, { windows: [W.id] }).done).tokens[0]!;
    expect(row.series.feed[0]).toEqual([W.closeTs, "150.00000000"]);
    expect(row.freeze?.from.block).toBe(from - 20_000);
    expect(row.freeze?.to.block).toBe(to + 10_000);
  });

  it("throws when the only later update lies just beyond the week after the open", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    const ahead = await chain.blockAt(W.openTs + LOOKBACK_SEC);
    chain.answer(from + 10, 160);
    chain.answer(ahead + 1, 165);
    await expect(run(chain, { windows: [W.id] }).done).rejects.toThrow("run again later");
  });

  it("reads no header far below the data when the feed is dead", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    chain.answer(from - 400_000, 150); // 800000 s before the close, beyond the 7-day look-back
    const f = await run(chain, { windows: [W.id] }).done;
    const row = complete(f).tokens[0]!;
    expect(row.feedLive).toBe(false);
    expect(row.freeze).toBeNull();
    const lowest = chain.ts(Math.min(...chain.headers));
    expect(lowest).toBeGreaterThanOrEqual(W.closeTs - LOOKBACK_SEC - 50_000 * 2);
  });

  it("rejects an unknown window, token or edition", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    await expect(run(chain, { windows: ["2026-01-01"] }).done).rejects.toThrow("no window");
    await expect(run(chain, { tokens: ["XXXc"] }).done).rejects.toThrow("unknown token");
    await expect(measureEdition({ reader: chain, source: () => createLogSource(chain, { cacheDir: null, headBlock: HEAD }), log: () => {} }, { edition: 99 })).rejects.toThrow("unknown edition");
  });

  it("logs one progress line per token and window", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const { done, lines } = run(chain, { windows: [W.id] });
    await done;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^NVDAc 2026-11-13: \d+ reads, \d+\.\d s$/);
  });
});

const CALENDAR = `0x${"ca".repeat(20)}`;
const VAULT = `0x${"5a".repeat(20)}`;
const OWNER = `0x${"a1".repeat(20)}`;
const AGENT = `0x${"b2".repeat(20)}`;
const THANKSGIVING = editionWindows(EDITIONS[1]!)[0]!;
const WEEKEND = editionWindows(EDITIONS[1]!)[1]!;

/** The chain with MarketCalendar (answering as the repo calendar does, unless told otherwise) and the vault's Decisions. */
class Week extends Chain {
  decisions: RawLog[] = [];
  txs = new Map<string, TxRead>();
  calendarAsked: number[] = [];
  calendarSays = new Map<number, boolean>();
  logQueries: LogQuery[] = [];

  decision(n: number, block: number, sender: string, blob: string, reason: string) {
    const l = decisionLog(n, BigInt(block), { reason });
    this.decisions.push({
      address: VAULT,
      topics: l.topics,
      data: l.data,
      blockNumber: `0x${block.toString(16)}`,
      logIndex: "0x0",
      transactionHash: l.transactionHash,
      blockTimestamp: `0x${this.ts(block).toString(16)}`,
    });
    this.txs.set(l.transactionHash.toLowerCase(), { from: sender, to: VAULT, input: txInput(blob) });
  }
  first(ts: number) {
    let lo = 0;
    let hi = HEAD;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.ts(mid) >= ts) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
  override async getLogs(q: LogQuery): Promise<RawLog[]> {
    this.logQueries.push(q);
    if (q.topic0 !== DECISION_TOPIC) return super.getLogs(q);
    expect(q.address).toBe(VAULT);
    return this.decisions.filter((l) => Number(l.blockNumber) >= q.from && Number(l.blockNumber) <= q.to);
  }
  override async transaction(hash: string): Promise<TxRead> {
    const t = this.txs.get(hash.toLowerCase());
    if (!t) throw new Error(`no transaction ${hash}`);
    return t;
  }
  override async call(to: string, data: string) {
    if (to === VAULT && data === OWNER_SELECTOR) return `0x${word(BigInt(OWNER))}`;
    if (to === CALENDAR) {
      const m = /^0x3fef6f98([0-9a-f]{64})([0-9a-f]{64})$/.exec(data);
      if (!m || BigInt(`0x${m[2]}`) !== 0n) throw new Error(`unexpected calendar call ${data}`);
      const ts = Number(BigInt(`0x${m[1]}`));
      this.calendarAsked.push(ts);
      return `0x${word((this.calendarSays.get(ts) ?? regularSession(ts).open) ? 1n : 0n)}`;
    }
    return super.call(to, data);
  }
}

const measure = (chain: Chain, opts: Partial<EditionOptions> & { edition: number }, deps: Partial<EditionDeps> = {}) => {
  const lines: string[] = [];
  const done = measureEdition(
    {
      reader: chain,
      source: (headBlock) => createLogSource(chain, { cacheDir: null, headBlock }),
      log: (l) => lines.push(l),
      calendar: CALENDAR,
      vault: VAULT,
      ...deps,
    },
    { tokens: ["NVDAc"], ...opts },
  );
  return { done, lines };
};
const only = (f: Awaited<ReturnType<typeof measureEdition>>, id: string) => {
  const w = f.windows.find((x) => x.id === id)!;
  if (w.status !== "complete") throw new Error(`expected ${id} complete`);
  return w;
};

describe("measureEdition on windows that start on a weekday", () => {
  it("bounds the Wednesday holiday window by timestamp on 5 blocks a second: the first block at or after the close, the last before the open", async () => {
    const chain = new Week(THANKSGIVING.openTs + 3600, 5);
    chain.finalizedLag = 25; // five seconds of blocks: the file reads through the finalized block, past the open
    const from = chain.first(THANKSGIVING.closeTs);
    const to = chain.first(THANKSGIVING.openTs) - 1;
    // Five blocks share each second: the bounds are the first of the close's five and the last before the open's five.
    expect([chain.ts(from - 1), chain.ts(from), chain.ts(from + 4), chain.ts(from + 5)]).toEqual([
      THANKSGIVING.closeTs - 1,
      THANKSGIVING.closeTs,
      THANKSGIVING.closeTs,
      THANKSGIVING.closeTs + 1,
    ]);
    expect([chain.ts(to), chain.ts(to + 1)]).toEqual([THANKSGIVING.openTs - 1, THANKSGIVING.openTs]);
    chain.swap(from + 1_000);
    const f = await measure(chain, { edition: 1, windows: [THANKSGIVING.id] }).done;
    const w = only(f, "2026-11-25");
    expect(w).toMatchObject({ closeLabel: "Wed 25 Nov 16:00 ET", openLabel: "Fri 27 Nov 09:30 ET", blocks: { from, to } });
    expect(w.tokens[0]!.swapsInWindow).toBe(1);
    expect(f.head).toEqual({ block: HEAD - 25, ts: chain.headTs - 5 });
    // Pinned to MarketCalendar: open the second before the Wednesday close, closed through Thanksgiving, open at the Friday open.
    expect(chain.calendarAsked).toEqual(calendarChecks(THANKSGIVING).map((c) => c.ts));
    expect(editionSchema({ partial: true }).safeParse(f).error?.issues ?? []).toEqual([]);
  });

  it("measures the weekend after the 13:00 ET early close from the early close, 68.5 hours", async () => {
    const chain = new Week(WEEKEND.openTs + 3600, 5);
    const from = chain.first(WEEKEND.closeTs);
    chain.swap(from); // the first block of the window: a swap at the early close itself
    chain.swap(from - 1); // the second before, still in session: outside the window
    const w = only(await measure(chain, { edition: 1, windows: [WEEKEND.id] }).done, "2026-11-27");
    expect(w.closeLabel).toBe("Fri 27 Nov 13:00 ET");
    expect((w.openTs - w.closeTs) / 3600).toBe(68.5);
    expect(w.blocks).toEqual({ from, to: chain.first(WEEKEND.openTs) - 1 });
    expect(w.tokens[0]!.swapsInWindow).toBe(1);
    // The calendar is asked at the early close itself: open at 12:59:59 ET, closed at 13:00:00 ET.
    expect(chain.calendarAsked.slice(0, 2)).toEqual([WEEKEND.closeTs - 1, WEEKEND.closeTs]);
    expect(chain.calendarAsked).toEqual(calendarChecks(WEEKEND).map((c) => c.ts));
  });

  it("measures a window across a month end and a year end, Thursday 31 December to Monday 4 January", async () => {
    const def = { edition: 7, title: "Year end", from: "2026-12-31", to: "2026-12-31" };
    const [yearEnd] = editionWindows(def);
    const chain = new Week(yearEnd!.openTs + 3600, 5);
    chain.swap(chain.first(yearEnd!.closeTs) + 10);
    const f = await measure(chain, { edition: 7 }, { editions: [def] }).done;
    const w = only(f, "2026-12-31");
    expect([w.closeLabel, w.openLabel]).toEqual(["Thu 31 Dec 16:00 ET", "Mon 4 Jan 09:30 ET"]);
    expect(w.blocks).toEqual({ from: chain.first(yearEnd!.closeTs), to: chain.first(yearEnd!.openTs) - 1 });
    expect(w.tokens[0]!.swapsInWindow).toBe(1);
    expect(chain.calendarAsked).toHaveLength(7); // the two instants at each edge, and 09:30 ET of 1, 2 and 3 January
    expect(w.decisions).toBeUndefined(); // an edition that does not count Decisions
  });

  it("counts the vault's Decisions in the window's blocks by sender, and those refused with MARKET_CLOSED", async () => {
    const chain = new Week(WEEKEND.openTs + 3600, 5);
    const from = chain.first(WEEKEND.closeTs);
    const to = chain.first(WEEKEND.openTs) - 1;
    chain.decision(1, from - 5, AGENT, VECTORS.V4.blob, "OK"); // a probe at 17:58 UTC, before the close: not counted
    chain.decision(2, from, AGENT, VECTORS.V4.blob, "MARKET_CLOSED");
    chain.decision(3, from + 50_000, AGENT, VECTORS.V1.blob, "MARKET_CLOSED");
    chain.decision(4, to, AGENT, VECTORS.V1.blob, "MARKET_CLOSED");
    chain.decision(5, to + 1, OWNER, VECTORS.V1.blob, "OK"); // at the open: not counted
    const { done, lines } = measure(chain, { edition: 1, windows: [WEEKEND.id] });
    const f = await done;
    const w = only(f, "2026-11-27");
    expect(w.decisions).toEqual({
      vault: VAULT,
      topic: DECISION_TOPIC,
      count: 3,
      marketClosed: 3,
      bySender: {
        agent: { count: 2, marketClosed: 2 },
        probe: { count: 1, marketClosed: 1 },
        brief: { count: 0, marketClosed: 0 },
        owner: { count: 0, marketClosed: 0 },
        unlabelled: { count: 0, marketClosed: 0 },
      },
      list: [
        { block: from, logIndex: 0, ts: WEEKEND.closeTs, tx: hash32(2), sender: "probe", allowed: false, reason: "MARKET_CLOSED" },
        { block: from + 50_000, logIndex: 0, ts: chain.ts(from + 50_000), tx: hash32(3), sender: "agent", allowed: false, reason: "MARKET_CLOSED" },
        { block: to, logIndex: 0, ts: WEEKEND.openTs - 1, tx: hash32(4), sender: "agent", allowed: false, reason: "MARKET_CLOSED" },
      ],
    });
    expect(chain.logQueries.filter((q) => q.topic0 === DECISION_TOPIC)).toEqual([{ address: VAULT, topic0: DECISION_TOPIC, from, to }]);
    expect(lines).toContain("window 2026-11-27: 3 Decisions, 3 refused with MARKET_CLOSED");
    expect(editionSchema({ partial: true }).safeParse(f).error?.issues ?? []).toEqual([]);
  });

  it("refuses an edition that counts Decisions when it is given no vault", async () => {
    const chain = new Week(WEEKEND.openTs + 3600, 5);
    await expect(measure(chain, { edition: 1 }, { vault: undefined }).done).rejects.toThrow(
      "edition 1 counts the vault's Decisions: it needs the MandateVault address",
    );
  });

  it("asks MarketCalendar at every edge of every window before it measures one, and refuses a window the calendar disagrees with", async () => {
    const chain = new Week(WEEKEND.openTs + 3600, 5);
    const { done, lines } = measure(chain, { edition: 1 });
    await done;
    expect(chain.calendarAsked).toEqual([...calendarChecks(THANKSGIVING), ...calendarChecks(WEEKEND)].map((c) => c.ts));
    expect(lines).toContain(`window 2026-11-25: MarketCalendar ${CALENDAR} agrees at 5 instants`);
    expect(lines).toContain(`window 2026-11-27: MarketCalendar ${CALENDAR} agrees at 6 instants`);

    const wrong = new Week(WEEKEND.openTs + 3600, 5);
    wrong.calendarSays.set(WEEKEND.closeTs - 1, false); // a calendar that closed a second early
    await expect(measure(wrong, { edition: 1 }).done).rejects.toThrow(
      `window 2026-11-27: MarketCalendar ${CALENDAR} answers isOpen(${WEEKEND.closeTs - 1}) = false where the window needs true`,
    );
    expect(wrong.logQueries).toEqual([]);
  });
});

describe("a window that has not ended by the finalized block", () => {
  it("is pending, and the head the file records is the finalized block, not the latest", async () => {
    const chain = new Week(WEEKEND.openTs + 600, 5);
    chain.finalizedLag = 6_000; // 20 minutes of blocks: the finalized block is before Monday's open
    const { done, lines } = measure(chain, { edition: 1 });
    const f = await done;
    expect(f.head).toEqual({ block: HEAD - 6_000, ts: WEEKEND.openTs - 600 });
    expect(f.windows.map((w) => [w.id, w.status])).toEqual([
      ["2026-11-25", "complete"],
      ["2026-11-27", "pending"],
    ]);
    expect(lines.some((l) => l.startsWith("window 2026-11-27: pending"))).toBe(true);
  });

  it("is pending when its open is still in the future, and none of its logs is read", async () => {
    const chain = new Week(WEEKEND.closeTs + 3600, 5);
    const f = await measure(chain, { edition: 1, windows: [WEEKEND.id] }).done;
    expect(f.windows[0]!.status).toBe("pending");
    expect(chain.logQueries).toEqual([]);
  });

  it("with complete, refuses the whole run before it reads a log, naming the window and the finalized block", async () => {
    const chain = new Week(WEEKEND.openTs + 600, 5);
    chain.finalizedLag = 6_000;
    await expect(measure(chain, { edition: 1, complete: true }).done).rejects.toThrow(
      `window 2026-11-27 ends Mon 30 Nov 09:30 ET, after block ${HEAD - 6_000}, the latest finalized one (2026-11-30T14:20:00Z): it is not measured yet, so nothing is written; run again once Base has finalized a block at or after its open`,
    );
    expect(chain.logQueries).toEqual([]);
  });

  it("with complete, measures every window once the finalized block is past the last open", async () => {
    const chain = new Week(WEEKEND.openTs + 3600, 5);
    chain.finalizedLag = 6_000;
    const f = await measure(chain, { edition: 1, complete: true }).done;
    expect(f.windows.map((w) => w.status)).toEqual(["complete", "complete"]);
    expect(f.head.block).toBe(HEAD - 6_000);
  });
});

describe("a pinned head", () => {
  it("reads through the block it is given, as a rerun of a committed file does, when that block is finalized", async () => {
    const chain = new Week(WEEKEND.openTs + 3600, 5);
    const pinned = HEAD - 9_000;
    const f = await measure(chain, { edition: 1, head: pinned }).done;
    expect(f.head).toEqual({ block: pinned, ts: chain.ts(pinned) });
  });

  it("refuses a block that is not finalized yet", async () => {
    const chain = new Week(WEEKEND.openTs + 3600, 5);
    chain.finalizedLag = 100;
    await expect(measure(chain, { edition: 1, head: HEAD - 50 }).done).rejects.toThrow(
      `block ${HEAD - 50} is not finalized yet: the latest finalized block is ${HEAD - 100}`,
    );
  });
});

describe("the head of a run that reads Base through createLogReader", () => {
  const BASE_RPC = "https://mainnet.base.org";
  /** Block 0 is at 00:00 UTC on Tue 24 Nov, 5 blocks a second: every block below is before both of edition 1's windows end. */
  const T = Date.parse("2026-11-24T00:00:00Z") / 1000;
  const iso = (n: number) => new Date((T + Math.floor(n / 5)) * 1000).toISOString().replace(".000Z", "Z");
  const def = { edition: 9, title: "Thanksgiving week again", from: "2026-11-23", to: "2026-11-29" };
  /** publicnode's three finalized answers go back and forth; mainnet.base.org's first one is the newest. */
  const reader = () => {
    const answers: Record<string, number[]> = { [GAP_RPC]: [1_000, 900, 950], [BASE_RPC]: [1_200, 1_100, 1_000] };
    const seen: Record<string, number> = {};
    const f = (async (url: string, init: { body: string }) => {
      const req = JSON.parse(init.body) as { id: number; method: string; params: unknown[] };
      let result: unknown = null;
      if (req.method === "eth_getBlockByNumber" && req.params[0] === "finalized") {
        const n = answers[url]![(seen[url] = (seen[url] ?? 0) + 1) - 1]!;
        result = { number: `0x${n.toString(16)}`, timestamp: `0x${(T + Math.floor(n / 5)).toString(16)}` };
      } else if (req.method === "eth_getBlockByNumber" && url === GAP_RPC) {
        result = { timestamp: `0x${(T + Math.floor(Number(req.params[0]) / 5)).toString(16)}` };
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }));
    }) as unknown as typeof fetch;
    return createLogReader({ fetch: f, sleep: async () => {} });
  };
  const head = (opts: Partial<EditionOptions> = {}) => {
    const r = reader();
    const lines: string[] = [];
    const done = measureEdition(
      { reader: r, source: (headBlock) => createLogSource(r, { cacheDir: null, headBlock }), log: (l) => lines.push(l), editions: [def] },
      { edition: 9, ...opts },
    );
    return { done, lines };
  };

  it("reads through the newest of the six finalized answers, and says which RPC gave it and how many answered", async () => {
    const { done, lines } = head();
    const f = await done;
    expect(f.head).toEqual({ block: 1_200, ts: T + 240 });
    expect(f.windows.map((w) => w.status)).toEqual(["pending", "pending"]);
    expect(lines[0]).toBe(`head: finalized block 1200 (${iso(1_200)}) from ${BASE_RPC}, newest of 6 answers to 6 reads`);
  });

  it("takes a pinned --head at or below the newest answer, even when the first answer is older than it", async () => {
    const { done, lines } = head({ head: 1_150 });
    expect((await done).head).toEqual({ block: 1_150, ts: T + 230 });
    expect(lines[0]).toBe(`head: block 1150 (${iso(1_150)}), pinned with --head; finalized block 1200 (${iso(1_200)}) from ${BASE_RPC}, newest of 6 answers to 6 reads`);
  });

  it("refuses a pinned --head above the newest answer, naming that answer", async () => {
    await expect(head({ head: 1_201 }).done).rejects.toThrow("block 1201 is not finalized yet: the latest finalized block is 1200");
  });
});

describe("--complete with a wait", () => {
  const OPEN = "Mon 30 Nov 09:30 ET (2026-11-30T14:30:00Z)";
  const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
  /** The Week chain, with every finalized read and every log read in one list, in the order the run made them. */
  class Waiting extends Week {
    order: string[] = [];
    override async finalized() {
      const f = await super.finalized();
      this.order.push(`finalized ${f.block}`);
      return f;
    }
    override async getLogs(q: LogQuery): Promise<RawLog[]> {
      this.order.push("logs");
      return super.getLogs(q);
    }
  }
  /** A clock that only the run's sleeps move: each sleep also moves the chain's finalized block `step` blocks up. */
  const clocked = (chain: Waiting, step: number, readMs = 0) => {
    const c = { ms: 0, sleeps: [] as number[] };
    const read = chain.finalized.bind(chain);
    chain.finalized = async () => {
      c.ms += readMs;
      return read();
    };
    return {
      c,
      deps: {
        now: () => c.ms,
        sleep: async (ms: number) => {
          c.sleeps.push(ms);
          c.ms += ms;
          chain.finalizedLag -= step;
        },
      },
    };
  };

  it("rereads the finalized block every 30 s, one line each, and measures once it is past the last open, reading no log before", async () => {
    // The latest block is an hour after Monday's open; the finalized one starts 400 s before the open.
    const chain = new Waiting(WEEKEND.openTs + 3600, 5);
    chain.finalizedLag = 20_000;
    const { c, deps } = clocked(chain, 1_500);
    const { done, lines } = measure(chain, { edition: 1, complete: true, waitMinutes: 20 }, deps);
    const f = await done;
    expect(c.sleeps).toEqual([30_000, 30_000]);
    expect(lines.filter((l) => l.startsWith("--wait"))).toEqual([
      `--wait 20: finalized block ${HEAD - 20_000} (${iso(WEEKEND.openTs - 400)}); 400 s before the last open, ${OPEN}; reading it again every 30 s, 40 times at most`,
      `--wait 20, reread 1 of 40: finalized block ${HEAD - 18_500} (${iso(WEEKEND.openTs - 100)}); 100 s before the last open, ${OPEN}`,
      `--wait 20, reread 2 of 40: finalized block ${HEAD - 17_000} (${iso(WEEKEND.openTs + 200)}); 200 s after the last open, ${OPEN}: measuring`,
    ]);
    expect(chain.order.slice(0, 3)).toEqual([`finalized ${HEAD - 20_000}`, `finalized ${HEAD - 18_500}`, `finalized ${HEAD - 17_000}`]);
    expect(chain.order.slice(3).every((o) => o === "logs")).toBe(true);
    expect(chain.order.length).toBeGreaterThan(3);
    expect(f.head).toEqual({ block: HEAD - 17_000, ts: WEEKEND.openTs + 200 });
    expect(f.windows.map((w) => w.status)).toEqual(["complete", "complete"]);
  });

  it("refuses with the message a run without a wait gives once the minutes pass, having read no log, rereading on a 30 s beat from the start", async () => {
    const chain = new Waiting(WEEKEND.openTs + 3600, 5);
    chain.finalizedLag = 20_000;
    const { c, deps } = clocked(chain, 0, 1_500); // each read takes 1.5 s: the beat stays on 30 s from the start
    const { done, lines } = measure(chain, { edition: 1, complete: true, waitMinutes: 1 }, deps);
    await expect(done).rejects.toThrow(
      `window 2026-11-27 ends Mon 30 Nov 09:30 ET, after block ${HEAD - 20_000}, the latest finalized one (${iso(WEEKEND.openTs - 400)}): it is not measured yet, so nothing is written; run again once Base has finalized a block at or after its open`,
    );
    expect(c.sleeps).toEqual([30_000, 28_500]);
    expect(lines.filter((l) => l.startsWith("--wait"))).toEqual([
      `--wait 1: finalized block ${HEAD - 20_000} (${iso(WEEKEND.openTs - 400)}); 400 s before the last open, ${OPEN}; reading it again every 30 s, 2 times at most`,
      `--wait 1, reread 1 of 2: finalized block ${HEAD - 20_000} (${iso(WEEKEND.openTs - 400)}); 400 s before the last open, ${OPEN}`,
      `--wait 1, reread 2 of 2: finalized block ${HEAD - 20_000} (${iso(WEEKEND.openTs - 400)}); 400 s before the last open, ${OPEN}`,
    ]);
    expect(chain.order).toEqual(Array.from({ length: 3 }, () => `finalized ${HEAD - 20_000}`));
    expect(chain.logQueries).toEqual([]);
  });

  it("does not wait when the finalized block is already past the last open", async () => {
    const chain = new Waiting(WEEKEND.openTs + 3600, 5);
    chain.finalizedLag = 6_000;
    const { c, deps } = clocked(chain, 1_500);
    const { done, lines } = measure(chain, { edition: 1, complete: true, waitMinutes: 20 }, deps);
    expect((await done).windows.map((w) => w.status)).toEqual(["complete", "complete"]);
    expect(c.sleeps).toEqual([]);
    expect(lines.filter((l) => l.startsWith("--wait"))).toEqual([]);
  });
});
