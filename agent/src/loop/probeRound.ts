import { getAddress } from "viem";
import { readCalendarAt, readVaultState, StateUnavailable, type VaultState } from "../chain/state.js";
import {
  MAX_PROBES_PER_DAY,
  parseProbes,
  planProbes,
  PROBE_DEADLINE_MARGIN_S,
  PROBE_LATE_LIMIT_MS,
  probeCandidates,
  probeDeadline,
  probeIso,
  probeText,
  type ProbeExpectation,
  type ProbeOutcome,
} from "../probes.js";
import { oneLine } from "../redact.js";
import { gate } from "../refusals.js";
import { abortableSleep } from "./scheduler.js";
import { roundKit, type Gating, type RunDeps, type RunReport } from "./runOnce.js";

/*
 * The probe round: at one MAAT_PROBES instant, under the round lock, one intent built from the vault state alone
 * (probes.ts probeCandidates), no Claude call. It goes through the round's own path (runOnce.ts roundKit): credit
 * actions dropped, the preview, the refusal key, MAAT_MAX_TX_PER_DAY, the gas estimate, the pending entry stored before
 * the send. On top of that, a probe sends only the candidate whose preview is what the calendar at its instant
 * expects: OK in session, MARKET_CLOSED outside it, which the vault then logs once per NYSE date and closed phase.
 */

/** A waiting probe looks at the clock at least this often, so a PC that slept past an instant notices on waking. */
export const PROBE_WAKE_MS = 60_000;

export interface ProbeReport extends RunReport {
  /** The instant, as `2026-11-27T17:58:00Z`. */
  at: string;
  outcome: ProbeOutcome;
  /** Absent when the probe stopped before it read the calendar at its instant. */
  expected?: ProbeExpectation;
  /** Why it sent nothing, as its journal row's note says. */
  why?: string;
}

const isoOfSeconds = (s: bigint) => probeIso(Number(s) * 1000);

/**
 * Runs the probe of instant `atMs` once; `now` is the clock it judges lateness and its deadline by. Every outcome is
 * journaled as a `probe` row and recorded in state.json, except for an instant state.json already holds, which it
 * leaves alone. It never throws for a failed read or send: that ends the probe `halted`, as a round halts.
 */
export async function runProbe(d: RunDeps, atMs: number, now: () => number = Date.now): Promise<ProbeReport> {
  const at = probeIso(atMs);
  const runId = `probe-${at}`;
  const report: RunReport = { runId, status: "done", sent: [], skipped: 0, proposals: 0 };
  const j = d.journal;
  let expected: ProbeExpectation | undefined;

  const prior = d.store.probeOutcome(at);
  if (prior !== undefined) return { ...report, at, outcome: "skipped", why: `already ${prior} before; a probe runs once` };

  const finish = async (outcome: ProbeOutcome, why?: string): Promise<ProbeReport> => {
    await j.append({ kind: "probe", runId, at, ...(expected ? { expected } : {}), outcome, ...(why ? { note: why } : {}) });
    d.store.recordProbe(at, outcome);
    await d.store.save();
    return { ...report, at, outcome, ...(expected ? { expected } : {}), ...(why ? { why } : {}) };
  };

  if (now() - atMs > PROBE_LATE_LIMIT_MS) {
    return finish("missed", `it got the round lock at ${probeIso(now())}, more than ${PROBE_LATE_LIMIT_MS / 60_000} minutes after its time; a probe is never run late`);
  }
  const utcDay = at.slice(0, 10);
  if (d.store.probesRunOn(utcDay) >= MAX_PROBES_PER_DAY) {
    return finish("capped", `${MAX_PROBES_PER_DAY} probes already ran on UTC day ${utcDay}; at most ${MAX_PROBES_PER_DAY} run a day`);
  }
  // Recorded before anything is read or sent: a crash from here on leaves "started", and a restart does not rerun it.
  d.store.recordProbe(at, "started");
  await d.store.save();

  try {
    let s: VaultState;
    try {
      s = await readVaultState(d.stateClient, d.vault);
    } catch (e) {
      if (!(e instanceof StateUnavailable)) throw e;
      await j.append({ kind: "error", runId, message: `state unavailable: ${e.message}` });
      report.status = "no-state";
      return await finish("skipped", `state unavailable: ${e.message}`);
    }
    report.block = s.blockNumber;
    report.marketOpen = s.marketOpen;
    if (getAddress(s.executor) !== getAddress(d.executor)) {
      const message = `vault executor is ${s.executor}, agent is ${d.executor}`;
      await j.append({ kind: "error", runId, message });
      report.status = "wrong-executor";
      return await finish("skipped", message);
    }

    // The probe's expectation is the calendar's at its instant, not at the block it gets to run at.
    const atS = BigInt(Math.floor(atMs / 1000));
    const cal = await readCalendarAt(d.stateClient, s.mandate.calendar, s.mandate.sessionMode, atS, s.blockNumber);
    if (!cal) return await finish("skipped", "the calendar could not be read at the probe's time");
    const want: ProbeExpectation = cal.open ? "OK" : "MARKET_CLOSED";
    expected = want;
    const deadline = cal.open ? probeDeadline(atS, cal.day, s.mandate.sessionMode) : null;

    const k = roundKit(d, runId, report, s);
    /** Why an OK probe may no longer send: the later of the clock and the chain is past its deadline. */
    const pastDeadline = (): string | null => {
      if (!deadline) return null;
      const chain = k.state().timestamp;
      const clock = BigInt(Math.floor(now() / 1000));
      const t = clock > chain ? clock : chain;
      if (t <= deadline.by) return null;
      const margin = `${PROBE_DEADLINE_MARGIN_S} s before ${deadline.close}`;
      return `probe deadline ${isoOfSeconds(deadline.by)} (${margin}) passed at ${isoOfSeconds(t)}; an OK probe is never sent late`;
    };

    const late = pastDeadline();
    if (late) return await finish("skipped", late);
    if (!(await k.reconcileAll())) {
      report.status = "pending-tx";
      return await finish("skipped", "a send from an earlier round may still land; a probe sends nothing until it is settled");
    }
    const candidates = probeCandidates(k.state(), probeText(want, deadline?.close));
    report.proposals = candidates.length;
    if (candidates.length === 0) {
      return await finish("skipped", "no $1 BUY or SELL fits the vault: the caps, the USDC balance, the holdings and maxWeightBps leave none");
    }

    const gating: Gating = (preview, key, logged) => {
      const stop = pastDeadline();
      if (stop) return { send: false, why: stop };
      if (preview !== want) {
        return { send: false, why: preview === "UNKNOWN" ? `the probe expects ${want}; the guard state is unknown (RPC)` : `the probe expects ${want}; the preview is ${preview}` };
      }
      return gate(preview, key, logged);
    };
    const tried: string[] = [];
    for (const [index, p] of candidates.entries()) {
      const h = await k.handle(index, p, { k: "probe" }, { gating, beforeSend: pastDeadline });
      if (h.outcome !== "skipped") return await finish(h.outcome);
      // The preview the probe wanted, refused by the gate (a refusal already logged) or by the deadline: stop there.
      if (h.preview === want || pastDeadline()) return await finish("skipped", h.why);
      tried.push(`${p.action} ${p.symbol}: ${h.why}`);
    }
    return await finish("skipped", `no candidate previewed ${want}: ${tried.join("; ")}`);
  } catch (e) {
    report.status = "halted";
    report.haltReason = oneLine(e);
    await j.append({ kind: "error", runId, message: `halted: ${report.haltReason}` });
    return finish("halted", report.haltReason);
  } finally {
    await d.store.save();
  }
}

/**
 * Reads MAAT_PROBES at a start: what to schedule, and a line for every entry left out. An instant that passed before
 * `startedAt` is journaled as missed (once: state.json then holds it) and never run late; one state.json already holds
 * is reported and not run again. Nothing here throws for a bad value.
 */
export async function probeStartup(
  raw: string | undefined,
  d: Pick<RunDeps, "store" | "journal">,
  startedAt: number,
): Promise<{ problems: string[]; lines: string[]; due: number[] }> {
  const { at, problems } = parseProbes(raw);
  const plan = planProbes(at, startedAt, (iso) => d.store.probeOutcome(iso));
  const lines = plan.earlier.map((e) => `probe ${probeIso(e.at)}: ${e.outcome} before this start; not run again`);
  const start = probeIso(startedAt);
  for (const ms of plan.missed) {
    const iso = probeIso(ms);
    await d.journal.append({ kind: "probe", runId: `probe-${iso}`, at: iso, outcome: "missed", note: `its time passed before this start at ${start}; a probe is never run late` });
    d.store.recordProbe(iso, "missed");
    problems.push(`${iso} is in the past at this start (${start}); journaled as missed, never run late`);
  }
  if (plan.missed.length > 0) await d.store.save();
  lines.push(...plan.due.map((ms) => `probe ${probeIso(ms)}: scheduled`));
  return { problems, lines, due: plan.due };
}

/** The line the agent logs for a probe. */
export function probeLine(r: ProbeReport): string {
  const head = `probe ${r.at}: ${r.outcome}${r.expected ? ` (expected ${r.expected})` : ""}, sent ${r.sent.length}`;
  return r.why ? `${head}; ${oneLine(r.why)}` : head;
}

/**
 * Waits for each instant in `due` (earliest first) and fires it under the round lock, beside runForever. A probe that
 * throws is logged as one redacted line and the next one still runs. Returns how many it fired.
 */
export async function runProbes(o: {
  due: readonly number[];
  fire: (at: number) => Promise<ProbeReport>;
  lock: { run<T>(fn: () => Promise<T>): Promise<T> };
  signal: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (m: string) => void;
}): Promise<number> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? abortableSleep;
  const log = o.log ?? console.log;
  let fired = 0;
  for (const at of o.due) {
    while (!o.signal.aborted && now() < at) await sleep(Math.min(at - now(), PROBE_WAKE_MS), o.signal);
    if (o.signal.aborted) break;
    try {
      log(probeLine(await o.lock.run(() => o.fire(at))));
    } catch (e) {
      log(`probe ${probeIso(at)} failed: ${oneLine(e)}`);
    }
    fired++;
  }
  return fired;
}
