import type { TokenSymbol } from "./addresses.js";
import type { CalendarDay, TokenState, VaultState } from "./chain/state.js";
import type { Proposal } from "./intent.js";
import { PROBE_TEXT_PREFIX } from "./rationale/blob.js";
import { SESSION_MODES } from "./types.js";
import { usdToUsdc6, valueUsd6 } from "./units.js";

/*
 * Fixed-time probes (MAAT_PROBES). At each listed UTC instant the running agent sends one labeled intent that no
 * Claude call wrote, so the vault's verdict at a chosen moment, such as just before and just after an early close,
 * is on chain. Its blob has k = "probe" and a t that starts with PROBE_TEXT_PREFIX
 * (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md §2.1, §4). loop/probeRound.ts runs them.
 */

/** At most this many probes run on one UTC day: MAAT_PROBES keeps the earliest 3, and state.json counts across restarts. */
export const MAX_PROBES_PER_DAY = 3;
/** A probe that expects OK sends at least this many seconds before the close of its instant's session, or not at all. */
export const PROBE_DEADLINE_MARGIN_S = 30;
/** A probe that gets the round lock more than this long after its instant is journaled as missed and not run. */
export const PROBE_LATE_LIMIT_MS = 10 * 60_000;
/** The size of a probe intent in US dollars: a BUY of $1, or a SELL of $1 of a holding (all of it if it is worth less). */
export const PROBE_USD = 1;

/** What the calendar at a probe's instant leads it to expect from the vault. */
export type ProbeExpectation = "OK" | "MARKET_CLOSED";
/**
 * What became of a probe: it sent, or in dry-run would have; it ran and sent nothing (`skipped`) or stopped on an error
 * (`halted`); or it did not run, because its instant passed while the agent was down or busy (`missed`) or the UTC
 * day's probes were used up (`capped`).
 */
export type ProbeOutcome = "sent" | "dry-run" | "skipped" | "halted" | "missed" | "capped";

const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$/;

/** "2026-11-27T17:58:00Z": the instant to the second, the form a probe's run id and its journal rows carry. */
export function probeIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface ProbeList {
  /** The instants that run, in ms since the epoch, earliest first. */
  at: number[];
  /** One line for each entry left out, saying why. */
  problems: string[];
}

/**
 * MAAT_PROBES: comma-separated instants `YYYY-MM-DDTHH:MM:SSZ` (or `YYYY-MM-DDTHH:MMZ`), in UTC. An entry that is not
 * one, a repeat, and a fourth or later instant on one UTC day are left out with a line in `problems`; nothing throws.
 */
export function parseProbes(raw: string | undefined): ProbeList {
  const problems: string[] = [];
  const seen = new Set<number>();
  const valid: number[] = [];
  for (const entry of (raw ?? "").split(",").map((e) => e.trim())) {
    if (entry === "") continue;
    const m = INSTANT_RE.exec(entry);
    const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? "0")) : NaN;
    // Date.UTC rolls 2026-02-30 over into March and 24:00 into the next day: an instant must read back as written.
    if (!m || Number.isNaN(ms) || probeIso(ms) !== `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`) {
      problems.push(`${JSON.stringify(entry)} is not an ISO-8601 UTC instant such as 2026-11-27T17:58:00Z; left out`);
      continue;
    }
    if (seen.has(ms)) {
      problems.push(`${probeIso(ms)} is listed more than once; it runs once`);
      continue;
    }
    seen.add(ms);
    valid.push(ms);
  }
  const perDay = new Map<string, number>();
  const at = valid
    .sort((a, b) => a - b)
    .filter((ms) => {
      const day = probeIso(ms).slice(0, 10);
      const n = (perDay.get(day) ?? 0) + 1;
      perDay.set(day, n);
      if (n <= MAX_PROBES_PER_DAY) return true;
      problems.push(`${probeIso(ms)} is probe ${n} on UTC day ${day}; at most ${MAX_PROBES_PER_DAY} run a day, so it is left out`);
      return false;
    });
  return { at, problems };
}

export interface ProbePlan {
  /** Still to come at the start: the scheduler waits for each. */
  due: number[];
  /** Passed before the start, while the agent was not running: journaled as missed, never run late. */
  missed: number[];
  /** Already run, missed or capped by an earlier start (state.json): not run again. */
  earlier: { at: number; outcome: string }[];
}

/** Sorts the instants of MAAT_PROBES at a start: `recorded` is what state.json says became of an instant, if anything. */
export function planProbes(at: readonly number[], startedAt: number, recorded: (iso: string) => string | undefined): ProbePlan {
  const plan: ProbePlan = { due: [], missed: [], earlier: [] };
  for (const ms of at) {
    const outcome = recorded(probeIso(ms));
    if (outcome !== undefined) plan.earlier.push({ at: ms, outcome });
    else if (ms < startedAt) plan.missed.push(ms);
    else plan.due.push(ms);
  }
  return plan;
}

const REGULAR = SESSION_MODES.indexOf("REGULAR");
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export interface ProbeDeadline {
  /** Unix seconds: the last moment an OK-expected probe may send. */
  by: bigint;
  /** The close it is counted from, in words: "the 13:00 ET early close". */
  close: string;
}

/**
 * When a probe that expects OK must send by: PROBE_DEADLINE_MARGIN_S before the close of the session its instant
 * falls in, as the calendar reports it for that NYSE date `c` (its early close, else 16:00 ET). Under FEED_24_5 it
 * counts from 20:00 ET on a Friday and from midnight ET on any other day, the earliest the session can end that date.
 */
export function probeDeadline(atS: bigint, c: CalendarDay, sessionMode: number): ProbeDeadline {
  const regular = sessionMode === REGULAR;
  const closeMin = regular ? (c.earlyCloseMin !== 0 ? c.earlyCloseMin : 960) : c.weekday === 5 ? 1200 : 1440;
  // The New York midnight that starts the instant's NYSE date: offsets are whole hours, so seconds match UTC's.
  const midnight = atS - BigInt(c.minuteOfDay * 60) - (atS % 60n);
  const close = !regular ? (closeMin === 1440 ? "midnight ET" : `${hhmm(closeMin)} ET`) : `the ${hhmm(closeMin)} ET ${c.earlyCloseMin !== 0 ? "early close" : "close"}`;
  return { by: midnight + BigInt(closeMin * 60 - PROBE_DEADLINE_MARGIN_S), close };
}

/** A probe's t: the start the spec requires, then what it expects. A MARKET_CLOSED log adds the closed phase after it. */
export function probeText(expected: ProbeExpectation, close?: string): string {
  return expected === "OK" ? `${PROBE_TEXT_PREFIX}. Expected OK before ${close ?? "the close"}.` : `${PROBE_TEXT_PREFIX}. Expected MARKET_CLOSED.`;
}

const PROBE_USD6 = usdToUsdc6(PROBE_USD);
const byValue = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);
type Priced = TokenState & { symbol: TokenSymbol; price8: bigint };

/**
 * What a probe asks the vault about, in order, from the state alone: a $1 BUY of the least held listed token that $1
 * more keeps within its maxWeightBps (the vault's CONCENTRATION rule), then a $1 SELL of the largest holding. None
 * when $1 does not fit the mandate's per-trade cap or what the vault's daily cap has left.
 */
export function probeCandidates(s: VaultState, text: string): Proposal[] {
  if (PROBE_USD6 > s.mandate.perTradeCapUsd || s.spentToday + PROBE_USD6 > s.mandate.dailyCapUsd) return [];
  const priced = s.tokens.filter((t): t is Priced => t.symbol !== undefined && t.price8 !== null);
  const out: Proposal[] = [];
  const fits = (t: Priced) => t.config.allowed && (t.valueUsd6 + PROBE_USD6) * 10_000n <= BigInt(t.config.maxWeightBps) * s.equityUsd6;
  // Array sort is stable: on a tie, tokens() order decides.
  const buy = s.usdcBalance >= PROBE_USD6 ? priced.filter(fits).sort((a, b) => byValue(a.valueUsd6, b.valueUsd6))[0] : undefined;
  if (buy) out.push({ action: "BUY", symbol: buy.symbol, amountUsd: PROBE_USD, rationale: text });
  const held = (t: Priced) => valueUsd6(t.balance, t.price8, t.decimals);
  const sell = priced.filter((t) => held(t) > 0n).sort((a, b) => byValue(held(b), held(a)))[0];
  if (sell) out.push({ action: "SELL", symbol: sell.symbol, amountUsd: PROBE_USD, rationale: text });
  return out;
}
