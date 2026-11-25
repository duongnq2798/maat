import { render, screen, waitFor, within } from "@testing-library/react";
import type { Address, Hash, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { ProofApp } from "@/app/(site)/proof/ProofApp";
import ProofPage, { metadata } from "@/app/(site)/proof/page";
import { proofConfig } from "@/app/(site)/proof/config";
import { DECISION_NOTE, TEAM_SET_NOTE } from "@/app/(site)/proof/team";
import { VERIFIED_ACCOUNT_SCHEMA, type Attestation } from "@/app/(site)/proof/verified";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { PROOF_BOUNTY } from "@/content/proof-bounty";
import { PROOF_SENDS } from "@/content/proof-sends";
import { PROOF_STOPS } from "@/content/proof-stops";
import { PROOF_TEAM } from "@/content/proof-team";
import { inboxDeployment } from "@/lib/chain/inbox";
import { docsData } from "@/lib/docs/generated";
import { plainSends, proofChainClient, type ProofChain } from "./helpers/fake-proof-chain";

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

const VAULT = docsData.deployments.find((r) => r.contract === "MandateVault")!.address as Address;

/**
 * The committed lists as the chain's own record: the owner's committed transactions are its only ones, so its nonce
 * matches its list, and the vault gives the owner as owner(), executor() and its one payee, as it did at block
 * 62,146,556. The test inbox's deploy tx is not among them, so the fake chain has the zero address send it.
 */
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
  vault: { address: VAULT, owner: OWNER, executor: OWNER, payees: [OWNER] },
  txs: plainSends(PROOF_SENDS, DEPLOY),
};
const LISTS = { team: PROOF_TEAM, hidden: HIDDEN_BRIEFS, bounty: PROOF_BOUNTY, sends: PROOF_SENDS, stops: PROOF_STOPS };
const BRIEF_LINES = ["outside-briefs", "outside-wallets", "verified", "team-briefs", "hidden-briefs"];

const value = (label: string) => screen.getByTestId(`proof-${label}`).textContent;

describe("/proof while deployments/README.md records no MaatInbox", () => {
  it("shows the rule, says counting starts when the inbox is recorded, and gives no number on a brief line", () => {
    render(<ProofApp initial={proofConfig(ROWS(false))} deps={{ fetchConfig: never }} />);
    expect(screen.getByRole("heading", { level: 1, name: "Proof" })).toBeInTheDocument();
    const state = document.querySelector('[data-proof-state="not-recorded"]');
    expect(state?.textContent).toContain("Counting starts when the inbox is recorded.");
    for (const key of BRIEF_LINES) expect(value(key)).toBe("not deployed");
    // The bounty line comes from its committed list, which needs no inbox.
    expect(value("bounty-claimants")).toBe(String(PROOF_BOUNTY.length));
    expect(screen.queryByRole("table", { name: "Outside wallets" })).toBeNull();
    expect(screen.queryByRole("table", { name: "Team set" })).toBeNull();
    expect(screen.getByRole("heading", { name: "The counting rule" })).toBeInTheDocument();
    expect(screen.getByText(/No line is ever added to another\./)).toBeInTheDocument();
    expect(screen.getByText("node scripts/recount.mjs")).toBeInTheDocument();
  });

  it("puts the team-set note and the Decision note right before the brief lines", () => {
    render(<ProofApp initial={proofConfig(ROWS(false))} deps={{ fetchConfig: never }} />);
    const notes = document.querySelector("[data-proof-notes]");
    expect([...notes!.querySelectorAll("p")].map((p) => p.textContent)).toEqual([TEAM_SET_NOTE, DECISION_NOTE]);
    const lines = screen.getByTestId("proof-outside-briefs");
    expect(notes!.compareDocumentPosition(lines) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    // The team set the trace found, with why, and the stops with their source.
    const team = within(screen.getByRole("table", { name: "Team set" })).getAllByRole("row").slice(1);
    expect(team.map((r) => r.querySelector("td")?.textContent)).toEqual([OWNER.toLowerCase(), "0x9bc6e49d42e0659f3ef667b09b67506b348e115a"]);
    expect(team[0]?.textContent).toContain("the vault's payees()");
    expect(team[0]?.textContent).toContain("deployer of MandateVault");
    const stops = within(screen.getByRole("table", { name: "Hop stops" })).getAllByRole("row").slice(1);
    expect(stops.map((r) => r.querySelector("td")?.textContent)).toEqual(["0x0000000000000000000000000000000000000000", VAULT.toLowerCase()]);
  });

  it("gives no brief number and no 'Counted to block' when a chunk of the log scan fails", async () => {
    // Three outside briefs over three 50,000-block chunks; every read of the middle chunk fails.
    const head = DEPLOY + 120_000n;
    const chain: ProofChain = {
      ...CHAIN,
      head,
      briefs: [
        { id: 1, from: ALICE, text: "a", block: DEPLOY + 10n },
        { id: 2, from: BOB, text: "b", block: DEPLOY + 60_000n },
        { id: 3, from: "0x000000000000000000000000000000000000ca01", text: "c", block: DEPLOY + 70_000n },
      ],
      failLogs: [{ from: DEPLOY + 50_000n, to: DEPLOY + 99_999n }],
    };
    render(<ProofApp initial={proofConfig(ROWS(true))} deps={{ client: proofChainClient(chain), fetchConfig: never }} />);
    await waitFor(() => expect(document.querySelector('[data-proof-state="incomplete"]')).not.toBeNull(), { timeout: 15_000 });
    for (const key of BRIEF_LINES) expect(value(key)).toBe("incomplete");
    expect(value("bounty-claimants")).toBe("0");
    expect(screen.queryByText(/Counted to block/)).toBeNull();
    expect(screen.getByText("Some blocks of the Brief logs could not be read, so briefs may be missing.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Outside wallets" })).toBeNull();
    expect(screen.getByRole("button", { name: "Read again" })).toBeInTheDocument();
  });

  it("gives no brief number when a team wallet sent a transaction its committed list does not hold", async () => {
    const lists = { ...LISTS, sends: PROOF_SENDS.map((s) => ({ ...s, txs: s.txs.slice(0, -1) })) };
    render(<ProofApp initial={proofConfig(ROWS(true))} deps={{ client: proofChainClient(CHAIN), fetchConfig: never, lists }} />);
    await waitFor(() => expect(document.querySelector('[data-proof-state="incomplete"]')).not.toBeNull(), { timeout: 15_000 });
    for (const key of BRIEF_LINES) expect(value(key)).toBe("incomplete");
    expect(screen.getByText(/web\/content\/proof-sends\.ts lists 8 of the 9 transactions 0x3c3a66f713dae7e4a03bbd81db79ff65f42c1d6a sent by block 62,001,000/)).toBeInTheDocument();
    expect(screen.queryByText(/Counted to block/)).toBeNull();
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
