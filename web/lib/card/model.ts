import { decodeFunctionData, getAddress, type Address, type Hash, type Hex } from "viem";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { holidayName, isoOfDay, localTime, regularSession, sessionWindow } from "@/content/calendar";
import type { ActionName } from "@/content/decisions";
import { CHECK_LABELS, type CheckMark } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { clockLabel, dayLabel, formatInt } from "@/content/format";
import { reasonText, type ReasonCode, type RefusalCode } from "@/content/reasons";
import { vaultAbi } from "@/lib/chain/abi";
import { decodeVaultLogs, type DecisionEvent } from "@/lib/chain/events";
import { decisionTrails, formatUsd6, toMainnetDecisions, type DecisionTrail, type MainnetDecision, type TxInput } from "@/lib/chain/ledger";
import { plainBriefText } from "@/lib/chain/inbox";
import { shortAddress } from "@/lib/chain/tokens";
import { SITE } from "@/lib/site";

// The Weighing card (npm run card): one vault Decision as an image, read the way /ledger reads it. Everything here is
// pure: lib/card/read.ts reads the chain or a fixture file into a CardRead, and brand/card.tsx draws the CardModel.

/** Where a card's Decision comes from. Only "mainnet" is read from Base; the others are printed with a band. */
export const CARD_KINDS = ["mainnet", "fork", "simulated", "preview"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** The band printed across a card whose Decision is not a Base mainnet one. */
export const BAND_TEXT: Readonly<Record<Exclude<CardKind, "mainnet">, string>> = {
  fork: "FORK REPLAY",
  simulated: "SIMULATED",
  preview: "PREVIEW, NOT A DECISION",
};

/** The short footer the post voice requires on any image that shows a stock token or a trade. Every card carries it. */
export const FOOTER = "Own treasury only. Not offered to US persons.";
/** The sign-off every card carries. */
export const SIGN_OFF = SITE.tagline;

/** topic0 of ERC-20 Transfer(address,address,uint256): the USDC leg of a paid bill. */
export const TRANSFER_TOPIC: Hex = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * The one check of the nine (CHECK_LABELS, in the order MandateVault._check and GuardLib.checkMarket run them for a
 * BUY) that returns each code, for the codes only one of them returns. BAD_PRICE is returned at check 5 (the feed) and at
 * check 7 (the pool), INSUFFICIENT_BALANCE between checks 7 and 8, VAULT_PAUSED before check 1, and SWAP_FAILED and
 * TRANSFER_FAILED after all nine, so none of them places a weighing on one check. OK places none either: the Balance
 * lights a tick only where the code says which check stopped the run.
 */
export const TICK_CHECK: Readonly<Partial<Record<RefusalCode, number>>> = {
  TOKEN_NOT_ALLOWED: 0,
  TOKEN_PAUSED: 1,
  POLICY_BLOCKED: 2,
  MARKET_CLOSED: 3,
  FEED_STALE: 4,
  MULTIPLIER_COOLDOWN: 5,
  PREMIUM_TOO_HIGH: 6,
  SIZE_LIMIT: 7,
  CONCENTRATION: 8,
};

/** The actions that run the nine checks: _check sends PAY_EXPENSE to _checkExpense and credit to _checkCredit. */
const WEIGHED: ReadonlySet<ActionName> = new Set(["BUY", "SELL"]);

/**
 * The Balance's nine ticks: lit only when the code maps to exactly one of the nine checks, otherwise none. When it
 * does, the checks before it passed (the vault runs them in order), it failed, and those after it were not reached.
 */
export function balanceTicks(action: ActionName, reason: ReasonCode): CheckMark[] {
  const at = reason === "OK" || !WEIGHED.has(action) ? undefined : TICK_CHECK[reason];
  return CHECK_LABELS.map((_, i): CheckMark => (at === undefined || i > at ? "SKIP" : i < at ? "PASS" : "FAIL"));
}

/** A log's place in the chain. */
export interface ChainPosition {
  blockNumber: bigint;
  logIndex: number;
}

const before = (a: ChainPosition, b: ChainPosition) => a.blockNumber < b.blockNumber || (a.blockNumber === b.blockNumber && a.logIndex < b.logIndex);

/**
 * "Weighing № N": the Decision's place, from 1, among the vault's Decision logs in chain order (block, then log index).
 * `logs` must be every Decision log of the vault from its deploy block through the Decision's block; throws when the
 * Decision is not among them, so a number is never guessed.
 */
export function ordinalOf(logs: readonly ChainPosition[], target: ChainPosition): number {
  const same = logs.filter((l) => l.blockNumber === target.blockNumber && l.logIndex === target.logIndex);
  if (same.length !== 1) {
    throw new Error(`the Decision at block ${target.blockNumber} log ${target.logIndex} is ${same.length === 0 ? "not among" : "repeated in"} the vault's Decision logs`);
  }
  return logs.filter((l) => before(l, target)).length + 1;
}

/** "Fri 27 Nov · early close 13:00 ET": the New York day of `ts` and its NYSE session, from the repo's calendar port. */
export function dateLine(ts: number): string {
  const { etDay } = localTime(ts);
  const day = dayLabel(isoOfDay(etDay));
  const holiday = holidayName(etDay);
  if (holiday !== undefined) return `${day} · ${holiday}, NYSE closed`;
  const w = sessionWindow(etDay);
  if (w === undefined) return `${day} · weekend, NYSE closed`;
  if (w.closeMin < FACTS.nyseSessionMin.value.close) return `${day} · early close ${clockLabel(w.closeMin)} ET`;
  return `${day} · NYSE open ${clockLabel(w.openMin)}-${clockLabel(w.closeMin)} ET`;
}

/** "09:28 ET · before the 09:30 open": the block's New York time and where it falls in that day's session. */
export function timeLine(ts: number): string {
  const at = `${clockLabel(localTime(ts).minuteOfDay)} ET`;
  const s = regularSession(ts);
  if (s.open) return `${at} · NYSE open`;
  switch (s.why) {
    case "before-open":
      return `${at} · before the ${clockLabel(s.openMin)} open`;
    case "after-close":
      return `${at} · after the ${clockLabel(s.closeMin)} close`;
    case "weekend":
    case "holiday":
      return `${at} · NYSE closed`;
  }
}

/** The note the agent's blob adds to the end of a MARKET_CLOSED log's text (agent/src/rationale/blob.ts closedSuffix). */
const CLOSED_NOTE = / \(market closed, [^()]*\)$/;
/** A sentence in which the agent says it expects, or asks for, a refusal (agent/src/llm/prompt.ts: "say so in the rationale"). */
const DISCLOSURE = /\b(?:refus|reject)/i;
/** The fewest characters of a first sentence worth printing once it has to be cut. */
const MIN_CUT = 24;

/**
 * `text` cut on a space to at most `max` characters, with "…" when it was cut. A brief or a reply is printed this way:
 * a sender's text is never stretched past its room for a word in it.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(0, max - 1));
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** The start of the first word at or after `at` in `s`, or `s.length` when there is none. */
function wordStart(s: string, at: number): number {
  if (at <= 0) return 0;
  const space = s.indexOf(" ", at - 1);
  return space === -1 ? s.length : space + 1;
}

/**
 * `s`, a sentence in which the agent discloses an expected refusal, cut to at most `room` characters so that its
 * refusal word stays in: from the start when the word is near it, else the end of the sentence, else a window that
 * ends on that word. A cut side shows "…".
 */
function cutDisclosure(s: string, room: number): string {
  const head = clip(s, room);
  const m = DISCLOSURE.exec(s);
  if (!m) return head;
  const wordEnd = s.indexOf(" ", m.index) === -1 ? s.length : s.indexOf(" ", m.index);
  if (wordEnd <= head.length - 1) return head;
  const tail = wordStart(s, s.length - (room - 1));
  if (tail <= m.index) return `…${s.slice(tail)}`;
  // The window ends on the refusal word and the space after it, so the cut after that space keeps the word whole.
  return `…${clip(s.slice(wordStart(s, Math.max(0, wordEnd - (room - 3)))), room - 1)}`;
}

/**
 * The part of a rationale a card prints: at most `budget` characters. First the sentences in which the agent says it
 * expects a refusal, whole and in order while they fit; when the first of them does not fit alone, it is cut around its
 * refusal word. Then the closed-market note the agent's code appends, and the first sentence (cut on a space when only
 * part of it fits) and the sentences after it, in order, up to the first that does not fit. Left-out text shows as "…".
 */
export function excerpt(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const note = CLOSED_NOTE.exec(text)?.[0] ?? "";
  const body = note === "" ? text : text.slice(0, -note.length);
  const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => s !== "");
  const assemble = (parts: ReadonlyMap<number, string>): string => {
    let out = "";
    let last = -1;
    for (const [i, s] of [...parts].sort(([a], [b]) => a - b)) {
      // A cut part already shows "…" on its cut side; a left-out sentence between parts adds one.
      const gap = i !== last + 1 && !out.endsWith("…") && !s.startsWith("…");
      out = last === -1 ? (gap ? `… ${s}` : s) : `${out}${gap ? " … " : " "}${s}`;
      last = i;
    }
    if (last < sentences.length - 1 && !out.endsWith("…")) out += out === "" ? "…" : " …";
    return out + note;
  };
  const parts = new Map<number, string>();
  const fits = (i: number, s: string) => assemble(new Map(parts).set(i, s)).length <= budget;
  for (const [i, s] of sentences.entries()) {
    if (!DISCLOSURE.test(s)) continue;
    if (fits(i, s)) parts.set(i, s);
    else if (parts.size === 0) parts.set(i, cutDisclosure(s, budget - (assemble(new Map([[i, s]])).length - s.length)));
  }
  const first = sentences[0] ?? "";
  if (!parts.has(0)) {
    if (fits(0, first)) parts.set(0, first);
    else {
      const room = budget - (assemble(new Map(parts).set(0, first)).length - first.length);
      if (room >= MIN_CUT || parts.size === 0) parts.set(0, clip(first, room));
    }
  }
  if (parts.get(0) === first) {
    for (let i = 1; i < sentences.length; i++) {
      if (parts.has(i)) continue;
      if (!fits(i, sentences[i]!)) break;
      parts.set(i, sentences[i]!);
    }
  }
  const out = assemble(parts);
  return out.length <= budget ? out : clip(out, budget);
}

/** What a card says about the Decision's rationale (spec maat:v1 §1 and §4, as /ledger checks it). */
export type RationaleView =
  /** keccak256 of the maat:v1 blob in the calldata is the Decision's rationaleHash. */
  | { state: "verified"; status: "hash verified"; text: string; by: string }
  | { state: "mismatch" | "none" | "undecoded" | "not-read"; status: string };

/** The senders whose Decision is Maat's agent's own: an operator Decision, or one whose sender is unknown, never is. */
const AGENT_SENT: ReadonlySet<string> = new Set(["agent", "brief-driven"]);

function rationaleView(trail: DecisionTrail): RationaleView {
  const call = trail.call;
  if (call === null) return { state: "not-read", status: "not a direct execute call: no rationale read" };
  const blob = call.blob;
  if (blob.status === "none") return { state: "none", status: "no rationale in this tx" };
  if (trail.blobHashOk !== true) return { state: "mismatch", status: "hash mismatch: text not shown" };
  if (blob.status === "v1") {
    const f = blob.fields;
    const model = f.m ?? "not named";
    const by =
      f.k === "probe"
        ? "probe text, not a Claude proposal"
        : f.k === "bill"
          ? "bill text, written by the agent's code"
          : trail.label !== null && AGENT_SENT.has(trail.label)
            ? `Maat's agent · ${f.m ?? "model not named"}`
            : `model ${model}`;
    return { state: "verified", status: "hash verified", text: f.t, by };
  }
  return {
    state: "undecoded",
    status: blob.status === "invalid" ? `blob not decoded: ${blob.problem}` : `${formatInt(blob.bytes)} bytes that are not a maat:v1 blob`,
  };
}

/** One MaatInbox brief a brief-driven Decision adopts, and what is known of its text and of the agent's reply. */
export interface BriefRead {
  id: number;
  /** The brief as the inbox emitted it, or null when it was not read (no inbox deployed, or not found). */
  text: string | null;
  from: Address | null;
  /** The agent's reply from the journal, or null when there is none to read. */
  reply: string | null;
}

export interface BriefView {
  id: number;
  head: string;
  text: string;
  reply: string;
  /** False when the text is the "not available" line. */
  hasText: boolean;
  hasReply: boolean;
}

export const NO_BRIEF_TEXT = "brief text not available";
export const NO_REPLY = "reply not available";
/** What a card prints for a brief on the owner's /ask hide-list (content/ask-hidden.ts), and for the reply to it. */
export const HIDDEN_BRIEF_TEXT = "brief text hidden by the owner, as on /ask";
export const HIDDEN_REPLY = "reply hidden with its brief";

/** Everything a card is drawn from: one transaction, read from Base or from a fixture file. */
export interface CardRead {
  kind: CardKind;
  vault: Address;
  /** MandateVault.owner(), or null when it was not read: the sender is then "sender unknown", as on /ledger. */
  owner: Address | null;
  usdc: Address;
  txHash: Hash;
  blockNumber: bigint;
  /** Unix seconds of the block. */
  timestamp: number;
  /** The receipt's logs. */
  logs: readonly { address: string; topics: readonly Hex[]; data: Hex; logIndex: number }[];
  tx: TxInput;
  /** The Decision's place among the vault's Decisions, for a mainnet read; null otherwise. */
  ordinal: number | null;
  /** Lowercased token address to decimals, for a SELL or a credit action's units. */
  decimals: Readonly<Record<string, number>>;
  /** The briefs the blob adopts, by id, as far as they were read. */
  briefs: readonly BriefRead[];
}

export type Plate = "refused" | "allowed" | "bill";

export interface CardModel {
  kind: CardKind;
  /** The band across the image, or null for a mainnet Decision. */
  band: string | null;
  /** "Weighing № 1", or "Weighing · not numbered" for anything that is not a mainnet Decision. */
  title: string;
  dateLine: string;
  timeLine: string;
  plate: Plate;
  /** The headline on the plate: the reason code for a refusal, "Allowed", or the bill's name and outcome. */
  headline: string;
  /** "Refused · Market closed (MARKET_CLOSED)". */
  verdict: string;
  allowed: boolean;
  reason: ReasonCode;
  /** The Balance: tipped for a refusal, level otherwise, and its nine ticks. */
  balance: { verdict: "allowed" | "refused"; ticks: CheckMark[] };
  /** "BUY · NVDAc · $5.00", as /ledger's timeline writes the intent. */
  intent: string;
  /** For a PAY_EXPENSE Decision: "Compute bill paid · $1.00 · to the owner's allowlisted address". */
  bill: { line: string; payee: string | null } | null;
  /** The sender label exactly as /ledger's chip prints it. */
  sender: string;
  rationale: RationaleView;
  /** Short rationaleHash, as the Decision logged it. */
  rationaleHash: string;
  briefs: BriefView[];
  block: string;
  tx: string;
  footer: string;
  signOff: string;
  /** File name stem: "weighing-1-dfdb6739", "fork-replay-dfdb6739". */
  stem: string;
}

/** "0xdfdb6739…6c3b", as /ledger shortens hashes. */
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const topicAddress = (t: Hex | undefined) => (t === undefined ? null : getAddress(`0x${t.slice(-40)}`));

/** The payee of a PAY_EXPENSE: the USDC Transfer out of the vault in the receipt, else the intent's payee in the calldata. */
function payeeOf(read: CardRead, d: DecisionEvent): Address | null {
  const out = read.logs.find((l) => same(l.address, read.usdc) && same(l.topics[0] ?? "0x", TRANSFER_TOPIC) && same(topicAddress(l.topics[1]) ?? "0x", read.vault) && BigInt(l.data) === d.amount);
  if (out) return topicAddress(out.topics[2]);
  if (read.tx.to === null || !same(read.tx.to, read.vault)) return null;
  try {
    const { args } = decodeFunctionData({ abi: vaultAbi, data: read.tx.input.slice(0, 2 + 228 * 2) as Hex });
    const intent = args?.[0] as { payee?: Address } | undefined;
    return intent?.payee ? getAddress(intent.payee) : null;
  } catch {
    return null;
  }
}

function billOf(read: CardRead, d: MainnetDecision, event: DecisionEvent, rationale: RationaleView, trail: DecisionTrail): CardModel["bill"] {
  if (d.action !== "PAY_EXPENSE") return null;
  const blob = trail.call?.blob;
  const isBill = rationale.state === "verified" && blob?.status === "v1" && blob.fields.k === "bill";
  const name = isBill ? "Compute bill" : "Expense";
  const payee = payeeOf(read, event);
  const amount = formatUsd6(d.amount);
  if (!d.allowed) return { line: `${name} not paid · ${amount}`, payee: payee ? shortAddress(payee) : null };
  const to = payee === null ? "payee not read" : read.owner !== null && same(payee, read.owner) ? "to the owner's allowlisted address" : `to the allowlisted address ${shortAddress(payee)}`;
  return { line: `${name} paid · ${amount} · ${to}`, payee: payee ? shortAddress(payee) : null };
}

/**
 * The briefs a Decision adopts, as /ledger's Briefs lists them: only from a blob whose keccak256 is the Decision's
 * rationaleHash. A brief on the owner's /ask hide-list keeps its id and sender, as /proof lists it, but neither its text
 * nor the reply to it is printed.
 */
function briefViews(trail: DecisionTrail, reads: readonly BriefRead[], hidden: readonly number[]): BriefView[] {
  const blob = trail.call?.blob;
  if (trail.blobHashOk !== true || blob?.status !== "v1" || blob.fields.q === undefined) return [];
  return blob.fields.q.map((id) => {
    const r = reads.find((b) => b.id === id);
    const head = r?.from ? `Brief #${id} · from ${shortAddress(r.from)}` : `Brief #${id}`;
    if (hidden.includes(id)) return { id, head, text: HIDDEN_BRIEF_TEXT, reply: HIDDEN_REPLY, hasText: false, hasReply: false };
    const text = r?.text ?? null;
    const reply = r?.reply ?? null;
    return {
      id,
      head,
      text: text === null ? NO_BRIEF_TEXT : plainBriefText(text),
      reply: reply === null ? NO_REPLY : plainBriefText(reply),
      hasText: text !== null,
      hasReply: reply !== null,
    };
  });
}

/**
 * The card for the one Decision the vault logged in `read`'s transaction. Throws when there is not exactly one.
 * `hidden` is the owner's /ask hide-list.
 */
export function cardModel(read: CardRead, hidden: readonly number[] = HIDDEN_BRIEFS): CardModel {
  const events = decodeVaultLogs(
    read.logs
      .filter((l) => same(l.address, read.vault))
      .map((l) => ({ blockNumber: read.blockNumber.toString(), logIndex: l.logIndex, transactionHash: read.txHash, topics: [...l.topics], data: l.data })),
  ).filter((e): e is DecisionEvent => e.name === "Decision");
  if (events.length !== 1) throw new Error(`${read.txHash} holds ${events.length} Decision logs of the vault ${read.vault}; a card shows exactly one`);
  const event = events[0]!;
  if (read.kind === "mainnet" && read.ordinal === null) throw new Error("a mainnet card needs the Decision's ordinal");
  if (read.kind !== "mainnet" && read.ordinal !== null) throw new Error(`a ${read.kind} card is not numbered: only mainnet Decisions are`);

  const [d] = toMainnetDecisions([event], { blockTimes: { [read.blockNumber.toString()]: read.timestamp }, gasUsed: {}, decimals: read.decimals, usdc: read.usdc });
  const trail = decisionTrails([d!], new Map([[read.txHash.toLowerCase(), read.tx]]), { vault: read.vault, owner: read.owner, complete: false }).get(d!.key);
  if (!d || !trail) throw new Error(`the Decision in ${read.txHash} could not be read`);

  const rationale = rationaleView(trail);
  const bill = billOf(read, d, event, rationale, trail);
  const plate: Plate = bill ? "bill" : d.allowed ? "allowed" : "refused";
  const word = d.allowed ? "Allowed" : "Refused";
  const headline = bill ? bill.line.split(" · ")[0]! : d.allowed ? "Allowed" : d.reason;
  const short = read.txHash.slice(2, 10).toLowerCase();
  return {
    kind: read.kind,
    band: read.kind === "mainnet" ? null : BAND_TEXT[read.kind],
    title: read.ordinal === null ? "Weighing · not numbered" : `Weighing № ${read.ordinal}`,
    dateLine: dateLine(read.timestamp),
    timeLine: timeLine(read.timestamp),
    plate,
    headline,
    verdict: `${word} · ${reasonText(d.reason)}`,
    allowed: d.allowed,
    reason: d.reason,
    balance: { verdict: d.allowed ? "allowed" : "refused", ticks: balanceTicks(d.action, d.reason) },
    intent: `${d.action} · ${d.symbol} · ${d.amountLabel}`,
    bill,
    sender: trail.label ?? (trail.call ? "sender unknown" : "sender not labeled"),
    rationale,
    rationaleHash: shortHash(d.rationaleHash),
    briefs: briefViews(trail, read.briefs, hidden),
    block: `block ${formatInt(Number(read.blockNumber))}`,
    tx: `tx ${shortHash(read.txHash)}`,
    footer: FOOTER,
    signOff: SIGN_OFF,
    stem: read.ordinal === null ? `${BAND_TEXT[read.kind as Exclude<CardKind, "mainnet">].toLowerCase().replace(/[^a-z]+/g, "-").replace(/-+$/, "")}-${short}` : `weighing-${read.ordinal}-${short}`,
  };
}
