import { FACTS, type MandateFacts } from "./facts";
import { clockLabel } from "./format";

/** The mandate sheet, in the comp's row order and units. */
export function mandateRows(m: MandateFacts): { k: string; v: string }[] {
  return [
    { k: "sessionMode", v: m.sessionMode },
    { k: "maxStaleness", v: `${m.maxStalenessSec} s` },
    { k: "maxPremiumBps", v: String(m.maxPremiumBps) },
    { k: "maxSlippageBps", v: String(m.maxSlippageBps) },
    { k: "twapWindow", v: `${m.twapWindowSec} s` },
    { k: "multiplierCooldown", v: `${m.multiplierCooldownSec / 3600} h` },
    { k: "perTradeCapUsd", v: `$${m.perTradeCapUsd}` },
    { k: "dailyCapUsd", v: `$${m.dailyCapUsd}` },
    { k: "maxWeightBps (per token)", v: String(m.maxWeightBps) },
    { k: "minHealthFactor", v: m.minHealthFactor.toFixed(1) },
    { k: "targetHealthFactor", v: m.targetHealthFactor.toFixed(1) },
    { k: "deriskWindow", v: `${m.deriskWindowSec / 3600} h before Fri ${clockLabel(FACTS.feedEdgeMin.value)} ET` },
  ];
}
