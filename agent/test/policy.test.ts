import { describe, expect, it } from "vitest";
import { USDC } from "../src/addresses.js";
import type { TokenState, VaultState } from "../src/chain/state.js";
import { DEFAULT_POLICY, evaluatePolicy } from "../src/policy.js";
import { CREDIT_ACTIONS } from "../src/types.js";
import { MANDATE } from "./fakes/fakeChain.js";

const P = [18667486580n, 28000000000n, 27000000000n];
const SYMS = ["NVDAc", "GOOGLc", "AAPLc"] as const;

function tok(i: number, walletUsd6: bigint, suppliedUsd6 = 0n): TokenState {
  // pick raw so valueUsd6 is exact enough; the policy only reads the usd fields
  return {
    address: `0xb2${String(i).padStart(38, "0")}` as `0x${string}`,
    symbol: SYMS[i],
    decimals: 8,
    config: { allowed: true, feed: "0x0000000000000000000000000000000000000001", pool: "0x0000000000000000000000000000000000000002", maxWeightBps: 4000 },
    balance: (walletUsd6 * 10n ** 10n) / P[i]!,
    supplied: (suppliedUsd6 * 10n ** 10n) / P[i]!,
    price8: P[i]!,
    feedAge: 30n,
    roundId: 1n,
    updatedAt: 1_794_000_000n,
    twap8: P[i]!,
    uiMultiplier: 10n ** 18n,
    lastMultiplier: 10n ** 18n,
    valueUsd6: walletUsd6 + suppliedUsd6,
  };
}

function state(over: Partial<VaultState> & { tokens?: TokenState[] }): VaultState {
  const tokens = over.tokens ?? [tok(0, 0n), tok(1, 0n), tok(2, 0n)];
  const usdcBalance = over.usdcBalance ?? 100_000_000n;
  const debt = over.credit?.debt ?? 0n;
  return {
    blockNumber: 1n,
    timestamp: 1_794_000_000n,
    day: 20_763n,
    vault: "0x1111111111111111111111111111111111111111",
    usdc: USDC,
    executor: "0x2222222222222222222222222222222222222222",
    paused: false,
    usdcBalance,
    recordedUsdc: usdcBalance,
    newRevenue: 0n,
    spentToday: 0n,
    mandate: MANDATE,
    marketOpen: true,
    calendar: null,
    credit: { readable: true, debt: 0n, healthFactor: 2n ** 256n - 1n },
    ...over,
    tokens,
    equityUsd6: over.equityUsd6 ?? usdcBalance + tokens.reduce((s, t) => s + t.valueUsd6, 0n) - debt,
  };
}

const noBills = { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }; // $0.50/day -> $3.50 runway
const CREDIT_ON = { ...DEFAULT_POLICY, creditActions: true };

describe("evaluatePolicy", () => {
  it("all cash: buys each token toward 23.33%, capped by spendable cash", () => {
    const v = evaluatePolicy(state({}), noBills);
    expect(v.targetCashBps).toBe(3000);
    expect(v.weights.map((w) => w.targetBps)).toEqual([2333, 2333, 2333]);
    expect(v.runwayNeedUsd6).toBe(3_500_000n);
    const buys = v.suggestions.filter((s) => s.action === "BUY");
    expect(buys.map((b) => b.symbol)).toEqual(["NVDAc", "GOOGLc", "AAPLc"]);
    expect(buys.map((b) => b.amountUsd6)).toEqual([23_330_000n, 23_330_000n, 23_330_000n]);
    expect(v.suggestions.some((s) => s.action === "BORROW")).toBe(false);
  });

  it("caps a buy at perTradeCapUsd", () => {
    const v = evaluatePolicy(state({ usdcBalance: 1_000_000_000n }), noBills);
    expect(v.suggestions.find((s) => s.action === "BUY")?.amountUsd6).toBe(50_000_000n);
  });

  it("stops buying when spendable cash runs out", () => {
    const v = evaluatePolicy(state({ usdcBalance: 30_000_000n }), noBills);
    // spendable = 30 - 3.5 = 26.5; NVDAc deficit 7.0 (23.33% of 30), GOOGLc 7.0, AAPLc 7.0 -> all fit
    // with $10: spendable 6.5 -> NVDAc gets 2.333 (deficit), ... check the total never exceeds spendable
    const small = evaluatePolicy(state({ usdcBalance: 10_000_000n }), noBills);
    const total = small.suggestions.filter((s) => s.action === "BUY").reduce((a, s) => a + s.amountUsd6, 0n);
    expect(total).toBeLessThanOrEqual(small.spendableUsd6);
    expect(v.spendableUsd6).toBe(26_500_000n);
  });

  it("supplies wallet stock as collateral when not overweight", () => {
    const v = evaluatePolicy(state({ tokens: [tok(0, 20_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 80_000_000n }), noBills, CREDIT_ON);
    expect(v.suggestions.find((s) => s.action === "SUPPLY")).toMatchObject({ symbol: "NVDAc", amountUsd6: 20_000_000n });
  });

  it("does not suggest credit actions when the adapter is unreadable", () => {
    const v = evaluatePolicy(
      state({ tokens: [tok(0, 20_000_000n), tok(1, 0n), tok(2, 0n)], credit: { readable: false, debt: 0n, healthFactor: 0n } }),
      noBills,
      CREDIT_ON,
    );
    expect(v.suggestions.some((s) => ["SUPPLY", "BORROW", "REPAY", "WITHDRAW_COLLATERAL"].includes(s.action))).toBe(false);
  });

  it("sells an overweight wallet holding", () => {
    // NVDAc $60 of $100 equity = 60% vs 23.33% -> excess 36.67, capped at 50 -> 36.67
    const v = evaluatePolicy(state({ tokens: [tok(0, 60_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 40_000_000n }), noBills, CREDIT_ON);
    expect(v.suggestions.find((s) => s.action === "SELL")).toMatchObject({ symbol: "NVDAc", amountUsd6: 36_670_000n });
    expect(v.suggestions.some((s) => s.action === "SUPPLY" && s.symbol === "NVDAc")).toBe(false);
  });

  it("withdraws collateral first when the overweight holding is supplied", () => {
    const v = evaluatePolicy(state({ tokens: [tok(0, 0n, 60_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 40_000_000n }), noBills, CREDIT_ON);
    expect(v.suggestions.find((s) => s.action === "WITHDRAW_COLLATERAL")).toMatchObject({ symbol: "NVDAc", amountUsd6: 36_670_000n });
    expect(v.suggestions.some((s) => s.action === "SELL")).toBe(false);
  });

  it("borrows to cover the 7-day runway when collateral exists", () => {
    const v = evaluatePolicy(
      state({ tokens: [tok(0, 0n, 20_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 1_000_000n }),
      { dailyComputeUsd6: 500_000n, unpaidUsd6: 200_000n },
      CREDIT_ON,
    );
    // need 3.5 + 0.2 - 1.0 = 2.7
    expect(v.suggestions.find((s) => s.action === "BORROW")).toMatchObject({ symbol: "USDC", amountUsd6: 2_700_000n });
  });

  it("does not borrow without supplied collateral", () => {
    const v = evaluatePolicy(state({ usdcBalance: 1_000_000n }), noBills, CREDIT_ON);
    expect(v.suggestions.some((s) => s.action === "BORROW")).toBe(false);
  });

  it("repays from new revenue but keeps the runway", () => {
    const v = evaluatePolicy(
      state({ usdcBalance: 13_500_000n, newRevenue: 10_000_000n, credit: { readable: true, debt: 5_000_001n, healthFactor: 3n * 10n ** 18n }, tokens: [tok(0, 0n, 20_000_000n), tok(1, 0n), tok(2, 0n)] }),
      noBills,
      CREDIT_ON,
    );
    // spendable = 13.5 - 3.5 = 10 -> repay min(5.000001, 10)
    expect(v.suggestions[0]).toMatchObject({ action: "REPAY", symbol: "USDC", amountUsd6: 5_000_001n });
  });

  it("only suggests REPAY while the vault is paused", () => {
    const v = evaluatePolicy(
      state({ paused: true, usdcBalance: 50_000_000n, newRevenue: 10_000_000n, credit: { readable: true, debt: 5_000_000n, healthFactor: 3n * 10n ** 18n } }),
      noBills,
      CREDIT_ON,
    );
    expect(v.suggestions.map((s) => s.action)).toEqual(["REPAY"]);
  });

  it("skips tokens without a readable price", () => {
    const t = tok(1, 0n);
    t.price8 = null;
    const v = evaluatePolicy(state({ tokens: [tok(0, 0n), t, tok(2, 0n)] }), noBills);
    expect(v.suggestions.some((s) => s.symbol === "GOOGLc")).toBe(false);
  });

  it("does not supply an exit-only token (config.allowed false)", () => {
    const t = tok(0, 20_000_000n);
    t.config = { ...t.config, allowed: false };
    const v = evaluatePolicy(state({ tokens: [t, tok(1, 0n), tok(2, 0n)], usdcBalance: 80_000_000n }), noBills, CREDIT_ON);
    expect(v.suggestions.some((s) => s.action === "SUPPLY")).toBe(false);
  });

  it("does not buy an exit-only underweight token but still buys the others", () => {
    const t = tok(1, 0n);
    t.config = { ...t.config, allowed: false };
    const v = evaluatePolicy(state({ tokens: [tok(0, 0n), t, tok(2, 0n)] }), noBills);
    const buys = v.suggestions.filter((s) => s.action === "BUY").map((b) => b.symbol);
    expect(buys).toEqual(["NVDAc", "AAPLc"]);
  });

  it("ignores dust below minTradeUsd6", () => {
    const v = evaluatePolicy(state({ usdcBalance: 4_000_000n }), noBills); // spendable 0.5 -> no buys
    expect(v.suggestions.filter((s) => s.action === "BUY")).toEqual([]);
    expect(DEFAULT_POLICY.minTradeUsd6).toBe(1_000_000n);
  });

  it("orders suggestions REPAY, SUPPLY, WITHDRAW/SELL, BUY, BORROW", () => {
    const order = ["REPAY", "SUPPLY", "WITHDRAW_COLLATERAL", "SELL", "BUY", "BORROW"];
    const v = evaluatePolicy(state({ tokens: [tok(0, 10_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 90_000_000n }), noBills, CREDIT_ON);
    const idx = v.suggestions.map((s) => order.indexOf(s.action));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  describe("with credit actions off (DEFAULT_POLICY)", () => {
    const debt = { readable: true, debt: 5_000_000n, healthFactor: 3n * 10n ** 18n };
    // Each state makes the policy suggest one credit action when credit is on.
    const scenes = [
      ["SUPPLY", state({ tokens: [tok(0, 20_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 80_000_000n }), noBills],
      ["WITHDRAW_COLLATERAL", state({ tokens: [tok(0, 0n, 60_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 40_000_000n }), noBills],
      ["BORROW", state({ tokens: [tok(0, 0n, 20_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 1_000_000n }), { dailyComputeUsd6: 500_000n, unpaidUsd6: 200_000n }],
      ["REPAY", state({ usdcBalance: 13_500_000n, newRevenue: 10_000_000n, credit: debt, tokens: [tok(0, 0n, 20_000_000n), tok(1, 0n), tok(2, 0n)] }), noBills],
      ["REPAY", state({ paused: true, usdcBalance: 50_000_000n, newRevenue: 10_000_000n, credit: debt }), noBills],
    ] as const;

    it("is the default", () => {
      expect(DEFAULT_POLICY.creditActions).toBe(false);
    });

    it.each(scenes.map((s, i) => [i, ...s] as const))("scene %i: suggests no %s, which credit on would", (_i, action, s, bills) => {
      expect(evaluatePolicy(s, bills, CREDIT_ON).suggestions.map((x) => x.action)).toContain(action);
      const off = evaluatePolicy(s, bills).suggestions;
      expect(off.filter((x) => CREDIT_ACTIONS.has(x.action))).toEqual([]);
      expect(evaluatePolicy(s, bills, DEFAULT_POLICY).suggestions).toEqual(off);
    });

    it("still buys and sells", () => {
      expect(evaluatePolicy(state({}), noBills).suggestions.map((s) => s.action)).toEqual(["BUY", "BUY", "BUY"]);
      const sell = evaluatePolicy(state({ tokens: [tok(0, 60_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 40_000_000n }), noBills).suggestions;
      expect(sell.find((s) => s.action === "SELL")).toMatchObject({ symbol: "NVDAc", amountUsd6: 36_670_000n });
    });
  });
});
