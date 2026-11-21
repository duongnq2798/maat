// @vitest-environment node
import { describe, expect, it } from "vitest";
import { NAV_TOKENS } from "@/content/b20-nav";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC } from "@/lib/gap/decode";
import { GAP_RPC } from "@/lib/gap/rpc";
import { editionSchema, EditionFileSchema, formatDec8, toTokenRow } from "@/lib/gap/schema";

describe("formatDec8", () => {
  it("writes eight decimals", () => {
    expect(formatDec8(16_076_543_559n)).toBe("160.76543559");
    expect(formatDec8(16_486_250_000n)).toBe("164.86250000");
  });
  it("keeps the sign on negatives", () => {
    expect(formatDec8(-16_076_543_559n)).toBe("-160.76543559");
    expect(formatDec8(-5n)).toBe("-0.00000005");
  });
  it("pads small values", () => {
    expect(formatDec8(5n)).toBe("0.00000005");
    expect(formatDec8(0n)).toBe("0.00000000");
    expect(formatDec8(100_000_000n)).toBe("1.00000000");
  });
});

const base = { id: "2026-11-13", closeTs: 100, openTs: 200, closeLabel: "Fri 13 Nov 16:00 ET", openLabel: "Mon 16 Nov 09:30 ET" };
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const row = (symbol: string) => ({
  symbol,
  token: addr(1),
  pool: addr(2),
  feed: addr(3),
  aggregator: addr(4),
  phase: 2,
  feedLive: false,
  swapsInWindow: 0,
  freeze: null,
  largestGap: null,
  series: { pool: [] as [number, string][], feed: [] as [number, string][] },
});
const file = (windows: unknown[]) => ({
  edition: 0,
  title: "T",
  from: "2026-11-06",
  to: "2026-11-22",
  rpc: GAP_RPC,
  topics: { answerUpdated: ANSWER_UPDATED_TOPIC, swap: SWAP_TOPIC },
  head: { block: 10, ts: 300 },
  windows,
});
const complete = (tokens: unknown[]) => ({ status: "complete", ...base, blocks: { from: 1, to: 9 }, tokens });
const all13 = () => NAV_TOKENS.map((t) => row(t.symbol));

describe("EditionFileSchema", () => {
  it("accepts a minimal pending window", () => {
    expect(EditionFileSchema.safeParse(file([{ status: "pending", ...base }])).success).toBe(true);
  });
  it("accepts a minimal complete window", () => {
    expect(EditionFileSchema.safeParse(file([complete(all13())])).success).toBe(true);
  });
  it("accepts a freeze and a largest gap", () => {
    const u = (block: number) => ({ block, logIndex: 0, ts: 150, answer: "160.76543559", tx: hash(block) });
    const t = {
      ...row("AAPLc"),
      feedLive: true,
      swapsInWindow: 3,
      freeze: { from: u(2), to: u(8), hours: 49.4, returnMoveBps: -12, swapsWhileFrozen: 2, swapsRead: { from: 1, to: 9 } },
      largestGap: { bps: 40, above: false, block: 5, logIndex: 1, ts: 160, tx: hash(5), pool: "159.00000000", held: "160.76543559" },
      series: { pool: [[160, "159.00000000"]], feed: [[100, "160.76543559"]] },
    };
    const rows = [t, ...all13().slice(1)];
    expect(EditionFileSchema.safeParse(file([complete(rows)])).success).toBe(true);
  });
  it("rejects a price with 7 decimals", () => {
    const rows = all13();
    rows[0] = { ...rows[0]!, series: { pool: [[150, "160.7654355"]], feed: [] } };
    expect(EditionFileSchema.safeParse(file([complete(rows)])).success).toBe(false);
  });
  it("rejects an unknown key", () => {
    expect(EditionFileSchema.safeParse({ ...file([{ status: "pending", ...base }]), extra: 1 }).success).toBe(false);
    expect(EditionFileSchema.safeParse(file([{ status: "pending", ...base, extra: 1 }])).success).toBe(false);
  });
  it("rejects 12 tokens in a complete window", () => {
    expect(EditionFileSchema.safeParse(file([complete(all13().slice(0, 12))])).success).toBe(false);
  });
  it("rejects 13 tokens out of NAV_TOKENS order", () => {
    const rows = all13();
    [rows[0], rows[1]] = [rows[1]!, rows[0]!];
    expect(EditionFileSchema.safeParse(file([complete(rows)])).success).toBe(false);
  });
  it("rejects an upper-case address", () => {
    const rows = all13();
    rows[0] = { ...rows[0]!, pool: `0x${"A".repeat(40)}` };
    expect(EditionFileSchema.safeParse(file([complete(rows)])).success).toBe(false);
  });
});

describe("editionSchema({ partial: true })", () => {
  const partial = editionSchema({ partial: true });
  it("accepts a subsequence of NAV_TOKENS", () => {
    expect(partial.safeParse(file([complete([row("NVDAc")])])).success).toBe(true);
    expect(partial.safeParse(file([complete([row("AAPLc"), row("TSLAc")])])).success).toBe(true);
  });
  it("rejects no tokens, an out-of-order pair and an unknown symbol", () => {
    expect(partial.safeParse(file([complete([])])).success).toBe(false);
    expect(partial.safeParse(file([complete([row("TSLAc"), row("AAPLc")])])).success).toBe(false);
    expect(partial.safeParse(file([complete([row("XXXc")])])).success).toBe(false);
  });
});

describe("toTokenRow", () => {
  it("lower-cases addresses and writes prices as strings", () => {
    const nav = NAV_TOKENS.find((t) => t.symbol === "NVDAc")!;
    const r = toTokenRow(
      nav,
      { aggregator: "0xF72B1EB5932800F3D2A5EEC5F99E6CD586479675", phase: 2 },
      { feedLive: false, freeze: null, swapsInWindow: 4, swapsWhileFrozen: null, largestGap: null, series: { pool: [[7, 16_076_543_559n]], feed: [] } },
      null,
    );
    expect(r.token).toBe(nav.token.toLowerCase());
    expect(r.aggregator).toBe("0xf72b1eb5932800f3d2a5eec5f99e6cd586479675");
    expect(r.series.pool).toEqual([[7, "160.76543559"]]);
    expect(r.freeze).toBeNull();
  });
});

describe("consistency rules", () => {
  const u = (block: number) => ({ block, logIndex: 0, ts: 150, answer: "160.00000000", tx: hash(block) });
  const live = (over: Record<string, unknown> = {}) => ({
    ...row("AAPLc"),
    feedLive: true,
    freeze: { from: u(2), to: u(8), hours: 1, returnMoveBps: 0, swapsWhileFrozen: 1, swapsRead: { from: 1, to: 9 } },
    largestGap: { bps: 1, above: true, block: 5, logIndex: 0, ts: 150, tx: hash(5), pool: "161.00000000", held: "160.00000000" },
    ...over,
  });
  const withRow = (r: unknown, w: Record<string, unknown> = {}) => file([{ ...complete([r, ...all13().slice(1)]), ...w }]);
  const ok = (f: unknown) => EditionFileSchema.safeParse(f).success;

  it("accepts the consistent baseline", () => {
    expect(ok(withRow(live()))).toBe(true);
  });
  it("rejects closeTs not before openTs", () => {
    expect(ok(file([{ status: "pending", ...base, closeTs: 200, openTs: 200 }]))).toBe(false);
  });
  it("rejects blocks.from after blocks.to", () => {
    expect(ok(withRow(live(), { blocks: { from: 9, to: 1 } }))).toBe(false);
  });
  it("rejects swapsRead.from after swapsRead.to", () => {
    const l = live();
    expect(ok(withRow({ ...l, freeze: { ...l.freeze, swapsRead: { from: 9, to: 1 } } }))).toBe(false);
  });
  it("rejects a dead feed with a freeze", () => {
    expect(ok(withRow(live({ feedLive: false })))).toBe(false);
  });
  it("rejects a largest gap outside the freeze", () => {
    const l = live();
    expect(ok(withRow({ ...l, largestGap: { ...l.largestGap, block: 9 } }))).toBe(false);
    expect(ok(withRow({ ...l, largestGap: { ...l.largestGap, block: 1 } }))).toBe(false);
  });
  it("rejects a held price that is not the freeze's opening answer", () => {
    const l = live();
    expect(ok(withRow({ ...l, largestGap: { ...l.largestGap, held: "159.00000000" } }))).toBe(false);
  });
  it("rejects a largest gap without a freeze", () => {
    expect(ok(withRow(live({ freeze: null })))).toBe(false);
  });
  it("rejects a series point outside [closeTs, openTs)", () => {
    for (const ts of [99, 200]) {
      expect(ok(withRow(live({ series: { pool: [[ts, "160.00000000"]], feed: [] } })))).toBe(false);
      expect(ok(withRow(live({ series: { pool: [], feed: [[ts, "160.00000000"]] } })))).toBe(false);
    }
    expect(ok(withRow(live({ series: { pool: [[100, "160.00000000"]], feed: [[199, "160.00000000"]] } })))).toBe(true);
  });
});

describe("toTokenRow refuses an incomplete freeze", () => {
  it("throws when a freeze has no swapsWhileFrozen", () => {
    const nav = NAV_TOKENS[0]!;
    const up = { block: 1, logIndex: 0, ts: 1, answer: 1n, tx: hash(1), address: addr(4) };
    const figures = { feedLive: true, freeze: { from: up, to: up, hours: 1, returnMoveBps: 0 }, swapsInWindow: 0, swapsWhileFrozen: null, largestGap: null, series: { pool: [], feed: [] } };
    expect(() => toTokenRow(nav, { aggregator: addr(4), phase: 1 }, figures, { from: 1, to: 2 })).toThrow("swapsWhileFrozen");
  });
});
