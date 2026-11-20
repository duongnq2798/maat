// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NAV_TOKENS } from "@/content/b20-nav";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC, type RawLog } from "@/lib/gap/decode";
import { measureEdition } from "@/lib/gap/edition";
import { createLogSource } from "@/lib/gap/logs";
import { LOOKBACK_SEC } from "@/lib/gap/measure";
import type { LogQuery, LogReader } from "@/lib/gap/rpc";
import { editionSchema } from "@/lib/gap/schema";
import { word } from "@/lib/live/abi";

const NVDA = NAV_TOKENS.find((t) => t.symbol === "NVDAc")!;
const A1 = `0x${"a1".repeat(20)}`;
const A2 = `0x${"a2".repeat(20)}`;
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

/** A chain with 2-second blocks that ends at `headTs`, and the events it holds. */
class Chain implements LogReader {
  events: Ev[] = [];
  swapReads: { from: number; to: number }[] = [];
  headers: number[] = [];
  phases = [A1, A2];
  constructor(readonly headTs: number) {}

  ts = (n: number) => this.headTs - (HEAD - n) * 2;
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
  async call(to: string, data: string) {
    expect(to).toBe(NVDA.feed);
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

  it("throws when a phase-1 log lands inside the range", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    chain.answer(from + 10, 160, A1);
    chain.answer(from + 500_000, 165);
    await expect(run(chain, { windows: [W.id] }).done).rejects.toThrow("phase changed inside a measured range");
  });

  it("throws when a live feed has no update after the window", async () => {
    const chain = new Chain(W.openTs + 10 * 86_400);
    const from = chain.at(W.closeTs);
    chain.answer(from + 10, 160);
    await expect(run(chain, { windows: [W.id] }).done).rejects.toThrow("the feed has not updated since the window; run again later");
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
