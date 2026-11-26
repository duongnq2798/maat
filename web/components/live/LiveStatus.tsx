import { type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import type { Surface } from "@/components/instrument/types";
import { basescanBlock } from "@/lib/live/basescan";
import type { LiveState } from "@/lib/live/freshness";
import { formatAge, formatBlock } from "@/lib/live/format";
import { headlineText } from "@/lib/live/verdict";

/**
 * The pieces the landing strip and /now share: the reading and failure sentences, the LIVE / NOT LIVE pill, the block
 * link, why a reading is not live, the one polite live region, and a Retry that keeps its focus. Each visible piece
 * takes a palette: "faceplate", the default, is /now's white board with today's classes; "chassis" is the landing's
 * Readout, in lcd and pass-lit on the dark window.
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

/** The pill's colours on each surface. The faceplate's are NowBoard's, byte for byte. */
const LIVE_PILL: Readonly<Record<Surface, { live: string; dot: string; notLive: string }>> = {
  faceplate: { live: "bg-accent-tint py-px text-accent", dot: "bg-accent", notLive: "border border-ink-2 text-ink-2" },
  chassis: { live: "readout-lit border border-pass-lit text-pass-lit", dot: "bg-pass-lit", notLive: "border border-lcd-2 text-lcd-2" },
};

/** LIVE for a live reading, NOT LIVE for any other reading. */
export function LivePill({ live, palette = "faceplate" }: { live: boolean; palette?: Surface }) {
  const p = LIVE_PILL[palette];
  return live ? (
    <span className={`${PILL} ${p.live}`}>
      <span aria-hidden="true" className={`anim-live size-1.5 rounded-full ${p.dot}`} />
      LIVE
    </span>
  ) : (
    <span className={`${PILL} ${p.notLive}`}>NOT LIVE</span>
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

const BLOCK_LINK: Readonly<Record<Surface, string>> = {
  faceplate: "whitespace-nowrap font-mono text-[12px]",
  chassis: "whitespace-nowrap font-mono text-[12px] text-pass-lit",
};

/**
 * A block, linked on Basescan. `label` names the link whole when its content is not one string: the strip's link
 * holds one Digits cell per character, and engines may join those cells into a name differently.
 */
export function BlockLink({
  n,
  children,
  label,
  palette = "faceplate",
}: {
  n: bigint;
  children: ReactNode;
  label?: string;
  palette?: Surface;
}) {
  return (
    <a href={basescanBlock(n)} target="_blank" rel="noopener noreferrer" aria-label={label} className={BLOCK_LINK[palette]}>
      {children}
    </a>
  );
}

/** Why a reading is not live: it aged or a refresh failed (stale), or the RPC's head was behind the visitor's clock. */
export function NotLiveWhy({ state, palette = "faceplate" }: { state: ShownState; palette?: Surface }) {
  const block = (
    <BlockLink n={state.reading.snapshot.block} palette={palette}>
      {formatBlock(state.reading.snapshot.block)}
    </BlockLink>
  );
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

const READ_BUTTON: Readonly<Record<Surface, string>> = {
  faceplate:
    "cursor-pointer rounded-full border border-line-strong bg-transparent align-middle font-medium text-ink hover:border-ink aria-disabled:cursor-wait aria-disabled:text-ink-2 aria-disabled:hover:border-line-strong",
  chassis:
    "cursor-pointer rounded-full border border-chassis-line bg-transparent align-middle font-medium text-lcd hover:border-lcd-2 aria-disabled:cursor-wait aria-disabled:text-lcd-2 aria-disabled:hover:border-chassis-line",
};

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
  palette = "faceplate",
}: {
  refreshing: boolean;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  idle: string;
  busy: string;
  /** The button's size. */
  className: string;
  palette?: Surface;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={refreshing || undefined}
      className={`${READ_BUTTON[palette]} ${className}`}
    >
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
