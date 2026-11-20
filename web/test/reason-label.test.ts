// @vitest-environment node
import { describe, expect, it } from "vitest";
import { REASON_LABEL, REASON_MEANING, REASON_MEANING_DOCS, REASONS, reasonText } from "@/content/reasons";

// Spec 2026-11-20 section 3: one short plain label per code, shown before the code wherever a person reads a decision.
// The code strings themselves are held to Types.sol by facts.test.ts; this file holds the labels to those codes.

describe("REASON_LABEL", () => {
  it("has exactly the keys OK and REASONS, in enum order", () => {
    expect(Object.keys(REASON_LABEL)).toEqual(["OK", ...REASONS]);
  });

  it("gives each code a non-empty label of at most 32 characters with no underscore", () => {
    for (const [code, label] of Object.entries(REASON_LABEL)) {
      expect(label.trim(), code).not.toBe("");
      expect(label.length, code).toBeLessThanOrEqual(32);
      expect(label, code).not.toContain("_");
    }
  });
});

describe("reasonText", () => {
  it("puts the label first and the code in brackets", () => {
    expect(reasonText("MARKET_CLOSED")).toBe("Market closed (MARKET_CLOSED)");
    expect(reasonText("OK")).toBe("All checks passed (OK)");
  });
});

describe("REASON_MEANING", () => {
  it("gives CONCENTRATION's fail-closed case, as concepts/refusal-codes does, on the landing and in the docs table", () => {
    const meaning = "The buy would push one stock past its maximum weight, or its weight can't be measured.";
    expect(REASON_MEANING.CONCENTRATION).toBe(meaning);
    expect(REASON_MEANING_DOCS.CONCENTRATION).toBe(meaning);
  });
});
