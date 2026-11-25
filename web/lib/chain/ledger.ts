import { formatUnits, getAddress, keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import { z } from "zod";
import { isoOfDay, localTime } from "@/content/calendar";
import type { ActionName } from "@/content/decisions";
import { clockLabel, dayLabel } from "@/content/format";
import { REASONS, type ReasonCode, type RefusalCode } from "@/content/reasons";
import type { DecisionEvent, VaultEvent } from "./events";
import { canon, decodeExecuteInput, GENESIS, type DecodedBlob, type ExecuteCall } from "./rationale";
import { symbolOf } from "./tokens";

/** MandateVault.GRACE_PERIOD (7 days): how long a change can still be applied after its ETA. */
export const GRACE_PERIOD_SEC = 7 * 86_400;

/** BUY, BORROW, REPAY and PAY_EXPENSE carry USDC; the rest carry raw stock units (contracts/src/Types.sol, Intent). */
const USDC_AMOUNT: ReadonlySet<ActionName> = new Set(["BUY", "BORROW", "REPAY", "PAY_EXPENSE"]);

/** One Decision event as the timeline shows it. */
export interface MainnetDecision {
  key: string;
  blockNumber: bigint;
  txHash: Hash;
  /** Unix seconds of the block, or null when it was not read. */
  timestamp: number | null;
  /** "Thu 26 Nov 10:30" in New York, or "block N". */
  timeLabel: string;
  /** The New York date, "2026-11-26". */
  etDay: string | null;
  intentId: Hex;
  action: ActionName;
  token: Address;
  symbol: string;
  amount: bigint;
  amountLabel: string;
  allowed: boolean;
  reason: ReasonCode;
  rationaleHash: Hex;
  gasUsed: bigint | null;
}

export interface RowContext {
  /** Block number → unix seconds. */
  blockTimes: Readonly<Record<string, number>>;
  /** Tx hash → gas used, decimal. */
  gasUsed: Readonly<Record<string, string>>;
  /** Lowercased stock address → decimals. */
  decimals: Readonly<Record<string, number>>;
  usdc: Address;
}

/** "$1,234.50" from USDC units. */
export function formatUsd6(v: bigint): string {
  const sign = v < 0n ? "-" : "";
  const n = Number(v < 0n ? -v : v) / 1e6;
  return `${sign}$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "Thu 26 Nov 10:30", New York time, for unix seconds. */
export function etLabel(ts: number): string {
  const t = localTime(ts);
  return `${dayLabel(isoOfDay(t.etDay))} ${clockLabel(t.minuteOfDay)}`;
}

function when(ts: number | undefined): { timeLabel: string; etDay: string } | null {
  if (ts === undefined) return null;
  return { timeLabel: etLabel(ts), etDay: isoOfDay(localTime(ts).etDay) };
}

function amountLabel(d: DecisionEvent, symbol: string, decimals: number | undefined): string {
  if (USDC_AMOUNT.has(d.action)) return formatUsd6(d.amount);
  if (decimals === undefined) return `${d.amount} raw ${symbol}`;
  const qty = Number(formatUnits(d.amount, decimals)).toLocaleString("en-US", { maximumFractionDigits: 4 });
  return `${qty} ${symbol}`;
}

const isDecision = (e: VaultEvent): e is DecisionEvent => e.name === "Decision";

/** The vault's Decision events, newest first. */
export function toMainnetDecisions(events: readonly VaultEvent[], ctx: RowContext): MainnetDecision[] {
  return events
    .filter(isDecision)
    .map((d) => {
      const symbol = USDC_AMOUNT.has(d.action) && d.action !== "BUY" ? "USDC" : symbolOf(d.token);
      const time = when(ctx.blockTimes[d.blockNumber.toString()]);
      const gas = ctx.gasUsed[d.txHash.toLowerCase()] ?? ctx.gasUsed[d.txHash];
      return {
        key: `${d.txHash}:${d.logIndex}`,
        blockNumber: d.blockNumber,
        txHash: d.txHash,
        timestamp: ctx.blockTimes[d.blockNumber.toString()] ?? null,
        timeLabel: time?.timeLabel ?? `block ${d.blockNumber}`,
        etDay: time?.etDay ?? null,
        intentId: d.intentId,
        action: d.action,
        token: d.token,
        symbol,
        amount: d.amount,
        amountLabel: amountLabel(d, symbol, ctx.decimals[d.token.toLowerCase()]),
        allowed: d.allowed,
        reason: d.reason,
        rationaleHash: d.rationaleHash,
        gasUsed: gas === undefined ? null : BigInt(gas),
      };
    })
    .reverse();
}

export interface PendingChange {
  kind: "mandate" | "token" | "payee";
  changeHash: Hex;
  /** Unix seconds after which the owner may apply it. */
  eta: number;
  /** The token or payee the change is about. */
  subject?: Address;
  /** "waiting" before the ETA; "ready" from the ETA until the grace period ends. */
  status: "waiting" | "ready";
}

export interface Summary {
  allowed: number;
  refused: number;
  fundedUsd6: bigint;
  revenueUsd6: bigint;
  /** PAY_EXPENSE decisions the vault allowed. */
  expensesUsd6: bigint;
  /** USDC the owner withdrew. */
  withdrawnUsdcUsd6: bigint;
  /** Decisions by New York day, oldest first; decisions whose block time is unknown are left out. */
  perDay: { day: string; label: string; allowed: number; refused: number }[];
  /** Refusals by reason, most frequent first. */
  byReason: { code: RefusalCode; count: number }[];
  pending: PendingChange[];
}

export function summarize(
  events: readonly VaultEvent[],
  ctx: { blockTimes: Readonly<Record<string, number>>; usdc: Address; nowSec: number },
): Summary {
  const usdc = getAddress(ctx.usdc);
  const s: Summary = { allowed: 0, refused: 0, fundedUsd6: 0n, revenueUsd6: 0n, expensesUsd6: 0n, withdrawnUsdcUsd6: 0n, perDay: [], byReason: [], pending: [] };
  const days = new Map<string, { allowed: number; refused: number }>();
  const reasons = new Map<RefusalCode, number>();
  const queued = new Map<Hex, PendingChange & { match: string }>();

  for (const e of events) {
    switch (e.name) {
      case "Decision": {
        if (e.allowed) s.allowed += 1;
        else s.refused += 1;
        if (e.allowed && e.action === "PAY_EXPENSE") s.expensesUsd6 += e.amount;
        if (e.reason !== "OK") reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);
        const ts = ctx.blockTimes[e.blockNumber.toString()];
        if (ts !== undefined) {
          const day = isoOfDay(localTime(ts).etDay);
          const d = days.get(day) ?? { allowed: 0, refused: 0 };
          if (e.allowed) d.allowed += 1;
          else d.refused += 1;
          days.set(day, d);
        }
        break;
      }
      case "Funded":
        s.fundedUsd6 += e.amount;
        break;
      case "RevenueReceived":
        s.revenueUsd6 += e.amount;
        break;
      case "Withdrawn":
        if (e.token === usdc) s.withdrawnUsdcUsd6 += e.amount;
        break;
      case "MandateChangeQueued":
        queued.set(e.changeHash, { kind: "mandate", changeHash: e.changeHash, eta: e.eta, status: "waiting", match: e.mandateHash });
        break;
      case "TokenConfigChangeQueued":
        queued.set(e.changeHash, { kind: "token", changeHash: e.changeHash, eta: e.eta, subject: e.token, status: "waiting", match: `${e.token}|${e.configKey}` });
        break;
      case "PayeeChangeQueued":
        queued.set(e.changeHash, { kind: "payee", changeHash: e.changeHash, eta: e.eta, subject: e.payee, status: "waiting", match: `${e.payee}|${e.allowed}` });
        break;
      case "ChangeCancelled":
        queued.delete(e.changeHash);
        break;
      case "MandateApplied":
      case "TokenConfigApplied":
      case "PayeeApplied": {
        const kind = e.name === "MandateApplied" ? "mandate" : e.name === "TokenConfigApplied" ? "token" : "payee";
        const match = e.name === "MandateApplied" ? e.mandateHash : e.name === "TokenConfigApplied" ? `${e.token}|${e.configKey}` : `${e.payee}|${e.allowed}`;
        for (const [hash, q] of queued) if (q.kind === kind && q.match === match) queued.delete(hash);
        break;
      }
      default:
        break;
    }
  }

  s.perDay = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, c]) => ({ day, label: dayLabel(day), ...c }));
  s.byReason = [...reasons.entries()]
    .sort(([a, x], [b, y]) => y - x || REASONS.indexOf(a) - REASONS.indexOf(b))
    .map(([code, count]) => ({ code, count }));
  s.pending = [...queued.values()]
    .filter((q) => ctx.nowSec < q.eta + GRACE_PERIOD_SEC)
    .map(({ match: _match, ...q }) => ({ ...q, status: ctx.nowSec < q.eta ? "waiting" : "ready" }));
  return s;
}

// The agent trail of each Decision: who sent it and what its calldata carries, as the maat:v1 spec
// (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md) defines them. Section numbers are the spec's.

/** What the ledger reads of a Decision's transaction. */
export interface TxInput {
  from: Address;
  to: Address | null;
  input: Hex;
}

/** Who sent a Decision (§4). */
export type SenderLabel = "owner, by hand" | "probe" | "brief-driven" | "agent";

/**
 * The §4 label, first match wins. `owner` is immutable on the vault and only the executor may call `execute`, so a
 * Decision whose sender is the owner was sent by the owner while still the executor, whatever its calldata carries.
 */
export function senderLabel(from: Address, owner: Address, blob: DecodedBlob): SenderLabel {
  if (from.toLowerCase() === owner.toLowerCase()) return "owner, by hand";
  if (blob.status === "v1" && blob.fields.k === "probe") return "probe";
  if (blob.status === "v1" && blob.fields.q !== undefined) return "brief-driven";
  return "agent";
}

export type BuilderCodeCheck =
  /** The calldata ends with no ERC-8021 suffix. */
  | { state: "none" }
  /**
   * `reference` is the first code on the vault's first Decision, which the owner sent by hand; null while that
   * Decision has not been read, or when the owner did not send it. "reference" is that first Decision itself.
   */
  | { state: "reference" | "match" | "differs" | "no-reference"; codes: string[]; reference: string | null };

export interface DecisionTrail {
  from: Address;
  /**
   * Null while the vault's owner is unknown (its read failed), and for a transaction that is not a direct `execute`
   * call to the vault: through another contract, tx.from is not the executor, so it says nothing about who sent it.
   */
  label: SenderLabel | null;
  /** The calldata split as §1 lays it out, or null when the transaction is not a direct `execute` call to the vault. */
  call: ExecuteCall | null;
  /** keccak256 of the blob equals the Decision's rationaleHash; null when the calldata carries no blob. */
  blobHashOk: boolean | null;
  builderCode: BuilderCodeCheck;
}

const directCall = (tx: TxInput, vault: Address): ExecuteCall | null =>
  tx.to !== null && tx.to.toLowerCase() === vault.toLowerCase() ? decodeExecuteInput(tx.input) : null;

/**
 * The Builder Code each Decision is checked against: the first code on the vault's first Decision, when the owner sent
 * it. Null until the whole history has been read (`complete`), so the first Decision is known, and null when the
 * owner did not send it or its calldata carries no code.
 */
export function builderCodeReference(
  decisions: readonly MainnetDecision[],
  txs: ReadonlyMap<string, TxInput>,
  ctx: { vault: Address; owner: Address | null; complete: boolean },
): string | null {
  const first = decisions.at(-1);
  if (!ctx.complete || !first || !ctx.owner) return null;
  const tx = txs.get(first.txHash.toLowerCase());
  if (!tx || tx.from.toLowerCase() !== ctx.owner.toLowerCase()) return null;
  return directCall(tx, ctx.vault)?.codes?.[0] ?? null;
}

/** The trail of every Decision whose transaction was read, by MainnetDecision.key. */
export function decisionTrails(
  decisions: readonly MainnetDecision[],
  txs: ReadonlyMap<string, TxInput>,
  ctx: { vault: Address; owner: Address | null; complete: boolean },
): Map<string, DecisionTrail> {
  const reference = builderCodeReference(decisions, txs, ctx);
  const firstKey = decisions.at(-1)?.key;
  const out = new Map<string, DecisionTrail>();
  for (const d of decisions) {
    const tx = txs.get(d.txHash.toLowerCase());
    if (!tx) continue;
    const call = directCall(tx, ctx.vault);
    const blob: DecodedBlob = call?.blob ?? { status: "none" };
    const codes = call?.codes ?? null;
    const state = reference === null ? "no-reference" : d.key === firstKey ? "reference" : codes?.includes(reference) ? "match" : "differs";
    out.set(d.key, {
      from: tx.from,
      label: ctx.owner && call ? senderLabel(tx.from, ctx.owner, blob) : null,
      call,
      blobHashOk: call?.blobHash ? call.blobHash.toLowerCase() === d.rationaleHash.toLowerCase() : null,
      builderCode: codes === null ? { state: "none" } : { state, codes, reference },
    });
  }
  return out;
}

// The public agent-journal branch (§3.4) and the browser verifier of its hash chain (§3.6).

/** Where the publisher pushes the redacted journal. */
export const JOURNAL_BRANCH_URL = "https://github.com/duongnq2798/maat/tree/agent-journal";
/** Raw files of that branch, read without a GitHub login. */
export const JOURNAL_RAW_URL = "https://raw.githubusercontent.com/duongnq2798/maat/agent-journal/journal/";

const ROW_HASH_RE = /^0x[0-9a-f]{64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

/** One published journal line that verified. Its fields are data written elsewhere: shown as text, never followed. */
export interface JournalRow {
  file: string;
  /** 1-based line number in `file`. */
  line: number;
  hash: Hash;
  prev: Hash;
  fields: Readonly<Record<string, unknown>>;
}

export interface JournalChain {
  /** Every row that verified, in journal order, up to the first failure. */
  rows: JournalRow[];
  /** The hash of the last row that verified, or null when none did. */
  head: Hash | null;
  /** The first line that failed, or null when every line verified. */
  failure: { file: string; line: number; problem: string } | null;
}

/** Why a line fails, or its row. */
function verifyLine(text: string, prevHash: Hash): Omit<JournalRow, "file" | "line"> | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "the line is not JSON";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return "the line is not a JSON object";
  const fields = parsed as Record<string, unknown>;
  let line: string;
  try {
    line = canon(fields);
  } catch {
    return "the line holds a number that is not a safe integer";
  }
  if (line !== text) return "the line is not in canonical form";
  const { hash, ...rest } = fields;
  if (typeof hash !== "string" || !ROW_HASH_RE.test(hash)) return "hash is missing or not a lowercase 32-byte hash";
  if (typeof rest.prev !== "string" || !ROW_HASH_RE.test(rest.prev)) return "prev is missing or not a lowercase 32-byte hash";
  if (rest.prev !== prevHash) return `prev is not the hash of the line before it (${prevHash === GENESIS ? "GENESIS" : prevHash})`;
  if (keccak256(toBytes(canon(rest))) !== hash) return "hash is not keccak256 of the line's other fields";
  return { hash: hash as Hash, prev: rest.prev as Hash, fields };
}

/**
 * Checks published day files, in order (§3.6 step 2): each line is canonical JSON, its `hash` is keccak256 of its other
 * fields, and its `prev` is the hash of the line before it, GENESIS for the very first. Stops at the first failure.
 */
export function verifyJournal(files: readonly { name: string; text: string }[]): JournalChain {
  const rows: JournalRow[] = [];
  let prev: Hash = GENESIS;
  for (const { name, text } of files) {
    const fail = (line: number, problem: string): JournalChain => ({ rows, head: rows.at(-1)?.hash ?? null, failure: { file: name, line, problem } });
    if (text === "") continue;
    const lines = text.split("\n");
    const last = lines.pop();
    for (const [i, line] of lines.entries()) {
      const row = verifyLine(line, prev);
      if (typeof row === "string") return fail(i + 1, row);
      rows.push({ file: name, line: i + 1, ...row });
      prev = row.hash;
    }
    if (last !== "") return fail(lines.length + 1, "the line does not end with a line feed");
  }
  return { rows, head: rows.at(-1)?.hash ?? null, failure: null };
}

export type JournalRead =
  /** GitHub answered 404 for journal/index.json: the branch, or its index, does not exist yet. */
  | { state: "absent" }
  | { state: "error"; message: string }
  | ({ state: "read"; files: string[] } & JournalChain);

const indexSchema = z.object({ v: z.literal(1), days: z.array(z.string()) }).passthrough();

/** A day of index.json as its file name: "2026-11-26" and "2026-11-26.jsonl" both name journal/2026-11-26.jsonl. */
function dayFile(day: string): string | null {
  if (DAY_FILE_RE.test(day)) return day;
  return DAY_RE.test(day) ? `${day}.jsonl` : null;
}

/**
 * Reads the agent-journal branch (§3.6 step 1): index.json to find the day files, then every day file, and verifies
 * the chain. The index is used only to find the files; nothing it says is trusted.
 */
export async function readJournal(fetchImpl: typeof fetch = (...a) => fetch(...a), base = JOURNAL_RAW_URL): Promise<JournalRead> {
  const get = async (file: string): Promise<Response> => {
    try {
      return await fetchImpl(`${base}${file}`, { cache: "no-cache" });
    } catch {
      throw new Error(`raw.githubusercontent.com could not be reached for journal/${file}`);
    }
  };
  try {
    const res = await get("index.json");
    if (res.status === 404) return { state: "absent" };
    if (!res.ok) return { state: "error", message: `GitHub answered HTTP ${res.status} for journal/index.json` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { state: "error", message: "journal/index.json is not JSON" };
    }
    const index = indexSchema.safeParse(body);
    if (!index.success) return { state: "error", message: "journal/index.json does not have the shape the spec gives (v 1 and a list of days)" };
    const files: string[] = [];
    for (const day of index.data.days) {
      const f = dayFile(day);
      if (!f) return { state: "error", message: `journal/index.json lists ${JSON.stringify(day)}, which is not a day file` };
      files.push(f);
    }
    const texts = await Promise.all(
      files.map(async (name) => {
        const r = await get(name);
        if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status} for journal/${name}, which index.json lists`);
        return { name, text: await r.text() };
      }),
    );
    return { state: "read", files, ...verifyJournal(texts) };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether the journal holds a Decision's blob (§3.6 step 4). */
export type AnchorState = "pending" | "anchored" | "broken";

/**
 * "pending" while no verified `sent` or `reconcile` row names the transaction (the publisher has not caught up).
 * Otherwise "anchored" when the blob's `j` is GENESIS or the hash of an earlier row and, for a `sent` row, the row's
 * blob is the onchain blob; "broken" when not.
 */
export function anchorState(txHash: Hash, blob: { text: string; j: Hash }, rows: readonly JournalRow[]): AnchorState {
  const at = rows.findIndex(
    (r) => (r.fields.kind === "sent" || r.fields.kind === "reconcile") && typeof r.fields.txHash === "string" && r.fields.txHash.toLowerCase() === txHash.toLowerCase(),
  );
  if (at < 0) return "pending";
  const row = rows[at]!;
  const jOk = blob.j === GENESIS || rows.slice(0, at).some((r) => r.hash === blob.j);
  const blobOk = row.fields.kind !== "sent" || row.fields.blob === blob.text;
  return jOk && blobOk ? "anchored" : "broken";
}
