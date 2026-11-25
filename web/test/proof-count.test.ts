// @vitest-environment node
import { getAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { countBriefs, emptyCount, proofLines, reportLines, type CountLists } from "@/app/(site)/proof/count";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { PROOF_BOUNTY } from "@/content/proof-bounty";
import { PROOF_TEAM } from "@/content/proof-team";

const OWNER: Address = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
const EXECUTOR: Address = "0x9bC6E49d42e0659f3ef667B09B67506B348e115A";
const ALICE: Address = "0x00000000000000000000000000000000000A11cE";
const BOB: Address = "0x0000000000000000000000000000000000000B0b";
const CAROL: Address = "0x000000000000000000000000000000000000ca01";
const lower = (a: string) => a.toLowerCase();
const UID: Hex = `0x${"c6".repeat(32)}`;

/**
 * Seven Brief logs: Alice twice (ids 1 and 5), Bob once, Carol once (id 6, on the hide-list), the owner once and the
 * executor once (in lower case, as a log topic gives it), and the owner's id 4, also on the hide-list.
 */
const BRIEFS = [
  { id: 1, from: ALICE },
  { id: 2, from: OWNER },
  { id: 3, from: BOB },
  { id: 4, from: OWNER },
  { id: 5, from: ALICE },
  { id: 6, from: CAROL },
  { id: 7, from: lower(EXECUTOR) as Address },
];

const LISTS: CountLists = {
  team: [{ address: OWNER }, { address: EXECUTOR }],
  // 6 is Carol's; 4 is the owner's, a team brief; 99 was never sent.
  hidden: [6, 4, 99, 6],
  bounty: [
    { address: BOB, evidence: "https://github.com/duongnq2798/maat/issues/1" },
    { address: lower(BOB), evidence: "the same claimant again" },
    { address: CAROL, evidence: "a fork test" },
  ],
};

describe("the counting rule of inbox spec §5, on fixture Brief logs", () => {
  const count = countBriefs(BRIEFS, LISTS);

  it("leaves the team's briefs out of the outside counts and puts them on their own line", () => {
    expect(count.outsideBriefs).toBe(4);
    expect(count.teamBriefs).toBe(3);
    expect(count.outsideWallets.map((w) => w.address)).not.toContain(lower(OWNER));
    expect(count.outsideWallets.map((w) => w.address)).not.toContain(lower(EXECUTOR));
    expect(count.teamWallets).toEqual([
      { address: lower(OWNER), briefs: 2 },
      { address: lower(EXECUTOR), briefs: 1 },
    ]);
  });

  it("counts a sender with two briefs once as a wallet, in the order of each wallet's first brief", () => {
    expect(count.outsideWallets).toEqual([
      { address: lower(ALICE), briefs: 2 },
      { address: lower(BOB), briefs: 1 },
      { address: lower(CAROL), briefs: 1 },
    ]);
  });

  it("lists hidden outside briefs on their own line and still counts them as outside briefs", () => {
    expect(count.hidden).toEqual([{ id: 6, from: lower(CAROL) }]);
    // Hiding changes no number: the same logs with an empty hide-list give the same outside and team counts.
    const shown = countBriefs(BRIEFS, { ...LISTS, hidden: [] });
    expect(shown.outsideBriefs).toBe(count.outsideBriefs);
    expect(shown.outsideWallets).toEqual(count.outsideWallets);
    expect(shown.teamBriefs).toBe(count.teamBriefs);
    expect(shown.hidden).toEqual([]);
  });

  it("keeps bounty claimants on their own line, once per address, and out of every brief count", () => {
    expect(count.bounty).toEqual([
      { address: lower(BOB), evidence: "https://github.com/duongnq2798/maat/issues/1" },
      { address: lower(CAROL), evidence: "a fork test" },
    ]);
    expect(countBriefs(BRIEFS, { ...LISTS, bounty: [] }).outsideBriefs).toBe(count.outsideBriefs);
  });

  it("gives the six lines, with the Verified Account count from the column", () => {
    const verified = new Map<string, Hex | null>([
      [lower(ALICE), UID],
      [lower(BOB), null],
      [lower(CAROL), null],
    ]);
    expect(proofLines(count, verified).map((l) => [l.label, l.value])).toEqual([
      ["Outside briefs", 4],
      ["Outside wallets", 3],
      ["Outside wallets with a Verified Account", 1],
      ["Team briefs", 3],
      ["Hidden briefs", 1],
      ["Bounty claimants", 2],
    ]);
    expect(proofLines(count, null).find((l) => l.key === "verified")?.value).toBeNull();
  });

  it("writes the report the page shows and scripts/recount.mjs prints", () => {
    const verified = new Map<string, Hex | null>([
      [lower(ALICE), UID],
      [lower(BOB), null],
      [lower(CAROL), null],
    ]);
    expect(reportLines(count, verified)).toEqual([
      "Outside briefs: 4",
      "Outside wallets: 3",
      "Outside wallets with a Verified Account: 1",
      "Team briefs: 3",
      "Hidden briefs: 1",
      "Bounty claimants: 2",
      `Outside wallet ${lower(ALICE)}: 2 briefs, Verified Account ${UID}`,
      `Outside wallet ${lower(BOB)}: 1 brief, no Verified Account`,
      `Outside wallet ${lower(CAROL)}: 1 brief, no Verified Account`,
      `Team wallet ${lower(OWNER)}: 2 briefs`,
      `Team wallet ${lower(EXECUTOR)}: 1 brief`,
      `Hidden brief #6 from ${lower(CAROL)}`,
      `Bounty claimant ${lower(BOB)}: https://github.com/duongnq2798/maat/issues/1`,
      `Bounty claimant ${lower(CAROL)}: a fork test`,
    ]);
  });

  it("gives zero on every line and no row before any brief", () => {
    const none = countBriefs([], LISTS);
    expect(none).toEqual({ ...emptyCount(), bounty: count.bounty });
    expect(reportLines(emptyCount(), new Map())).toEqual([
      "Outside briefs: 0",
      "Outside wallets: 0",
      "Outside wallets with a Verified Account: 0",
      "Team briefs: 0",
      "Hidden briefs: 0",
      "Bounty claimants: 0",
    ]);
  });

  it("gives no number and no row on a brief line while the count is incomplete or the inbox is not deployed", () => {
    for (const [state, word] of [
      ["incomplete", "incomplete"],
      ["not-deployed", "not deployed"],
    ] as const) {
      expect(reportLines(count, new Map(), state)).toEqual([
        `Outside briefs: ${word}`,
        `Outside wallets: ${word}`,
        `Outside wallets with a Verified Account: ${word}`,
        `Team briefs: ${word}`,
        `Hidden briefs: ${word}`,
        "Bounty claimants: 2",
        `Bounty claimant ${lower(BOB)}: https://github.com/duongnq2798/maat/issues/1`,
        `Bounty claimant ${lower(CAROL)}: a fork test`,
      ]);
    }
  });

  it("refuses a list address that is not 0x and 40 hex digits", () => {
    expect(() => countBriefs(BRIEFS, { ...LISTS, team: [{ address: "0x1234" }] })).toThrow(/team/);
    expect(() => countBriefs(BRIEFS, { ...LISTS, bounty: [{ address: "alice.eth", evidence: "x" }] })).toThrow(/bounty/);
  });
});

describe("the committed lists", () => {
  it("puts the owner and the agent executor on the team, and nothing else yet", () => {
    expect(PROOF_TEAM.map((w) => getAddress(w.address))).toEqual([OWNER, EXECUTOR]);
    expect(PROOF_TEAM.map((w) => w.role)).toEqual(["owner", "agent executor"]);
  });

  it("has no bounty claimant", () => {
    expect(PROOF_BOUNTY).toEqual([]);
  });

  it("gives the committed lists to countBriefs without an error", () => {
    expect(() => countBriefs(BRIEFS, { team: PROOF_TEAM, hidden: HIDDEN_BRIEFS, bounty: PROOF_BOUNTY })).not.toThrow();
  });
});
