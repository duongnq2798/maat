import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeEventLog, getAddress, isAddress, isHash, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { firstInLogWindows } from "../chain/logWindows.js";
import { MAX_BRIEFS_PER_DAY, MAX_BRIEFS_PER_ROUND, MAX_BRIEFS_PER_SENDER_PER_DAY } from "./caps.js";

/*
 * MaatInbox as the agent reads it (docs/superpowers/specs/2026-11-25-maat-inbox-design.md §3): the address recorded in
 * deployments/README.md, and its Brief logs up to the safe block, read through the windowed getLogs of
 * chain/logWindows.ts. No recorded address, no briefs: nothing here is called.
 */

/** deployments/README.md, the record table the docs and /ask read too, found from this file. */
export const DEPLOYMENTS_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "deployments", "README.md");
const NETWORK = "Base mainnet";
export const INBOX_CONTRACT = "MaatInbox";

/** contracts/src/MaatInbox.sol's event. */
export const BRIEF_EVENT = parseAbiItem("event Brief(uint256 indexed id, address indexed from, string text)");

export interface InboxRecord {
  inbox: Address;
  /** The deploy transaction; the agent's first read starts at its block. Null while the Tx cell is empty. */
  deployTx: Hex | null;
}

/** A cell's text: a link gives its text, and code marks are dropped (web/lib/docs/docs-data.ts parseDeployments). */
const cellText = (c: string) =>
  c
    .trim()
    .replace(/^\[([^\]]*)\]\([^)]*\)$/, "$1")
    .replace(/^`([^`]*)`$/, "$1");

/**
 * The Base mainnet MaatInbox row of the table in deployments/README.md (Network | Contract | Address | Tx | Date), or
 * null while there is no such row or its address is empty. Throws when the row's address or tx is not one.
 */
export function inboxRecord(markdown: string): InboxRecord | null {
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const [network, contract, address = "", tx = ""] = line.trim().replace(/^\||\|$/g, "").split("|").map(cellText);
    if (network !== NETWORK || contract !== INBOX_CONTRACT) continue;
    if (address === "") return null;
    if (!isAddress(address, { strict: false })) throw new Error(`MaatInbox address "${address}" is not an address`);
    if (tx !== "" && !isHash(tx)) throw new Error(`MaatInbox tx "${tx}" is not a transaction hash`);
    return { inbox: getAddress(address), deployTx: tx === "" ? null : (tx.toLowerCase() as Hex) };
  }
  return null;
}

/** inboxRecord of `file`; null when the file does not exist. */
export function readInboxRecord(file: string = DEPLOYMENTS_FILE): InboxRecord | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return inboxRecord(text);
}

/** The line main.ts prints at start: whether the agent reads briefs, and why not when it does not. */
export function briefsLine(o: { record: InboxRecord | null; problem?: string }): string {
  const off = (why: string) => `maat agent: briefs=off: ${why}, so no inbox log is read`;
  if (o.problem !== undefined) return off(`deployments/README.md: ${o.problem}`);
  if (o.record === null) return off(`deployments/README.md records no ${INBOX_CONTRACT}`);
  if (o.record.deployTx === null) return off(`deployments/README.md records ${INBOX_CONTRACT} ${o.record.inbox} with no deploy tx`);
  return (
    `maat agent: briefs=on: ${INBOX_CONTRACT} ${o.record.inbox}, Brief logs read up to the safe block, at most ` +
    `${MAX_BRIEFS_PER_ROUND} a round, ${MAX_BRIEFS_PER_DAY} a day and ${MAX_BRIEFS_PER_SENDER_PER_DAY} per sender a day`
  );
}

/** What the agent reads briefs with: the safe block, the inbox's logs and its deploy transaction. */
export type BriefClient = Pick<PublicClient, "getBlock" | "getLogs" | "getTransaction">;

/** One Brief log. Its identity is (id, txHash, logIndex): a reorg that re-mines id 7 in another tx makes another brief. */
export interface Brief {
  id: number;
  from: Address;
  /** The text as sent, decoded leniently (invalid UTF-8 becomes U+FFFD). Claude sees it only through promptText. */
  text: string;
  block: bigint;
  txHash: Hex;
  logIndex: number;
}

/** The key a brief is stored and journaled under: `${id}:${txHash}:${logIndex}`, the hash in lowercase. */
export function briefKey(b: Pick<Brief, "id" | "txHash" | "logIndex">): string {
  return `${b.id}:${b.txHash.toLowerCase()}:${b.logIndex}`;
}

/** The block the `safe` tag names: no brief past it is read, so a shallow reorg cannot reach one the agent answered. */
export async function safeBlock(client: Pick<BriefClient, "getBlock">): Promise<bigint> {
  const b = await client.getBlock({ blockTag: "safe" });
  if (b.number === null) throw new Error("the safe block has no number");
  return b.number;
}

type RawLog = { topics: readonly Hex[]; data: Hex; blockNumber: bigint | null; transactionHash: Hex | null; logIndex: number | null };

function toBrief(l: RawLog): Brief | null {
  if (l.blockNumber === null || l.transactionHash === null || l.logIndex === null) return null;
  try {
    const { args } = decodeEventLog({ abi: [BRIEF_EVENT], topics: l.topics as [Hex, ...Hex[]], data: l.data, strict: true });
    const id = Number(args.id);
    if (!Number.isSafeInteger(id)) return null;
    return { id, from: getAddress(args.from), text: args.text, block: l.blockNumber, txHash: l.transactionHash, logIndex: l.logIndex };
  } catch {
    return null;
  }
}

/**
 * Every Brief log `inbox` emitted in blocks [from, to], in id order, read in windows of at most MAX_LOG_RANGE blocks
 * that halve down to MIN_LOG_RANGE on a range error. Any other error is thrown: a partial read would answer a later
 * brief before an earlier one.
 */
export async function readBriefLogs(client: Pick<BriefClient, "getLogs">, inbox: Address, from: bigint, to: bigint): Promise<Brief[]> {
  const out: Brief[] = [];
  await firstInLogWindows(from, to, async ({ fromBlock, toBlock }) => {
    const logs = await client.getLogs({ address: inbox, event: BRIEF_EVENT, fromBlock, toBlock });
    for (const l of logs as readonly RawLog[]) {
      const b = toBrief(l);
      if (b) out.push(b);
    }
    return undefined;
  });
  return out.sort((a, b) => a.id - b.id || (a.block < b.block ? -1 : a.block > b.block ? 1 : a.logIndex - b.logIndex));
}

/**
 * What main.ts starts with: the MaatInbox deployments/README.md records (null for none, or for a row it cannot read)
 * and the start line that says whether the agent reads briefs. A row it cannot read turns briefs off, never the agent.
 */
export function inboxSetup(file: string = DEPLOYMENTS_FILE): { record: InboxRecord | null; line: string } {
  try {
    const record = readInboxRecord(file);
    return { record, line: briefsLine({ record }) };
  } catch (e) {
    return { record: null, line: briefsLine({ record: null, problem: e instanceof Error ? e.message : String(e) }) };
  }
}
