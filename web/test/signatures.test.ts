import { describe, expect, it } from "vitest";
import { docsData } from "@/lib/docs/generated";
import { accessLabel, errorSignature, eventSignature, findItem, functionSignature, functionSignatureParts, typeHref } from "@/lib/docs/signatures";
import type { SolFunction, SolSurface } from "@/lib/docs/sol-surface";

const s = docsData.surface;

describe("signatures from the generated surface", () => {
  it("writes functions with mutability and returns", () => {
    expect(functionSignature(findItem(s, "MandateVault", "functions", "queueMandate"))).toBe(
      "function queueMandate(Mandate m) external returns (bytes32 changeHash)",
    );
    expect(functionSignature(findItem(s, "MandateVault", "functions", "previewIntent"))).toBe(
      "function previewIntent(Intent intent) external view returns (Reason reason)",
    );
    expect(functionSignature(findItem(s, "MandateVault", "functions", "spentOnDay"))).toBe(
      "function spentOnDay(uint256 utcDay) public view returns (uint256)",
    );
  });

  it("writes events with indexed params, and errors", () => {
    expect(eventSignature(findItem(s, "MandateVault", "events", "Decision"))).toBe(
      "event Decision(bytes32 indexed intentId, Action action, address indexed token, uint256 amount, bool allowed, Reason reason, bytes32 rationaleHash)",
    );
    expect(errorSignature(findItem(s, "MandateVault", "errors", "ChangeNotReady"))).toBe(
      "error ChangeNotReady(bytes32 changeHash, uint256 eta)",
    );
  });

  it("splits a signature into parts that join to it, each type a part of its own that links only for a Types.sol type", () => {
    const parts = functionSignatureParts(findItem(s, "MandateVault", "functions", "queueTokenConfig"));
    expect(parts.map((p) => p.text).join("")).toBe(functionSignature(findItem(s, "MandateVault", "functions", "queueTokenConfig")));
    const types = parts.filter((p) => p.type).map((p) => p.text);
    expect(types).toEqual(["address", "TokenConfig", "bytes32"]);
    expect(types.map((t) => typeHref(s, t))).toEqual([null, "/docs/reference/types#tokenconfig", null]);
    expect(typeHref(s, "SessionMode")).toBe("/docs/reference/types#sessionmode");
    expect(typeHref(s, "IERC20Minimal")).toBeNull();
  });

  it("labels access and names a missing item", () => {
    expect(accessLabel("owner")).toBe("Owner only");
    expect(accessLabel("activePool")).toBe("Active pool only");
    expect(accessLabel("anyone")).toBe("Anyone");
    expect(() => findItem(s, "MandateVault", "functions", "rugPull")).toThrow("MandateVault has no function named rugPull");
    expect(() => findItem(s, "Nope", "events", "X")).toThrow("contract Nope is not in");
  });

  it("refuses a name that matches two items, instead of picking the first", () => {
    const fn: SolFunction = {
      name: "dup",
      kind: "function",
      visibility: "external",
      params: [],
      returns: [],
      mutability: "nonpayable",
      access: "anyone",
      notice: "",
      selector: "0x00000000",
    };
    const twice: SolSurface = {
      contracts: [{ name: "C", kind: "contract", file: "contracts/src/C.sol", notice: "", functions: [fn, { ...fn, params: [{ type: "uint256", name: "a" }] }], events: [], errors: [] }],
      enums: [],
      structs: [],
    };
    expect(() => findItem(twice, "C", "functions", "dup")).toThrow("C has more than one function named dup");
  });
});
