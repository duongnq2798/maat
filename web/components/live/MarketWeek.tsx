import type { Hash } from "viem";
import { formatInt } from "@/content/format";
import { type ReasonCode, reasonText } from "@/content/reasons";
import { basescanDecision } from "@/lib/live/basescan";
import { nowMark, pct, placeTicks, type SpanKind, weekAt } from "@/lib/live/week";

/** One mainnet Decision as the week draws it: plain values from /ledger's loader (NowDecisions.tsx). */
export interface WeekDecision {
  key: string;
  txHash: Hash;
  /** Unix seconds of its block, or null when that was not read. */
  timestamp: number | null;
  /** "Tue 24 Nov 11:59", New York time. */
  timeLabel: string;
  allowed: boolean;
  reason: ReasonCode;
  /** "BUY NVDAc · $5.00". */
  intent: string;
  /** Who sent it, as /ledger labels it: "owner, by hand", "probe", "brief-driven", "agent", or why it is not known. */
  sender: string;
  /** "Weighing № N": its place among every Decision of the vault in chain order, or null when the read cannot say. */
  ordinal: number | null;
}

/** The vault's Decisions as the page has read them. */
export type WeekDecisionsView =
  | { state: "reading" }
  /** deployments/README.md records no vault, so there is nothing to read. */
  | { state: "none" }
  | { state: "error"; message: string; retry: () => void }
  /** Every Decision since the deploy, newest first, and the committed snapshot the read took its oldest logs from. */
  | { state: "read"; decisions: readonly WeekDecision[]; snapshot: WeekSnapshot | null };

/**
 * The committed snapshot a read started from: served at `url` (/data/decisions-snapshot.json), taken at `block`, its
 * logs used up to `logsTo`. The reader passes the URL, so this chunk does not load the snapshot module.
 */
export interface WeekSnapshot {
  url: string;
  block: bigint;
  logsTo: bigint;
}

/** The line under the heading, from the live reading: closed (large, hatched) or open (plain). */
export interface SessionLineView {
  tone: "closed" | "open";
  text: string;
  /** False when the reading is no longer live: the line is then muted, as the verdict line is. */
  live: boolean;
}

/**
 * The refuse hatch of the landing's week chart (components/charts/WeekChart.tsx): refuse-hatch stripes on refuse-tint,
 * the two tokens of app/globals.css. Every closed window wears it, and nothing else on /now does.
 */
const HATCH = "bg-[repeating-linear-gradient(135deg,var(--color-refuse-hatch)_0_2px,var(--color-refuse-tint)_2px_6px)]";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const AXIS = [0, 6, 12, 18, 24] as const;
const ROW = "grid grid-cols-1 gap-y-1.5 sm:grid-cols-[176px_minmax(0,1fr)] sm:items-center sm:gap-x-5";

/**
 * The line's box keeps the height of the closed line at each width, so the week does not move down when a reading
 * lands (e2e/now-week.spec.ts). Measured in Chromium on Windows, 2026-11-26: the closed line is 640 px wide on one line
 * at 24 px, so it takes three lines of 28.3 px up to 639 px (85 px), two from 640 px (57 px), one from 700 px, and one
 * line of at most 40.1 px from 1024 px, where it is 709 to 903 px wide in 960 to 1176 px. Each reserve clears that by
 * 3 px or more, for a platform that sets the same text a little wider.
 */
const LINE_RESERVE = "min-h-[88px] sm:min-h-[60px] lg:min-h-[44px]";

function SessionLine({ line }: { line: SessionLineView }) {
  const closed = line.tone === "closed";
  const ink = !line.live ? "text-ink-2" : closed ? "text-ink" : "text-ink-2";
  return (
    <p
      data-session-line={line.tone}
      data-live={line.live ? "true" : "false"}
      className={`m-0 text-[clamp(24px,2.6vw,34px)] leading-[1.18] tracking-[-0.03em] text-balance ${closed ? "font-semibold" : "font-medium"} ${ink}`}
    >
      {closed ? (
        <span data-hatch-swatch="" aria-hidden="true" className={`mr-3 inline-block h-[0.62em] w-[1.3em] rounded-[4px] align-[-0.02em] ${HATCH}`} />
      ) : null}
      {line.text}
    </p>
  );
}

function Swatch({ className }: { className: string }) {
  return <span aria-hidden="true" className={`inline-block shrink-0 ${className}`} />;
}

const VERDICT_CLASS = { allowed: "bg-accent", refused: "bg-refuse" } as const;

function Decisions({ view, week }: { view: WeekDecisionsView; week: ReturnType<typeof weekAt> | null }) {
  if (view.state === "reading") {
    return (
      <p data-week-decisions-state="reading" className="m-0 text-[14px] text-ink-2">
        Reading the vault&apos;s Decisions from Base…
      </p>
    );
  }
  if (view.state === "none") {
    return (
      <p data-week-decisions-state="none" className="m-0 text-[14px] text-ink-2">
        deployments/README.md records no vault yet, so there is no Decision to draw.
      </p>
    );
  }
  if (view.state === "error") {
    return (
      <p data-week-decisions-state="error" className="m-0 text-[14px] text-ink-2 [overflow-wrap:anywhere]">
        The vault&apos;s Decisions could not be read from Base: {view.message}.{" "}
        <button
          type="button"
          onClick={view.retry}
          className="ml-1 min-h-8 rounded-full border border-line-strong px-3 py-1 text-[13px] font-medium text-ink hover:border-ink"
        >
          Read again
        </button>
      </p>
    );
  }
  if (week === null) return null;
  const placed = placeTicks(week, view.decisions);
  return (
    <div className="flex flex-col gap-3">
      <p data-week-count="" className="m-0 font-mono text-[14px] font-medium text-ink">
        {formatInt(placed.length)} {placed.length === 1 ? "Decision" : "Decisions"} this week
      </p>
      {placed.length > 0 ? (
        <ol data-week-decisions="" aria-label="The vault's Decisions this week, oldest first" className="m-0 flex list-none flex-col p-0">
          {placed.map(({ item: d }) => {
            const tag = d.ordinal === null ? null : `Weighing № ${d.ordinal}`;
            return (
              <li key={d.key} data-decision={d.allowed ? "allowed" : "refused"} className="flex items-baseline gap-2.5 border-b border-line-soft py-2.5 text-[14px] leading-6 last:border-b-0">
                <Swatch className={`h-2.5 w-2.5 translate-y-px rounded-full ${d.allowed ? VERDICT_CLASS.allowed : VERDICT_CLASS.refused}`} />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {tag === null ? null : <span className="font-mono text-[13px] font-medium text-ink">{tag} · </span>}
                  <span className="font-mono text-[13px] text-ink-2">{d.timeLabel} ET</span>
                  {" · "}
                  <span className={`font-medium ${d.allowed ? "text-accent" : "text-refuse"}`}>
                    {d.allowed ? "Allowed" : "Refused"} · {reasonText(d.reason)}
                  </span>
                  {" · "}
                  <span className="text-ink">{d.intent}</span>
                  {" · "}
                  <span className="text-ink-2">{d.sender}</span>
                  {" · "}
                  <a
                    href={basescanDecision(d.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${tag === null ? "Transaction" : `${tag}, transaction`} ${d.txHash.slice(0, 10)}… on Basescan`}
                    className="whitespace-nowrap font-medium"
                  >
                    Basescan<span aria-hidden="true"> ↗</span>
                  </a>
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      <p data-week-source="" className="m-0 text-[13px] leading-normal text-ink-2">
        Read from Base mainnet by your browser with the ledger&apos;s own loader: every Decision since the deploy, each with
        its sender.{" "}
        {view.snapshot === null ? (
          <>Every block from the deploy to the head was scanned with eth_getLogs.</>
        ) : (
          <>
            Logs up to block {formatInt(Number(view.snapshot.logsTo))} are from the{" "}
            <a href={view.snapshot.url} className="underline underline-offset-2">
              committed snapshot
            </a>{" "}
            of block {formatInt(Number(view.snapshot.block))}: Base gave the same hash for that block and the same logs in
            their transaction receipts. The blocks after it were scanned with eth_getLogs.
          </>
        )}{" "}
        All of them, with their reasons, are on{" "}
        <a href="/ledger" className="font-medium underline underline-offset-2">
          the ledger
        </a>
        .
      </p>
    </div>
  );
}

/**
 * /now's market week (culture plan 2026-11-26, Move 8a): the large session line from the live reading, then the NYSE
 * week around the visitor's clock, one row a day in New York time, drawn from content/calendar.ts. Closed windows wear
 * the refuse hatch, the session is plain, the now line is ink, and the vault's mainnet Decisions are ticks in their
 * verdict's color; the list under the grid says the same in words, so a keyboard and a screen reader reach every one.
 * Before the page has read the clock (`nowSec` null, as in the static HTML) the rows hold their place unlit, named by
 * weekday alone: no date, no line and no tick is ever baked into the export. Nothing here moves on its own.
 */
export function MarketWeek({ nowSec, line, decisions }: { nowSec: number | null; line: SessionLineView | null; decisions: WeekDecisionsView }) {
  const week = nowSec === null ? null : weekAt(nowSec);
  const now = week === null || nowSec === null ? null : nowMark(week, nowSec);
  const placed = week !== null && decisions.state === "read" ? placeTicks(week, decisions.decisions) : [];

  return (
    <section aria-labelledby="week-title" data-market-week={week === null ? "waiting" : "drawn"} className="flex flex-col gap-6">
      <div className="flex max-w-[820px] flex-col gap-2">
        <h2 id="week-title" className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.03em]">
          The NYSE this week
        </h2>
        <p className="m-0 text-[15px] leading-relaxed text-ink-2">
          One row a day, in New York time, from web/content/calendar.ts, the repo&apos;s tested port of MarketCalendar. In
          the hatched hours NYSE is closed, and the vault refuses a trade: Refused · Market closed (MARKET_CLOSED). The
          ticks are the vault&apos;s Decisions on Base mainnet.
        </p>
      </div>

      <div data-session-line-box="" className={LINE_RESERVE}>
        {line === null ? null : <SessionLine line={line} />}
      </div>

      <div className="card flex flex-col gap-4 p-4 sm:p-6">
        <div aria-hidden="true" className={ROW}>
          <span className="hidden sm:block" />
          <span className="relative block h-4 font-mono text-[11px] leading-4 text-ink-2">
            {AXIS.map((h, i) => (
              <span
                key={h}
                className={`absolute top-0 ${i === 0 ? "" : i === AXIS.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: pct(h * 60) }}
              >
                {`${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </span>
        </div>

        <ol data-week-days="" aria-label="NYSE sessions this week, Monday to Sunday, New York time" className="m-0 flex list-none flex-col p-0">
          {WEEKDAYS.map((name, index) => {
            const day = week?.days[index];
            const today = now !== null && now.index === index;
            const ticks = placed.filter((t) => t.index === index);
            return (
              <li
                key={name}
                data-day={day?.iso}
                aria-current={today ? "date" : undefined}
                className={`${ROW} border-b border-line-soft py-2.5 last:border-b-0`}
              >
                <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
                  <span className={`font-mono ${today ? "font-semibold text-ink" : "font-medium text-ink"}`}>{day?.label ?? name}</span>
                  {day ? <span className="text-ink-2">{day.detail}</span> : null}
                  {today && now ? (
                    <span data-now-label="" className="font-mono text-[12px] font-medium text-ink">
                      · now {now.label}
                    </span>
                  ) : null}
                </p>
                <div aria-hidden="true" className="relative h-5">
                  <div className="absolute inset-0 overflow-hidden rounded-[5px] border border-line bg-bg">
                    {day?.spans.map((s) => (
                      <span
                        key={s.fromMin}
                        data-span={s.kind satisfies SpanKind}
                        data-from={s.fromMin}
                        data-to={s.toMin}
                        className={`absolute inset-y-0 ${s.kind === "open" ? "bg-bg" : HATCH}`}
                        style={{ left: pct(s.fromMin), width: pct(s.toMin - s.fromMin) }}
                      />
                    ))}
                  </div>
                  {ticks.map((t) => (
                    <span
                      key={t.item.key}
                      data-tick=""
                      data-verdict={t.item.allowed ? "allowed" : "refused"}
                      data-minute={t.minute}
                      aria-hidden="true"
                      className={`absolute -top-1 -bottom-1 w-[3px] -translate-x-1/2 rounded-full ring-2 ring-bg ${t.item.allowed ? VERDICT_CLASS.allowed : VERDICT_CLASS.refused}`}
                      style={{ left: pct(t.minute) }}
                    />
                  ))}
                  {today && now ? (
                    <span
                      data-now-marker=""
                      data-minute={now.minute}
                      className="absolute -top-1.5 -bottom-1.5 w-0.5 -translate-x-1/2 bg-ink"
                      style={{ left: pct(now.minute) }}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        <ul aria-label="Key" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-[12px] leading-4 text-ink-2">
          <li className="flex items-center gap-2">
            <Swatch className="h-3 w-5 rounded-[3px] border border-line bg-bg" />
            NYSE regular session
          </li>
          <li className="flex items-center gap-2">
            <Swatch className={`h-3 w-5 rounded-[3px] ${HATCH}`} />
            Closed: the vault refuses trades
          </li>
          <li className="flex items-center gap-2">
            <Swatch className={`h-3 w-[3px] rounded-full ${VERDICT_CLASS.allowed}`} />
            Allowed
          </li>
          <li className="flex items-center gap-2">
            <Swatch className={`h-3 w-[3px] rounded-full ${VERDICT_CLASS.refused}`} />
            Refused
          </li>
          <li className="flex items-center gap-2">
            <Swatch className="h-3 w-0.5 bg-ink" />
            Now, by your clock
          </li>
        </ul>
        <noscript>
          <p className="m-0 text-[13px] text-ink-2">The week is drawn from your clock, so it needs JavaScript.</p>
        </noscript>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-[17px] font-semibold leading-tight text-ink">The vault&apos;s Decisions this week</h3>
        <Decisions view={decisions} week={week} />
      </div>
    </section>
  );
}
