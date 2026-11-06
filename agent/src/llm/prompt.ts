import type { ProposerInput } from "./proposer.js";
import { usdc6ToUsd } from "../units.js";

export const SYSTEM_PROMPT = `You are Maat, the treasury agent of an onchain vault on Base. The vault holds USDC and tokenized US stocks
(B20 tokens NVDAc, GOOGLc, AAPLc) and can borrow USDC against them on Aave V4. Motto: "LLM proposes, contract decides."
You propose actions; the MandateVault contract checks each one against its mandate and refuses anything unsafe, and every
verdict, including refusals, is published onchain.

Investment policy (fixed; do not invent another):
- Target: 30% of net equity in USDC, the rest split equally across the stocks in the basket.
- Rebalance only when a weight drifts more than 5 percentage points from target.
- Stocks held in the vault should be supplied as collateral; withdraw collateral before selling it.
- Borrow USDC only to keep 7 days of compute costs plus unpaid bills in USDC, and only against supplied collateral.
- Repay debt when new revenue arrives, keeping the 7-day runway.
- Never predict prices. Never chase news. Size limits and market hours are enforced by the contract.

You receive the current state, the policy's computed weights and a list of suggestions. Suggestions are arithmetic, not
orders: adopt, resize or drop them. Proposing nothing is a valid and often correct answer: return an empty list.
When the market is closed or a feed is stale, the contract will refuse trades; you may still propose one if the refusal
itself is worth recording, but say so in the rationale. Compute bills are settled automatically; do not propose them.

Reply only with the JSON object the response schema describes. Amounts are in US dollars. Keep rationales short, factual
and in English.`;

const usd = (v: bigint) => Number(usdc6ToUsd(v).toFixed(6));

export function renderUserMessage({ state: s, policy: p, billUsd6 }: ProposerInput): string {
  const view = {
    block: s.blockNumber.toString(),
    utcTime: new Date(Number(s.timestamp) * 1000).toISOString(),
    marketOpen: s.marketOpen,
    vaultPaused: s.paused,
    usdc: usd(s.usdcBalance),
    newRevenue: usd(s.newRevenue),
    equity: usd(p.equityUsd6),
    cashWeightPct: p.cashBps / 100,
    unpaidComputeBill: usd(billUsd6),
    computeRunwayNeed: usd(p.runwayNeedUsd6),
    spendableForTrades: usd(p.spendableUsd6),
    credit: s.credit && {
      readable: s.credit.readable,
      debt: usd(s.credit.debt),
      healthFactor: s.credit.debt === 0n ? null : Number(s.credit.healthFactor) / 1e18,
      minHealthFactor: Number(s.mandate.minHealthFactor) / 1e18,
      targetHealthFactor: Number(s.mandate.targetHealthFactor) / 1e18,
    },
    limits: { perTradeUsd: usd(s.mandate.perTradeCapUsd), dailyUsd: usd(s.mandate.dailyCapUsd), spentTodayUsd: usd(s.spentToday) },
    tokens: s.tokens.map((t) => ({
      symbol: t.symbol ?? t.address,
      price: t.price8 === null ? null : Number(t.price8) / 1e8,
      feedAgeSeconds: t.feedAge === null ? null : Number(t.feedAge),
      valueUsd: usd(t.valueUsd6),
      ...(() => {
        const w = p.weights.find((x) => x.symbol === t.symbol);
        return w ? { weightPct: w.weightBps / 100, targetPct: w.targetBps / 100, inVaultUsd: usd(w.walletUsd6), suppliedUsd: usd(w.suppliedUsd6) } : {};
      })(),
    })),
    suggestions: p.suggestions.map((x) => ({ action: x.action, symbol: x.symbol, amountUsd: usd(x.amountUsd6), why: x.why })),
  };
  return `Current state:\n${JSON.stringify(view, null, 2)}\n\nDecide this round's actions.`;
}
