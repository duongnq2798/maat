import type { MarketState } from "../chain/market.js";
import type { ReasonName } from "../types.js";
import { valueUsd6 } from "../units.js";

export type Side = "BUY" | "SELL";

/** The GuardLib.checkMarket reasons the paid check can return. POLICY_BLOCKED is left out: it depends on the caller. */
export type MarketReason = Extract<
  ReasonName,
  "OK" | "TOKEN_PAUSED" | "MARKET_CLOSED" | "BAD_PRICE" | "FEED_STALE" | "MULTIPLIER_COOLDOWN" | "PREMIUM_TOO_HIGH"
>;

export interface Verdict {
  reason: MarketReason;
  ok: boolean;
  side: Side;
  sizeUsd6: bigint;
  /** sizeUsd6 against what the pool holds of the side the trade takes out, in bps. Information only, never a refusal. */
  sizeShareBps: bigint | null;
  /** A non-zero (or unreadable) transfer policy id: whether the caller passes depends on the caller, so it is reported. */
  policyRestricted: boolean;
  multiplierPending: boolean;
}

/** GuardLib.multiplierBlocked on a snapshot. A null read counts as blocked, like the library's catch branches. */
export function multiplierBlocked(s: MarketState): boolean {
  const { current, last, changedAt, effectiveAt } = s.multiplier;
  const now = s.timestamp;
  const cooldown = BigInt(s.limits.multiplierCooldown);
  if (last !== 0n && (current === null || current !== last)) return true;
  if (changedAt !== 0n && now < changedAt + cooldown) return true;
  if (effectiveAt === null) return true;
  if (effectiveAt > now) return true;
  return effectiveAt !== 0n && now < effectiveAt + cooldown;
}

/** GuardLib.checkMarket in the same order, minus the transfer-path policy check. */
export function marketReason(s: MarketState): MarketReason {
  if (s.tokenPaused !== false) return "TOKEN_PAUSED";
  if (s.marketOpen !== true) return "MARKET_CLOSED";
  if (s.oracle === null) return "BAD_PRICE";
  if (s.oracle.age > BigInt(s.limits.maxStaleness)) return "FEED_STALE";
  if (multiplierBlocked(s)) return "MULTIPLIER_COOLDOWN";
  if (s.dex === null || s.premiumBps === null) return "BAD_PRICE";
  if (s.premiumBps > BigInt(s.limits.maxPremiumBps)) return "PREMIUM_TOO_HIGH";
  return "OK";
}

export function verdict(s: MarketState, side: Side, sizeUsd6: bigint): Verdict {
  const reason = marketReason(s);
  // BUY takes stock out of the pool, SELL takes USDC out.
  let outUsd6: bigint | null = null;
  if (side === "SELL") outUsd6 = s.reserves.usdc;
  else if (s.reserves.stock !== null && s.oracle !== null) outUsd6 = valueUsd6(s.reserves.stock, s.oracle.price8, s.decimals);
  const ids = s.policyIds;
  return {
    reason,
    ok: reason === "OK",
    side,
    sizeUsd6,
    sizeShareBps: outUsd6 === null || outUsd6 === 0n ? null : (sizeUsd6 * 10_000n) / outUsd6,
    policyRestricted: [ids.sender, ids.receiver, ids.executor].some((id) => id !== 0n),
    multiplierPending: s.multiplier.effectiveAt === null || s.multiplier.effectiveAt > s.timestamp,
  };
}
