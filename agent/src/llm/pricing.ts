export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Cents per million tokens (claude-api skill model table, cached 2026-10-06). Cache write = 1.25 x input (5 min TTL). */
const CENTS: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 },
  "claude-opus-5-5": { input: 400, output: 2000, cacheRead: 20, cacheWrite: 500 },
};
const FALLBACK = CENTS["claude-opus-5-5"]!;

/** $X per million tokens = X micro-dollars per token, so usd6 = tokens x cents / 100, rounded up. */
export function costUsd6(model: string, u: Usage): bigint {
  const p = CENTS[model] ?? FALLBACK;
  const cents =
    BigInt(u.input_tokens) * BigInt(p.input) +
    BigInt(u.output_tokens) * BigInt(p.output) +
    BigInt(u.cache_read_input_tokens ?? 0) * BigInt(p.cacheRead) +
    BigInt(u.cache_creation_input_tokens ?? 0) * BigInt(p.cacheWrite);
  return (cents + 99n) / 100n;
}
