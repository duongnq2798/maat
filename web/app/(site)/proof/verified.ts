import { getAddress, type Address, type Hex } from "viem";
import type { LedgerClient } from "@/lib/chain/load";

// The Verified Account column of the /proof rule (inbox spec §5). The addresses and the schema are Coinbase's own,
// from the official repository of Coinbase Verifications, https://github.com/coinbase/verifications: its README's Base
// mainnet table lists the Coinbase Indexer 0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C, the EAS predeploy
// 0x4200000000000000000000000000000000000021 and the "Verified Account" schema
// 0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9, and its indexer interface,
// https://github.com/coinbase/verifications/blob/main/src/interfaces/IAttestationIndexer.sol, declares
// getAttestationUid(address recipient, bytes32 schemaUid) returns (bytes32), which can be outdated, so the attestation
// is checked in EAS. On 2026-11-25 the EAS schema registry (0x4200000000000000000000000000000000000020) gave that schema
// as "bool verifiedAccount".

export const COINBASE_INDEXER: Address = "0x2c7eE1E5f416dfF40054c27A62f7B357C4E8619C";
export const EAS_ADDRESS: Address = "0x4200000000000000000000000000000000000021";
export const VERIFIED_ACCOUNT_SCHEMA: Hex = "0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9";

const ZERO32: Hex = `0x${"0".repeat(64)}`;

export const indexerAbi = [
  {
    type: "function",
    name: "getAttestationUid",
    stateMutability: "view",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "schemaUid", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

/** EAS's getAttestation and its Attestation struct: the ten fields it returned for a Verified Account on 2026-11-25. */
export const easAbi = [
  {
    type: "function",
    name: "getAttestation",
    stateMutability: "view",
    inputs: [{ name: "uid", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "uid", type: "bytes32" },
          { name: "schema", type: "bytes32" },
          { name: "time", type: "uint64" },
          { name: "expirationTime", type: "uint64" },
          { name: "revocationTime", type: "uint64" },
          { name: "refUID", type: "bytes32" },
          { name: "recipient", type: "address" },
          { name: "attester", type: "address" },
          { name: "revocable", type: "bool" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
  },
] as const;

export interface Attestation {
  uid: Hex;
  schema: Hex;
  time: bigint;
  expirationTime: bigint;
  revocationTime: bigint;
  refUID: Hex;
  recipient: Address;
  attester: Address;
  revocable: boolean;
  data: Hex;
}

/**
 * The rule's test for one UID: EAS gives the attestation of that uid, of the Verified Account schema, issued to
 * `wallet`, never revoked, and with no expiry or one after `now` (unix seconds).
 */
export function countsAsVerified(att: Attestation, uid: Hex, wallet: string, now: bigint): boolean {
  if (uid.toLowerCase() === ZERO32) return false;
  if (att.uid.toLowerCase() !== uid.toLowerCase()) return false;
  if (att.schema.toLowerCase() !== VERIFIED_ACCOUNT_SCHEMA) return false;
  if (att.recipient.toLowerCase() !== wallet.toLowerCase()) return false;
  if (att.revocationTime !== 0n) return false;
  return att.expirationTime === 0n || att.expirationTime > now;
}

/**
 * The Verified Account column for `wallets` (lowercased), read at `blockNumber`, whose timestamp is `now`: each
 * wallet's UID when it counts, or null. Throws when a read fails, so a wallet is never shown without a reading.
 */
export async function readVerifiedAccounts(
  client: Pick<LedgerClient, "readContract">,
  wallets: readonly string[],
  at: { blockNumber: bigint; now: bigint },
): Promise<Map<string, Hex | null>> {
  const uids = await Promise.all(
    wallets.map((w) =>
      client.readContract({
        address: COINBASE_INDEXER,
        abi: indexerAbi,
        functionName: "getAttestationUid",
        args: [getAddress(w), VERIFIED_ACCOUNT_SCHEMA],
        blockNumber: at.blockNumber,
      }),
    ),
  );
  const held = await Promise.all(
    uids.map(async (uid, i) => {
      if (uid.toLowerCase() === ZERO32) return null;
      const att = (await client.readContract({
        address: EAS_ADDRESS,
        abi: easAbi,
        functionName: "getAttestation",
        args: [uid],
        blockNumber: at.blockNumber,
      })) as Attestation;
      return countsAsVerified(att, uid, wallets[i]!, at.now) ? uid : null;
    }),
  );
  return new Map(wallets.map((w, i) => [w, held[i] ?? null]));
}
