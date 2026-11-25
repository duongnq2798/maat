import type { Hex } from "viem";

// The brief lines of the /proof counting rule (inbox spec §5), from Brief logs and the three committed lists.
// scripts/recount.mjs counts the same way in plain JavaScript; test/proof-recount.test.ts runs both on one fixture.

/** The two fields of a Brief log the rule reads. */
export interface CountedBrief {
  id: number;
  from: string;
}

export interface ProofLists {
  /** content/proof-team.ts. */
  team: readonly { address: string }[];
  /** content/ask-hidden.ts: ids the owner hid from the /ask feed. */
  hidden: readonly number[];
  /** content/proof-bounty.ts. */
  bounty: readonly { address: string; evidence: string }[];
}

/** One sender: its lowercased address and how many of its briefs were read. */
export interface WalletLine {
  address: string;
  briefs: number;
}

export interface ProofCount {
  outsideBriefs: number;
  /** In the order of each wallet's first brief. */
  outsideWallets: WalletLine[];
  teamBriefs: number;
  teamWallets: WalletLine[];
  /** Outside briefs on the hide-list, by id. They are still in outsideBriefs. */
  hidden: { id: number; from: string }[];
  /** Once per lowercased address, in the list's order. */
  bounty: { address: string; evidence: string }[];
}

/** Lowercased wallet → the UID of its counting Verified Account attestation, or null for none. */
export type VerifiedColumn = ReadonlyMap<string, Hex | null>;

const FULL_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function addresses(list: readonly { address: string }[], name: string): string[] {
  return list.map(({ address }) => {
    if (!FULL_ADDRESS.test(address)) throw new Error(`the ${name} list has "${address}", not 0x and 40 hex digits`);
    return address.toLowerCase();
  });
}

function wallets(briefs: readonly CountedBrief[]): WalletLine[] {
  const by = new Map<string, number>();
  for (const b of briefs) by.set(b.from, (by.get(b.from) ?? 0) + 1);
  return [...by.entries()].map(([address, n]) => ({ address, briefs: n }));
}

export function emptyCount(): ProofCount {
  return { outsideBriefs: 0, outsideWallets: [], teamBriefs: 0, teamWallets: [], hidden: [], bounty: [] };
}

/**
 * Splits `briefs` by the rule: a brief from a team wallet is a team brief and never an outside brief; every other brief
 * is an outside brief, hidden or not; a hidden brief is an outside brief whose id is on the hide-list, listed again on
 * its own line; bounty claimants come from their list alone. Briefs are taken in id order.
 */
export function countBriefs(briefs: readonly CountedBrief[], lists: ProofLists): ProofCount {
  const team = new Set(addresses(lists.team, "team"));
  const claimants = addresses(lists.bounty, "bounty");
  const hidden = new Set(lists.hidden);
  const sorted = [...briefs].map((b) => ({ id: b.id, from: b.from.toLowerCase() })).sort((a, b) => a.id - b.id);
  const outside = sorted.filter((b) => !team.has(b.from));
  const inside = sorted.filter((b) => team.has(b.from));
  const seen = new Set<string>();
  const bounty = lists.bounty.flatMap((c, i) => {
    const address = claimants[i]!;
    if (seen.has(address)) return [];
    seen.add(address);
    return [{ address, evidence: c.evidence }];
  });
  return {
    outsideBriefs: outside.length,
    outsideWallets: wallets(outside),
    teamBriefs: inside.length,
    teamWallets: wallets(inside),
    hidden: outside.filter((b) => hidden.has(b.id)),
    bounty,
  };
}

export type LineKey = "outside-briefs" | "outside-wallets" | "verified" | "team-briefs" | "hidden-briefs" | "bounty-claimants";

export interface ProofLine {
  key: LineKey;
  label: string;
  /** Null while it has not been read. */
  value: number | null;
}

/** The lines of the rule that the page and the recount give, in this order. `verified` is null until it is read. */
export function proofLines(count: ProofCount, verified: VerifiedColumn | null): ProofLine[] {
  const holders = verified ? count.outsideWallets.filter((w) => verified.get(w.address)).length : null;
  return [
    { key: "outside-briefs", label: "Outside briefs", value: count.outsideBriefs },
    { key: "outside-wallets", label: "Outside wallets", value: count.outsideWallets.length },
    { key: "verified", label: "Outside wallets with a Verified Account", value: holders },
    { key: "team-briefs", label: "Team briefs", value: count.teamBriefs },
    { key: "hidden-briefs", label: "Hidden briefs", value: count.hidden.length },
    { key: "bounty-claimants", label: "Bounty claimants", value: count.bounty.length },
  ];
}

export const formatCount = (n: number) => n.toLocaleString("en-US");
const briefsText = (n: number) => `${formatCount(n)} ${n === 1 ? "brief" : "briefs"}`;

/** What a wallet's Verified Account cell says: its UID, "none", or "not read". */
export function verifiedText(verified: VerifiedColumn | null, address: string): string {
  if (!verified || !verified.has(address)) return "not read";
  return verified.get(address) ?? "none";
}

/**
 * The report as text, one line each: the six lines, then every outside wallet with its Verified Account, every team
 * wallet, every hidden brief and every bounty claimant. scripts/recount.mjs prints exactly these lines.
 */
export function reportLines(count: ProofCount, verified: VerifiedColumn | null): string[] {
  return [
    ...proofLines(count, verified).map((l) => `${l.label}: ${l.value === null ? "not read" : formatCount(l.value)}`),
    ...count.outsideWallets.map((w) => {
      const uid = verifiedText(verified, w.address);
      const va = uid === "none" ? "no Verified Account" : uid === "not read" ? "Verified Account not read" : `Verified Account ${uid}`;
      return `Outside wallet ${w.address}: ${briefsText(w.briefs)}, ${va}`;
    }),
    ...count.teamWallets.map((w) => `Team wallet ${w.address}: ${briefsText(w.briefs)}`),
    ...count.hidden.map((h) => `Hidden brief #${h.id} from ${h.from}`),
    ...count.bounty.map((c) => `Bounty claimant ${c.address}: ${c.evidence}`),
  ];
}
