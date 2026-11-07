import { describe, expect, it } from "vitest";
import { MAX_TICK, premiumBps, priceFromSqrt, sqrtPriceAtTick, twapTick } from "../src/chain/priceMath.js";

describe("sqrtPriceAtTick (TickMath port)", () => {
  it("matches TickMath at tick 0 and at both bounds", () => {
    expect(sqrtPriceAtTick(0)).toBe(79228162514264337593543950336n); // 2^96
    expect(sqrtPriceAtTick(-MAX_TICK)).toBe(4295128739n); // TickMath.MIN_SQRT_PRICE
    expect(sqrtPriceAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n); // MAX_SQRT_PRICE
  });

  it("is monotonic and symmetric around 0", () => {
    expect(sqrtPriceAtTick(1)).toBeGreaterThan(sqrtPriceAtTick(0));
    expect(sqrtPriceAtTick(-1)).toBeLessThan(sqrtPriceAtTick(0));
    const up = sqrtPriceAtTick(6932);
    const down = sqrtPriceAtTick(-6932);
    // up * down ~= 2^192 (within rounding)
    const product = (up * down) >> 96n;
    expect(product > (1n << 96n) - 2n ** 40n && product < (1n << 96n) + 2n ** 40n).toBe(true);
  });

  it("rejects ticks out of range and non-integers", () => {
    expect(() => sqrtPriceAtTick(MAX_TICK + 1)).toThrow(/out of range/);
    expect(() => sqrtPriceAtTick(1.5)).toThrow(/out of range/);
  });
});

describe("priceFromSqrt (PriceLib port, same vectors as contracts/test/PriceLib.t.sol)", () => {
  it("stock is token1: the NVDAc/USDC slot0 of 2026-11-06 is ~$185.08", () => {
    const p = priceFromSqrt(58237376898234626810359736464n, false, 8, 6);
    expect(p >= 18507832337n && p <= 18507832339n).toBe(true);
  });

  it("stock is token0: sqrt(1.848) * 2^96 encodes $184.80", () => {
    const p = priceFromSqrt(107703686134665736396608634880n, true, 8, 6);
    const rel = Number(p - 18480000000n) / 18480000000;
    expect(Math.abs(rel)).toBeLessThan(1e-4);
  });

  it("tick -6932 with the stock as token1 is ~$200 (the MockPool vector)", () => {
    const p = priceFromSqrt(sqrtPriceAtTick(-6932), false, 8, 6);
    const rel = Number(p - 20000000000n) / 20000000000;
    expect(Math.abs(rel)).toBeLessThan(1e-3);
  });
});

describe("twapTick", () => {
  it("divides the cumulative delta by the window", () => {
    expect(twapTick(0n, -6932n * 1800n, 1800)).toBe(-6932);
    expect(twapTick(100n, 100n + 7n * 60n, 60)).toBe(7);
  });

  it("rounds a negative non-integer mean down, like PriceLib", () => {
    expect(twapTick(0n, -6932n * 1800n - 1n, 1800)).toBe(-6933);
    expect(twapTick(0n, 6932n * 1800n + 1n, 1800)).toBe(6932);
  });
});

describe("premiumBps", () => {
  it("is symmetric and truncates, like PriceLib", () => {
    expect(premiumBps(101_00000000n, 100_00000000n)).toBe(100n);
    expect(premiumBps(99_00000000n, 100_00000000n)).toBe(100n);
    expect(premiumBps(100_00000000n, 100_00000000n)).toBe(0n);
    expect(premiumBps(100_00999999n, 100_00000000n)).toBe(0n);
  });
});
