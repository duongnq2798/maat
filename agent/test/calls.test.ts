import { describe, expect, it } from "vitest";
import { EXECUTE_GAS_FLOOR, MAX_GAS, SYNC_GAS_FLOOR, gasLimit } from "../src/exec/calls.js";

describe("gasLimit", () => {
  it("never goes below the per-function floor", () => {
    expect(gasLimit("execute", 230_119n)).toBe(EXECUTE_GAS_FLOOR);
    expect(gasLimit("syncMultiplier", 40_000n)).toBe(SYNC_GAS_FLOOR);
  });
  it("pads a large estimate by 30%", () => {
    expect(gasLimit("execute", 2_000_000n)).toBe(2_600_000n);
    expect(gasLimit("syncMultiplier", 1_000_000n)).toBe(1_300_000n);
  });
  it("is capped at MAX_GAS", () => {
    expect(gasLimit("execute", 2_500_000n)).toBe(MAX_GAS);
    expect(gasLimit("execute", 10n ** 9n)).toBe(MAX_GAS);
  });
  it("keeps the floors below the cap", () => {
    expect(EXECUTE_GAS_FLOOR).toBe(2_500_000n);
    expect(SYNC_GAS_FLOOR).toBe(300_000n);
    expect(MAX_GAS).toBe(3_000_000n);
  });
});
