"use client";

import type { MouseEvent } from "react";
import { NAV_TOKENS } from "@/content/b20-nav";
import type { LiveState } from "@/lib/live/freshness";
import { formatBlock, formatEt, formatUtc } from "@/lib/live/format";
import type { LiveReader } from "@/lib/live/rpc";
import { BlockLink, FAILED, LiveAnnouncer, LivePill, NotLiveWhy, READING, ReadButton, Sep, useRetry } from "./LiveStatus";
import { LiveSnapshotProvider, type LiveSnapshotValue, useLive, useLiveIfAny } from "./LiveSnapshotProvider";
import { VerdictLine } from "./VerdictLine";

function NowLink() {
  return (
    <a href="/now" className="whitespace-nowrap font-medium">
      All {NAV_TOKENS.length} B20s <span aria-hidden="true">→</span>
    </a>
  );
}

interface BodyProps {
  state: LiveState;
  refreshing: boolean;
  onRetry: (e: MouseEvent<HTMLButtonElement>) => void;
}

function Body({ state, refreshing, onRetry }: BodyProps) {
  switch (state.status) {
    case "reading":
      return <p className="m-0">{READING}</p>;
    case "error":
      return (
        <p className="m-0 text-ink">
          {FAILED}{" "}
          <ReadButton refreshing={refreshing} onClick={onRetry} idle="Retry" busy="Retrying…" className="ml-1 h-6 px-2.5 text-[12px]" />
        </p>
      );
    case "live": {
      const { snapshot, session, headline } = state.reading;
      return (
        <p className="m-0">
          <LivePill live />{" "}
          <BlockLink n={snapshot.block}>{`Base block ${formatBlock(snapshot.block)}`}</BlockLink>
          <Sep />
          <span className="whitespace-nowrap font-mono text-[12px]">
            {formatUtc(snapshot.timestamp)} · {formatEt(snapshot.timestamp)}
          </span>
          <Sep />
          <span>{session.detail}</span>
          <Sep mark="—" />
          <VerdictLine headline={headline} tone="ink" methodHref="/now#method" />
          <Sep />
          <NowLink />
        </p>
      );
    }
    case "stale":
    case "behind":
      return (
        <p className="m-0">
          <LivePill live={false} /> <NotLiveWhy state={state} />
          <Sep mark="—" />
          <VerdictLine headline={state.reading.headline} tone="muted" methodHref="/now#method" />
          <Sep />
          <NowLink />
        </p>
      );
  }
}

/**
 * The height of the tallest line the strip can show, measured in the browser (20 px lines): live, with three different
 * refusals and "Wednesday · open until 16:00 ET". It is 160 px at a 375 px phone (343 px wide), 80 px from 640 px (the
 * one-column hero, 608 to 935 px wide), 120 px from 1000 px (the two-column hero, 440 px wide) and 100 px from 1280 px
 * (560 px wide). Every state is reserved up front, so the landing never moves when a reading arrives; a short weekend
 * line leaves the rest empty. Phones narrower than 375 px still grow a line for that three-refusal headline only.
 * 62.5rem (1000 px), where the hero's grid takes two columns, is in rem so Tailwind sorts it between sm (40rem) and
 * xl (80rem).
 */
const RESERVE = "min-h-40 sm:min-h-20 min-[62.5rem]:min-h-30 xl:min-h-25";

/** The strip itself, on the page's one snapshot. */
function Strip({ live }: { live: LiveSnapshotValue }) {
  const { state, refresh, refreshing } = live;
  const { box, onRetry } = useRetry(state, refreshing, refresh);

  return (
    <div ref={box} tabIndex={-1} data-live-strip={state.status} className={`${RESERVE} text-[13px] leading-5 text-ink-2`}>
      <LiveAnnouncer state={state} />
      <Body state={state} refreshing={refreshing} onRetry={onRetry} />
      <noscript>
        <p className="m-0">
          The live line needs JavaScript. <a href="/now">Right now on Base</a> explains what it reads.
        </p>
      </noscript>
    </div>
  );
}

/** A strip that made its own provider: it reads the snapshot from there. */
function SharedStrip() {
  return <Strip live={useLive()} />;
}

/**
 * A quiet line under the landing H1: the Base block this browser read, its NYSE session, and what an agent under the
 * default mandate would do with a BUY of each basket token. The static HTML holds the reading state only; no chain
 * value is ever baked in. Under a LiveSnapshotProvider it reads the page's snapshot, and `reader` is not used; with
 * none above it (a test that renders the Hero alone), it runs a provider of its own with `reader`.
 */
export function LiveStrip({ reader }: { reader?: LiveReader }) {
  const live = useLiveIfAny();
  if (live !== null) return <Strip live={live} />;
  return (
    <LiveSnapshotProvider reader={reader}>
      <SharedStrip />
    </LiveSnapshotProvider>
  );
}
