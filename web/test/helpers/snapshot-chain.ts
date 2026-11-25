import type { Address, Hex } from "viem";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { decisionLog, FAKE_VAULT, fakeBlockHash, hash32, type FakeChain } from "./fake-ledger";

// The chain behind test/fixtures/decisions-snapshot.json, which takeSnapshot wrote at block SNAP_BLOCK (the test of
// test/chain-snapshot.test.ts that compares them says how to write it again). e2e/ledger-snapshot.spec.ts serves the
// same chain and the same file to the built page.

export const SNAP_DEPLOY = SCAN_FLOOR_BLOCK + 10_000n;
/** N, the block the fixture snapshot was taken at. */
export const SNAP_BLOCK = SNAP_DEPLOY + 100_000n;
export const SNAP_HEAD = SNAP_BLOCK + 20_000n;
export const SNAP_DEPLOY_TX = hash32(42);
export const SNAP_OWNER: Address = "0x00000000000000000000000000000000000000A1";
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC

/** The fixture's Decisions, oldest first: n is the tx hash32(n), sent from the owner straight to the vault. */
export const SNAP_ROWS: readonly { n: number; block: bigint; reason?: string; amount?: bigint }[] = [
  { n: 1, block: SNAP_DEPLOY + 5n },
  { n: 2, block: SNAP_DEPLOY + 60_000n, reason: "MARKET_CLOSED", amount: 10_000_000n },
  // Inside the reorg window below N: a load reads it again rather than take it from the file.
  { n: 3, block: SNAP_BLOCK - 10n, reason: "SIZE_LIMIT", amount: 90_000_000n },
  // After N: only a scan finds it.
  { n: 4, block: SNAP_HEAD - 10n },
];

/** Any calldata: the trail decodes what it can and labels the rest. */
const input = (n: number) => `0x${n.toString(16).padStart(8, "0")}` as Hex;

/** The fixture chain at `head` (SNAP_HEAD by default): the Decisions up to it, each block's time, gas and tx. */
export function snapshotChain(over: Partial<FakeChain> = {}): FakeChain {
  const head = over.head ?? SNAP_HEAD;
  const rows = SNAP_ROWS.filter((r) => r.block <= head);
  return {
    head,
    owner: SNAP_OWNER,
    logs: rows.map((r) => decisionLog(r.n, r.block, { reason: r.reason, amount: r.amount })),
    times: {
      ...Object.fromEntries(rows.map((r) => [String(r.block), T0 + r.n * 3600])),
      [String(SNAP_BLOCK)]: T0 + 3 * 3600 + 2,
      [String(head)]: T0 + 5 * 3600,
    },
    gas: Object.fromEntries(rows.map((r) => [hash32(r.n), 111_116n + BigInt(r.n)])),
    txs: Object.fromEntries(rows.map((r) => [hash32(r.n), { from: SNAP_OWNER, to: FAKE_VAULT, input: input(r.n) }])),
    deployTx: { hash: SNAP_DEPLOY_TX, block: SNAP_DEPLOY },
    ...over,
  };
}

/** Block N as the RPC gives it to the snapshot script. */
export const SNAP_AT = { number: SNAP_BLOCK, hash: fakeBlockHash(SNAP_BLOCK) } as const;
