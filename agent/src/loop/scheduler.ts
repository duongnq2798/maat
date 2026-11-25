import { setTimeout as delay } from "node:timers/promises";
import { oneLine } from "../redact.js";
import type { RunReport } from "./runOnce.js";

export const IN_SESSION_MS = 15 * 60_000;
export const OFF_SESSION_MS = 60 * 60_000;

export function nextDelayMs(r: RunReport | null): number {
  return r?.marketOpen === true ? IN_SESSION_MS : OFF_SESSION_MS;
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
}

/**
 * One round at a time: await the round, then sleep. A failed round is logged and retried on the slow cadence. Every
 * round logs one line, and a failure's text is redacted (no URL, key or secret), never a stack.
 */
export async function runForever(o: {
  run: () => Promise<RunReport>;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (m: string) => void;
  /** Called after every round, failed ones included (main.ts writes the heartbeat). Its own failure is logged. */
  afterRound?: (r: { report: RunReport | null; error: string | null }) => Promise<void>;
}): Promise<number> {
  const sleep = o.sleep ?? abortableSleep;
  const log = o.log ?? console.log;
  let runs = 0;
  while (!o.signal.aborted) {
    let report: RunReport | null = null;
    let error: string | null = null;
    try {
      report = await o.run();
      const counts = `round ${report.runId}: ${report.status}, sent ${report.sent.length}, skipped ${report.skipped}`;
      // runOnce already redacted the halt reason (oneLine).
      const line = report.haltReason ? `${counts} (${report.haltReason})` : counts;
      // A failed Claude call leaves the round "done", so the run line's error goes on the line too.
      log(report.error ? `${line}; error: ${oneLine(report.error)}` : line);
    } catch (e) {
      error = `${e instanceof Error && e.name !== "Error" ? `${e.name}: ` : ""}${oneLine(e)}`;
      log(`round failed: ${error}`);
    }
    if (o.afterRound) {
      try {
        await o.afterRound({ report, error });
      } catch (e) {
        log(`after round: ${oneLine(e)}`);
      }
    }
    runs++;
    if (o.signal.aborted) break;
    await sleep(nextDelayMs(report), o.signal);
  }
  return runs;
}
