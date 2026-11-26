import { clientRpc, vaultSeed, type ProofClient, type ProofSeeds } from "@/app/(site)/proof/load";
import { traceTeam, type TeamInputs } from "@/app/(site)/proof/team";
import { PROOF_SENDS } from "@/content/proof-sends";
import { PROOF_STOPS } from "@/content/proof-stops";
import { PROOF_TEAM } from "@/content/proof-team";
import { browserStorage } from "@/lib/chain/cache";
import type { Brief } from "@/lib/chain/inbox";
import { fetchSnapshotJson } from "@/lib/chain/snapshot";

/** /proof's team set as /ask reads it: its wallets, lowercased, and false for `complete` when the trace has a gap. */
export interface TeamRead {
  members: ReadonlySet<string>;
  complete: boolean;
}

/** Reads the team set at `head` for `briefs`, the Brief logs read to that block (`complete` false when some were not). */
export type TeamReader = (briefs: readonly Brief[], opts: { head: bigint; complete: boolean; signal: AbortSignal }) => Promise<TeamRead>;

/**
 * /proof's own team trace (proof/team.ts traceTeam), with /proof's committed lists and the same seeds of the vault's
 * logs: the committed snapshot and this browser's ledger cache, each checked against its receipt. So a sender /ask
 * marks "team" is one /proof counts on its Team briefs line, at the same block.
 */
export function traceTeamReader(
  client: ProofClient,
  deployments: TeamInputs["deployments"],
  seeds: () => ProofSeeds = () => ({ snapshot: fetchSnapshotJson(), storage: browserStorage() }),
): TeamReader {
  return async (briefs, { head, complete, signal }) => {
    const vault = deployments.find((r) => r.contract === "MandateVault" && r.address.trim() !== "")?.address.trim();
    const inputs: TeamInputs = {
      team: PROOF_TEAM,
      sends: PROOF_SENDS,
      stops: PROOF_STOPS,
      deployments,
      briefScan: { briefs: briefs.map((b) => ({ from: b.from, txHash: b.txHash })), complete },
      vaultSeed: vault ? vaultSeed(vault, seeds()) : null,
    };
    const trace = await traceTeam(clientRpc(client), inputs, head, signal);
    return { members: new Set(trace.members.map((m) => m.address.toLowerCase())), complete: trace.gaps.length === 0 };
  };
}
