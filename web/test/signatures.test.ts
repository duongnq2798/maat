import { describe, expect, it } from "vitest";
import { docsData } from "@/lib/docs/generated";
import { accessLabel, errorSignature, eventSignature, findItem, functionSignature } from "@/lib/docs/signatures";

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

  it("labels access and names a missing item", () => {
    expect(accessLabel("owner")).toBe("Owner only");
    expect(accessLabel("activePool")).toBe("Active pool only");
    expect(accessLabel("anyone")).toBe("Anyone");
    expect(() => findItem(s, "MandateVault", "functions", "rugPull")).toThrow("MandateVault has no function named rugPull");
    expect(() => findItem(s, "Nope", "events", "X")).toThrow("contract Nope is not in");
  });
});
