"use client";

import { CommitRef } from "@/components/ledger/AgentTrail";
import { useJournal } from "@/components/ledger/useJournal";
import { JOURNAL_BRANCH_URL, readJournal, type JournalRead } from "@/lib/chain/ledger";
import { latestNote } from "@/lib/live/journal-note";

/**
 * "Latest note from Maat's agent" (culture plan 2026-11-26, Move 8b): the newest run summary on the public agent-journal
 * branch, verbatim, with its time in New York and the agent's commit that wrote it, read once when the page opens with
 * the reader /ledger's Rounds tab and /ask use (readJournal), which checks the whole hash chain first. While the branch
 * does not exist, while it is read, when the read fails or the chain breaks, and when no round has a summary, it renders
 * nothing at all: no placeholder stands in for a note. The summary reaches React as a string child, so it is text, never
 * markup. `read` is for tests.
 */
export function AgentNote({ read = readJournal }: { read?: () => Promise<JournalRead> }) {
  const journal = useJournal(true, 0, read);
  const note = journal.state === "read" ? latestNote(journal) : null;
  if (note === null) return null;
  return (
    <figure data-agent-note="" className="card m-0 flex max-w-[820px] flex-col gap-3 p-5 sm:p-6">
      <figcaption data-agent-note-head="" className="font-mono text-[12px] leading-5 text-ink-2 [&_a]:underline [&_a]:underline-offset-2">
        Latest note from Maat&apos;s agent · {note.when} · journal{" "}
        {note.commit === null ? `${note.file} line ${note.line}` : <CommitRef commit={note.commit} />}
      </figcaption>
      <blockquote dir="auto" className="m-0 whitespace-pre-wrap text-[19px] leading-relaxed text-ink [overflow-wrap:anywhere]">
        {note.summary}
      </blockquote>
      <p className="m-0 text-[13px] leading-normal text-ink-2">
        Copied verbatim from journal/{note.file}, line {note.line}, on the{" "}
        <a href={JOURNAL_BRANCH_URL} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-2">
          agent-journal branch<span aria-hidden="true"> ↗</span>
        </a>
        , after your browser checked the hash of every line.{note.mode === "dry-run" ? " A dry-run round: it sent nothing." : ""}
      </p>
    </figure>
  );
}
