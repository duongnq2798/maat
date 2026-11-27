import type { Address, Hash } from "viem";
import { basescanDecision as decisionLink } from "@/lib/live/basescan";

const BASESCAN = "https://basescan.org";

export function basescanTx(hash: Hash): string {
  return `${BASESCAN}/tx/${hash}`;
}

/** A Decision's transaction, opened on its Logs tab (lib/live/basescan.ts says why). */
export function basescanDecision(hash: Hash): string {
  return decisionLink(hash);
}

export function basescanAddress(address: Address): string {
  return `${BASESCAN}/address/${address}`;
}
