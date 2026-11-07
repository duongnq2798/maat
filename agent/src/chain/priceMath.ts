/**
 * Integer ports of contracts/src/lib/PriceLib.sol and v4-core TickMath.getSqrtPriceAtTick, so the guard computes the
 * same TWAP price and premium as the vault, to the last unit. Prices are USD per 1 whole token with 8 decimals.
 */
export const PRICE_DECIMALS = 8;
export const MAX_TICK = 887_272;

const Q32 = 1n << 32n;
const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;

// 1/sqrt(1.0001^(2^i)) in Q128.128, for bits 1..19 of |tick| (TickMath.sol, same order).
const BIT_FACTORS: readonly bigint[] = [
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

/** TickMath.getSqrtPriceAtTick: sqrt(1.0001^tick) as a Q64.96, rounded up. */
export function sqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || Math.abs(tick) > MAX_TICK) throw new Error(`tick ${tick} out of range`);
  const abs = BigInt(Math.abs(tick));
  let price = (abs & 1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 1n << 128n;
  BIT_FACTORS.forEach((f, i) => {
    if ((abs & (1n << BigInt(i + 1))) !== 0n) price = (price * f) >> 128n;
  });
  if (tick > 0) price = MAX_UINT256 / price;
  return (price + Q32 - 1n) >> 32n;
}

/** FullMath.mulDiv for non-negative inputs: floor(a * b / d). */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDiv by zero");
  return (a * b) / d;
}

/** PriceLib.priceFromSqrt: the stock's USD price (8 decimals) at a pool sqrt price. */
export function priceFromSqrt(sqrtPriceX96: bigint, stockIsToken0: boolean, stockDecimals: number, quoteDecimals: number): bigint {
  const scale = 10n ** BigInt(stockDecimals + PRICE_DECIMALS - quoteDecimals);
  if (stockIsToken0) {
    const ratioX96 = mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
    return mulDiv(ratioX96, scale, Q96);
  }
  const inv = mulDiv(Q96, Q96, sqrtPriceX96);
  return mulDiv(inv, scale, sqrtPriceX96);
}

/** The mean tick of observe([window, 0]), rounded toward negative infinity like PriceLib.twapPrice. */
export function twapTick(cumAgo: bigint, cumNow: bigint, window: number): number {
  if (window <= 0) throw new Error("twap window must be positive");
  const delta = cumNow - cumAgo;
  const w = BigInt(window);
  let tick = delta / w; // bigint division truncates toward zero, like Solidity
  if (delta < 0n && delta % w !== 0n) tick -= 1n;
  return Number(tick);
}

/** PriceLib.premiumBps: |dex - oracle| / oracle in basis points, truncated. */
export function premiumBps(dexPrice8: bigint, oraclePrice8: bigint): bigint {
  if (oraclePrice8 <= 0n) throw new Error("oracle price must be positive");
  const diff = dexPrice8 > oraclePrice8 ? dexPrice8 - oraclePrice8 : oraclePrice8 - dexPrice8;
  return (diff * 10_000n) / oraclePrice8;
}
