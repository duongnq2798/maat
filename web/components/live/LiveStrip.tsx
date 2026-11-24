"use client";

import { type MouseEvent, type RefObject, useRef } from "react";
import { Digits } from "@/components/instrument/Digits";
import { Ghost } from "@/components/instrument/Ghost";
import { HoldKey, KEY_CLASS } from "@/components/instrument/HoldKey";
import { Lamp } from "@/components/instrument/Lamp";
import { liveAttrs } from "@/components/instrument/Live";
import { Meter } from "@/components/instrument/Meter";
import { Readout, ReadoutKeys } from "@/components/instrument/Readout";
import { useScan } from "@/components/instrument/useScan";
import { NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import { countdownText } from "@/lib/live/countdown";
import type { LiveState, Reading } from "@/lib/live/freshness";
import { formatAge, formatBlock, formatEt, formatUtc } from "@/lib/live/format";
import type { LiveReader } from "@/lib/live/rpc";
import { BlockLink, FAILED, LiveAnnouncer, LivePill, NotLiveWhy, READING, ReadButton, Sep, useRetry } from "./LiveStatus";
import { LiveSnapshotProvider, type LiveSnapshotValue, useLive, useLiveIfAny } from "./LiveSnapshotProvider";
import { VerdictLine } from "./VerdictLine";

/** The unlit block number while the first read is in flight: the shape of a block in the 60 millions. */
const GHOST_BLOCK = "88,888,888";

/**
 * The Readout's fixed height per breakpoint (spec 2026-11-23 sections 3.5 and 6.2): the tallest frame of
 * e2e/instrument-states.spec.ts at that breakpoint's narrowest width (360, 640, 1000, and 1280 to 1920 px), plus 20 px,
 * rounded up to 4 px. Every state fits, so the lead never moves when a reading lands. 62.5rem (1000 px), where the
 * hero's grid takes two columns, is in rem so Tailwind sorts it between sm (40rem) and xl (80rem). Measured
 * 2026-11-24: the three-refusal frame is the tallest at every width, at 350 px (360), 194 px (640), 234 px (1000) and
 * 248 px (1440 and 1920; 223 px at 1280).
 */
export const STRIP_RESERVE = "h-[372px] sm:h-[216px] min-[62.5rem]:h-[256px] xl:h-[268px]";

function NowLink() {
  return (
    <a href="/now" className="whitespace-nowrap font-medium text-pass-lit">
      All {NAV_TOKENS.length} B20s <span aria-hidden="true">→</span>
    </a>
  );
}

/**
 * The three basket tokens on row 3: each one's lamp (PASS or REFUSE, what the default mandate does with a BUY) and its
 * pool premium on a meter scaled to FACTS.mandate.value.maxPremiumBps, with the number written. No reason tag: the
 * reasons are the verdict line's.
 */
function Basket({ reading }: { reading: Reading }) {
  const limit = FACTS.mandate.value.maxPremiumBps;
  return (
    <span data-basket="" className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-3">
      {FACTS.basket.value.map((symbol) => {
        const v = reading.verdicts.find((t) => t.symbol === symbol);
        return (
          <span key={symbol} data-basket-token={symbol} className="flex flex-wrap items-center gap-x-2 leading-4">
            <span className="font-mono text-[12px] font-medium text-lcd">{symbol}</span>
            <Lamp state={v === undefined ? "reading" : v.mandate === "OK" ? "pass" : "refuse"} on="chassis" />
            {v !== undefined && v.premiumBps !== null ? (
              <Meter value={Number(v.premiumBps)} limit={limit} unit="bps" on="chassis" />
            ) : (
              <span className="font-mono text-[11px] text-lcd-2">premium not read</span>
            )}
          </span>
        );
      })}
    </span>
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
      const { snapshot, session, headline, wallAtReadSec } = state.reading;
      const block = formatBlock(snapshot.block);
      // The visitor's clock as it stood at this frame: HOLD freezes the age, so it freezes the countdown too.
      const countdown = countdownText(session, snapshot.timestamp, wallAtReadSec + state.ageMs / 1000);
      return (
        <p className="m-0" {...liveAttrs(snapshot)}>
          <span className="block">
            <LivePill live palette="chassis" />{" "}
            <BlockLink n={snapshot.block} label={`Base block ${block}`} palette="chassis">
              Base block <Digits value={block} className="readout-figure readout-digits" />
            </BlockLink>
            <Sep />
            <span className="whitespace-nowrap font-mono text-[12px]">
              {formatUtc(snapshot.timestamp)} · {formatEt(snapshot.timestamp)}
            </span>
          </span>
          <span className="block">
            <span>{session.detail}</span>
            {countdown === null ? null : (
              <>
                <Sep />
                <span data-countdown="" className="whitespace-nowrap">
                  {countdown}
                </span>
              </>
            )}
          </span>
          <span className="block">
            <VerdictLine headline={headline} tone="ink" palette="chassis" methodHref="/now#method" />
            <Sep />
            <NowLink />
            <Basket reading={state.reading} />
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
          <span className="block text-lcd-2">{state.reading.session.detail}</span>
          <span className="block">
            <VerdictLine headline={state.reading.headline} tone="muted" palette="chassis" methodHref="/now#method" />
            <Sep />
            <NowLink />
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
 * The bottom bezel, outside the <p> (spec 6.1, amendment A7): the scan line, then the read age and the RPC host once
 * a reading is shown, then HOLD in every state, and Refresh once a reading is shown.
 */
function Keys({ state, refreshing, hold, onRefresh, scanLine }: KeysProps) {
  const shown = state.status === "reading" || state.status === "error" ? null : state;
  return (
    <ReadoutKeys className="mt-auto">
      <span ref={scanLine} aria-hidden="true" data-scan="" className="readout-scan" />
      {shown === null ? null : (
        <span data-read-age="">
          {hold ? "held" : `read ${formatAge(shown.ageMs / 1000)} ago`} · {new URL(shown.reading.snapshot.endpoint).host}
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
            {refreshing ? "Refreshing…" : "Refresh"}
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
      className="relative flex flex-col pt-2 pb-2 text-[13px] leading-5"
    >
      <LiveAnnouncer state={state} />
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
 * The live Readout under the landing H1: the Base block this browser read, its NYSE session and the countdown to the
 * next open, what an agent under the default mandate would do with a BUY of each basket token, and the bezel keys. The
 * static HTML holds the reading state only; no chain value is ever baked in. Under a LiveSnapshotProvider it reads the
 * page's snapshot, and `reader` is not used; with none above it (a test that renders the Hero alone), it runs a
 * provider of its own with `reader`.
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
