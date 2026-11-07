import { describe, expect, it } from "vitest";
import type { MarketState } from "../src/chain/market.js";
import { marketReason, multiplierBlocked, verdict } from "../src/guard/verdict.js";

const NOW = 1_794_000_000n;
const DAY = 86_400n;

function state(over: Partial<MarketState> = {}): MarketState {
  return {
    block: 100n,
    timestamp: NOW,
    token: "0xb20000000000000000000078ee7ce2fE4908108C",
    symbol: "NVDAc",
    decimals: 8,
    feed: "0x7777777777777777777777777777777777777771",
    pool: "0x8888888888888888888888888888888888888888",
    allowed: true,
    vaultPaused: false,
    sessionMode: 0,
    marketOpen: true,
    tokenPaused: false,
    oracle: { price8: 20_000_000_000n, updatedAt: NOW - 30n, age: 30n },
    dex: { tick: -6932, price8: 20_100_000_000n },
    premiumBps: 50n,
    multiplier: { current: 10n ** 18n, last: 10n ** 18n, changedAt: 0n, effectiveAt: 0n },
    policyIds: { sender: 0n, receiver: 0n, executor: 0n },
    reserves: { stock: 5_000_000_000n, usdc: 10_000_000_000n }, // 50 shares at $200 = $10k, and $10k of USDC
    limits: { maxStaleness: 3600, twapWindow: 1800, maxPremiumBps: 100, multiplierCooldown: 86400 },
    ...over,
  };
}
const mult = (m: Partial<MarketState["multiplier"]>) => state({ multiplier: { ...state().multiplier, ...m } });

describe("marketReason", () => {
  it("is OK on a healthy market", () => {
    expect(marketReason(state())).toBe("OK");
  });

  it("follows the order of GuardLib.checkMarket", () => {
    const allWrong = state({
      tokenPaused: true,
      marketOpen: false,
      oracle: null,
      dex: null,
      premiumBps: null,
      multiplier: { current: 2n, last: 1n, changedAt: NOW, effectiveAt: NOW + 1n },
    });
    expect(marketReason(allWrong)).toBe("TOKEN_PAUSED");
    expect(marketReason({ ...allWrong, tokenPaused: false })).toBe("MARKET_CLOSED");
    expect(marketReason({ ...allWrong, tokenPaused: false, marketOpen: true })).toBe("BAD_PRICE");
    const stale = state({ oracle: { price8: 1n, updatedAt: NOW - 3601n, age: 3601n }, multiplier: allWrong.multiplier });
    expect(marketReason(stale)).toBe("FEED_STALE");
    expect(marketReason({ ...stale, oracle: state().oracle })).toBe("MULTIPLIER_COOLDOWN");
    expect(marketReason(state({ dex: null, premiumBps: null }))).toBe("BAD_PRICE");
    expect(marketReason(state({ premiumBps: 101n }))).toBe("PREMIUM_TOO_HIGH");
  });

  it("fails closed on unreadable pause and calendar reads", () => {
    expect(marketReason(state({ tokenPaused: null }))).toBe("TOKEN_PAUSED");
    expect(marketReason(state({ marketOpen: null }))).toBe("MARKET_CLOSED");
  });

  it("accepts values exactly at the limits", () => {
    expect(marketReason(state({ oracle: { price8: 1n, updatedAt: NOW - 3600n, age: 3600n } }))).toBe("OK");
    expect(marketReason(state({ premiumBps: 100n }))).toBe("OK");
  });
});

describe("multiplierBlocked (GuardLib.multiplierBlocked)", () => {
  it("blocks a multiplier that moved away from the last value the vault saw, or cannot be read", () => {
    expect(multiplierBlocked(mult({ current: 10n ** 18n + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ current: null }))).toBe(true);
    expect(multiplierBlocked(mult({ last: 0n, current: null }))).toBe(false); // last = 0 skips the comparison
  });

  it("blocks inside the cooldown after the vault saw a change", () => {
    expect(multiplierBlocked(mult({ changedAt: NOW - DAY + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ changedAt: NOW - DAY }))).toBe(false);
  });

  it("blocks a scheduled update and the cooldown after it", () => {
    expect(multiplierBlocked(mult({ effectiveAt: NOW + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ effectiveAt: NOW - DAY + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ effectiveAt: NOW - DAY }))).toBe(false);
    expect(multiplierBlocked(mult({ effectiveAt: null }))).toBe(true);
  });
});

describe("verdict", () => {
  it("sizes a BUY against the stock in the pool and a SELL against its USDC", () => {
    expect(verdict(state(), "BUY", 1_000_000_000n).sizeShareBps).toBe(1000n); // $1k of $10k of stock
    expect(verdict(state(), "SELL", 2_500_000_000n).sizeShareBps).toBe(2500n);
  });

  it("reports a size larger than the pool instead of refusing", () => {
    const v = verdict(state(), "SELL", 20_000_000_000n);
    expect(v.sizeShareBps).toBe(20_000n);
    expect(v.reason).toBe("OK");
  });

  it("leaves sizeShareBps null when the reserve is unknown or empty", () => {
    expect(verdict(state({ reserves: { stock: null, usdc: 0n } }), "BUY", 1n).sizeShareBps).toBeNull();
    expect(verdict(state({ reserves: { stock: null, usdc: 0n } }), "SELL", 1n).sizeShareBps).toBeNull();
    expect(verdict(state({ oracle: null }), "BUY", 1n).sizeShareBps).toBeNull();
  });

  it("reports policy restrictions and pending multiplier updates without refusing on them", () => {
    const v = verdict(state({ policyIds: { sender: 0n, receiver: 7n, executor: 0n } }), "BUY", 1n);
    expect(v.policyRestricted).toBe(true);
    expect(v.reason).toBe("OK");
    expect(verdict(state({ policyIds: { sender: null, receiver: 0n, executor: 0n } }), "BUY", 1n).policyRestricted).toBe(true);
    expect(verdict(state(), "BUY", 1n).multiplierPending).toBe(false);
    expect(verdict(mult({ effectiveAt: NOW + 10n }), "BUY", 1n).multiplierPending).toBe(true);
  });
});
