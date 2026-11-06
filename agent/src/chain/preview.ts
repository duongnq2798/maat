import type { Address, PublicClient } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { REASONS, type OnchainIntent, type ReasonName } from "../types.js";

export type PreviewClient = Pick<PublicClient, "readContract">;
export type PreviewResult = ReasonName | "UNKNOWN";

/** eth_call previewIntent with from = executor, so GuardLib's tx.origin policy check matches execute(). */
export async function previewIntent(
  client: PreviewClient,
  vault: Address,
  executor: Address,
  intent: OnchainIntent,
  blockNumber?: bigint,
): Promise<PreviewResult> {
  try {
    const r = await client.readContract({
      address: vault,
      abi: mandateVaultAbi,
      functionName: "previewIntent",
      args: [intent],
      account: executor,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
    return REASONS[Number(r)] ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
