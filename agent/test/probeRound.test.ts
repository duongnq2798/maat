import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, size, toBytes, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf } from "../src/addresses.js";
import { readVaultState } from "../src/chain/state.js";
import { builderSuffix } from "../src/exec/builderCode.js";
import { GuardedSender } from "../src/exec/sender.js";
import { Journal, type JournalRow } from "../src/ledger/journal.js";
import { Store } from "../src/ledger/store.js";
import { FixedProposer } from "../src/llm/proposer.js";
import { probeStartup, runProbe, runProbes, type ProbeReport } from "../src/loop/probeRound.js";
import { RoundLock } from "../src/loop/lock.js";
import { BILL_MIN_USD6, roundKit, runOnce, type RunDeps, type RunReport } from "../src/loop/runOnce.js";
import { PROBE_TEXT_PREFIX } from "../src/rationale/blob.js";
import { decodeExecuteInput } from "../src/rationale/calldata.js";
import { verifyDecision } from "../src/rationale/verify.js";
import { ACTIONS, REASONS, type OnchainIntent, type ReasonName } from "../src/types.js";
import { main as verifyMain } from "../scripts/verify-decision.js";
import { reasonByCalendar as byCalendar, sceneAt } from "./fakes/clockScene.js";
import { CALENDAR, EXECUTOR, VAULT, type FakeChain } from "./fakes/fakeChain.js";
import { FakeReceipts } from "./fakes/fakeReceipts.js";
import { FakeSender } from "./fakes/fakeSender.js";

const PAYEE = "0x3333333333333333333333333333333333333333" as const;
const OWNER: Address = "0x9999999999999999999999999999999999999999";
const SUFFIX = builderSuffix("bc_maattest");
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ms = (iso: string) => Date.parse(iso);
const code = (r: ReasonName) => REASONS.indexOf(r);
const F1758 = "2026-11-27T17:58:00Z";
const F1801 = "2026-11-27T18:01:00Z";
const T1431 = "2026-11-26T14:31:00Z";

async function setup(
  o: {
    clock: string;
    mode?: "dry-run" | "live";
    preview?: (i: OnchainIntent) => number | Promise<number>;
    scene?: (clock: () => number) => FakeChain;
    store?: Store;
    maxTxPerDay?: number;
  },
) {
  const dir = await mkdtemp(join(tmpdir(), "maat-probe-"));
  let now = ms(o.clock);
  const clock = () => now;
  const scene = (o.scene ?? sceneAt)(clock);
  const store = o.store ?? (await Store.open(dir));
  const journal = new Journal(dir, { commit: COMMIT });
  const inner = new FakeSender(EXECUTOR);
  const receipts = new FakeReceipts(inner, VAULT, size(SUFFIX));
  receipts.verdict = () => {
    const r = byCalendar(clock)();
    return { allowed: r === 0, reason: r };
  };
  const previews: OnchainIntent[] = [];
  const preview = o.preview ?? byCalendar(clock);
  const deps: RunDeps = {
    vault: VAULT,
    executor: EXECUTOR,
    expensePayee: PAYEE,
    mode: o.mode ?? "live",
    defaultDailyComputeUsd6: 500_000n,
    maxTxPerDay: o.maxTxPerDay ?? 40,
    billMinUsd6: BILL_MIN_USD6,
    maxLlmUsd6PerDay: 750_000n,
    stateClient: scene.client(),
    previewClient: {
      readContract: (async (p: { args: readonly [OnchainIntent] }) => (previews.push(p.args[0]), preview(p.args[0]))) as never,
    },
    txClient: receipts.client(),
    proposer: new FixedProposer({ summary: "hold", intents: [] }),
    sender: (o.mode ?? "live") === "live" ? new GuardedSender(inner, { vault: VAULT, suffix: SUFFIX }) : null,
    store,
    journal,
    commit: COMMIT,
  };
  const set = (iso: string) => {
    now = ms(iso);
  };
  const probe = (at: string) => runProbe(deps, ms(at), clock);
  const rows = async () => journal.read();
  const probeRows = async () => (await rows()).filter((r) => r.kind === "probe");
  return { dir, deps, inner, receipts, store, journal, scene, previews, clock, set, probe, rows, probeRows };
}

type IntentRow = Extract<JournalRow, { kind: "intent" | "sent" }>;
const sentRows = (all: JournalRow[]) => all.filter((r): r is IntentRow => r.kind === "sent");
const intentRows = (all: JournalRow[]) => all.filter((r): r is IntentRow => r.kind === "intent");
const actionOf = (i: OnchainIntent) => ACTIONS[i.action];

describe("runProbe at Friday 27 November 17:58 UTC (12:58 ET, two minutes before the 13:00 early close)", () => {
  it("sends a $1 OK BUY whose blob carries k = probe and the spec's text, and that npm run verify passes", async () => {
    const t = await setup({ clock: F1758 });
    const r = await t.probe(F1758);
    expect(r).toMatchObject({ runId: `probe-${F1758}`, status: "done", at: F1758, expected: "OK", outcome: "sent" });
    expect(t.inner.sent).toHaveLength(1);
    const data = t.inner.sent[0]!.data;
    const d = decodeExecuteInput(data)!;
    expect(d).toMatchObject({ status: "v1", hashTick: true, codes: ["bc_maattest"] });
    expect(d.fields).toMatchObject({ k: "probe", r: `probe-${F1758}`, t: "PROBE v1, not a Claude proposal. Expected OK before the 13:00 ET early close." });
    expect(d.fields!.t.startsWith(PROBE_TEXT_PREFIX)).toBe(true);
    expect(d.fields).not.toHaveProperty("m");
    const intent = t.receipts.calls()[0]!.args[0] as OnchainIntent;
    expect(actionOf(intent)).toBe("BUY");
    expect(intent.token).toBe(addressOf("NVDAc"));
    expect(intent.amount).toBe(1_000_000n);
    expect(intent.rationaleHash).toBe(keccak256(toBytes(d.blob!)));

    const all = await t.rows();
    expect(sentRows(all)).toHaveLength(1);
    expect(intentRows(all).at(-1)).toMatchObject({ preview: "OK", gate: "execute", decision: { allowed: true, reason: "OK" } });
    expect(await t.probeRows()).toEqual([expect.objectContaining({ kind: "probe", runId: `probe-${F1758}`, at: F1758, expected: "OK", outcome: "sent" })]);
    expect(t.store.probeOutcome(F1758)).toBe("sent");

    // The A5 verifier (npm run verify) on the calldata and the agent's local journal.
    const out: string[] = [];
    const err: string[] = [];
    expect(await verifyMain(["--input", data, "--journal", join(t.dir, "journal.jsonl")], { out: (s) => out.push(s), err: (s) => err.push(s) })).toBe(0);
    expect(err).toEqual([]);
    expect(out.join("\n")).toContain("PASS");
    // The §4 sender label: probe from an executor that is not the owner; the owner's own key reads as owner, by hand.
    expect(verifyDecision({ input: data, from: EXECUTOR, owner: OWNER }).label).toBe("probe");
    expect(verifyDecision({ input: data, from: EXECUTOR, owner: EXECUTOR }).label).toBe("owner, by hand");
  });

  it("sends at 17:59:30 UTC, its deadline, but not a second after", async () => {
    const t = await setup({ clock: "2026-11-27T17:59:30Z" });
    expect(await t.probe(F1758)).toMatchObject({ outcome: "sent", expected: "OK" });

    const late = await setup({ clock: "2026-11-27T17:59:31Z" });
    const r = await late.probe(F1758);
    expect(r).toMatchObject({ outcome: "skipped", expected: "OK", sent: [] });
    expect(r.why).toBe(
      "probe deadline 2026-11-27T17:59:30Z (30 s before the 13:00 ET early close) passed at 2026-11-27T17:59:31Z; an OK probe is never sent late",
    );
    expect(late.inner.sent).toEqual([]);
    expect(late.previews).toEqual([]);
    expect(await late.probeRows()).toEqual([expect.objectContaining({ at: F1758, expected: "OK", outcome: "skipped", note: r.why })]);
  });

  it("is still an OK probe, skipped with its reason, when it only gets the lock after the close", async () => {
    const t = await setup({ clock: "2026-11-27T18:00:05Z" });
    const r = await t.probe(F1758);
    expect(r).toMatchObject({ outcome: "skipped", expected: "OK" });
    expect(r.why).toMatch(/^probe deadline 2026-11-27T17:59:30Z .* passed at 2026-11-27T18:00:05Z/);
    expect(t.inner.sent).toEqual([]);
    // Nothing was logged, so the 18:01 probe still logs the early close.
    expect(t.store.hasLoggedRefusal({ day: "2026-11-27", reason: "MARKET_CLOSED:early-close" })).toBe(false);
  });

  it("stops before anything is stored or sent when the deadline passes during its preview or its gas estimate", async () => {
    const t = await setup({ clock: "2026-11-27T17:59:20Z" });
    t.receipts.estimate = () => (t.set("2026-11-27T17:59:31Z"), 200_000n);
    const r = await t.probe(F1758);
    expect(r).toMatchObject({ outcome: "skipped", expected: "OK" });
    expect(r.why).toMatch(/passed at 2026-11-27T17:59:31Z/);
    expect(t.receipts.estimates).toHaveLength(1);
    expect(t.inner.sent).toEqual([]);
    expect(t.store.pending()).toEqual([]);
    expect(t.store.txCount(BigInt(Math.floor(ms(F1758) / 86_400_000)))).toBe(0);
    expect(intentRows(await t.rows())).toEqual([expect.objectContaining({ preview: "OK", gate: r.why })]);

    let setClock = (_iso: string) => {};
    const p = await setup({ clock: "2026-11-27T17:59:20Z", preview: () => (setClock("2026-11-27T17:59:40Z"), 0) });
    setClock = p.set;
    const q = await p.probe(F1758);
    expect(q).toMatchObject({ outcome: "skipped" });
    expect(q.why).toMatch(/passed at 2026-11-27T17:59:40Z/);
    expect(p.previews).toHaveLength(1); // the deadline ends the probe: no second candidate
    expect(p.receipts.estimates).toEqual([]);
    expect(p.inner.sent).toEqual([]);
  });
});

describe("runProbe at Friday 27 November 18:01 UTC (13:01 ET, after the early close)", () => {
  it("sends the intent so the vault logs MARKET_CLOSED, with the early-close note, once per NYSE date and phase", async () => {
    const t = await setup({ clock: F1801 });
    const r = await t.probe(F1801);
    expect(r).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
    const d = decodeExecuteInput(t.inner.sent[0]!.data)!;
    expect(d.fields).toMatchObject({ k: "probe", r: `probe-${F1801}`, t: "PROBE v1, not a Claude proposal. Expected MARKET_CLOSED. (market closed, early close 13:00 ET)" });
    expect(intentRows(await t.rows()).at(-1)).toMatchObject({ preview: "MARKET_CLOSED", gate: "log-refusal", decision: { allowed: false, reason: "MARKET_CLOSED" } });
    expect(t.store.hasLoggedRefusal({ day: "2026-11-27", reason: "MARKET_CLOSED:early-close" })).toBe(true);

    // A later probe the same NYSE date, in the same phase, finds it logged and sends nothing.
    t.set("2026-11-27T18:30:00Z");
    const again = await t.probe("2026-11-27T18:30:00Z");
    expect(again).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED" });
    expect(again.why).toBe("MARKET_CLOSED already logged for NYSE date 2026-11-27 (early-close)");
    expect(t.inner.sent).toHaveLength(1);
  });

  it("sends nothing when the preview says OK although the calendar is closed at the probe's time", async () => {
    const t = await setup({ clock: F1801, preview: () => 0 });
    const r = await t.probe(F1801);
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED" });
    expect(r.why).toBe("no candidate previewed MARKET_CLOSED: BUY NVDAc: the probe expects MARKET_CLOSED; the preview is OK");
    expect(t.previews).toHaveLength(1);
    expect(t.inner.sent).toEqual([]);
  });
});

describe("runProbe on Thanksgiving, Thursday 26 November 14:31 UTC", () => {
  it("logs MARKET_CLOSED with the holiday's name when no holiday refusal is logged for that NYSE date", async () => {
    const t = await setup({ clock: T1431 });
    expect(await t.probe(T1431)).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
    expect(decodeExecuteInput(t.inner.sent[0]!.data)!.fields!.t).toBe("PROBE v1, not a Claude proposal. Expected MARKET_CLOSED. (market closed, NYSE holiday: Thanksgiving)");
    expect(t.store.hasLoggedRefusal({ day: "2026-11-26", reason: "MARKET_CLOSED:holiday" })).toBe(true);
  });

  it("is skipped, journaled with the reason, when the holiday refusal is already logged that NYSE date", async () => {
    const t = await setup({ clock: T1431 });
    t.store.recordRefusalLog({ day: "2026-11-26", reason: "MARKET_CLOSED:holiday" });
    const r = await t.probe(T1431);
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED", sent: [] });
    expect(r.why).toBe("MARKET_CLOSED already logged for NYSE date 2026-11-26 (holiday)");
    expect(t.inner.sent).toEqual([]);
    expect(t.previews).toHaveLength(1);
    expect(await t.probeRows()).toEqual([expect.objectContaining({ at: T1431, expected: "MARKET_CLOSED", outcome: "skipped", note: r.why })]);
  });
});

describe("a probe never bypasses a guardrail", () => {
  it("previews every candidate and sends only the one whose preview is what the calendar expects", async () => {
    // NVDAc held: the BUY of the least held token previews CONCENTRATION, so the SELL of NVDAc goes instead.
    const held = (clock: () => number) => sceneAt(clock).set(addressOf("NVDAc"), "balanceOf", 25_000_000n);
    const t = await setup({ clock: F1758, scene: held, preview: (i) => (actionOf(i) === "BUY" ? code("CONCENTRATION") : 0) });
    expect(await t.probe(F1758)).toMatchObject({ outcome: "sent", expected: "OK", proposals: 2 });
    expect(t.previews.map(actionOf)).toEqual(["BUY", "SELL"]);
    const intents = intentRows(await t.rows());
    expect(intents[0]).toMatchObject({ index: 0, action: "BUY", symbol: "GOOGLc", preview: "CONCENTRATION", gate: "the probe expects OK; the preview is CONCENTRATION" });
    expect(sentRows(await t.rows())).toEqual([expect.objectContaining({ index: 1, action: "SELL", symbol: "NVDAc", preview: "OK" })]);
    // What was sent is exactly what was previewed.
    expect(t.receipts.calls().map((c) => (c.args[0] as OnchainIntent).id)).toEqual([t.previews[1]!.id]);
  });

  it("sends nothing on any other preview, an RPC failure included", async () => {
    const held = (clock: () => number) => sceneAt(clock).set(addressOf("NVDAc"), "balanceOf", 25_000_000n);
    const stale = await setup({ clock: F1758, scene: held, preview: () => code("FEED_STALE") });
    const r = await stale.probe(F1758);
    expect(r).toMatchObject({ outcome: "skipped", expected: "OK" });
    expect(r.why).toBe("no candidate previewed OK: BUY GOOGLc: the probe expects OK; the preview is FEED_STALE; SELL NVDAc: the probe expects OK; the preview is FEED_STALE");
    expect(stale.previews).toHaveLength(2);
    expect(stale.inner.sent).toEqual([]);

    const down = await setup({ clock: F1758, preview: () => Promise.reject(new Error("rpc down")) });
    expect((await down.probe(F1758)).why).toBe("no candidate previewed OK: BUY NVDAc: the probe expects OK; the guard state is unknown (RPC)");
    expect(down.inner.sent).toEqual([]);

    const closed = await setup({ clock: F1758, preview: () => code("MARKET_CLOSED") });
    expect((await closed.probe(F1758)).why).toBe("no candidate previewed OK: BUY NVDAc: the probe expects OK; the preview is MARKET_CLOSED");
    expect(closed.inner.sent).toEqual([]);
  });

  it("stops on MAAT_MAX_TX_PER_DAY and sends nothing", async () => {
    const t = await setup({ clock: F1758, maxTxPerDay: 1 });
    t.store.recordTx(BigInt(Math.floor(ms(F1758) / 86_400_000)));
    const r = await t.probe(F1758);
    expect(r).toMatchObject({ status: "halted", outcome: "halted", haltReason: "daily tx cap 1 reached", sent: [] });
    expect(t.inner.sent).toEqual([]);
    expect(t.receipts.estimates).toEqual([]);
    const all = await t.rows();
    expect(all.find((e) => e.kind === "error")).toMatchObject({ message: "halted: daily tx cap 1 reached" });
    expect(all.at(-1)).toMatchObject({ kind: "probe", outcome: "halted", note: "daily tx cap 1 reached" });
  });

  it("stores the pending entry before the intent leaves, so a send that fails after broadcast is settled next round", async () => {
    const t = await setup({ clock: F1758 });
    const atSend: unknown[] = [];
    const send = t.inner.send.bind(t.inner);
    t.inner.send = async (tx) => (atSend.push(t.store.pending().map((p) => p.intentId)), send(tx));
    t.inner.failAfterBroadcast = new Error("socket hang up");
    const r = await t.probe(F1758);
    expect(r).toMatchObject({ status: "halted", outcome: "halted" });
    const id = t.previews[0]!.id;
    expect(atSend).toEqual([[id]]);
    expect(t.store.pending()).toEqual([expect.objectContaining({ intentId: id, gateKind: "execute", preview: "OK" })]);
    // The next round settles it from the vault's logs, and a probe until then sends nothing.
    t.inner.failAfterBroadcast = undefined;
    const next = await runOnce({ ...t.deps, runId: "round-after" });
    expect(next.status).toBe("done");
    expect(t.store.pending()).toEqual([]);
  });

  it("sends nothing while a send from an earlier round may still land", async () => {
    const t = await setup({ clock: F1758 });
    const now = BigInt(Math.floor(ms(F1758) / 1000));
    t.store.addPending({ intentId: `0x${"ab".repeat(32)}`, action: "BUY", amount: "1", gateKind: "execute", preview: "OK", day: "0", block: "100", timestamp: now.toString() });
    const r = await t.probe(F1758);
    expect(r).toMatchObject({ status: "pending-tx", outcome: "skipped" });
    expect(r.why).toBe("a send from an earlier round may still land; a probe sends nothing until it is settled");
    expect(t.previews).toEqual([]);
    expect(t.inner.sent).toEqual([]);
  });

  it("drops a credit action before the preview on the path probes share, and only ever proposes a BUY or a SELL", async () => {
    const t = await setup({ clock: F1758 });
    const s = await readVaultState(t.deps.stateClient, VAULT);
    const report: RunReport = { runId: "probe-x", status: "done", sent: [], skipped: 0, proposals: 0 };
    const k = roundKit(t.deps, "probe-x", report, s);
    for (const action of ["SUPPLY", "BORROW", "REPAY", "WITHDRAW_COLLATERAL"] as const) {
      const h = await k.handle(0, { action, symbol: "NVDAc", amountUsd: 1, rationale: `${PROBE_TEXT_PREFIX}.` }, { k: "probe" });
      expect(h).toEqual({ preview: null, outcome: "skipped", why: `credit actions are off: ${action} dropped before the preview` });
    }
    expect(t.previews).toEqual([]);
    for (const at of [F1758, F1801, T1431]) {
      const p = await setup({ clock: at });
      await p.probe(at);
      expect(p.previews.map(actionOf).every((a) => a === "BUY" || a === "SELL")).toBe(true);
    }
  });

  it("only journals what it would send in dry-run", async () => {
    const t = await setup({ clock: F1758, mode: "dry-run" });
    expect(await t.probe(F1758)).toMatchObject({ outcome: "dry-run", expected: "OK", sent: [] });
    expect(intentRows(await t.rows())).toEqual([expect.objectContaining({ preview: "OK", gate: "dry-run: would execute" })]);
    const late = await setup({ clock: "2026-11-27T17:59:31Z", mode: "dry-run" });
    expect(await late.probe(F1758)).toMatchObject({ outcome: "skipped" });
  });
});

describe("runProbe's own limits", () => {
  it("never runs late: a probe that gets the lock more than 10 minutes after its time is journaled as missed", async () => {
    const t = await setup({ clock: "2026-11-27T18:11:01Z" });
    const r = await t.probe(F1801);
    expect(r).toMatchObject({ outcome: "missed", sent: [] });
    expect(r.why).toBe("it got the round lock at 2026-11-27T18:11:01Z, more than 10 minutes after its time; a probe is never run late");
    expect(t.previews).toEqual([]);
    expect(await t.probeRows()).toEqual([expect.objectContaining({ at: F1801, outcome: "missed", note: r.why })]);
    expect(t.store.probeOutcome(F1801)).toBe("missed");

    const edge = await setup({ clock: "2026-11-27T18:11:00Z" });
    expect(await edge.probe(F1801)).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
  });

  it("refuses a fourth probe on the same UTC day, also when a restart listed other instants", async () => {
    const t = await setup({ clock: F1758 });
    expect((await t.probe(F1758)).outcome).toBe("sent");
    t.set(F1801);
    expect((await t.probe(F1801)).outcome).toBe("sent");
    t.set("2026-11-27T18:30:00Z");
    expect((await t.probe("2026-11-27T18:30:00Z")).outcome).toBe("skipped");
    t.set("2026-11-27T21:30:00Z");
    const fourth = await t.probe("2026-11-27T21:30:00Z");
    expect(fourth).toMatchObject({ outcome: "capped", sent: [] });
    expect(fourth.why).toBe("3 probes already ran on UTC day 2026-11-27; at most 3 run a day");
    expect(t.inner.sent).toHaveLength(2);
    // A missed or capped probe never ran, so it does not use up the day.
    t.set("2026-11-28T00:30:00Z");
    expect((await t.probe("2026-11-28T00:05:00Z")).outcome).toBe("missed");
    expect((await t.probe("2026-11-28T00:30:00Z")).outcome).not.toBe("capped");
  });

  it("is skipped when the vault state or the calendar at its time cannot be read", async () => {
    const noCal = await setup({ clock: F1758, scene: (c) => sceneAt(c).fail(CALENDAR, "localTime") });
    expect(await noCal.probe(F1758)).toMatchObject({ outcome: "skipped", why: "the calendar could not be read at the probe's time" });
    expect(noCal.previews).toEqual([]);

    const noState = await setup({ clock: F1758 });
    noState.deps.stateClient = { ...noState.deps.stateClient, getBlock: () => Promise.reject(new Error("rpc down")) };
    const r = await noState.probe(F1758);
    expect(r).toMatchObject({ status: "no-state", outcome: "skipped", why: "state unavailable: getBlock failed" });
  });

  it("does nothing for an instant the store already recorded", async () => {
    const t = await setup({ clock: F1758 });
    t.store.recordProbe(F1758, "started");
    expect(await t.probe(F1758)).toMatchObject({ outcome: "skipped", why: "already started before; a probe runs once" });
    expect(await t.rows()).toEqual([]);
    expect(t.previews).toEqual([]);
  });
});

describe("probeStartup", () => {
  const RAW = "soon,2026-11-20T10:00:00Z,2026-11-27T17:58:00Z,2026-11-27T17:58Z,2026-11-27T18:01:00Z,2026-11-27T18:30:00Z,2026-11-27T19:00:00Z";

  it("reports every bad MAAT_PROBES value without throwing, journals a past one as missed, and schedules the rest", async () => {
    const t = await setup({ clock: "2026-11-25T00:00:00Z" });
    const start = await probeStartup(RAW, t.deps, ms("2026-11-25T00:00:00Z"));
    expect(start.problems).toEqual([
      '"soon" is not an ISO-8601 UTC instant such as 2026-11-27T17:58:00Z; left out',
      "2026-11-27T17:58:00Z is listed more than once; it runs once",
      "2026-11-27T19:00:00Z is probe 4 on UTC day 2026-11-27; at most 3 run a day, so it is left out",
      "2026-11-20T10:00:00Z is in the past at this start (2026-11-25T00:00:00Z); journaled as missed, never run late",
    ]);
    expect(start.due).toEqual([F1758, F1801, "2026-11-27T18:30:00Z"].map(ms));
    expect(start.lines).toEqual([`probe ${F1758}: scheduled`, `probe ${F1801}: scheduled`, "probe 2026-11-27T18:30:00Z: scheduled"]);
    expect(await t.probeRows()).toEqual([
      expect.objectContaining({ runId: "probe-2026-11-20T10:00:00Z", at: "2026-11-20T10:00:00Z", outcome: "missed", note: "its time passed before this start at 2026-11-25T00:00:00Z; a probe is never run late" }),
    ]);
    expect(t.store.probeOutcome("2026-11-20T10:00:00Z")).toBe("missed");
    for (const raw of [undefined, "", "garbage", "2026-11-27T17:58:00+00:00"]) await expect(probeStartup(raw, t.deps, ms("2026-11-25T00:00:00Z"))).resolves.toBeDefined();
  });

  it("on a restart, says what became of each earlier probe and never runs or journals it again", async () => {
    const t = await setup({ clock: "2026-11-25T00:00:00Z" });
    await probeStartup(RAW, t.deps, ms("2026-11-25T00:00:00Z"));
    t.store.recordProbe(F1758, "sent");
    const again = await probeStartup(RAW, t.deps, ms("2026-11-27T18:00:00Z"));
    expect(again.due).toEqual([F1801, "2026-11-27T18:30:00Z"].map(ms));
    expect(again.lines).toEqual([
      "probe 2026-11-20T10:00:00Z: missed before this start; not run again",
      `probe ${F1758}: sent before this start; not run again`,
      `probe ${F1801}: scheduled`,
      "probe 2026-11-27T18:30:00Z: scheduled",
    ]);
    expect(await t.probeRows()).toHaveLength(1);
  });
});

describe("runProbes", () => {
  const report = (at: number, outcome: ProbeReport["outcome"]): ProbeReport => ({
    runId: `probe-${at}`,
    status: "done",
    sent: [],
    skipped: 0,
    proposals: 0,
    at: new Date(at).toISOString(),
    outcome,
  });

  it("wakes at least once a minute until each instant, then runs it under the round lock", async () => {
    let now = ms("2026-11-27T17:55:30Z");
    const sleeps: number[] = [];
    const lock = new RoundLock();
    const fired: [number, number, number][] = [];
    const log: string[] = [];
    const n = await runProbes({
      due: [F1758, F1801].map(ms),
      fire: async (at) => (fired.push([at, now, lock.waiting]), report(at, "sent")),
      lock,
      signal: new AbortController().signal,
      now: () => now,
      sleep: async (d) => {
        sleeps.push(d);
        now += d;
      },
      log: (m) => log.push(m),
    });
    expect(n).toBe(2);
    expect(sleeps.every((d) => d > 0 && d <= 60_000)).toBe(true);
    expect(fired.map(([at, when]) => [at, when])).toEqual([F1758, F1801].map((iso) => [ms(iso), ms(iso)]));
    expect(log).toHaveLength(2);
  });

  it("waits for a round that holds the lock, and goes on to the next probe when one fails", async () => {
    const lock = new RoundLock();
    let releaseRound!: () => void;
    const round = lock.run(() => new Promise<void>((r) => (releaseRound = r)));
    const order: string[] = [];
    const log: string[] = [];
    const done = runProbes({
      due: [1, 2],
      fire: async (at) => {
        order.push(`probe ${at}`);
        if (at === 1) throw new Error("boom at https://rpc.example.org/v2/fake-key");
        return report(at, "skipped");
      },
      lock,
      signal: new AbortController().signal,
      now: () => 10,
      log: (m) => log.push(m),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([]);
    expect(lock.waiting).toBe(1);
    order.push("round done");
    releaseRound();
    await round;
    expect(await done).toBe(2);
    expect(order).toEqual(["round done", "probe 1", "probe 2"]);
    expect(log[0]).toMatch(/^probe 1970-01-01T00:00:00Z failed: /);
    expect(log.join("\n")).not.toContain("fake-key");
  });

  it("stops waiting when the agent is stopped", async () => {
    const ac = new AbortController();
    const n = runProbes({
      due: [ms(F1758)],
      fire: async () => {
        throw new Error("must not run");
      },
      lock: new RoundLock(),
      signal: ac.signal,
      now: () => ms("2026-11-27T17:00:00Z"),
      sleep: async () => ac.abort(),
    });
    expect(await n).toBe(0);
  });
});
