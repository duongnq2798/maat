import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { erc20Abi, isAddressEqual, parseEventLogs, type Address, type Hex, type Log } from "viem";

/** The part of a transaction receipt the verdict reads. */
export type ReceiptLogs = { logs: readonly { address: Address; topics: readonly Hex[]; data: Hex }[] };

/**
 * The USDC units a transaction moved to `to`: the sum of the ERC-20 Transfer events emitted by the `usdc` contract whose
 * recipient is `to`. It reads the settlement transaction's own logs, so it does not depend on which block an RPC node
 * answers a balance query at. Transfers of other tokens, and Transfers to other addresses, count for nothing.
 */
export function usdcPaidTo(receipt: ReceiptLogs, usdc: Address, to: Address): bigint {
  const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs as Log[] });
  let total = 0n;
  for (const t of transfers) {
    if (isAddressEqual(t.address, usdc) && isAddressEqual(t.args.to, to)) total += t.args.value;
  }
  return total;
}

/** What the paid request came back with: the status and the two x402 headers (null when absent). */
export interface PaidResponse {
  status: number;
  paymentRequired: string | null;
  paymentResponse: string | null;
}

export type PaidOutcome = { fail: string } | { settlementTx: Hex };

/**
 * Reads the answer to the paid request. The x402 middleware reports a refusal in two shapes:
 * - verify refused (or threw): status 402 with PAYMENT-REQUIRED whose `error` is the reason, and no PAYMENT-RESPONSE;
 * - settlement failed (or threw): status 402 with PAYMENT-RESPONSE `{ success: false, errorReason }`, and no PAYMENT-REQUIRED.
 * With neither header nothing settled (a 502 from a facilitator outage, or an empty 402).
 */
export function judgePaidResponse(r: PaidResponse): PaidOutcome {
  if (r.status === 402 && r.paymentRequired) {
    const reason = decodePaymentRequiredHeader(r.paymentRequired).error;
    return { fail: `S4 FAIL (facilitator refused): ${reason ?? "no reason given"}` };
  }
  if (!r.paymentResponse) return { fail: `S4 FAIL (no settlement): status ${r.status}` };
  const settle = decodePaymentResponseHeader(r.paymentResponse);
  if (!settle.success) return { fail: `S4 FAIL (facilitator refused): ${settle.errorReason ?? "no reason given"}` };
  if (!settle.transaction) return { fail: `S4 FAIL (no settlement): status ${r.status}` };
  return { settlementTx: settle.transaction as Hex };
}
