import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";

const fn = (name: string) =>
  mandateVaultAbi.find((e) => e.type === "function" && e.name === name) as
    | { inputs: readonly { type: string; components?: readonly { name: string; type: string }[] }[]; outputs: readonly { type: string }[] }
    | undefined;

describe("generated MandateVault ABI", () => {
  it("execute takes the Intent tuple", () => {
    const f = fn("execute");
    expect(f?.inputs[0]?.type).toBe("tuple");
    expect(f?.inputs[0]?.components?.map((c) => `${c.name}:${c.type}`)).toEqual([
      "id:bytes32",
      "action:uint8",
      "token:address",
      "amount:uint256",
      "minOut:uint256",
      "payee:address",
      "rationaleHash:bytes32",
    ]);
    expect(f?.outputs.map((o) => o.type)).toEqual(["bool", "uint8"]);
  });
  it("previewIntent returns a Reason", () => {
    expect(fn("previewIntent")?.outputs.map((o) => o.type)).toEqual(["uint8"]);
  });
  it("has the Decision event", () => {
    expect(mandateVaultAbi.some((e) => e.type === "event" && e.name === "Decision")).toBe(true);
  });
});
