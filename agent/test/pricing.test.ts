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
  it("prices Bankr's dotted model id as the dashed one", () => {
    expect(costUsd6("claude-sonnet-5.5", { input_tokens: 10_000, output_tokens: 1_000 }, "bankr")).toBe(30_000n);
    // $4 + $20 + $0.20 + $5: the opus 5.5 row, not the unknown-model rate an unread dotted id would get
    expect(costUsd6("claude-opus-5.5", MTOK_EACH, "bankr")).toBe(29_200_000n);
  });
  it("never prices a Bankr call below the Anthropic list rate, token kind by token kind", () => {
    const kinds = [
      { input_tokens: 1_000_000, output_tokens: 0 },
      { input_tokens: 0, output_tokens: 1_000_000 },
      { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 },
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 },
    ];
    for (const u of kinds) for (const m of [...KNOWN, "claude-x"]) expect(costUsd6(m, u, "bankr")).toBeGreaterThanOrEqual(costUsd6(m, u, "anthropic"));
  });
});

describe("costUsd6 with usage.iterations", () => {
  const tokens = (input: number, output: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

  it("sums every attempt at its own model and ignores the top-level usage", () => {
    // Opus 5.5 declined after 100 tokens ($0.042), Opus 4.8 served the message ($0.075); top-level is that last attempt.
    const u = {
      ...tokens(10_000, 1_000),
      iterations: [
        { type: "message", model: "claude-opus-5-5", ...tokens(10_000, 100) },
        { type: "fallback_message", model: "claude-opus-4-8", ...tokens(10_000, 1_000) },
      ],
    };
    expect(costUsd6("claude-opus-4-8", u)).toBe(117_000n);
  });
  it("prices an attempt without a model at the response model", () => {
    // Sonnet 5.5, not the unknown-model rate ($5)
    const u = { ...tokens(0, 0), iterations: [{ type: "message", model: null, ...tokens(1_000_000, 0) }] };
    expect(costUsd6("claude-sonnet-5-5", u)).toBe(2_000_000n);
  });
  it("prices the top-level usage when iterations is empty or null", () => {
    expect(costUsd6("claude-sonnet-5-5", { ...tokens(10_000, 1_000), iterations: [] })).toBe(30_000n);
    expect(costUsd6("claude-sonnet-5-5", { ...tokens(10_000, 1_000), iterations: null })).toBe(30_000n);
  });
});
