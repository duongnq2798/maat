import { describe, expect, it } from "vitest";
import { BATCH_JSON_SCHEMA, BatchSchema, LLM_ACTIONS, LLM_SYMBOLS } from "../src/llm/schema.js";

describe("proposal schema", () => {
  it("accepts a valid batch", () => {
    const r = BatchSchema.safeParse({ summary: "hold", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "underweight" }] });
    expect(r.success).toBe(true);
  });
  it("accepts an empty batch (doing nothing is a valid answer)", () => {
    expect(BatchSchema.safeParse({ summary: "market closed, nothing to do", intents: [] }).success).toBe(true);
  });
  it("rejects PAY_EXPENSE, unknown symbols, extra keys and bad amounts", () => {
    const bad = [
      { summary: "x", intents: [{ action: "PAY_EXPENSE", symbol: "USDC", amountUsd: 1, rationale: "r" }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "AMZNc", amountUsd: 1, rationale: "r" }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "r", minOut: 5 }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: -1, rationale: "r" }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "" }] },
      { summary: "x", intents: Array(7).fill({ action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "r" }) },
    ];
    for (const b of bad) expect(BatchSchema.safeParse(b).success).toBe(false);
  });
  it("JSON schema enums match the zod enums", () => {
    const item = BATCH_JSON_SCHEMA.properties.intents.items;
    expect(item.properties.action.enum).toEqual([...LLM_ACTIONS]);
    expect(item.properties.symbol.enum).toEqual([...LLM_SYMBOLS]);
    expect(item.additionalProperties).toBe(false);
    expect(BATCH_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});
