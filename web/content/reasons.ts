/** enum Reason in contracts/src/Types.sol, without OK, in enum order (parity-tested). */
export const REASONS = [
  "VAULT_PAUSED",
  "ACTION_NOT_SUPPORTED",
  "TOKEN_NOT_ALLOWED",
  "TOKEN_PAUSED",
  "POLICY_BLOCKED",
  "MARKET_CLOSED",
  "FEED_STALE",
  "BAD_PRICE",
  "MULTIPLIER_COOLDOWN",
  "PREMIUM_TOO_HIGH",
  "SIZE_LIMIT",
  "CONCENTRATION",
  "PAYEE_NOT_ALLOWED",
  "INSUFFICIENT_BALANCE",
  "SWAP_FAILED",
  "TRANSFER_FAILED",
  "CREDIT_FAILED",
  "HEALTH_FACTOR_LOW",
  "DERISK_WINDOW",
] as const;

export type RefusalCode = (typeof REASONS)[number];
export type ReasonCode = "OK" | RefusalCode;

export interface ReasonGroup {
  title: string;
  codes: readonly RefusalCode[];
}

/** Grouping and order from the comp's Refusals section. */
export const REASON_GROUPS: readonly ReasonGroup[] = [
  { title: "Market", codes: ["MARKET_CLOSED", "FEED_STALE", "BAD_PRICE", "PREMIUM_TOO_HIGH", "MULTIPLIER_COOLDOWN"] },
  {
    title: "Token and policy",
    codes: ["VAULT_PAUSED", "ACTION_NOT_SUPPORTED", "TOKEN_NOT_ALLOWED", "TOKEN_PAUSED", "POLICY_BLOCKED"],
  },
  { title: "Limits", codes: ["SIZE_LIMIT", "CONCENTRATION", "INSUFFICIENT_BALANCE", "PAYEE_NOT_ALLOWED"] },
  { title: "Credit", codes: ["HEALTH_FACTOR_LOW", "DERISK_WINDOW", "CREDIT_FAILED"] },
  { title: "Execution", codes: ["SWAP_FAILED", "TRANSFER_FAILED"] },
];

/** The refusal the fork run recorded; the Refusals section highlights it. */
export const HIGHLIGHT_REASON: RefusalCode = "MARKET_CLOSED";
