import { describe, expect, it } from "vitest";
import { bps, maxBig, minBig, rawForUsd6, usdToUsdc6, usdc6ToUsd, valueUsd6 } from "../src/units.js";

// NVDA feed at BLOCK_SESSION (contracts/script/BaseAddresses.sol): 186.67486580, 8 decimals. B20 decimals = 8.
const NVDA_PRICE8 = 18667486580n;

describe("units", () => {
  it("converts dollars to USDC units without float drift", () => {
    expect(usdToUsdc6(20)).toBe(20_000_000n);
    expect(usdToUsdc6(0.29)).toBe(290_000n);
    expect(usdToUsdc6(1.0000004)).toBe(1_000_000n);
    expect(usdc6ToUsd(176_999_999n)).toBeCloseTo(176.999999, 6);
  });
  it("rejects negative or non-finite dollars", () => {
    expect(() => usdToUsdc6(-1)).toThrow();
    expect(() => usdToUsdc6(Number.NaN)).toThrow();
  });
  it("matches MandateVault._valueUsd", () => {
    expect(valueUsd6(100_000_000n, NVDA_PRICE8, 8)).toBe(186_674_865n); // 1 NVDAc
    expect(valueUsd6(10_704_275n, NVDA_PRICE8, 8)).toBe(19_982_190n); // fork: $20 bought this much
  });
  it("inverts valueUsd6 to at most one unit below", () => {
    const raw = rawForUsd6(20_000_000n, NVDA_PRICE8, 8);
    expect(raw).toBe(10_713_815n);
    expect(valueUsd6(raw, NVDA_PRICE8, 8)).toBe(19_999_999n);
  });
  it("computes basis points and handles a zero whole", () => {
    expect(bps(2_500n, 10_000n)).toBe(2500);
    expect(bps(1n, 0n)).toBe(0);
  });
  it("min and max over bigints", () => {
    expect(minBig(5n, 2n, 9n)).toBe(2n);
    expect(maxBig(5n, 2n, 9n)).toBe(9n);
  });
});
