import { keccak_256 } from "@noble/hashes/sha3.js";
import { describe, expect, it } from "vitest";
import { NAV_TOKENS, MULTICALL3 } from "@/content/b20-nav";
import {
  decodeAggregate3, decodeBool, decodeObserve, decodeRoundData, decodeUint, encodeAggregate3,
  encodeAggregate3Result, encodeCall, encodeObserve, SELECTORS, type Call3,
} from "@/lib/live/abi";
import fixture from "./fixtures/live-aggregate3.json";

const selector = (sig: string) =>
  `0x${Buffer.from(keccak_256(new TextEncoder().encode(sig))).subarray(0, 4).toString("hex")}`;

const SIGNATURES: Record<keyof typeof SELECTORS, string> = {
  aggregate3: "aggregate3((address,bool,bytes)[])",
  getBlockNumber: "getBlockNumber()",
  getCurrentBlockTimestamp: "getCurrentBlockTimestamp()",
  isPaused: "isPaused(uint8)",
  uiMultiplier: "uiMultiplier()",
  effectiveAt: "effectiveAt()",
  latestRoundData: "latestRoundData()",
  observe: "observe(uint32[])",
  isOpen: "isOpen(uint256,uint8)",
};

/** The fixture's call order: block number, block timestamp, then per token isPaused(0), uiMultiplier, effectiveAt, latestRoundData, observe([1800, 0]). */
function fixtureCalls(): Call3[] {
  const calls: Call3[] = [
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getBlockNumber) },
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getCurrentBlockTimestamp) },
  ];
  for (const t of NAV_TOKENS) {
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.isPaused, 0n) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.uiMultiplier) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.effectiveAt) });
    calls.push({ target: t.feed, allowFailure: true, callData: encodeCall(SELECTORS.latestRoundData) });
    calls.push({ target: t.pool, allowFailure: true, callData: encodeObserve([fixture.twapWindowSec, 0]) });
  }
  return calls;
}

describe("the live ABI codec", () => {
  it("uses the keccak-256 selector of every signature", () => {
    for (const [k, sig] of Object.entries(SIGNATURES)) expect(SELECTORS[k as keyof typeof SELECTORS]).toBe(selector(sig));
  });

  it("encodes the recorded aggregate3 request byte for byte", () => {
    expect(encodeAggregate3(fixtureCalls()).toLowerCase()).toBe(fixture.request.toLowerCase());
  });

  it("decodes the recorded response as viem did", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    expect(results).toHaveLength(2 + 5 * NAV_TOKENS.length);
    expect(decodeUint(results[0]!)).toBe(BigInt(fixture.expected.blockNumber));
    expect(decodeUint(results[1]!)).toBe(BigInt(fixture.expected.timestamp));
    fixture.expected.tokens.forEach((e, i) => {
      const r = results.slice(2 + i * 5, 7 + i * 5);
      expect(decodeBool(r[0]!)).toBe(e.paused);
      expect(decodeUint(r[1]!)).toBe(BigInt(e.uiMultiplier));
      expect(decodeUint(r[2]!)).toBe(BigInt(e.effectiveAt));
      expect(decodeRoundData(r[3]!)).toEqual({ answer: BigInt(e.answer), updatedAt: BigInt(e.updatedAt) });
      expect(decodeObserve(r[4]!)?.tickCumulatives).toEqual(e.tickCumulatives.map(BigInt));
    });
  });

  it("round-trips results, failures included", () => {
    const results = [
      { success: true, returnData: encodeCall("0x", 7n).slice(0, 66) as `0x${string}` },
      { success: false, returnData: "0x" as const },
      { success: true, returnData: "0x01020304" as const },
    ];
    expect(decodeAggregate3(encodeAggregate3Result(results))).toEqual(results);
  });

  it("treats a failed call as null", () => {
    const failed = { success: false, returnData: `0x${"00".repeat(31)}01` as `0x${string}` };
    expect(decodeBool(failed)).toBeNull();
    expect(decodeUint(failed)).toBeNull();
    expect(decodeRoundData(failed)).toBeNull();
    expect(decodeObserve(failed)).toBeNull();
  });

  it("short returnData is a failure: a call to an address without code succeeds with no data", () => {
    const empty = { success: true, returnData: "0x" as const };
    expect(decodeBool(empty)).toBeNull();
    expect(decodeUint(empty)).toBeNull();
    expect(decodeRoundData({ success: true, returnData: `0x${"00".repeat(64)}` })).toBeNull();
    expect(decodeObserve({ success: true, returnData: `0x${"00".repeat(32)}` })).toBeNull();
  });

  it("decodes negative tick cumulatives as signed", () => {
    // observe() returning int56[] [-5, -1] and uint160[] [0, 0]
    const w = (n: bigint) => (n & ((1n << 256n) - 1n)).toString(16).padStart(64, "0");
    const data = `0x${[w(0x40n), w(0xa0n), w(2n), w(-5n), w(-1n), w(2n), w(0n), w(0n)].join("")}` as `0x${string}`;
    expect(decodeObserve({ success: true, returnData: data })?.tickCumulatives).toEqual([-5n, -1n]);
  });
});
