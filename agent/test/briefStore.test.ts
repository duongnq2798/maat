import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { briefKey, type Brief } from "../src/briefs/inbox.js";
import { Store } from "../src/ledger/store.js";
import { FakeInbox, SENDERS } from "./fakes/fakeInbox.js";

const brief = (id: number, block: bigint): Brief => ({ id, from: SENDERS[0]!, text: "x", block, txHash: FakeInbox.txOf(id), logIndex: 0 });

describe("Store: briefs", () => {
  it("opens a state.json older code wrote, with no brief record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-store-"));
    await writeFile(join(dir, "state.json"), JSON.stringify({ version: 1, compute: {}, paidUsd6: "0", refusals: {}, txByDay: {}, pending: [] }));
    const s = await Store.open(dir);
    expect(s.briefFrom()).toBeUndefined();
    expect(s.briefsDone()).toEqual([]);
    expect(s.briefDay(20_000n)).toEqual({ sent: 0, senders: {}, txs: 0, llmUsd6: 0n });
  });

  it("keeps each decided brief under its identity, and its day's counts, across a restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-store-"));
    const s = await Store.open(dir);
    const b = brief(7, 70n);
    s.recordBrief(b, "started");
    s.recordBriefSent(20_000n, SENDERS[0]!);
    s.recordBriefTx(20_000n);
    s.recordBriefLlm(20_000n, 12_345n);
    s.setBriefFrom(91n);
    await s.save();

    const again = await Store.open(dir);
    expect(again.briefOutcome(briefKey(b))).toBe("started");
    expect(again.briefFrom()).toBe(91n);
    expect(again.briefDay(20_000n)).toEqual({ sent: 1, senders: { [SENDERS[0]!.toLowerCase()]: 1 }, txs: 1, llmUsd6: 12_345n });
    expect(again.briefsDone()).toEqual([{ key: briefKey(b), id: 7, from: SENDERS[0], txHash: b.txHash, logIndex: 0, block: "70", outcome: "started" }]);
    expect(JSON.parse(await readFile(join(dir, "state.json"), "utf8")).briefs.from).toBe("91");
  });

  it("forgets the briefs below the next read's first block, but never one Claude may still be answering", async () => {
    const s = await Store.open(await mkdtemp(join(tmpdir(), "maat-store-")));
    s.recordBrief(brief(1, 60n), "replied");
    s.recordBrief(brief(2, 61n), "started");
    s.recordBrief(brief(3, 95n), "skipped");
    s.setBriefFrom(91n);
    expect(s.briefsDone().map((r) => [r.id, r.outcome])).toEqual([
      [2, "started"],
      [3, "skipped"],
    ]);
  });

  it("forgets one brief whose log no longer exists", async () => {
    const s = await Store.open(await mkdtemp(join(tmpdir(), "maat-store-")));
    const b = brief(4, 80n);
    s.recordBrief(b, "replied");
    s.forgetBrief(briefKey(b));
    expect(s.briefOutcome(briefKey(b))).toBeUndefined();
  });
});
