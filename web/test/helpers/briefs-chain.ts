import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import type { CachedLog } from "@/lib/chain/cache";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { inboxAbi } from "@/lib/chain/inbox";
import { fakeBlockHash, hash32, type FakeChain } from "./fake-ledger";

// The chain behind test/fixtures/briefs-snapshot.json, which takeBriefsSnapshot wrote at block BRIEFS_BLOCK (the test of
// test/briefs-snapshot.test.ts that compares them says how to write it again): a MaatInbox and its Brief logs, laid out
// as test/helpers/snapshot-chain.ts lays out the vault's Decisions.

export const BRIEFS_INBOX: Address = "0x00000000000000000000000000000000000B0001";
export const BRIEFS_DEPLOY = SCAN_FLOOR_BLOCK + 50_000n;
/** N, the block the fixture Brief snapshot was taken at. */
export const BRIEFS_BLOCK = BRIEFS_DEPLOY + 100_000n;
export const BRIEFS_HEAD = BRIEFS_BLOCK + 20_000n;
export const BRIEFS_DEPLOY_TX = hash32(43);
const ALICE: Address = "0x00000000000000000000000000000000000A11cE";
const BOB: Address = "0x0000000000000000000000000000000000000B0b";
const T0 = 1_795_707_000; // Thu 26 Nov 2026 15:30 UTC

/** A Brief log of the inbox in its own transaction, hash32(9000 + id), encoded with the inbox's ABI. */
export function briefLog(id: number, from: Address, text: string, block: bigint): CachedLog {
  const topics = encodeEventTopics({ abi: inboxAbi, eventName: "Brief", args: { id: BigInt(id), from } }) as Hex[];
  return { blockNumber: block.toString(), logIndex: 0, transactionHash: hash32(9000 + id), topics, data: encodeAbiParameters([{ type: "string" }], [text]) };
}

/** The fixture's briefs, oldest first. */
export const BRIEF_ROWS: readonly { id: number; from: Address; text: string; block: bigint }[] = [
  { id: 1, from: ALICE, text: "buy more NVDAc", block: BRIEFS_DEPLOY + 5n },
  { id: 2, from: BOB, text: "sell it all now é", block: BRIEFS_DEPLOY + 60_000n },
  // Inside the reorg window below N: a read takes it from Base again rather than from the file.
  { id: 3, from: ALICE, text: "in the window", block: BRIEFS_BLOCK - 10n },
  // After N: only a scan finds it.
  { id: 4, from: BOB, text: "after the snapshot", block: BRIEFS_HEAD - 10n },
];

/** The fixture inbox at `head` (BRIEFS_HEAD by default): its Brief logs up to it, each in a transaction with a receipt. */
export function briefsChain(over: Partial<FakeChain> = {}): FakeChain {
  const head = over.head ?? BRIEFS_HEAD;
  const rows = BRIEF_ROWS.filter((r) => r.block <= head);
  return {
    head,
    logs: rows.map((r) => briefLog(r.id, r.from, r.text, r.block)),
    times: { [String(BRIEFS_BLOCK)]: T0, [String(head)]: T0 + 3600 },
    gas: Object.fromEntries(rows.map((r) => [hash32(9000 + r.id), 40_000n + BigInt(r.id)])),
    deployTx: { hash: BRIEFS_DEPLOY_TX, block: BRIEFS_DEPLOY },
    logAddress: BRIEFS_INBOX,
    ...over,
  };
}

/** Block N as the RPC gives it to the snapshot script. */
export const BRIEFS_AT = { number: BRIEFS_BLOCK, hash: fakeBlockHash(BRIEFS_BLOCK) } as const;
