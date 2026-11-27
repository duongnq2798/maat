import type { Address, Hex } from "viem";
import { senderLabel, type SenderLabel } from "@/lib/chain/ledger";
import { decodeExecuteInput, type DecodedBlob } from "@/lib/chain/rationale";
import { teamLines, type TeamTrace } from "./team";

// The lines of the /proof counting rule (inbox spec §5): the brief lines, from Brief logs, the traced team set
// (team.ts) and the committed lists; and the Decision lines, from the vault's Decision logs the trace reads, each
// labelled as /ledger labels a Decision (lib/chain/ledger.ts senderLabel, on the blob lib/chain/rationale.ts decodes).
// scripts/recount.mjs counts the same way in plain JavaScript and runs team.ts itself; test/proof-recount.test.ts runs
// the page and the script on one fixture.

/** The two fields of a Brief log the rule reads. */
export interface CountedBrief {
  id: number;
  from: string;
}

/** What countBriefs splits the briefs by. `team` is the whole team set: the trace's members, or a fixture. */
export interface CountLists {
  team: readonly { address: string }[];
  /** content/ask-hidden.ts: ids the owner hid from the /ask feed. */
  hidden: readonly number[];
  /** content/proof-bounty.ts. */
  bounty: readonly { address: string; evidence: string }[];
}

/** The five committed lists the page and the recount read. */
export interface ProofLists extends CountLists {
  /** content/proof-team.ts, where the team trace starts. */
  team: readonly { address: string; role: string }[];
  /** content/proof-sends.ts. */
  sends: readonly { wallet: string; txs: readonly string[] }[];
  /** content/proof-stops.ts. */
  stops: readonly { address: string; name: string; source: string }[];
}

/**
 * How the brief lines stand: counted from a complete read; incomplete, when a log chunk or the team trace fell short,
 * so no brief line has a number; or not deployed, before deployments/README.md records the inbox.
 */
export type LinesState = "counted" | "incomplete" | "not-deployed";

/** What a brief line says in place of a number, by state. */
export const STATE_TEXT: Record<Exclude<LinesState, "counted">, string> = { incomplete: "incomplete", "not-deployed": "not deployed" };

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
export function countBriefs(briefs: readonly CountedBrief[], lists: CountLists): ProofCount {
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

/** How many Decisions of one label the vault allowed, and how many it refused. */
export interface Tally {
  allowed: number;
  refused: number;
}

/** One Decision log of the vault and the line it counts on. */
export interface DecisionRow {
  txHash: string;
  logIndex: number;
  block: bigint;
  label: SenderLabel;
  allowed: boolean;
  /** The brief ids its blob cites in `q`, for a brief-driven Decision; empty for any other. */
  briefs: number[];
}

export interface DecisionCount {
  tally: Record<SenderLabel, Tally>;
  /** In block and log order. */
  rows: DecisionRow[];
}

/**
 * The Decision lines of the rule, from the vault's Decision logs the trace read: one label per Decision, first match
 * wins (owner by hand, probe, brief-driven, agent), by /ledger's senderLabel. The blob is read only from a transaction
 * sent to the vault, as the maat:v1 spec's decoder reads it (§1): any other carries no blob. Null when the trace read
 * no vault, so no Decision could be counted.
 */
export function countDecisions(trace: Pick<TeamTrace, "vault" | "owner" | "decisions">): DecisionCount | null {
  if (trace.vault === null || trace.owner === null) return null;
  const tally: Record<SenderLabel, Tally> = {
    "owner, by hand": { allowed: 0, refused: 0 },
    agent: { allowed: 0, refused: 0 },
    probe: { allowed: 0, refused: 0 },
    "brief-driven": { allowed: 0, refused: 0 },
  };
  const rows = trace.decisions.map((d): DecisionRow => {
    const call = d.to === trace.vault ? decodeExecuteInput(d.input as Hex) : null;
    const blob: DecodedBlob = call?.blob ?? { status: "none" };
    const label = senderLabel(d.from as Address, trace.owner as Address, blob);
    tally[label][d.allowed ? "allowed" : "refused"] += 1;
    const briefs = label === "brief-driven" && blob.status === "v1" ? [...(blob.fields.q ?? [])] : [];
    return { txHash: d.txHash, logIndex: d.logIndex, block: d.block, label, allowed: d.allowed, briefs };
  });
  return { tally, rows };
}

export type LineKey =
  | "owner-decisions"
  | "agent-decisions"
  | "probe-decisions"
  | "outside-briefs"
  | "outside-wallets"
  | "verified"
  | "brief-decisions"
  | "team-briefs"
  | "hidden-briefs"
  | "bounty-claimants";

export interface ProofLine {
  key: LineKey;
  label: string;
  /** Null while it has not been read. */
  value: number | null;
  /**
   * True for a line counted from Brief logs. The Decision lines come from the vault's Decision logs and the bounty line
   * from its committed list, so they keep their number while a brief line has none.
   */
  brief: boolean;
  /** A Decision line's Decisions the vault allowed and refused, once read; null for every other line. */
  split: Tally | null;
}

const decisionLine = (key: LineKey, label: string, t: Tally | undefined): ProofLine => ({
  key,
  label,
  value: t ? t.allowed + t.refused : null,
  brief: false,
  split: t ?? null,
});

/**
 * The lines of the rule that the page and the recount give, in the order the rule's table lists them. `verified` is
 * null until it is read, and `decisions` until the vault's Decision logs are.
 */
export function proofLines(count: ProofCount, verified: VerifiedColumn | null, decisions: DecisionCount | null = null): ProofLine[] {
  const holders = verified ? count.outsideWallets.filter((w) => verified.get(w.address)).length : null;
  const t = decisions?.tally;
  return [
    decisionLine("owner-decisions", "Owner by hand Decisions", t?.["owner, by hand"]),
    decisionLine("agent-decisions", "Agent Decisions", t?.agent),
    decisionLine("probe-decisions", "Probe Decisions", t?.probe),
    { key: "outside-briefs", label: "Outside briefs", value: count.outsideBriefs, brief: true, split: null },
    { key: "outside-wallets", label: "Outside wallets", value: count.outsideWallets.length, brief: true, split: null },
    { key: "verified", label: "Outside wallets with a Verified Account", value: holders, brief: true, split: null },
    decisionLine("brief-decisions", "Brief-driven Decisions", t?.["brief-driven"]),
    { key: "team-briefs", label: "Team briefs", value: count.teamBriefs, brief: true, split: null },
    { key: "hidden-briefs", label: "Hidden briefs", value: count.hidden.length, brief: true, split: null },
    { key: "bounty-claimants", label: "Bounty claimants", value: count.bounty.length, brief: false, split: null },
  ];
}

export const formatCount = (n: number) => n.toLocaleString("en-US");
const briefsText = (n: number) => `${formatCount(n)} ${n === 1 ? "brief" : "briefs"}`;

/** A Decision line's split: "2 allowed, 1 refused". */
export const splitText = (t: Tally) => `${formatCount(t.allowed)} allowed, ${formatCount(t.refused)} refused`;

/** Each label in the rule's words, as a Decision's row in the report gives it. */
const ROW_LABEL: Record<SenderLabel, string> = { "owner, by hand": "owner by hand", agent: "agent", probe: "probe", "brief-driven": "brief-driven" };

/** One Decision as the report lists it: its log, its label and, for a brief-driven one, the briefs it cites. */
export function decisionRowText(r: DecisionRow): string {
  const cites = r.briefs.length > 0 ? ` citing ${r.briefs.map((id) => `#${id}`).join(", ")}` : "";
  return `Decision ${r.txHash} log ${r.logIndex} in block ${r.block.toLocaleString("en-US")}: ${ROW_LABEL[r.label]}${cites}, vault ${r.allowed ? "allowed" : "refused"}`;
}

/** What a wallet's Verified Account cell says: its UID, "none", or "not read". */
export function verifiedText(verified: VerifiedColumn | null, address: string): string {
  if (!verified || !verified.has(address)) return "not read";
  return verified.get(address) ?? "none";
}

/** A line's number, "not read", or the state's word for a brief line that has no number. */
export function valueText(l: ProofLine, state: LinesState): string {
  if (l.brief && state !== "counted") return STATE_TEXT[state];
  return l.value === null ? "not read" : formatCount(l.value);
}

/** What a line says: valueText, and a Decision line's split once read, as "3 (2 allowed, 1 refused)". */
export function lineText(l: ProofLine, state: LinesState): string {
  const v = valueText(l, state);
  return l.split ? `${v} (${splitText(l.split)})` : v;
}

/**
 * The report as text, one line each: the ten lines, then every Decision with its label; when counted, every outside
 * wallet with its Verified Account, every team wallet and every hidden brief; every bounty claimant; and the traced team
 * set, when there is one. scripts/recount.mjs prints exactly these lines.
 */
export function reportLines(
  count: ProofCount,
  verified: VerifiedColumn | null,
  state: LinesState = "counted",
  team?: TeamTrace,
  decisions: DecisionCount | null = null,
): string[] {
  const counted = state === "counted";
  return [
    ...proofLines(count, verified, decisions).map((l) => `${l.label}: ${lineText(l, state)}`),
    ...(decisions?.rows ?? []).map(decisionRowText),
    ...(counted ? count.outsideWallets : []).map((w) => {
      const uid = verifiedText(verified, w.address);
      const va = uid === "none" ? "no Verified Account" : uid === "not read" ? "Verified Account not read" : `Verified Account ${uid}`;
      return `Outside wallet ${w.address}: ${briefsText(w.briefs)}, ${va}`;
    }),
    ...(counted ? count.teamWallets : []).map((w) => `Team wallet ${w.address}: ${briefsText(w.briefs)}`),
    ...(counted ? count.hidden : []).map((h) => `Hidden brief #${h.id} from ${h.from}`),
    ...count.bounty.map((c) => `Bounty claimant ${c.address}: ${c.evidence}`),
    ...(team ? teamLines(team) : []),
  ];
}
