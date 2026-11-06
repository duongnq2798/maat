import type { PreviewResult } from "./chain/preview.js";
import type { ReasonName } from "./types.js";

/** Refusals worth one onchain Decision log per UTC day: the market-safety story (spec §3.5 step 3). */
export const LOGGABLE_REASONS: ReadonlySet<ReasonName> = new Set<ReasonName>([
  "MARKET_CLOSED",
  "FEED_STALE",
  "BAD_PRICE",
  "MULTIPLIER_COOLDOWN",
  "PREMIUM_TOO_HIGH",
  "TOKEN_PAUSED",
  "POLICY_BLOCKED",
  "SIZE_LIMIT",
  "CONCENTRATION",
  "HEALTH_FACTOR_LOW",
  "DERISK_WINDOW",
]);

export type Gate = { send: true; kind: "execute" | "log-refusal" } | { send: false; why: string };

export function gate(preview: PreviewResult, alreadyLogged: boolean): Gate {
  if (preview === "OK") return { send: true, kind: "execute" };
  if (preview === "UNKNOWN") return { send: false, why: "guard state unknown (RPC)" };
  if (!LOGGABLE_REASONS.has(preview)) return { send: false, why: `${preview} not worth a log tx` };
  return alreadyLogged ? { send: false, why: `${preview} already logged today` } : { send: true, kind: "log-refusal" };
}
