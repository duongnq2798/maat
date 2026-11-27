"use client";

import { type MouseEvent, type RefObject, useRef } from "react";
import { Digits } from "@/components/instrument/Digits";
import { Ghost } from "@/components/instrument/Ghost";
import { HoldKey, KEY_CLASS } from "@/components/instrument/HoldKey";
import { liveAttrs } from "@/components/instrument/Live";
import { Readout, ReadoutKeys } from "@/components/instrument/Readout";
import { useScan } from "@/components/instrument/useScan";
import { NAV_TOKENS } from "@/content/b20-nav";
import type { LiveState } from "@/lib/live/freshness";
import { formatAge, formatBlock, formatEt } from "@/lib/live/format";
import type { LiveReader } from "@/lib/live/rpc";
import { buyLead, buyLineText, lineGloss, OTHER_CHECKS, REFUSED } from "@/lib/live/verdict";
import {
  BlockLink,
  FAILED,
  LiveAnnouncer,
  LivePill,
  NotLiveWhy,
  READING,
  ReadButton,
  Sep,
  type Sentence,
  type ShownState,
  STRIP_TAP,
  useRetry,
} from "./LiveStatus";
import { LiveSnapshotProvider, type LiveSnapshotValue, useLive, useLiveIfAny } from "./LiveSnapshotProvider";
import { VerdictLine } from "./VerdictLine";

/** The unlit block number while the first read is in flight: the shape of a block in the 60 millions. */
const GHOST_BLOCK = "88,888,888";

/**
 * The Readout's height per breakpoint (spec 2026-11-23 sections 3.5 and 6.2): the tallest frame of
 * e2e/instrument-states.spec.ts at that breakpoint's narrowest width (360, 640, 1000, and 1280 to 1920 px), plus room
 * for the engines and platforms that lay the same Geist files out wider, rounded up to 4 px. Every state fits, so
 * nothing under the line moves when a reading lands. 62.5rem (1000 px), where the hero's grid takes two columns, is in
 * rem so Tailwind sorts it between sm (40rem) and xl (80rem).
 *
 * Since 2026-11-27 (landing "explain in 10 seconds", section 1) the strip is one labelled line: the verdict a buy would
 * get, the block it was read at, and the bezel keys; the basket's lamps and the session moved to /now. Measured on
 * Windows Chromium, its tallest frame is the three-refusal one: 310 px at 360, 152 px at 640, 220 px at 1000 and
 * 154 px at 1280 to 1920 (the weekend refusal a visitor sees most: 246, 116, 164 and 122). Chromium on Linux rounds
 * each glyph advance to a whole pixel and wraps sooner (about 12% taller on 2026-11-24), so each reserve keeps about
 * 40 px, or 12% where that is more, over those, rounded up to 4 px: 352, 192, 260 and 196.
 *
 * The line and its keys always sit together, never with a blank band between them (judge rehearsal m5). Below sm they
 * sit at the top of the window and the room a shorter frame leaves is under the keys, so a phone's first screen shows
 * the label and the verdict right under the steps, with no dark band above them (review of PR #105). From sm the room
 * is smaller, and they sit in the middle of the window.
 *
 * Each value is a min-height, never a fixed height: a frame taller than its reserve, on a platform or a width no test
 * measures, grows the window and moves what is under it down instead of running over it.
 */
export const STRIP_RESERVE = "min-h-[352px] sm:min-h-[192px] min-[62.5rem]:min-h-[260px] xl:min-h-[196px]";

/** Below sm the link takes a line of its own, so no separator is left hanging at the end of the line above it. */
function NowLinkAfter() {
  return (
    <>
      <span className="max-sm:hidden">
        <Sep />
      </span>
      <br className="sm:hidden" />
      <NowLink />
    </>
  );
}

function NowLink() {
  return (
    <a href="/now" className={`whitespace-nowrap font-medium text-pass-lit ${STRIP_TAP}`}>
      All {NAV_TOKENS.length} tokenized stocks <span aria-hidden="true">→</span>
    </a>
  );
}

/** The line's sentence, as the live region reads it too: the verdict a buy of each basket token would get. */
const buySentence: Sentence = (state) => buyLineText(state.reading.headline, state.reading.verdicts, { live: state.status === "live" });

/**
 * The line's verdict, its words split for VerdictLine: its label, its verb, the first ticker's gloss, and, when nothing
 * is refused, the checks the vault runs on a real trade, linked to the method on /now. Its reasons are running text, so
 * "Refused · Market closed" stays on one line and only the code wraps.
 */
function BuyLine({ state, className }: { state: ShownState; className?: string }) {
  const live = state.status === "live";
  const h = state.reading.headline;
  return (
    <VerdictLine
      headline={h}
      grammar={{ text: buySentence(state), lead: buyLead(h, live), verb: REFUSED, gloss: lineGloss(h), method: OTHER_CHECKS }}
      tone={live ? "ink" : "muted"}
      palette="chassis"
      methodHref="/now#method"
      className={className}
      lead={live}
      tagLayout="text"
    />
  );
}

interface BodyProps {
  state: LiveState;
  refreshing: boolean;
  onRetry: (e: MouseEvent<HTMLButtonElement>) => void;
}

/** The strip's one <p>: its rows are block spans (spec 3.5). */
function Body({ state, refreshing, onRetry }: BodyProps) {
  switch (state.status) {
    case "reading":
      return (
        <p className="m-0">
          <span className="block">
            <Ghost pattern={GHOST_BLOCK} className="readout-figure mr-2" />
            {READING}
          </span>
        </p>
      );
    case "error":
      return (
        <p className="m-0">
          <span className="block">
            {FAILED}{" "}
            <ReadButton
              palette="chassis"
              refreshing={refreshing}
              onClick={onRetry}
              idle="Retry"
              busy="Retrying…"
              className="ml-1 h-6 px-2.5 text-[12px]"
            />
          </span>
        </p>
      );
    case "live": {
      const { snapshot } = state.reading;
      const block = formatBlock(snapshot.block);
      // The label and the verdict lead, the verdict set larger than the block number (culture plan Q5); then the block
      // it was read at, its time in New York, and the way to every token on /now.
      return (
        <p className="m-0" {...liveAttrs(snapshot)}>
          <span className="block">
            <BuyLine state={state} className="readout-verdict" />
          </span>
          <span className="block">
            <LivePill live palette="chassis" />{" "}
            <BlockLink n={snapshot.block} label={`Base block ${block}`} palette="chassis">
              Base block <Digits value={block} className="readout-figure readout-digits" />
            </BlockLink>
            <Sep />
            <span className="whitespace-nowrap font-mono text-[12px]">{formatEt(snapshot.timestamp)}</span>
            <NowLinkAfter />
          </span>
        </p>
      );
    }
    case "stale":
    case "behind":
      return (
        <p className="m-0" {...liveAttrs(state.reading.snapshot)}>
          <span className="block">
            <LivePill live={false} palette="chassis" /> <NotLiveWhy state={state} palette="chassis" />
          </span>
          <span className="block">
            <BuyLine state={state} />
            <NowLinkAfter />
          </span>
        </p>
      );
  }
}

interface KeysProps {
  state: LiveState;
  refreshing: boolean;
  hold: boolean;
  onRefresh: () => void;
  scanLine: RefObject<HTMLSpanElement | null>;
}

/**
 * The bezel keys, outside the <p> (spec 6.1, amendment A7) and right under it: the scan line, then the read age and the RPC host once
 * a reading is shown, then Pause in every state, and Read again once a reading is shown.
 */
function Keys({ state, refreshing, hold, onRefresh, scanLine }: KeysProps) {
  const shown = state.status === "reading" || state.status === "error" ? null : state;
  return (
    <ReadoutKeys>
      <span ref={scanLine} aria-hidden="true" data-scan="" className="readout-scan" />
      {shown === null ? null : (
        <span data-read-age="">
          {hold ? "paused" : `read ${formatAge(shown.ageMs / 1000)} ago`} · {new URL(shown.reading.snapshot.endpoint).host}
        </span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <HoldKey />
        {shown === null ? null : (
          <button
            type="button"
            data-refresh-key=""
            aria-disabled={refreshing || undefined}
            onClick={() => {
              if (!refreshing) onRefresh();
            }}
            className={KEY_CLASS}
          >
            {refreshing ? "Reading…" : "Read again"}
          </button>
        )}
      </span>
    </ReadoutKeys>
  );
}

/** The strip itself, on the page's one snapshot, in its chassis window. */
function Strip({ live }: { live: LiveSnapshotValue }) {
  const { state, refresh, refreshing, hold } = live;
  const { box, onRetry } = useRetry(state, refreshing, refresh);
  const scanLine = useRef<HTMLSpanElement>(null);
  const shown = state.status === "reading" || state.status === "error" ? null : state;
  useScan(box, scanLine, shown === null ? null : shown.reading.readAtMs, hold);

  return (
    <Readout
      ref={box}
      tabIndex={-1}
      data-live-strip={state.status}
      reserve={STRIP_RESERVE}
      className="relative flex flex-col justify-start gap-2 pt-2 pb-2 text-[13px] leading-5 sm:justify-center"
    >
      <LiveAnnouncer state={state} sentence={buySentence} />
      <Body state={state} refreshing={refreshing} onRetry={onRetry} />
      <Keys state={state} refreshing={refreshing} hold={hold} onRefresh={refresh} scanLine={scanLine} />
      <noscript>
        <p className="m-0">
          The live line needs JavaScript.{" "}
          <a href="/now" className="text-pass-lit">
            Right now on Base
          </a>{" "}
          explains what it reads.
        </p>
      </noscript>
    </Readout>
  );
}

/** A strip that made its own provider: it reads the snapshot from there. */
function SharedStrip() {
  return <Strip live={useLive()} />;
}

/**
 * The live line in the landing hero (spec 2026-11-27, landing "explain in 10 seconds", section 1): what the vault's
 * default mandate would answer, right now, to a buy of each basket token, the Base block this browser read it at, and
 * the bezel keys, Pause and Read again. The static HTML holds the reading state only; no chain value is ever baked in.
 * Under a LiveSnapshotProvider it reads the page's snapshot, and `reader` is not used; with none above it (a test that
 * renders the Hero alone), it runs a provider of its own with `reader`.
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
