import { type Hex, MULTICALL3, NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import deployments from "@/content/generated/deployments.json";
import {
  type Call3, type CallResult, decodeAggregate3, decodeBool, decodeObserve, decodeRoundData, decodeUint,
  encodeAggregate3, encodeCall, encodeObserve, SELECTORS,
} from "./abi";
import { twapPrice8 } from "./price";
import type { LiveReader } from "./rpc";

export interface TokenReading {
  symbol: string;
  /** isPaused(0), the transfer feature; null when the call failed. */
  paused: boolean | null;
  uiMultiplier: bigint | null;
  effectiveAt: bigint | null;
  feed: { answer: bigint; updatedAt: bigint } | null;
  /** The pool's TWAP over the mandate window, USD with 8 decimals; null when observe failed or gave no price. */
  twap8: bigint | null;
}

export type CalendarReading = { source: "repo" } | { source: "onchain"; address: Hex; open: boolean | null };

export interface LiveSnapshot {
  block: bigint;
  /** The block's timestamp, seconds. */
  timestamp: number;
  /** The RPC that answered the multicall. */
  endpoint: string;
  calendar: CalendarReading;
  tokens: TokenReading[];
}

const PER_TOKEN = 5;
const REGULAR = 0n; // enum SessionMode in contracts/src/Types.sol

export function buildCalls(twapWindowSec: number): Call3[] {
  const calls: Call3[] = [
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getBlockNumber) },
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getCurrentBlockTimestamp) },
  ];
  for (const t of NAV_TOKENS) {
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.isPaused, 0n) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.uiMultiplier) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.effectiveAt) });
    calls.push({ target: t.feed, allowFailure: true, callData: encodeCall(SELECTORS.latestRoundData) });
    calls.push({ target: t.pool, allowFailure: true, callData: encodeObserve([twapWindowSec, 0]) });
  }
  return calls;
}

export function decodeSnapshot(results: CallResult[], twapWindowSec: number): { block: bigint; timestamp: number; tokens: TokenReading[] } {
  if (results.length !== 2 + PER_TOKEN * NAV_TOKENS.length) throw new Error(`expected ${2 + PER_TOKEN * NAV_TOKENS.length} results, got ${results.length}`);
  const block = decodeUint(results[0]!);
  const timestamp = decodeUint(results[1]!);
  if (block === null || timestamp === null) throw new Error("the multicall gave no block number or timestamp");
  const tokens = NAV_TOKENS.map((t, i): TokenReading => {
    const r = results.slice(2 + i * PER_TOKEN, 2 + (i + 1) * PER_TOKEN);
    const obs = decodeObserve(r[4]!);
    return {
      symbol: t.symbol,
      paused: decodeBool(r[0]!),
      uiMultiplier: decodeUint(r[1]!),
      effectiveAt: decodeUint(r[2]!),
      feed: decodeRoundData(r[3]!),
      twap8: obs === null ? null : twapPrice8(obs.tickCumulatives, twapWindowSec),
    };
  });
  return { block, timestamp: Number(timestamp), tokens };
}

/** The Base mainnet MarketCalendar of deployments/README.md, or null while its address cell is empty. */
export function calendarAddress(rows: readonly { network: string; contract: string; address: string }[] = deployments): Hex | null {
  const a = rows.find((r) => r.network === "Base mainnet" && r.contract === "MarketCalendar")?.address.trim() ?? "";
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Hex) : null;
}

/** isOpen's answer, or a throw when it is not a bool word, so the reader tries the next endpoint. */
function decodeOpen(data: Hex): boolean {
  const open = decodeBool({ success: true, returnData: data });
  if (open === null) throw new Error("isOpen gave no bool");
  return open;
}

/**
 * One reading: the multicall at latest, then a deployed MarketCalendar's isOpen at the same block. An answer that does
 * not decode counts as that endpoint's failure, so the reader tries the next one; the calendar call starts at the
 * endpoint that answered the multicall.
 */
export async function readSnapshot(reader: LiveReader, opts: { twapWindowSec?: number; calendar?: Hex | null } = {}): Promise<LiveSnapshot> {
  const window = opts.twapWindowSec ?? FACTS.mandate.value.twapWindowSec;
  const calendar = opts.calendar === undefined ? calendarAddress() : opts.calendar;
  const decode = (data: Hex) => decodeSnapshot(decodeAggregate3(data), window);
  const { data, endpoint } = await reader.call({ to: MULTICALL3, data: encodeAggregate3(buildCalls(window)) }, "latest", { validate: decode });
  const s = decode(data);
  if (calendar === null) return { ...s, endpoint, calendar: { source: "repo" } };
  try {
    const isOpen = { to: calendar, data: encodeCall(SELECTORS.isOpen, BigInt(s.timestamp), REGULAR) };
    const open = await reader.call(isOpen, s.block, { validate: decodeOpen, first: endpoint });
    return { ...s, endpoint, calendar: { source: "onchain", address: calendar, open: decodeOpen(open.data) } };
  } catch {
    // A failed calendar call must not discard the token readings; the caller counts open: null as closed.
    return { ...s, endpoint, calendar: { source: "onchain", address: calendar, open: null } };
  }
}
