import { isoOfDay, localTime } from "@/content/calendar";
import type { Bill } from "@/content/bill";
import { ACTIONS, type ActionName } from "@/content/decisions";
import { FACTS, type RecordedLog } from "@/content/facts";
import { clockLabel, dayLabel } from "@/content/format";
import addresses from "@/content/generated/base-addresses.json";
import { REASONS, type ReasonCode } from "@/content/reasons";
import type { MainnetDecision } from "@/lib/chain/ledger";

/**
 * One Decision of the mainnet vault as the landing shows it. Plain values only: the landing ships no ABI decoder in its
 * first load, so the recorded Decisions are read by the small decoder below and the live ones by the ledger's loader,
 * which the landing loads after it has painted (VaultDecisions.tsx).
 */
export interface VaultRow {
  key: string;
  txHash: `0x${string}`;
  /** Decimal. */
  block: string;
  /** Unix seconds of the block, or null when it was not read. */
  timestamp: number | null;
  /** "Tue 24 Nov 11:59" in New York, or "block N". */
  timeLabel: string;
  action: ActionName;
  symbol: string;
  /** "$5.00" for a USDC amount. */
  amountLabel: string;
  allowed: boolean;
  reason: ReasonCode;
  /** Decimal, or null when the receipt was not read. */
  gasUsed: string | null;
  /** For a PAY_EXPENSE, what is known of the bill (content/bill.ts); null for every other action. */
  bill: Bill | null;
}

/** What the live read knows of a PAY_EXPENSE beyond its log: whether its blob is a bill's, its payee, the vault's owner. */
export interface BillContext {
  compute?: boolean;
  payee?: string | null;
  owner?: string | null;
}

function billOf(action: ActionName, amountLabel: string, allowed: boolean, ctx: BillContext): Bill | null {
  if (action !== "PAY_EXPENSE") return null;
  return { name: ctx.compute ? "Compute bill" : "Expense", amount: amountLabel, allowed, payee: ctx.payee ?? null, owner: ctx.owner ?? null };
}

/** A live Decision from the ledger's loader (lib/chain/ledger.ts) as a row; vault-live.ts gives a bill its context. */
export function toVaultRow(d: MainnetDecision, bill: BillContext = {}): VaultRow {
  return {
    key: d.key,
    txHash: d.txHash,
    block: d.blockNumber.toString(),
    timestamp: d.timestamp,
    timeLabel: d.timeLabel,
    action: d.action,
    symbol: d.symbol,
    amountLabel: d.amountLabel,
    allowed: d.allowed,
    reason: d.reason,
    gasUsed: d.gasUsed === null ? null : d.gasUsed.toString(),
    bill: billOf(d.action, d.amountLabel, d.allowed, bill),
  };
}

/** "BUY NVDAc · $5.00"; a bill by its name, "Compute bill · $1.00", never as a trade. */
export function intentText(r: VaultRow): string {
  return r.bill ? `${r.bill.name} · ${r.amountLabel}` : `${r.action} ${r.symbol} · ${r.amountLabel}`;
}

/** The plate a Decision sits on: a paid bill on the neutral one, never Allowed; a refused bill is a refusal. */
export type PlateKind = "allowed" | "refused" | "bill";

export function plateOf(r: VaultRow): PlateKind {
  if (!r.allowed) return "refused";
  return r.bill ? "bill" : "allowed";
}

// The rules of lib/chain/ledger.ts and lib/chain/tokens.ts, which test/vault-decisions.test.tsx holds this decoder to.
const USDC_AMOUNT: ReadonlySet<ActionName> = new Set(["BUY", "BORROW", "REPAY", "PAY_EXPENSE"]);
const SYMBOLS: ReadonlyMap<string, string> = new Map(
  addresses
    .filter((a) => a.type === "address" && (a.name === "USDC" || (a.value.toLowerCase().startsWith("0xb2") && a.name.endsWith("C"))))
    .map((a) => [a.value.toLowerCase(), a.name === "USDC" ? "USDC" : `${a.name.slice(0, -1)}c`]),
);

const word = (data: string, i: number): bigint => BigInt(`0x${data.slice(2 + i * 64, 2 + (i + 1) * 64)}`);

function usd6(v: bigint): string {
  return `$${(Number(v) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * One recorded Decision log as a row: topics [event, intentId, token]; data, one word each, action, amount, allowed,
 * reason, rationaleHash (contracts/src/IMandateVaultEvents.sol, FACTS.decisionEvent).
 */
function recordedRow(l: RecordedLog): VaultRow {
  const action = ACTIONS[Number(word(l.data, 0))];
  const code = Number(word(l.data, 3));
  const reason: ReasonCode | undefined = code === 0 ? "OK" : REASONS[code - 1];
  if (action === undefined || reason === undefined) throw new Error(`recorded Decision ${l.transactionHash} does not decode`);
  const amount = word(l.data, 1);
  const token = `0x${(l.topics[2] ?? "").slice(26)}`.toLowerCase();
  const symbol = USDC_AMOUNT.has(action) && action !== "BUY" ? "USDC" : (SYMBOLS.get(token) ?? `${token.slice(0, 6)}…${token.slice(-4)}`);
  const t = localTime(l.blockTime);
  const amountLabel = USDC_AMOUNT.has(action) ? usd6(amount) : `${amount} raw ${symbol}`;
  const allowed = word(l.data, 2) === 1n;
  return {
    key: `${l.transactionHash}:${l.logIndex}`,
    txHash: l.transactionHash,
    block: l.blockNumber,
    timestamp: l.blockTime,
    timeLabel: `${dayLabel(isoOfDay(t.etDay))} ${clockLabel(t.minuteOfDay)}`,
    action,
    symbol,
    amountLabel,
    allowed,
    reason,
    gasUsed: l.gasUsed,
    // A recorded log carries neither the calldata nor the owner: a recorded payment is an expense, payee not read.
    bill: billOf(action, amountLabel, allowed, {}),
  };
}

/** The Decisions recorded in this build (FACTS.mainnetDecisions), newest first. */
export const RECORDED_ROWS: readonly VaultRow[] = [...FACTS.mainnetDecisions.value]
  .sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(BigInt(a.blockNumber) - BigInt(b.blockNumber))))
  .map(recordedRow)
  .reverse();
