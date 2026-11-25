import type { Address, PublicClient } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { oneLine } from "../redact.js";
import { REASONS, type OnchainIntent, type ReasonName } from "../types.js";

export type PreviewClient = Pick<PublicClient, "readContract">;
export type PreviewResult = ReasonName | "UNKNOWN";
/** `error` is set only for UNKNOWN: why the verdict could not be read, for the journal. */
export interface Preview {
  result: PreviewResult;
  error?: string;
}

/** eth_call previewIntent with from = executor, so GuardLib's tx.origin policy check matches execute(). */
export async function previewIntent(
  client: PreviewClient,
  vault: Address,
  executor: Address,
  intent: OnchainIntent,
  blockNumber?: bigint,
): Promise<Preview> {
  let r: unknown;
  try {
    r = await client.readContract({
      address: vault,
      abi: mandateVaultAbi,
      functionName: "previewIntent",
      args: [intent],
      account: executor,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
  } catch (e) {
    // The journal keeps this line; viem's message can quote the RPC URL and its key.
    return { result: "UNKNOWN", error: oneLine(e) || "preview call failed" };
  }
  const reason = REASONS[Number(r)];
  return reason === undefined ? { result: "UNKNOWN", error: `unknown reason id ${String(r)}` } : { result: reason };
}
