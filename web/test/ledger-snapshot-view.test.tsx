import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HowWeRead } from "@/components/ledger/HowWeRead";
import { MainnetStrip } from "@/components/ledger/StatusStrip";
import { memoryStorage } from "@/lib/chain/cache";
import { loadLedger } from "@/lib/chain/load";
import fixture from "./fixtures/decisions-snapshot.json";
import { FAKE_VAULT, fakeLedgerClient } from "./helpers/fake-ledger";
import { SNAP_DEPLOY_TX, snapshotChain } from "./helpers/snapshot-chain";

const load = (snapshot?: unknown) =>
  loadLedger({
    client: fakeLedgerClient(snapshotChain()),
    vault: FAKE_VAULT,
    deployTx: SNAP_DEPLOY_TX,
    storage: memoryStorage(),
    rationaleSource: { name: "none", lookup: async () => new Map() },
    snapshot,
  });

const strip = (s: Awaited<ReturnType<typeof load>>) =>
  render(<MainnetStrip snapshot={s} endpoints={["https://rpc.test"]} loading={false} refreshError={null} onRetry={() => undefined} />);

describe("the ledger says when a read started from the committed snapshot", () => {
  it("names the snapshot's block and the blocks taken from it, and links the file", async () => {
    const { container } = strip(await load(fixture));
    // N = 59,845,280; the logs up to N − 151 come from the file.
    expect(container).toHaveTextContent("Logs up to block 59,845,129 are from the committed snapshot of block 59,845,280, whose hash Base confirmed.");
    expect(screen.getByRole("link", { name: "committed snapshot" })).toHaveAttribute("href", "/data/decisions-snapshot.json");
  });

  it("says nothing of a snapshot after a full scan", async () => {
    const { container } = strip(await load());
    expect(container.textContent).not.toMatch(/snapshot/);
  });

  it("explains in How this page reads Base what the snapshot is and what is read again", () => {
    const { container } = render(<HowWeRead />);
    expect(container).toHaveTextContent(
      "A first visit starts from a snapshot the repository commits (/data/decisions-snapshot.json, written from Base by npm run snapshot). Once Base gives the same hash for the snapshot's block, the page takes from the file the logs more than 150 blocks below it and reads every block after those from Base.",
    );
    expect(screen.getByRole("link", { name: "/data/decisions-snapshot.json" })).toHaveAttribute("href", "/data/decisions-snapshot.json");
  });
});
