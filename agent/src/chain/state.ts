import { zeroAddress, type Address, type PublicClient } from "viem";
import { aggregatorV3Abi, b20AssetAbi, creditAdapterAbi, erc20Abi, mandateVaultAbi, marketCalendarAbi } from "../abi/index.js";
import { symbolOf, type TokenSymbol } from "../addresses.js";
import type { Mandate, TokenConfig } from "../types.js";
import { valueUsd6 } from "../units.js";

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
  uiMultiplier: bigint | null;
  /** null when the vault read failed: housekeeping then skips the token rather than syncing against a fake 0. */
  lastMultiplier: bigint | null;
  valueUsd6: bigint;
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
  tokens: TokenState[];
  credit: CreditState | null;
  equityUsd6: bigint;
}

export type Result = { status: "success"; result: unknown } | { status: "failure"; error: unknown };

export function must<T>(r: Result | undefined, what: string): T {
  if (!r || r.status !== "success") throw new StateUnavailable(`vault read failed: ${what}`, { cause: r && "error" in r ? r.error : undefined });
  return r.result as T;
}

export function opt<T>(r: Result | undefined): T | null {
  return r && r.status === "success" ? (r.result as T) : null;
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
  const tail = [
    { address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
    { address: mandate.calendar, abi: marketCalendarAbi, functionName: "isOpen", args: [timestamp, mandate.sessionMode] },
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

  let credit: CreditState | null = null;
  const supplied: bigint[] = tokenList.map(() => 0n);
  if (hasCredit) {
    const debt = opt<bigint>(at(base + 2));
    const hf = opt<bigint>(at(base + 3));
    const sup = tokenList.map((_, i) => opt<bigint>(at(base + 4 + i)));
    const readable = debt !== null && hf !== null && sup.every((s) => s !== null);
    credit = { readable, debt: debt ?? 0n, healthFactor: hf ?? 0n };
    sup.forEach((s, i) => (supplied[i] = s ?? 0n));
  }

  // Feeds come from tokenConfig, so they need a third round.
  const configs = tokenList.map((t, i) => {
    const c = opt<readonly [boolean, Address, Address, number]>(at(i * PER_TOKEN));
    return c ? { allowed: c[0], feed: c[1], pool: c[2], maxWeightBps: c[3] } : { allowed: false, feed: zeroAddress, pool: zeroAddress, maxWeightBps: 0 };
  });
  let r3: Result[];
  try {
    r3 = await call(configs.map((c) => ({ address: c.feed, abi: aggregatorV3Abi, functionName: "latestRoundData" })));
  } catch (e) {
    throw new StateUnavailable("multicall failed", { cause: e });
  }

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
    tokens,
    credit,
    equityUsd6: gross > debt ? gross - debt : 0n,
  };
}
