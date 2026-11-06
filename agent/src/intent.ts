import { encodePacked, getAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import { addressOf, type TokenSymbol } from "./addresses.js";
import type { VaultState } from "./chain/state.js";
import { actionId, type ActionName, type OnchainIntent } from "./types.js";
import { minBig, rawForUsd6, usdToUsdc6, valueUsd6 } from "./units.js";

export interface Proposal {
  action: ActionName;
  symbol: TokenSymbol | "USDC";
  amountUsd: number;
  rationale: string;
}

export type BuildResult =
  | { ok: true; intent: OnchainIntent; proposal: Proposal; amountUsd6: bigint; clamped: boolean }
  | { ok: false; proposal: Proposal; error: string };

const USDC_ACTIONS: ReadonlySet<ActionName> = new Set(["BORROW", "REPAY", "PAY_EXPENSE"]);

export function intentId(runId: string, index: number): Hex {
  return keccak256(encodePacked(["string", "uint256"], [runId, BigInt(index)]));
}

export function rationaleHash(text: string): Hex {
  return keccak256(toBytes(text));
}

export function buildIntent(
  p: Proposal,
  s: VaultState,
  ctx: { runId: string; index: number; expensePayee: Address },
): BuildResult {
  const fail = (error: string): BuildResult => ({ ok: false, proposal: p, error });
  const wantsUsdc = USDC_ACTIONS.has(p.action);
  if (wantsUsdc !== (p.symbol === "USDC")) return fail(`symbol ${p.symbol} does not fit ${p.action}`);

  let usd6: bigint;
  try {
    usd6 = usdToUsdc6(p.amountUsd);
  } catch {
    return fail(`invalid amount ${p.amountUsd}`);
  }

  let token: Address;
  let amount: bigint;
  let amountUsd6: bigint;
  if (wantsUsdc) {
    token = s.usdc;
    const debt = s.credit?.readable && s.credit.debt > 0n ? s.credit.debt : null;
    amount =
      p.action === "BORROW" ? usd6 : p.action === "REPAY" && debt !== null ? minBig(usd6, s.usdcBalance, debt) : minBig(usd6, s.usdcBalance);
    amountUsd6 = amount;
  } else if (p.action === "BUY") {
    token = addressOf(p.symbol as TokenSymbol);
    if (!s.tokens.some((t) => getAddress(t.address) === token)) return fail(`${p.symbol} is not listed in the vault`);
    amount = minBig(usd6, s.usdcBalance);
    amountUsd6 = amount;
  } else {
    token = addressOf(p.symbol as TokenSymbol);
    const t = s.tokens.find((x) => getAddress(x.address) === token);
    if (!t) return fail(`${p.symbol} is not listed in the vault`);
    if (t.price8 === null) return fail(`no price for ${p.symbol}`);
    const cap = p.action === "WITHDRAW_COLLATERAL" ? t.supplied : t.balance;
    amount = minBig(rawForUsd6(usd6, t.price8, t.decimals), cap);
    amountUsd6 = valueUsd6(amount, t.price8, t.decimals);
  }
  if (amount === 0n) return fail("amount rounds to zero");

  const requested = wantsUsdc || p.action === "BUY" ? usd6 : null;
  const clamped = requested !== null ? amount < requested : amountUsd6 + 1n < usd6;
  return {
    ok: true,
    proposal: p,
    amountUsd6,
    clamped,
    intent: {
      id: intentId(ctx.runId, ctx.index),
      action: actionId(p.action),
      token,
      amount,
      minOut: 0n,
      payee: p.action === "PAY_EXPENSE" ? ctx.expensePayee : zeroAddress,
      rationaleHash: rationaleHash(p.rationale),
    },
  };
}
