import { getAddress, zeroAddress, type Address, type PublicClient } from "viem";
import { aggregatorV3Abi, b20AssetAbi, clPoolAbi, creditAdapterAbi, erc20Abi, mandateVaultAbi, marketCalendarAbi } from "../abi/index.js";
import { symbolOf, type TokenSymbol } from "../addresses.js";
import type { Mandate, TokenConfig } from "../types.js";
import { valueUsd6 } from "../units.js";
import { twapPrice8 } from "./twap.js";

export type StateClient = Pick<PublicClient, "getBlock" | "multicall">;

export class StateUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateUnavailable";
  }
}

export interface TokenState {
  address: Address;
  symbol: TokenSymbol | undefined;
  decimals: number;
  config: TokenConfig;
  balance: bigint;
  supplied: bigint;
  price8: bigint | null;
  feedAge: bigint | null;
  /** latestRoundData's round id and updatedAt, whatever the answer; null when the read failed (for the blob's `s`). */
  roundId: bigint | null;
  updatedAt: bigint | null;
  /** PriceLib.twapPrice over mandate.twapWindow at the state block; null where the vault's read would not be ok. */
  twap8: bigint | null;
  uiMultiplier: bigint | null;
  /** null when the vault read failed: housekeeping then skips the token rather than syncing against a fake 0. */
  lastMultiplier: bigint | null;
  valueUsd6: bigint;
}

/** The New York local time of the state block and that date's entries, as the mandate's MarketCalendar reports them. */
export interface CalendarDay {
  /** Days since 1970-01-01 in New York time: the NYSE date. */
  etDay: bigint;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  minuteOfDay: number;
  holiday: boolean;
  /** The early close in minutes after midnight, or 0 when the session closes at 16:00. */
  earlyCloseMin: number;
}

export interface CreditState {
  readable: boolean;
  debt: bigint;
  healthFactor: bigint;
}

export interface VaultState {
  blockNumber: bigint;
  timestamp: bigint;
  day: bigint;
  vault: Address;
  usdc: Address;
  executor: Address;
  paused: boolean;
  usdcBalance: bigint;
  recordedUsdc: bigint;
  newRevenue: bigint;
  spentToday: bigint;
  mandate: Mandate;
  marketOpen: boolean | null;
  /** null when a calendar view failed, like marketOpen. */
  calendar: CalendarDay | null;
  tokens: TokenState[];
  credit: CreditState | null;
  equityUsd6: bigint;
}

type Result = { status: "success"; result: unknown } | { status: "failure"; error: unknown };

function must<T>(r: Result | undefined, what: string): T {
  if (!r || r.status !== "success") throw new StateUnavailable(`vault read failed: ${what}`, { cause: r && "error" in r ? r.error : undefined });
  return r.result as T;
}

function opt<T>(r: Result | undefined): T | null {
  return r && r.status === "success" ? (r.result as T) : null;
}

/** localTime's NYSE date with its holiday and early close, from [localTime, (isHoliday, earlyCloseMin) per candidate day]. */
function calendarDay(r: Result[], etDays: bigint[]): CalendarDay | null {
  const local = opt<readonly [bigint, bigint, bigint]>(r[0]);
  const i = local === null ? -1 : etDays.indexOf(local[0]);
  if (local === null || i < 0) return null;
  const holiday = opt<boolean>(r[1 + 2 * i]);
  const earlyCloseMin = opt<number>(r[2 + 2 * i]);
  if (holiday === null || earlyCloseMin === null) return null;
  return { etDay: local[0], weekday: Number(local[1]), minuteOfDay: Number(local[2]), holiday, earlyCloseMin: Number(earlyCloseMin) };
}

export async function readVaultState(client: StateClient, vault: Address): Promise<VaultState> {
  let block: { number: bigint | null; timestamp: bigint };
  try {
    block = await client.getBlock({ blockTag: "latest" });
  } catch (e) {
    throw new StateUnavailable("getBlock failed", { cause: e });
  }
  if (block.number === null) throw new StateUnavailable("latest block has no number");
  const blockNumber = block.number;
  const timestamp = block.timestamp;
  const day = timestamp / 86_400n;
  const call = (contracts: readonly unknown[]) =>
    client.multicall({ contracts: contracts as never, allowFailure: true, blockNumber }) as Promise<Result[]>;

  let r1: Result[];
  try {
    r1 = await call([
      { address: vault, abi: mandateVaultAbi, functionName: "executor" },
      { address: vault, abi: mandateVaultAbi, functionName: "paused" },
      { address: vault, abi: mandateVaultAbi, functionName: "mandate" },
      { address: vault, abi: mandateVaultAbi, functionName: "tokens" },
      { address: vault, abi: mandateVaultAbi, functionName: "usdc" },
      { address: vault, abi: mandateVaultAbi, functionName: "recordedUsdc" },
      { address: vault, abi: mandateVaultAbi, functionName: "spentOnDay", args: [day] },
    ]);
  } catch (e) {
    throw new StateUnavailable("multicall failed", { cause: e });
  }
  const executor = must<Address>(r1[0], "executor");
  const paused = must<boolean>(r1[1], "paused");
  const mandate = must<Mandate>(r1[2], "mandate");
  const tokenList = must<readonly Address[]>(r1[3], "tokens");
  const usdc = must<Address>(r1[4], "usdc");
  const recordedUsdc = must<bigint>(r1[5], "recordedUsdc");
  const spentToday = must<bigint>(r1[6], "spentOnDay");
  const hasCredit = mandate.creditAdapter !== zeroAddress;

  const PER_TOKEN = 5;
  const perToken = tokenList.flatMap((t) => [
    { address: vault, abi: mandateVaultAbi, functionName: "tokenConfig", args: [t] },
    { address: vault, abi: mandateVaultAbi, functionName: "lastMultiplier", args: [t] },
    { address: t, abi: b20AssetAbi, functionName: "balanceOf", args: [vault] },
    { address: t, abi: b20AssetAbi, functionName: "decimals" },
    { address: t, abi: b20AssetAbi, functionName: "uiMultiplier" },
  ]);
  // etOffsetSeconds is 4 or 5 hours, so the NYSE date is the date of ts - 4 h or of ts - 5 h: read both, keep localTime's.
  const etDays = [(timestamp - 4n * 3600n) / 86_400n, (timestamp - 5n * 3600n) / 86_400n];
  const dayCalls = [
    { address: mandate.calendar, abi: marketCalendarAbi, functionName: "localTime", args: [timestamp] },
    ...etDays.flatMap((d) => [
      { address: mandate.calendar, abi: marketCalendarAbi, functionName: "isHoliday", args: [d] },
      { address: mandate.calendar, abi: marketCalendarAbi, functionName: "earlyCloseMin", args: [d] },
    ]),
  ];
  const tail = [
    { address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
    { address: mandate.calendar, abi: marketCalendarAbi, functionName: "isOpen", args: [timestamp, mandate.sessionMode] },
    ...dayCalls,
    ...(hasCredit
      ? [
          { address: mandate.creditAdapter, abi: creditAdapterAbi, functionName: "debt" },
          { address: mandate.creditAdapter, abi: creditAdapterAbi, functionName: "healthFactor" },
          ...tokenList.map((t) => ({ address: mandate.creditAdapter, abi: creditAdapterAbi, functionName: "suppliedOf", args: [t] })),
        ]
      : []),
  ];
  let r2: Result[];
  try {
    r2 = await call([...perToken, ...tail]);
  } catch (e) {
    throw new StateUnavailable("multicall failed", { cause: e });
  }
  const at = (i: number) => r2[i];
  const base = tokenList.length * PER_TOKEN;
  const usdcBalance = must<bigint>(at(base), "usdc.balanceOf(vault)");
  const marketOpen = opt<boolean>(at(base + 1));
  const calendar = calendarDay(r2.slice(base + 2, base + 2 + dayCalls.length), etDays);

  let credit: CreditState | null = null;
  const supplied: bigint[] = tokenList.map(() => 0n);
  if (hasCredit) {
    const cb = base + 2 + dayCalls.length;
    const debt = opt<bigint>(at(cb));
    const hf = opt<bigint>(at(cb + 1));
    const sup = tokenList.map((_, i) => opt<bigint>(at(cb + 2 + i)));
    const readable = debt !== null && hf !== null && sup.every((s) => s !== null);
    credit = { readable, debt: debt ?? 0n, healthFactor: hf ?? 0n };
    sup.forEach((s, i) => (supplied[i] = s ?? 0n));
  }

  // Feeds and pools come from tokenConfig, so they need a third round: each feed's round, then each pool's
  // observe([twapWindow, 0]) and token0, the reads of PriceLib.twapPrice.
  const configs = tokenList.map((t, i) => {
    const c = opt<readonly [boolean, Address, Address, number]>(at(i * PER_TOKEN));
    return c ? { allowed: c[0], feed: c[1], pool: c[2], maxWeightBps: c[3] } : { allowed: false, feed: zeroAddress, pool: zeroAddress, maxWeightBps: 0 };
  });
  const window = Number(mandate.twapWindow);
  const pooled = configs.flatMap((c, i) => (c.pool !== zeroAddress && window > 0 ? [i] : []));
  let r3: Result[];
  try {
    r3 = await call([
      ...configs.map((c) => ({ address: c.feed, abi: aggregatorV3Abi, functionName: "latestRoundData" })),
      ...pooled.flatMap((i) => [
        { address: configs[i]!.pool, abi: clPoolAbi, functionName: "observe", args: [[window, 0]] },
        { address: configs[i]!.pool, abi: clPoolAbi, functionName: "token0" },
      ]),
    ]);
  } catch (e) {
    throw new StateUnavailable("multicall failed", { cause: e });
  }
  const twapOf = (i: number, decimals: number): bigint | null => {
    const k = pooled.indexOf(i);
    if (k < 0) return null;
    const obs = opt<readonly [readonly bigint[], readonly bigint[]]>(r3[tokenList.length + 2 * k]);
    const token0 = opt<Address>(r3[tokenList.length + 2 * k + 1]);
    if (obs === null || token0 === null) return null;
    return twapPrice8({ tickCumulatives: obs[0], window, stockIsToken0: getAddress(token0) === getAddress(tokenList[i]!), stockDecimals: decimals });
  };

  const tokens: TokenState[] = tokenList.map((address, i) => {
    const o = i * PER_TOKEN;
    // A failed balance or decimals read must not look like a true zero: fail closed.
    const decimals = Number(must<number>(at(o + 3), `${address}.decimals()`));
    const balance = must<bigint>(at(o + 2), `${address}.balanceOf(vault)`);
    const round = configs[i]!.feed === zeroAddress ? null : opt<readonly [bigint, bigint, bigint, bigint, bigint]>(r3[i]);
    // Same validity rule as PriceLib.readFeed: positive answer, updatedAt in (0, now].
    const good = round !== null && round[1] > 0n && round[3] > 0n && round[3] <= timestamp;
    const price8 = good ? round[1] : null;
    const feedAge = good ? timestamp - round[3] : null;
    return {
      address,
      symbol: symbolOf(address),
      decimals,
      config: configs[i]!,
      balance,
      supplied: supplied[i]!,
      price8,
      feedAge,
      roundId: round === null ? null : round[0],
      updatedAt: round === null ? null : round[3],
      twap8: twapOf(i, decimals),
      uiMultiplier: opt<bigint>(at(o + 4)),
      lastMultiplier: opt<bigint>(at(o + 1)),
      valueUsd6: price8 === null || decimals === 0 ? 0n : valueUsd6(balance + supplied[i]!, price8, decimals),
    };
  });

  const gross = usdcBalance + tokens.reduce((s, t) => s + t.valueUsd6, 0n);
  const debt = credit?.debt ?? 0n;
  return {
    blockNumber,
    timestamp,
    day,
    vault,
    usdc,
    executor,
    paused,
    usdcBalance,
    recordedUsdc,
    newRevenue: usdcBalance > recordedUsdc ? usdcBalance - recordedUsdc : 0n,
    spentToday,
    mandate,
    marketOpen,
    calendar,
    tokens,
    credit,
    equityUsd6: gross > debt ? gross - debt : 0n,
  };
}
