import { B20_DECIMALS, USDC_DECIMALS } from "@/content/b20-nav";

/** Ports of contracts/src/lib/PriceLib.sol and v4-core TickMath.getSqrtPriceAtTick, in bigint. Prices are USD with 8 decimals. */

const MAX_TICK = 887272n;
const Q32 = 1n << 32n;
const MAX_UINT256 = (1n << 256n) - 1n;

// v4-core/src/libraries/TickMath.sol, the factor for each bit of |tick|.
const FACTORS: ReadonlyArray<readonly [bigint, bigint]> = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

export function sqrtPriceAtTick(tick: bigint): bigint {
  const abs = tick < 0n ? -tick : tick;
  if (abs > MAX_TICK) throw new RangeError(`tick ${tick} is outside ±${MAX_TICK}`);
  let price = (abs & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 1n << 128n;
  for (const [bit, factor] of FACTORS) if ((abs & bit) !== 0n) price = (price * factor) >> 128n;
  if (tick > 0n) price = MAX_UINT256 / price;
  return (price + Q32 - 1n) >> 32n;
}

/** PriceLib.priceFromSqrt. */
export function priceFromSqrt(sqrtPriceX96: bigint, stockIsToken0: boolean, stockDecimals: number, quoteDecimals: number): bigint {
  const scale = 10n ** BigInt(stockDecimals + 8 - quoteDecimals);
  if (stockIsToken0) {
    const ratioX96 = (sqrtPriceX96 * sqrtPriceX96) >> 96n;
    return (ratioX96 * scale) >> 96n;
  }
  const inv = (1n << 192n) / sqrtPriceX96;
  return (inv * scale) / sqrtPriceX96;
}

/** The average tick of PriceLib.twapPrice: (now − then) / window, rounded toward negative infinity. */
export function twapTick(tickCumulatives: readonly bigint[], windowSec: number): bigint | null {
  const [then, now] = tickCumulatives;
  if (then === undefined || now === undefined || !Number.isInteger(windowSec) || windowSec <= 0) return null;
  const w = BigInt(windowSec);
  const delta = now - then;
  let tick = delta / w;
  if (delta < 0n && delta % w !== 0n) tick -= 1n;
  return tick;
}

/** PriceLib.twapPrice for the 13 pools of content/b20-nav.ts: the stock is token1, 8 decimals against USDC's 6. */
export function twapPrice8(tickCumulatives: readonly bigint[], windowSec: number): bigint | null {
  const tick = twapTick(tickCumulatives, windowSec);
  if (tick === null) return null;
  try {
    const p = priceFromSqrt(sqrtPriceAtTick(tick), false, B20_DECIMALS, USDC_DECIMALS);
    return p === 0n ? null : p;
  } catch {
    return null;
  }
}

/** PriceLib.premiumBps. */
export function premiumBps(dex: bigint, oracle: bigint): bigint {
  const diff = dex > oracle ? dex - oracle : oracle - dex;
  return (diff * 10_000n) / oracle;
}
