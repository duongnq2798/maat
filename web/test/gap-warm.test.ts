// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NAV_TOKENS, type NavToken } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { runGapIndex, UsageError, type GapCliDeps } from "@/lib/gap/cli";
import { DECISION_TOPIC } from "@/lib/gap/decisions";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC, type RawLog } from "@/lib/gap/decode";
import { measureEdition, warmEdition } from "@/lib/gap/edition";
import { createLogSource, SETTLED } from "@/lib/gap/logs";
import { SPAN, type LogQuery, type LogReader, type TxRead } from "@/lib/gap/rpc";
import { OWNER_SELECTOR } from "@/lib/gap/vault";
import { word } from "@/lib/live/abi";

const CALENDAR = `0x${"ca".repeat(20)}`;
const VAULT = `0x${"5a".repeat(20)}`;
const OWNER = `0x${"a1".repeat(20)}`;
const NVDA = NAV_TOKENS.find((t) => t.symbol === "NVDAc")!;
const AAPL = NAV_TOKENS.find((t) => t.symbol === "AAPLc")!;
const TOKENS = ["AAPLc", "NVDAc"];
/** Each feed's one phase aggregator: its address with the last two bytes replaced, lowercase. */
const aggregatorOf = (nav: NavToken) => `0x${nav.feed.slice(2, 38).toLowerCase()}fa4e`;

const utc = (iso: string) => Date.parse(iso) / 1000;
/** Base since November: 5 blocks a second with whole-second timestamps. Block 0 is more than a week before edition 0. */
const T0 = utc("2026-10-28T00:00:00Z");
const tsOf = (n: number) => T0 + Math.floor(n / 5);
/** The first block of second `t`. */
const at = (t: number) => (t - T0) * 5;
const LATEST = at(utc("2026-12-02T00:00:00Z"));
const P100 = 100n * 100_000_000n;
const SQRT100 = (() => {
  // sqrtPriceX96 of a pool whose token0 is USDC (6 decimals) and token1 the stock (8), at 100 USDC a share
  const n = ((1n << 192n) * 10n ** 10n) / P100;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
})();

interface Ev {
  kind: "answer" | "swap";
  address: string;
  block: number;
}

/** A fake Base: a fixed latest block, a finalized block a test moves, the token feeds, MarketCalendar and the vault. */
class Base implements LogReader {
  events: Ev[] = [];
  queries: LogQuery[] = [];
  reads = 0;
  finalizedBlock = LATEST;

  answer(nav: NavToken, block: number) {
    this.events.push({ kind: "answer", address: aggregatorOf(nav), block });
  }
  swap(nav: NavToken, block: number) {
    this.events.push({ kind: "swap", address: nav.pool.toLowerCase(), block });
  }
  /** The span reads of the feeds and pools, in order: a log source asks for one aligned span per call. */
  spanReads() {
    return this.queries.filter((q) => q.topic0 !== DECISION_TOPIC).map((q) => ({ topic0: q.topic0, address: q.address, from: q.from, to: q.to }));
  }

  async getLogs(q: LogQuery): Promise<RawLog[]> {
    this.reads++;
    this.queries.push(q);
    if (q.topic0 === DECISION_TOPIC) return [];
    const kind = q.topic0 === SWAP_TOPIC ? "swap" : "answer";
    const wanted = (typeof q.address === "string" ? [q.address] : q.address).map((a) => a.toLowerCase());
    return this.events
      .filter((e) => e.kind === kind && wanted.includes(e.address) && e.block >= q.from && e.block <= q.to)
      .map((e): RawLog => {
        const common = {
          address: e.address,
          blockNumber: `0x${e.block.toString(16)}`,
          logIndex: "0x0",
          transactionHash: `0x${e.block.toString(16).padStart(64, "0")}`,
          blockTimestamp: `0x${tsOf(e.block).toString(16)}`,
        };
        return kind === "answer"
          ? { ...common, topics: [ANSWER_UPDATED_TOPIC, `0x${word(P100)}`], data: "0x" }
          : { ...common, topics: [SWAP_TOPIC], data: `0x${word(0n)}${word(0n)}${word(SQRT100)}${word(0n)}${word(0n)}` };
      });
  }
  async blockTs(n: number) {
    this.reads++;
    return tsOf(n);
  }
  async blockAt(t: number) {
    this.reads++;
    if (t > tsOf(LATEST)) throw new Error("after the head");
    return at(t);
  }
  async head() {
    this.reads++;
    return { block: LATEST, ts: tsOf(LATEST) };
  }
  async finalized() {
    this.reads++;
    return { block: this.finalizedBlock, ts: tsOf(this.finalizedBlock) };
  }
  async transaction(hash: string): Promise<TxRead> {
    throw new Error(`no transaction ${hash}`);
  }
  async call(to: string, data: string) {
    this.reads++;
    if (to === VAULT && data === OWNER_SELECTOR) return `0x${word(BigInt(OWNER))}`;
    if (to === CALENDAR) {
      const m = /^0x3fef6f98([0-9a-f]{64})([0-9a-f]{64})$/.exec(data);
      if (!m) throw new Error(`unexpected calendar call ${data}`);
      return `0x${word(regularSession(Number(BigInt(`0x${m[1]}`))).open ? 1n : 0n)}`;
    }
    const nav = NAV_TOKENS.find((t) => t.feed === to);
    if (!nav) throw new Error(`unexpected call to ${to}`);
    if (data === "0x58303b10") return `0x${word(1n)}`;
    if (data === `0xc1597304${word(1n)}`) return `0x${word(BigInt(aggregatorOf(nav)))}`;
    throw new Error(`unexpected call ${data}`);
  }
}

const [TG, WK] = editionWindows(EDITIONS[1]!);
/** Sunday noon: Thanksgiving's window has ended, the weekend's is under way. */
const SUNDAY = at(utc("2026-11-29T12:00:00Z"));
/** Monday 16:00 UTC: both windows have ended, and every feed has updated after the open. */
const MONDAY = at(utc("2026-11-30T16:00:00Z"));

/** Edition 1's two windows, for NVDAc (frozen from before each close to after each open) and AAPLc (updates inside). */
function thanksgivingWeek(): Base {
  const base = new Base();
  const [tgClose, tgOpen, wkClose, wkOpen] = [at(TG!.closeTs), at(TG!.openTs), at(WK!.closeTs), at(WK!.openTs)];
  for (const b of [tgClose - 70_000, tgOpen + 3_000, wkClose - 40_000, wkOpen + 3_000]) base.answer(NVDA, b);
  for (const b of [tgClose - 60_000, tgClose + 100, tgClose + 300_000, tgOpen + 1_000, wkClose - 30_000, wkClose + 500, wkClose + 400_000, wkOpen - 10_000, wkOpen + 1_000])
    base.swap(NVDA, b);
  for (const b of [tgClose - 500, tgClose + 200_000, tgOpen + 2_000, wkClose - 1_000, wkClose + 300_000, wkOpen - 20_000, wkOpen + 2_500]) base.answer(AAPL, b);
  for (const b of [tgClose + 50, tgClose + 500_000, wkClose + 200, wkClose + 900_000, wkOpen - 5_000]) base.swap(AAPL, b);
  return base;
}

let dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gap-warm-"));
  dirs.push(d);
  return d;
};
beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const warm = (base: Base, cacheDir: string, edition = 1, windows?: string[]) => {
  const lines: string[] = [];
  const done = warmEdition({ reader: base, cacheDir, log: (l) => lines.push(l), calendar: CALENDAR }, { edition, windows, tokens: TOKENS });
  return { done, lines };
};
const measure = (base: Base, cacheDir: string | null, opts: { edition?: number; complete?: boolean; windows?: string[] } = {}) =>
  measureEdition(
    { reader: base, source: (headBlock) => createLogSource(base, { cacheDir, headBlock }), log: () => {}, calendar: CALENDAR, vault: VAULT },
    { edition: opts.edition ?? 1, windows: opts.windows, tokens: TOKENS, complete: opts.complete ?? true },
  );
/** The spans that are settled at `head`: they end SETTLED or more blocks below it, so a run at that head keeps them. */
const settledAt = (head: number) => (q: { to: number }) => q.to <= head - SETTLED;

describe("warmEdition", () => {
  it("leaves Monday's --complete run only the spans that were not settled below Sunday's head, and the same file", async () => {
    const cold = thanksgivingWeek();
    cold.finalizedBlock = MONDAY;
    const coldFile = await measure(cold, tmp());
    const coldReads = cold.spanReads();

    const base = thanksgivingWeek();
    const cache = tmp();
    base.finalizedBlock = SUNDAY;
    const { done, lines } = warm(base, cache);
    const result = await done;
    // It counts its eth_getLogs calls as Base saw them.
    expect(result.windows.reduce((n, w) => n + w.getLogs, 0)).toBe(base.spanReads().length);
    base.queries = [];
    base.finalizedBlock = MONDAY;
    const file = await measure(base, cache);

    // Monday asks Base only for spans that end within SETTLED blocks of Sunday's head, or above it, and for all of those.
    expect(base.spanReads()).toEqual(coldReads.filter((q) => !settledAt(SUNDAY)(q)));
    expect(base.spanReads().length).toBeGreaterThan(0);
    expect(coldReads.filter(settledAt(SUNDAY)).length).toBeGreaterThan(base.spanReads().length);
    // The warm-up changes no figure.
    expect(file).toEqual(coldFile);

    const lastSettled = Math.floor((SUNDAY - SETTLED + 1) / SPAN) * SPAN - 1;
    expect(result.head).toEqual({ block: SUNDAY, ts: tsOf(SUNDAY) });
    expect(result.windows.map((w) => [w.id, w.status, w.keptThrough])).toEqual([
      ["2026-11-25", "complete", expect.any(Number)],
      ["2026-11-27", "pending", lastSettled],
    ]);
    const weekend = result.windows[1]!;
    // Per aligned span: how many of its files (one per token and kind) were read from Base, from the cache, and kept. The
    // span below the weekend's close holds NVDAc's last update before it, and Thanksgiving's reads after its open read
    // that span already: both answer files and NVDAc's swaps come from the cache.
    const below = Math.floor((at(WK!.closeTs) - 40_000) / SPAN) * SPAN;
    expect(weekend.spans[0]).toEqual({ from: below, to: below + SPAN - 1, read: 0, cached: 3, kept: 3 });
    expect(weekend.spans.at(-1)).toEqual({ from: Math.floor(SUNDAY / SPAN) * SPAN, to: SUNDAY, read: 4, cached: 0, kept: 0 });
    expect(weekend.kept).toBe(weekend.spans.reduce((n, s) => n + s.kept, 0));
    expect(lines).toContain(`window 2026-11-27: blocks ${below}-${below + SPAN - 1}: 0 read from Base, 3 from the cache, 3 kept`);
    expect(lines).toContain(
      `window 2026-11-27: blocks ${weekend.spans.at(-1)!.from}-${SUNDAY}: 4 read from Base, 0 from the cache, not kept: within ${SETTLED} blocks of the head`,
    );
    expect(lines.some((l) => l.startsWith(`window 2026-11-27: pending, from block ${at(WK!.closeTs)} through block ${SUNDAY}`))).toBe(true);
    expect(lines.some((l) => l.startsWith(`window 2026-11-27: ${weekend.kept} span files in the cache, the last ending at block ${lastSettled}`))).toBe(true);
  });

  it("reads a pending window's swaps from the feed's last update before the close, where Monday's freeze starts", async () => {
    const only = ["2026-11-27"];
    const cold = thanksgivingWeek();
    cold.finalizedBlock = MONDAY;
    await measure(cold, tmp(), { windows: only });
    // NVDAc is frozen from its update 40,000 blocks before the close, in the span below the close's: Monday reads that
    // span's swaps, and no other read of this window asks for them.
    const below = Math.floor((at(WK!.closeTs) - 40_000) / SPAN) * SPAN;
    const preClose = (q: LogQuery) => q.topic0 === SWAP_TOPIC && q.address === NVDA.pool && q.from === below;
    expect(cold.spanReads().filter(preClose)).toHaveLength(1);

    const base = thanksgivingWeek();
    const cache = tmp();
    base.finalizedBlock = SUNDAY;
    await warm(base, cache, 1, only).done;
    expect(base.spanReads().filter(preClose)).toHaveLength(1);
    base.queries = [];
    base.finalizedBlock = MONDAY;
    await measure(base, cache, { windows: only });
    expect(base.spanReads()).toEqual(cold.spanReads().filter((q) => !settledAt(SUNDAY)(q)));
  });

  it("writes cache files with exactly the names the measuring run reads: kind, addresses, span start and end", async () => {
    const base = thanksgivingWeek();
    const cache = tmp();
    base.finalizedBlock = SUNDAY;
    await warm(base, cache).done;
    const written = fs.readdirSync(cache).sort();
    for (const name of written) {
      const m = /^(answer|swap)-(0x[0-9a-f]{40})-(\d+)-(\d+)\.json$/.exec(name);
      expect(m, name).not.toBeNull();
      const [, kind, address, from, to] = m!;
      const nav = [AAPL, NVDA].find((t) => (kind === "answer" ? aggregatorOf(t) : t.pool.toLowerCase()) === address);
      expect(nav, name).toBeDefined();
      expect(Number(from) % SPAN).toBe(0);
      expect(Number(to)).toBe(Number(from) + SPAN - 1);
      expect(Number(to)).toBeLessThanOrEqual(SUNDAY - SETTLED);
    }

    const real = fs.readFileSync;
    const read: string[] = [];
    const spy = vi.spyOn(fs, "readFileSync").mockImplementation(((...args: Parameters<typeof fs.readFileSync>) => {
      const out = real(...args);
      if (typeof args[0] === "string" && path.dirname(args[0]) === cache) read.push(path.basename(args[0]));
      return out;
    }) as typeof fs.readFileSync);
    try {
      base.finalizedBlock = MONDAY;
      await measure(base, cache);
    } finally {
      spy.mockRestore();
    }
    expect([...new Set(read)].sort()).toEqual(written);
    expect(written.length).toBeGreaterThan(0);
  });

  it("reads nothing for a window that has not started, and measures no window", async () => {
    const base = thanksgivingWeek();
    base.finalizedBlock = at(utc("2026-11-26T12:00:00Z"));
    const { done, lines } = warm(base, tmp());
    const result = await done;
    expect(result.windows.map((w) => [w.id, w.status])).toEqual([
      ["2026-11-25", "pending"],
      ["2026-11-27", "not started"],
    ]);
    expect(result.windows[1]).toMatchObject({ spans: [], kept: 0, keptThrough: null });
    expect(base.spanReads().every((q) => q.to < at(WK!.closeTs) - SPAN)).toBe(true);
    expect(lines).toContain(
      `window 2026-11-27: not started: its close, Fri 27 Nov 13:00 ET, is after block ${base.finalizedBlock} (2026-11-26T12:00:00Z), the block this run reads through, so there is nothing to read yet`,
    );
    expect(result).not.toHaveProperty("windows.0.tokens");
  });

  it("leaves edition 0's measurement as it was: a warm-up inside its last window, then a run at a later head, gives the file a run with no cache gives", async () => {
    const [, , last] = editionWindows(EDITIONS[0]!);
    const seed = (b: Base) => {
      const [close, open] = [at(last!.closeTs), at(last!.openTs)];
      for (const n of [close - 20_000, close + 150_000, open + 4_000]) b.answer(NVDA, n);
      for (const n of [close - 10_000, close + 10, close + 700_000, open + 1_000]) b.swap(NVDA, n);
      for (const n of [close - 300, open - 30_000, open + 1_500]) b.answer(AAPL, n);
      for (const n of [close + 5, open - 1]) b.swap(AAPL, n);
      return b;
    };
    const head = at(utc("2026-11-23T16:00:00Z"));
    const cold = seed(new Base());
    cold.finalizedBlock = head;
    const coldFile = await measure(cold, null, { edition: 0, complete: false });

    const base = seed(new Base());
    const cache = tmp();
    base.finalizedBlock = at(utc("2026-11-23T12:30:00Z"));
    await warm(base, cache, 0).done;
    base.finalizedBlock = head;
    expect(await measure(base, cache, { edition: 0, complete: false })).toEqual(coldFile);
  });
});

describe("npm run gap-index -- --warm", () => {
  const cli = (base: Base, over: Partial<GapCliDeps> = {}) => {
    const printed: string[] = [];
    const lines: string[] = [];
    const deps: GapCliDeps = {
      reader: base,
      cacheDir: tmp(),
      outDir: tmp(),
      calendar: CALENDAR,
      vault: VAULT,
      stdout: (t) => printed.push(t),
      log: (l) => lines.push(l),
      ...over,
    };
    return { deps, printed, lines };
  };

  it("fills the cache and writes nothing under the content folder, where the same run without --warm writes the edition", async () => {
    const base = thanksgivingWeek();
    base.finalizedBlock = SUNDAY;
    const { deps, printed, lines } = cli(base);
    await runGapIndex(["--edition", "1", "--warm"], deps);
    expect(fs.readdirSync(deps.outDir)).toEqual([]);
    expect(printed).toEqual([]);
    expect(fs.readdirSync(deps.cacheDir).length).toBeGreaterThan(0);
    expect(lines.at(-1)).toBe(`wrote nothing under ${deps.outDir}: --warm only fills ${deps.cacheDir}`);

    await runGapIndex(["--edition", "1", "--warm", "--window", "2026-11-27", "--token", "NVDAc"], deps);
    expect(fs.readdirSync(deps.outDir)).toEqual([]);

    await runGapIndex(["--edition", "1"], deps);
    expect(fs.readdirSync(deps.outDir)).toEqual(["edition-1.json"]);
  });

  it.each([
    ["--complete", "--warm refuses --complete: --complete measures every window and writes the edition file, and --warm measures nothing; run --warm first, then --complete on its own"],
    ["--stdout", "--warm refuses --stdout: --warm measures nothing and writes no edition, so it has nothing to print"],
    ["--no-cache", "--warm refuses --no-cache: --warm only fills the log cache, and --no-cache would keep nothing it reads"],
  ])("refuses %s before it reads anything, and says why", async (flag, message) => {
    const base = thanksgivingWeek();
    const { deps, printed } = cli(base);
    const run = runGapIndex(["--edition", "1", "--warm", flag], deps);
    await expect(run).rejects.toThrow(message);
    await expect(run).rejects.toBeInstanceOf(UsageError);
    expect(base.reads).toBe(0);
    expect(fs.readdirSync(deps.cacheDir)).toEqual([]);
    expect(fs.readdirSync(deps.outDir)).toEqual([]);
    expect(printed).toEqual([]);
  });
});
