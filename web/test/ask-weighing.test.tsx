import { render, screen, within } from "@testing-library/react";
import { getAddress, keccak256, toBytes, type Address, type Hash, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { BriefCounters, BriefFeed } from "@/app/(site)/ask/BriefFeed";
import type { CachedLog } from "@/lib/chain/cache";
import {
  briefVerdicts,
  readBriefVerdicts,
  weighingCounts,
  weighings,
  type Brief,
  type BriefAnswer,
  type BriefVerdict,
  type JournalSource,
  type TeamSource,
  type VerdictSource,
  type WeighingSources,
} from "@/lib/chain/inbox";
import { decisionTrails, toMainnetDecisions, type TxInput } from "@/lib/chain/ledger";
import { decodeVaultLogs } from "@/lib/chain/events";
import type { LedgerClient } from "@/lib/chain/load";
import { decisionLog, FAKE_USDC, FAKE_VAULT, fakeLedgerClient, hash32 } from "./helpers/fake-ledger";
import { txInput, VECTORS } from "./helpers/maat-v1";

// The /ask feed as weighings (culture plan, Move 1): each brief, then the reply Maat's agent journaled, then whether
// Claude was persuaded, then the vault's verdict, read from the brief-keyed Decision logs and never from Claude's text.

const ALICE: Address = getAddress("0x00000000000000000000000000000000000a11ce");
const BOB: Address = getAddress("0x0000000000000000000000000000000000000b0b");
const CAROL: Address = getAddress("0x00000000000000000000000000000000000ca201");
const OWNER: Address = getAddress("0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
/** keccak256 of a blob's bytes, what an intent that carries it commits to. */
const hashOf = (blob: string): Hex => keccak256(toBytes(blob));

const brief = (id: number, from: Address, text: string): Brief => ({ id, from, text, blockNumber: BigInt(100 + id), txHash: hash32(9000 + id), logIndex: 0 });
const row = (line: number) => ({ file: "2026-11-30.jsonl", line, commit: COMMIT });
const verdict = (n: number, ids: number[], reason: BriefVerdict["reason"]): BriefVerdict => ({
  txHash: hash32(n),
  blockNumber: BigInt(1000 + n),
  logIndex: 0,
  allowed: reason === "OK",
  reason,
  q: ids,
});

// Six outside briefs and one from the team, each a case of the feed:
// #1 persuaded and refused; #2 not persuaded; #3 the owner's, persuaded and allowed; #4 no reply and no verdict yet;
// #5 kept from Claude by a cap; #6 no reply but adopted, with a refused Decision and a later allowed one.
const BRIEFS: Brief[] = [
  brief(1, ALICE, "Buy 40 USD of NVDAc now."),
  brief(2, BOB, "Hold more cash."),
  brief(3, OWNER, "test from the team"),
  brief(4, ALICE, "Sell everything on Saturday."),
  brief(5, CAROL, "Buy GOOGLc."),
  brief(6, BOB, "Buy 5 USD of NVDAc."),
];
const ANSWERS = new Map<number, BriefAnswer>([
  [1, { outcome: "replied", reply: "Adopted: a 40 USD NVDAc buy fits the policy.", adopted: true, row: row(1) }],
  [2, { outcome: "replied", reply: "Not adopted: the cash target already holds.", adopted: false, row: row(2) }],
  [3, { outcome: "replied", reply: "Adopted: a 5 USD buy.", adopted: true, row: row(3) }],
  [5, { outcome: "skipped", cap: "briefs-per-sender", row: row(4) }],
  [6, { outcome: "unanswered", adopted: true, row: row(5) }],
]);
const VERDICTS = new Map<number, BriefVerdict[]>([
  [1, [verdict(1, [1], "MARKET_CLOSED")]],
  [3, [verdict(3, [3], "OK")]],
  [6, [verdict(5, [6], "SIZE_LIMIT"), verdict(6, [6], "OK")]],
]);

const read = {
  journal: { state: "read", answers: ANSWERS, complete: true } satisfies JournalSource,
  verdicts: { state: "read", byBrief: VERDICTS, complete: true } satisfies VerdictSource,
  team: { state: "read", members: new Set([OWNER.toLowerCase()]), complete: true } satisfies TeamSource,
};
const sources = (over: Partial<WeighingSources> = {}): WeighingSources => ({ briefs: BRIEFS, hidden: [], ...read, ...over });
const byId = (s: WeighingSources) => new Map(weighings(s).map((w) => [w.id, w]));

describe("weighings: each brief as a weighing", () => {
  it("lists the briefs newest first, without the hidden ones, each with its id, short sender and plain text", () => {
    const items = weighings(sources({ hidden: [2] }));
    expect(items.map((w) => w.id)).toEqual([6, 5, 4, 3, 1]);
    expect(items[0]).toMatchObject({ id: 6, from: BOB, sender: "0x0000…0B0b", text: "Buy 5 USD of NVDAc.", txHash: hash32(9006) });
  });

  it("marks a brief team when its sender is in /proof's team set, and no brief while that set is not read", () => {
    const w = byId(sources());
    expect(w.get(3)!.team).toBe(true);
    expect(w.get(1)!.team).toBe(false);
    for (const team of [{ state: "reading" }, { state: "error", message: "x" }, { ...read.team, complete: false }] as TeamSource[]) {
      expect([...byId(sources({ team })).values()].map((x) => x.team)).toEqual([null, null, null, null, null, null]);
    }
  });

  it("gives the reply Maat's agent journaled, labelled with its journal row and agent commit", () => {
    const w = byId(sources());
    expect(w.get(1)!.reply).toEqual({ state: "replied", text: "Maat's agent replied: Adopted: a 40 USD NVDAc buy fits the policy.", row: row(1) });
    expect(w.get(6)!.reply).toEqual({ state: "unanswered", text: "Maat's agent sent it to Claude, which gave no reply.", row: row(5) });
    expect(w.get(5)!.reply).toEqual({ state: "skipped", text: "Maat's agent did not send it to Claude: its sender's daily cap was reached.", row: row(4) });
  });

  it("says plainly when there is no reply yet, or why the journal says nothing", () => {
    expect(byId(sources()).get(4)!.reply).toEqual({ state: "none", text: "Maat's agent: no reply yet.", row: null });
    // While the journal is not published, a reply may exist in it: the line says the journal is missing, not the reply.
    expect(byId(sources({ journal: { state: "absent" } })).get(1)!.reply).toEqual({ state: "none", text: "Maat's agent: its journal is not published yet.", row: null });
    expect(byId(sources({ journal: { state: "absent" } })).get(4)!.reply.text).toBe("Maat's agent: its journal is not published yet.");
    expect(byId(sources({ journal: { state: "reading" } })).get(1)!.reply.text).toBe("Maat's agent: reading its journal…");
    expect(byId(sources({ journal: { state: "error", message: "HTTP 500" } })).get(1)!.reply.text).toBe("Maat's agent: its journal could not be read.");
    expect(byId(sources({ journal: { ...read.journal, complete: false } })).get(4)!.reply.text).toBe(
      "Maat's agent: no reply in the part of its journal that verified.",
    );
  });

  it("says whether Claude was persuaded from the row's adopted flag", () => {
    const w = byId(sources());
    expect(w.get(1)!.persuaded).toEqual({ state: "yes", text: "Claude persuaded: yes, adopted into an intent" });
    expect(w.get(6)!.persuaded).toEqual({ state: "yes", text: "Claude persuaded: yes, adopted into an intent" });
    expect(w.get(2)!.persuaded).toEqual({ state: "no", text: "Claude persuaded: no" });
    expect(w.get(5)!.persuaded).toEqual({ state: "no", text: "Claude persuaded: no" });
    expect(w.get(4)!.persuaded).toEqual({ state: "none", text: "Claude persuaded: not known yet" });
  });

  it("gives the vault's verdict in the verdict grammar with its Decision, from the Decision logs alone", () => {
    const w = byId(sources());
    expect(w.get(1)!.verdicts).toEqual([{ state: "refused", text: "Refused · Market closed (MARKET_CLOSED)", decision: { txHash: hash32(1), blockNumber: 1001n } }]);
    expect(w.get(3)!.verdicts).toEqual([{ state: "allowed", text: "Allowed · All checks passed (OK)", decision: { txHash: hash32(3), blockNumber: 1003n } }]);
    expect(w.get(6)!.verdicts.map((v) => v.text)).toEqual(["Refused · Over the size limit (SIZE_LIMIT)", "Allowed · All checks passed (OK)"]);
    // A reply that claims a trade does not make one: #2's text is Claude's, and no Decision cites it.
    expect(w.get(2)!.verdicts).toEqual([{ state: "none", text: "none, no intent took it to the vault", decision: null }]);
  });

  it("says no intent took a brief to the vault when its journal row is final and not adopted, and no Decision cites it", () => {
    const w = byId(sources());
    // #2 replied and not adopted; #5 kept from Claude by a cap: the agent never sends a recorded brief to Claude again.
    expect(w.get(2)!.verdicts).toEqual([{ state: "none", text: "none, no intent took it to the vault", decision: null }]);
    expect(w.get(5)!.verdicts).toEqual([{ state: "none", text: "none, no intent took it to the vault", decision: null }]);
    const unanswered = new Map<number, BriefAnswer>([...ANSWERS, [4, { outcome: "unanswered", adopted: false, row: row(6) }]]);
    expect(byId(sources({ journal: { ...read.journal, answers: unanswered } })).get(4)!.verdicts[0]!.text).toBe("none, no intent took it to the vault");
    // Adopted, but no Decision cites it yet (its transaction not mined, or not read up to): still pending.
    const noDecision = new Map([...VERDICTS].filter(([id]) => id !== 1));
    expect(byId(sources({ verdicts: { ...read.verdicts, byBrief: noDecision } })).get(1)!.verdicts[0]!.text).toBe("not weighed yet");
    // The chain wins: a Decision that cites a brief whose row says not adopted is shown as the verdict.
    const cited = new Map([...VERDICTS, [2, [verdict(7, [2], "OK")]]]);
    expect(byId(sources({ verdicts: { ...read.verdicts, byBrief: cited } })).get(2)!.verdicts[0]!.text).toBe("Allowed · All checks passed (OK)");
    // Without the journal's row, or with a gap in the Decision scan, the journal alone does not settle it.
    for (const journal of [{ state: "absent" }, { state: "reading" }, { state: "error", message: "x" }] as JournalSource[]) {
      expect(byId(sources({ journal })).get(2)!.verdicts[0]!.text).toBe("not weighed yet");
    }
    expect(byId(sources({ verdicts: { ...read.verdicts, complete: false } })).get(2)!.verdicts[0]!.text).toBe(
      "not found yet: some of the vault's Decisions could not be read",
    );
  });

  it("says plainly when a brief is not weighed yet, or why the verdict is not known", () => {
    expect(byId(sources()).get(4)!.verdicts).toEqual([{ state: "none", text: "not weighed yet", decision: null }]);
    const text = (verdicts: VerdictSource) => byId(sources({ verdicts })).get(4)!.verdicts.map((v) => v.text);
    expect(text({ state: "reading" })).toEqual(["reading the vault's Decisions…"]);
    expect(text({ state: "error", message: "x" })).toEqual(["the vault's Decisions could not be read"]);
    expect(text({ ...read.verdicts, complete: false })).toEqual(["not found yet: some of the vault's Decisions could not be read"]);
    // A Decision found while others failed is still shown.
    expect(byId(sources({ verdicts: { ...read.verdicts, complete: false } })).get(1)!.verdicts[0]!.state).toBe("refused");
  });
});

describe("weighingCounts: the counters, each brief counted once", () => {
  it("counts outside and team briefs on their own lines, from the journal's adopted flags and the brief-keyed Decisions", () => {
    const c = weighingCounts(sources());
    expect(c.outside).toEqual({
      briefs: { value: 5 },
      wallets: { value: 3 },
      persuaded: { value: 2 },
      // #6 has a refused Decision and a later allowed one: it counts once, as allowed.
      allowed: { value: 1 },
      refused: { value: 1 },
    });
    expect(c.team).toEqual({ briefs: { value: 1 }, wallets: { value: 1 }, persuaded: { value: 1 }, allowed: { value: 1 }, refused: { value: 0 } });
    expect(c.all).toEqual({ briefs: 6, wallets: 4 });
    expect(c.hidden).toBe(0);
  });

  it("still counts a hidden brief", () => {
    const c = weighingCounts(sources({ hidden: [1] }));
    expect(c.outside.briefs).toEqual({ value: 5 });
    expect(c.outside.refused).toEqual({ value: 1 });
    expect(c.hidden).toBe(1);
  });

  it("gives 0, not a dash, for every counter when there is no brief, whatever the sources say", () => {
    for (const over of [{}, { journal: { state: "absent" } }, { journal: { state: "reading" } }, { verdicts: { state: "reading" } }, { team: { state: "error", message: "x" } }] as Partial<WeighingSources>[]) {
      const c = weighingCounts(sources({ ...over, briefs: [] }));
      const zero = { briefs: { value: 0 }, wallets: { value: 0 }, persuaded: { value: 0 }, allowed: { value: 0 }, refused: { value: 0 } };
      expect(c.outside).toEqual(zero);
      expect(c.team).toEqual(zero);
    }
  });

  it("says why a counter has no number when its source is missing", () => {
    expect(weighingCounts(sources({ journal: { state: "absent" } })).outside.persuaded).toEqual({ missing: "no journal yet" });
    expect(weighingCounts(sources({ journal: { state: "error", message: "x" } })).team.persuaded).toEqual({ missing: "journal not read" });
    expect(weighingCounts(sources({ journal: { ...read.journal, complete: false } })).outside.persuaded).toEqual({ missing: "incomplete" });
    expect(weighingCounts(sources({ journal: { state: "reading" } })).outside.persuaded).toEqual({ reading: true });
    const v = weighingCounts(sources({ verdicts: { state: "error", message: "x" } }));
    expect([v.outside.allowed, v.outside.refused]).toEqual([{ missing: "not read" }, { missing: "not read" }]);
    const partial = weighingCounts(sources({ verdicts: { ...read.verdicts, complete: false } }));
    expect(partial.team.allowed).toEqual({ missing: "incomplete" });
    // Without the team set, no line can be split, so no number of either line is given; the logs' totals still are.
    const t = weighingCounts(sources({ team: { state: "error", message: "x" } }));
    expect(Object.values(t.outside)).toEqual(Array(5).fill({ missing: "team set not read" }));
    expect(Object.values(t.team)).toEqual(Array(5).fill({ missing: "team set not read" }));
    expect(t.all).toEqual({ briefs: 6, wallets: 4 });
    expect(weighingCounts(sources({ team: { ...read.team, complete: false } })).outside.briefs).toEqual({ missing: "incomplete" });
    expect(weighingCounts(sources({ team: { state: "reading" } })).outside.briefs).toEqual({ reading: true });
  });
});

describe("briefVerdicts and readBriefVerdicts: the brief-keyed Decision logs", () => {
  const EXECUTOR: Address = getAddress("0x9bC6E49d42e0659f3ef667B09B67506B348e115A");
  const blob = (q: string) => VECTORS.V5.blob.replace('"q":[7]', `"q":${q}`);
  // Decision n is in block 200 + n. 1: brief-driven, refused; 2: brief-driven, allowed, adopting two briefs; 3: the
  // owner by hand with a q blob; 4: a probe; 5: the agent's own intent; 6: a q blob whose hash is not the Decision's.
  const logs: CachedLog[] = [
    decisionLog(1, 201n, { reason: "MARKET_CLOSED", rationaleHash: hashOf(blob("[1]")) }),
    decisionLog(2, 202n, { rationaleHash: hashOf(blob("[2,4]")) }),
    decisionLog(3, 203n, { rationaleHash: hashOf(blob("[5]")) }),
    decisionLog(4, 204n, { rationaleHash: VECTORS.V4.hash }),
    decisionLog(5, 205n, { rationaleHash: VECTORS.V1.hash }),
    decisionLog(6, 206n, { reason: "SIZE_LIMIT", rationaleHash: hash32(66) }),
  ];
  const txs: Record<string, TxInput> = {
    [hash32(1)]: { from: EXECUTOR, to: FAKE_VAULT, input: txInput(blob("[1]")) },
    [hash32(2)]: { from: EXECUTOR, to: FAKE_VAULT, input: txInput(blob("[2,4]")) },
    [hash32(3)]: { from: OWNER, to: FAKE_VAULT, input: txInput(blob("[5]")) },
    [hash32(4)]: { from: EXECUTOR, to: FAKE_VAULT, input: txInput(VECTORS.V4.blob) },
    [hash32(5)]: { from: EXECUTOR, to: FAKE_VAULT, input: txInput(VECTORS.V1.blob) },
    [hash32(6)]: { from: EXECUTOR, to: FAKE_VAULT, input: txInput(blob("[6]"), { rationaleHash: hash32(66) }) },
  };

  it("keys only brief-driven Decisions whose blob hashes to their rationaleHash, by each brief id their q cites", () => {
    const decisions = toMainnetDecisions(decodeVaultLogs(logs), { blockTimes: {}, gasUsed: {}, decimals: {}, usdc: FAKE_USDC });
    const trails = decisionTrails(decisions, new Map(Object.entries(txs)), { vault: FAKE_VAULT, owner: OWNER, complete: true });
    const by = briefVerdicts(decisions, trails);
    expect([...by.keys()].sort()).toEqual([1, 2, 4]);
    expect(by.get(1)).toEqual([{ txHash: hash32(1), blockNumber: 201n, logIndex: 0, allowed: false, reason: "MARKET_CLOSED", q: [1] }]);
    expect(by.get(2)).toEqual([{ txHash: hash32(2), blockNumber: 202n, logIndex: 0, allowed: true, reason: "OK", q: [2, 4] }]);
    expect(by.get(4)).toEqual(by.get(2));
  });

  const client = (over: Partial<Record<string, unknown>> = {}) => {
    const fake = fakeLedgerClient({ head: 300n, logs, txs });
    return {
      ...fake,
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "owner") return OWNER;
        throw new Error(`unexpected readContract ${functionName}`);
      },
      ...over,
    } as unknown as LedgerClient & { logCalls: { from: bigint; to: bigint }[] };
  };

  it("reads the vault's Decision logs from the first brief's block, and each Decision's transaction", async () => {
    const c = client();
    const r = await readBriefVerdicts(c, { vault: FAKE_VAULT, from: 150n, head: 300n });
    expect(r.complete).toBe(true);
    expect([...r.byBrief.keys()].sort()).toEqual([1, 2, 4]);
    expect(c.logCalls).toEqual([{ from: 150n, to: 300n }]);
  });

  it("is incomplete when a Decision's transaction cannot be read, and keeps the Decisions it could read", async () => {
    const fake = client();
    const c = client({
      getTransaction: async ({ hash }: { hash: Hash }) => {
        if (hash === hash32(2)) throw new TypeError("Failed to fetch");
        return fake.getTransaction({ hash });
      },
    });
    const r = await readBriefVerdicts(c, { vault: FAKE_VAULT, from: 150n, head: 300n });
    expect(r.complete).toBe(false);
    expect([...r.byBrief.keys()]).toEqual([1]);
  });

  it("throws when the vault's owner cannot be read, since no Decision can be labelled without it", async () => {
    const c = client({ readContract: async () => Promise.reject(new Error("execution reverted")) });
    await expect(readBriefVerdicts(c, { vault: FAKE_VAULT, from: 150n, head: 300n })).rejects.toThrow();
  });
});

describe("BriefFeed renders each weighing in order, as plain text", () => {
  it("shows #N and the sender, the team mark, the brief, the reply with its journal row, the persuasion and the verdict, in that order", () => {
    render(<BriefFeed items={weighings(sources())} />);
    const list = screen.getByRole("list", { name: "Briefs" });
    const item = (id: number) => list.querySelector<HTMLElement>(`[data-brief-id="${id}"]`)!;
    const slots = (id: number) => [...item(id).querySelectorAll("[data-weighing]")].map((el) => el.getAttribute("data-weighing"));
    expect(slots(1)).toEqual(["head", "brief", "reply", "persuaded", "verdict"]);
    expect(item(1).querySelector('[data-weighing="head"]')).toHaveTextContent("#1 · 0x0000…11cE");
    expect(item(1).querySelector('[data-weighing="head"]')).not.toHaveTextContent("team");
    expect(item(3).querySelector('[data-weighing="head"]')).toHaveTextContent("#3 · 0x3c3a…1D6a · team");
    expect(item(1).querySelector('[data-weighing="reply"]')).toHaveTextContent("Maat's agent replied: Adopted: a 40 USD NVDAc buy fits the policy.");
    expect(item(1).querySelector("[data-journal-row]")).toHaveTextContent("journal 2026-11-30.jsonl line 1 · agent commit 0123456");
    expect(item(1).querySelector('[data-weighing="persuaded"]')).toHaveTextContent("Claude persuaded: yes, adopted into an intent");
    expect(item(1).querySelector('[data-weighing="verdict"]')).toHaveTextContent(
      "Vault's verdict: Refused · Market closed (MARKET_CLOSED) · Decision 0x0000…0001 · block 1,001",
    );
    expect(item(1).querySelector('[data-weighing="verdict"]')).toHaveAttribute("data-verdict", "refused");
    expect(item(4).querySelector('[data-weighing="reply"]')).toHaveTextContent("Maat's agent: no reply yet.");
    expect(item(4).querySelector('[data-weighing="verdict"]')).toHaveTextContent("Vault's verdict: not weighed yet");
    expect(item(2).querySelector('[data-weighing="verdict"]')).toHaveTextContent(/^Vault's verdict: none, no intent took it to the vault$/);
    expect(item(6).querySelectorAll('[data-weighing="verdict"]')).toHaveLength(2);
    expect(list.textContent).not.toMatch(/Maat replied/);
    expect(list.querySelectorAll("a, [href]")).toHaveLength(0);
  });
});

describe("BriefCounters", () => {
  it("shows every counter as a number, zero as 0, with the team on its own line", () => {
    render(<BriefCounters counts={weighingCounts(sources())} />);
    const expected: Record<string, string> = {
      "count-briefs": "5",
      "count-wallets": "3",
      "count-persuaded": "2",
      "count-allowed": "1",
      "count-refused": "1",
      "count-team-briefs": "1",
      "count-team-wallets": "1",
      "count-team-persuaded": "1",
      "count-team-allowed": "1",
      "count-team-refused": "0",
    };
    for (const [id, text] of Object.entries(expected)) expect(screen.getByTestId(id), id).toHaveTextContent(new RegExp(`^${text}$`));
    expect(screen.getByRole("group", { name: "Team briefs, counted on their own line" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/not available yet|value moved outside the mandate/i);
  });

  it("shows 0 for every counter when there is no brief", () => {
    render(<BriefCounters counts={weighingCounts(sources({ briefs: [] }))} />);
    for (const el of screen.getAllByTestId(/^count-/)) expect(el).toHaveTextContent(/^0$/);
  });

  it("says why a counter has no number, and an ellipsis while the briefs are read", () => {
    const { unmount } = render(<BriefCounters counts={weighingCounts(sources({ journal: { state: "absent" } }))} />);
    expect(screen.getByTestId("count-persuaded")).toHaveTextContent("no journal yet");
    expect(screen.getByText(/The agent's journal is not published yet, so Claude persuaded has no source\./)).toBeInTheDocument();
    unmount();
    render(<BriefCounters counts={null} />);
    for (const el of screen.getAllByTestId(/^count-/)) expect(el).toHaveTextContent("…");
  });

  it("counts a hidden brief and says so", () => {
    render(<BriefCounters counts={weighingCounts(sources({ hidden: [2] }))} />);
    expect(screen.getByText("1 brief is hidden from the feed by the owner; it still counts.")).toBeInTheDocument();
  });
});

describe("the feed renders hostile text inertly", () => {
  it("shows HTML and a link in a brief and in a reply as text", () => {
    const hostile = [brief(1, ALICE, '<a href="https://evil.example">x</a><img src=x onerror="alert(1)">')];
    const answers = new Map<number, BriefAnswer>([[1, { outcome: "replied", reply: "<b>[link](https://evil.example)</b>", adopted: false, row: row(1) }]]);
    render(<BriefFeed items={weighings(sources({ briefs: hostile, journal: { state: "read", answers, complete: true } }))} />);
    const list = screen.getByRole("list", { name: "Briefs" });
    expect(list.querySelectorAll("a, img, b, [href], [src], [onerror]")).toHaveLength(0);
    expect(within(list).getByText('<a href="https://evil.example">x</a><img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(list.querySelector('[data-weighing="reply"]')).toHaveTextContent("Maat's agent replied: <b>[link](https://evil.example)</b>");
  });
});
