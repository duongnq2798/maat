import { describe, expect, it } from "vitest";
import { premiumBps, priceFromSqrt, sqrtPriceAtTick, twapPrice8, twapTick } from "@/lib/live/price";

describe("pool price, as contracts/src/lib/PriceLib.sol computes it", () => {
  it("matches TickMath at tick 0 and at both bounds", () => {
    expect(sqrtPriceAtTick(0n)).toBe(79228162514264337593543950336n);
    expect(sqrtPriceAtTick(-887272n)).toBe(4295128739n);
    expect(sqrtPriceAtTick(887272n)).toBe(1461446703485210103287273052203988822378723970342n);
    expect(() => sqrtPriceAtTick(887273n)).toThrow(RangeError);
  });

  it("matches PriceLib.t.sol: NVDAc/USDC slot0 on 2026-11-06 is $185.08", () => {
    const p = priceFromSqrt(58237376898234626810359736464n, false, 8, 6);
    expect(p >= 18507832337n && p <= 18507832339n).toBe(true);
  });

  it("matches PriceLib.t.sol when the stock is token0", () => {
    const p = priceFromSqrt(107703686134665736396608634880n, true, 8, 6);
    expect(Number(p) / 18480000000).toBeCloseTo(1, 3);
  });

  it("matches PriceLib.t.sol test_twapPrice: tick -6932 over 1800 s is about $200", () => {
    const p = twapPrice8([0n, -6932n * 1800n], 1800);
    expect(p).not.toBeNull();
    expect(Number(p) / 200e8).toBeCloseTo(1, 2);
  });

  it("rounds a negative average tick toward negative infinity, as the contract does", () => {
    expect(twapTick([0n, -7n], 2)).toBe(-4n); // -3.5 -> -4
    expect(twapTick([0n, -6n], 2)).toBe(-3n);
    expect(twapTick([0n, 7n], 2)).toBe(3n);
  });

  it("returns null for a missing window or a cut series", () => {
    expect(twapTick([0n], 1800)).toBeNull();
    expect(twapTick([0n, 1n], 0)).toBeNull();
    expect(twapPrice8([], 1800)).toBeNull();
  });

  it("computes the premium as the absolute gap over the oracle, rounded down", () => {
    expect(premiumBps(10_100n, 10_000n)).toBe(100n);
    expect(premiumBps(9_899n, 10_000n)).toBe(101n);
    expect(premiumBps(10_000n, 10_000n)).toBe(0n);
  });
});
