import { getAddress, type Address } from "viem";
import addresses from "@/content/generated/base-addresses.json";

/** contracts/script/BaseAddresses.sol names the basket NVDAC, GOOGLC, AAPLC; the site writes them NVDAc, GOOGLc, AAPLc. */
const KNOWN: ReadonlyMap<string, string> = new Map(
  addresses
    .filter((a) => a.type === "address" && (a.name === "USDC" || (a.value.toLowerCase().startsWith("0xb2") && a.name.endsWith("C"))))
    .map((a) => [a.value.toLowerCase(), a.name === "USDC" ? "USDC" : `${a.name.slice(0, -1)}c`]),
);

/** "0xb200…108C". */
export function shortAddress(address: Address): string {
  const a = getAddress(address);
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** The ticker the site uses for a Base token Maat knows, or the shortened address. */
export function symbolOf(address: Address): string {
  return KNOWN.get(address.toLowerCase()) ?? shortAddress(address);
}
