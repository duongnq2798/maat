import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { BASKET } from "../addresses.js";
import type { MarketState } from "../chain/market.js";
import { PRICE_DECIMALS } from "../chain/priceMath.js";
import { SESSION_MODES } from "../types.js";
import { USDC_DECIMALS } from "../units.js";
import type { NavQuote } from "./coinbase.js";
import type { Verdict } from "./verdict.js";

/** A basket symbol (any case) or address. Anything else is not served: the guard only knows Maat's vault tokens. */
export function resolveToken(param: string): Address | null {
  if (isAddress(param, { strict: false })) {
    const a = getAddress(param);
    return BASKET.some((t) => getAddress(t.address) === a) ? a : null;
  }
  const t = BASKET.find((b) => b.symbol.toLowerCase() === param.toLowerCase());
  return t ? getAddress(t.address) : null;
}

/** JSON.stringify with bigints as decimal strings: JSON numbers lose precision past 2^53. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

const usd8 = (v: bigint) => formatUnits(v, PRICE_DECIMALS);

export function stateView(s: MarketState, nav: NavQuote | null) {
  return {
    token: s.token,
    symbol: s.symbol ?? null,
    block: s.block,
    timestamp: s.timestamp,
    marketStatus: s.marketOpen === null ? "UNKNOWN" : s.marketOpen ? "OPEN" : "CLOSED",
    sessionMode: SESSION_MODES[s.sessionMode] ?? s.sessionMode,
    paused: s.tokenPaused,
    chainlink: s.oracle && { price: usd8(s.oracle.price8), updatedAt: s.oracle.updatedAt, ageSeconds: s.oracle.age },
    dexTwap: s.dex && { price: usd8(s.dex.price8), tick: s.dex.tick, windowSeconds: s.limits.twapWindow },
    premiumBps: s.premiumBps,
    multiplier: {
      current: s.multiplier.current,
      lastSeenByVault: s.multiplier.last,
      changedAt: s.multiplier.changedAt,
      effectiveAt: s.multiplier.effectiveAt,
      pendingUpdate: s.multiplier.effectiveAt === null || s.multiplier.effectiveAt > s.timestamp,
    },
    policyIds: s.policyIds,
    pool: {
      address: s.pool,
      stock: s.reserves.stock === null ? null : formatUnits(s.reserves.stock, s.decimals),
      usdc: s.reserves.usdc === null ? null : formatUnits(s.reserves.usdc, USDC_DECIMALS),
    },
    nav: nav && { price: nav.navPrice, updatedAt: nav.navUpdatedAt, multiplier: nav.multiplier, source: "api.coinbase.com" },
    limits: s.limits,
  };
}

export function verdictView(s: MarketState, v: Verdict) {
  return {
    token: s.token,
    symbol: s.symbol ?? null,
    side: v.side,
    sizeUSD: formatUnits(v.sizeUsd6, USDC_DECIMALS),
    reason: v.reason,
    ok: v.ok,
    block: s.block,
    timestamp: s.timestamp,
    feedAgeSeconds: s.oracle?.age ?? null,
    chainlinkPrice: s.oracle ? usd8(s.oracle.price8) : null,
    dexTwapPrice: s.dex ? usd8(s.dex.price8) : null,
    premiumBps: s.premiumBps,
    sizeShareBps: v.sizeShareBps,
    policyRestricted: v.policyRestricted,
    multiplierPending: v.multiplierPending,
    limits: s.limits,
  };
}
