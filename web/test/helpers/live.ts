import { type Hex, NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import { type CallResult, word } from "@/lib/live/abi";
import { decodeSnapshot } from "@/lib/live/snapshot";

/** The calls the multicall makes per token, after the block number and the timestamp, in buildCalls order. */
export const SLOTS = ["isPaused", "uiMultiplier", "effectiveAt", "latestRoundData", "observe"] as const;
export type Slot = (typeof SLOTS)[number];

/** Where one token's call sits in the multicall's results. */
export function slotIndex(symbol: string, slot: Slot): number {
  const i = NAV_TOKENS.findIndex((t) => t.symbol === symbol);
  if (i < 0) throw new Error(`no NAV token ${symbol}`);
  return 2 + i * SLOTS.length + SLOTS.indexOf(slot);
}

/** The same answer with one token's call failed, the way aggregate3 reports a call that reverted. */
export function failSlot(r: CallResult[], symbol: string, slot: Slot): CallResult[] {
  const out = [...r];
  out[slotIndex(symbol, slot)] = { success: false, returnData: "0x" };
  return out;
}

/** A latestRoundData answer: (roundId, answer, startedAt, updatedAt, answeredInRound). */
export function roundData(answer: bigint, updatedAt: bigint): Hex {
  return `0x${word(1n)}${word(answer)}${word(updatedAt)}${word(updatedAt)}${word(1n)}`;
}

/**
 * The same answer with each basket token's feed answering its pool's TWAP 10 s before the block, so in session, with the
 * token unpaused and its multiplier unchanged, every market check passes and the default mandate refuses none of them.
 */
export function passingBasket(r: CallResult[]): CallResult[] {
  const s = decodeSnapshot(r, FACTS.mandate.value.twapWindowSec);
  const out = [...r];
  for (const symbol of FACTS.basket.value) {
    const twap = s.tokens.find((t) => t.symbol === symbol)?.twap8;
    if (twap === null || twap === undefined) throw new Error(`${symbol} has no TWAP to price its feed at`);
    out[slotIndex(symbol, "latestRoundData")] = { success: true, returnData: roundData(twap, BigInt(s.timestamp - 10)) };
  }
  return out;
}
