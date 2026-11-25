import { decodeEventLog, encodeFunctionData, getAddress, isAddress, isHash, type Address, type Hash, type Hex } from "viem";
import type { Deployment } from "@/lib/docs/docs-data";
import { SCAN_FLOOR_BLOCK } from "./config";
import type { LedgerClient } from "./load";
import { scanLogs } from "./scan";
import { shortAddress } from "./tokens";

// MaatInbox (contracts/src/MaatInbox.sol) as /ask reads and calls it: docs/superpowers/specs/2026-11-25-maat-inbox-design.md.

const NETWORK = "Base mainnet";
export const INBOX_CONTRACT = "MaatInbox";
/** MaatInbox.MAX_BYTES: a brief is 1 to this many bytes of text (test/ask-inbox.test.ts reads it from the source). */
export const MAX_BRIEF_BYTES = 280;

/** The inbox's surface, written from contracts/src/MaatInbox.sol (test/ask-inbox.test.ts checks it against the source). */
export const inboxAbi = [
  {
    type: "function",
    name: "brief",
    stateMutability: "nonpayable",
    inputs: [{ name: "text", type: "string", internalType: "string" }],
    outputs: [{ name: "id", type: "uint256", internalType: "uint256" }],
  },
  { type: "function", name: "lastId", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256", internalType: "uint256" }] },
  { type: "function", name: "MAX_BYTES", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256", internalType: "uint256" }] },
  {
    type: "event",
    name: "Brief",
    anonymous: false,
    inputs: [
      { name: "id", type: "uint256", indexed: true, internalType: "uint256" },
      { name: "from", type: "address", indexed: true, internalType: "address" },
      { name: "text", type: "string", indexed: false, internalType: "string" },
    ],
  },
  { type: "error", name: "BadLength", inputs: [{ name: "length", type: "uint256", internalType: "uint256" }] },
] as const;

const briefEvent = inboxAbi[3];

export interface InboxDeployment {
  inbox: Address;
  deployTx: Hash | null;
}

/** The Base mainnet MaatInbox of deployments/README.md, or null while the table has no such row or its address is empty. */
export function inboxDeployment(rows: readonly Deployment[]): InboxDeployment | null {
  const row = rows.find((r) => r.network === NETWORK && r.contract === INBOX_CONTRACT);
  const address = row?.address.trim() ?? "";
  if (!row || address === "") return null;
  if (!isAddress(address, { strict: false })) throw new Error(`deployments/README.md: MaatInbox address "${address}" is not an address`);
  const tx = row.tx.trim();
  if (tx !== "" && !isHash(tx)) throw new Error(`deployments/README.md: MaatInbox tx "${tx}" is not a transaction hash`);
  return { inbox: getAddress(address), deployTx: tx === "" ? null : (tx as Hash) };
}

export type BriefCheck = { ok: true; bytes: number } | { ok: false; bytes: number; problem: string };

/** The number of bytes `text` takes as UTF-8, the bytes the transaction carries (a lone surrogate is U+FFFD, 3 bytes). */
export function briefBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** MaatInbox.brief's own rule: 1 to 280 bytes, counted as UTF-8 bytes, not characters. */
export function checkBrief(text: string): BriefCheck {
  const bytes = briefBytes(text);
  if (bytes === 0) return { ok: false, bytes, problem: "Write a brief first: it needs at least 1 byte." };
  if (bytes > MAX_BRIEF_BYTES) return { ok: false, bytes, problem: `${bytes} bytes is over the ${MAX_BRIEF_BYTES}-byte limit.` };
  return { ok: true, bytes };
}

/** The calldata of `brief(text)`, without any suffix. Throws on a text the contract would refuse. */
export function briefCalldata(text: string): Hex {
  const check = checkBrief(text);
  if (!check.ok) throw new Error(check.problem);
  return encodeFunctionData({ abi: inboxAbi, functionName: "brief", args: [text] });
}

/**
 * The code points the agent's prompt replaces before Claude reads a brief (inbox spec §3), and /ask before it shows one:
 * every code point of general category Cc (controls) or Cf (format), or with the Default_Ignorable_Code_Point property.
 * That takes in C0 and C1 controls (DEL included), zero-width characters, direction marks, overrides and isolates, the
 * word joiner, U+FEFF, the soft hyphen, variation selectors, Hangul fillers and the tag characters U+E0000 to U+E007F.
 */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
const REPLACEMENT = String.fromCodePoint(0xfffd);

/**
 * `text` with every code point of UNSAFE replaced by U+FFFD, so a brief cannot hide text, smuggle ASCII in tag
 * characters or reorder what a reader sees: each such code point shows as a mark.
 */
export function plainBriefText(text: string): string {
  return text.replace(UNSAFE, REPLACEMENT);
}

/** One Brief event. `text` is the decoded string as sent: show it only through plainBriefText, as text. */
export interface Brief {
  id: number;
  from: Address;
  text: string;
  blockNumber: bigint;
  txHash: Hash;
  logIndex: number;
}

export interface BriefRead {
  /** In id order. */
  briefs: Brief[];
  /** False when a chunk of the log scan failed, so briefs may be missing. */
  complete: boolean;
  head: bigint;
}

async function deployBlock(client: LedgerClient, deployTx: Hash | null): Promise<bigint> {
  if (!deployTx) return SCAN_FLOOR_BLOCK;
  try {
    return (await client.getTransactionReceipt({ hash: deployTx })).blockNumber;
  } catch {
    return SCAN_FLOOR_BLOCK;
  }
}

function toBrief(log: { blockNumber: bigint | null; transactionHash: Hash | null; logIndex: number | null; topics: readonly Hex[]; data: Hex }): Brief | null {
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) return null;
  try {
    const { args } = decodeEventLog({ abi: [briefEvent], topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
    const id = Number(args.id);
    if (!Number.isSafeInteger(id)) return null;
    return { id, from: getAddress(args.from), text: args.text, blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.logIndex };
  } catch {
    return null;
  }
}

/** Every Brief the inbox emitted, from its deploy block (or SCAN_FLOOR_BLOCK when the deploy tx is unknown) to the head. */
export async function readBriefs(client: LedgerClient, opts: { inbox: Address; deployTx: Hash | null; signal?: AbortSignal }): Promise<BriefRead> {
  const head = await client.getBlockNumber();
  const from = await deployBlock(client, opts.deployTx);
  const result = await scanLogs({
    from,
    to: head,
    signal: opts.signal,
    maxFailed: 3,
    getLogs: async (r) => (await client.getLogs({ address: opts.inbox, event: briefEvent, fromBlock: r.from, toBlock: r.to })).flatMap((l) => toBrief(l as never) ?? []),
  });
  const byKey = new Map(result.logs.map((b) => [`${b.txHash.toLowerCase()}:${b.logIndex}`, b]));
  const briefs = [...byKey.values()].sort((a, b) => a.id - b.id);
  return { briefs, complete: result.failed.length === 0 && !result.stopped, head };
}

export interface ReceiptWait {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** A log as a receipt carries it. */
export interface ReceiptLog {
  address: Address;
  topics: readonly Hex[];
  data: Hex;
}

/** Asks for the receipt of `hash` every `intervalMs` until Base has it, or null once `timeoutMs` has passed. */
export async function waitForReceipt(
  client: Pick<LedgerClient, "getTransactionReceipt">,
  hash: Hash,
  opts: ReceiptWait = {},
): Promise<{ blockNumber: bigint; status: "success" | "reverted"; logs: ReceiptLog[] } | null> {
  const { timeoutMs = 120_000, intervalMs = 3000, now = Date.now } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const until = now() + timeoutMs;
  for (;;) {
    try {
      const r = await client.getTransactionReceipt({ hash });
      return { blockNumber: r.blockNumber, status: r.status, logs: (r.logs ?? []).map((l) => ({ address: l.address, topics: l.topics, data: l.data })) };
    } catch {
      // Not included yet, or the RPC failed: ask again until the time is up.
    }
    if (now() >= until) return null;
    await sleep(intervalMs);
  }
}

/**
 * The ids of the Briefs `inbox` emitted, from a receipt's logs. A smart wallet's outer transaction can succeed while
 * the brief's call inside it fails, so only a Brief log shows that a brief reached the inbox.
 */
export function briefIdsIn(logs: readonly ReceiptLog[], inbox: Address): number[] {
  return logs.flatMap((l) => {
    if (l.address.toLowerCase() !== inbox.toLowerCase()) return [];
    try {
      const { args } = decodeEventLog({ abi: [briefEvent], topics: l.topics as [Hex, ...Hex[]], data: l.data, strict: true });
      return [Number(args.id)];
    } catch {
      return [];
    }
  });
}

/** One line of the /ask feed: plain text only, never a link or markup. */
export interface FeedItem {
  id: number;
  from: Address;
  /** "0x1234…abcd". */
  sender: string;
  /** The brief through plainBriefText. */
  text: string;
  txHash: Hash;
}

/** The feed, newest first, without the briefs whose ids are on `hidden` (the owner's hide-list). */
export function briefFeed(briefs: readonly Brief[], hidden: readonly number[]): FeedItem[] {
  const skip = new Set(hidden);
  return briefs
    .filter((b) => !skip.has(b.id))
    .sort((a, b) => b.id - a.id)
    .map((b) => ({ id: b.id, from: b.from, sender: shortAddress(b.from), text: plainBriefText(b.text), txHash: b.txHash }));
}

export interface BriefCounts {
  /** Every brief read, hidden ones included: hiding never changes a count. */
  briefs: number;
  /** Distinct senders. */
  wallets: number;
  /** Briefs read whose id is on the hide-list. */
  hidden: number;
}

export function briefCounts(briefs: readonly Brief[], hidden: readonly number[]): BriefCounts {
  const skip = new Set(hidden);
  return {
    briefs: briefs.length,
    wallets: new Set(briefs.map((b) => b.from.toLowerCase())).size,
    hidden: briefs.filter((b) => skip.has(b.id)).length,
  };
}
