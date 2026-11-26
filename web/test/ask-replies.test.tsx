import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, within } from "@testing-library/react";
import type { Address, Hash } from "viem";
import { describe, expect, it } from "vitest";
import { BriefFeed } from "@/app/(site)/ask/BriefFeed";
import { briefAnswers, weighings, type Brief, type WeighingSources } from "@/lib/chain/inbox";
import { verifyJournal, type JournalRow } from "@/lib/chain/ledger";

// The rows the agent journals for a round with briefs, written by agent/test/briefJournal.test.ts from the agent's own
// journal code: the published lines, and the Brief logs the round read.
const FIXTURES = join(process.cwd(), "..", "agent", "test", "fixtures");
const PUBLISHED = readFileSync(join(FIXTURES, "journal-briefs.jsonl"), "utf8");
const LOGS = JSON.parse(readFileSync(join(FIXTURES, "journal-briefs.logs.json"), "utf8")) as { id: number; from: Address; text: string; blockNumber: string; txHash: Hash; logIndex: number }[];
const BRIEFS: Brief[] = LOGS.map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) }));
const FILE = "2026-11-28.jsonl";
const chain = verifyJournal([{ name: FILE, text: PUBLISHED }]);
const ROWS: JournalRow[] = chain.rows;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const at = (line: number) => ({ file: FILE, line, commit: COMMIT });

/** The feed of the fixture's briefs with `answers`, before the team set and the vault's Decisions are read. */
const sources = (answers: WeighingSources["journal"]): WeighingSources => ({
  briefs: BRIEFS,
  hidden: [],
  journal: answers,
  verdicts: { state: "reading" },
  team: { state: "reading" },
});

describe("briefAnswers reads the agent's brief rows from the published journal", () => {
  it("verifies the agent's lines and finds an answer for every brief the round decided, with the row it is on", () => {
    expect(chain.failure).toBeNull();
    const answers = briefAnswers(ROWS, BRIEFS);
    expect(Object.fromEntries(answers)).toEqual({
      1: { outcome: "replied", reply: "Adopted: a 5 USD NVDAc buy fits the policy.", adopted: true, row: at(5) },
      2: { outcome: "replied", reply: "Not adopted: the 30% cash target already holds.", adopted: false, row: at(6) },
      3: { outcome: "skipped", cap: "briefs-per-sender", row: at(1) },
      4: { outcome: "replied", reply: "Not adopted: Maat only trades its own funds. See [url] for the rules.", adopted: false, row: at(7) },
      5: { outcome: "unanswered", adopted: false, row: at(9) },
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

  it("names no agent commit for a row whose commit is not one the spec allows", () => {
    const one = ROWS.find((r) => r.fields.kind === "brief" && r.fields.briefId === 1)!;
    for (const commit of [undefined, 7, "main", `${COMMIT}x`]) {
      expect(briefAnswers([{ ...one, fields: { ...one.fields, commit } }], BRIEFS).get(1)?.row.commit, String(commit)).toBeNull();
    }
    expect(briefAnswers([{ ...one, fields: { ...one.fields, commit: "unknown" } }], BRIEFS).get(1)?.row.commit).toBe("unknown");
  });
});

describe("BriefFeed shows what Maat's agent journaled for each brief, as plain text", () => {
  it("shows the reply, whether Claude was persuaded, a skip's cap and a missing reply, with no link", () => {
    render(<BriefFeed items={weighings(sources({ state: "read", answers: briefAnswers(ROWS, BRIEFS), complete: true }))} />);
    const list = screen.getByRole("list", { name: "Briefs" });
    const slot = (id: number, name: string) => list.querySelector(`[data-brief-id="${id}"] [data-weighing="${name}"]`);
    expect(slot(1, "reply")).toHaveTextContent("Maat's agent replied: Adopted: a 5 USD NVDAc buy fits the policy.");
    expect(slot(1, "persuaded")).toHaveTextContent("Claude persuaded: yes, adopted into an intent");
    expect(slot(2, "reply")).toHaveTextContent("Maat's agent replied: Not adopted: the 30% cash target already holds.");
    expect(slot(2, "persuaded")).toHaveTextContent("Claude persuaded: no");
    expect(slot(3, "reply")).toHaveTextContent("Maat's agent did not send it to Claude: its sender's daily cap was reached.");
    expect(slot(4, "reply")).toHaveTextContent("See [url] for the rules.");
    expect(slot(5, "reply")).toHaveTextContent("Maat's agent sent it to Claude, which gave no reply.");
    expect(slot(1, "reply")).toHaveAttribute("data-reply", "replied");
    expect(list.querySelector('[data-brief-id="1"] [data-journal-row]')).toHaveTextContent(`journal ${FILE} line 5 · agent commit 0123456`);
    expect(list.textContent).not.toMatch(/Maat replied/);
    expect(list.querySelectorAll("a, [href]")).toHaveLength(0);
    expect(within(list).getAllByRole("listitem")).toHaveLength(BRIEFS.length);
  });

  it("says the journal is not published yet, not that there is no reply, while the journal branch does not exist", () => {
    render(<BriefFeed items={weighings(sources({ state: "absent" }))} />);
    const replies = [...screen.getByRole("list", { name: "Briefs" }).querySelectorAll('[data-weighing="reply"]')];
    expect(replies.map((r) => r.textContent)).toEqual(Array(BRIEFS.length).fill("Maat's agent: its journal is not published yet."));
    expect(document.querySelectorAll("[data-journal-row]")).toHaveLength(0);
  });

  it("says there is no reply yet while the published journal has none for a brief", () => {
    render(<BriefFeed items={weighings(sources({ state: "read", answers: new Map(), complete: true }))} />);
    const replies = [...screen.getByRole("list", { name: "Briefs" }).querySelectorAll('[data-weighing="reply"]')];
    expect(replies.map((r) => r.textContent)).toEqual(Array(BRIEFS.length).fill("Maat's agent: no reply yet."));
  });
});
