import { etLabel, type JournalRead } from "@/lib/chain/ledger";
import { COMMIT_RE } from "@/lib/chain/rationale";

/** The newest note Maat's agent published: a run row's sanitized summary, as the agent-journal branch holds it. */
export interface AgentNoteView {
  /** The row's `summary`, verbatim: the publisher already sanitized it (spec §3.2). Shown as text, never as markup. */
  summary: string;
  /** Unix seconds of the row's `ts`. */
  ts: number;
  /** "Tue 24 Nov 11:59 ET". */
  when: string;
  /** The agent's commit the row names (40 hex, that and -dirty, or unknown), or null when it names none the spec allows. */
  commit: string | null;
  /** The round's mode, "live" or "dry-run", or null when the row has none. */
  mode: string | null;
  /** The day file and 1-based line on the branch. */
  file: string;
  line: number;
}

/**
 * The tile /now shows under the week (culture plan 2026-11-26, Move 8b): the newest `run` row with a summary and a
 * readable time, or null. Null too while the branch does not exist (today), when it could not be read, and when its
 * hash chain broke anywhere: the newest note the page can vouch for might then not be the newest, so it shows none
 * rather than an older one under the word "Latest".
 */
export function latestNote(read: JournalRead): AgentNoteView | null {
  if (read.state !== "read" || read.failure !== null) return null;
  for (let i = read.rows.length - 1; i >= 0; i--) {
    const row = read.rows[i]!;
    const f = row.fields;
    if (f.kind !== "run" || typeof f.summary !== "string" || f.summary === "") continue;
    const ms = typeof f.ts === "string" ? Date.parse(f.ts) : Number.NaN;
    if (Number.isNaN(ms)) continue;
    const ts = Math.floor(ms / 1000);
    return {
      summary: f.summary,
      ts: ms / 1000,
      when: `${etLabel(ts)} ET`,
      commit: typeof f.commit === "string" && COMMIT_RE.test(f.commit) ? f.commit : null,
      mode: typeof f.mode === "string" ? f.mode : null,
      file: row.file,
      line: row.line,
    };
  }
  return null;
}
