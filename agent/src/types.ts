import type { Address, Hex } from "viem";

/** Order must match contracts/src/Types.sol (test/types.test.ts enforces it). */
export const ACTIONS = ["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY", "PAY_EXPENSE"] as const;
export type ActionName = (typeof ACTIONS)[number];

/** The Aave V4 credit actions. With MAAT_CREDIT_ACTIONS off (the default) the agent suggests, asks for and sends none. */
export const CREDIT_ACTIONS: ReadonlySet<ActionName> = new Set<ActionName>(["SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY"]);

export const REASONS = [
  "OK",
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
export type ReasonName = (typeof REASONS)[number];

export const SESSION_MODES = ["REGULAR", "FEED_24_5"] as const;

export function actionId(a: ActionName): number {
  return ACTIONS.indexOf(a);
}

export function reasonName(n: number): ReasonName {
  const r = REASONS[n];
  if (r === undefined) throw new Error(`unknown reason id ${n}`);
  return r;
}

/** The Solidity Intent struct, ready for viem encoding. */
export interface OnchainIntent {
  id: Hex;
  action: number;
  token: Address;
  amount: bigint;
  minOut: bigint;
  payee: Address;
  rationaleHash: Hex;
}

/** Solidity Mandate. viem decodes uint<=48 as number and wider ints as bigint. */
export interface Mandate {
  sessionMode: number;
  maxPremiumBps: number;
  maxSlippageBps: number;
  maxStaleness: number;
  multiplierCooldown: number;
  twapWindow: number;
  perTradeCapUsd: bigint;
  dailyCapUsd: bigint;
  calendar: Address;
  swapAdapter: Address;
  creditAdapter: Address;
  minHealthFactor: bigint;
  targetHealthFactor: bigint;
  deriskWindow: number;
}

export interface TokenConfig {
  allowed: boolean;
  feed: Address;
  pool: Address;
  maxWeightBps: number;
}
