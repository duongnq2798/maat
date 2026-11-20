import { describe, expect, it } from "vitest";
import { formatAge, formatBlock, formatDateUtc, formatEt, formatMultiplier, formatUsd8, formatUtc } from "@/lib/live/format";
import fixture from "./fixtures/live-aggregate3.json";

const BLOCK_TS = Number(fixture.expected.timestamp); // Fri 2026-11-20 16:43:08 UTC

describe("live values as the strip and /now print them", () => {
  it("groups a block number by thousands", () => {
    expect(formatBlock(BigInt(fixture.expected.blockNumber))).toBe("60,013,066");
    expect(formatBlock(999n)).toBe("999");
    expect(formatBlock(1_000n)).toBe("1,000");
    expect(formatBlock(0n)).toBe("0");
  });

  it("prints an age in its two largest units, whole seconds only", () => {
    expect(formatAge(14)).toBe("14 s");
    expect(formatAge(3 * 60 + 4)).toBe("3 min 4 s");
    expect(formatAge(2 * 3600 + 5 * 60 + 30)).toBe("2 h 5 min");
    expect(formatAge(2 * 86_400 + 3 * 3600 + 59 * 60)).toBe("2 d 3 h");
    expect(formatAge(0)).toBe("0 s");
    expect(formatAge(59.9)).toBe("59 s");
    expect(formatAge(180)).toBe("3 min");
    expect(formatAge(7200)).toBe("2 h");
    expect(formatAge(2 * 86_400)).toBe("2 d");
    // A clock a little ahead of the chain is no age at all.
    expect(formatAge(-3)).toBe("0 s");
  });

  it("prints a USD value with 8 decimals as dollars and cents, half up", () => {
    expect(formatUsd8(13_607_516_085n)).toBe("$136.08");
    expect(formatUsd8(13_607_500_000n)).toBe("$136.08");
    expect(formatUsd8(13_607_499_999n)).toBe("$136.07");
    expect(formatUsd8(1_234_567_890_000n)).toBe("$12,345.68");
    expect(formatUsd8(0n)).toBe("$0.00");
    expect(formatUsd8(-150_000_000n)).toBe("-$1.50");
  });

  it("prints a WAD multiplier with up to 6 decimals, half up, without trailing zeros", () => {
    expect(formatMultiplier(1_000_537_939_576_369_481n)).toBe("1.000538");
    expect(formatMultiplier(8_000_000_000_000_000_000n)).toBe("8");
    expect(formatMultiplier(1_000_500_389_301_980_219n)).toBe("1.0005");
    expect(formatMultiplier(1_999_999_500_000_000_000n)).toBe("2");
    expect(formatMultiplier(1_000_000_400_000_000_000n)).toBe("1");
  });

  it("prints the block time in UTC with seconds, and in ET to the minute", () => {
    expect(formatUtc(BLOCK_TS)).toBe("16:43:08 UTC");
    expect(formatEt(BLOCK_TS)).toBe("11:43 ET");
    // Daylight saving time: 16:00 UTC is noon in New York on 1 July.
    expect(formatEt(Date.UTC(2026, 6, 1, 16, 0) / 1000)).toBe("12:00 ET");
    expect(formatUtc(Date.UTC(2026, 0, 2, 3, 4, 5) / 1000)).toBe("03:04:05 UTC");
  });

  it("prints a date and minute in UTC", () => {
    expect(formatDateUtc(1_795_150_800)).toBe("2026-11-20 05:00 UTC");
    expect(formatDateUtc(Date.UTC(2027, 0, 9, 23, 59, 59) / 1000)).toBe("2027-01-09 23:59 UTC");
  });
});
