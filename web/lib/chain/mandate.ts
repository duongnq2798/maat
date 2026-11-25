import type { MandateFacts } from "@/content/facts";
import { mandateRows, type MandateRow } from "@/content/mandate";
import type { OnchainMandate } from "./treasury";

/** enum SessionMode in contracts/src/Types.sol, in order. */
const SESSION_MODES: readonly MandateFacts["sessionMode"][] = ["REGULAR", "FEED_24_5"];
const WAD = 1e18;

/**
 * The vault's onchain mandate in the rows and units of the configured mandate sheet, so the two compare row by row.
 * The weight cap is per token onchain: `maxWeightBps` is the cap every listed token shares, or null when they differ
 * or none was read, and that row then says so.
 */
export function onchainMandateRows(m: OnchainMandate, maxWeightBps: number | null): MandateRow[] {
  const facts: MandateFacts = {
    sessionMode: SESSION_MODES[m.sessionMode] ?? (`mode ${m.sessionMode}` as MandateFacts["sessionMode"]),
    maxStalenessSec: m.maxStaleness,
    maxPremiumBps: m.maxPremiumBps,
    maxSlippageBps: m.maxSlippageBps,
    twapWindowSec: m.twapWindow,
    multiplierCooldownSec: m.multiplierCooldown,
    perTradeCapUsd: Number(m.perTradeCapUsd) / 1e6,
    dailyCapUsd: Number(m.dailyCapUsd) / 1e6,
    maxWeightBps: maxWeightBps ?? 0,
    minHealthFactor: Number(m.minHealthFactor) / WAD,
    targetHealthFactor: Number(m.targetHealthFactor) / WAD,
    deriskWindowSec: m.deriskWindow,
  };
  return mandateRows(facts).map((r) => (r.k === "maxWeightBps" && maxWeightBps === null ? { ...r, v: "set per token" } : r));
}
