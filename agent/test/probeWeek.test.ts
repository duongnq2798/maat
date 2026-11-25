import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { size } from "viem";
import { describe, expect, it } from "vitest";
import { builderSuffix } from "../src/exec/builderCode.js";
import { GuardedSender } from "../src/exec/sender.js";
import { Journal, type JournalRow } from "../src/ledger/journal.js";
import { Store } from "../src/ledger/store.js";
import type { Proposer, ProposerInput, ProposerOutput } from "../src/llm/proposer.js";
import { RoundLock } from "../src/loop/lock.js";
import { probeStartup, runProbe, runProbes } from "../src/loop/probeRound.js";
import { BILL_MIN_USD6, runOnce, type RunDeps } from "../src/loop/runOnce.js";
import { runForever } from "../src/loop/scheduler.js";
import { probeIso } from "../src/probes.js";
import { decodeExecuteInput } from "../src/rationale/calldata.js";
import { FakeClock, reasonByCalendar, sceneAt } from "./fakes/clockScene.js";
import { EXECUTOR, VAULT } from "./fakes/fakeChain.js";
import { FakeReceipts } from "./fakes/fakeReceipts.js";
import { FakeSender } from "./fakes/fakeSender.js";

const MAAT_PROBES = "2026-11-26T14:31:00Z,2026-11-27T17:58:00Z,2026-11-27T18:01:00Z";
const START = "2026-11-25T00:00:00Z";
const END = "2026-12-01T00:00:00Z";
const SUFFIX = builderSuffix("bc_maattest");
const HOLD: ProposerOutput = { ok: true, summary: "hold", proposals: [], costUsd6: 0n, model: "fake" };

/**
 * The agent as main.ts runs it, from Wednesday 25 November 00:00 UTC to Tuesday 1 December 00:00 UTC on a fake clock:
 * runForever's rounds and runProbes beside it, sharing one RoundLock. The clock moves only when every task is asleep
 * or waiting for the lock. The preview and the vault's verdict follow MarketCalendar at the clock.
 */
async function week(proposerFor: (clock: FakeClock) => Proposer) {
  const dir = await mkdtemp(join(tmpdir(), "maat-week-"));
  const clock = new FakeClock(START);
  const scene = sceneAt(clock.now);
  const inner = new FakeSender(EXECUTOR);
  const receipts = new FakeReceipts(inner, VAULT, size(SUFFIX));
  receipts.verdict = () => {
    const r = reasonByCalendar(clock.now)();
    return { allowed: r === 0, reason: r };
  };
  const journal = new Journal(dir, { commit: "0123456789abcdef0123456789abcdef01234567" });
  const deps: RunDeps = {
    vault: VAULT,
    executor: EXECUTOR,
    expensePayee: "0x3333333333333333333333333333333333333333",
    mode: "live",
    defaultDailyComputeUsd6: 500_000n,
    maxTxPerDay: 40,
    billMinUsd6: BILL_MIN_USD6,
    maxLlmUsd6PerDay: 750_000n,
    stateClient: scene.client(),
    previewClient: { readContract: (async () => reasonByCalendar(clock.now)()) as never },
    txClient: receipts.client(),
    proposer: proposerFor(clock),
    sender: new GuardedSender(inner, { vault: VAULT, suffix: SUFFIX }),
    store: await Store.open(dir),
    journal,
    commit: "0123456789abcdef0123456789abcdef01234567",
  };

  const lock = new RoundLock();
  const ac = new AbortController();
  const start = await probeStartup(MAAT_PROBES, deps, clock.now());
  const rounds: string[] = [];
  const logs: string[] = [];
  let live = 2;
  const tasks = [
    runForever({ run: () => (rounds.push(probeIso(clock.now())), runOnce(deps)), signal: ac.signal, lock, sleep: clock.sleep, log: () => {} }),
    runProbes({ due: start.due, fire: (at) => runProbe(deps, at, clock.now), lock, signal: ac.signal, now: clock.now, sleep: clock.sleep, log: (m) => logs.push(m) }),
  ].map((p) => p.finally(() => live--));

  const end = Date.parse(END);
  while (live > 0) {
    await new Promise((r) => setImmediate(r));
    // Someone is still reading, writing or computing: let it finish before the clock moves.
    if (clock.sleepers.length + lock.waiting < live) continue;
    if (Math.min(...clock.sleepers.map((s) => s.until)) >= end) {
      ac.abort();
      continue;
    }
    clock.advance();
  }
  await Promise.all(tasks);

  const rows = await journal.read();
  const probes = rows
    .filter((r): r is Extract<JournalRow, { kind: "probe" }> => r.kind === "probe")
    .map((r) => ({ at: r.at, expected: r.expected, outcome: r.outcome, ...(r.note ? { note: r.note } : {}) }));
  const probeIntents = rows.filter((r): r is Extract<JournalRow, { kind: "intent" }> => r.kind === "intent" && r.runId.startsWith("probe-") && r.decision !== undefined);
  return { start, rounds, logs, probes, probeIntents, rows, inner };
}

const friday = (rounds: string[]) => rounds.filter((r) => r >= "2026-11-27T17:00:00Z" && r < "2026-11-27T19:30:00Z");

// A week of rounds writes some 200 journal rows to disk: well under the timeout, but more than the 5 s default allows.
describe("MAAT_PROBES=2026-11-26T14:31:00Z,2026-11-27T17:58:00Z,2026-11-27T18:01:00Z over 25 to 30 November", { timeout: 30_000 }, () => {
  it("logs the Thanksgiving refusal at 14:31, sends OK at 17:58 and logs MARKET_CLOSED at 18:01", async () => {
    const w = await week(() => ({ propose: async () => HOLD }));
    expect(w.start.problems).toEqual([]);
    expect(w.probes).toEqual([
      { at: "2026-11-26T14:31:00Z", expected: "MARKET_CLOSED", outcome: "sent" },
      { at: "2026-11-27T17:58:00Z", expected: "OK", outcome: "sent" },
      { at: "2026-11-27T18:01:00Z", expected: "MARKET_CLOSED", outcome: "sent" },
    ]);
    expect(w.probeIntents.map((r) => [r.runId, r.action, r.preview, r.gate, r.decision])).toEqual([
      ["probe-2026-11-26T14:31:00Z", "BUY", "MARKET_CLOSED", "log-refusal", { allowed: false, reason: "MARKET_CLOSED" }],
      ["probe-2026-11-27T17:58:00Z", "BUY", "OK", "execute", { allowed: true, reason: "OK" }],
      ["probe-2026-11-27T18:01:00Z", "BUY", "MARKET_CLOSED", "log-refusal", { allowed: false, reason: "MARKET_CLOSED" }],
    ]);
    // Every transaction of the week is a probe's, and carries k = probe.
    expect(w.inner.sent.map((s) => decodeExecuteInput(s.data)?.fields?.k)).toEqual(["probe", "probe", "probe"]);
    // The rounds keep their cadence: every 15 minutes in session, hourly outside it, around the early close too.
    expect(friday(w.rounds)).toEqual([
      "2026-11-27T17:00:00Z",
      "2026-11-27T17:15:00Z",
      "2026-11-27T17:30:00Z",
      "2026-11-27T17:45:00Z",
      "2026-11-27T18:00:00Z",
      "2026-11-27T19:00:00Z",
    ]);
    expect(w.rounds.at(-1)).toBe("2026-11-30T23:00:00Z");
    expect(w.logs).toEqual([
      "probe 2026-11-26T14:31:00Z: sent (expected MARKET_CLOSED), sent 1",
      "probe 2026-11-27T17:58:00Z: sent (expected OK), sent 1",
      "probe 2026-11-27T18:01:00Z: sent (expected MARKET_CLOSED), sent 1",
    ]);
  });

  it("skips the 14:31 probe when a round already logged the holiday refusal that NYSE date", async () => {
    // Rounds propose a BUY only on a holiday: the first Thanksgiving round logs MARKET_CLOSED:holiday.
    const holidayBuyer = (): Proposer => ({
      propose: async ({ state }: ProposerInput) =>
        state.calendar?.holiday ? { ...HOLD, proposals: [{ action: "BUY", symbol: "AAPLc", amountUsd: 5, rationale: "holiday test buy" }] } : HOLD,
    });
    const w = await week(holidayBuyer);
    expect(w.probes).toEqual([
      { at: "2026-11-26T14:31:00Z", expected: "MARKET_CLOSED", outcome: "skipped", note: "MARKET_CLOSED already logged for NYSE date 2026-11-26 (holiday)" },
      { at: "2026-11-27T17:58:00Z", expected: "OK", outcome: "sent" },
      { at: "2026-11-27T18:01:00Z", expected: "MARKET_CLOSED", outcome: "sent" },
    ]);
    const roundLog = w.rows.find((r) => r.kind === "intent" && !r.runId.startsWith("probe-") && r.gate === "log-refusal");
    expect(roundLog).toMatchObject({ symbol: "AAPLc", preview: "MARKET_CLOSED", decision: { allowed: false, reason: "MARKET_CLOSED" } });
    expect(w.inner.sent).toHaveLength(3); // the round's holiday log, then the two Friday probes
  });

  it("skips the 17:58 OK probe, with the reason, when a round holds the lock past 17:59:30 UTC, and still logs 18:01", async () => {
    // The 17:45 round's Claude call takes until 17:59:40, so the 17:58 probe gets the lock 10 s after its deadline.
    const slow = (clock: FakeClock): Proposer => ({
      propose: async () => {
        if (clock.now() === Date.parse("2026-11-27T17:45:00Z")) await clock.sleep(Date.parse("2026-11-27T17:59:40Z") - clock.now());
        return HOLD;
      },
    });
    const w = await week(slow);
    expect(w.probes).toEqual([
      { at: "2026-11-26T14:31:00Z", expected: "MARKET_CLOSED", outcome: "sent" },
      {
        at: "2026-11-27T17:58:00Z",
        expected: "OK",
        outcome: "skipped",
        note: "probe deadline 2026-11-27T17:59:30Z (30 s before the 13:00 ET early close) passed at 2026-11-27T17:59:40Z; an OK probe is never sent late",
      },
      { at: "2026-11-27T18:01:00Z", expected: "MARKET_CLOSED", outcome: "sent" },
    ]);
    expect(w.inner.sent).toHaveLength(2);
    expect(friday(w.rounds)).toEqual(["2026-11-27T17:00:00Z", "2026-11-27T17:15:00Z", "2026-11-27T17:30:00Z", "2026-11-27T17:45:00Z", "2026-11-27T18:14:40Z", "2026-11-27T19:14:40Z"]);
  });
});
