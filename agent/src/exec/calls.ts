import { encodeFunctionData, type Address, type Hex } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import type { OnchainIntent } from "../types.js";

export function encodeExecute(i: OnchainIntent): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "execute", args: [i] });
}

export function encodeSyncMultiplier(token: Address): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "syncMultiplier", args: [token] });
}
