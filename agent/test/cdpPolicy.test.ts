import { describe, expect, it } from "vitest";
import { executorPolicy } from "../src/exec/cdpPolicy.js";

describe("executorPolicy", () => {
  const p = executorPolicy("0x1111111111111111111111111111111111111111");
  it("is account-scoped", () => expect(p.scope).toBe("account"));
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
    expect(p.rules.map((r) => (r as { operation: string }).operation)).toEqual(["sendEvmTransaction", "signEvmTransaction", "signEvmHash"]);
    expect(p.rules[2]).toEqual({ action: "reject", operation: "signEvmHash" });
  });
});
