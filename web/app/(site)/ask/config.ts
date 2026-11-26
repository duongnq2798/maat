import type { Address, Hash } from "viem";
import { z } from "zod";
import type { TeamInputs } from "@/app/(site)/proof/team";
import { ASK_OPEN } from "@/content/ask-open";
import { deploymentConfig } from "@/lib/chain/config";
import { inboxDeployment, type InboxDeployment } from "@/lib/chain/inbox";
import type { Deployment } from "@/lib/docs/docs-data";

/** What /ask reads: the vault it previews against, the inbox it sends to, the owner's switch, and the deploy rows. */
export interface AskConfig {
  vault: Address | null;
  deployTx: Hash | null;
  /** Null until deployments/README.md records a Base mainnet MaatInbox address. */
  inbox: InboxDeployment | null;
  /** The owner's switch, content/ask-open.ts. */
  open: boolean;
  /** Every Base mainnet row of deployments/README.md, whose deployers and vault /proof's team trace reads. */
  deployments: TeamInputs["deployments"];
}

export function askConfig(rows: readonly Deployment[], open: boolean = ASK_OPEN): AskConfig {
  const v = deploymentConfig(rows);
  return {
    vault: v?.vault ?? null,
    deployTx: v?.deployTx ?? null,
    inbox: inboxDeployment(rows),
    open,
    deployments: rows.filter((r) => r.network === "Base mainnet").map(({ contract, address, tx }) => ({ contract, address, tx })),
  };
}

/** Whether /ask sends briefs and shows the feed: the owner's switch is on, and the inbox and the vault are recorded. */
export function askIsOpen(c: AskConfig): c is AskConfig & { vault: Address; inbox: InboxDeployment } {
  return c.open && c.inbox !== null && c.vault !== null;
}

const deploymentsSchema = z.object({
  contracts: z.array(z.object({ network: z.string(), contract: z.string(), address: z.string(), tx: z.string(), date: z.string() })),
});
const switchSchema = z.object({ open: z.boolean() });

async function readJson<T>(fetchImpl: typeof fetch, path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetchImpl(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path} answered HTTP ${res.status}`);
  return schema.parse(await res.json());
}

/**
 * The table as /data/deployments.json serves it and the switch as /data/ask.json serves it, read at runtime as /ledger
 * reads the table, so the e2e suite can serve its own inbox and open the page on the real build. Throws when either
 * file cannot be read or does not have its shape.
 */
export async function fetchAskConfig(fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<AskConfig> {
  const [table, flag] = await Promise.all([readJson(fetchImpl, "/data/deployments.json", deploymentsSchema), readJson(fetchImpl, "/data/ask.json", switchSchema)]);
  return askConfig(table.contracts, flag.open);
}
