import { FACTS, type MandateFacts } from "./facts";
import { clockLabel } from "./format";

export interface MandateRow {
  /** Plain-English name for a reader who has never seen the contract. */
  label: string;
  /** The field name onchain: the Mandate struct, or TokenConfig for maxWeightBps. */
  k: string;
  v: string;
}

const bps = (n: number) => `${n} bps · ${n / 100}%`;

/** The mandate sheet, in the comp's row order and units. */
export function mandateRows(m: MandateFacts): MandateRow[] {
  return [
    { label: "Trading session", k: "sessionMode", v: m.sessionMode },
    { label: "Oldest price it will use", k: "maxStaleness", v: `${m.maxStalenessSec} s` },
    { label: "Pool price vs Chainlink", k: "maxPremiumBps", v: bps(m.maxPremiumBps) },
    { label: "Slippage per swap", k: "maxSlippageBps", v: bps(m.maxSlippageBps) },
    { label: "Pool price averaged over", k: "twapWindow", v: `${m.twapWindowSec} s` },
    { label: "Pause after a split", k: "multiplierCooldown", v: `${m.multiplierCooldownSec / 3600} h` },
    { label: "Per-trade cap", k: "perTradeCapUsd", v: `$${m.perTradeCapUsd}` },
    { label: "Daily cap", k: "dailyCapUsd", v: `$${m.dailyCapUsd}` },
    { label: "Weight per stock", k: "maxWeightBps", v: bps(m.maxWeightBps) },
    { label: "Health factor floor", k: "minHealthFactor", v: m.minHealthFactor.toFixed(1) },
    { label: "Health factor target", k: "targetHealthFactor", v: m.targetHealthFactor.toFixed(1) },
    {
      label: "De-risk before the weekend",
      k: "deriskWindow",
      v: `${m.deriskWindowSec / 3600} h before Fri ${clockLabel(FACTS.feedEdgeMin.value)} ET`,
    },
  ];
}
