import type { TokenSymbol } from "./addresses.js";
import type { VaultState } from "./chain/state.js";
import type { ActionName } from "./types.js";
import { bps, maxBig, minBig } from "./units.js";

export interface PolicyParams {
  cashReserveBps: number;
  driftBps: number;
  runwayDays: number;
  minTradeUsd6: bigint;
}

export const DEFAULT_POLICY: PolicyParams = { cashReserveBps: 3000, driftBps: 500, runwayDays: 7, minTradeUsd6: 1_000_000n };

export interface Suggestion {
  action: ActionName;
  symbol: TokenSymbol | "USDC";
  amountUsd6: bigint;
  why: string;
}

export interface WeightRow {
  symbol: TokenSymbol;
  weightBps: number;
  targetBps: number;
  driftBps: number;
  walletUsd6: bigint;
  suppliedUsd6: bigint;
}

export interface PolicyView {
  equityUsd6: bigint;
  cashBps: number;
  targetCashBps: number;
  runwayNeedUsd6: bigint;
  spendableUsd6: bigint;
  weights: WeightRow[];
  suggestions: Suggestion[];
}

const pct = (b: number) => `${(b / 100).toFixed(1)}%`;
const usd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;

export function evaluatePolicy(
  s: VaultState,
  bills: { dailyComputeUsd6: bigint; unpaidUsd6: bigint },
  params: PolicyParams = DEFAULT_POLICY,
): PolicyView {
  const equity = s.equityUsd6;
  const priced = s.tokens.filter((t): t is typeof t & { symbol: TokenSymbol } => t.symbol !== undefined);
  const targetBps = priced.length === 0 ? 0 : Math.floor((10_000 - params.cashReserveBps) / priced.length);
  const credit = s.credit !== null && s.credit.readable;

  const weights: WeightRow[] = priced.map((t) => {
    // Split the token's value between wallet and supplied collateral by raw units.
    const total = t.balance + t.supplied;
    const walletUsd6 = total === 0n ? 0n : (t.valueUsd6 * t.balance) / total;
    const suppliedUsd6 = t.valueUsd6 - walletUsd6;
    const weightBps = bps(t.valueUsd6, equity);
    return { symbol: t.symbol, weightBps, targetBps, driftBps: weightBps - targetBps, walletUsd6, suppliedUsd6 };
  });

  const runwayNeedUsd6 = BigInt(params.runwayDays) * bills.dailyComputeUsd6;
  let spendable = maxBig(0n, s.usdcBalance - bills.unpaidUsd6 - runwayNeedUsd6);
  const spendableUsd6 = spendable;
  const out: Suggestion[] = [];
  const big = (v: bigint) => v >= params.minTradeUsd6;
  const cap = s.mandate.perTradeCapUsd;
  const ofEquity = (b: number) => (BigInt(b) * equity) / 10_000n;

  // 3. REPAY
  if (credit && s.credit!.debt > 0n && s.newRevenue > 0n) {
    const amt = minBig(s.credit!.debt, spendable);
    if (big(amt)) {
      out.push({ action: "REPAY", symbol: "USDC", amountUsd6: amt, why: `new revenue ${usd(s.newRevenue)}, debt ${usd(s.credit!.debt)}` });
      spendable -= amt;
    }
  }
  if (s.paused) return view();

  // 4. SUPPLY
  if (credit) {
    for (const w of weights) {
      if (big(w.walletUsd6) && w.weightBps <= w.targetBps + params.driftBps) {
        out.push({ action: "SUPPLY", symbol: w.symbol, amountUsd6: w.walletUsd6, why: `${usd(w.walletUsd6)} of ${w.symbol} idle in the vault; use it as collateral` });
      }
    }
  }

  // 5. Rebalance down
  for (const w of weights) {
    if (w.weightBps <= w.targetBps + params.driftBps) continue;
    const excess = minBig(ofEquity(w.weightBps - w.targetBps), cap);
    const why = `${w.symbol} ${pct(w.weightBps)} vs target ${pct(w.targetBps)} (drift +${(w.driftBps / 100).toFixed(1)}pp)`;
    if (w.walletUsd6 >= excess) {
      if (big(excess)) out.push({ action: "SELL", symbol: w.symbol, amountUsd6: excess, why });
    } else if (credit && w.suppliedUsd6 > 0n) {
      const amt = minBig(excess - w.walletUsd6, w.suppliedUsd6);
      if (big(amt)) out.push({ action: "WITHDRAW_COLLATERAL", symbol: w.symbol, amountUsd6: amt, why: `${why}; withdraw before selling` });
    }
  }

  // 6. Rebalance up
  for (const w of weights) {
    const t = priced.find((p) => p.symbol === w.symbol)!;
    if (t.price8 === null || w.weightBps >= w.targetBps - params.driftBps) continue;
    const amt = minBig(ofEquity(w.targetBps - w.weightBps), cap, spendable);
    if (!big(amt)) continue;
    out.push({ action: "BUY", symbol: w.symbol, amountUsd6: amt, why: `${w.symbol} ${pct(w.weightBps)} vs target ${pct(w.targetBps)} (drift ${(w.driftBps / 100).toFixed(1)}pp)` });
    spendable -= amt;
  }

  // 7. BORROW
  const supplied = weights.reduce((a, w) => a + w.suppliedUsd6, 0n);
  const need = runwayNeedUsd6 + bills.unpaidUsd6;
  if (credit && supplied > 0n && s.usdcBalance < need) {
    const amt = need - s.usdcBalance;
    if (big(amt)) out.push({ action: "BORROW", symbol: "USDC", amountUsd6: amt, why: `USDC ${usd(s.usdcBalance)} below ${params.runwayDays}-day compute runway + bills ${usd(need)}` });
  }
  return view();

  function view(): PolicyView {
    return {
      equityUsd6: equity,
      cashBps: bps(s.usdcBalance, equity),
      targetCashBps: params.cashReserveBps,
      runwayNeedUsd6,
      spendableUsd6,
      weights,
      suggestions: out,
    };
  }
}
