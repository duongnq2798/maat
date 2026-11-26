import { describe, expect, it } from "vitest";
import type { Brief } from "../src/briefs/inbox.js";
import {
  MAX_BRIEF_LLM_USD6_PER_DAY,
  MAX_BRIEF_TX_PER_DAY,
  MAX_BRIEFS_PER_DAY,
  MAX_BRIEFS_PER_ROUND,
  MAX_BRIEFS_PER_SENDER_PER_DAY,
  MAX_REPLY_CHARS,
  planBriefs,
  type BriefDayCount,
} from "../src/briefs/caps.js";
import { FakeInbox, SENDERS } from "./fakes/fakeInbox.js";

const brief = (id: number, sender = id % SENDERS.length): Brief => ({
  id,
  from: SENDERS[sender]!,
  text: `brief ${id}`,
  block: 60n + BigInt(id),
  txHash: FakeInbox.txOf(id),
  logIndex: 0,
});
const fresh: BriefDayCount = { sent: 0, senders: {}, txs: 0, llmUsd6: 0n };
const ids = (bs: readonly { id: number }[]) => bs.map((b) => b.id);

describe("the caps of inbox spec §3", () => {
  it("are 3 a round, 20 a day, 2 per sender a day, 5 brief-driven txs a day, $0.25 of Claude a day and 200-character replies", () => {
    expect([MAX_BRIEFS_PER_ROUND, MAX_BRIEFS_PER_DAY, MAX_BRIEFS_PER_SENDER_PER_DAY, MAX_BRIEF_TX_PER_DAY]).toEqual([3, 20, 2, 5]);
    expect(MAX_BRIEF_LLM_USD6_PER_DAY).toBe(250_000n);
    expect(MAX_REPLY_CHARS).toBe(200);
  });
});

describe("planBriefs", () => {
  it("sends at most 3 a round, in id order; the 4th waits for the next round and is not journaled", () => {
    const p = planBriefs([1, 2, 3, 4].map((id) => brief(id)), fresh, { llmCapped: false });
    expect(ids(p.send)).toEqual([1, 2, 3]);
    expect(ids(p.wait)).toEqual([4]);
    expect(p.skip).toEqual([]);
  });

  it("skips a brief over the day cap with its name, never sending it", () => {
    const p = planBriefs([brief(21), brief(22)], { ...fresh, sent: 19 }, { llmCapped: false });
    expect(ids(p.send)).toEqual([21]);
    expect(p.skip.map((s) => [s.brief.id, s.cap])).toEqual([[22, "briefs-per-day"]]);
  });

  it("skips a sender's third brief of the day, counting the ones sent earlier that day and in this round", () => {
    const a = SENDERS[0]!.toLowerCase();
    const p = planBriefs([brief(1, 0), brief(2, 0), brief(3, 1)], { ...fresh, sent: 1, senders: { [a]: 1 } }, { llmCapped: false });
    expect(ids(p.send)).toEqual([1, 3]);
    expect(p.skip.map((s) => [s.brief.id, s.cap])).toEqual([[2, "briefs-per-sender"]]);
  });

  it("skips every brief once 5 brief-driven txs went out that day", () => {
    const p = planBriefs([brief(1), brief(2)], { ...fresh, txs: MAX_BRIEF_TX_PER_DAY }, { llmCapped: false });
    expect(p.send).toEqual([]);
    expect(p.skip.map((s) => s.cap)).toEqual(["brief-txs-per-day", "brief-txs-per-day"]);
  });

  it("skips every brief once rounds that carried briefs spent $0.25 of Claude that day", () => {
    const p = planBriefs([brief(1)], { ...fresh, llmUsd6: MAX_BRIEF_LLM_USD6_PER_DAY }, { llmCapped: false });
    expect(p.skip.map((s) => s.cap)).toEqual(["brief-llm-per-day"]);
    expect(planBriefs([brief(1)], { ...fresh, llmUsd6: MAX_BRIEF_LLM_USD6_PER_DAY - 1n }, { llmCapped: false }).send).toHaveLength(1);
  });

  it("skips every brief when the agent's own daily Claude cap stops the round", () => {
    const p = planBriefs([brief(1)], fresh, { llmCapped: true });
    expect(p.skip.map((s) => s.cap)).toEqual(["llm-per-day"]);
  });

  it("lets the round cap hold back briefs only after the day and sender caps had their say", () => {
    const a = SENDERS[0]!.toLowerCase();
    const p = planBriefs([brief(1, 1), brief(2, 2), brief(3, 3), brief(4, 0), brief(5, 4)], { ...fresh, senders: { [a]: 2 }, sent: 2 }, { llmCapped: false });
    expect(ids(p.send)).toEqual([1, 2, 3]);
    expect(p.skip.map((s) => [s.brief.id, s.cap])).toEqual([[4, "briefs-per-sender"]]);
    expect(ids(p.wait)).toEqual([5]);
  });
});
