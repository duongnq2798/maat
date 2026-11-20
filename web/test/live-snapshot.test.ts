import { describe, expect, it, vi } from "vitest";
import { MULTICALL3, NAV_TOKENS } from "@/content/b20-nav";
import { decodeAggregate3, encodeAggregate3, encodeAggregate3Result, encodeCall, SELECTORS, word } from "@/lib/live/abi";
import { type LiveReader, RpcError } from "@/lib/live/rpc";
import { buildCalls, calendarAddress, decodeSnapshot, readSnapshot } from "@/lib/live/snapshot";
import fixture from "./fixtures/live-aggregate3.json";

const recorded = (): LiveReader => ({ call: vi.fn(async () => ({ data: fixture.response as `0x${string}`, endpoint: "https://base-rpc.publicnode.com" })) });

describe("one reading of Base", () => {
  it("builds the recorded request: block, timestamp, then five calls per token", () => {
    expect(encodeAggregate3(buildCalls(fixture.twapWindowSec)).toLowerCase()).toBe(fixture.request.toLowerCase());
  });

  it("decodes the recorded block, timestamp and every token", () => {
    const s = decodeSnapshot(decodeAggregate3(fixture.response as `0x${string}`), fixture.twapWindowSec);
    expect(s.block).toBe(BigInt(fixture.expected.blockNumber));
    expect(s.timestamp).toBe(Number(fixture.expected.timestamp));
    expect(s.tokens.map((t) => t.symbol)).toEqual(NAV_TOKENS.map((t) => t.symbol));
    const sndk = s.tokens.find((t) => t.symbol === "SNDKc");
    expect(sndk?.uiMultiplier).toBe(8_000_000_000_000_000_000n);
    expect(sndk?.effectiveAt).toBe(1_795_150_800n);
    for (const t of s.tokens) {
      expect(t.paused).toBe(false);
      expect(t.feed?.answer).toBeGreaterThan(0n);
      expect(t.twap8).toBeGreaterThan(0n);
    }
  });

  it("keeps a failed sub-call as null instead of dropping the token", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    results[2 + 3] = { success: false, returnData: "0x" }; // AAPLc latestRoundData
    results[2 + 4] = { success: true, returnData: "0x" }; // AAPLc observe, no data
    const s = decodeSnapshot(results, fixture.twapWindowSec);
    expect(s.tokens[0]?.feed).toBeNull();
    expect(s.tokens[0]?.twap8).toBeNull();
  });

  it("refuses a reading without a block number or timestamp", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    results[0] = { success: false, returnData: "0x" };
    expect(() => decodeSnapshot(results, fixture.twapWindowSec)).toThrow(/block/);
  });

  it("refuses a reading with the wrong number of results", () => {
    expect(() => decodeSnapshot([], fixture.twapWindowSec)).toThrow(/results/);
  });

  it("reads the repo calendar until MarketCalendar is in the deployments table", async () => {
    expect(calendarAddress()).toBeNull();
    const s = await readSnapshot(recorded(), { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(s.calendar).toEqual({ source: "repo" });
    expect(s.endpoint).toBe("https://base-rpc.publicnode.com");
  });

  it("asks a deployed MarketCalendar at the same block", async () => {
    const cal = "0x00000000000000000000000000000000000000ca" as const;
    const call = vi.fn()
      .mockResolvedValueOnce({ data: fixture.response, endpoint: "https://base-rpc.publicnode.com" })
      .mockResolvedValueOnce({ data: `0x${word(0n)}`, endpoint: "https://base-rpc.publicnode.com" });
    const s = await readSnapshot({ call }, { twapWindowSec: fixture.twapWindowSec, calendar: cal });
    expect(s.calendar).toEqual({ source: "onchain", address: cal, open: false });
    expect(call.mock.calls[1]).toEqual([{ to: cal, data: encodeCall(SELECTORS.isOpen, BigInt(fixture.expected.timestamp), 0n) }, BigInt(fixture.expected.blockNumber)]);
  });

  it("sends its multicall to Multicall3 at latest", async () => {
    const reader = recorded();
    await readSnapshot(reader, { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(reader.call).toHaveBeenCalledWith({ to: MULTICALL3, data: encodeAggregate3(buildCalls(fixture.twapWindowSec)) }, "latest");
  });

  it("decodes a synthetic answer built with the result encoder", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    const again = decodeAggregate3(encodeAggregate3Result(results));
    expect(decodeSnapshot(again, fixture.twapWindowSec).block).toBe(BigInt(fixture.expected.blockNumber));
  });

  it("keeps all 13 tokens and reports open: null when the calendar call fails", async () => {
    const cal = "0x00000000000000000000000000000000000000ca" as const;
    const call = vi.fn()
      .mockResolvedValueOnce({ data: fixture.response, endpoint: "https://base-rpc.publicnode.com" })
      .mockRejectedValueOnce(new RpcError([{ endpoint: "https://base-rpc.publicnode.com", message: "boom" }]));
    const s = await readSnapshot({ call }, { twapWindowSec: fixture.twapWindowSec, calendar: cal });
    expect(s.tokens).toHaveLength(NAV_TOKENS.length);
    expect(s.calendar).toEqual({ source: "onchain", address: cal, open: null });
  });

  it("reads empty return data as null, never false or 0", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    results[2] = { success: true, returnData: "0x" }; // AAPLc isPaused
    results[3] = { success: true, returnData: "0x" }; // AAPLc uiMultiplier
    const t = decodeSnapshot(results, fixture.twapWindowSec).tokens[0];
    expect(t?.paused).toBeNull();
    expect(t?.uiMultiplier).toBeNull();
  });
});
