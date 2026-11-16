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

/** One plain-English line per refusal, written from where the contracts return it (contracts/src). */
export const REASON_MEANING: Readonly<Record<RefusalCode, string>> = {
  VAULT_PAUSED: "The owner paused the vault. Only repaying debt still goes through.",
  ACTION_NOT_SUPPORTED: "Credit actions are off: this vault has no credit adapter.",
  TOKEN_NOT_ALLOWED: "The token is not in the mandate for this action.",
  TOKEN_PAUSED: "The token's transfers are paused, or their state can't be read.",
  POLICY_BLOCKED: "The token's own transfer policy does not allow this path.",
  MARKET_CLOSED: "NYSE is closed for the mandate's session: a weekend, a holiday or after hours.",
  FEED_STALE: "The Chainlink price is older than the mandate allows.",
  BAD_PRICE: "The Chainlink feed or the pool's TWAP could not be read.",
  MULTIPLIER_COOLDOWN: "The token's multiplier changed recently, as after a split, or can't be read.",
  PREMIUM_TOO_HIGH: "The pool price is too far above or below Chainlink.",
  SIZE_LIMIT: "Over the per-trade cap or the daily cap.",
  CONCENTRATION: "The buy would push one stock past its maximum weight.",
  PAYEE_NOT_ALLOWED: "Payments go only to payees the owner listed through the timelock.",
  INSUFFICIENT_BALANCE: "Not enough funds for the amount, or an amount of zero.",
  SWAP_FAILED: "The swap reverted, for example on slippage past the limit.",
  TRANSFER_FAILED: "A token transfer or approval failed.",
  CREDIT_FAILED: "An Aave call failed, or its account data couldn't be read.",
  HEALTH_FACTOR_LOW: "The move would leave the Aave health factor under the floor.",
  DERISK_WINDOW: "Before the feed pauses for a weekend or holiday, the target health factor applies, not just the floor.",
};

/**
 * The docs' line per refusal: REASON_MEANING with four lines widened to match the code. Meant for the docs table
 * (components/docs/content.tsx) and its Markdown copy (lib/docs/component-text.ts); the landing's Refusals section
 * keeps REASON_MEANING.
 */
export const REASON_MEANING_DOCS: Readonly<Record<RefusalCode, string>> = {
  ...REASON_MEANING,
  TOKEN_NOT_ALLOWED: "This token can't be used for this action.",
  MARKET_CLOSED: "The market is closed for the mandate's session (a weekend, a holiday or outside its hours), or the calendar can't be read.",
  BAD_PRICE: "The Chainlink answer is zero, negative, undated or from the future, or the feed or the pool's TWAP could not be read.",
  MULTIPLIER_COOLDOWN: "The token's multiplier changed recently or has a change scheduled, as around a split, or can't be read.",
};
