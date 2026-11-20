import type { Abi } from "viem";
import abis from "@/content/generated/abi.json";

/** MandateVault and ICreditAdapter as the docs publish them (content/generated/abi.json, from agent/src/abi/generated.ts). */
export const vaultAbi = abis.MandateVault as Abi;
export const creditAdapterAbi = abis.ICreditAdapter as Abi;

const uintOut = (type: "uint8" | "uint256") => [{ name: "", type, internalType: type }] as const;
const accountIn = [{ name: "account", type: "address", internalType: "address" }] as const;

/** The B20 reads the dashboard makes, copied from agent/src/abi/generated.ts b20AssetAbi (test/chain-abi.test.ts). */
export const b20Abi = [
  { type: "function", name: "balanceOf", inputs: accountIn, outputs: uintOut("uint256"), stateMutability: "view" },
  { type: "function", name: "balanceOfUI", inputs: accountIn, outputs: uintOut("uint256"), stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: uintOut("uint8"), stateMutability: "view" },
  { type: "function", name: "uiMultiplier", inputs: [], outputs: uintOut("uint256"), stateMutability: "view" },
] as const;

/** Chainlink's latestRoundData, from agent/src/abi/generated.ts aggregatorV3Abi. */
export const feedAbi = [
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80", internalType: "uint80" },
      { name: "answer", type: "int256", internalType: "int256" },
      { name: "startedAt", type: "uint256", internalType: "uint256" },
      { name: "updatedAt", type: "uint256", internalType: "uint256" },
      { name: "answeredInRound", type: "uint80", internalType: "uint80" },
    ],
    stateMutability: "view",
  },
] as const;

/** ERC-20 balanceOf (USDC), from agent/src/abi/generated.ts erc20Abi. */
export const erc20Abi = [
  { type: "function", name: "balanceOf", inputs: accountIn, outputs: uintOut("uint256"), stateMutability: "view" },
] as const;
