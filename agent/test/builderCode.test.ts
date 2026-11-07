import { concat, size } from "viem";
import { describe, expect, it } from "vitest";
import { builderSuffix, codesIn, withSuffix } from "../src/exec/builderCode.js";
import { encodeSyncMultiplier } from "../src/exec/calls.js";

const VECTOR = "0x62635f61316232633364340b0080218021802180218021802180218021";

describe("builder code", () => {
  it("matches the ERC-8021 schema-0 test vector", () => {
    expect(builderSuffix("bc_a1b2c3d4")).toBe(VECTOR);
    expect(size(VECTOR)).toBe(29);
  });
  it("rejects codes the registry would reject", () => {
    expect(() => builderSuffix("BC_UPPER")).toThrow(/invalid builder code/);
    expect(() => builderSuffix("")).toThrow(/invalid builder code/);
    expect(() => builderSuffix("a".repeat(33))).toThrow(/invalid builder code/);
    expect(() => builderSuffix("bc_a,b")).toThrow(/invalid builder code/);
  });
  it("round-trips through calldata", () => {
    const data = encodeSyncMultiplier("0xb20000000000000000000078ee7ce2fE4908108C");
    const tagged = withSuffix(data, builderSuffix("bc_a1b2c3d4"));
    expect(tagged).toBe(concat([data, VECTOR]));
    expect(codesIn(tagged)).toEqual(["bc_a1b2c3d4"]);
  });
  it("finds no code in plain calldata", () => {
    expect(codesIn(encodeSyncMultiplier("0xb20000000000000000000078ee7ce2fE4908108C"))).toEqual([]);
    expect(codesIn("0x")).toEqual([]);
  });
});
