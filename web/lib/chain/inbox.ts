import { decodeEventLog, encodeFunctionData, getAddress, isAddress, isHash, type AbiEvent, type Address, type Hash, type Hex } from "viem";
import addresses from "@/content/generated/base-addresses.json";
import { reasonText, type ReasonCode } from "@/content/reasons";
import type { Deployment } from "@/lib/docs/docs-data";
import { vaultAbi } from "./abi";
import type { CachedLog } from "./cache";
import { SCAN_FLOOR_BLOCK } from "./config";
import { decodeVaultLogs } from "./events";
import { decisionTrails, toMainnetDecisions, type DecisionTrail, type MainnetDecision, type TxInput } from "./ledger";
import { confirmBriefsSnapshot, MAX_FAILED, readBriefsSnapshot, type LedgerClient, type TakenSnapshot } from "./load";
import { COMMIT_RE } from "./rationale";
import { scanLogs, type BlockRange } from "./scan";
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
  /**
   * The committed Brief snapshot this read took the logs of blocks [from, to] from, once Base gave its block N the hash
   * it records and each of those logs' receipts held it; null when every block was read from Base.
   */
  fromSnapshot: { block: bigint; from: bigint; to: bigint } | null;
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

/** The parts of [from, to] outside `covered`, newest first. */
function uncovered(from: bigint, to: bigint, covered: BlockRange | null): BlockRange[] {
  if (!covered || covered.to < from || covered.from > to) return from <= to ? [{ from, to }] : [];
  const out: BlockRange[] = [];
  if (covered.to < to) out.push({ from: covered.to + 1n, to });
  if (covered.from > from) out.push({ from, to: covered.from - 1n });
  return out;
}

/**
 * Every Brief the inbox emitted, from its deploy block (or SCAN_FLOOR_BLOCK when the deploy tx is unknown) to `head`,
 * the head block when it is not given, `concurrency` chunks at a time (scanLogs' default when it is not given).
 *
 * `snapshot` is the committed Brief snapshot (/data/briefs-snapshot.json, parsed JSON, or a promise of it). Once Base
 * gives its block N the hash the file records, N is not above `head`, and the receipt of each log below
 * N - SNAPSHOT_REORG_WINDOW holds that log of the inbox, the read takes those logs from the file and scans only the
 * blocks the file does not stand for: from N minus the window to the head, newest first. Without one, or with one that
 * fails that check, it scans from the deploy block. So the file can leave a brief out but cannot add or change one.
 */
export async function readBriefs(
  client: LedgerClient,
  opts: { inbox: Address; deployTx: Hash | null; head?: bigint; signal?: AbortSignal; concurrency?: number; snapshot?: unknown },
): Promise<BriefRead> {
  const file = readBriefsSnapshot(opts.snapshot, opts.inbox);
  // The file is checked while the head and the deploy block are read.
  const confirmed = file.then((s) => (s ? confirmBriefsSnapshot(client, opts.inbox, s) : null)).catch(() => null);
  const [head, from, taken] = await Promise.all([opts.head ?? client.getBlockNumber(), deployBlock(client, opts.deployTx), confirmed]);
  const seed: TakenSnapshot | null = taken && taken.block <= head ? taken : null;

  const found: Brief[] = seed ? seed.logs.flatMap((l) => toBrief({ ...l, blockNumber: BigInt(l.blockNumber) }) ?? []) : [];
  let failed = 0;
  let stopped = false;
  for (const gap of uncovered(from, head, seed && { from: seed.from, to: seed.to })) {
    if (failed >= MAX_FAILED) {
      stopped = true;
      break;
    }
    const result = await scanLogs({
      ...gap,
      signal: opts.signal,
      concurrency: opts.concurrency,
      maxFailed: MAX_FAILED - failed,
      getLogs: async (r) => (await client.getLogs({ address: opts.inbox, event: briefEvent, fromBlock: r.from, toBlock: r.to })).flatMap((l) => toBrief(l as never) ?? []),
    });
    found.push(...result.logs);
    failed += result.failed.length;
    stopped ||= result.stopped;
  }
  const byKey = new Map(found.map((b) => [`${b.txHash.toLowerCase()}:${b.logIndex}`, b]));
  const briefs = [...byKey.values()].sort((a, b) => a.id - b.id);
  return { briefs, complete: failed === 0 && !stopped, head, fromSnapshot: seed && { block: seed.block, from: seed.from, to: seed.to } };
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

/** Where an answer is in the published journal: its day file, its 1-based line, and the agent commit the row carries. */
export interface JournalRef {
  file: string;
  line: number;
  /** The row's `commit` when COMMIT_RE accepts it (a clean HEAD, that HEAD and `-dirty`, or `unknown`); else null. */
  commit: string | null;
}

/**
 * What the agent journaled for one brief (journal kind "brief", agent/src/briefs/round.ts): Claude's reply, sanitized
 * by the agent to 200 characters; a brief Claude was sent but gave no usable reply; or a brief a cap kept from Claude,
 * with the cap's name. `adopted` is true when an intent of that answer cites the brief in its blob's q and went to the
 * vault (a send, or a dry run's preview). `row` is the journal line it came from.
 */
export type BriefAnswer = (
  | { outcome: "replied"; reply: string; adopted: boolean }
  | { outcome: "unanswered"; adopted: boolean }
  | { outcome: "skipped"; cap: string }
) & { row: JournalRef };

/**
 * The agent's answer to each brief, by id, from the brief rows of the published journal. A row names its brief by
 * (id, txHash, logIndex): a row whose log is not among `briefs`, because a reorg dropped it or another brief took its
 * id, is dropped, so an answer never attaches to another brief. The first well-formed row for a brief wins.
 */
export function briefAnswers(
  rows: readonly { file: string; line: number; fields: Readonly<Record<string, unknown>> }[],
  briefs: readonly Brief[],
): Map<number, BriefAnswer> {
  const live = new Map(briefs.map((b) => [`${b.id}:${b.txHash.toLowerCase()}:${b.logIndex}`, b.id]));
  const out = new Map<number, BriefAnswer>();
  for (const { file, line, fields: f } of rows) {
    if (f.kind !== "brief" || typeof f.briefId !== "number" || typeof f.txHash !== "string" || typeof f.logIndex !== "number") continue;
    const id = live.get(`${f.briefId}:${f.txHash.toLowerCase()}:${f.logIndex}`);
    if (id === undefined || out.has(id)) continue;
    const adopted = f.adopted === true;
    const row: JournalRef = { file, line, commit: typeof f.commit === "string" && COMMIT_RE.test(f.commit) ? f.commit : null };
    if (f.outcome === "replied" && typeof f.reply === "string") out.set(id, { outcome: "replied", reply: plainBriefText(f.reply), adopted, row });
    else if (f.outcome === "unanswered") out.set(id, { outcome: "unanswered", adopted, row });
    else if (f.outcome === "skipped" && typeof f.cap === "string") out.set(id, { outcome: "skipped", cap: f.cap, row });
  }
  return out;
}

// The vault's verdict on a brief: the brief-keyed Decision logs. A brief-driven Decision is one /ledger labels
// "brief-driven" (lib/chain/ledger.ts senderLabel: not the owner's, not a probe, its blob's q present), whose blob
// hashes to the Decision's rationaleHash. The agent appends that verdict from the receipt; Claude never writes it, since
// Claude replies before the vault decides.

/** A brief-driven Decision, as the vault's Decision log and its transaction give it. */
export interface BriefVerdict {
  txHash: Hash;
  blockNumber: bigint;
  logIndex: number;
  allowed: boolean;
  reason: ReasonCode;
  /** The brief ids the blob's q cites, ascending. */
  q: readonly number[];
}

/** Each brief id cited by a brief-driven Decision, with those Decisions, oldest first. */
export function briefVerdicts(decisions: readonly MainnetDecision[], trails: ReadonlyMap<string, DecisionTrail>): Map<number, BriefVerdict[]> {
  const out = new Map<number, BriefVerdict[]>();
  const oldestFirst = [...decisions].sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));
  for (const d of oldestFirst) {
    const trail = trails.get(d.key);
    const blob = trail?.call?.blob;
    if (trail?.label !== "brief-driven" || trail.blobHashOk !== true || blob?.status !== "v1" || !blob.fields.q) continue;
    const logIndex = Number(d.key.slice(d.key.lastIndexOf(":") + 1));
    const v: BriefVerdict = { txHash: d.txHash, blockNumber: d.blockNumber, logIndex, allowed: d.allowed, reason: d.reason, q: blob.fields.q };
    for (const id of blob.fields.q) out.set(id, [...(out.get(id) ?? []), v]);
  }
  return out;
}

export interface VerdictRead {
  /** By brief id, oldest Decision first. */
  byBrief: ReadonlyMap<number, readonly BriefVerdict[]>;
  /** False when a chunk of the Decision logs, or a Decision's transaction, could not be read: a verdict may be missing. */
  complete: boolean;
}

const decisionEvent = vaultAbi.find((x) => x.type === "event" && x.name === "Decision") as AbiEvent;
const USDC = getAddress(addresses.find((a) => a.name === "USDC")!.value);

/**
 * The brief-keyed Decisions of `vault` from block `from` (the first brief's: no Decision before it can cite a brief)
 * to `head`: its owner(), which tells the owner's Decisions apart, every Decision log, and the transaction of each, whose
 * calldata carries the blob. Throws when owner() cannot be read.
 */
export async function readBriefVerdicts(
  client: LedgerClient,
  opts: { vault: Address; from: bigint; head: bigint; signal?: AbortSignal; concurrency?: number },
): Promise<VerdictRead> {
  const owner = getAddress((await client.readContract({ address: opts.vault, abi: vaultAbi, functionName: "owner" })) as Address);
  const scan = await scanLogs<CachedLog>({
    from: opts.from,
    to: opts.head,
    signal: opts.signal,
    concurrency: opts.concurrency,
    maxFailed: 3,
    getLogs: async (r) =>
      (await client.getLogs({ address: opts.vault, event: decisionEvent, fromBlock: r.from, toBlock: r.to })).flatMap((l) =>
        l.blockNumber === null || l.transactionHash === null || l.logIndex === null
          ? []
          : [{ blockNumber: l.blockNumber.toString(), logIndex: l.logIndex, transactionHash: l.transactionHash, topics: [...l.topics] as Hex[], data: l.data }],
      ),
  });
  const byKey = new Map(scan.logs.map((l) => [`${l.transactionHash.toLowerCase()}:${l.logIndex}`, l]));
  const decisions = toMainnetDecisions(decodeVaultLogs([...byKey.values()]), { blockTimes: {}, gasUsed: {}, decimals: {}, usdc: USDC });
  const txs = new Map<string, TxInput>();
  let missing = 0;
  await Promise.all(
    [...new Set(decisions.map((d) => d.txHash.toLowerCase()))].map(async (hash) => {
      try {
        const t = await client.getTransaction({ hash: hash as Hash });
        txs.set(hash, { from: getAddress(t.from), to: t.to ? getAddress(t.to) : null, input: t.input });
      } catch {
        missing += 1;
      }
    }),
  );
  const trails = decisionTrails(decisions, txs, { vault: opts.vault, owner, complete: false });
  return { byBrief: briefVerdicts(decisions, trails), complete: scan.failed.length === 0 && !scan.stopped && missing === 0 };
}

// The /ask feed as weighings (culture plan Move 1): the brief, the reply Maat's agent journaled, whether Claude was
// persuaded, then the vault's verdict. Each piece names its own source, and a missing one says so in plain words.

/** The published journal as the page has read it: its answers once read, "absent" while the branch does not exist. */
export type JournalSource =
  | { state: "reading" }
  | { state: "absent" }
  | { state: "error"; message: string }
  /** `complete` is false when a line failed the chain check, so rows after it are not read. */
  | { state: "read"; answers: ReadonlyMap<number, BriefAnswer>; complete: boolean };

export type VerdictSource = { state: "reading" } | { state: "error"; message: string } | ({ state: "read" } & VerdictRead);

/** /proof's team set, traced at the block the briefs were read to. `members` are lowercased; `complete` is false on a gap. */
export type TeamSource = { state: "reading" } | { state: "error"; message: string } | { state: "read"; members: ReadonlySet<string>; complete: boolean };

export interface WeighingSources {
  /** Every brief read, hidden ones included. */
  briefs: readonly Brief[];
  /** The owner's hide-list: ids left out of the feed, still counted. */
  hidden: readonly number[];
  journal: JournalSource;
  verdicts: VerdictSource;
  team: TeamSource;
}

/** One verdict line: the vault's Decision in the verdict grammar, or what stands in for a Decision not found. */
export interface VerdictLine {
  state: "allowed" | "refused" | "none";
  /** "Refused · Market closed (MARKET_CLOSED)", "Allowed · All checks passed (OK)", or why there is none. */
  text: string;
  decision: { txHash: Hash; blockNumber: bigint } | null;
}

/** One brief of the feed as a weighing. Every text is plain text, shown as a string child, never as a link or markup. */
export interface Weighing {
  id: number;
  from: Address;
  /** "0x1234…abcd". */
  sender: string;
  /** The brief through plainBriefText. */
  text: string;
  txHash: Hash;
  /** Whether the sender is in /proof's team set; null while that set is not read, or its trace is incomplete. */
  team: boolean | null;
  reply: { state: "replied" | "unanswered" | "skipped" | "none"; text: string; row: JournalRef | null };
  persuaded: { state: "yes" | "no" | "none"; text: string };
  /** At least one line: each brief-driven Decision that cites the brief, oldest first, or one that says why there is none. */
  verdicts: readonly VerdictLine[];
}

/** What each cap the agent journals a skipped brief with means (agent/src/briefs/caps.ts BRIEF_CAPS). */
export const CAP_TEXT: Readonly<Record<string, string>> = {
  "llm-per-day": "the agent's daily Claude cap was reached",
  "brief-llm-per-day": "the daily Claude budget for briefs was spent",
  "brief-txs-per-day": "the daily budget of brief-driven transactions was spent",
  "briefs-per-day": "the daily cap on briefs was reached",
  "briefs-per-sender": "its sender's daily cap was reached",
};

const isTeam = (team: TeamSource, from: Address): boolean | null =>
  team.state === "read" && team.complete ? team.members.has(from.toLowerCase()) : null;

function replyOf(answer: BriefAnswer | undefined, journal: JournalSource): Weighing["reply"] {
  if (answer?.outcome === "replied") return { state: "replied", text: `Maat's agent replied: ${answer.reply}`, row: answer.row };
  if (answer?.outcome === "unanswered") return { state: "unanswered", text: "Maat's agent sent it to Claude, which gave no reply.", row: answer.row };
  if (answer?.outcome === "skipped") {
    return { state: "skipped", text: `Maat's agent did not send it to Claude: ${CAP_TEXT[answer.cap] ?? "a daily cap was reached"}.`, row: answer.row };
  }
  // While the journal is not published, a reply may already be in it: say the journal is missing, not the reply.
  const why =
    journal.state === "reading"
      ? "reading its journal…"
      : journal.state === "error"
        ? "its journal could not be read."
        : journal.state === "absent"
          ? "its journal is not published yet."
          : !journal.complete
            ? "no reply in the part of its journal that verified."
            : "no reply yet.";
  return { state: "none", text: `Maat's agent: ${why}`, row: null };
}

/**
 * Whether the brief's journal row is final and no intent took it to the vault: a skip by a cap, or a brief sent to
 * Claude that no intent adopted. The agent sends Claude only briefs it has recorded no outcome for (agent/src/briefs/
 * round.ts: only those are fresh), and an intent adopts only briefs sent in its own round, so no later
 * intent of the agent's cites it. A Decision found that cites it still wins (verdictsOf).
 */
const notSent = (answer: BriefAnswer | undefined): boolean => answer !== undefined && (answer.outcome === "skipped" || !answer.adopted);

function persuadedOf(answer: BriefAnswer | undefined): Weighing["persuaded"] {
  if (!answer) return { state: "none", text: "Claude persuaded: not known yet" };
  return answer.outcome !== "skipped" && answer.adopted
    ? { state: "yes", text: "Claude persuaded: yes, adopted into an intent" }
    : { state: "no", text: "Claude persuaded: no" };
}

/**
 * The vault's verdicts on brief `id`: every brief-driven Decision that cites it, which always wins over the journal.
 * With none found in a complete read, a brief whose journal row is final and not adopted says no intent took it to the
 * vault; any other brief is not weighed yet.
 */
function verdictsOf(id: number, verdicts: VerdictSource, answer: BriefAnswer | undefined): VerdictLine[] {
  const found = verdicts.state === "read" ? (verdicts.byBrief.get(id) ?? []) : [];
  if (found.length > 0) {
    return found.map((v) => ({
      state: v.allowed ? "allowed" : "refused",
      text: `${v.allowed ? "Allowed" : "Refused"} · ${reasonText(v.reason)}`,
      decision: { txHash: v.txHash, blockNumber: v.blockNumber },
    }));
  }
  const text =
    verdicts.state === "reading"
      ? "reading the vault's Decisions…"
      : verdicts.state === "error"
        ? "the vault's Decisions could not be read"
        : !verdicts.complete
          ? "not found yet: some of the vault's Decisions could not be read"
          : notSent(answer)
            ? "none, no intent took it to the vault"
            : "not weighed yet";
  return [{ state: "none", text, decision: null }];
}

/** The feed, newest first, without the briefs on the hide-list, each brief as a weighing. */
export function weighings(s: WeighingSources): Weighing[] {
  const skip = new Set(s.hidden);
  const answers = s.journal.state === "read" ? s.journal.answers : new Map<number, BriefAnswer>();
  return s.briefs
    .filter((b) => !skip.has(b.id))
    .sort((a, b) => b.id - a.id)
    .map((b) => {
      const answer = answers.get(b.id);
      return {
        id: b.id,
        from: b.from,
        sender: shortAddress(b.from),
        text: plainBriefText(b.text),
        txHash: b.txHash,
        team: isTeam(s.team, b.from),
        reply: replyOf(answer, s.journal),
        persuaded: persuadedOf(answer),
        verdicts: verdictsOf(b.id, s.verdicts, answer),
      };
    });
}

/** A counter: its number, a read still going ("…" on the page), or why it has no number, shown in its place. */
export type CountValue = { value: number } | { reading: true } | { missing: string };

export interface WeighingLine {
  briefs: CountValue;
  wallets: CountValue;
  /** Briefs whose journal row says an intent adopted them. */
  persuaded: CountValue;
  /** Briefs cited by a brief-driven Decision the vault allowed. */
  allowed: CountValue;
  /** Briefs cited only by brief-driven Decisions the vault refused. */
  refused: CountValue;
}

export interface WeighingCounts {
  /** Senders outside /proof's team set. */
  outside: WeighingLine;
  /** The team's own briefs, on their own line, never added to the outside line. */
  team: WeighingLine;
  /** Every brief and distinct sender read from the inbox's logs, team included: these need no other source. */
  all: { briefs: number; wallets: number };
  /** Briefs read whose id is on the hide-list. They are in every count. */
  hidden: number;
}

const n = (value: number): CountValue => ({ value });

/** What a counter says in place of its source's number while that source is not there. */
function sourceGap(source: JournalSource | VerdictSource | TeamSource, words: { error: string; absent?: string }): CountValue | null {
  if (source.state === "reading") return { reading: true };
  if (source.state === "error") return { missing: words.error };
  if (source.state === "absent") return { missing: words.absent ?? words.error };
  return source.complete ? null : { missing: "incomplete" };
}

/**
 * The counters, each brief counted once: briefs and wallets from the Brief logs, split into outside and team by /proof's
 * team set; Claude persuaded from the journal's adopted flags; vault allowed and vault refused from the brief-keyed
 * Decisions, a brief that any allowed Decision cites counting as allowed and one that only refused Decisions cite as
 * refused. A hidden brief still counts. With no brief every counter is 0, whatever the sources; otherwise a counter
 * whose source is missing, or does not split by the team set, says why instead of giving a number.
 */
export function weighingCounts(s: WeighingSources): WeighingCounts {
  const skip = new Set(s.hidden);
  const all = { briefs: s.briefs.length, wallets: new Set(s.briefs.map((b) => b.from.toLowerCase())).size };
  const hidden = s.briefs.filter((b) => skip.has(b.id)).length;
  const line = (briefs: readonly Brief[]): WeighingLine => {
    if (s.briefs.length === 0) return { briefs: n(0), wallets: n(0), persuaded: n(0), allowed: n(0), refused: n(0) };
    const split = sourceGap(s.team, { error: "team set not read" });
    if (split) return { briefs: split, wallets: split, persuaded: split, allowed: split, refused: split };
    const journal = sourceGap(s.journal, { error: "journal not read", absent: "no journal yet" });
    const verdicts = sourceGap(s.verdicts, { error: "not read" });
    const answers = s.journal.state === "read" ? s.journal.answers : new Map<number, BriefAnswer>();
    const byBrief = s.verdicts.state === "read" ? s.verdicts.byBrief : new Map<number, readonly BriefVerdict[]>();
    const weighed = briefs.map((b) => byBrief.get(b.id) ?? []).filter((v) => v.length > 0);
    return {
      briefs: n(briefs.length),
      wallets: n(new Set(briefs.map((b) => b.from.toLowerCase())).size),
      persuaded: journal ?? n(briefs.filter((b) => persuadedOf(answers.get(b.id)).state === "yes").length),
      allowed: verdicts ?? n(weighed.filter((v) => v.some((d) => d.allowed)).length),
      refused: verdicts ?? n(weighed.filter((v) => v.every((d) => !d.allowed)).length),
    };
  };
  const team = s.team.state === "read" ? s.team.members : new Set<string>();
  return {
    outside: line(s.briefs.filter((b) => !team.has(b.from.toLowerCase()))),
    team: line(s.briefs.filter((b) => team.has(b.from.toLowerCase()))),
    all,
    hidden,
  };
}
