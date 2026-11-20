"use client";

import { type MouseEvent, useEffect, useRef } from "react";
import { NAV_TOKENS } from "@/content/b20-nav";
import type { LiveState } from "@/lib/live/freshness";
import { formatAge, formatBlock, formatEt, formatUtc } from "@/lib/live/format";
import type { LiveReader } from "@/lib/live/rpc";
import { headlineText } from "@/lib/live/verdict";
import { useLiveSnapshot } from "./useLiveSnapshot";
import { VerdictLine } from "./VerdictLine";

const READING = "Reading Base mainnet…";
const FAILED = "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.";

const blockUrl = (n: bigint) => `https://basescan.org/block/${n}`;

/** What the polite region says: the status and the verdict only, so a new block every refresh is not read aloud. */
function announcement(state: LiveState): string {
  switch (state.status) {
    case "reading":
      return READING;
    case "error":
      return FAILED;
    case "live":
      return `Live. ${headlineText(state.reading.headline)}`;
    case "stale":
    case "behind":
      return `Not live. ${headlineText(state.reading.headline)}`;
  }
}

/** A pill no taller than the 20 px line, so the strip keeps its line height. */
const PILL = "mr-1 inline-flex items-center gap-1.5 rounded-full px-2 align-[1px] font-mono text-[11px] font-semibold leading-4";

/**
 * The mark between two parts of the line, wider apart than the "·" inside a part. The spaces around it are real, so the
 * line can wrap there and a screen reader keeps the parts apart; the mark itself is visual only.
 */
function Sep({ mark = "·" }: { mark?: "·" | "—" }) {
  return (
    <>
      {" "}
      <span aria-hidden="true" className="mx-1">
        {mark}
      </span>{" "}
    </>
  );
}

function BlockLink({ n, children }: { n: bigint; children: string }) {
  return (
    <a href={blockUrl(n)} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-mono text-[12px]">
      {children}
    </a>
  );
}

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
          {/* While the retry reads, the button stays where it is and keeps focus: aria-disabled, not disabled, since a
              disabled button loses focus to the page. */}
          <button
            type="button"
            onClick={onRetry}
            aria-disabled={refreshing || undefined}
            className="ml-1 h-6 cursor-pointer rounded-full border border-line-strong bg-transparent px-2.5 align-middle text-[12px] font-medium text-ink hover:border-ink aria-disabled:cursor-wait aria-disabled:text-ink-2 aria-disabled:hover:border-line-strong"
          >
            {refreshing ? "Retrying…" : "Retry"}
          </button>
        </p>
      );
    case "live": {
      const { snapshot, session, headline } = state.reading;
      return (
        <p className="m-0">
          <span className={`${PILL} bg-accent-tint py-px text-accent`}>
            <span aria-hidden="true" className="anim-live size-1.5 rounded-full bg-accent" />
            LIVE
          </span>{" "}
          <BlockLink n={snapshot.block}>{`Base block ${formatBlock(snapshot.block)}`}</BlockLink>
          <Sep />
          <span className="whitespace-nowrap font-mono text-[12px]">
            {formatUtc(snapshot.timestamp)} · {formatEt(snapshot.timestamp)}
          </span>
          <Sep />
          <span>{session.detail}</span>
          <Sep mark="—" />
          <VerdictLine headline={headline} tone="ink" />
          <Sep />
          <NowLink />
        </p>
      );
    }
    case "stale":
    case "behind": {
      const { snapshot, headline } = state.reading;
      const block = <BlockLink n={snapshot.block}>{formatBlock(snapshot.block)}</BlockLink>;
      return (
        <p className="m-0">
          <span className={`${PILL} border border-ink-2 text-ink-2`}>NOT LIVE</span>{" "}
          {state.status === "stale" ? (
            <span>
              last read block {block}, {formatAge(state.ageMs / 1000)} ago
              {state.refreshFailed ? " · the RPC did not answer since" : ""}
            </span>
          ) : (
            <span>
              the RPC&apos;s latest block {block} is {formatAge(state.lagSec)} behind your clock
            </span>
          )}
          <Sep mark="—" />
          <VerdictLine headline={headline} tone="muted" />
          <Sep />
          <NowLink />
        </p>
      );
    }
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

/**
 * A quiet line under the landing H1: the Base block this browser read, its NYSE session, and what an agent under the
 * default mandate would do with a BUY of each basket token. The static HTML holds the reading state only; no chain
 * value is ever baked in.
 */
export function LiveStrip({ reader }: { reader?: LiveReader }) {
  const { state, refresh, refreshing } = useLiveSnapshot({ reader });
  const box = useRef<HTMLDivElement>(null);
  const focusAfterRetry = useRef(false);

  const onRetry = (e: MouseEvent<HTMLButtonElement>) => {
    if (refreshing) return;
    focusAfterRetry.current = document.activeElement === e.currentTarget;
    refresh();
  };

  // A retry that worked takes the focused Retry button away with the error; the focus goes to the strip, not the page.
  useEffect(() => {
    if (refreshing || !focusAfterRetry.current) return;
    focusAfterRetry.current = false;
    if (state.status !== "error") box.current?.focus();
  }, [refreshing, state.status]);

  return (
    <div ref={box} tabIndex={-1} data-live-strip={state.status} className={`${RESERVE} text-[13px] leading-5 text-ink-2`}>
      {/* The only live region: it changes when the status or the verdict does, never for a new block alone. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement(state)}
      </span>
      <Body state={state} refreshing={refreshing} onRetry={onRetry} />
      <noscript>
        <p className="m-0">
          The live line needs JavaScript. <a href="/now">Right now on Base</a> explains what it reads.
        </p>
      </noscript>
    </div>
  );
}
