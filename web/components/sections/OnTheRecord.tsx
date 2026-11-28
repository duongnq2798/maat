"use client";

import { type CSSProperties, type KeyboardEvent, useRef, useState } from "react";
import { SourcePlate } from "@/components/instrument/SourcePlate";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { isoOfDay, localTime } from "@/content/calendar";
import { clockLabel, dayLabel, formatInt } from "@/content/format";
import { REASON_LABEL } from "@/content/reasons";
import {
  RECORD_EYEBROW,
  RECORD_LEAD,
  RECORD_LINKS,
  RECORD_MOMENTS,
  RECORD_SENDER,
  RECORD_TITLE,
  type RecordMoment,
  recordDay,
  REGULAR_DAY,
} from "@/content/record";
import { basescanDecision, basescanRefusalNote } from "@/lib/live/basescan";
import { SpecPlate } from "./SpecPlate";

type MomentId = RecordMoment["id"];

/** The moment's time in New York, as the engine card writes it: "Thu 26 Nov 21:14 ET". */
export function recordWhen(ts: number): string {
  const { etDay, minuteOfDay } = localTime(ts);
  return `${dayLabel(isoOfDay(etDay))} ${clockLabel(minuteOfDay)} ET`;
}

/** The tab's first line: the moment's weekday and time in New York, "Thu 21:14". */
export function recordTabTime(ts: number): string {
  const { etDay, minuteOfDay } = localTime(ts);
  return `${dayLabel(isoOfDay(etDay)).split(" ")[0]} ${clockLabel(minuteOfDay)}`;
}

/** The label over the bar: the minute and what the calendar said of it, "12:58 · open", with an arrow when it is past an end. */
export function recordTimeLabel(m: RecordMoment): string {
  const day = recordDay(m);
  const word = `${clockLabel(day.minute)} · ${day.verdict.open ? "open" : "closed"}`;
  return day.minute < REGULAR_DAY.open ? `← ${word}` : day.minute > REGULAR_DAY.close ? `${word} →` : word;
}

/** A hash as the page shortens it: "0xca9e…bed6". */
const shortTx = (tx: string) => `${tx.slice(0, 6)}…${tx.slice(-4)}`;

/** Where a minute sits on the regular day's bar, 0 to 100. */
function at(minute: number): number {
  return ((minute - REGULAR_DAY.open) / (REGULAR_DAY.close - REGULAR_DAY.open)) * 100;
}

/** A label on the bar, kept inside it: centred on its point, or flush with the end it is near. */
function labelStyle(pct: number): CSSProperties {
  const shift = pct > 85 ? "-100%" : pct < 15 ? "0" : "-50%";
  return { left: `${pct}%`, transform: `translateX(${shift})` };
}

/** The hatch the closed part of a day wears, the refusal's hatch from the token set. */
const CLOSED: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--color-refuse-hatch) 0 2px, transparent 2px 6px)",
};

/**
 * The moment's day on NYSE's regular hours, 09:30 to 16:00 ET: the session the vault's calendar allowed, lit in the
 * accent, the rest hatched as closed, and a needle at the Decision's minute. The label over it says the minute and
 * "open" or "closed" in words, in the accent or the refusal's colour, so 12:58 and 13:01 do not read as one picture;
 * an early close ends the lit part square. A minute outside the regular day gets no needle, only its label at the end it
 * is past. The bar is a picture of the sentence under it, which the calendar writes too, so the bar is aria-hidden.
 */
function DayBar({ moment }: { moment: RecordMoment }) {
  const day = recordDay(moment);
  const inside = day.minute >= REGULAR_DAY.open && day.minute <= REGULAR_DAY.close;
  const mark = inside ? at(day.minute) : day.minute < REGULAR_DAY.open ? 0 : 100;
  const early = day.session !== null && day.session.closeMin !== REGULAR_DAY.close ? day.session.closeMin : null;
  return (
    <div data-record-day="" className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="relative h-4">
        <span
          data-record-time=""
          className={`absolute top-0 whitespace-nowrap font-mono text-[11px] font-semibold ${day.verdict.open ? "text-accent" : "text-refuse"}`}
          style={labelStyle(mark)}
        >
          {recordTimeLabel(moment)}
        </span>
      </div>
      <div aria-hidden="true" className="relative h-2.5 rounded-full bg-line-soft" style={CLOSED}>
        {day.session === null ? null : (
          <span
            data-record-session=""
            className={`absolute inset-y-0 bg-accent ${early === null ? "rounded-full" : "rounded-l-full"}`}
            style={{ left: `${at(day.session.openMin)}%`, width: `${at(day.session.closeMin) - at(day.session.openMin)}%` }}
          />
        )}
        {inside ? (
          <span
            data-record-needle=""
            className="absolute -top-1.5 h-[22px] w-[3px] -translate-x-1/2 rounded-full bg-ink"
            style={{ left: `${mark}%` }}
          />
        ) : null}
      </div>
      <div aria-hidden="true" className="relative h-4 font-mono text-[11px] text-label">
        <span className="absolute" style={labelStyle(0)}>
          {clockLabel(REGULAR_DAY.open)}
        </span>
        {early === null ? null : (
          <span className="absolute" style={labelStyle(at(early))}>
            {clockLabel(early)}
          </span>
        )}
        <span className="absolute" style={labelStyle(100)}>
          {clockLabel(REGULAR_DAY.close)}
        </span>
      </div>
      <p data-record-calendar="" className="m-0 mt-1 text-sm leading-[1.5] text-ink-2">
        {day.line}
      </p>
    </div>
  );
}

/**
 * The vault's answer, in the verdict grammar ("Refused · Market closed (MARKET_CLOSED)"), on the engine card's plates:
 * a refusal white on ink, an allowed trade on the quiet accent tint. The reason's words and its code stay on one line.
 */
function Answer({ moment }: { moment: RecordMoment }) {
  const refused = !moment.allowed;
  return (
    <p
      data-record-verdict={refused ? "refused" : "allowed"}
      data-reason={moment.reason}
      className={`m-0 flex flex-col gap-1 rounded-[14px] px-[18px] py-4 ${refused ? "bg-ink text-white" : "border border-accent-soft bg-accent-tint text-ink"}`}
    >
      <span className={`font-mono text-[11px] ${refused ? "opacity-80" : "text-label"}`}>VAULT DECISION</span>{" "}
      <span>
        <span className={`text-[28px] font-semibold tracking-[-0.03em] sm:text-[32px] ${refused ? "text-white" : "text-accent"}`}>
          {refused ? "Refused" : "Allowed"}
        </span>
        <span className="text-[17px] font-medium"> · </span>
        <span className="whitespace-nowrap">
          <span className="text-[17px] font-medium">{REASON_LABEL[moment.reason]}</span>{" "}
          <span className="font-mono text-[12px]">({moment.reason})</span>
        </span>
      </span>
    </p>
  );
}

/**
 * One moment. On a phone, top to bottom: where it is recorded, what was asked and by whom, the vault's answer; then why,
 * in one line, on the day's bar, in Claude's own words when Claude proposed it; then the way to the transaction. From
 * `lg` the answer and the way to the transaction share the left column, and the why fills the right one.
 */
function Moment({ moment }: { moment: RecordMoment }) {
  return (
    <div className="anim-row card grid gap-6 p-5 sm:p-8 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:gap-x-16">
      <div className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1">
        <SourcePlate kind="edition" data-record-source="">{`Base mainnet · block ${formatInt(Number(moment.block))}`}</SourcePlate>
        <div className="flex flex-col gap-1">
          <p data-record-intent="" className="m-0 text-[24px] font-semibold tracking-[-0.03em] sm:text-[28px]">
            {moment.action} {moment.symbol} · {moment.amount}
          </p>
          <p data-record-when="" className="m-0 font-mono text-[12px] text-ink-2">
            {recordWhen(moment.ts)}
          </p>
          <p data-record-sender="" className="m-0 text-sm leading-[1.5] text-ink-2">
            {RECORD_SENDER[moment.sender]}
          </p>
        </div>
        <Answer moment={moment} />
      </div>
      <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-span-2 lg:row-start-1">
        <p data-record-story="" className="m-0 text-[17px] font-medium leading-[1.45] tracking-[-0.01em] text-ink">
          {moment.story}
        </p>
        <DayBar moment={moment} />
        {moment.quote === undefined ? null : (
          <figure className="m-0 flex flex-col gap-2">
            <blockquote className="m-0 border-l-2 border-accent pl-4 text-[15px] italic leading-[1.55] text-ink">“{moment.quote}”</blockquote>
            <figcaption className="text-[12px] text-label">Claude&apos;s words, carried in the transaction</figcaption>
          </figure>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 lg:col-start-1 lg:row-start-2 lg:self-end">
        <a href={basescanDecision(moment.txHash)} className="tap self-start text-[15px] font-medium">
          Open it on Basescan
          <span aria-hidden="true"> ↗</span>
        </a>
        <p className="m-0 font-mono text-[12px] text-ink-2">tx {shortTx(moment.txHash)}</p>
        {moment.reason === "OK" ? null : (
          <p data-record-basescan-note="" className="m-0 text-[13px] leading-[1.5] text-ink-2">
            {basescanRefusalNote(moment.reason)}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The heading's sentences, each kept whole on a line where it fits, so it breaks between them first. The space between
 * them stays outside the spans: a space at the start of an inline-block is not drawn.
 */
const TITLE = RECORD_TITLE.split(/(?<=\.) /).flatMap((sentence, i) => [
  i > 0 ? " " : null,
  <span key={sentence} className="inline-block">
    {sentence}
  </span>,
]);

/**
 * "On the record", right under the hero (spec 2026-11-28, landing "a calmer first screen", section 2): the visitor picks
 * a moment and reads what the vault answered, on Base mainnet, with the calendar's reason and the transaction. The
 * moments are tabs over one panel each, in one row at every width. Only the open moment is drawn, so the static HTML
 * holds the first one (a reader without JavaScript gets it) and the landing's weight grows by one panel, not three; the
 * block below the card moves when a taller moment opens, which a user's own tap allows. Arrow keys, Home and End move
 * between the tabs, as on the engine card, and leave a shortcut with a modifier key to the browser. The links to every
 * Decision and to the simulator, and the spec plate, close the block.
 */
export function OnTheRecord() {
  const [tab, setTab] = useState<MomentId>(RECORD_MOMENTS[0].id);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const ids = RECORD_MOMENTS.map((m) => m.id);
    const now = ids.indexOf(tab);
    const last = ids.length - 1;
    const next =
      e.key === "ArrowRight" ? (now + 1) % ids.length : e.key === "ArrowLeft" ? (now + last) % ids.length : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(ids[next]!);
    buttons.current[next]?.focus();
  };

  return (
    <section id="record" aria-labelledby="record-title">
      <div className="wrap flex flex-col gap-8 py-14 md:gap-10 md:py-24">
        <SectionHeading eyebrow={RECORD_EYEBROW} title={TITLE} lead={RECORD_LEAD} layout="split" id="record-title" />
        <div className="flex flex-col gap-4">
          {/* Below 380 px the first tab, the one long word, gets a little more of the row. */}
          <div
            role="tablist"
            aria-label="Moments on Base mainnet"
            onKeyDown={onKeyDown}
            className="grid w-full grid-cols-3 gap-2 max-[379px]:grid-cols-[1.25fr_1fr_1fr] lg:max-w-[calc(50%-2rem)]"
          >
            {RECORD_MOMENTS.map((m, i) => {
              const on = tab === m.id;
              return (
                <button
                  key={m.id}
                  ref={(el) => {
                    buttons.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`record-tab-${m.id}`}
                  aria-selected={on}
                  aria-controls={`record-panel-${m.id}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setTab(m.id)}
                  className={`tick-colour flex min-h-11 min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-[14px] border px-2.5 py-2.5 text-left sm:px-4 ${
                    on ? "border-ink bg-ink text-white forced-colors:border-[3px]" : "border-line-strong bg-white text-ink hover:border-ink"
                  }`}
                >
                  <span className={`font-mono text-[11px] ${on ? "text-white/75" : "text-label"}`}>{recordTabTime(m.ts)}</span>{" "}
                  <span data-record-tab-label="" className="text-[13px] font-medium leading-[1.25] sm:text-[15px]">
                    {m.tab}
                  </span>
                </button>
              );
            })}
          </div>
          {RECORD_MOMENTS.map((m) => (
            <div key={m.id} role="tabpanel" id={`record-panel-${m.id}`} aria-labelledby={`record-tab-${m.id}`} tabIndex={0} hidden={tab !== m.id}>
              {tab === m.id ? <Moment moment={m} /> : null}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <ul className="m-0 flex list-none flex-col gap-y-6 p-0 text-[15px] font-medium sm:flex-row sm:flex-wrap sm:gap-x-8">
            {RECORD_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="tap">
                  {l.label}
                  {/* A no-break space ties the arrow to the last word, so it never wraps onto a line alone. */}
                  <span aria-hidden="true">{" "}{l.arrow}</span>
                </a>
              </li>
            ))}
          </ul>
          <SpecPlate className="w-full lg:w-[calc(50%-2rem)]" />
        </div>
      </div>
    </section>
  );
}
