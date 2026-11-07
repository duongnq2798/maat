import { keccak256, parseAbi, toBytes, zeroAddress, type Address } from "viem";
import { aggregatorV3Abi, b20AssetAbi, erc20Abi, mandateVaultAbi, marketCalendarAbi } from "../abi/index.js";
import { symbolOf, type TokenSymbol } from "../addresses.js";
import { USDC_DECIMALS } from "../units.js";
import { MAX_TICK, premiumBps, priceFromSqrt, sqrtPriceAtTick, twapTick } from "./priceMath.js";
import type { Mandate } from "../types.js";
import { must, opt, StateUnavailable, type Result, type StateClient } from "./state.js";

/** Aerodrome Slipstream pool, the two reads PriceLib.twapPrice makes. */
export const clPoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);

/** contracts/src/interfaces/IB20Asset.sol, B20Constants. */
export const FEATURE_TRANSFER = 0;
export const POLICY_SCOPES = {
  sender: keccak256(toBytes("TRANSFER_SENDER_POLICY")),
  receiver: keccak256(toBytes("TRANSFER_RECEIVER_POLICY")),
  executor: keccak256(toBytes("TRANSFER_EXECUTOR_POLICY")),
} as const;

/** The token has no feed or pool in Maat's vault, so the guard has nothing to check it against. */
export class TokenNotCovered extends Error {
  constructor(readonly token: Address) {
    super(`token ${token} has no feed and pool in the vault`);
    this.name = "TokenNotCovered";
  }
}

/**
 * Everything GuardLib.checkMarket reads for one token, at one block. A null field is a read that failed; the verdict
 * treats it the way GuardLib does (fail-closed).
 */
export interface MarketState {
  block: bigint;
  timestamp: bigint;
  token: Address;
  symbol: TokenSymbol | undefined;
  decimals: number;
  feed: Address;
  pool: Address;
  /** BUY is allowed for this token in Maat's vault (false: exit-only there). */
  allowed: boolean;
  vaultPaused: boolean;
  sessionMode: number;
  marketOpen: boolean | null;
  tokenPaused: boolean | null;
  oracle: { price8: bigint; updatedAt: bigint; age: bigint } | null;
  dex: { tick: number; price8: bigint } | null;
  premiumBps: bigint | null;
  /** current = uiMultiplier(); last / changedAt = the vault's bookkeeping; effectiveAt = scheduled update time. */
  multiplier: { current: bigint | null; last: bigint; changedAt: bigint; effectiveAt: bigint | null };
  policyIds: { sender: bigint | null; receiver: bigint | null; executor: bigint | null };
  /** What the pool holds: the stock (raw units) and USDC (6 decimals). */
  reserves: { stock: bigint | null; usdc: bigint | null };
  limits: { maxStaleness: number; twapWindow: number; maxPremiumBps: number; multiplierCooldown: number };
}

export async function readMarketState(client: StateClient, vault: Address, token: Address): Promise<MarketState> {
  let block: { number: bigint | null; timestamp: bigint };
  try {
    block = await client.getBlock({ blockTag: "latest" });
  } catch (e) {
    throw new StateUnavailable("getBlock failed", { cause: e });
  }
  if (block.number === null) throw new StateUnavailable("latest block has no number");
  const blockNumber = block.number;
  const now = block.timestamp;
  const call = async (contracts: readonly unknown[]) => {
    try {
      return (await client.multicall({ contracts: contracts as never, allowFailure: true, blockNumber })) as Result[];
    } catch (e) {
      throw new StateUnavailable("multicall failed", { cause: e });
    }
  };

  const r1 = await call([
    { address: vault, abi: mandateVaultAbi, functionName: "mandate" },
    { address: vault, abi: mandateVaultAbi, functionName: "paused" },
    { address: vault, abi: mandateVaultAbi, functionName: "usdc" },
    { address: vault, abi: mandateVaultAbi, functionName: "tokenConfig", args: [token] },
    { address: vault, abi: mandateVaultAbi, functionName: "lastMultiplier", args: [token] },
    { address: vault, abi: mandateVaultAbi, functionName: "multiplierChangedAt", args: [token] },
  ]);
  const mandate = must<Mandate>(r1[0], "mandate");
  const vaultPaused = must<boolean>(r1[1], "paused");
  const usdc = must<Address>(r1[2], "usdc");
  const [allowed, feed, pool] = must<readonly [boolean, Address, Address, number]>(r1[3], "tokenConfig");
  const last = must<bigint>(r1[4], "lastMultiplier");
  const changedAt = must<bigint>(r1[5], "multiplierChangedAt");
  if (feed === zeroAddress || pool === zeroAddress) throw new TokenNotCovered(token);

  const r2 = await call([
    { address: token, abi: b20AssetAbi, functionName: "decimals" },
    { address: token, abi: b20AssetAbi, functionName: "isPaused", args: [FEATURE_TRANSFER] },
    { address: token, abi: b20AssetAbi, functionName: "uiMultiplier" },
    { address: token, abi: b20AssetAbi, functionName: "effectiveAt" },
    { address: token, abi: b20AssetAbi, functionName: "policyId", args: [POLICY_SCOPES.sender] },
    { address: token, abi: b20AssetAbi, functionName: "policyId", args: [POLICY_SCOPES.receiver] },
    { address: token, abi: b20AssetAbi, functionName: "policyId", args: [POLICY_SCOPES.executor] },
    { address: token, abi: b20AssetAbi, functionName: "balanceOf", args: [pool] },
    { address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [pool] },
    { address: feed, abi: aggregatorV3Abi, functionName: "latestRoundData" },
    { address: pool, abi: clPoolAbi, functionName: "token0" },
    { address: pool, abi: clPoolAbi, functionName: "observe", args: [[mandate.twapWindow, 0]] },
    { address: mandate.calendar, abi: marketCalendarAbi, functionName: "isOpen", args: [now, mandate.sessionMode] },
  ]);
  const decimals = Number(must<number>(r2[0], `${token}.decimals()`));

  // Same validity rule as PriceLib.readFeed: positive answer, updatedAt in (0, now].
  const round = opt<readonly [bigint, bigint, bigint, bigint, bigint]>(r2[9]);
  const oracle =
    round !== null && round[1] > 0n && round[3] > 0n && round[3] <= now ? { price8: round[1], updatedAt: round[3], age: now - round[3] } : null;

  const token0 = opt<Address>(r2[10]);
  const cum = opt<readonly [readonly bigint[], readonly bigint[]]>(r2[11]);
  let dex: MarketState["dex"] = null;
  if (token0 !== null && cum !== null && mandate.twapWindow > 0 && cum[0].length === 2) {
    const tick = twapTick(cum[0][0]!, cum[0][1]!, mandate.twapWindow);
    if (Math.abs(tick) <= MAX_TICK) {
      const stockIsToken0 = token0.toLowerCase() === token.toLowerCase();
      const price8 = priceFromSqrt(sqrtPriceAtTick(tick), stockIsToken0, decimals, USDC_DECIMALS);
      if (price8 > 0n) dex = { tick, price8 };
    }
  }

  return {
    block: blockNumber,
    timestamp: now,
    token,
    symbol: symbolOf(token),
    decimals,
    feed,
    pool,
    allowed,
    vaultPaused,
    sessionMode: mandate.sessionMode,
    marketOpen: opt<boolean>(r2[12]),
    tokenPaused: opt<boolean>(r2[1]),
    oracle,
    dex,
    premiumBps: oracle && dex ? premiumBps(dex.price8, oracle.price8) : null,
    multiplier: { current: opt<bigint>(r2[2]), last, changedAt, effectiveAt: opt<bigint>(r2[3]) },
    policyIds: { sender: opt<bigint>(r2[4]), receiver: opt<bigint>(r2[5]), executor: opt<bigint>(r2[6]) },
    reserves: { stock: opt<bigint>(r2[7]), usdc: opt<bigint>(r2[8]) },
    limits: {
      maxStaleness: mandate.maxStaleness,
      twapWindow: mandate.twapWindow,
      maxPremiumBps: mandate.maxPremiumBps,
      multiplierCooldown: mandate.multiplierCooldown,
    },
  };
}
