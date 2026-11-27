import { getAddress, type Address, type Hex } from "viem";
import type { LedgerSnapshot } from "@/lib/chain/load";
import { recordedSender, toVaultRow, type VaultRow } from "./vault-rows";

// The landing's live rows, with what its read of Base tells about a bill. Loaded with VaultReader, in the chunk that
// carries viem and the ledger's loader, never in the landing's first load.

/** The payee word of `execute(intent)`: the intent's sixth word, bytes 164 to 196 (contracts/src/Types.sol, Intent). */
const PAYEE_FROM = 2 + 2 * (4 + 5 * 32 + 12);
const PAYEE_TO = 2 + 2 * (4 + 6 * 32);

/** The intent's payee in `execute(intent)` calldata, or null when the calldata is too short to hold one. */
export function intentPayee(input: Hex): Address | null {
  if (input.length < PAYEE_TO) return null;
  return getAddress(`0x${input.slice(PAYEE_FROM, PAYEE_TO)}`);
}

/**
 * The read's Decisions as rows, newest first. A PAY_EXPENSE is a compute bill when its trail holds a maat:v1 blob of
 * kind "bill" whose keccak256 is the Decision's rationaleHash; its payee is read from the intent only when the
 * transaction is a direct `execute` call to the vault (the trail's `call`), since the vault pays exactly that payee.
 * Each row carries the sender label of its trail, or the one this build records for its transaction.
 */
export function liveRows(snapshot: Pick<LedgerSnapshot, "decisions" | "txs" | "trails" | "treasury">): VaultRow[] {
  const owner = snapshot.treasury?.owner ?? null;
  return snapshot.decisions.map((d) => {
    const trail = snapshot.trails.get(d.key);
    const sender = trail?.label ?? recordedSender(d.txHash);
    if (d.action !== "PAY_EXPENSE") return toVaultRow(d, {}, sender);
    const blob = trail?.call?.blob;
    const compute = trail?.blobHashOk === true && blob?.status === "v1" && blob.fields.k === "bill";
    const tx = trail?.call ? snapshot.txs.get(d.txHash.toLowerCase()) : undefined;
    return toVaultRow(d, { compute, payee: tx ? intentPayee(tx.input) : null, owner }, sender);
  });
}
