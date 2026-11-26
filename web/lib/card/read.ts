import { decodeEventLog, getAddress, isAddress, isHash, type Address, type Hash, type Hex } from "viem";
import { z } from "zod";
import addresses from "@/content/generated/base-addresses.json";
import { vaultAbi } from "@/lib/chain/abi";
import { SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { decodeVaultLogs, type DecisionEvent } from "@/lib/chain/events";
import { inboxAbi, type InboxDeployment } from "@/lib/chain/inbox";
import type { LedgerClient } from "@/lib/chain/load";
import { decodeExecuteInput } from "@/lib/chain/rationale";
import { scanLogs } from "@/lib/chain/scan";
import { DECISION_TOPIC } from "@/lib/gap/decisions";
import { CARD_KINDS, ordinalOf, type BriefRead, type CardRead, type ChainPosition } from "./model";

// How npm run card gets a CardRead: from Base mainnet over the ledger's keyless RPCs (read-only), or from a fixture
// file that holds a fork, simulated or preview transaction in the same JSON-RPC shapes.

/** Base mainnet USDC, as contracts/script/BaseAddresses.sol names it. */
export const BASE_USDC: Address = getAddress(addresses.find((a) => a.name === "USDC")!.value);

/** The reads a card makes of Base; the ledger's viem client (lib/chain/rpc.ts) has them, and tests pass a fake. */
export type CardClient = Pick<LedgerClient, "getTransactionReceipt" | "getTransaction" | "getBlock" | "readContract" | "getLogs">;

/** What the deployments table says a card reads: the vault and its deploy tx, and the inbox when there is one. */
export interface CardSources {
  vault: Address;
  deployTx: Hash | null;
  inbox: InboxDeployment | null;
}

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/, "a 0x hex string");
const quantity = z.union([hex, z.number().int().nonnegative()]).transform((v) => BigInt(v));
const address = z.string().refine((v) => isAddress(v, { strict: false }), "an address").transform((v) => getAddress(v));
const hash = z.string().refine((v) => isHash(v), "a 32-byte hash").transform((v) => v.toLowerCase() as Hash);

const fileSchema = z.object({
  note: z.string().optional(),
  kind: z.enum(CARD_KINDS),
  vault: address,
  owner: address.nullable(),
  usdc: address.optional(),
  receipt: z.object({
    transactionHash: hash,
    blockNumber: quantity,
    status: hex.optional(),
    logs: z.array(z.object({ address, topics: z.array(hex), data: hex, logIndex: quantity })),
  }),
  transaction: z.object({ from: address, to: address.nullable(), input: hex }),
  block: z.object({ number: quantity, timestamp: quantity }),
  /** Every Decision log of the vault from its deploy block through the Decision's block: a mainnet file needs it for № N. */
  decisionLogs: z.array(z.object({ blockNumber: quantity, logIndex: quantity, transactionHash: hash.optional() })).optional(),
  decimals: z.record(z.string(), z.number().int().nonnegative()).optional(),
  briefs: z
    .array(z.object({ id: z.number().int().nonnegative(), text: z.string().nullable(), from: address.nullable().optional(), reply: z.string().nullable().optional() }))
    .optional(),
});

/**
 * A card read from a fixture file: a recorded Base mainnet read (the tests' fixtures), or a fork, simulated or preview
 * transaction, which is printed with its band. Throws on a file that does not have the shape.
 */
export function parseCardFile(raw: unknown): CardRead {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`not a card file: ${parsed.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`).join("; ")}`);
  const f = parsed.data;
  if (f.receipt.status !== undefined && BigInt(f.receipt.status) !== 1n) throw new Error(`${f.receipt.transactionHash} reverted: a reverted transaction logs no Decision`);
  if (f.block.number !== f.receipt.blockNumber) throw new Error(`the block (${f.block.number}) is not the receipt's (${f.receipt.blockNumber})`);
  const logs = f.receipt.logs.map((l) => ({ address: l.address, topics: l.topics as Hex[], data: l.data as Hex, logIndex: Number(l.logIndex) }));
  const read: CardRead = {
    kind: f.kind,
    vault: f.vault,
    owner: f.owner,
    usdc: f.usdc ?? BASE_USDC,
    txHash: f.receipt.transactionHash,
    blockNumber: f.receipt.blockNumber,
    timestamp: Number(f.block.timestamp),
    logs,
    tx: { from: f.transaction.from, to: f.transaction.to, input: f.transaction.input as Hex },
    ordinal: null,
    decimals: Object.fromEntries(Object.entries(f.decimals ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    briefs: (f.briefs ?? []).map((b) => ({ id: b.id, text: b.text, from: b.from ?? null, reply: b.reply ?? null })),
  };
  if (f.kind !== "mainnet") return read;
  if (!f.decisionLogs) throw new Error("a mainnet card file needs decisionLogs, the vault's Decision logs from its deploy block, to number the Decision");
  return { ...read, ordinal: ordinalOf(f.decisionLogs.map((l) => ({ blockNumber: l.blockNumber, logIndex: Number(l.logIndex) })), decisionAt(read)) };
}

/** The place of the one Decision of the vault in `read`'s logs. */
function decisionAt(read: CardRead): ChainPosition {
  const own = read.logs.filter((l) => l.address.toLowerCase() === read.vault.toLowerCase() && l.topics[0]?.toLowerCase() === DECISION_TOPIC);
  if (own.length !== 1) throw new Error(`${read.txHash} holds ${own.length} Decision logs of the vault ${read.vault}; a card shows exactly one`);
  return { blockNumber: read.blockNumber, logIndex: own[0]!.logIndex };
}

/**
 * Why a file cannot be a --fixture, from its `kind`: a mainnet Decision is read from Base by its hash, never from a
 * file. Null for any other kind; parseCardFile checks the rest.
 */
export function fixtureKindProblem(raw: unknown): string | null {
  const kind = typeof raw === "object" && raw !== null ? (raw as { kind?: unknown }).kind : undefined;
  return kind === "mainnet" ? "--fixture renders a fork, simulated or preview transaction; a mainnet Decision is read from Base: npm run card -- <txhash>" : null;
}

const DECIMALS_ABI = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] }] as const;
const briefEvent = inboxAbi[3];

async function deployBlock(client: CardClient, tx: Hash | null): Promise<bigint> {
  if (tx === null) return SCAN_FLOOR_BLOCK;
  return (await client.getTransactionReceipt({ hash: tx })).blockNumber;
}

/** Every Decision log of `vault` in [from, to], in chain order. Throws when any part of the range could not be read. */
async function decisionPositions(client: CardClient, vault: Address, from: bigint, to: bigint): Promise<ChainPosition[]> {
  const result = await scanLogs({
    from,
    to,
    maxFailed: 1,
    getLogs: async (r) => (await client.getLogs({ address: vault, event: vaultAbi.find((x) => x.type === "event" && x.name === "Decision") as never, fromBlock: r.from, toBlock: r.to })) as unknown as { blockNumber: bigint | null; logIndex: number | null; removed?: boolean }[],
  });
  if (result.failed.length > 0 || result.stopped || result.scanned?.from !== from) {
    throw new Error(`the vault's Decision logs from block ${from} to ${to} could not all be read, so the Decision cannot be numbered`);
  }
  return result.logs
    .filter((l) => l.removed !== true && l.blockNumber !== null && l.logIndex !== null)
    .map((l) => ({ blockNumber: l.blockNumber!, logIndex: l.logIndex! }))
    .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

/** The briefs `ids` from the inbox's Brief logs, or none read when the deployments table has no inbox. */
async function readBriefTexts(client: CardClient, inbox: InboxDeployment | null, ids: readonly number[], to: bigint): Promise<BriefRead[]> {
  if (ids.length === 0) return [];
  if (inbox === null) return ids.map((id) => ({ id, text: null, from: null, reply: null }));
  const from = await deployBlock(client, inbox.deployTx);
  const result = await scanLogs({
    from,
    to,
    maxFailed: 1,
    getLogs: async (r) => (await client.getLogs({ address: inbox.inbox, event: briefEvent, fromBlock: r.from, toBlock: r.to })) as unknown as { topics: Hex[]; data: Hex }[],
  });
  const found = new Map<number, { text: string; from: Address }>();
  for (const l of result.logs) {
    try {
      const { args } = decodeEventLog({ abi: [briefEvent], topics: l.topics as [Hex, ...Hex[]], data: l.data, strict: true });
      found.set(Number(args.id), { text: args.text, from: getAddress(args.from) });
    } catch {
      // Not a Brief log: nothing to read from it.
    }
  }
  // The reply is the agent's journal row, which the card does not read from Base.
  return ids.map((id) => ({ id, text: found.get(id)?.text ?? null, from: found.get(id)?.from ?? null, reply: null }));
}

/**
 * Reads one Base mainnet transaction the way /ledger reads a Decision: its receipt, its sender and calldata, its block's
 * time, the vault's owner, and every Decision log of the vault from its deploy block through this one, to number it.
 */
export async function readMainnetCard(client: CardClient, txHash: Hash, src: CardSources): Promise<CardRead> {
  const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getTransaction({ hash: txHash })]);
  if (receipt.status !== "success") throw new Error(`${txHash} reverted: a reverted transaction logs no Decision`);
  const logs = receipt.logs.map((l) => ({ address: l.address, topics: [...l.topics] as Hex[], data: l.data, logIndex: l.logIndex ?? -1 }));
  const base: CardRead = {
    kind: "mainnet",
    vault: src.vault,
    owner: null,
    usdc: BASE_USDC,
    txHash: txHash.toLowerCase() as Hash,
    blockNumber: receipt.blockNumber,
    timestamp: 0,
    logs,
    tx: { from: getAddress(tx.from), to: tx.to ? getAddress(tx.to) : null, input: tx.input },
    ordinal: null,
    decimals: {},
    briefs: [],
  };
  const at = decisionAt(base);
  const [block, owner, floor] = await Promise.all([
    client.getBlock({ blockNumber: receipt.blockNumber }),
    client.readContract({ address: src.vault, abi: vaultAbi, functionName: "owner" }).then((o) => getAddress(o as Address)),
    deployBlock(client, src.deployTx),
  ]);
  const ordinal = ordinalOf(await decisionPositions(client, src.vault, floor, receipt.blockNumber), at);

  const [event] = decodeVaultLogs(logs.filter((l) => l.logIndex === at.logIndex).map((l) => ({ ...l, blockNumber: receipt.blockNumber.toString(), transactionHash: base.txHash }))) as DecisionEvent[];
  const decimals: Record<string, number> = {};
  if (event && event.action !== "BUY" && event.action !== "PAY_EXPENSE" && event.action !== "BORROW" && event.action !== "REPAY") {
    decimals[event.token.toLowerCase()] = Number(await client.readContract({ address: event.token, abi: DECIMALS_ABI, functionName: "decimals" }));
  }
  // Only a blob whose keccak256 is the Decision's rationaleHash names briefs, as on /ledger: an unverified one reads none.
  const call = base.tx.to?.toLowerCase() === src.vault.toLowerCase() ? decodeExecuteInput(base.tx.input) : null;
  const verified = event !== undefined && call !== null && call.blobHash !== null && call.blobHash.toLowerCase() === event.rationaleHash.toLowerCase();
  const ids = verified && call.blob.status === "v1" ? (call.blob.fields.q ?? []) : [];
  const briefs = await readBriefTexts(client, src.inbox, ids, receipt.blockNumber);
  return { ...base, owner, timestamp: Number(block.timestamp), ordinal, decimals, briefs };
}
