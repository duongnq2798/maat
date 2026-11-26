import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { oneLine } from "../redact.js";
import type { RunReport } from "./runOnce.js";

/** Written to the data dir after every round, failed rounds included. */
export const HEARTBEAT_FILE = "heartbeat.json";
/** The restart loop warns when the last round ended longer ago than this. The scheduler sleeps at most 60 min. */
export const STALE_AFTER_MS = 90 * 60_000;

export interface Heartbeat {
  /** When the round ended (ISO 8601, UTC). */
  ts: string;
  pid: number;
  /** The round's status, or "failed" when it threw. */
  status: RunReport["status"] | "failed";
  runId?: string;
  sent?: number;
  /** The error of a round that threw, else the halt reason and the error of the round's run line, one redacted line each. */
  error?: string;
}

/**
 * The heartbeat for a round that returned `report` or threw `error` (already one redacted line). A failed Claude call
 * or the daily LLM cap leaves the round "done", so the error of its run line goes in too, as on the loop's console line.
 */
export function heartbeatOf(r: { report: RunReport | null; error: string | null }, now: Date, pid: number): Heartbeat {
  const runError = r.report?.error ? oneLine(r.report.error) : undefined;
  const fromReport = [r.report?.haltReason, runError].filter((s) => s).join("; error: ");
  const why = r.error ?? (fromReport || undefined);
  return {
    ts: now.toISOString(),
    pid,
    status: r.report?.status ?? "failed",
    ...(r.report ? { runId: r.report.runId, sent: r.report.sent.length } : {}),
    ...(why ? { error: why } : {}),
  };
}

/** Replaces the file in one rename, so a reader never sees half a heartbeat. */
export async function writeHeartbeat(dir: string, beat: Heartbeat): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, HEARTBEAT_FILE);
  await writeFile(`${file}.tmp`, JSON.stringify(beat) + "\n");
  await rename(`${file}.tmp`, file);
}

/** The last heartbeat in `dir`; null when there is none yet. Throws when the file is not a heartbeat. */
export async function readHeartbeat(dir: string): Promise<Heartbeat | null> {
  let text: string;
  try {
    text = await readFile(join(dir, HEARTBEAT_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const beat = JSON.parse(text) as Heartbeat;
  if (typeof beat.ts !== "string" || Number.isNaN(Date.parse(beat.ts))) throw new Error(`${HEARTBEAT_FILE} has no valid ts`);
  return beat;
}

/** How long ago the heartbeat's round ended, in ms (negative if the clock moved back). */
export function heartbeatAgeMs(beat: Heartbeat, nowMs: number): number {
  return nowMs - Date.parse(beat.ts);
}

/** "45 s", "12 min", "2 h 5 min". */
export function describeAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** One line on the last round, for the heartbeat check and the restart loop. */
export function describeHeartbeat(beat: Heartbeat, nowMs: number): string {
  const round = beat.runId ? `round ${beat.runId}` : "a round";
  const sent = beat.sent === undefined ? "" : `, sent ${beat.sent}`;
  const why = beat.error ? ` (${beat.error})` : "";
  return `last round ended ${describeAge(heartbeatAgeMs(beat, nowMs))} ago at ${beat.ts}: ${round} ${beat.status}${sent}${why}, agent pid ${beat.pid}`;
}
