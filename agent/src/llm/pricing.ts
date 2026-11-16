export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
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
