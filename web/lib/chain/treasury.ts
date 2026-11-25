import { zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { b20Abi, creditAdapterAbi, erc20Abi, feedAbi, vaultAbi } from "./abi";
import { symbolOf } from "./tokens";

/** A read that may have failed. A failed read is shown as unavailable, never as zero. */
export type Read<T> = { ok: true; value: T } | { ok: false };

const ok = <T>(value: T): Read<T> => ({ ok: true, value });
const NO: Read<never> = { ok: false };

/** The Mandate struct as viem decodes it (contracts/src/Types.sol). */
export interface OnchainMandate {
  sessionMode: number;
  maxPremiumBps: number;
  maxSlippageBps: number;
  maxStaleness: number;
  multiplierCooldown: number;
  twapWindow: number;
  perTradeCapUsd: bigint;
  dailyCapUsd: bigint;
  calendar: Address;
  swapAdapter: Address;
  creditAdapter: Address;
  minHealthFactor: bigint;
  targetHealthFactor: bigint;
  deriskWindow: number;
}

export interface TokenHolding {
  address: Address;
  symbol: string;
  decimals: Read<number>;
  /** balanceOf: raw units, which the feed prices. */
  raw: Read<bigint>;
  /** balanceOfUI: the quantity a holder sees, raw × the token's multiplier. */
  ui: Read<bigint>;
  /** Collateral supplied through the credit adapter, raw units (0 without one). */
  supplied: Read<bigint>;
  price8: Read<bigint>;
  feedAgeSec: Read<number>;
  maxWeightBps: Read<number>;
  /** (raw + supplied) × price, as MandateVault._valueUsd. */
  valueUsd6: Read<bigint>;
  /** valueUsd6 against net equity, as MandateVault._weightAfterBuyBps measures weight. */
  weightBps: number | null;
}

export interface Treasury {
  blockNumber: bigint;
  timestamp: number;
  owner: Address;
  executor: Address;
  paused: boolean;
  mandate: OnchainMandate;
  mandateHash: Hex;
  usdcAddress: Address;
  usdc: Read<bigint>;
  tokens: TokenHolding[];
  credit: { debt: Read<bigint>; healthFactor: Read<bigint> } | null;
  /** USDC + stock value (held and supplied) − debt. */
  equityUsd6: Read<bigint>;
}

export class TreasuryUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TreasuryUnavailable";
  }
}

export type TreasuryClient = Pick<PublicClient, "getBlock" | "multicall">;

/** Mirrors MandateVault._valueUsd: raw stock units × 8-decimal price → USDC units, truncating. */
export function valueUsd6(raw: bigint, price8: bigint, decimals: number): bigint {
  return (raw * price8) / 10n ** BigInt(decimals + 2);
}

export function weightBps(part: bigint, whole: bigint): number | null {
  return whole <= 0n ? null : Number((part * 10_000n) / whole);
}

/** Aave returns type(uint256).max when there is no debt; anything above 1e12 means the same. */
export function formatHf(wad: bigint): string {
  if (wad >= 10n ** 30n) return "no debt";
  return (Number(wad / 10n ** 14n) / 10_000).toFixed(2);
}

type Result = { status: "success"; result: unknown } | { status: "failure"; error: unknown };
const read = <T>(r: Result | undefined): Read<T> => (r?.status === "success" ? ok(r.result as T) : NO);

function must<T>(r: Result | undefined, what: string): T {
  if (r?.status !== "success") throw new TreasuryUnavailable(`vault read failed: ${what}`, { cause: r?.status === "failure" ? r.error : undefined });
  return r.result as T;
}

/** Reads the vault's state at the latest block in three multicalls, like agent/src/chain/state.ts, plus balanceOfUI. */
export async function readTreasury(client: TreasuryClient, vault: Address): Promise<Treasury> {
  const block = await client.getBlock({ blockTag: "latest" });
  if (block.number === null) throw new TreasuryUnavailable("the latest block has no number");
  const blockNumber = block.number;
  const now = block.timestamp;
  const call = (contracts: readonly unknown[]) =>
    client.multicall({ contracts: contracts as never, allowFailure: true, blockNumber }) as Promise<Result[]>;
  const v = (functionName: string, args?: readonly unknown[]) => ({ address: vault, abi: vaultAbi, functionName, ...(args ? { args } : {}) });

  const r1 = await call([v("owner"), v("executor"), v("paused"), v("mandate"), v("mandateHash"), v("tokens"), v("usdc")]);
  const owner = must<Address>(r1[0], "owner");
  const executor = must<Address>(r1[1], "executor");
  const paused = must<boolean>(r1[2], "paused");
  const mandate = must<OnchainMandate>(r1[3], "mandate");
  const mandateHash = must<Hex>(r1[4], "mandateHash");
  const list = must<readonly Address[]>(r1[5], "tokens");
  const usdcAddress = must<Address>(r1[6], "usdc");
  const credit = mandate.creditAdapter !== zeroAddress ? mandate.creditAdapter : null;

  const PER = 4;
  const r2 = await call([
    ...list.flatMap((t) => [
      v("tokenConfig", [t]),
      { address: t, abi: b20Abi, functionName: "balanceOf", args: [vault] },
      { address: t, abi: b20Abi, functionName: "balanceOfUI", args: [vault] },
      { address: t, abi: b20Abi, functionName: "decimals" },
    ]),
    { address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
    ...(credit
      ? [
          { address: credit, abi: creditAdapterAbi, functionName: "debt" },
          { address: credit, abi: creditAdapterAbi, functionName: "healthFactor" },
          ...list.map((t) => ({ address: credit, abi: creditAdapterAbi, functionName: "suppliedOf", args: [t] })),
        ]
      : []),
  ]);
  const tail = list.length * PER;
  const usdc = read<bigint>(r2[tail]);
  const creditReads = credit ? { debt: read<bigint>(r2[tail + 1]), healthFactor: read<bigint>(r2[tail + 2]) } : null;

  const configs = list.map((_, i) => read<readonly [boolean, Address, Address, number]>(r2[i * PER]));
  const feeds = configs.map((c) => (c.ok && c.value[1] !== zeroAddress ? c.value[1] : null));
  const withFeed = feeds.flatMap((f, i) => (f ? [{ i, f }] : []));
  const r3 = withFeed.length > 0 ? await call(withFeed.map(({ f }) => ({ address: f, abi: feedAbi, functionName: "latestRoundData" }))) : [];
  const rounds = new Map(withFeed.map(({ i }, k) => [i, read<readonly [bigint, bigint, bigint, bigint, bigint]>(r3[k])]));

  const tokens: TokenHolding[] = list.map((address, i) => {
    const o = i * PER;
    const decimals = read<number>(r2[o + 3]);
    const raw = read<bigint>(r2[o + 1]);
    const supplied: Read<bigint> = credit ? read<bigint>(r2[tail + 3 + i]) : ok(0n);
    const round = rounds.get(i);
    // PriceLib.readFeed: a positive answer, updated at a time in (0, now].
    const good = round?.ok && round.value[1] > 0n && round.value[3] > 0n && round.value[3] <= now;
    const price8: Read<bigint> = good ? ok(round.value[1]) : NO;
    const feedAgeSec: Read<number> = good ? ok(Number(now - round.value[3])) : NO;
    const cfg = configs[i]!;
    const value: Read<bigint> =
      raw.ok && supplied.ok && price8.ok && decimals.ok ? ok(valueUsd6(raw.value + supplied.value, price8.value, decimals.value)) : NO;
    return {
      address,
      symbol: symbolOf(address),
      decimals,
      raw,
      ui: read<bigint>(r2[o + 2]),
      supplied,
      price8,
      feedAgeSec,
      maxWeightBps: cfg.ok ? ok(Number(cfg.value[3])) : NO,
      valueUsd6: value,
      weightBps: null,
    };
  });

  // Equity only when every part of it was read: a missing price must not look like a stock worth $0.
  const parts: Read<bigint>[] = [usdc, ...tokens.map((t) => t.valueUsd6), ...(creditReads ? [creditReads.debt] : [])];
  const of = (r: Read<bigint>) => (r.ok ? r.value : 0n);
  const debt = creditReads ? of(creditReads.debt) : 0n;
  const equityUsd6: Read<bigint> = parts.every((p) => p.ok) ? ok(of(usdc) + tokens.reduce((s, t) => s + of(t.valueUsd6), 0n) - debt) : NO;
  if (equityUsd6.ok) for (const t of tokens) t.weightBps = t.valueUsd6.ok ? weightBps(t.valueUsd6.value, equityUsd6.value) : null;

  return {
    blockNumber,
    timestamp: Number(now),
    owner,
    executor,
    paused,
    mandate,
    mandateHash,
    usdcAddress,
    usdc,
    tokens,
    credit: creditReads,
    equityUsd6,
  };
}
