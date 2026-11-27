import { render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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

  it("fetches the file in an effect, never while rendering, and once for every read the panel makes", async () => {
    const fetchFile = vi.fn(async () => fixture);
    const client = fakeLedgerClient(briefsChain());
    const props = { inbox: INBOX, vault: FAKE_VAULT, deployments: [], client, journal: never, team: noTeam, briefsSnapshot: fetchFile };
    // A server render, as the static export prerenders /ask, runs no effect: it must not fetch the file.
    renderToString(<BriefsPanel {...props} reloadKey={0} />);
    expect(fetchFile).not.toHaveBeenCalled();

    const { rerender } = render(<BriefsPanel {...props} reloadKey={0} />);
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(4), { timeout: 10_000 });
    const first = client.logCalls.length;
    rerender(<BriefsPanel {...props} reloadKey={1} />);
    await waitFor(() => expect(client.logCalls.length).toBeGreaterThan(first), { timeout: 10_000 });
    expect(fetchFile).toHaveBeenCalledTimes(1);
    // The second read started from the same file: it scanned only from the file's window up.
    expect(lowest(client.logCalls.slice(first))).toBe(BRIEFS_BLOCK - SNAPSHOT_REORG_WINDOW);
  });
});
