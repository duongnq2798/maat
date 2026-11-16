import { CreatePolicyBodySchema } from "@coinbase/cdp-sdk";
import { describe, expect, it } from "vitest";
import { executorPolicy } from "../src/exec/cdpPolicy.js";

describe("executorPolicy", () => {
  const p = executorPolicy("0x1111111111111111111111111111111111111111");
  it("is account-scoped", () => expect(p.scope).toBe("account"));
  it("is a body the SDK's createPolicy accepts", () => {
    expect(CreatePolicyBodySchema.parse(p)).toEqual(p);
  });
  it("only accepts zero-value vault calls on base", () => {
    expect(p.rules[0]).toEqual({
      action: "accept",
      operation: "sendEvmTransaction",
      criteria: [
        { type: "evmNetwork", networks: ["base"], operator: "in" },
        { type: "evmAddress", addresses: ["0x1111111111111111111111111111111111111111"], operator: "in" },
        { type: "ethValue", ethValue: "0", operator: "<=" },
      ],
    });
  });
  it("closes raw signing paths", () => {
    expect(p.rules.map((r) => r.operation)).toEqual([
      "sendEvmTransaction",
      "signEvmTransaction",
      "signEvmHash",
      "signEvmMessage",
      "signEvmTypedData",
    ]);
    expect(p.rules[2]).toEqual({ action: "reject", operation: "signEvmHash" });
    expect(p.rules[3]).toEqual({
      action: "reject",
      operation: "signEvmMessage",
      criteria: [{ type: "evmMessage", match: "[\\s\\S]*" }],
    });
    expect(p.rules[4]).toEqual({
      action: "reject",
      operation: "signEvmTypedData",
      criteria: [{ type: "evmTypedDataVerifyingContract", addresses: [], operator: "not in" }],
    });
  });
  it("matches every message, even if CDP anchors the pattern", () => {
    const rule = p.rules[3];
    if (rule?.operation !== "signEvmMessage") throw new Error("rule 3 is not the signEvmMessage rule");
    const whole = new RegExp(`^(?:${rule.criteria[0]!.match})$`);
    for (const m of ["", "hello", "line one\nline two", "0xdeadbeef"]) expect(whole.test(m)).toBe(true);
  });
});
