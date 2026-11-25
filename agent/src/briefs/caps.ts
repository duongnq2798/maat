import type { Brief } from "./inbox.js";

/*
 * The caps and the brief budget of docs/superpowers/specs/2026-11-25-maat-inbox-design.md §3. Every "a day" is a UTC
 * day of the round's state block (timestamp / 86,400), the day MAAT_MAX_TX_PER_DAY and the vault's daily cap use.
 */

/** Briefs sent to Claude in one round; the next one waits for the next round. */
export const MAX_BRIEFS_PER_ROUND = 3;
/** Briefs sent to Claude in one UTC day. */
export const MAX_BRIEFS_PER_DAY = 20;
/** Briefs of one sender sent to Claude in one UTC day. */
export const MAX_BRIEFS_PER_SENDER_PER_DAY = 2;
/** Brief-driven transactions in one UTC day, counted inside MAAT_MAX_TX_PER_DAY too. */
export const MAX_BRIEF_TX_PER_DAY = 5;
/** The Claude spend of the rounds that carried briefs, per UTC day: $0.25 of the MAAT_MAX_LLM_USD_PER_DAY cap. */
export const MAX_BRIEF_LLM_USD6_PER_DAY = 250_000n;
/** The most characters of a reply the journal keeps; a longer one is cut on a space. */
export const MAX_REPLY_CHARS = 200;
/** The most briefs one intent may adopt (the blob's q). */
export const MAX_BRIEFS_PER_INTENT = 3;

/**
 * The name a skipped brief is journaled with, in the order planBriefs asks: the agent's own daily Claude cap, then
 * the brief budget (Claude spend, then transactions), then the day cap and the per-sender cap.
 */
export const BRIEF_CAPS = ["llm-per-day", "brief-llm-per-day", "brief-txs-per-day", "briefs-per-day", "briefs-per-sender"] as const;
export type BriefCap = (typeof BRIEF_CAPS)[number];

/** One UTC day of briefs, as state.json counts it. `senders` is keyed by the lowercase address. */
export interface BriefDayCount {
  sent: number;
  senders: Readonly<Record<string, number>>;
  txs: number;
  llmUsd6: bigint;
}

export interface BriefPlan {
  /** Sent to Claude this round. */
  send: Brief[];
  /** Journaled as skipped with the cap's name; never sent to Claude. */
  skip: { brief: Brief; cap: BriefCap }[];
  /** Over the round cap: left for the next round, not journaled. */
  wait: Brief[];
}

/**
 * What a round does with `fresh` (the briefs it has not decided yet, in id order), given the day's counts so far.
 * Each brief meets the caps in BRIEF_CAPS order; one that passes them all is sent while the round has room, and waits
 * otherwise. A brief that waits does not count toward the day or its sender.
 */
export function planBriefs(fresh: readonly Brief[], day: BriefDayCount, o: { llmCapped: boolean }): BriefPlan {
  const plan: BriefPlan = { send: [], skip: [], wait: [] };
  const senders = new Map(Object.entries(day.senders));
  let sent = day.sent;
  for (const b of fresh) {
    const from = b.from.toLowerCase();
    const cap: BriefCap | null = o.llmCapped
      ? "llm-per-day"
      : day.llmUsd6 >= MAX_BRIEF_LLM_USD6_PER_DAY
        ? "brief-llm-per-day"
        : day.txs >= MAX_BRIEF_TX_PER_DAY
          ? "brief-txs-per-day"
          : sent >= MAX_BRIEFS_PER_DAY
            ? "briefs-per-day"
            : (senders.get(from) ?? 0) >= MAX_BRIEFS_PER_SENDER_PER_DAY
              ? "briefs-per-sender"
              : null;
    if (cap) plan.skip.push({ brief: b, cap });
    else if (plan.send.length >= MAX_BRIEFS_PER_ROUND) plan.wait.push(b);
    else {
      plan.send.push(b);
      sent++;
      senders.set(from, (senders.get(from) ?? 0) + 1);
    }
  }
  return plan;
}
