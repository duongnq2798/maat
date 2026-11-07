import { encodeFunctionData, type Address, type Hex } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import type { OnchainIntent } from "../types.js";

export function encodeExecute(i: OnchainIntent): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "execute", args: [i] });
}

export function encodeSyncMultiplier(token: Address): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "syncMultiplier", args: [token] });
}

export function encodeNotifyRevenue(): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "notifyRevenue" });
}

/**
 * eth_estimateGas cannot be trusted for the vault: execute() and syncMultiplier() swallow inner failures (swap
 * try/catch, tryTransfer, the low-level credit call, try uiMultiplier()), so the estimate converges on a limit that
 * starves the inner call and the vault logs SWAP_FAILED. Every send therefore carries an explicit limit of at least
 * the per-function floor (sized from the measured Base-fork gasUsed) and at most MAX_GAS.
 */
export const EXECUTE_GAS_FLOOR = 2_500_000n;
export const SYNC_GAS_FLOOR = 300_000n;
/** notifyRevenue swallows nothing (one balanceOf, one SSTORE, one event); the floor is headroom, checked on the fork. */
export const NOTIFY_GAS_FLOOR = 100_000n;
export const MAX_GAS = 3_000_000n;
export const GAS_FLOOR = { execute: EXECUTE_GAS_FLOOR, syncMultiplier: SYNC_GAS_FLOOR, notifyRevenue: NOTIFY_GAS_FLOOR } as const;
export type GasFunction = keyof typeof GAS_FLOOR;

/** min(MAX_GAS, max(floor, estimate * 1.3)). */
export function gasLimit(fn: GasFunction, estimate: bigint): bigint {
  const padded = (estimate * 13n) / 10n;
  const g = padded > GAS_FLOOR[fn] ? padded : GAS_FLOOR[fn];
  return g < MAX_GAS ? g : MAX_GAS;
}
