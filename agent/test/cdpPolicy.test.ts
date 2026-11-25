import { CreatePolicyBodySchema } from "@coinbase/cdp-sdk";
import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { executorPolicy } from "../src/exec/cdpPolicy.js";

const VAULT = "0x1111111111111111111111111111111111111111";

describe("executorPolicy", () => {
  const p = executorPolicy(VAULT);
  it("is account-scoped", () => expect(p.scope).toBe("account"));
  it("is a body the SDK's createPolicy accepts", () => {
    const parsed = CreatePolicyBodySchema.safeParse(executorPolicy(VAULT));
    expect(parsed.error).toBeUndefined();
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(p); // nothing is stripped on the way to the API
  });
  it("uses the SDK schema itself, which refuses a description it cannot send", () => {
    expect(CreatePolicyBodySchema.safeParse({ ...p, description: "Maat executor: vault only" }).success).toBe(false);
  });
  it("only accepts zero-value vault calls on base", () => {
    expect(p.rules[0]).toEqual({
      action: "accept",
      operation: "sendEvmTransaction",
      criteria: [
        { type: "evmNetwork", networks: ["base"], operator: "in" },
        { type: "evmAddress", addresses: [VAULT], operator: "in" },
        { type: "ethValue", ethValue: "0", operator: "<=" },
      ],
    });
    expect(p.rules[1]).toEqual({
      action: "accept",
      operation: "signEvmTransaction",
      criteria: [
        { type: "evmAddress", addresses: [VAULT], operator: "in" },
        { type: "ethValue", ethValue: "0", operator: "<=" },
      ],
    });
  });
  it("accepts nothing but those two vault transaction paths", () => {
    const accepted = p.rules.filter((r) => r.action === "accept");
    expect(accepted.map((r) => r.operation)).toEqual(["sendEvmTransaction", "signEvmTransaction"]);
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
  });
  it("rejects message signing", () => {
    expect(p.rules[3]).toEqual({
      action: "reject",
      operation: "signEvmMessage",
      criteria: [{ type: "evmMessage", match: "[\\s\\S]*" }],
    });
  });
  it("rejects typed-data signing", () => {
    expect(p.rules[4]).toEqual({
      action: "reject",
      operation: "signEvmTypedData",
      criteria: [{ type: "evmTypedDataVerifyingContract", addresses: [zeroAddress], operator: "not in" }],
    });
  });
  it("matches every message, even if CDP anchors the pattern", () => {
    const rule = p.rules[3];
    if (rule?.operation !== "signEvmMessage") throw new Error("rule 3 is not the signEvmMessage rule");
    const whole = new RegExp(`^(?:${rule.criteria[0]!.match})$`);
    for (const m of ["", "hello", "line one\nline two", "0xdeadbeef"]) expect(whole.test(m)).toBe(true);
  });
});
