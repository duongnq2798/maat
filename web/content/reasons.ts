import { repoFileUrl } from "../lib/site";

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

/** One short plain label per code, shown before the code wherever a person reads a decision (spec 2026-11-20 section 3). */
export const REASON_LABEL: Readonly<Record<ReasonCode, string>> = {
  OK: "All checks passed",
  VAULT_PAUSED: "Vault paused",
  ACTION_NOT_SUPPORTED: "Credit not enabled",
  TOKEN_NOT_ALLOWED: "Token not allowed",
  TOKEN_PAUSED: "Token paused",
  POLICY_BLOCKED: "Blocked by token policy",
  MARKET_CLOSED: "Market closed",
  FEED_STALE: "Price feed out of date",
  BAD_PRICE: "Bad price data",
  MULTIPLIER_COOLDOWN: "Corporate action cooldown",
  PREMIUM_TOO_HIGH: "Pool price too far from oracle",
  SIZE_LIMIT: "Over the size limit",
  CONCENTRATION: "Too much in one stock",
  PAYEE_NOT_ALLOWED: "Payee not approved",
  INSUFFICIENT_BALANCE: "Not enough funds",
  SWAP_FAILED: "Swap failed",
  TRANSFER_FAILED: "Transfer failed",
  CREDIT_FAILED: "Aave call failed",
  HEALTH_FACTOR_LOW: "Health factor too low",
  DERISK_WINDOW: "Pre-pause safety margin",
};

/** The plain-text form for places that can't hold markup: "Market closed (MARKET_CLOSED)". */
export function reasonText(code: ReasonCode): string {
  return `${REASON_LABEL[code]} (${code})`;
}

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
  CONCENTRATION: "The buy would push one stock past its maximum weight, or its weight can't be measured.",
  PAYEE_NOT_ALLOWED: "Payments go only to payees on the vault's allowlist.",
  INSUFFICIENT_BALANCE: "Not enough funds for the amount, or an amount of zero.",
  SWAP_FAILED: "The swap reverted, for example on slippage past the limit.",
  TRANSFER_FAILED: "A token transfer or approval failed.",
  CREDIT_FAILED: "An Aave call failed, or its account data couldn't be read.",
  HEALTH_FACTOR_LOW: "The move would leave the Aave health factor under the floor.",
  DERISK_WINDOW: "Before the feed pauses for a weekend or holiday, the target health factor applies, not just the floor.",
};

/**
 * The docs' line per refusal: REASON_MEANING with five lines widened to match the code. Meant for the docs table
 * (components/docs/content.tsx), its Markdown copy (lib/docs/component-text.ts) and the mainnet ledger's decisions
 * and refusal chart (lib/chain/reason.ts); the landing's Refusals section keeps REASON_MEANING.
 */
export const REASON_MEANING_DOCS: Readonly<Record<RefusalCode, string>> = {
  ...REASON_MEANING,
  TOKEN_NOT_ALLOWED: "This token can't be used for this action.",
  MARKET_CLOSED: "The market is closed for the mandate's session (a weekend, a holiday or outside its hours), or the calendar can't be read.",
  BAD_PRICE: "The Chainlink answer is zero, negative, undated or from the future, or the feed or the pool's TWAP could not be read.",
  MULTIPLIER_COOLDOWN: "The token's multiplier changed recently or has a change scheduled, as around a split, or can't be read.",
  PAYEE_NOT_ALLOWED: "The payee is not on the allowlist, which the deploy sets and the owner changes only through the timelock.",
};

/** A line in contracts/src that returns a refusal code. */
export interface RaiseSite {
  /** Repo path of the Solidity file. */
  readonly file: string;
  /** The line, from 1, that returns the code. */
  readonly line: number;
  /** The library or contract and the function the line is in, as "GuardLib.checkMarket". */
  readonly fn: string;
}

const GUARD_LIB = "contracts/src/GuardLib.sol";
const VAULT = "contracts/src/MandateVault.sol";
const guard = (line: number, fn: string): RaiseSite => ({ file: GUARD_LIB, line, fn: `GuardLib.${fn}` });
const vault = (line: number, fn: string): RaiseSite => ({ file: VAULT, line, fn: `MandateVault.${fn}` });

/**
 * Every line in contracts/src that returns each refusal code: GuardLib's lines, then MandateVault's, each in source
 * order, so the first is where a BUY meets the code when a BUY can return it. test/reasons-json.test.ts reads the
 * sources: each line must return its code inside the function named, and the lists must hold every such line.
 */
export const REASON_RAISED_AT: Readonly<Record<RefusalCode, readonly RaiseSite[]>> = {
  VAULT_PAUSED: [vault(259, "_check")],
  ACTION_NOT_SUPPORTED: [vault(297, "_checkCredit")],
  TOKEN_NOT_ALLOWED: [
    vault(266, "_check"),
    vault(300, "_checkCredit"),
    vault(308, "_checkCredit"),
    vault(323, "_checkCollateralMove"),
    vault(325, "_checkCollateralMove"),
    vault(374, "_checkCollateralMarket"),
  ],
  TOKEN_PAUSED: [guard(46, "checkMarket"), guard(85, "collateralHealthy"), vault(329, "_checkCollateralMove")],
  POLICY_BLOCKED: [guard(47, "checkMarket"), vault(332, "_checkCollateralMove")],
  MARKET_CLOSED: [guard(48, "checkMarket"), vault(368, "_checkCollateralMarket")],
  FEED_STALE: [guard(52, "checkMarket"), guard(89, "collateralHealthy")],
  BAD_PRICE: [guard(51, "checkMarket"), guard(59, "checkMarket"), guard(86, "collateralHealthy"), guard(88, "collateralHealthy")],
  MULTIPLIER_COOLDOWN: [guard(55, "checkMarket"), guard(91, "collateralHealthy")],
  PREMIUM_TOO_HIGH: [guard(60, "checkMarket")],
  SIZE_LIMIT: [vault(277, "_check"), vault(289, "_checkExpense")],
  CONCENTRATION: [vault(279, "_check")],
  PAYEE_NOT_ALLOWED: [vault(285, "_checkExpense")],
  INSUFFICIENT_BALANCE: [
    vault(274, "_check"),
    vault(287, "_checkExpense"),
    vault(302, "_checkCredit"),
    vault(309, "_checkCredit"),
    vault(335, "_checkCollateralMove"),
    vault(341, "_checkCollateralMove"),
  ],
  SWAP_FAILED: [vault(587, "_perform")],
  TRANSFER_FAILED: [vault(563, "_perform"), vault(579, "_perform"), vault(619, "_performCredit")],
  CREDIT_FAILED: [
    vault(327, "_checkCollateralMove"),
    vault(331, "_checkCollateralMove"),
    vault(340, "_checkCollateralMove"),
    vault(346, "_checkCollateralMove"),
    vault(360, "_checkBorrow"),
    vault(372, "_checkCollateralMarket"),
    vault(430, "_creditFailure"),
    vault(432, "_creditFailure"),
    vault(626, "_performCredit"),
  ],
  HEALTH_FACTOR_LOW: [vault(391, "_healthReason")],
  DERISK_WINDOW: [vault(392, "_healthReason")],
};

/** One line of the agent checklist: what the vault checks, and the failure the check stops. */
export interface GuardCheck {
  readonly code: RefusalCode;
  readonly check: string;
  readonly stops: string;
}

/**
 * The checklist on concepts/agent-checklist.mdx and in /reasons.json, one line per refusal code: a BUY's checks in the
 * order the vault runs them, then a payment's, then credit's, then the two failures of the action itself.
 */
export const GUARD_CHECKLIST: readonly GuardCheck[] = [
  {
    code: "VAULT_PAUSED",
    check: "The vault is not paused. Only a repayment of debt passes a pause.",
    stops: "An agent that keeps trading after its owner has pulled the emergency stop.",
  },
  {
    code: "TOKEN_NOT_ALLOWED",
    check: "The mandate allows the token for this action. A sale needs only a market for it.",
    stops: "Buying a token the owner never approved, such as a lookalike or a stock taken off the list.",
  },
  {
    code: "TOKEN_PAUSED",
    check: "The token's transfers are not paused, and their pause state can be read.",
    stops: "Trading a token whose issuer has halted transfers.",
  },
  {
    code: "POLICY_BLOCKED",
    check: "The token's own transfer policy allows every account on the trade's path, the signer included.",
    stops: "Sending a trade that the token's issuer rules would refuse on one of its legs.",
  },
  {
    code: "MARKET_CLOSED",
    check:
      "The onchain calendar has the market open for the mandate's session. REGULAR is the NYSE session, with its holidays, early closes and New York daylight saving. FEED_24_5 is the window from Sunday evening to Friday evening in which the design assumes the equity feeds update, closed on holidays but not shortened by early closes.",
    stops:
      "Trading outside the mandate's session. Under REGULAR, which the deploy script sets, that is trading while the stock market is closed, when the pool still trades but the equity price feed can go hours without an update.",
  },
  {
    code: "BAD_PRICE",
    check:
      "The Chainlink answer and the pool's time-weighted price can be read, and the answer is positive, dated and not from the future.",
    stops: "Acting on a zero, negative or broken price.",
  },
  {
    code: "FEED_STALE",
    check: "The Chainlink answer is newer than the mandate's staleness limit.",
    stops: "Acting on an old price after the feed stopped updating.",
  },
  {
    code: "MULTIPLIER_COOLDOWN",
    check: "The token's multiplier can be read, has not changed within the cooldown, and has no change scheduled.",
    stops: "Trading through a split or another corporate action while the token's units and price are rescaled.",
  },
  {
    code: "PREMIUM_TOO_HIGH",
    check: "The pool's time-weighted price is within the mandate's premium limit of Chainlink, above or below.",
    stops: "Buying at a premium or selling at a discount to the stock's price, as in a thin or manipulated pool.",
  },
  {
    code: "INSUFFICIENT_BALANCE",
    check:
      "The amount is above zero and no more than the vault holds of the token, or, for a withdrawal of collateral, no more than it has supplied. A borrow checks only that the amount is not zero.",
    stops: "An intent for funds the vault does not have or has not supplied, or for nothing.",
  },
  {
    code: "SIZE_LIMIT",
    check: "The trade or payment fits the per-trade cap and what is left of the daily cap.",
    stops: "A runaway loop or a leaked executor key moving more than the caps allow in one trade or in one day.",
  },
  {
    code: "CONCENTRATION",
    check: "After a buy, the stock's weight in net equity stays within its cap, and the weight can be measured.",
    stops: "Putting too much of the treasury into one stock.",
  },
  {
    code: "PAYEE_NOT_ALLOWED",
    check: "A payment goes only to a payee on the allowlist, which the owner changes only through the timelock.",
    stops: "Paying an address the owner never approved, such as one a prompt injection names.",
  },
  {
    code: "ACTION_NOT_SUPPORTED",
    check: "A credit action needs a credit adapter set in the mandate.",
    stops: "Using credit on a vault whose owner never turned it on.",
  },
  {
    code: "CREDIT_FAILED",
    check: "Every credit value the check needs can be read, and the credit call succeeds.",
    stops: "Acting blind when the lending venue cannot be read, or counting a failed credit call as done.",
  },
  {
    code: "HEALTH_FACTOR_LOW",
    check: "A borrow, or a withdrawal of collateral against debt, leaves the health factor at or above the floor.",
    stops: "Borrowing toward liquidation.",
  },
  {
    code: "DERISK_WINDOW",
    check:
      "Inside the de-risk window before the equity feeds pause for a weekend or a holiday, a borrow or a withdrawal against debt must reach the target health factor, not just the floor.",
    stops: "Going into a weekend or a holiday on a thin margin, while prices cannot update.",
  },
  {
    code: "SWAP_FAILED",
    check:
      "The swap goes through. The vault sets a floor from the oracle price and the slippage limit and passes it to its swap adapter, which reverts when the output is below it.",
    stops: "A fill worse than the slippage limit allows: the adapter's swap reverts, the vault catches it, and no funds move.",
  },
  {
    code: "TRANSFER_FAILED",
    check: "Each token transfer and approval succeeds.",
    stops: "Counting a failed transfer or approval as done.",
  },
];

/** What OK means in a Decision and in a preview. */
export const OK_MEANING =
  "Every check passed. In a Decision, the action went through; from previewIntent, execute() would act on the intent now.";

/** The docs page that holds the checklist. */
export const CHECKLIST_PATH = "/docs/concepts/agent-checklist";

const TYPES_FILE = "contracts/src/Types.sol";

/**
 * out/reasons.json, which app/reasons.json/route.ts serves: every refusal code with its enum id, label, group, meaning,
 * checklist line and the contract lines that return it. `base` is the site's URL, for the docs links.
 */
export function reasonsFile(base: URL) {
  const groupOf = (code: RefusalCode) => REASON_GROUPS.find((g) => g.codes.includes(code))?.title;
  const guardOf = (code: RefusalCode) => GUARD_CHECKLIST.find((g) => g.code === code);
  return {
    enum: { file: TYPES_FILE, name: "Reason", url: repoFileUrl(TYPES_FILE) },
    docs: { refusalCodes: new URL("/docs/concepts/refusal-codes", base).href, checklist: new URL(CHECKLIST_PATH, base).href },
    ok: { id: 0, name: "OK", label: REASON_LABEL.OK, meaning: OK_MEANING },
    reasons: REASONS.map((code, i) => ({
      id: i + 1,
      name: code,
      label: REASON_LABEL[code],
      group: groupOf(code),
      meaning: REASON_MEANING_DOCS[code],
      check: guardOf(code)?.check,
      stops: guardOf(code)?.stops,
      raisedAt: REASON_RAISED_AT[code].map((s) => ({ file: s.file, line: s.line, function: s.fn, url: `${repoFileUrl(s.file)}#L${s.line}` })),
    })),
  };
}
