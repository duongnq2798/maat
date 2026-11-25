import { render, screen, waitFor, within } from "@testing-library/react";
import type { Address, Hash, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ProofApp } from "@/app/(site)/proof/ProofApp";
import ProofPage, { metadata } from "@/app/(site)/proof/page";
import { proofConfig } from "@/app/(site)/proof/config";
import { VERIFIED_ACCOUNT_SCHEMA, type Attestation } from "@/app/(site)/proof/verified";
import { inboxDeployment } from "@/lib/chain/inbox";
import { docsData } from "@/lib/docs/generated";
import { proofChainClient, type ProofChain } from "./helpers/fake-proof-chain";

const INBOX: Address = "0x00000000000000000000000000000000000B0001";
const DEPLOY_TX: Hash = `0x${"d1".repeat(32)}`;
const DEPLOY = 62_000_000n;
const OWNER: Address = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
const ALICE: Address = "0x00000000000000000000000000000000000A11cE";
const BOB: Address = "0x0000000000000000000000000000000000000B0b";
const UID: Hex = `0x${"a1".repeat(32)}`;
const ZERO32: Hex = `0x${"0".repeat(64)}`;
const ROWS = (inbox: boolean) => [
  ...docsData.deployments.filter((r) => r.contract !== "MaatInbox"),
  ...(inbox ? [{ network: "Base mainnet", contract: "MaatInbox", address: INBOX, tx: DEPLOY_TX, date: "2026-11-30" }] : []),
];
const never = () => new Promise<never>(() => {});

const ALICE_VA: Attestation = {
  uid: UID,
  schema: VERIFIED_ACCOUNT_SCHEMA,
  time: 1_795_000_000n,
  expirationTime: 0n,
  revocationTime: 0n,
  refUID: ZERO32,
  recipient: ALICE,
  attester: "0x357458739F90461b99789350868CD7CF330Dd7EE",
  revocable: true,
  data: `0x${"0".repeat(63)}1`,
};

const CHAIN: ProofChain = {
  chainId: 8453,
  head: DEPLOY + 1_000n,
  headTime: 1_795_619_778n,
  inbox: INBOX,
  deployTx: DEPLOY_TX,
  deployBlock: DEPLOY,
  briefs: [
    { id: 1, from: ALICE, text: "buy", block: DEPLOY + 1n },
    { id: 2, from: OWNER, text: "test", block: DEPLOY + 2n },
    { id: 3, from: BOB, text: "sell", block: DEPLOY + 3n },
    { id: 4, from: ALICE, text: "again", block: DEPLOY + 4n },
  ],
  uids: { [ALICE.toLowerCase()]: UID },
  attestations: { [UID]: ALICE_VA },
};

const value = (label: string) => screen.getByTestId(`proof-${label}`).textContent;

describe("/proof while deployments/README.md records no MaatInbox", () => {
  it("shows the rule, says counting starts when the inbox is recorded, and gives zero on every line with no row", () => {
    render(<ProofApp initial={proofConfig(ROWS(false))} deps={{ fetchConfig: never }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Proof" })).toBeInTheDocument();
    const state = document.querySelector('[data-proof-state="not-recorded"]');
    expect(state?.textContent).toContain("Counting starts when the inbox is recorded.");
    for (const key of ["outside-briefs", "outside-wallets", "verified", "team-briefs", "hidden-briefs", "bounty-claimants"]) {
      expect(value(key)).toBe("0");
    }
    expect(screen.queryByRole("table", { name: "Outside wallets" })).toBeNull();
    expect(screen.getByRole("heading", { name: "The counting rule" })).toBeInTheDocument();
    expect(screen.getByText(/No line is ever added to another\./)).toBeInTheDocument();
    expect(screen.getByText("node scripts/recount.mjs")).toBeInTheDocument();
  });

  it("builds its static state from the committed deployments table", () => {
    render(<ProofPage />);
    const recorded = inboxDeployment(docsData.deployments) !== null;
    expect(document.querySelector(`[data-proof-state="${recorded ? "reading" : "not-recorded"}"]`)).not.toBeNull();
  });

  it("is a public page: its canonical URL, no robots rule, and a description of 50 to 160 characters", () => {
    expect(metadata.alternates?.canonical).toBe("/proof");
    expect(metadata.robots).toBeUndefined();
    expect(String(metadata.title)).toBe("Proof · Maat");
    const d = String(metadata.description);
    expect(d.length).toBeGreaterThanOrEqual(50);
    expect(d.length).toBeLessThanOrEqual(160);
  });
});

describe("/proof with a MaatInbox recorded", () => {
  it("counts the inbox's Brief logs by the rule and fills the Verified Account column", async () => {
    render(<ProofApp initial={proofConfig(ROWS(true))} deps={{ client: proofChainClient(CHAIN), fetchConfig: never }} />);
    expect(document.querySelector('[data-proof-state="reading"]')).not.toBeNull();
    await waitFor(() => expect(value("outside-briefs")).toBe("3"), { timeout: 10_000 });
    expect(value("outside-wallets")).toBe("2");
    expect(value("verified")).toBe("1");
    expect(value("team-briefs")).toBe("1");
    expect(value("hidden-briefs")).toBe("0");
    expect(value("bounty-claimants")).toBe("0");
    expect(screen.getByText(/Counted to block 62,001,000/)).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Outside wallets" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent))).toEqual([
      [ALICE.toLowerCase(), "2", UID],
      [BOB.toLowerCase(), "1", "none"],
    ]);
    expect(table.querySelectorAll("a")).toHaveLength(0);
    expect(within(screen.getByRole("table", { name: "Team wallets" })).getAllByRole("row")).toHaveLength(2);
  });

  it("switches to the table /data/deployments.json serves at runtime", async () => {
    render(<ProofApp initial={proofConfig(ROWS(false))} deps={{ client: proofChainClient(CHAIN), fetchConfig: async () => proofConfig(ROWS(true)) }} />);
    await waitFor(() => expect(value("outside-briefs")).toBe("3"), { timeout: 10_000 });
    expect(document.querySelector('[data-proof-state="not-recorded"]')).toBeNull();
  });

  it("says when the briefs cannot be read, and shows no number it did not read", async () => {
    render(<ProofApp initial={proofConfig(ROWS(true))} deps={{ client: proofChainClient(CHAIN, { fail: true }), fetchConfig: never }} />);
    await waitFor(() => expect(screen.getByText(/The briefs could not be read/)).toBeInTheDocument(), { timeout: 15_000 });
    expect(value("outside-briefs")).toBe("…");
    expect(screen.getByRole("button", { name: "Read again" })).toBeInTheDocument();
  });
});
