import { getAddress, isAddress, isHash, type Address, type Hash } from "viem";
import type { Deployment } from "@/lib/docs/docs-data";

export const BASE_CHAIN_ID = 8453;
const NETWORK = "Base mainnet";
const VAULT_CONTRACT = "MandateVault";

/**
 * Where the log scan starts when the deployments table gives the vault but not its deploy tx: Base block 59,735,280,
 * timestamp 2026-11-20T01:17:11Z, read from base-rpc.publicnode.com on 2026-11-20. No Maat contract existed then.
 */
export const SCAN_FLOOR_BLOCK = 59_735_280n;

export interface VaultDeployment {
  vault: Address;
  deployTx: Hash | null;
}

/** The Base mainnet MandateVault of deployments/README.md, or null while its address cell is empty. */
export function deploymentConfig(rows: readonly Deployment[]): VaultDeployment | null {
  const row = rows.find((r) => r.network === NETWORK && r.contract === VAULT_CONTRACT);
  const address = row?.address.trim() ?? "";
  if (!row || address === "") return null;
  if (!isAddress(address, { strict: false })) throw new Error(`deployments/README.md: MandateVault address "${address}" is not an address`);
  const tx = row.tx.trim();
  if (tx !== "" && !isHash(tx)) throw new Error(`deployments/README.md: MandateVault tx "${tx}" is not a transaction hash`);
  return { vault: getAddress(address), deployTx: tx === "" ? null : (tx as Hash) };
}

export interface DeploymentsFile {
  network: typeof NETWORK;
  chainId: typeof BASE_CHAIN_ID;
  vault: Address | null;
  deployTx: Hash | null;
  contracts: readonly Deployment[];
}

/** The JSON served at /data/deployments.json: the whole table, plus the vault the ledger page reads. */
export function deploymentsFile(rows: readonly Deployment[]): DeploymentsFile {
  const v = deploymentConfig(rows);
  return { network: NETWORK, chainId: BASE_CHAIN_ID, vault: v?.vault ?? null, deployTx: v?.deployTx ?? null, contracts: rows };
}
