import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import type { Address, Hash } from "viem";
import { describe, expect, it } from "vitest";
import { BriefFeed } from "@/app/(site)/ask/BriefFeed";
import { briefAnswers, briefFeed, type Brief } from "@/lib/chain/inbox";
import { verifyJournal, type JournalRow } from "@/lib/chain/ledger";

// The rows the agent journals for a round with briefs, written by agent/test/briefJournal.test.ts from the agent's own
// journal code: the published lines, and the Brief logs the round read.
const FIXTURES = join(process.cwd(), "..", "agent", "test", "fixtures");
const PUBLISHED = readFileSync(join(FIXTURES, "journal-briefs.jsonl"), "utf8");
const LOGS = JSON.parse(readFileSync(join(FIXTURES, "journal-briefs.logs.json"), "utf8")) as { id: number; from: Address; text: string; blockNumber: string; txHash: Hash; logIndex: number }[];
const BRIEFS: Brief[] = LOGS.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) }));
const chain = verifyJournal([{ name: "2026-11-28.jsonl", text: PUBLISHED }]);
const ROWS: JournalRow[] = chain.rows;

describe("briefAnswers reads the agent's brief rows from the published journal", () => {
  it("verifies the agent's lines and finds an answer for every brief the round decided", () => {
    expect(chain.failure).toBeNull();
    const answers = briefAnswers(ROWS, BRIEFS);
    expect(Object.fromEntries(answers)).toEqual({
      1: { outcome: "replied", reply: "Adopted: a 5 USD NVDAc buy fits the policy.", adopted: true },
      2: { outcome: "replied", reply: "Not adopted: the 30% cash target already holds.", adopted: false },
      3: { outcome: "skipped", cap: "briefs-per-sender" },
      4: { outcome: "replied", reply: "Not adopted: Maat only trades its own funds. See [url] for the rules.", adopted: false },
      5: { outcome: "unanswered", adopted: false },
    });
  });

  it("drops a row whose Brief log no longer exists, or exists under another transaction or log index", () => {
    const now = BRIEFS.filter((b) => b.id !== 2).map((b) => (b.id === 4 ? { ...b, txHash: `0x${"77".repeat(32)}` as Hash } : b.id === 5 ? { ...b, logIndex: 1 } : b));
    const answers = briefAnswers(ROWS, now);
    expect([...answers.keys()].sort()).toEqual([1, 3]);
  });

  it("keeps the first row for a brief, and passes over rows that are not brief rows or are malformed", () => {
    const one = ROWS.find((r) => r.fields.kind === "brief" && r.fields.briefId === 1)!;
    const later = { ...one, fields: { ...one.fields, outcome: "unanswered", reply: undefined } };
    const bad = [
      { ...one, fields: { ...one.fields, briefId: "1" } },
      { ...one, fields: { ...one.fields, outcome: "replied", reply: 7 } },
      { ...one, fields: { ...one.fields, kind: "skip" } },
    ];
    expect(briefAnswers([...bad, one, later], BRIEFS).get(1)).toMatchObject({ outcome: "replied" });
    expect(briefAnswers(bad, BRIEFS).size).toBe(0);
  });
});

describe("BriefFeed shows the agent's answer under each brief, as plain text", () => {
  it("shows the reply, the adoption, a skip's cap and a missing reply, with no link", () => {
    render(<BriefFeed items={briefFeed(BRIEFS, [], briefAnswers(ROWS, BRIEFS))} />);
    const list = screen.getByRole("list", { name: "Briefs" });
    const answer = (id: number) => list.querySelector(`[data-brief-id="${id}"] [data-brief-answer]`);
    expect(answer(1)).toHaveTextContent("Maat replied: Adopted: a 5 USD NVDAc buy fits the policy. It adopted this brief into an intent; the vault decides.");
    expect(answer(2)).toHaveTextContent("Maat replied: Not adopted: the 30% cash target already holds.");
    expect(answer(3)).toHaveTextContent("Not sent to Claude: its sender's daily cap was reached.");
    expect(answer(4)).toHaveTextContent("See [url] for the rules.");
    expect(answer(5)).toHaveTextContent("Sent to Claude, which gave no reply.");
    expect(answer(1)).toHaveAttribute("data-brief-answer", "replied");
    expect(list.querySelectorAll("a, [href]")).toHaveLength(0);
    expect(within(list).getAllByRole("listitem")).toHaveLength(BRIEFS.length);
  });

  it("shows no answer while the journal has none for a brief", () => {
    render(<BriefFeed items={briefFeed(BRIEFS, [])} />);
    expect(screen.getByRole("list", { name: "Briefs" }).querySelectorAll("[data-brief-answer]")).toHaveLength(0);
  });
});
