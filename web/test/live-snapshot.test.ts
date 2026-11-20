import { describe, expect, it, vi } from "vitest";
import { MULTICALL3, NAV_TOKENS } from "@/content/b20-nav";
import { decodeAggregate3, encodeAggregate3, encodeAggregate3Result, encodeCall, SELECTORS, word } from "@/lib/live/abi";
import { createReader, LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
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

  it("finds the Base mainnet MarketCalendar in the deployments table, and null while its address cell is empty", () => {
    const cal = "0x00000000000000000000000000000000000000ca";
    const row = (address: string, network = "Base mainnet", contract = "MarketCalendar") => ({ network, contract, address });
    expect(calendarAddress([row("")])).toBeNull();
    expect(calendarAddress([])).toBeNull();
    expect(calendarAddress([row(cal)])).toBe(cal);
    expect(calendarAddress([row("", "Base mainnet", "MandateVault"), row(` ${cal} `)])).toBe(cal);
    expect(calendarAddress([row("0x00ca")])).toBeNull();
    expect(calendarAddress([row("pending")])).toBeNull();
    expect(calendarAddress([row(cal, "Base Sepolia")])).toBeNull();
    expect(calendarAddress([row(cal, "Base mainnet", "MandateVault")])).toBeNull();
  });

  it("reads the repo calendar when no MarketCalendar address is given, with one call", async () => {
    const reader = recorded();
    const s = await readSnapshot(reader, { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(reader.call).toHaveBeenCalledTimes(1);
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
    expect(call.mock.calls[1]!.slice(0, 2)).toEqual([{ to: cal, data: encodeCall(SELECTORS.isOpen, BigInt(fixture.expected.timestamp), 0n) }, BigInt(fixture.expected.blockNumber)]);
  });

  it("sends its multicall to Multicall3 at latest", async () => {
    const reader = recorded();
    await readSnapshot(reader, { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(vi.mocked(reader.call).mock.calls[0]!.slice(0, 2)).toEqual([{ to: MULTICALL3, data: encodeAggregate3(buildCalls(fixture.twapWindowSec)) }, "latest"]);
  });

  /** A fetch for createReader: each endpoint answers the multicall and isOpen as `answer` says, by URL and method. */
  function fakeFetch(answer: (url: string, call: "multicall" | "isOpen") => Response) {
    return vi.fn(async (url: string, init: RequestInit) => {
      const data = String(JSON.parse(String(init.body)).params[0].data);
      return answer(url, data.startsWith(SELECTORS.aggregate3) ? "multicall" : "isOpen");
    });
  }
  const result = (r: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: r }), { status: 200 });

  it("takes the reading from the next endpoint when the first answers a multicall cut short", async () => {
    const f = fakeFetch((url) => result(url === LIVE_RPCS[0] ? fixture.response.slice(0, 1_000) : fixture.response));
    const s = await readSnapshot(createReader({ fetch: f as unknown as typeof fetch }), { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(s.endpoint).toBe(LIVE_RPCS[1]);
    expect(s.block).toBe(BigInt(fixture.expected.blockNumber));
    expect(s.tokens).toHaveLength(NAV_TOKENS.length);
  });

  it("takes the reading from the next endpoint when the first answers a multicall with the wrong number of results", async () => {
    const short = encodeAggregate3Result(decodeAggregate3(fixture.response as `0x${string}`).slice(0, 2));
    const f = fakeFetch((url) => result(url === LIVE_RPCS[0] ? short : fixture.response));
    const s = await readSnapshot(createReader({ fetch: f as unknown as typeof fetch }), { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(s.endpoint).toBe(LIVE_RPCS[1]);
  });

  it("asks a deployed MarketCalendar first at the endpoint that answered the multicall, then the others", async () => {
    const cal = "0x00000000000000000000000000000000000000ca" as const;
    const f = fakeFetch((url, call) =>
      url === LIVE_RPCS[0] ? new Response("busy", { status: 503 }) : result(call === "multicall" ? fixture.response : `0x${word(1n)}`),
    );
    const s = await readSnapshot(createReader({ fetch: f as unknown as typeof fetch }), { twapWindowSec: fixture.twapWindowSec, calendar: cal });
    expect(s.endpoint).toBe(LIVE_RPCS[1]);
    expect(s.calendar).toEqual({ source: "onchain", address: cal, open: true });
    expect(f.mock.calls.map(([url]) => url)).toEqual([LIVE_RPCS[0], LIVE_RPCS[1], LIVE_RPCS[1]]);
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
