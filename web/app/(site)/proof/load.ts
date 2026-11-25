import type { Hex } from "viem";
import { readBriefs, type InboxDeployment } from "@/lib/chain/inbox";
import { errorText, type LedgerClient } from "@/lib/chain/load";
import { countBriefs, type ProofCount, type ProofLists } from "./count";
import { readVerifiedAccounts } from "./verified";

export interface ProofRead {
  count: ProofCount;
  /** The Verified Account column, or null when it could not be read (`verifiedError` says why). */
  verified: Map<string, Hex | null> | null;
  verifiedError: string | null;
  /** False when a chunk of the log scan failed, so briefs may be missing. */
  complete: boolean;
  /** The block the briefs were read to; the column is read at this block too. */
  head: bigint;
}

/**
 * Everything /proof shows, from the chain: every Brief log of the inbox up to the head (the /ask reader), counted by
 * the rule, then the Verified Account of each outside wallet, read at the head block and judged at its timestamp.
 */
export async function readProof(
  client: LedgerClient,
  inbox: Pick<InboxDeployment, "inbox" | "deployTx">,
  lists: ProofLists,
  signal?: AbortSignal,
): Promise<ProofRead> {
  const read = await readBriefs(client, { inbox: inbox.inbox, deployTx: inbox.deployTx, signal });
  const count = countBriefs(read.briefs, lists);
  const base = { count, complete: read.complete, head: read.head };
  if (count.outsideWallets.length === 0) return { ...base, verified: new Map(), verifiedError: null };
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
