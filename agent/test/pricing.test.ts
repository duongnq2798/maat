import { describe, expect, it } from "vitest";
import { costUsd6 } from "../src/llm/pricing.js";

describe("costUsd6", () => {
  it("prices sonnet 5.5", () => {
    // 10k in ($0.02) + 1k out ($0.01) = $0.03
    expect(costUsd6("claude-sonnet-5-5", { input_tokens: 10_000, output_tokens: 1_000 })).toBe(30_000n);
  });
  it("prices cache reads and writes", () => {
    expect(costUsd6("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 10_000 })).toBe(20_000n + 25_000n);
  });
  it("rounds up to the next micro-dollar", () => {
    expect(costUsd6("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1 })).toBe(1n);
  });
  it("bills an unknown model at opus prices", () => {
    expect(costUsd6("claude-x", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(4_000_000n);
  });
});
