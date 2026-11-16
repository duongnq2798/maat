import { describe, expect, it } from "vitest";
import { dashedModelId, dottedModelId } from "../src/llm/modelId.js";

describe("model ids", () => {
  it("writes the Claude API's dashed version in Bankr's dotted form", () => {
    expect(dottedModelId("claude-sonnet-5-5")).toBe("claude-sonnet-5.5");
    expect(dottedModelId("claude-opus-5-5")).toBe("claude-opus-5.5");
    expect(dottedModelId("claude-opus-4-8")).toBe("claude-opus-4.8");
  });
  it("reads Bankr's dotted version back in the dashed form", () => {
    expect(dashedModelId("claude-sonnet-5.5")).toBe("claude-sonnet-5-5");
    expect(dashedModelId("claude-opus-5.5")).toBe("claude-opus-5-5");
    expect(dashedModelId("claude-opus-4.8")).toBe("claude-opus-4-8");
  });
  it("leaves a model with no minor version, an id already in the target form and any other name alone", () => {
    for (const id of ["claude-sonnet-5", "claude-x", "claude-haiku-4-5-20251001"]) {
      expect(dottedModelId(id)).toBe(id);
      expect(dashedModelId(id)).toBe(id);
    }
    expect(dottedModelId("claude-sonnet-5.5")).toBe("claude-sonnet-5.5");
    expect(dashedModelId("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
  });
  it("round-trips", () => {
    for (const id of ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-opus-4-8"]) expect(dashedModelId(dottedModelId(id))).toBe(id);
  });
});
