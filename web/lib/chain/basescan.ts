import type { Address, Hash } from "viem";

const BASESCAN = "https://basescan.org";

export function basescanTx(hash: Hash): string {
  return `${BASESCAN}/tx/${hash}`;
}

export function basescanAddress(address: Address): string {
  return `${BASESCAN}/address/${address}`;
}
