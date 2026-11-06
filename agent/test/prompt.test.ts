import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { renderUserMessage, SYSTEM_PROMPT } from "../src/llm/prompt.js";
import { BatchSchema, MAX_AMOUNT_USD, MAX_INTENTS, MAX_RATIONALE_CHARS, MAX_SUMMARY_CHARS } from "../src/llm/schema.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";

describe("prompt", () => {
  it("system prompt carries the mandate rules and stays free of volatile data", () => {
    expect(SYSTEM_PROMPT).toMatch(/LLM proposes, contract decides/);
    expect(SYSTEM_PROMPT).toMatch(/empty list/i);
    expect(SYSTEM_PROMPT).toMatch(/30%/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps: keeps the cache prefix stable
  });
  it("states the limits the zod schema enforces", () => {
    expect([MAX_INTENTS, MAX_RATIONALE_CHARS, MAX_SUMMARY_CHARS, MAX_AMOUNT_USD]).toEqual([6, 600, 1200, 1_000_000]);
    expect(SYSTEM_PROMPT).toContain("at most 6 intents");
    expect(SYSTEM_PROMPT).toContain("at most 600 characters");
    expect(SYSTEM_PROMPT).toContain("at most 1200 characters");
    const ok = { action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "x".repeat(MAX_RATIONALE_CHARS) };
    expect(BatchSchema.safeParse({ summary: "s".repeat(MAX_SUMMARY_CHARS), intents: Array(MAX_INTENTS).fill(ok) }).success).toBe(true);
    expect(BatchSchema.safeParse({ summary: "s", intents: [{ ...ok, rationale: "x".repeat(MAX_RATIONALE_CHARS + 1) }] }).success).toBe(false);
    expect(BatchSchema.safeParse({ summary: "s".repeat(MAX_SUMMARY_CHARS + 1), intents: [] }).success).toBe(false);
  });
  it("user message shows state, weights, suggestions and the bill in dollars", async () => {
    const state = await readVaultState(standardScene().client(), VAULT);
    const policy = evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 120_000n });
    const msg = renderUserMessage({ state, policy, billUsd6: 120_000n });
    expect(msg).toContain('"usdc": 100');
    expect(msg).toContain('"marketOpen": true');
    expect(msg).toContain('"unpaidComputeBill": 0.12');
    expect(msg).toContain('"NVDAc"');
    expect(msg).toContain('"suggestions"');
    expect(msg).not.toMatch(/\d+n\b/); // no raw bigint leakage
  });
});
