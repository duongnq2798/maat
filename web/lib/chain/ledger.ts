import { formatUnits, getAddress, type Address, type Hash, type Hex } from "viem";
import { isoOfDay, localTime } from "@/content/calendar";
import type { ActionName } from "@/content/decisions";
import { clockLabel, dayLabel } from "@/content/format";
import { REASONS, type ReasonCode, type RefusalCode } from "@/content/reasons";
import type { DecisionEvent, VaultEvent } from "./events";
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
