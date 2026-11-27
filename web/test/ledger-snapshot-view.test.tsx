import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HowWeRead } from "@/components/ledger/HowWeRead";
import { MainnetStrip, missingBlocksText } from "@/components/ledger/StatusStrip";
import { memoryStorage } from "@/lib/chain/cache";
import { loadLedger } from "@/lib/chain/load";
import fixture from "./fixtures/decisions-snapshot.json";
import { FAKE_VAULT, fakeLedgerClient, hash32 } from "./helpers/fake-ledger";
import { SNAP_DEPLOY_TX, SNAP_HEAD, snapshotChain } from "./helpers/snapshot-chain";

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
    expect(container).toHaveTextContent("Logs up to block 59,845,129 are from the committed snapshot of block 59,845,280. Base gave the same hash for that block and the same logs in their transaction receipts.");
    expect(screen.getByRole("link", { name: "committed snapshot" })).toHaveAttribute("href", "/data/decisions-snapshot.json");
  });

  it("says nothing of a snapshot after a full scan", async () => {
    const { container } = strip(await load());
    expect(container.textContent).not.toMatch(/snapshot/);
  });

  it("explains in How this page reads Base what the snapshot is, what is read again and what is checked", () => {
    const { container } = render(<HowWeRead />);
    expect(screen.getByText("Checked against Base")).toBeInTheDocument();
    expect(container).toHaveTextContent(
      "A first visit starts from a snapshot the repository commits (/data/decisions-snapshot.json, written from Base by npm run snapshot). Once Base gives the same hash for the snapshot's block, the page takes from the file the logs more than 150 blocks below it and reads every block after those from Base. It shows one of those logs only once its transaction's receipt on Base holds the same log, and it reads each Decision's time, gas and transaction from Base, so the file can leave a log out but cannot add or change one. When the site serves another file, or none, this browser forgets what it took from the old one.",
    );
    expect(screen.getByRole("link", { name: "/data/decisions-snapshot.json" })).toHaveAttribute("href", "/data/decisions-snapshot.json");
  });
});

describe("the ledger names the blocks it could not read", () => {
  it("says which older range is missing and that every newer block was read, so the newest Decisions it shows are complete", async () => {
    // Every eth_getLogs below the newest chunk fails: the scan reads the newest chunk first, so its Decisions stay.
    const s = await loadLedger({
      client: fakeLedgerClient(snapshotChain({ failLogsBelow: SNAP_HEAD - 49_999n })),
      vault: FAKE_VAULT,
      deployTx: SNAP_DEPLOY_TX,
      storage: memoryStorage(),
      rationaleSource: { name: "none", lookup: async () => new Map() },
    });
    expect(s.decisions.map((d) => d.txHash)).toEqual([hash32(4), hash32(3)]);
    const { container } = strip(s);
    expect(container.querySelector("[data-ledger-missing]")).toHaveTextContent(
      "Blocks 59,745,280 to 59,815,280 could not be read, so decisions in them are missing here. Every block from 59,815,281 to the head, block 59,865,280, was read, so the newest decisions are shown. Read again",
    );
    expect(screen.getByRole("button", { name: "Read again" })).toBeInTheDocument();
  });

  it("names up to three ranges, newest first, and counts the rest", () => {
    const gaps = [5n, 4n, 3n, 2n, 1n].map((n) => ({ from: n * 1_000n, to: n * 1_000n + 99n }));
    expect(missingBlocksText({ gaps, scannedFrom: null, head: 9_000n })).toBe(
      "Blocks 5,000 to 5,099, 4,000 to 4,099, 3,000 to 3,099 and 2 more ranges could not be read, so decisions in them are missing here.",
    );
    expect(missingBlocksText({ gaps: gaps.slice(0, 2), scannedFrom: 5_100n, head: 9_000n })).toBe(
      "Blocks 5,000 to 5,099 and 4,000 to 4,099 could not be read, so decisions in them are missing here. Every block from 5,100 to the head, block 9,000, was read, so the newest decisions are shown.",
    );
  });

  it("does not say the newest blocks were read when the chunk at the head failed", () => {
    expect(missingBlocksText({ gaps: [{ from: 10n, to: 20n }], scannedFrom: null, head: 20n })).toBe(
      "Blocks 10 to 20 could not be read, so decisions in them are missing here.",
    );
  });
});
