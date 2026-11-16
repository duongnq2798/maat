import { dashedModelId } from "./modelId.js";

/** Where a proposal is asked: the Claude API directly, or Bankr's LLM gateway in front of it. */
export type LlmProvider = "anthropic" | "bankr";

interface Tokens {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface Usage extends Tokens {
  /** One entry per sampling attempt, declined fallback hops included (SDK BetaIterationsUsage). */
  iterations?: readonly (Tokens & { type: string; model?: string | null })[] | null;
}

/**
 * Cents per million tokens (claude-api skill: model table cached 2026-10-06, prompt-caching economics). Cache read =
 * 0.1 x input (0.05 x on claude-opus-5-5); cache write = 1.25 x input (5 min TTL). claude-sonnet-5 and claude-opus-4-8
 * are here because the server-side fallback can answer with them.
 */
const CENTS: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 },
  "claude-sonnet-5": { input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 },
  "claude-opus-5-5": { input: 400, output: 2000, cacheRead: 20, cacheWrite: 500 },
  "claude-opus-4-8": { input: 500, output: 2500, cacheRead: 50, cacheWrite: 625 },
};
// The bill is what the vault pays back for Claude usage, so an unknown model takes the dearest row (claude-opus-4-8
// today): pricing it too low would leave the expense wallet covering the difference.
const FALLBACK = CENTS["claude-opus-4-8"]!;

const PRICES: Record<LlmProvider, typeof CENTS> = {
  anthropic: CENTS,
  // Bankr does not publish its per-token prices (GET /v1/models needs a key), so a Bankr call is booked at the
  // Anthropic list rates, never below: a conservative placeholder until the owner reconciles with Bankr's GET /v1/usage.
  bankr: CENTS,
};

function cents(table: typeof CENTS, model: string, u: Tokens): bigint {
  // Bankr answers with the dotted id (claude-sonnet-5.5); the rows are keyed by the dashed one.
  const p = table[dashedModelId(model)] ?? FALLBACK;
  return (
    BigInt(u.input_tokens) * BigInt(p.input) +
    BigInt(u.output_tokens) * BigInt(p.output) +
    BigInt(u.cache_read_input_tokens ?? 0) * BigInt(p.cacheRead) +
    BigInt(u.cache_creation_input_tokens ?? 0) * BigInt(p.cacheWrite)
  );
}

/**
 * $X per million tokens = X micro-dollars per token, so usd6 = tokens x cents / 100, rounded up. `model` is the
 * response's. With iterations, the top-level usage covers only the attempt that produced the message, so the cost
 * is the sum of the attempts, each at the model that ran it (the response's when the entry names none).
 */
export function costUsd6(model: string, u: Usage, provider: LlmProvider = "anthropic"): bigint {
  const table = PRICES[provider];
  const total = u.iterations?.length
    ? u.iterations.reduce((s, it) => s + cents(table, it.model ?? model, it), 0n)
    : cents(table, model, u);
  return (total + 99n) / 100n;
}
