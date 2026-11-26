import type { Hex, PublicClient } from "viem";
import { readBriefs, type InboxDeployment } from "@/lib/chain/inbox";
import { errorText, type LedgerClient } from "@/lib/chain/load";
import { countBriefs, type ProofCount, type ProofLists } from "./count";
import { traceTeam, type Rpc, type TeamInputs, type TeamTrace } from "./team";
import { readVerifiedAccounts } from "./verified";

/** The reads /proof makes: the ledger's, plus raw JSON-RPC requests for the team trace. A viem PublicClient has both. */
export type ProofClient = LedgerClient & Pick<PublicClient, "request">;

/** What a failed chunk of the Brief log scan leaves. */
export const SCAN_GAP = "Some blocks of the Brief logs could not be read, so briefs may be missing.";

export interface ProofRead {
  count: ProofCount;
  /** The Verified Account column, or null when it could not be read (`verifiedError` says why). */
  verified: Map<string, Hex | null> | null;
  verifiedError: string | null;
  /** False when a chunk of the log scan failed or the team trace has a gap; no brief line has a number then. */
  complete: boolean;
  /** Why the read is not complete, one sentence each. */
  problems: string[];
  /** The block the briefs were read to; the team set and the column are read at this block too. */
  head: bigint;
  team: TeamTrace;
}

/** Raw JSON-RPC over the page's client, for team.ts, which the recount runs over fetch. */
export const clientRpc =
  (client: Pick<PublicClient, "request">): Rpc =>
  (method, params) =>
    client.request({ method, params } as never) as Promise<unknown>;

/**
 * Everything /proof shows, from the chain: every Brief log of the inbox up to the head (the /ask reader), the team set
 * traced at the head from those logs, the vault's and the committed lists, the briefs counted by the rule, then the
 * Verified Account of each outside wallet, read at the head block and judged at its timestamp. An incomplete read gives
 * no column, since its lines show no number.
 */
export async function readProof(
  client: ProofClient,
  config: { inbox: Pick<InboxDeployment, "inbox" | "deployTx">; deployments: TeamInputs["deployments"] },
  lists: ProofLists,
  signal?: AbortSignal,
): Promise<ProofRead> {
  // The head first, so the trace reads the vault's logs to it while the Brief logs are read.
  const head = await client.getBlockNumber();
  const scan = readBriefs(client, { inbox: config.inbox.inbox, deployTx: config.inbox.deployTx, head, signal });
  // The trace takes a team wallet's briefs as its sends from the Brief logs read here, so it reads none twice.
  const inputs = { team: lists.team, sends: lists.sends, stops: lists.stops, deployments: config.deployments, briefScan: scan };
  const [read, team] = await Promise.all([scan, traceTeam(clientRpc(client), inputs, head, signal)]);
  const count = countBriefs(read.briefs, { ...lists, team: team.members });
  const problems = [...(read.complete ? [] : [SCAN_GAP]), ...team.gaps];
  const base = { count, complete: problems.length === 0, problems, head: read.head, team };
  if (!base.complete || count.outsideWallets.length === 0) return { ...base, verified: new Map(), verifiedError: null };
  try {
    const block = await client.getBlock({ blockNumber: read.head });
    const verified = await readVerifiedAccounts(
      client,
      count.outsideWallets.map((w) => w.address),
      { blockNumber: read.head, now: block.timestamp },
    );
    return { ...base, verified, verifiedError: null };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { ...base, verified: null, verifiedError: errorText(e) };
  }
}
