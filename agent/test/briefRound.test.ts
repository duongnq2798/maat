import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { toHex, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { briefKey } from "../src/briefs/inbox.js";
import { MAX_BRIEF_TX_PER_DAY, MAX_BRIEFS_PER_DAY } from "../src/briefs/caps.js";
import { Store } from "../src/ledger/store.js";
import { decodeExecuteInput } from "../src/rationale/calldata.js";
import { verifyDecision } from "../src/rationale/verify.js";
import { EXECUTOR } from "./fakes/fakeChain.js";
import { FakeInbox, INBOX, SENDERS } from "./fakes/fakeInbox.js";
import { adoptAll, BriefModel, briefRig, DAY, MODEL, ok, sender } from "./fakes/briefRound.js";
import { main as verifyMain } from "../scripts/verify-decision.js";

const OWNER = "0x3c3a66f713DAE7e4A03Bbd81dB79FF65F42C1D6a";
/** A brief posted after a round: one block past the safe block, which then moves up to it. */
const next = (inbox: FakeInbox, id: number, from: `0x${string}`, text: string) => {
  inbox.safe += 1n;
  inbox.brief(id, from, text, inbox.safe);
};
const post = (inbox: FakeInbox, n: number, o: { from?: (i: number) => `0x${string}`; first?: number; block?: bigint } = {}) => {
  for (let i = 0; i < n; i++) inbox.brief((o.first ?? 1) + i, (o.from ?? sender)(i), `brief number ${(o.first ?? 1) + i}`, (o.block ?? 60n) + BigInt(i));
};

describe("the round cap: at most 3 briefs a round", () => {
  it("sends the first 3 to Claude and keeps the 4th, unjournaled, for the next round", async () => {
    const t = await briefRig({ mode: "dry-run" });
    post(t.inbox, 4);
    await t.round(1);
    expect(t.model.seen()).toEqual([[1, 2, 3]]);
    expect((await t.briefRows()).map((r) => [r.briefId, r.outcome])).toEqual([
      [1, "replied"],
      [2, "replied"],
      [3, "replied"],
    ]);
    expect(t.store.briefFrom()).toBe(63n); // brief 4's block: the next read starts there
    await t.round(2);
    expect(t.model.seen()).toEqual([[1, 2, 3], [4]]);
    expect((await t.briefRows()).map((r) => r.briefId)).toEqual([1, 2, 3, 4]);
  });
});

// Eight rounds write their journal to disk: well under the timeout alone, but past the 5 s default on a loaded machine.
describe("the day cap: at most 20 briefs a UTC day", { timeout: 30_000 }, () => {
  it("journals the 21st and 22nd as skipped with the cap's name, and never sends them to Claude", async () => {
    const t = await briefRig({ mode: "dry-run" });
    post(t.inbox, 22);
    for (let n = 1; n <= 8; n++) await t.round(n);
    const seen = t.model.seen().flat();
    expect(seen).toEqual(Array.from({ length: MAX_BRIEFS_PER_DAY }, (_, i) => i + 1));
    const skipped = (await t.briefRows()).filter((r) => r.outcome === "skipped");
    expect(skipped.map((r) => [r.briefId, r.cap])).toEqual([
      [21, "briefs-per-day"],
      [22, "briefs-per-day"],
    ]);
    expect(t.store.briefDay(DAY).sent).toBe(20);
  });

  it("counts the UTC day of the round's state block: yesterday's 20 do not cap today", async () => {
    const t = await briefRig({ mode: "dry-run" });
    for (let i = 0; i < 20; i++) t.store.recordBriefSent(DAY - 1n, sender(i));
    post(t.inbox, 1);
    await t.round(1);
    expect(t.model.seen()).toEqual([[1]]);
  });
});

describe("the sender cap: at most 2 briefs per sender a UTC day", () => {
  it("skips a sender's third brief with the cap's name and still sends another sender's", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.inbox.brief(1, SENDERS[0]!, "one", 60n);
    t.inbox.brief(2, SENDERS[0]!, "two", 61n);
    t.inbox.brief(3, SENDERS[0]!, "three", 62n);
    t.inbox.brief(4, SENDERS[1]!, "four", 63n);
    await t.round(1);
    expect(t.model.seen()).toEqual([[1, 2, 4]]);
    expect((await t.briefRows()).map((r) => [r.briefId, r.outcome, r.cap])).toEqual([
      [3, "skipped", "briefs-per-sender"],
      [1, "replied", undefined],
      [2, "replied", undefined],
      [4, "replied", undefined],
    ]);
    expect(t.model.inputs[0]!.briefs!.map((b) => b.text)).not.toContain("three");
  });

  it("counts a sender by address, whatever its case", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.store.recordBriefSent(DAY, SENDERS[2]!.toUpperCase().replace("0X", "0x"));
    t.store.recordBriefSent(DAY, SENDERS[2]!.toLowerCase());
    t.inbox.brief(1, SENDERS[2]!, "again", 60n);
    await t.round(1);
    expect(t.model.seen()).toEqual([[]]);
    expect((await t.briefRows())[0]).toMatchObject({ briefId: 1, outcome: "skipped", cap: "briefs-per-sender" });
  });
});

describe("the brief budget: transactions", { timeout: 30_000 }, () => {
  it("sends at most 5 brief-driven transactions a UTC day, then journals briefs as skipped", async () => {
    const t = await briefRig({ model: new BriefModel(adoptAll) });
    post(t.inbox, 7);
    await t.round(1);
    expect(t.inner.sent).toHaveLength(3);
    await t.round(2);
    expect(t.inner.sent).toHaveLength(MAX_BRIEF_TX_PER_DAY);
    const rows = await t.journal.read();
    expect(rows.filter((r) => r.kind === "intent" && r.runId === "run-2").map((r) => r.kind === "intent" && r.gate)).toEqual([
      "execute",
      "execute",
      `brief budget: ${MAX_BRIEF_TX_PER_DAY} brief-driven transactions sent on UTC day ${DAY}`,
    ]);
    await t.round(3);
    expect(t.model.seen()).toEqual([[1, 2, 3], [4, 5, 6], []]);
    expect((await t.briefRows()).at(-1)).toMatchObject({ briefId: 7, outcome: "skipped", cap: "brief-txs-per-day" });
    expect(t.store.briefDay(DAY).txs).toBe(5);
    expect(t.store.txCount(DAY)).toBe(5);
  });

  it("counts brief-driven transactions inside MAAT_MAX_TX_PER_DAY", async () => {
    const t = await briefRig({ model: new BriefModel(adoptAll), maxTxPerDay: 2 });
    post(t.inbox, 3);
    const r = await t.round(1);
    expect(r).toMatchObject({ status: "halted", haltReason: "daily tx cap 2 reached" });
    expect(t.inner.sent).toHaveLength(2);
  });
});

describe("the brief budget: Claude spend", { timeout: 30_000 }, () => {
  it("stops sending briefs once the rounds that carried them spent $0.25 on the UTC day", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.model.answer = (i) => ok({ costUsd6: 100_000n, replies: (i.briefs ?? []).map((b) => ({ id: b.id, text: "ok" })) });
    t.inbox.brief(1, sender(1), "a", 60n);
    await t.round(1);
    next(t.inbox, 2, sender(2), "b");
    await t.round(2);
    next(t.inbox, 3, sender(3), "c");
    await t.round(3);
    expect(t.store.briefDay(DAY).llmUsd6).toBe(300_000n); // the call that crosses $0.25 is the day's last with briefs
    next(t.inbox, 4, sender(4), "d");
    await t.round(4);
    expect(t.model.seen()).toEqual([[1], [2], [3], []]);
    expect(t.model.inputs[3]).not.toHaveProperty("briefs");
    expect((await t.briefRows()).at(-1)).toMatchObject({ briefId: 4, outcome: "skipped", cap: "brief-llm-per-day" });
  });

  it("skips briefs, naming the daily Claude cap, once MAAT_MAX_LLM_USD_PER_DAY stops the round's call", async () => {
    const t = await briefRig({ mode: "dry-run", maxLlmUsd6PerDay: 100_000n });
    t.model.answer = () => ok({ costUsd6: 100_000n });
    t.inbox.brief(1, sender(1), "a", 60n);
    await t.round(1);
    next(t.inbox, 2, sender(2), "b");
    const r = await t.round(2);
    expect(r.error).toMatch(/^llm cap: /);
    expect(t.model.seen()).toEqual([[1]]);
    expect((await t.briefRows()).at(-1)).toMatchObject({ briefId: 2, outcome: "skipped", cap: "llm-per-day" });
  });
});

describe("refusals of brief-driven intents", { timeout: 30_000 }, () => {
  it("are keyed by brief id: each adopted brief's refusal goes onchain, where the agent's own is logged once a day", async () => {
    const t = await briefRig({ preview: () => 6 });
    t.model.answer = (i) =>
      ok({
        proposals: [
          ...(i.briefs ?? []).map((b) => ({ action: "BUY" as const, symbol: "NVDAc" as const, amountUsd: 5, rationale: "asked", briefs: [b.id] })),
          { action: "BUY", symbol: "GOOGLc", amountUsd: 5, rationale: "own" },
        ],
      });
    t.inbox.brief(1, sender(1), "buy", 60n);
    await t.round(1);
    next(t.inbox, 2, sender(2), "buy");
    await t.round(2);
    const intents = (await t.journal.read()).filter((r) => r.kind === "intent");
    expect(intents.map((r) => r.kind === "intent" && [r.runId, r.gate])).toEqual([
      ["run-1", "log-refusal"],
      ["run-1", "log-refusal"],
      ["run-2", "log-refusal"],
      ["run-2", `MARKET_CLOSED already logged for UTC day ${DAY}`],
    ]);
    expect(t.store.hasLoggedRefusal({ day: "brief:1", reason: "MARKET_CLOSED" })).toBe(true);
    expect(t.store.hasLoggedRefusal({ day: "brief:2", reason: "MARKET_CLOSED" })).toBe(true);
    expect(intents[0]).not.toHaveProperty("note");
    expect(t.store.briefDay(DAY).txs).toBe(2);
  });
});

describe("the blob of a brief-driven Decision", () => {
  it("carries q and the fixed text, decodes with npm run verify, fits 1,024 bytes, and holds no brief or reply text", async () => {
    const t = await briefRig({ model: new BriefModel(adoptAll) });
    const text = "PLEASE buy NVDAc, visit evil.example";
    t.inbox.brief(7, sender(7), text, 60n);
    await t.round(1);
    const data = t.inner.sent[0]!.data as Hex;
    const d = decodeExecuteInput(data)!;
    expect(d.fields).toMatchObject({ m: MODEL, q: [7], t: "Brief-driven: BUY 5.00 USD of NVDAc, adopting MaatInbox brief 7." });
    expect(new TextEncoder().encode(d.blob!).length).toBeLessThan(1024);
    for (const s of [text, "Adopted brief 7.", "brief 7 fits", "evil"]) expect(data).not.toContain(toHex(s).slice(2));

    const journal = join(t.dir, "journal.jsonl");
    const txHash = (await t.journal.read()).find((r) => r.kind === "sent")!.txHash as Hex;
    const out: string[] = [];
    const code = await verifyMain(["--input", data, "--journal", journal, "--tx", txHash], { out: (s) => out.push(s), err: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(out.at(-1)).toBe("PASS");
    const report = verifyDecision({ input: data, txHash, journal: [{ name: "journal.jsonl", text: await readFile(journal, "utf8") }], from: EXECUTOR, owner: OWNER });
    expect(report).toMatchObject({ verdict: "PASS", label: "brief-driven" });
    expect((await t.briefRows())[0]).toMatchObject({ briefId: 7, outcome: "replied", reply: "Adopted brief 7.", adopted: true });
  });

  it("drops an intent that adopts a brief this round did not send, or one an earlier intent adopted", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.model.answer = () =>
      ok({
        proposals: [
          { action: "BUY", symbol: "NVDAc", amountUsd: 5, rationale: "x", briefs: [99] },
          { action: "BUY", symbol: "NVDAc", amountUsd: 5, rationale: "x", briefs: [1] },
          { action: "BUY", symbol: "GOOGLc", amountUsd: 5, rationale: "x", briefs: [1] },
          { action: "BUY", symbol: "AAPLc", amountUsd: 5, rationale: "x", briefs: [2, 1] },
        ],
      });
    t.inbox.brief(1, sender(1), "a", 60n);
    t.inbox.brief(2, sender(2), "b", 61n);
    await t.round(1);
    const rows = await t.journal.read();
    expect(rows.filter((r) => r.kind === "skip").map((r) => r.kind === "skip" && [r.index, r.error])).toEqual([
      [0, "adopts brief 99, which this round did not send to Claude"],
      [2, "adopts brief 1, which an earlier intent of this answer adopted"],
      [3, "adopts brief 1, which an earlier intent of this answer adopted"],
    ]);
    expect(rows.filter((r) => r.kind === "intent").map((r) => r.kind === "intent" && r.index)).toEqual([1]);
    expect((await t.briefRows()).map((r) => [r.briefId, r.adopted])).toEqual([
      [1, true],
      [2, undefined],
    ]);
  });
});

describe("replies", () => {
  it("are journaled sanitized and cut to 200 characters; a brief with no usable reply is unanswered", async () => {
    const t = await briefRig({ mode: "dry-run" });
    const long = `See https://evil.example now. ${"word ".repeat(80)}`;
    t.model.answer = () =>
      ok({
        replies: [
          { id: 1, text: long },
          { id: 2, text: "   " },
          { id: 1, text: "a second reply to brief 1" },
          { id: 9, text: "to a brief never sent" },
        ],
      });
    post(t.inbox, 3);
    await t.round(1);
    const rows = await t.briefRows();
    expect(rows.map((r) => [r.briefId, r.outcome])).toEqual([
      [1, "replied"],
      [2, "unanswered"],
      [3, "unanswered"],
    ]);
    expect(rows[0]!.reply!.length).toBeLessThanOrEqual(200);
    expect(rows[0]!.reply).toMatch(/^See \[url\] now\. word word .* \.\.\.$/);
    expect(rows[2]).toMatchObject({ note: "Claude gave no reply" });
  });

  it("journals every brief as unanswered when the call failed, and spends it: it is not sent again", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.model.answer = () => ({ ok: false, error: "claude: overloaded", costUsd6: 0n });
    post(t.inbox, 1);
    await t.round(1);
    expect((await t.briefRows())[0]).toMatchObject({ briefId: 1, outcome: "unanswered", note: "no answer: claude: overloaded" });
    await t.round(2);
    expect(t.model.seen()).toEqual([[1], []]);
  });
});

describe("brief identity, the safe block and restarts", () => {
  it("reads Brief logs only up to the safe block, in windowed getLogs from the inbox's deploy block", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.inbox.safe = 20_000n;
    t.inbox.brief(1, sender(1), "below safe", 19_000n);
    t.inbox.brief(2, sender(2), "above safe", 20_001n);
    await t.round(1);
    expect(t.inbox.blockTags).toEqual(["safe"]);
    expect(t.inbox.queries.map((q) => [q.address, q.fromBlock, q.toBlock])).toEqual([
      [INBOX, 50n, 9_049n],
      [INBOX, 9_050n, 18_049n],
      [INBOX, 18_050n, 20_000n],
    ]);
    expect(t.model.seen()).toEqual([[1]]);
    expect(t.store.briefFrom()).toBe(20_001n);
  });

  it("answers a brief a reorg re-mined under another tx as a new brief, and forgets the one whose log is gone", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.inbox.brief(1, sender(1), "a", 60n);
    t.inbox.brief(2, sender(2), "b", 61n);
    t.inbox.brief(3, sender(3), "c", 62n);
    t.inbox.brief(4, sender(4), "d", 63n);
    await t.round(1); // 1, 2, 3 answered; 4 waits from block 63
    t.inbox.drop(4);
    t.inbox.brief(4, sender(5), "d again", 64n, 0, 1);
    await t.round(2);
    expect(t.model.seen()).toEqual([[1, 2, 3], [4]]);
    expect(t.model.inputs[1]!.briefs![0]!.text).toBe("d again");
    const rows = await t.briefRows();
    expect(rows.at(-1)).toMatchObject({ briefId: 4, txHash: FakeInbox.txOf(4, 1), logIndex: 0, block: "64" });
  });

  it("forgets a decided brief whose log is gone from the window it reads again", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.inbox.brief(1, sender(1), "a", 60n);
    t.inbox.brief(2, sender(2), "b", 60n, 1);
    t.inbox.brief(3, sender(3), "c", 60n, 2);
    t.inbox.brief(4, sender(4), "d", 60n, 3);
    await t.round(1); // 4 waits in block 60, so block 60 is read again
    const two = { id: 2, from: sender(2), text: "b", block: 60n, txHash: FakeInbox.txOf(2), logIndex: 1 };
    expect(t.store.briefOutcome(briefKey(two))).toBe("replied");
    t.inbox.drop(2);
    await t.round(2);
    expect(t.store.briefOutcome(briefKey(two))).toBeUndefined();
    expect(t.model.seen()).toEqual([[1, 2, 3], [4]]);
  });

  it("resumes from state.json after a restart without answering a brief twice", async () => {
    const t = await briefRig({ mode: "dry-run" });
    post(t.inbox, 4);
    await t.round(1);
    const again = await briefRig({ mode: "dry-run", dir: t.dir, inbox: t.inbox });
    await again.round(2);
    await again.round(3);
    expect([...t.model.seen(), ...again.model.seen()]).toEqual([[1, 2, 3], [4], []]);
    expect((await again.briefRows()).map((r) => r.briefId)).toEqual([1, 2, 3, 4]);
  });

  it("journals a brief Claude was answering when the agent stopped as unanswered, and never sends it again", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.model.answer = () => {
      throw new Error("process killed");
    };
    post(t.inbox, 1);
    expect((await t.round(1)).status).toBe("halted");
    const again = await briefRig({ mode: "dry-run", dir: t.dir, inbox: t.inbox });
    await again.round(2);
    expect(again.model.seen()).toEqual([[]]);
    expect((await again.briefRows()).map((r) => [r.runId, r.briefId, r.outcome, r.note])).toEqual([
      ["run-2", 1, "unanswered", "the agent stopped before Claude's answer was journaled"],
    ]);
    // Decided, and below where the next read starts: the store no longer holds it, and no read reaches it again.
    expect(again.store.briefOutcome(briefKey({ id: 1, txHash: FakeInbox.txOf(1), logIndex: 0 }))).toBeUndefined();
    expect(again.store.briefFrom()).toBe(91n);
  });

  it("journals a failed read and goes on with the round, without briefs", async () => {
    const t = await briefRig({ mode: "dry-run" });
    t.inbox.fail = new Error("rpc down");
    post(t.inbox, 1);
    const r = await t.round(1);
    expect(r.status).toBe("done");
    expect(t.model.inputs[0]).not.toHaveProperty("briefs");
    expect((await t.journal.read()).find((x) => x.kind === "error")).toMatchObject({ message: "briefs not read: rpc down" });
    expect(t.store.briefFrom()).toBeUndefined();
  });
});

describe("no MaatInbox recorded", () => {
  it("reads no inbox log, sends no brief and journals no brief row", async () => {
    const t = await briefRig({ mode: "dry-run", briefs: false });
    post(t.inbox, 3);
    await t.round(1);
    expect(t.inbox.blockTags).toEqual([]);
    expect(t.inbox.queries).toEqual([]);
    expect(t.inbox.deployTxReads).toBe(0);
    expect(t.model.inputs[0]).not.toHaveProperty("briefs");
    expect(await t.briefRows()).toEqual([]);
    expect(JSON.parse(await readFile(join(t.dir, "state.json"), "utf8")).briefs).toEqual({ done: {}, days: {} });
  });

  it("keeps a state.json without briefs readable by a Store", async () => {
    const t = await briefRig({ mode: "dry-run", briefs: false });
    await t.round(1);
    expect((await Store.open(t.dir)).briefFrom()).toBeUndefined();
  });
});
