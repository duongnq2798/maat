import type { Address, Hash } from "viem";
import { z } from "zod";
import { deploymentConfig } from "@/lib/chain/config";
import { inboxDeployment, type InboxDeployment } from "@/lib/chain/inbox";
import type { Deployment } from "@/lib/docs/docs-data";

/** What /ask reads from the deployments table: the vault it previews against and the inbox it sends to. */
export interface AskConfig {
  vault: Address | null;
  deployTx: Hash | null;
  /** Null until deployments/README.md records a Base mainnet MaatInbox address: until then the page is not open. */
  inbox: InboxDeployment | null;
}

export function askConfig(rows: readonly Deployment[]): AskConfig {
  const v = deploymentConfig(rows);
  return { vault: v?.vault ?? null, deployTx: v?.deployTx ?? null, inbox: inboxDeployment(rows) };
}

const fileSchema = z.object({
  contracts: z.array(z.object({ network: z.string(), contract: z.string(), address: z.string(), tx: z.string(), date: z.string() })),
});

/**
 * The table as /data/deployments.json serves it, read at runtime as /ledger reads it, so the e2e suite can serve its own
 * inbox to the real build. Throws when the file cannot be read or does not have that shape.
 */
export async function fetchAskConfig(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<AskConfig> {
  const res = await fetchImpl("/data/deployments.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`/data/deployments.json answered HTTP ${res.status}`);
  return askConfig(fileSchema.parse(await res.json()).contracts);
}
