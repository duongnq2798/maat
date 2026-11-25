import { encodePacked, getAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import { addressOf, type TokenSymbol } from "./addresses.js";
import type { VaultState } from "./chain/state.js";
import { signedPremiumBps } from "./chain/twap.js";
import { BlobError, encodeBlob, MAX_SOURCES, type BlobInput, type EncodedBlob, type Source } from "./rationale/blob.js";
import { actionId, type ActionName, type OnchainIntent } from "./types.js";
import { minBig, rawForUsd6, usdToUsdc6, valueUsd6 } from "./units.js";

export interface Proposal {
  action: ActionName;
  symbol: TokenSymbol | "USDC";
  amountUsd: number;
  rationale: string;
}

/**
 * The blob fields buildIntent cannot read from the state or the run: `c` (gitCommit(), the value the journal stamps
 * on each row), `j` (the journal head when the blob is built) and who wrote the text: `m`, the model that answered,
 * with `q` for a brief-driven intent, or `k` for a line the agent's code wrote.
 */
export type BlobContext = Pick<BlobInput, "c" | "j" | "k" | "m" | "q">;

export type BuildResult =
  | { ok: true; intent: OnchainIntent; proposal: Proposal; amountUsd6: bigint; clamped: boolean; blob: EncodedBlob; blobInput: BlobInput }
  | { ok: false; proposal: Proposal; error: string };

/**
 * The blob's `s` (spec §2.1): per vault token in tokens() order, its BASKET symbol or lowercase address, the feed's
 * round id and updatedAt (null when the read failed), and sign(twap - answer) * premiumBps (null without a valid
 * answer or a TWAP). The first 16 tokens: the most a blob holds.
 */
export function sourcesOf(s: Pick<VaultState, "tokens">): Source[] {
  return s.tokens.slice(0, MAX_SOURCES).map((t): Source => [
    t.symbol ?? t.address.toLowerCase(),
    t.roundId === null ? null : t.roundId.toString(),
    t.updatedAt === null || t.updatedAt > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(t.updatedAt),
    signedPremiumBps(t.twap8, t.price8),
  ]);
}

const USDC_ACTIONS: ReadonlySet<ActionName> = new Set(["BORROW", "REPAY", "PAY_EXPENSE"]);

export function intentId(runId: string, index: number): Hex {
  return keccak256(encodePacked(["string", "uint256"], [runId, BigInt(index)]));
}

/** keccak256 of the text's UTF-8 bytes: an intent's rationaleHash is this of its maat:v1 blob. */
export function rationaleHash(text: string): Hex {
  return keccak256(toBytes(text));
}

/** The intent for `p` at state `s`. Its rationaleHash commits to the maat:v1 blob built from `p.rationale`, not to the text alone. */
export function buildIntent(
  p: Proposal,
  s: VaultState,
  ctx: { runId: string; index: number; expensePayee: Address; blob: BlobContext },
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
  let wanted: bigint = usd6; // the amount before any balance/debt/supplied cap, in the units of `amount`
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
    wanted = rawForUsd6(usd6, t.price8, t.decimals);
    amount = minBig(wanted, cap);
    amountUsd6 = valueUsd6(amount, t.price8, t.decimals);
  }
  if (amount === 0n) return fail("amount rounds to zero");

  const blobInput: BlobInput = { ...ctx.blob, b: Number(s.blockNumber), r: ctx.runId, s: sourcesOf(s), text: p.rationale };
  let blob: EncodedBlob;
  try {
    blob = encodeBlob(blobInput);
  } catch (e) {
    if (e instanceof BlobError) return fail(`blob: ${e.message}`);
    throw e;
  }

  const clamped = amount < wanted;
  return {
    ok: true,
    proposal: p,
    amountUsd6,
    clamped,
    blob,
    blobInput,
    intent: {
      id: intentId(ctx.runId, ctx.index),
      action: actionId(p.action),
      token,
      amount,
      minOut: 0n,
      payee: p.action === "PAY_EXPENSE" ? ctx.expensePayee : zeroAddress,
      rationaleHash: blob.hash,
    },
  };
}
