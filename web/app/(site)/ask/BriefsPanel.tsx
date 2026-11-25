"use client";

import { useEffect, useState } from "react";
import { HIDDEN_BRIEFS } from "@/content/ask-hidden";
import { briefCounts, briefFeed, readBriefs, type Brief, type InboxDeployment } from "@/lib/chain/inbox";
import { errorText, type LedgerClient } from "@/lib/chain/load";
import { BriefCounters, BriefFeed } from "./BriefFeed";

type Read = { state: "reading" } | { state: "read"; briefs: Brief[]; complete: boolean } | { state: "error"; message: string };

/** The counters and the feed, read from the inbox's Brief logs; read again whenever `reloadKey` changes. */
export function BriefsPanel({ inbox, client, reloadKey, hidden = HIDDEN_BRIEFS }: { inbox: InboxDeployment; client: LedgerClient; reloadKey: number; hidden?: readonly number[] }) {
  const [read, setRead] = useState<Read>({ state: "reading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    readBriefs(client, { inbox: inbox.inbox, deployTx: inbox.deployTx, signal: controller.signal })
      .then((r) => setRead({ state: "read", briefs: r.briefs, complete: r.complete }))
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setRead({ state: "error", message: errorText(e) });
      });
    return () => controller.abort();
  }, [client, inbox, reloadKey, attempt]);

  const briefs = read.state === "read" ? read.briefs : null;
  return (
    <div className="flex flex-col gap-8">
      <BriefCounters counts={briefs ? briefCounts(briefs, hidden) : null} />
      {read.state === "reading" ? <p className="m-0 text-[15px] text-ink-2">Reading briefs from Base…</p> : null}
      {read.state === "error" || (read.state === "read" && !read.complete) ? (
        <p className="m-0 flex flex-wrap items-center gap-3 text-[15px] text-refuse">
          {read.state === "error" ? `The briefs could not be read: ${read.message}` : "Some blocks could not be read, so briefs may be missing."}
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className="pill-line cursor-pointer bg-white">
            Read again
          </button>
        </p>
      ) : null}
      {briefs ? <BriefFeed items={briefFeed(briefs, hidden)} /> : null}
    </div>
  );
}
