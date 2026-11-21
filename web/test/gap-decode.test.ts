// @vitest-environment node
import { describe, expect, it } from "vitest";
import { B20_DECIMALS, USDC_DECIMALS } from "@/content/b20-nav";
import { before, byPosition, decodeAnswerUpdated, decodeSwap, type RawLog } from "@/lib/gap/decode";
import { poolPrice8 } from "@/lib/gap/measure";
import { priceFromSqrt } from "@/lib/live/price";
import fixture from "./fixtures/gap-logs.json";

const swapLog = fixture.swap as RawLog;
const answerLog = fixture.answerUpdated as RawLog;

describe("decodeSwap", () => {
  it("decodes the real Swap log", () => {
    const s = decodeSwap(swapLog);
    expect(s.block).toBe(57_066_122);
    expect(s.logIndex).toBe(119);
    expect(s.ts).toBe(1794603600);
    expect(new Date(s.ts * 1000).toISOString()).toBe("2026-11-13T21:00:00.000Z");
    expect(s.sqrtPriceX96).toBe(0xc89fddf0644de7d09dc48f7en);
    expect(s.tx).toBe(swapLog.transactionHash);
    const p = poolPrice8(s);
    expect(p).toBeGreaterThan(0n);
    expect(p).toBe(priceFromSqrt(s.sqrtPriceX96, false, B20_DECIMALS, USDC_DECIMALS));
  });

  it("throws on a wrong topic, short data, or a missing timestamp", () => {
    expect(() => decodeSwap({ ...swapLog, topics: [fixture.answerUpdated.topics[0]!] })).toThrow();
    expect(() => decodeSwap({ ...swapLog, topics: [] })).toThrow();
    expect(() => decodeSwap({ ...swapLog, data: swapLog.data.slice(0, 2 + 64 * 4) })).toThrow();
    const { blockTimestamp: _t, ...rest } = swapLog;
    expect(() => decodeSwap(rest)).toThrow();
  });
});

describe("decodeAnswerUpdated", () => {
  it("decodes the real AnswerUpdated log", () => {
    const u = decodeAnswerUpdated(answerLog);
    expect(u.block).toBe(57_113_037);
    expect(u.logIndex).toBe(26);
    expect(u.ts).toBe(1794612983);
    expect(new Date(u.ts * 1000).toISOString()).toBe("2026-11-13T23:36:23.000Z");
    expect(u.answer).toBe(16_076_543_559n);
    expect(u.address).toBe(answerLog.address);
  });

  it("lowercases the address", () => {
    expect(decodeAnswerUpdated({ ...answerLog, address: answerLog.address.toUpperCase().replace("0X", "0x") }).address).toBe(answerLog.address);
  });

  it("decodes a top-bit answer as negative", () => {
    const neg = `0x${"f".repeat(63)}f`;
    expect(decodeAnswerUpdated({ ...answerLog, topics: [answerLog.topics[0]!, neg, answerLog.topics[2]!] }).answer).toBe(-1n);
  });

  it("throws on a wrong topic, a missing answer topic, or a missing timestamp", () => {
    expect(() => decodeAnswerUpdated(swapLog)).toThrow();
    expect(() => decodeAnswerUpdated({ ...answerLog, topics: [answerLog.topics[0]!] })).toThrow();
    const { blockTimestamp: _t, ...rest } = answerLog;
    expect(() => decodeAnswerUpdated(rest)).toThrow();
  });
});

describe("ordering", () => {
  it("orders by block then log index", () => {
    expect(before({ block: 1, logIndex: 9 }, { block: 2, logIndex: 0 })).toBe(true);
    expect(before({ block: 2, logIndex: 1 }, { block: 2, logIndex: 2 })).toBe(true);
    expect(before({ block: 2, logIndex: 2 }, { block: 2, logIndex: 2 })).toBe(false);
    expect(byPosition({ block: 3, logIndex: 0 }, { block: 2, logIndex: 5 })).toBeGreaterThan(0);
  });
});
