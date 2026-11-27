import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BriefsPanel } from "@/app/(site)/ask/BriefsPanel";
import type { JournalRead } from "@/lib/chain/ledger";
import { SNAPSHOT_REORG_WINDOW } from "@/lib/chain/snapshot";
import fixture from "./fixtures/briefs-snapshot.json";
import { FAKE_VAULT, fakeLedgerClient } from "./helpers/fake-ledger";
import { BRIEFS_BLOCK, BRIEFS_DEPLOY, BRIEFS_DEPLOY_TX, BRIEFS_INBOX, briefsChain } from "./helpers/briefs-chain";

// /ask's feed reads the Brief logs from the committed Brief snapshot once Base confirms it, as /proof does.

const INBOX = { inbox: BRIEFS_INBOX, deployTx: BRIEFS_DEPLOY_TX };
const never = () => new Promise<JournalRead>(() => {});
const noTeam = async () => ({ members: new Set<string>(), complete: true });
const lowest = (calls: readonly { from: bigint }[]) => calls.reduce((m, c) => (c.from < m ? c.from : m), BRIEFS_BLOCK * 2n);

function panel(briefsSnapshot: () => Promise<unknown>) {
  const client = fakeLedgerClient(briefsChain());
  render(<BriefsPanel inbox={INBOX} vault={FAKE_VAULT} deployments={[]} client={client} reloadKey={0} journal={never} team={noTeam} briefsSnapshot={briefsSnapshot} />);
  return client;
}

describe("/ask's Brief feed and the committed Brief snapshot", () => {
  it("takes the Brief logs below the file's window, scans above it, lists every brief and says which blocks the file gave", async () => {
    const client = panel(async () => fixture);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4), { timeout: 10_000 });
    expect(document.querySelector("[data-briefs-snapshot]")).toHaveTextContent(
      "Brief logs to block 59,885,129 are from the committed Brief snapshot of block 59,885,280, which Base confirmed; the rest were read from Base.",
    );
    expect(lowest(client.logCalls)).toBe(BRIEFS_BLOCK - SNAPSHOT_REORG_WINDOW);
  });

  it("reads every block from the inbox's deploy block, and says nothing of a file, when the fetch fails", async () => {
    const client = panel(async () => Promise.reject(new Error("offline")));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4), { timeout: 10_000 });
    expect(document.querySelector("[data-briefs-snapshot]")).toBeNull();
    expect(lowest(client.logCalls)).toBe(BRIEFS_DEPLOY);
  });
});
