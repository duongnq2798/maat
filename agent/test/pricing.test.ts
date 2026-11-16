import { describe, expect, it } from "vitest";
import { costUsd6 } from "../src/llm/pricing.js";

const KNOWN = ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-opus-4-8"];
const MTOK_EACH = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 };

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
  it("prices sonnet 5 and opus 4.8", () => {
    // $2 + $10 + $0.20 + $2.50, then $5 + $25 + $0.50 + $6.25
    expect(costUsd6("claude-sonnet-5", MTOK_EACH)).toBe(14_700_000n);
    expect(costUsd6("claude-opus-4-8", MTOK_EACH)).toBe(36_750_000n);
  });
  it("bills an unknown model at opus 4.8 prices", () => {
    expect(costUsd6("claude-x", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(5_000_000n);
  });
  it("never bills an unknown model below a known one, token kind by token kind", () => {
    const kinds = [
      { input_tokens: 1_000_000, output_tokens: 0 },
      { input_tokens: 0, output_tokens: 1_000_000 },
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 },
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 },
    ];
    for (const u of kinds) for (const m of KNOWN) expect(costUsd6("claude-x", u)).toBeGreaterThanOrEqual(costUsd6(m, u));
  });
});
