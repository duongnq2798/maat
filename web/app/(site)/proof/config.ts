import { z } from "zod";
import { inboxDeployment, type InboxDeployment } from "@/lib/chain/inbox";
import type { Deployment } from "@/lib/docs/docs-data";
import type { TeamInputs } from "./team";

/**
 * What /proof reads from deployments/README.md: the Base mainnet MaatInbox, or null until it is recorded, and every
 * Base mainnet row, whose deployers and vault the team trace reads.
 */
export interface ProofConfig {
  inbox: InboxDeployment | null;
  deployments: TeamInputs["deployments"];
}

export function proofConfig(rows: readonly Deployment[]): ProofConfig {
  return {
    inbox: inboxDeployment(rows),
    deployments: rows.filter((r) => r.network === "Base mainnet").map(({ contract, address, tx }) => ({ contract, address, tx })),
  };
}

/** Two addresses or hashes, either possibly null, name the same thing: hex compares without regard to case. */
export const sameHex = (a: string | null, b: string | null) => a === b || (a !== null && b !== null && a.toLowerCase() === b.toLowerCase());

/**
 * Whether two tables give /proof the same inputs: the same inbox and deploy tx, and the same Base mainnet rows (the
 * team trace's deployers and vault) in the same order. The page keeps its running read when the runtime table is the
 * build's, and reads again only when they differ.
 */
export function sameProofConfig(a: Pick<ProofConfig, "inbox" | "deployments">, b: Pick<ProofConfig, "inbox" | "deployments">): boolean {
  if (a.inbox === null || b.inbox === null) {
    if (a.inbox !== b.inbox) return false;
  } else if (!sameHex(a.inbox.inbox, b.inbox.inbox) || !sameHex(a.inbox.deployTx, b.inbox.deployTx)) {
    return false;
  }
  return (
    a.deployments.length === b.deployments.length &&
    a.deployments.every((r, i) => {
      const o = b.deployments[i]!;
      return r.contract === o.contract && sameHex(r.address, o.address) && sameHex(r.tx, o.tx);
    })
  );
}

const deploymentsSchema = z.object({
  contracts: z.array(z.object({ network: z.string(), contract: z.string(), address: z.string(), tx: z.string(), date: z.string() })),
});

/**
 * The table as /data/deployments.json serves it, read at runtime as /ledger and /ask read it, so the page follows a
 * deploy recorded after its build. Throws when the file cannot be read or does not have its shape.
 */
export async function fetchProofConfig(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<ProofConfig> {
  const res = await fetchImpl("/data/deployments.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`/data/deployments.json answered HTTP ${res.status}`);
  return proofConfig(deploymentsSchema.parse(await res.json()).contracts);
}
