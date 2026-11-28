import { localTime, regularSession, type Session, sessionWindow } from "./calendar";
import { FACTS } from "./facts";
import { clockLabel } from "./format";
import type { ReasonCode } from "./reasons";

/**
 * The landing's "On the record" block (spec 2026-11-28, landing "a calmer first screen", section 2): three real
 * Decisions of the mainnet vault, each one a moment a visitor picks to read what the vault answered. Nothing in it is
 * simulated, and nothing in it is a reading of Base. test/on-the-record.test.tsx holds each field to a source:
 * - tx, block, intent, amount, verdict and reason to the moment's Decision log in the committed snapshot
 *   (content/generated/decisions-snapshot.json), read with the site's own decoder;
 * - `ts` to the README's table of Decisions (block time to the second) and isOpen proof; it is the block's timestamp,
 *   read with eth_getBlockByNumber from mainnet.base.org on 2026-11-28, and the first is FACTS.mainnetDecisions' too;
 * - `sender`, `quote` and the holiday story's figures to the transaction's calldata (test/fixtures/record-inputs.json,
 *   copied from Base), whose maat:v1 blob hashes to the rationaleHash the vault logged: Claude's words for the holiday,
 *   a probe's for the other two;
 * - each verdict, and every minute a story counts, to the site's calendar (content/calendar.ts regularSession,
 *   MarketCalendar.isOpen in the contract's order).
 */
export interface RecordMoment {
  /** The tab's id suffix, and the key the tests use. */
  id: "holiday" | "before-close" | "after-close";
  /** The tab's words, under the moment's weekday and time: what the moment was, in two or three words. */
  tab: string;
  txHash: `0x${string}`;
  block: string;
  /** The block's timestamp, in unix seconds. */
  ts: number;
  action: "BUY";
  symbol: "GOOGLc" | "AAPLc";
  /** The amount as the vault's Decision log holds it, in the grammar of the ledger ("$4.68"). */
  amount: string;
  allowed: boolean;
  reason: ReasonCode;
  /** Who sent it: Claude's proposal through Maat's agent, or a probe the owner scheduled. */
  sender: "agent" | "probe";
  /** What happened, in one or two short sentences: the panel's first line. */
  story: string;
  /** Claude's own words: a sentence of the rationale the transaction carries, the blob's `t` (README, "The refusal"). */
  quote?: string;
}

export const RECORD_EYEBROW = "On the record";
export const RECORD_TITLE = "Pick a moment. Read the vault's answer.";
export const RECORD_LEAD =
  "Real Decisions of the vault on Base mainnet. Each one links to its transaction, so you can check it without trusting this page.";

/** What the sender line says for each sender. A probe's words end as PROBE_GLOSS on the engine card does. */
export const RECORD_SENDER: Readonly<Record<RecordMoment["sender"], string>> = {
  agent: "Proposed by Claude, sent by Maat's agent",
  probe: "Sent by Maat's agent as a probe: a $1 test trade the owner scheduled, not a Claude proposal",
};

export const RECORD_MOMENTS: readonly [RecordMoment, RecordMoment, RecordMoment] = [
  {
    id: "holiday",
    tab: "Thanksgiving",
    txHash: "0xca9e2dfe58cea6dc033292a1733a64658e702c3de25627ee7af136d42a38bed6",
    block: "62776552",
    ts: 1795745686,
    action: "BUY",
    symbol: "GOOGLc",
    amount: "$4.68",
    allowed: false,
    reason: "MARKET_CLOSED",
    sender: "agent",
    story: "GOOGLc sat at 0% against a 23.3% target. The price was fine, and $4.68 was under a tenth of the $50 cap. The day was not.",
    quote: "The market is closed, so the contract may refuse; the refusal is worth recording.",
  },
  {
    id: "before-close",
    tab: "Before close",
    txHash: "0x605ea741681e3a105020a2de2491829b2cc58707b5f2f89b8f7c7cf58986e0e2",
    block: "63059534",
    ts: 1795802282,
    action: "BUY",
    symbol: "AAPLc",
    amount: "$1.00",
    allowed: true,
    reason: "OK",
    sender: "probe",
    story: `The day after Thanksgiving, NYSE closed early. Two minutes before the close, all ${FACTS.checksPerTrade.value} checks passed.`,
  },
  {
    id: "after-close",
    tab: "After close",
    txHash: "0x7c086145003fde5a42437d9d3637d51e694f6b371d63fbb9669a9538745c1f0f",
    block: "63060437",
    ts: 1795802463,
    action: "BUY",
    symbol: "GOOGLc",
    amount: "$1.00",
    allowed: false,
    reason: "MARKET_CLOSED",
    sender: "probe",
    story: "Three minutes later, another $1 buy. A spending cap sees two small trades. The vault saw a Friday that ended at 13:00.",
  },
];

/** The links under the moments: every Decision on /ledger, and the other checks in the simulator. */
export const RECORD_LINKS = [
  { label: "Every Decision, on the ledger", href: "/ledger", arrow: "→" },
  { label: "Price, size and the other checks: try the simulator", href: "#try", arrow: "↓" },
] as const;

/** NYSE's regular day, from MarketCalendar.sol OPEN_MIN and CLOSE_MIN: the span the moment's day bar draws. */
export const REGULAR_DAY = FACTS.nyseSessionMin.value;

/** A moment's day as the vault's calendar holds it: the session it allowed, the minute of the Decision, and one line. */
export interface RecordDay {
  /** The session the calendar allowed that day, in minutes after midnight ET, or null when NYSE was closed all day. */
  session: { openMin: number; closeMin: number } | null;
  /** The Decision's minute of the day, ET. */
  minute: number;
  /** MarketCalendar.isOpen(ts, REGULAR) with its reason, in the contract's order. */
  verdict: Session;
  /** The calendar's answer for that minute, in a sentence. */
  line: string;
}

/** What the vault's calendar said at the moment's minute: the day's session and whether the minute was inside it. */
export function recordDay(m: RecordMoment): RecordDay {
  const { etDay, minuteOfDay } = localTime(m.ts);
  const window = sessionWindow(etDay) ?? null;
  const verdict = regularSession(m.ts);
  const at = clockLabel(minuteOfDay);
  const early = window !== null && window.closeMin !== REGULAR_DAY.close;
  const closes = window === null ? "" : `${clockLabel(window.closeMin)} ET${early ? ", an early close" : ""}`;
  let line: string;
  if (verdict.open) line = `The calendar had the market open until ${closes}. ${at} was inside the session.`;
  else if (verdict.why === "holiday") line = `The calendar had NYSE closed all day for ${verdict.holiday}.`;
  else if (verdict.why === "weekend") line = "The calendar had NYSE closed for the weekend.";
  else if (verdict.why === "before-open") line = `The calendar had the market opening at ${clockLabel(verdict.openMin)} ET. ${at} was before it.`;
  else line = `The calendar had the market closing at ${closes}. ${at} was after it.`;
  return { session: window, minute: minuteOfDay, verdict, line };
}
