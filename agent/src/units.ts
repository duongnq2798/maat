import { parseUnits } from "viem";

export const USDC_DECIMALS = 6;

/** Dollars (a JS number from the LLM or config) to USDC units, rounded to the nearest micro-dollar. */
export function usdToUsdc6(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid dollar amount ${usd}`);
  return parseUnits(usd.toFixed(USDC_DECIMALS), USDC_DECIMALS);
}

export function usdc6ToUsd(v: bigint): number {
  return Number(v) / 10 ** USDC_DECIMALS;
}

/** Mirrors MandateVault._valueUsd: raw stock units x 8-decimal price -> USDC units, truncating. */
export function valueUsd6(raw: bigint, price8: bigint, decimals: number): bigint {
  return (raw * price8) / 10n ** BigInt(decimals + 2);
}

/** Raw stock units worth at most `usd6` at `price8`. */
export function rawForUsd6(usd6: bigint, price8: bigint, decimals: number): bigint {
  if (price8 <= 0n) return 0n;
  return (usd6 * 10n ** BigInt(decimals + 2)) / price8;
}

export function bps(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10_000n) / whole);
}

export function minBig(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b < a ? b : a));
}

export function maxBig(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b > a ? b : a));
}
