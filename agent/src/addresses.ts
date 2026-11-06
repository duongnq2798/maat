import { getAddress, type Address } from "viem";

/** Base mainnet, verified 2026-11-06 (contracts/script/BaseAddresses.sol). */
export const BASE_CHAIN_ID = 8453;
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export type TokenSymbol = "NVDAc" | "GOOGLc" | "AAPLc";

export const BASKET: readonly { symbol: TokenSymbol; address: Address }[] = [
  { symbol: "NVDAc", address: "0xb20000000000000000000078ee7ce2fE4908108C" },
  { symbol: "GOOGLc", address: "0xb2000000000000000000002D0BA3164cc74f58B7" },
  { symbol: "AAPLc", address: "0xb200000000000000000000C2e324d24d7eEcd1fb" },
];

export function symbolOf(addr: Address): TokenSymbol | undefined {
  const a = getAddress(addr);
  return BASKET.find((t) => getAddress(t.address) === a)?.symbol;
}

export function addressOf(sym: TokenSymbol): Address {
  const t = BASKET.find((b) => b.symbol === sym);
  if (!t) throw new Error(`unknown token ${sym}`);
  return getAddress(t.address);
}
