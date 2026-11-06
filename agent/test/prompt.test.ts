import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { renderUserMessage, SYSTEM_PROMPT } from "../src/llm/prompt.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";

describe("prompt", () => {
  it("system prompt carries the mandate rules and stays free of volatile data", () => {
    expect(SYSTEM_PROMPT).toMatch(/LLM proposes, contract decides/);
    expect(SYSTEM_PROMPT).toMatch(/empty list/i);
    expect(SYSTEM_PROMPT).toMatch(/30%/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps: keeps the cache prefix stable
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
