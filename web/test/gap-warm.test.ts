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
import { measureEdition, warmEdition, type WarmResult } from "@/lib/gap/edition";
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

/**
 * Each test runs whole editions against the fake Base and writes real cache files: about 1 s alone, and more than 5 s,
 * vitest's default, on a loaded machine.
 */
const HEAVY = { timeout: 30_000 };

describe("warmEdition", HEAVY, () => {
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
    expect(weekend.spans[0]).toEqual({ from: below, to: below + SPAN - 1, read: 0, cached: 3, kept: 3, failed: 0 });
    expect(weekend.spans.at(-1)).toEqual({ from: Math.floor(SUNDAY / SPAN) * SPAN, to: SUNDAY, read: 4, cached: 0, kept: 0, failed: 0 });
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

  it("counts the span files it could not write to the cache and says so, instead of blaming the head", async () => {
    const base = thanksgivingWeek();
    base.finalizedBlock = SUNDAY;
    // A file where the cache folder should be: every write fails, as on a full disk or an unwritable folder.
    const blocker = path.join(tmp(), "gap");
    fs.writeFileSync(blocker, "x");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result!: WarmResult;
    let lines: string[] = [];
    try {
      const run = warm(base, blocker);
      result = await run.done;
      lines = run.lines;
    } finally {
      warn.mockRestore();
    }
    expect(result.windows.map((w) => w.kept)).toEqual([0, 0]);
    for (const w of result.windows) {
      // Every file of a span settled below the head was read from Base, and none of them is kept.
      const settled = w.spans.filter((s) => s.to <= SUNDAY - SETTLED);
      expect(settled.length).toBeGreaterThan(0);
      for (const s of settled) expect(s).toMatchObject({ cached: 0, kept: 0, failed: s.read });
      expect(w.failed).toBe(settled.reduce((n, s) => n + s.read, 0));
      expect(w.writeError).toMatch(/EEXIST|ENOTDIR/);
      for (const s of settled) {
        expect(lines).toContain(`window ${w.id}: blocks ${s.from}-${s.to}: ${s.read} read from Base, 0 from the cache, 0 kept, ${s.read} could not be written to the cache`);
      }
      expect(lines.some((l) => l.startsWith(`window ${w.id}: ${w.failed} span files settled below the head could not be written to the cache (`))).toBe(true);
    }
    expect(lines.filter((l) => l.includes("every span it read is within"))).toEqual([]);
  });

  it("says which span files a partly failed warm-up could not write, and never that a later run reads only after the last kept one", async () => {
    const base = thanksgivingWeek();
    base.finalizedBlock = SUNDAY;
    const cache = tmp();
    const real = fs.renameSync;
    const refused: string[] = [];
    // Only the feeds' files fail, as a Windows EPERM on rename can.
    const ren = vi.spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (path.basename(String(to)).startsWith("answer-")) {
        refused.push(path.basename(String(to)));
        throw new Error("EPERM: operation not permitted, rename");
      }
      return real(from, to);
    }) as typeof fs.renameSync);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let result!: WarmResult;
    let lines: string[] = [];
    try {
      const run = warm(base, cache);
      result = await run.done;
      lines = run.lines;
    } finally {
      ren.mockRestore();
      warn.mockRestore();
    }
    expect(refused.length).toBeGreaterThan(0);
    // A window counts each file once, also one it read twice; two windows may each count one file, the run counts it once.
    expect(result.windows.reduce((n, w) => n + w.failed, 0)).toBeGreaterThanOrEqual(new Set(refused).size);
    expect(result.failed).toBe(new Set(refused).size);
    expect(result.writeError).toBe("EPERM: operation not permitted, rename");
    expect(fs.readdirSync(cache).filter((f) => f.startsWith("answer-"))).toEqual([]);
    expect(fs.readdirSync(cache).filter((f) => f.startsWith("swap-")).length).toBeGreaterThan(0);
    for (const w of result.windows) {
      // Each file of a settled span is either kept or counted as not written.
      for (const s of w.spans.filter((x) => x.to <= SUNDAY - SETTLED)) expect(s.kept + s.failed).toBe(s.read + s.cached);
      expect(w.failed).toBeGreaterThan(0);
      expect(w.kept).toBeGreaterThan(0);
      expect(w.writeError).toBe("EPERM: operation not permitted, rename");
      expect(lines.some((l) => l.startsWith(`window ${w.id}: ${w.failed} span files settled below the head could not be written to the cache (EPERM`))).toBe(true);
    }
    expect(lines.filter((l) => l.includes("from Base only after it"))).toEqual([]);
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

describe("npm run gap-index -- --warm", HEAVY, () => {
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
    // The other feeds update just before each close and just after Thanksgiving's open, so their rows read few spans.
    for (const nav of NAV_TOKENS.filter((t) => !TOKENS.includes(t.symbol))) {
      for (const b of [at(TG!.closeTs) - 100, at(TG!.openTs) + 100, at(WK!.closeTs) - 100]) base.answer(nav, b);
    }
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

  it("fails, so the script exits 1, when a settled span file could not be written to the cache", async () => {
    const base = thanksgivingWeek();
    base.finalizedBlock = SUNDAY;
    const blocker = path.join(tmp(), "gap");
    fs.writeFileSync(blocker, "x");
    const { deps, printed, lines } = cli(base, { cacheDir: blocker });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const run = runGapIndex(["--edition", "1", "--warm", "--token", "NVDAc"], deps);
      await expect(run).rejects.toThrow(new RegExp(`^--warm could not write \\d+ span files to ${blocker.replace(/\\/g, "\\\\")}, so a later run reads them from Base again: (EEXIST|ENOTDIR)`));
      await expect(run).rejects.not.toBeInstanceOf(UsageError);
    } finally {
      warn.mockRestore();
    }
    // It read every window it could before it failed, and it does not say the cache is filled.
    expect(lines.filter((l) => / span files settled below the head could not be written to the cache \(/.test(l))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith("wrote nothing under"))).toEqual([]);
    expect(fs.readdirSync(deps.outDir)).toEqual([]);
    expect(printed).toEqual([]);
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

describe("npm run gap-index -- --complete --wait MINUTES", HEAVY, () => {
  /** The command line on the fake Base, with a clock only its sleeps move; `onSleep` runs at each sleep, as time passing. */
  const cli = (base: Base, onSleep: (n: number) => void = () => {}) => {
    const printed: string[] = [];
    const lines: string[] = [];
    const clock = { ms: 0, sleeps: [] as number[], logReadsAtSleep: [] as number[] };
    const deps: GapCliDeps = {
      reader: base,
      cacheDir: tmp(),
      outDir: tmp(),
      calendar: CALENDAR,
      vault: VAULT,
      stdout: (t) => printed.push(t),
      log: (l) => lines.push(l),
      now: () => clock.ms,
      sleep: async (ms: number) => {
        clock.sleeps.push(ms);
        clock.logReadsAtSleep.push(base.queries.length);
        clock.ms += ms;
        onSleep(clock.sleeps.length);
      },
    };
    return { deps, printed, lines, clock };
  };

  it("--wait 1 rereads the finalized block twice, 30 s apart, then refuses with the message of a run without it, and writes nothing", async () => {
    const base = thanksgivingWeek();
    base.finalizedBlock = SUNDAY;
    const { deps, printed, lines, clock } = cli(base);
    const run = runGapIndex(["--edition", "1", "--complete", "--wait", "1"], deps);
    await expect(run).rejects.toThrow(
      `window 2026-11-27 ends Mon 30 Nov 09:30 ET, after block ${SUNDAY}, the latest finalized one (2026-11-29T12:00:00Z): it is not measured yet, so nothing is written; run again once Base has finalized a block at or after its open`,
    );
    await expect(run).rejects.not.toBeInstanceOf(UsageError);
    expect(clock.sleeps).toEqual([30_000, 30_000]);
    expect(lines.filter((l) => l.startsWith("--wait")).map((l) => l.split(":")[0])).toEqual(["--wait 1", "--wait 1, reread 1 of 2", "--wait 1, reread 2 of 2"]);
    expect(base.queries).toEqual([]);
    expect(fs.readdirSync(deps.outDir)).toEqual([]);
    expect(printed).toEqual([]);
  });

  it("with --stdout, waits until the finalized block passes Monday's open, then reads the logs and prints the file", async () => {
    const base = thanksgivingWeek();
    base.finalizedBlock = SUNDAY;
    const { deps, printed, lines, clock } = cli(base, (n) => {
      base.finalizedBlock = n === 1 ? at(utc("2026-11-30T14:20:00Z")) : MONDAY;
    });
    await runGapIndex(["--edition", "1", "--complete", "--wait", "5", "--stdout", "--token", "NVDAc", "--token", "AAPLc"], deps);
    expect(clock.sleeps).toEqual([30_000, 30_000]);
    expect(clock.logReadsAtSleep).toEqual([0, 0]);
    expect(base.queries.length).toBeGreaterThan(0);
    const waits = lines.filter((l) => l.startsWith("--wait"));
    expect(waits).toHaveLength(3);
    expect(waits[1]).toBe(`--wait 5, reread 1 of 10: finalized block ${at(utc("2026-11-30T14:20:00Z"))} (2026-11-30T14:20:00Z); 600 s before the last open, Mon 30 Nov 09:30 ET (2026-11-30T14:30:00Z)`);
    expect(waits[2]).toBe(`--wait 5, reread 2 of 10: finalized block ${MONDAY} (2026-11-30T16:00:00Z); 5400 s after the last open, Mon 30 Nov 09:30 ET (2026-11-30T14:30:00Z): measuring`);
    expect(printed).toHaveLength(1);
    expect(JSON.parse(printed[0]!).head).toEqual({ block: MONDAY, ts: tsOf(MONDAY) });
    expect(fs.readdirSync(deps.outDir)).toEqual([]);
  });

  it.each([
    [["--wait", "5"], "--wait needs --complete: without it a run writes a window that has not ended as pending, so it has nothing to wait for"],
    [["--warm", "--wait", "5"], "--warm refuses --wait: --wait holds a --complete run until every window has ended, and --warm measures nothing; run --warm on its own"],
    [["--complete", "--wait", "5", "--head", "62000000"], "--wait refuses --head: a pinned head never moves, so waiting cannot bring it past an open"],
    [["--complete", "--wait", "0"], "--wait takes a whole number of minutes, 1 or more"],
    [["--complete", "--wait", "1.5"], "--wait takes a whole number of minutes, 1 or more"],
    [["--complete", "--wait", "soon"], "--wait takes a whole number of minutes, 1 or more"],
  ])("refuses %j before it reads anything, and says why", async (args, message) => {
    const base = thanksgivingWeek();
    const { deps, printed, clock } = cli(base);
    const run = runGapIndex(["--edition", "1", ...args], deps);
    await expect(run).rejects.toThrow(message);
    await expect(run).rejects.toBeInstanceOf(UsageError);
    expect(base.reads).toBe(0);
    expect(clock.sleeps).toEqual([]);
    expect(fs.readdirSync(deps.outDir)).toEqual([]);
    expect(printed).toEqual([]);
  });
});
