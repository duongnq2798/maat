"use client";

import { Fragment, type MouseEvent, type ReactNode } from "react";
import { ReasonTag } from "@/components/ui/ReasonTag";
import { NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import { andList } from "@/content/format";
import type { ReasonCode } from "@/content/reasons";
import { basescanAddress } from "@/lib/live/basescan";
import { formatAge, formatBlock, formatDateUtc, formatEt, formatMultiplier, formatUsd8, formatUtc } from "@/lib/live/format";
import type { LiveState } from "@/lib/live/freshness";
import type { LiveReader } from "@/lib/live/rpc";
import type { LiveSnapshot, TokenReading } from "@/lib/live/snapshot";
import { DEFAULT_LIMITS, type TokenVerdict } from "@/lib/live/verdict";
import { BlockLink, FAILED, LiveAnnouncer, LivePill, NotLiveWhy, READING, ReadButton, Sep, type ShownState, useRetry } from "./LiveStatus";
import { useLiveSnapshot } from "./useLiveSnapshot";
import { TONE, VerdictLine, type VerdictTone } from "./VerdictLine";

const NONE = "—";
const UNREAD = "could not read";
const COUNT = NAV_TOKENS.length;

type Col = "basket" | "feedAge" | "nav" | "twap" | "premium" | "paused" | "multiplier" | "effectiveAt" | "mandate" | "market";

/** The columns of spec 6.2 after the token, in its order. */
const COLUMNS: readonly { key: Col; label: string }[] = [
  { key: "basket", label: "In the default mandate" },
  { key: "feedAge", label: "Feed age" },
  { key: "nav", label: "NAV" },
  { key: "twap", label: `${formatAge(FACTS.mandate.value.twapWindowSec)} TWAP` },
  { key: "premium", label: "Premium" },
  { key: "paused", label: "Paused" },
  { key: "multiplier", label: "Multiplier" },
  { key: "effectiveAt", label: "Multiplier change" },
  { key: "mandate", label: "Default mandate" },
  { key: "market", label: "Market checks" },
];

/** A card leads with the two verdicts, then the values behind them. */
const CARD_ORDER: readonly Col[] = ["mandate", "market", "basket", "feedAge", "nav", "twap", "premium", "paused", "multiplier", "effectiveAt"];
const LABEL = Object.fromEntries(COLUMNS.map((c) => [c.key, c.label])) as Record<Col, string>;

/** A value next to the limit it is judged against. */
function Limit({ value, max }: { value: string; max: string }) {
  return (
    <>
      <span className="whitespace-nowrap">{value}</span>{" "}
      <span className="whitespace-nowrap font-mono text-[11px] text-ink-2">max {max}</span>
    </>
  );
}

/**
 * A pass never says "All checks passed" (REASON_LABEL.OK), in either column: checks 3, 8 and 9 need a vault and are
 * not run here. A refusal shows its label and code.
 */
function Verdict({ code }: { code: ReasonCode }) {
  if (code === "OK") return <>Market checks pass</>;
  return <ReasonTag code={code} tone="refuse" layout="inline" />;
}

/** One token's cells: a dash for each until a reading arrives, then the values read and the two verdicts. */
function cells(r: TokenReading | undefined, v: TokenVerdict | undefined): Record<Col, ReactNode> {
  if (r === undefined || v === undefined) return Object.fromEntries(COLUMNS.map((c) => [c.key, NONE])) as Record<Col, ReactNode>;
  const max = DEFAULT_LIMITS;
  const feedAge =
    r.feed === null ? UNREAD : v.feedAgeSec === null ? "no valid price" : <Limit value={formatAge(v.feedAgeSec)} max={formatAge(max.maxStalenessSec)} />;
  const premium =
    v.premiumBps !== null ? (
      <Limit value={`${v.premiumBps} bps`} max={String(max.maxPremiumBps)} />
    ) : r.feed === null || r.twap8 === null ? (
      UNREAD
    ) : (
      "no valid price"
    );
  return {
    basket: v.inBasket ? "yes" : "no",
    feedAge,
    nav: r.feed === null ? UNREAD : formatUsd8(r.feed.answer),
    twap: r.twap8 === null ? UNREAD : formatUsd8(r.twap8),
    premium,
    paused: r.paused === null ? UNREAD : r.paused ? "yes" : "no",
    multiplier: r.uiMultiplier === null ? UNREAD : formatMultiplier(r.uiMultiplier),
    effectiveAt: r.effectiveAt === null ? UNREAD : r.effectiveAt === 0n ? "none" : formatDateUtc(Number(r.effectiveAt)),
    mandate: <Verdict code={v.mandate} />,
    market: <Verdict code={v.market} />,
  };
}

function SessionSource({ snapshot }: { snapshot: LiveSnapshot }) {
  const cal = snapshot.calendar;
  if (cal.source === "repo") return <>repo calendar, web/content/calendar.ts</>;
  return (
    <>
      MarketCalendar at{" "}
      <a href={basescanAddress(cal.address)} target="_blank" rel="noopener noreferrer" className="font-mono text-[12px] [overflow-wrap:anywhere]">
        {cal.address}
      </a>
    </>
  );
}

interface StatusProps {
  state: LiveState;
  refreshing: boolean;
  onRetry: (e: MouseEvent<HTMLButtonElement>) => void;
  onRefresh: () => void;
}

function Status({ state, refreshing, onRetry, onRefresh }: StatusProps) {
  if (state.status === "reading") return <p className="m-0">{READING}</p>;
  if (state.status === "error") {
    return (
      <p className="m-0 text-ink">
        {FAILED}{" "}
        <ReadButton refreshing={refreshing} onClick={onRetry} idle="Retry" busy="Retrying…" className="ml-1 h-8 px-3 text-[13px]" />
      </p>
    );
  }
  const { snapshot, session } = state.reading;
  const live = state.status === "live";
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <p className="m-0 min-w-0 flex-1 basis-[22rem]">
        <LivePill live={live} />{" "}
        {live ? <BlockLink n={snapshot.block}>{`Base block ${formatBlock(snapshot.block)}`}</BlockLink> : <NotLiveWhy state={state} />}
        <Sep />
        <span className="whitespace-nowrap font-mono text-[12px]">
          {formatUtc(snapshot.timestamp)} · {formatEt(snapshot.timestamp)}
        </span>
        <Sep />
        <span>
          {session.detail} (<SessionSource snapshot={snapshot} />)
        </span>
        <Sep />
        <span>
          Read from <span className="whitespace-nowrap font-mono text-[12px]">{snapshot.endpoint}</span>
        </span>
      </p>
      <ReadButton refreshing={refreshing} onClick={onRefresh} idle="Refresh" busy="Refreshing…" className="h-8 shrink-0 px-3 text-[13px]" />
    </div>
  );
}

function Table({ rows }: { rows: Record<Col, ReactNode>[] }) {
  return (
    <div
      role="region"
      aria-label={`All ${COUNT} B20s with a NAV, one row each`}
      tabIndex={0}
      data-scroll-x
      className="card scroll-x-cue hidden overflow-x-auto md:block"
    >
      <table className="w-full min-w-[1120px] border-collapse text-left text-[13px] leading-5">
        <caption className="sr-only">
          Each B20 with a NAV: what was read at the block above, what the default mandate would say to a BUY, and what
          the market checks say.
        </caption>
        <thead className="bg-surface-head font-mono text-[11px] uppercase tracking-[0.06em] text-ink-2">
          <tr className="border-b border-line">
            <th scope="col" className="py-3.5 pl-5 pr-2 align-bottom font-normal">
              Token
            </th>
            {COLUMNS.map((c, i) => (
              <th key={c.key} scope="col" className={`py-3.5 align-bottom font-normal ${i === COLUMNS.length - 1 ? "pl-2 pr-5" : "px-2"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NAV_TOKENS.map((t, i) => (
            <tr key={t.symbol} data-token={t.symbol} className="border-b border-line-soft last:border-b-0">
              <th scope="row" className="min-w-40 py-3 pl-5 pr-2 text-left align-top font-normal">
                <span className="block font-semibold text-ink">{t.symbol}</span>
                <span className="block text-[12px] text-ink-2">{t.name}</span>
              </th>
              {COLUMNS.map((c, j) => (
                <td key={c.key} data-col={c.key} className={`py-3 align-top ${j === COLUMNS.length - 1 ? "pl-2 pr-5" : "px-2"}`}>
                  {rows[i]![c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cards({ rows }: { rows: Record<Col, ReactNode>[] }) {
  return (
    <div data-now-cards className="grid gap-3 md:hidden">
      {NAV_TOKENS.map((t, i) => (
        <article key={t.symbol} data-token={t.symbol} aria-labelledby={`now-card-${t.symbol}`} className="card p-4">
          <h3 id={`now-card-${t.symbol}`} className="m-0 flex flex-wrap items-baseline gap-x-2 text-[17px] font-semibold text-ink">
            {t.symbol} <span className="text-[13px] font-normal text-ink-2">{t.name}</span>
          </h3>
          <dl className="m-0 mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-4 gap-y-2 text-[13px] leading-5">
            {CARD_ORDER.map((key) => (
              <Fragment key={key}>
                <dt className="text-ink-2">{LABEL[key]}</dt>
                <dd data-col={key} className="m-0 [overflow-wrap:anywhere]">
                  {rows[i]![key]}
                </dd>
              </Fragment>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

/**
 * The status card's height, measured in the browser with an in-session reading whose headline refuses one basket token
 * and passes two: 344 px at a 375 px phone, 212 px at 640 px, 184 px at 768 px, and at most 166 px from 1024 px, where
 * even three different refusals fit. The page does not move when that reading arrives; a weekend reading leaves some
 * room, and on a phone a headline with three different refusals still grows the card (460 px at 375 px).
 */
const RESERVE = "min-h-86 sm:min-h-56 md:min-h-46 lg:min-h-42";

/**
 * /now in the browser: the status of the reading, the headline verdict, and one row per B20 with a NAV (a table from
 * md up, a card each below). The static HTML holds the reading state, each token's symbol and name and a dash in every
 * other cell; no chain value is ever baked in.
 */
export function NowBoard({ reader }: { reader?: LiveReader }) {
  const { state, refresh, refreshing } = useLiveSnapshot({ reader });
  const { box, onRetry } = useRetry(state, refreshing, refresh);
  const shown: ShownState | undefined = state.status === "reading" || state.status === "error" ? undefined : state;
  const tone: VerdictTone = shown === undefined || shown.status === "live" ? "ink" : "muted";
  const onRefresh = () => {
    if (!refreshing) refresh();
  };
  const rows = NAV_TOKENS.map((t) =>
    cells(
      shown?.reading.snapshot.tokens.find((r) => r.symbol === t.symbol),
      shown?.reading.verdicts.find((v) => v.symbol === t.symbol),
    ),
  );

  return (
    <div data-now-board={state.status} className="flex flex-col gap-12">
      <div ref={box} tabIndex={-1} className={`card flex ${RESERVE} flex-col gap-4 p-5 text-[13px] leading-5 text-ink-2 sm:p-6`}>
        <LiveAnnouncer state={state} />
        <Status state={state} refreshing={refreshing} onRetry={onRetry} onRefresh={onRefresh} />
        {shown ? (
          <p className="m-0 text-[17px] leading-7">
            <VerdictLine headline={shown.reading.headline} tone={tone} methodHref="#method" />
          </p>
        ) : null}
        <noscript>
          <p className="m-0">This page reads Base mainnet in your browser, so it needs JavaScript. The method below lists every call it makes.</p>
        </noscript>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex max-w-[820px] flex-col gap-2">
          <h2 className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.03em]">
            All {COUNT} B20s with a NAV
          </h2>
          <p className="m-0 text-[15px] leading-relaxed text-ink-2">
            The default mandate holds {andList(FACTS.basket.value)}. Its verdict runs checks 1 to 7 for a BUY, in the
            vault&apos;s order, and stops at the first failure; the market checks run 2 to 7 for every token, as if it
            were in the basket. Checks 3, 8 and 9 need a vault&apos;s address or balances, and this page reads no vault, so
            they are not run here.
          </p>
        </div>
        <div data-now-rows data-tone={tone} className={TONE[tone]}>
          <Table rows={rows} />
          <Cards rows={rows} />
        </div>
      </div>
    </div>
  );
}
