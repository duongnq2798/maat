"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { formatCount } from "@/app/(site)/proof/count";
import type { ProofClient } from "@/app/(site)/proof/load";
import type { TeamInputs } from "@/app/(site)/proof/team";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { useJournal, type JournalView } from "@/components/ledger/useJournal";
import {
  briefAnswers,
  readBriefs,
  readBriefVerdicts,
  weighingCounts,
  weighings,
  type Brief,
  type BriefRead,
  type InboxDeployment,
  type JournalSource,
  type TeamSource,
  type VerdictSource,
  type WeighingSources,
} from "@/lib/chain/inbox";
import { readJournal, type JournalRead } from "@/lib/chain/ledger";
import { errorText, type LedgerClient } from "@/lib/chain/load";
import { fetchBriefsSnapshotJson } from "@/lib/chain/snapshot";
import { BriefCounters, BriefFeed } from "./BriefFeed";
import { traceTeamReader, type TeamReader } from "./team-set";

type Read =
  | { state: "reading" }
  | { state: "read"; briefs: Brief[]; complete: boolean; head: bigint; fromSnapshot: BriefRead["fromSnapshot"] }
  | { state: "error"; message: string };

/** The journal as the feed reads it: the agent's answer to each brief once the branch is read. */
function journalSource(view: JournalView, briefs: readonly Brief[]): JournalSource {
  if (view.state === "idle" || view.state === "loading") return { state: "reading" };
  if (view.state !== "read") return view;
  return { state: "read", answers: briefAnswers(view.rows, briefs), complete: view.failure === null };
}

/**
 * The counters and the feed of weighings. The Brief logs come first, read again whenever `reloadKey` changes, from the
 * committed Brief snapshot once Base confirms it and from Base after it; once they are read, three sources are read
 * beside them, each for its own piece of every weighing: the published agent journal (the reply and the adopted flag),
 * the vault's brief-keyed Decision logs (the verdict), and /proof's team set (the "team" mark and the team's own line).
 * With no brief none of the three is needed.
 */
export function BriefsPanel({
  inbox,
  vault,
  deployments,
  client,
  reloadKey,
  hidden = HIDDEN_BRIEFS,
  journal: readAnswers = readJournal,
  team: readTeam,
  briefsSnapshot = fetchBriefsSnapshotJson,
}: {
  inbox: InboxDeployment;
  vault: Address;
  /** The Base mainnet rows of deployments/README.md, where the team trace starts. */
  deployments: TeamInputs["deployments"];
  client: LedgerClient;
  reloadKey: number;
  hidden?: readonly number[];
  journal?: () => Promise<JournalRead>;
  /** Reads /proof's team set; the page's own trace (traceTeamReader) when unset. */
  team?: TeamReader;
  /** The committed Brief snapshot, as /data/briefs-snapshot.json serves it; fetched once, when the panel mounts. */
  briefsSnapshot?: () => Promise<unknown>;
}) {
  const [read, setRead] = useState<Read>({ state: "reading" });
  const [attempt, setAttempt] = useState(0);
  const [verdicts, setVerdicts] = useState<VerdictSource>({ state: "reading" });
  const [team, setTeam] = useState<TeamSource>({ state: "reading" });
  // The file does not change while the page is open, so every read of the Brief logs starts from the same fetch.
  const [committed] = useState(() => briefsSnapshot().catch(() => null));

  useEffect(() => {
    const controller = new AbortController();
    readBriefs(client, { inbox: inbox.inbox, deployTx: inbox.deployTx, signal: controller.signal, snapshot: committed })
      .then((r) => setRead({ state: "read", briefs: r.briefs, complete: r.complete, head: r.head, fromSnapshot: r.fromSnapshot }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setRead({ state: "error", message: errorText(e) });
      });
    return () => controller.abort();
  }, [client, inbox, reloadKey, attempt, committed]);

  // The verdicts and the team set, for the briefs just read, at the block they were read to.
  useEffect(() => {
    if (read.state !== "read") return;
    const controller = new AbortController();
    const { briefs, head, complete } = read;
    const fail = (set: (s: { state: "error"; message: string }) => void) => (e: unknown) => {
      if (!controller.signal.aborted) set({ state: "error", message: errorText(e) });
    };
    if (briefs.length === 0) {
      setVerdicts({ state: "read", byBrief: new Map(), complete: true });
      setTeam({ state: "read", members: new Set(), complete: true });
      return () => controller.abort();
    }
    setVerdicts({ state: "reading" });
    setTeam({ state: "reading" });
    const from = briefs.reduce((lo, b) => (b.blockNumber < lo ? b.blockNumber : lo), briefs[0]!.blockNumber);
    readBriefVerdicts(client, { vault, from, head, signal: controller.signal })
      .then((r) => !controller.signal.aborted && setVerdicts({ state: "read", ...r }))
      .catch(fail(setVerdicts));
    (readTeam ?? traceTeamReader(client as ProofClient, deployments))(briefs, { head, complete, signal: controller.signal })
      .then((t) => !controller.signal.aborted && setTeam({ state: "read", ...t }))
      .catch(fail(setTeam));
    return () => controller.abort();
  }, [read, client, vault, deployments, readTeam]);

  const briefs = read.state === "read" ? read.briefs : null;
  const journal = useJournal(briefs !== null, reloadKey, readAnswers);
  const sources: WeighingSources | null = briefs ? { briefs, hidden, journal: journalSource(journal, briefs), verdicts, team } : null;
  return (
    <div className="flex flex-col gap-8">
      <BriefCounters counts={sources ? weighingCounts(sources) : null} />
      {read.state === "reading" ? <p className="m-0 text-[15px] text-ink-2">Reading briefs from Base…</p> : null}
      {read.state === "error" || (read.state === "read" && !read.complete) ? (
        <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-refuse">
          {read.state === "error" ? `The briefs could not be read: ${read.message}` : "Some blocks could not be read, so briefs may be missing."}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="pill-line cursor-pointer bg-white">
            Read again
          </button>
        </p>
      ) : null}
      {sources ? (
        <div className="flex flex-col gap-1.5 text-[13px] leading-normal text-ink-2 empty:hidden">
          {read.state === "read" && read.fromSnapshot ? (
            <p data-briefs-snapshot="" className="m-0">
              Brief logs to block {formatCount(Number(read.fromSnapshot.to))} are from the committed Brief snapshot of block{" "}
              {formatCount(Number(read.fromSnapshot.block))}, which Base confirmed; the rest were read from Base.
            </p>
          ) : null}
          {journal.state === "error" ? <p className="m-0">The agent&apos;s answers could not be read from its journal: {journal.message}</p> : null}
          {verdicts.state === "error" ? <p className="m-0">The vault&apos;s Decisions could not be read, so no verdict is shown: {verdicts.message}</p> : null}
          {team.state === "error" ? <p className="m-0">/proof&apos;s team set could not be traced, so no brief is marked team: {team.message}</p> : null}
          {team.state === "read" && !team.complete ? (
            <p className="m-0">/proof&apos;s team set is incomplete at this block, so no brief is marked team and no line is split. /proof names what is missing.</p>
          ) : null}
        </div>
      ) : null}
      {sources ? <BriefFeed items={weighings(sources)} /> : null}
    </div>
  );
}
