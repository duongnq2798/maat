import { setTimeout as delay } from "node:timers/promises";
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

/** One round at a time: await the round, then sleep. A failed round is logged and retried on the slow cadence. */
export async function runForever(o: {
  run: () => Promise<RunReport>;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (m: string) => void;
}): Promise<number> {
  const sleep = o.sleep ?? abortableSleep;
  const log = o.log ?? console.log;
  let runs = 0;
  while (!o.signal.aborted) {
    let report: RunReport | null = null;
    try {
      report = await o.run();
      log(`round ${report.runId}: ${report.status}, sent ${report.sent.length}, skipped ${report.skipped}`);
    } catch (e) {
      log(`round failed: ${(e as Error).stack ?? e}`);
    }
    runs++;
    if (o.signal.aborted) break;
    await sleep(nextDelayMs(report), o.signal);
  }
  return runs;
}
