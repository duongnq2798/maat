import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { renderUserMessage, SYSTEM_PROMPT, systemPrompt } from "../src/llm/prompt.js";
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
    const msg = renderUserMessage({ state, policy, billUsd6: 120_000n, creditActions: false });
    expect(msg).toContain('"usdc": 100');
    expect(msg).toContain('"marketOpen": true');
    expect(msg).toContain('"unpaidComputeBill": 0.12');
    expect(msg).toContain('"NVDAc"');
    expect(msg).toContain('"suggestions"');
    expect(msg).toContain('"creditActions": "off"');
    expect(msg).not.toMatch(/\d+n\b/); // no raw bigint leakage
  });

  describe("credit actions", () => {
    const off = systemPrompt({ creditActions: false });
    const on = systemPrompt({ creditActions: true });
    const creditPolicy = [
      "Stocks held in the vault should be supplied as collateral",
      "Borrow USDC only to keep 7 days of compute costs",
      "Repay debt when new revenue arrives",
      "can borrow USDC against them on Aave V4",
    ];

    it("off (the default prompt): says so, names every credit action, and drops the supply, borrow and repay policy", () => {
      expect(SYSTEM_PROMPT).toBe(off);
      expect(off).toContain("has an Aave V4 credit line, which is switched off");
      expect(off).toContain("Credit actions are off: never propose SUPPLY, WITHDRAW_COLLATERAL, BORROW or REPAY.");
      for (const line of creditPolicy) expect(off).not.toContain(line);
    });

    it("on: keeps the supply, borrow and repay policy, and the rest of the prompt is the same", () => {
      for (const line of creditPolicy) expect(on).toContain(line);
      expect(on).not.toContain("Credit actions are off");
      const tail = (p: string) => p.slice(p.indexOf("- Never predict prices."));
      expect(tail(on)).toBe(tail(off));
      expect(on).toContain("at most 6 intents");
    });

    it("the user message says whether credit actions are on", async () => {
      const state = await readVaultState(standardScene().client(), VAULT);
      const policy = evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n });
      expect(renderUserMessage({ state, policy, billUsd6: 0n, creditActions: true })).toContain('"creditActions": "on"');
    });
  });
});
