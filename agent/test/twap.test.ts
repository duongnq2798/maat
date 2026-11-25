import { describe, expect, it } from "vitest";
import { premiumBps, priceFromSqrt, signedPremiumBps, sqrtPriceAtTick, twapPrice8, twapTick } from "../src/chain/twap.js";

// The same vectors as web/test/live-price.test.ts, which takes them from contracts/test/PriceLib.t.sol.
describe("pool TWAP, as contracts/src/lib/PriceLib.sol computes it", () => {
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
    const p = twapPrice8({ tickCumulatives: [0n, -6932n * 1800n], window: 1800, stockIsToken0: false, stockDecimals: 8 });
    expect(p).not.toBeNull();
    expect(Number(p) / 200e8).toBeCloseTo(1, 2);
  });

  it("rounds a negative average tick toward negative infinity, as the contract does", () => {
    expect(twapTick([0n, -7n], 2)).toBe(-4n);
    expect(twapTick([0n, -6n], 2)).toBe(-3n);
    expect(twapTick([0n, 7n], 2)).toBe(3n);
  });

  it("is unavailable for a zero window, a cut series, a tick out of range or a zero price", () => {
    expect(twapTick([0n], 1800)).toBeNull();
    expect(twapTick([0n, 1n], 0)).toBeNull();
    expect(twapPrice8({ tickCumulatives: [0n, 1n], window: 0, stockIsToken0: false, stockDecimals: 8 })).toBeNull();
    expect(twapPrice8({ tickCumulatives: [0n, 887273n], window: 1, stockIsToken0: false, stockDecimals: 8 })).toBeNull();
    expect(twapPrice8({ tickCumulatives: [0n, -887272n], window: 1, stockIsToken0: true, stockDecimals: 6 })).toBeNull();
  });

  it("computes the premium as the absolute gap over the oracle, rounded down", () => {
    expect(premiumBps(10_100n, 10_000n)).toBe(100n);
    expect(premiumBps(9_899n, 10_000n)).toBe(101n);
    expect(premiumBps(10_000n, 10_000n)).toBe(0n);
  });

  it("signs the premium: positive when the pool is above the feed, null without both prices", () => {
    expect(signedPremiumBps(10_100n, 10_000n)).toBe(100);
    expect(signedPremiumBps(9_899n, 10_000n)).toBe(-101);
    expect(signedPremiumBps(10_000n, 10_000n)).toBe(0);
    expect(signedPremiumBps(null, 10_000n)).toBeNull();
    expect(signedPremiumBps(10_000n, null)).toBeNull();
    // Past 2^53 - 1 basis points the number cannot go into the blob's canonical JSON.
    expect(signedPremiumBps(2n ** 80n, 1n)).toBeNull();
  });
});
