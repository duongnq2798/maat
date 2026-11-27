// @vitest-environment node
import { getAddress, type Address, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { countBriefs, countDecisions, emptyCount, lineText, proofLines, reportLines, type CountLists } from "@/app/(site)/proof/count";
import type { VaultDecision } from "@/app/(site)/proof/team";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { PROOF_BOUNTY } from "@/content/proof-bounty";
import { PROOF_TEAM } from "@/content/proof-team";
import { executeCalldata, txInput, VECTORS } from "./helpers/maat-v1";

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

  it("gives the ten lines in the order of the rule's table, with the Verified Account count from the column", () => {
    const verified = new Map<string, Hex | null>([
      [lower(ALICE), UID],
      [lower(BOB), null],
      [lower(CAROL), null],
    ]);
    expect(proofLines(count, verified).map((l) => [l.label, l.value])).toEqual([
      ["Owner by hand Decisions", null],
      ["Agent Decisions", null],
      ["Probe Decisions", null],
      ["Outside briefs", 4],
      ["Outside wallets", 3],
      ["Outside wallets with a Verified Account", 1],
      ["Brief-driven Decisions", null],
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
      "Owner by hand Decisions: not read",
      "Agent Decisions: not read",
      "Probe Decisions: not read",
      "Outside briefs: 4",
      "Outside wallets: 3",
      "Outside wallets with a Verified Account: 1",
      "Brief-driven Decisions: not read",
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
      "Owner by hand Decisions: not read",
      "Agent Decisions: not read",
      "Probe Decisions: not read",
      "Outside briefs: 0",
      "Outside wallets: 0",
      "Outside wallets with a Verified Account: 0",
      "Brief-driven Decisions: not read",
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
        "Owner by hand Decisions: not read",
        "Agent Decisions: not read",
        "Probe Decisions: not read",
        `Outside briefs: ${word}`,
        `Outside wallets: ${word}`,
        `Outside wallets with a Verified Account: ${word}`,
        "Brief-driven Decisions: not read",
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

describe("the Decision lines of the rule, on fixture Decision logs", () => {
  const VAULT = "0x3f956072d18ddd20d5efb74e9ccabf8deade699b";
  const OTHER = "0x00000000000000000000000000000000000c0002";
  let n = 0;
  const decision = (from: Address, input: Hex, allowed: boolean, to: string = VAULT): VaultDecision => {
    n += 1;
    return { txHash: `0x${n.toString(16).padStart(64, "0")}`, block: 62_000_000n + BigInt(n), logIndex: n, from: lower(from), to, input, allowed, reason: allowed ? 0 : 6 };
  };
  // The owner's own execute with a brief-driven blob, a probe, two brief-driven Decisions and three agent ones: a
  // model's intent, a call with no blob, and a probe's blob in a transaction to another contract.
  const DECISIONS = [
    decision(OWNER, txInput(VECTORS.V5.blob), false),
    decision(EXECUTOR, txInput(VECTORS.V4.blob), false),
    decision(EXECUTOR, txInput(VECTORS.V5.blob), true),
    decision(EXECUTOR, txInput(VECTORS.V5.blob, { code: null }), false),
    decision(EXECUTOR, txInput(VECTORS.V1.blob), true),
    decision(EXECUTOR, executeCalldata({ rationaleHash: VECTORS.V1.hash }), false),
    decision(EXECUTOR, txInput(VECTORS.V4.blob), true, OTHER),
  ];
  const decisions = countDecisions({ vault: VAULT, owner: lower(OWNER), decisions: DECISIONS })!;
  const count = countBriefs(BRIEFS, LISTS);

  it("gives each Decision one label, first match wins, and counts what the vault allowed and refused on each line", () => {
    expect(decisions.tally).toEqual({
      "owner, by hand": { allowed: 0, refused: 1 },
      probe: { allowed: 0, refused: 1 },
      "brief-driven": { allowed: 1, refused: 1 },
      agent: { allowed: 2, refused: 1 },
    });
    expect(decisions.rows.map((r) => [r.label, r.briefs])).toEqual([
      ["owner, by hand", []],
      ["probe", []],
      ["brief-driven", [7]],
      ["brief-driven", [7]],
      ["agent", []],
      ["agent", []],
      ["agent", []],
    ]);
  });

  it("puts the Decision lines where the rule's table puts them, and keeps their number when the brief lines have none", () => {
    for (const state of ["counted", "incomplete", "not-deployed"] as const) {
      const lines = proofLines(count, null, decisions);
      expect(lines.map((l) => `${l.label}: ${lineText(l, state)}`)).toEqual([
        "Owner by hand Decisions: 1 (0 allowed, 1 refused)",
        "Agent Decisions: 3 (2 allowed, 1 refused)",
        "Probe Decisions: 1 (0 allowed, 1 refused)",
        `Outside briefs: ${state === "counted" ? "4" : state === "incomplete" ? "incomplete" : "not deployed"}`,
        `Outside wallets: ${state === "counted" ? "3" : state === "incomplete" ? "incomplete" : "not deployed"}`,
        `Outside wallets with a Verified Account: ${state === "counted" ? "not read" : state === "incomplete" ? "incomplete" : "not deployed"}`,
        "Brief-driven Decisions: 2 (1 allowed, 1 refused)",
        `Team briefs: ${state === "counted" ? "3" : state === "incomplete" ? "incomplete" : "not deployed"}`,
        `Hidden briefs: ${state === "counted" ? "1" : state === "incomplete" ? "incomplete" : "not deployed"}`,
        "Bounty claimants: 2",
      ]);
    }
  });

  it("lists every Decision after the lines, with its log, its label in the rule's words and the briefs it cites", () => {
    const lines = reportLines(countBriefs([], { ...LISTS, bounty: [] }), new Map(), "counted", undefined, decisions);
    expect(lines.slice(10)).toEqual([
      `Decision 0x${"1".padStart(64, "0")} log 1 in block 62,000,001: owner by hand, vault refused`,
      `Decision 0x${"2".padStart(64, "0")} log 2 in block 62,000,002: probe, vault refused`,
      `Decision 0x${"3".padStart(64, "0")} log 3 in block 62,000,003: brief-driven citing #7, vault allowed`,
      `Decision 0x${"4".padStart(64, "0")} log 4 in block 62,000,004: brief-driven citing #7, vault refused`,
      `Decision 0x${"5".padStart(64, "0")} log 5 in block 62,000,005: agent, vault allowed`,
      `Decision 0x${"6".padStart(64, "0")} log 6 in block 62,000,006: agent, vault refused`,
      `Decision 0x${"7".padStart(64, "0")} log 7 in block 62,000,007: agent, vault allowed`,
    ]);
  });

  it("counts no Decision when no vault's logs were read, and zero on every line when the vault has none", () => {
    expect(countDecisions({ vault: null, owner: null, decisions: [] })).toBeNull();
    const none = countDecisions({ vault: VAULT, owner: lower(OWNER), decisions: [] })!;
    expect(proofLines(emptyCount(), new Map(), none).filter((l) => l.split).map((l) => lineText(l, "counted"))).toEqual([
      "0 (0 allowed, 0 refused)",
      "0 (0 allowed, 0 refused)",
      "0 (0 allowed, 0 refused)",
      "0 (0 allowed, 0 refused)",
    ]);
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
