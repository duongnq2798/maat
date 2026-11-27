import note from "@/content/generated/agent-note.json";
import { SITE } from "@/lib/site";

/** The note as scripts/agent-note.ts writes it (lib/live/journal-note.ts, AgentNoteView). */
interface RecordedNote {
  summary: string;
  when: string;
  file: string;
  line: number;
}

/** The line of the agent-journal branch the note was copied from, on GitHub: a link, read only when it is followed. */
export function journalLineUrl(n: Pick<RecordedNote, "file" | "line">): string {
  return `${SITE.repoUrl}/blob/agent-journal/journal/${n.file}#L${n.line}`;
}

/**
 * Under the vault card (spec 2026-11-27, landing "explain in 10 seconds", section 1): the newest round summary of
 * Maat's agent when this build was made, the same verified note /now shows, so a quiet day reads as a choice. It is
 * recorded in the build by `npm run agent-note`, after the whole hash chain of the public journal verified; the landing
 * reads no journal of its own, so nothing reaches GitHub until a visitor follows a link. /now reads the newest round
 * live. The summary is a string child, so it is text, never markup.
 */
export function HeroNote({ recorded = note.note }: { recorded?: RecordedNote | null }) {
  if (recorded === null) return null;
  return (
    <figure data-hero-note="" className="m-0 flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface-soft px-5 py-4">
      <figcaption className="font-mono text-[12px] leading-5 text-ink-2">
        Maat&apos;s agent, last round recorded in this build · {recorded.when}
      </figcaption>
      <blockquote dir="auto" className="m-0 text-[15px] leading-[1.55] text-ink [overflow-wrap:anywhere]">
        {recorded.summary}
      </blockquote>
      <p className="m-0 text-[13px] leading-normal text-ink-2">
        Copied verbatim from the public journal,{" "}
        <a href={journalLineUrl(recorded)} target="_blank" rel="noopener noreferrer" className="tap font-medium">
          journal/{recorded.file} line {recorded.line}
          <span aria-hidden="true"> ↗</span>
        </a>
        , after its hash chain checked.{" "}
        <a href="/now" className="tap font-medium">
          Newer rounds on /now
          <span aria-hidden="true"> →</span>
        </a>
      </p>
    </figure>
  );
}
