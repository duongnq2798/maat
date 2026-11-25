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
  // A retry's pause moves the clock instead of waiting.
  const sleeps: number[] = [];
  const sleep = async (d: number) => {
    sleeps.push(d);
    now += d;
  };
  const probe = (at: string) => runProbe(deps, ms(at), clock, sleep);
  const rows = async () => journal.read();
  const probeRows = async () => (await rows()).filter((r) => r.kind === "probe");
  return { dir, deps, inner, receipts, store, journal, scene, previews, clock, set, sleeps, probe, rows, probeRows };
}

/** The state client with the first `n` calls of `method` (or of the calendar read at an instant) failing. */
function failFirst(c: RunDeps["stateClient"], n: number, what: "getBlock" | "calendarAt"): RunDeps["stateClient"] {
  let left = n;
  if (what === "getBlock") return { ...c, getBlock: ((a: never) => (left-- > 0 ? Promise.reject(new Error("rpc down")) : c.getBlock(a))) as never };
  type Call = { contracts: readonly { functionName: string }[] };
  const calendarAt = (p: Call) => p.contracts.length === 6 && p.contracts[0]!.functionName === "isOpen";
  return { ...c, multicall: ((p: Call) => (calendarAt(p) && left-- > 0 ? Promise.reject(new Error("rpc down")) : c.multicall(p as never))) as never };
}

type CalendarCall = { contracts: readonly { functionName: string; args?: readonly unknown[] }[] };
/** The instant a multicall reads the calendar at, when it is readCalendarAt's (isOpen, then 5 views); else null. */
const calendarReadAt = (p: CalendarCall): bigint | null =>
  p.contracts.length === 6 && p.contracts[0]!.functionName === "isOpen" ? (p.contracts[0]!.args![0] as bigint) : null;

/** The state client with the first `n` calendar reads at an instant `pick` takes failing. */
function failCalendarAt(c: RunDeps["stateClient"], n: number, pick: (ts: bigint) => boolean): RunDeps["stateClient"] {
  let left = n;
  return {
    ...c,
    multicall: ((p: CalendarCall) => {
      const ts = calendarReadAt(p);
      return ts !== null && pick(ts) && left-- > 0 ? Promise.reject(new Error("rpc down")) : c.multicall(p as never);
    }) as never,
  };
}

/** The state client with every calendar read at an instant taking `takesMs` of the test clock, which `advance` moves on. */
function slowCalendar(c: RunDeps["stateClient"], takesMs: number, advance: (by: number) => void): RunDeps["stateClient"] {
  return {
    ...c,
    multicall: (async (p: CalendarCall) => {
      const r = await c.multicall(p as never);
      if (calendarReadAt(p) !== null) advance(takesMs);
      return r;
    }) as never,
  };
}

/** Moves the test clock of `t` on by `by` ms. */
const advanceOf = (t: { clock: () => number; set: (iso: string) => void }) => (by: number) => t.set(new Date(t.clock() + by).toISOString());

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

  it("logs MARKET_CLOSED even when less than $1 of the daily cap is left, since the vault checks the market first", async () => {
    const spent = (clock: () => number) => sceneAt(clock).set(VAULT, "spentOnDay", 99_500_000n);
    const t = await setup({ clock: F1801, scene: spent });
    expect(await t.probe(F1801)).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
    expect(intentRows(await t.rows()).at(-1)).toMatchObject({ preview: "MARKET_CLOSED", gate: "log-refusal", decision: { allowed: false, reason: "MARKET_CLOSED" } });

    // An OK probe with the same headroom has no candidate: the vault would refuse it SIZE_LIMIT.
    const ok = await setup({ clock: F1758, scene: spent });
    expect(await ok.probe(F1758)).toMatchObject({ outcome: "skipped", expected: "OK", proposals: 0 });
    expect(ok.previews).toEqual([]);
  });

  it("sends nothing when the preview says OK although the calendar is closed at the probe's time", async () => {
    const t = await setup({ clock: F1801, preview: () => 0 });
    const r = await t.probe(F1801);
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED" });
    expect(r.why).toBe("no candidate previewed MARKET_CLOSED: BUY NVDAc: the probe expects MARKET_CLOSED; the preview is OK");
    expect(t.previews).toHaveLength(1);
    expect(t.inner.sent).toEqual([]);
  });

  it("still sends when each calendar read takes 5 s, far from an open, and sends nothing when its two reads take over 30 s", async () => {
    const t = await setup({ clock: F1801 });
    t.deps.stateClient = slowCalendar(t.deps.stateClient, 5_000, advanceOf(t));
    expect(await t.probe(F1801)).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
    expect(t.sleeps).toEqual([]);
    expect(t.store.hasLoggedRefusal({ day: "2026-11-27", reason: "MARKET_CLOSED:early-close" })).toBe(true);

    const slow = await setup({ clock: F1801 });
    slow.receipts.estimate = () => ((slow.deps.stateClient = slowCalendar(slow.deps.stateClient, 20_000, advanceOf(slow))), 200_000n);
    const r = await slow.probe(F1801);
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED", sent: [] });
    expect(r.why).toBe(
      "the calendar read took too long: it ended at 2026-11-27T18:01:40Z, more than 30 s after 2026-11-27T18:01:00Z; a MARKET_CLOSED probe sends nothing it cannot place before an open",
    );
    expect(slow.inner.sent).toEqual([]);
  });
});

describe("runProbe just before Monday 30 November's 09:30 ET open (14:30 UTC)", () => {
  // The vault judges a send at the block it is mined in: mined after the open, a MARKET_CLOSED probe would trade.
  const mon = (hms: string) => `2026-11-30T${hms}Z`;

  it("sends no MARKET_CLOSED probe 30 s or less before the open, and says why", async () => {
    const t = await setup({ clock: mon("14:29:58") });
    const r = await t.probe(mon("14:29:58"));
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED", sent: [] });
    expect(r.why).toBe(
      "the calendar is open at 2026-11-30T14:30:28Z, 30 s after 2026-11-30T14:29:58Z; a MARKET_CLOSED probe sends nothing that close to an open",
    );
    expect(t.previews).toEqual([]);
    expect(t.inner.sent).toEqual([]);
    expect(t.store.hasLoggedRefusal({ day: "2026-11-30", reason: "MARKET_CLOSED:overnight" })).toBe(false);
    expect(await t.probeRows()).toEqual([expect.objectContaining({ at: mon("14:29:58"), expected: "MARKET_CLOSED", outcome: "skipped", note: r.why })]);

    // 14:29:29 is 31 s before the open: the refusal goes out.
    const early = await setup({ clock: mon("14:29:29") });
    expect(await early.probe(mon("14:29:29"))).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
  });

  it("checks again after its gas estimate, before anything is stored or sent", async () => {
    const t = await setup({ clock: mon("14:29:00") });
    t.receipts.estimate = () => (t.set(mon("14:29:31")), 200_000n);
    const r = await t.probe(mon("14:29:00"));
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED" });
    expect(r.why).toBe(
      "the calendar is open at 2026-11-30T14:30:01Z, 30 s after 2026-11-30T14:29:31Z; a MARKET_CLOSED probe sends nothing that close to an open",
    );
    expect(t.previews).toHaveLength(1);
    expect(t.receipts.estimates).toHaveLength(1);
    expect(t.inner.sent).toEqual([]);
    expect(t.store.pending()).toEqual([]);
    expect(intentRows(await t.rows())).toEqual([expect.objectContaining({ preview: "MARKET_CLOSED", gate: r.why })]);
  });

  it("sends nothing when the calendar 30 s on cannot be read", async () => {
    const t = await setup({ clock: mon("14:00:00") });
    t.receipts.estimate = () => ((t.deps.stateClient = failFirst(t.deps.stateClient, 1, "calendarAt")), 200_000n);
    const r = await t.probe(mon("14:00:00"));
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED" });
    expect(r.why).toBe("the calendar could not be read at 2026-11-30T14:00:30Z; a MARKET_CLOSED probe sends nothing it cannot place before an open");
    expect(t.inner.sent).toEqual([]);
  });

  it("tries its first check 30 s on again 5 s later when that read fails once, then sends", async () => {
    const t = await setup({ clock: mon("14:00:00") });
    const atS = BigInt(ms(mon("14:00:00")) / 1000);
    t.deps.stateClient = failCalendarAt(t.deps.stateClient, 1, (ts) => ts !== atS);
    expect(await t.probe(mon("14:00:00"))).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
    expect(t.sleeps).toEqual([5_000]);
    expect((await t.rows()).filter((e) => e.kind === "error")).toEqual([
      expect.objectContaining({ message: "the calendar could not be read at 2026-11-30T14:00:30Z (try 1 of 3, again in 5 s)" }),
    ]);
    expect(t.inner.sent).toHaveLength(1);
  });

  it("is skipped, with nothing previewed, when its first check 30 s on cannot be read in 3 tries", async () => {
    const t = await setup({ clock: mon("14:00:00") });
    const atS = BigInt(ms(mon("14:00:00")) / 1000);
    t.deps.stateClient = failCalendarAt(t.deps.stateClient, 3, (ts) => ts !== atS);
    const r = await t.probe(mon("14:00:00"));
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED", sent: [] });
    expect(r.why).toBe(
      "the calendar could not be read at 2026-11-30T14:00:40Z, after 3 tries; a MARKET_CLOSED probe sends nothing it cannot place before an open",
    );
    expect(t.sleeps).toEqual([5_000, 5_000]);
    expect(t.previews).toEqual([]);
    expect(t.inner.sent).toEqual([]);
    expect(await t.probeRows()).toEqual([expect.objectContaining({ at: mon("14:00:00"), expected: "MARKET_CLOSED", outcome: "skipped", note: r.why })]);
  });

  it("sends nothing when its calendar read after the gas estimate comes back 61 s late, after the open", async () => {
    const t = await setup({ clock: mon("14:29:00") });
    t.receipts.estimate = () => ((t.deps.stateClient = slowCalendar(t.deps.stateClient, 61_000, advanceOf(t))), 200_000n);
    const r = await t.probe(mon("14:29:00"));
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED", sent: [] });
    expect(r.why).toBe(
      "the calendar read took too long: it ended at 2026-11-30T14:30:01Z, more than 30 s after 2026-11-30T14:29:00Z; a MARKET_CLOSED probe sends nothing it cannot place before an open",
    );
    expect(t.receipts.estimates).toHaveLength(1);
    expect(t.inner.sent).toEqual([]);
    expect(t.store.pending()).toEqual([]);
    expect(t.store.hasLoggedRefusal({ day: "2026-11-30", reason: "MARKET_CLOSED:overnight" })).toBe(false);
    expect(intentRows(await t.rows())).toEqual([expect.objectContaining({ preview: "MARKET_CLOSED", gate: r.why })]);
  });

  it("still keeps 30 s from the open when its calendar read takes 12 s, by reading the calendar 60 s on as well", async () => {
    // Read at 14:29:20 for 14:29:50, the answer comes at 14:29:32: a send then would be mined 28 s before the open.
    const t = await setup({ clock: mon("14:29:20") });
    t.receipts.estimate = () => ((t.deps.stateClient = slowCalendar(t.deps.stateClient, 12_000, advanceOf(t))), 200_000n);
    const r = await t.probe(mon("14:29:20"));
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED", sent: [] });
    expect(r.why).toBe(
      "the calendar is open at 2026-11-30T14:30:20Z, 60 s after 2026-11-30T14:29:20Z, and the reads ended at 2026-11-30T14:29:44Z; a MARKET_CLOSED probe sends nothing that close to an open",
    );
    expect(t.inner.sent).toEqual([]);
    expect(t.store.pending()).toEqual([]);
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

  it("is skipped when the vault state or the calendar at its time cannot be read in 3 tries, 5 s apart", async () => {
    const noCal = await setup({ clock: F1758, scene: (c) => sceneAt(c).fail(CALENDAR, "localTime") });
    expect(await noCal.probe(F1758)).toMatchObject({ outcome: "skipped", why: "the calendar could not be read at the probe's time, after 3 tries" });
    expect(noCal.previews).toEqual([]);
    expect(noCal.sleeps).toEqual([5_000, 5_000]);

    const noState = await setup({ clock: F1758 });
    noState.deps.stateClient = { ...noState.deps.stateClient, getBlock: () => Promise.reject(new Error("rpc down")) };
    const r = await noState.probe(F1758);
    expect(r).toMatchObject({ status: "no-state", outcome: "skipped", why: "state unavailable: getBlock failed, after 3 tries" });
    expect((await noState.rows()).filter((e) => e.kind === "error").map((e) => (e as { message: string }).message)).toEqual([
      "state unavailable: getBlock failed (try 1 of 3, again in 5 s)",
      "state unavailable: getBlock failed (try 2 of 3, again in 5 s)",
      "state unavailable: getBlock failed (try 3 of 3)",
    ]);
    expect(await noState.probeRows()).toEqual([expect.objectContaining({ at: F1758, outcome: "skipped", note: r.why })]);
  });

  it("tries a failed state or calendar read again 5 s later, so one RPC failure does not use up its instant", async () => {
    const state = await setup({ clock: F1758 });
    state.deps.stateClient = failFirst(state.deps.stateClient, 2, "getBlock");
    expect(await state.probe(F1758)).toMatchObject({ status: "done", outcome: "sent", expected: "OK" });
    expect(state.sleeps).toEqual([5_000, 5_000]);
    expect(state.inner.sent).toHaveLength(1);

    const cal = await setup({ clock: F1801 });
    cal.deps.stateClient = failFirst(cal.deps.stateClient, 1, "calendarAt");
    expect(await cal.probe(F1801)).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
    expect(cal.sleeps).toEqual([5_000]);
    expect((await cal.rows()).filter((e) => e.kind === "error")).toEqual([
      expect.objectContaining({ message: "the calendar could not be read at the probe's time (try 1 of 3, again in 5 s)" }),
    ]);
  });

  it("tries again only while the next try is at most 10 minutes after its instant, and an OK probe still keeps its deadline", async () => {
    const at = async (clock: string, probeAt: string) => {
      const t = await setup({ clock });
      t.deps.stateClient = { ...t.deps.stateClient, getBlock: () => Promise.reject(new Error("rpc down")) };
      return { r: await t.probe(probeAt), sleeps: t.sleeps };
    };
    // 18:10:55 + 5 s is 10 minutes after 18:01: one more try. From 18:10:56 there is none.
    expect(await at("2026-11-27T18:10:55Z", F1801)).toMatchObject({ r: { why: "state unavailable: getBlock failed, after 2 tries" }, sleeps: [5_000] });
    expect(await at("2026-11-27T18:10:56Z", F1801)).toMatchObject({ r: { why: "state unavailable: getBlock failed, after 1 try" }, sleeps: [] });

    // The try that works lands at 17:59:33, past the 17:59:30 deadline: nothing is previewed or sent.
    const late = await setup({ clock: "2026-11-27T17:59:28Z" });
    late.deps.stateClient = failFirst(late.deps.stateClient, 1, "getBlock");
    const r = await late.probe(F1758);
    expect(r).toMatchObject({ outcome: "skipped", expected: "OK" });
    expect(r.why).toMatch(/^probe deadline 2026-11-27T17:59:30Z .* passed at 2026-11-27T17:59:33Z/);
    expect(late.previews).toEqual([]);
    expect(late.inner.sent).toEqual([]);
  });

  it("records a halted probe with one state.json save at a time, so its last save holds the outcome", async () => {
    const t = await setup({ clock: F1758, maxTxPerDay: 1 });
    t.store.recordTx(BigInt(Math.floor(ms(F1758) / 86_400_000)));
    // Each save takes a while, so two saves that overlap show up as two in flight.
    const save = t.store.save.bind(t.store);
    let inFlight = 0;
    let most = 0;
    t.store.save = async () => {
      most = Math.max(most, ++inFlight);
      try {
        await new Promise((r) => setTimeout(r, 30));
        await save();
      } finally {
        inFlight--;
      }
    };
    expect(await t.probe(F1758)).toMatchObject({ outcome: "halted" });
    expect(most).toBe(1);
    expect((await Store.open(t.dir)).probeOutcome(F1758)).toBe("halted");
  });

  it("does nothing for an instant the store already recorded", async () => {
    const t = await setup({ clock: F1758 });
    t.store.recordProbe(F1758, "started");
    expect(await t.probe(F1758)).toMatchObject({ outcome: "skipped", why: "already started before; a probe runs once" });
    expect(await t.rows()).toEqual([]);
    expect(t.previews).toEqual([]);
  });

  it("is journaled as missed, and sends nothing, when the PC wakes from a retry's pause more than 10 minutes after its time", async () => {
    const t = await setup({ clock: F1801 });
    t.deps.stateClient = failFirst(t.deps.stateClient, 1, "getBlock");
    // The PC suspends during the 5 s pause and wakes on Saturday morning.
    const r = await runProbe(t.deps, ms(F1801), t.clock, async (d) => (t.sleeps.push(d), t.set("2026-11-28T08:00:00Z")));
    expect(r).toMatchObject({ outcome: "missed", sent: [] });
    expect(r.why).toBe("it woke from a 5 s pause at 2026-11-28T08:00:00Z, more than 10 minutes after its time; a probe is never run late");
    expect(t.sleeps).toEqual([5_000]);
    expect(t.previews).toEqual([]);
    expect(t.inner.sent).toEqual([]);
    expect(t.store.probeOutcome(F1801)).toBe("missed");
    expect(await t.probeRows()).toEqual([expect.objectContaining({ at: F1801, outcome: "missed", note: r.why })]);
    // That Saturday's refusal is still to be logged.
    expect(t.store.hasLoggedRefusal({ day: "2026-11-28", reason: "MARKET_CLOSED:weekend" })).toBe(false);
  });

  it("never sends more than 10 minutes after its instant, also when the steps before the send take that long", async () => {
    const t = await setup({ clock: F1801 });
    t.receipts.estimate = () => (t.set("2026-11-27T18:11:01Z"), 200_000n);
    const r = await t.probe(F1801);
    expect(r).toMatchObject({ outcome: "skipped", expected: "MARKET_CLOSED", sent: [] });
    expect(r.why).toBe("it was ready to send at 2026-11-27T18:11:01Z, more than 10 minutes after its time; a probe is never sent late");
    expect(t.inner.sent).toEqual([]);
    expect(t.store.pending()).toEqual([]);
    expect(t.store.hasLoggedRefusal({ day: "2026-11-27", reason: "MARKET_CLOSED:early-close" })).toBe(false);

    // An OK probe whose deadline is hours away keeps the same limit: Wednesday 25 November closes at 16:00 ET.
    const ok = await setup({ clock: "2026-11-25T15:00:00Z" });
    ok.receipts.estimate = () => (ok.set("2026-11-25T15:10:01Z"), 200_000n);
    const q = await ok.probe("2026-11-25T15:00:00Z");
    expect(q).toMatchObject({ outcome: "skipped", expected: "OK", sent: [] });
    expect(q.why).toBe("it was ready to send at 2026-11-25T15:10:01Z, more than 10 minutes after its time; a probe is never sent late");
    expect(ok.inner.sent).toEqual([]);

    // 10 minutes after its instant to the second, it still sends.
    const edge = await setup({ clock: F1801 });
    edge.receipts.estimate = () => (edge.set("2026-11-27T18:11:00Z"), 200_000n);
    expect(await edge.probe(F1801)).toMatchObject({ outcome: "sent", expected: "MARKET_CLOSED" });
  });

  it("ends skipped, trying nothing again and sending nothing, when the agent is stopped during a retry's pause", async () => {
    const t = await setup({ clock: F1801 });
    t.deps.stateClient = failFirst(t.deps.stateClient, 1, "getBlock");
    const ac = new AbortController();
    // Ctrl-C during the 5 s pause.
    const r = await runProbe(t.deps, ms(F1801), t.clock, async (d) => (t.sleeps.push(d), ac.abort()), ac.signal);
    expect(r).toMatchObject({ outcome: "skipped", sent: [], why: "the agent is stopping" });
    expect(t.sleeps).toEqual([5_000]);
    expect(t.previews).toEqual([]);
    expect(t.inner.sent).toEqual([]);
    expect(await t.probeRows()).toEqual([expect.objectContaining({ at: F1801, outcome: "skipped", note: "the agent is stopping" })]);

    // Its own pause ends at the stop, not 5 s later.
    const real = await setup({ clock: F1801 });
    real.deps.stateClient = failFirst(real.deps.stateClient, 1, "getBlock");
    const stop = new AbortController();
    const started = Date.now();
    setTimeout(() => stop.abort(), 50);
    expect(await runProbe(real.deps, ms(F1801), real.clock, undefined, stop.signal)).toMatchObject({ outcome: "skipped", why: "the agent is stopping" });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(real.inner.sent).toEqual([]);
  });

  it("sends nothing when the agent is stopped before its send", async () => {
    const t = await setup({ clock: F1758 });
    const ac = new AbortController();
    t.receipts.estimate = () => (ac.abort(), 200_000n);
    const r = await runProbe(t.deps, ms(F1758), t.clock, async () => {}, ac.signal);
    expect(r).toMatchObject({ outcome: "skipped", expected: "OK", sent: [], why: "the agent is stopping" });
    expect(t.receipts.estimates).toHaveLength(1);
    expect(t.inner.sent).toEqual([]);
    expect(t.store.pending()).toEqual([]);
    expect(intentRows(await t.rows())).toEqual([expect.objectContaining({ preview: "OK", gate: "the agent is stopping" })]);
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

  it("fires no probe that gets the round lock after the agent was stopped", async () => {
    const lock = new RoundLock();
    const ac = new AbortController();
    let releaseRound!: () => void;
    const round = lock.run(() => new Promise<void>((r) => (releaseRound = r)));
    const fired: number[] = [];
    const log: string[] = [];
    const done = runProbes({
      due: [F1758, F1801].map(ms),
      fire: async (at) => (fired.push(at), report(at, "sent")),
      lock,
      signal: ac.signal,
      now: () => ms(F1801),
      log: (m) => log.push(m),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(lock.waiting).toBe(1);
    // Ctrl-C while the probe waits for the round: the round ends, and the probe must not start after the stop.
    ac.abort();
    releaseRound();
    await round;
    expect(await done).toBe(0);
    expect(fired).toEqual([]);
    expect(log).toEqual([`probe ${F1758}: not run, the agent is stopping`]);
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
