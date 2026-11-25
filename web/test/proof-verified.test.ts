// @vitest-environment node
import { getAddress, keccak256, toBytes, toFunctionSelector, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import {
  COINBASE_INDEXER,
  countsAsVerified,
  EAS_ADDRESS,
  easAbi,
  indexerAbi,
  readVerifiedAccounts,
  VERIFIED_ACCOUNT_SCHEMA,
  type Attestation,
} from "@/app/(site)/proof/verified";
import type { LedgerClient } from "@/lib/chain/load";
import { readRepo } from "./helpers/solidity";

const ZERO32: Hex = `0x${"0".repeat(64)}`;

/**
 * A real Verified Account attestation, read from Base mainnet on 2026-11-25 with EAS getAttestation(uid), after the
 * Coinbase indexer's getAttestationUid gave this uid for the wallet. Its data is abi.encode(true), the schema's
 * `bool verifiedAccount`.
 */
const WALLET: Address = "0xc8D0650c4F6CA29A9aD463Bdaa2D01393E69Cd56";
const REAL: Attestation = {
  uid: "0xc6f882769a1938caa6c378b007833c2c350a163cdad74272cca6027d09afe603",
  schema: "0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9",
  time: 1_795_614_768n,
  expirationTime: 0n,
  revocationTime: 0n,
  refUID: ZERO32,
  recipient: WALLET,
  attester: "0x357458739F90461b99789350868CD7CF330Dd7EE",
  revocable: true,
  data: `0x${"0".repeat(63)}1`,
};
/** The timestamp of Base block 62,146,556, read on 2026-11-25 just after that attestation. */
const NOW = 1_795_619_778n;

describe("the Verified Account source", () => {
  it("reads the indexer, schema and EAS contract the inbox spec §5 names", () => {
    const spec = readRepo("docs/superpowers/specs/2026-11-25-maat-inbox-design.md");
    expect(spec).toContain(`Coinbase attestation indexer \`${COINBASE_INDEXER}\``);
    expect(spec).toContain(`getAttestationUid(wallet, ${VERIFIED_ACCOUNT_SCHEMA})`);
    expect(spec).toContain(`EAS (\`${EAS_ADDRESS}\`) \`getAttestation(uid)\``);
    expect(getAddress(COINBASE_INDEXER)).toBe(COINBASE_INDEXER);
  });

  it("calls getAttestationUid(address,bytes32) on the indexer and getAttestation(bytes32) on EAS", () => {
    expect(toFunctionSelector(indexerAbi[0])).toBe(keccak256(toBytes("getAttestationUid(address,bytes32)")).slice(0, 10));
    expect(toFunctionSelector(easAbi[0])).toBe(keccak256(toBytes("getAttestation(bytes32)")).slice(0, 10));
  });
});

describe("countsAsVerified: a UID counts only if EAS shows it unrevoked, unexpired and issued to that wallet", () => {
  it("counts the real attestation for its own wallet, whatever the case of the address", () => {
    expect(countsAsVerified(REAL, REAL.uid, WALLET, NOW)).toBe(true);
    expect(countsAsVerified(REAL, REAL.uid, WALLET.toLowerCase() as Address, NOW)).toBe(true);
  });

  it("does not count it for another wallet", () => {
    expect(countsAsVerified(REAL, REAL.uid, "0x00000000000000000000000000000000000A11cE", NOW)).toBe(false);
  });

  it("does not count a revoked attestation", () => {
    expect(countsAsVerified({ ...REAL, revocationTime: NOW - 1n }, REAL.uid, WALLET, NOW)).toBe(false);
  });

  it("does not count an expired attestation, and counts one that expires later", () => {
    expect(countsAsVerified({ ...REAL, expirationTime: NOW }, REAL.uid, WALLET, NOW)).toBe(false);
    expect(countsAsVerified({ ...REAL, expirationTime: NOW + 1n }, REAL.uid, WALLET, NOW)).toBe(true);
  });

  it("does not count an attestation of another schema, another uid, or none at all", () => {
    expect(countsAsVerified({ ...REAL, schema: `0x${"11".repeat(32)}` }, REAL.uid, WALLET, NOW)).toBe(false);
    expect(countsAsVerified(REAL, `0x${"22".repeat(32)}`, WALLET, NOW)).toBe(false);
    // EAS returns an empty attestation for an unknown uid.
    expect(countsAsVerified({ ...REAL, uid: ZERO32, schema: ZERO32, recipient: "0x0000000000000000000000000000000000000000" }, ZERO32, WALLET, NOW)).toBe(false);
  });
});

/** A client whose indexer gives `uids` and whose EAS gives `attestations`, recording each call. */
function fakeClient(uids: Record<string, Hex>, attestations: Record<string, Attestation>, fail?: string) {
  const calls: { address: string; functionName: string; args: readonly unknown[]; blockNumber?: bigint }[] = [];
  const client = {
    readContract: async (p: { address: Address; functionName: string; args: readonly unknown[]; blockNumber?: bigint }) => {
      calls.push({ address: p.address, functionName: p.functionName, args: p.args, blockNumber: p.blockNumber });
      if (fail && p.functionName === fail) throw new Error("the RPC is down");
      if (p.functionName === "getAttestationUid") return uids[String(p.args[0]).toLowerCase()] ?? ZERO32;
      if (p.functionName === "getAttestation") return attestations[String(p.args[0])];
      throw new Error(`unexpected ${p.functionName}`);
    },
  } as unknown as LedgerClient;
  return { client, calls };
}

describe("readVerifiedAccounts", () => {
  const BOB: Address = "0x0000000000000000000000000000000000000B0b";

  it("gives the UID of a wallet with a counting attestation and null for one without, reading EAS only for a UID", async () => {
    const { client, calls } = fakeClient({ [WALLET.toLowerCase()]: REAL.uid }, { [REAL.uid]: REAL });
    const got = await readVerifiedAccounts(client, [WALLET.toLowerCase(), BOB.toLowerCase()], { blockNumber: 62_146_556n, now: NOW });
    expect([...got.entries()]).toEqual([
      [WALLET.toLowerCase(), REAL.uid],
      [BOB.toLowerCase(), null],
    ]);
    expect(calls.map((c) => [c.address, c.functionName, c.blockNumber])).toEqual([
      [COINBASE_INDEXER, "getAttestationUid", 62_146_556n],
      [COINBASE_INDEXER, "getAttestationUid", 62_146_556n],
      [EAS_ADDRESS, "getAttestation", 62_146_556n],
    ]);
    expect(calls[0]!.args).toEqual([getAddress(WALLET), VERIFIED_ACCOUNT_SCHEMA]);
  });

  it("gives null for a UID that EAS shows revoked", async () => {
    const { client } = fakeClient({ [WALLET.toLowerCase()]: REAL.uid }, { [REAL.uid]: { ...REAL, revocationTime: 1n } });
    const got = await readVerifiedAccounts(client, [WALLET.toLowerCase()], { blockNumber: 1n, now: NOW });
    expect(got.get(WALLET.toLowerCase())).toBeNull();
  });

  it("throws when a read fails, so the column is never filled with a guess", async () => {
    const { client } = fakeClient({ [WALLET.toLowerCase()]: REAL.uid }, { [REAL.uid]: REAL }, "getAttestation");
    await expect(readVerifiedAccounts(client, [WALLET.toLowerCase()], { blockNumber: 1n, now: NOW })).rejects.toThrow("the RPC is down");
  });
});
