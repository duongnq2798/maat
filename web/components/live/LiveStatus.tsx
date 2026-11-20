import { type MouseEvent, useEffect, useRef } from "react";
import { basescanBlock } from "@/lib/live/basescan";
import type { LiveState } from "@/lib/live/freshness";
import { formatAge, formatBlock } from "@/lib/live/format";
import { headlineText } from "@/lib/live/verdict";

/**
 * The pieces the landing strip and /now share: the reading and failure sentences, the LIVE / NOT LIVE pill, the block
 * link, why a reading is not live, the one polite live region, and a Retry that keeps its focus.
 */
export const READING = "Reading Base mainnet…";
export const FAILED = "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.";

/** A reading the page can show: live, or not live with the reason. */
export type ShownState = Extract<LiveState, { reading: unknown }>;

/** What the polite region says: the status and the verdict only, so a new block every refresh is not read aloud. */
export function announcement(state: LiveState): string {
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

/** The only live region: it changes when the status or the verdict does, never for a new block alone. */
export function LiveAnnouncer({ state }: { state: LiveState }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {announcement(state)}
    </span>
  );
}

/** A pill no taller than the 20 px line, so the line keeps its height. */
const PILL = "mr-1 inline-flex items-center gap-1.5 rounded-full px-2 align-[1px] font-mono text-[11px] font-semibold leading-4";

/** LIVE for a live reading, NOT LIVE for any other reading. */
export function LivePill({ live }: { live: boolean }) {
  return live ? (
    <span className={`${PILL} bg-accent-tint py-px text-accent`}>
      <span aria-hidden="true" className="anim-live size-1.5 rounded-full bg-accent" />
      LIVE
    </span>
  ) : (
    <span className={`${PILL} border border-ink-2 text-ink-2`}>NOT LIVE</span>
  );
}

/**
 * The mark between two parts of the line, wider apart than the "·" inside a part. The spaces around it are real, so the
 * line can wrap there and a screen reader keeps the parts apart; the mark itself is visual only.
 */
export function Sep({ mark = "·" }: { mark?: "·" | "—" }) {
  return (
    <>
      {" "}
      <span aria-hidden="true" className="mx-1">
        {mark}
      </span>{" "}
    </>
  );
}

export function BlockLink({ n, children }: { n: bigint; children: string }) {
  return (
    <a href={basescanBlock(n)} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-mono text-[12px]">
      {children}
    </a>
  );
}

/** Why a reading is not live: it aged or a refresh failed (stale), or the RPC's head was behind the visitor's clock. */
export function NotLiveWhy({ state }: { state: ShownState }) {
  const block = <BlockLink n={state.reading.snapshot.block}>{formatBlock(state.reading.snapshot.block)}</BlockLink>;
  return state.status === "behind" ? (
    <span>
      the RPC&apos;s latest block {block} is {formatAge(state.lagSec)} behind your clock
    </span>
  ) : (
    <span>
      last read block {block}, {formatAge(state.ageMs / 1000)} ago
      {state.refreshFailed ? " · the RPC did not answer since" : ""}
    </span>
  );
}

const READ_BUTTON =
  "cursor-pointer rounded-full border border-line-strong bg-transparent align-middle font-medium text-ink hover:border-ink aria-disabled:cursor-wait aria-disabled:text-ink-2 aria-disabled:hover:border-line-strong";

/**
 * Retry or Refresh. While the read is in flight the button stays where it is and keeps focus: aria-disabled, not
 * disabled, since a disabled button loses focus to the page.
 */
export function ReadButton({
  refreshing,
  onClick,
  idle,
  busy,
  className,
}: {
  refreshing: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  idle: string;
  busy: string;
  /** The button's size. */
  className: string;
}) {
  return (
    <button type="button" onClick={onClick} aria-disabled={refreshing || undefined} className={`${READ_BUTTON} ${className}`}>
      {refreshing ? busy : idle}
    </button>
  );
}

/**
 * A Retry for the failed first read. A retry that works takes the focused Retry button away with the error, so the focus
 * goes to `box` (give it tabIndex -1), not to the page. A click while a read is in flight does nothing.
 */
export function useRetry(state: LiveState, refreshing: boolean, refresh: () => void) {
  const box = useRef<HTMLDivElement>(null);
  const focusAfterRetry = useRef(false);

  const onRetry = (e: MouseEvent<HTMLButtonElement>) => {
    if (refreshing) return;
    focusAfterRetry.current = document.activeElement === e.currentTarget;
    refresh();
  };

  useEffect(() => {
    if (refreshing || !focusAfterRetry.current) return;
    focusAfterRetry.current = false;
    if (state.status !== "error") box.current?.focus();
  }, [refreshing, state.status]);

  return { box, onRetry };
}
