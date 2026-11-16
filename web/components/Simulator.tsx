"use client";

import { type CSSProperties, Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import { isoOfDay, localTime, parseIsoDay, sessionWindow, WINDOW } from "@/content/calendar";
import type { CheckMark } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { clockLabel, dayLabel } from "@/content/format";
import { REASON_MEANING } from "@/content/reasons";
import {
  AMOUNT_CHIPS_USD,
  amountPending,
  amountText,
  DEFAULT_SCENARIO,
  daySummary,
  dayNote,
  decodeScenario,
  encodeScenario,
  evaluate,
  formatUsd,
  MAX_TAPE,
  momentLabel,
  PRESETS,
  parseUsd,
  postText,
  postUrl,
  replay,
  type Scenario,
  type SimIntent,
  simIntentLabel,
  TOKENS,
  tokenLabel,
} from "@/content/simulator";

const MARK_STYLE: Record<CheckMark, string> = {
  PASS: "bg-accent-tint text-accent",
  FAIL: "bg-refuse text-white",
  SKIP: "bg-line-soft text-ink-2",
};
const FIELDSET = "m-0 min-w-0 border-0 p-0";
const LEGEND = "mb-3 p-0 font-mono text-[11px] text-ink-2";
const DAY_MINUTES = 1440;
const USD6 = 1_000_000;
const pct = (bps: number) => `${bps / 100}%`;
/** The window spans a year end, so its bounds carry the year: "Thu 5 Nov 2026". */
function withYear(dayNumber: number): string {
  const iso = isoOfDay(dayNumber);
  return `${dayLabel(iso)} ${iso.slice(0, 4)}`;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] font-medium ${
        on ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-ink hover:border-ink"
      }`}
    >
      {children}
    </button>
  );
}

interface RowProps {
  n: string;
  label: string;
  detail: string;
  mark: CheckMark;
  check: string;
  fixed?: boolean;
}

function Row({ n, label, detail, mark, check, fixed = false }: RowProps) {
  return (
    <li
      data-check={check}
      data-mark={mark}
      data-fixed={fixed || undefined}
      className={`grid grid-cols-[28px_minmax(0,1fr)_52px] items-center gap-3 rounded-[10px] px-2.5 py-[9px] ${
        mark === "FAIL" ? "bg-refuse-tint" : ""
      }`}
    >
      <span aria-hidden="true" className="font-mono text-[11px] text-ink-2">
        {n}
      </span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className={`text-sm font-medium ${mark === "SKIP" ? "text-ink-2" : ""}`}>
          {label}
          {fixed ? (
            <span className="ml-2 rounded border border-line px-1.5 py-px font-mono text-[10px] font-normal text-ink-2">
              fork
            </span>
          ) : null}
        </span>
        <span className="font-mono text-xs text-ink-2">{detail}</span>
      </span>
      <span className={`rounded-md py-1 text-center font-mono text-[11px] font-semibold ${MARK_STYLE[mark]}`}>{mark}</span>
    </li>
  );
}

/** The visitor's clock in New York, when it falls on a day the calendar lists. */
function clockNow(): { etDay: number; minute: number } | undefined {
  const t = localTime(Math.floor(Date.now() / 1000));
  return t.etDay >= WINDOW.first && t.etDay <= WINDOW.last ? { etDay: t.etDay, minute: t.minuteOfDay } : undefined;
}

type Copy = "idle" | "copied" | "manual";

const COPIED = "Link copied.";
const COPY_BY_HAND = "Copy the link below.";

export function Simulator() {
  const [s, setS] = useState<Scenario>(DEFAULT_SCENARIO);
  const [amount, setAmount] = useState(amountText(DEFAULT_SCENARIO.intent.usd6));
  const [origin, setOrigin] = useState("");
  const [now, setNow] = useState<{ etDay: number; minute: number }>();
  const [copy, setCopy] = useState<Copy>("idle");
  // What the last Execute or Copy link did, in a live region of its own. The verdict box above previews the next
  // Execute, so a visitor needs this line to tell the click they just made from the preview.
  const [notice, setNotice] = useState("");
  // What the date field holds while a typed date is not (yet) a day in the window; undefined shows the committed day.
  const [dayDraft, setDayDraft] = useState<string>();

  // After hydration, so the static HTML always holds the default: a share link's scenario, this page's
  // address, and the visitor's clock read in New York time through the calendar port.
  useEffect(() => {
    const shared = decodeScenario(window.location.search);
    setS(shared);
    setAmount(amountText(shared.intent.usd6));
    setOrigin(`${window.location.origin}${window.location.pathname}`);
    setNow(clockNow());
  }, []);

  const day = useMemo(() => replay(s.etDay, s.tape), [s.etDay, s.tape]);
  const result = evaluate(day, s.intent);
  const summary = daySummary(day);
  const link = `${origin}${encodeScenario(s)}#try`;
  const parsed = parseUsd(amount) !== undefined;
  // "1," on the way to "1,000" keeps Execute off but is not flagged: the next keystroke may finish it.
  const invalid = !parsed && !amountPending(amount);
  const full = s.tape.length >= MAX_TAPE;
  const session = sessionWindow(s.etDay);
  const dayInvalid = dayDraft !== undefined && dayDraft !== isoOfDay(s.etDay);

  // A new link ends the copy state, and the notice that went with it.
  useEffect(() => {
    setCopy("idle");
    setNotice((n) => (n === COPIED || n === COPY_BY_HAND ? "" : n));
  }, [link]);

  const setIntent = (patch: Partial<SimIntent>) => setS((p) => ({ ...p, intent: { ...p.intent, ...patch } }));
  // Another date is another day: the tape starts over.
  const setMoment = (etDay: number, minute: number) => {
    setDayDraft(undefined);
    if (etDay !== s.etDay) setNotice("");
    setS((p) => ({ ...p, etDay, tape: etDay === p.etDay ? p.tape : [], intent: { ...p.intent, minute } }));
  };
  // The chip is offered from the clock at mount; a click reads the clock again, so Now is now, not then.
  const goNow = () => {
    const fresh = clockNow();
    setNow(fresh);
    if (fresh) setMoment(fresh.etDay, fresh.minute);
  };
  const onAmount = (text: string) => {
    setAmount(text);
    const usd6 = parseUsd(text);
    if (usd6 === undefined) setNotice("");
    else setIntent({ usd6 });
  };
  // A date field fires onChange on every keystroke, often with a date outside the window (typing a month "1" gives
  // January). Such a date stays in the field as a draft, so the next keystroke can finish it, and does not move the day.
  const onDay = (iso: string) => {
    setDayDraft(iso);
    const d = parseIsoDay(iso);
    if (d !== undefined && d >= WINDOW.first && d <= WINDOW.last) setMoment(d, s.intent.minute);
  };
  // The entry gets the verdict the box shows now, so the notice reports it.
  const run = () => {
    if (!parsed || full) return;
    setS((p) => (p.tape.length >= MAX_TAPE ? p : { ...p, tape: [...p.tape, p.intent] }));
    setNotice(
      `Executed ${clockLabel(s.intent.minute)} ${simIntentLabel(s.intent)}: ${result.allowed ? "Allowed" : `Refused · ${result.reason}`}`,
    );
  };
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopy("copied");
      setNotice(COPIED);
    } catch {
      setCopy("manual");
      setNotice(COPY_BY_HAND);
    }
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] items-start gap-6">
      <div className="card flex flex-col gap-7 p-[22px]">
        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>TOKEN · BUY</legend>
          <div className="flex flex-wrap gap-2">
            {TOKENS.map((t) => (
              <Chip key={t} on={s.intent.token === t} onClick={() => setIntent({ token: t })}>
                {tokenLabel(t)}
              </Chip>
            ))}
          </div>
        </fieldset>

        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>AMOUNT · USD</legend>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-h-10 items-center rounded-full border border-line-strong bg-white pl-3.5 pr-2 focus-within:border-ink">
              <span aria-hidden="true" className="font-mono text-sm text-ink-2">
                $
              </span>
              <input
                aria-label="Amount in US dollars"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => onAmount(e.target.value)}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? "sim-amount-error" : undefined}
                className="w-[7.5rem] border-0 bg-transparent px-1.5 py-2 font-mono text-sm text-ink"
              />
            </div>
            {AMOUNT_CHIPS_USD.map((usd) => (
              <Chip
                key={usd}
                on={parsed && s.intent.usd6 === usd * USD6}
                onClick={() => {
                  setAmount(String(usd));
                  setIntent({ usd6: usd * USD6 });
                }}
              >
                {formatUsd(usd * USD6)}
              </Chip>
            ))}
          </div>
          {invalid ? (
            <p id="sim-amount-error" className="m-0 mt-2 text-[13px] text-refuse">
              Use dollars with up to two decimals, like 50 or 12.50.
            </p>
          ) : null}
        </fieldset>

        <fieldset className={FIELDSET}>
          <legend className={LEGEND}>MOMENT · NEW YORK TIME</legend>
          <div role="group" aria-label="Moment presets" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Chip key={p.id} on={s.etDay === p.etDay && s.intent.minute === p.minute} onClick={() => setMoment(p.etDay, p.minute)}>
                {p.label}
              </Chip>
            ))}
            {now ? (
              <Chip
                on={s.etDay === now.etDay && s.intent.minute === now.minute}
                onClick={goNow}
              >
                Now
              </Chip>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <label htmlFor="sim-day" className="text-sm font-medium">
              Day
            </label>
            <input
              id="sim-day"
              type="date"
              min={isoOfDay(WINDOW.first)}
              max={isoOfDay(WINDOW.last)}
              value={dayDraft ?? isoOfDay(s.etDay)}
              onChange={(e) => onDay(e.target.value)}
              onBlur={() => setDayDraft(undefined)}
              aria-invalid={dayInvalid || undefined}
              aria-describedby={dayInvalid ? "sim-day-hint" : undefined}
              className="min-h-10 rounded-full border border-line-strong bg-white px-3.5 font-mono text-sm text-ink"
            />
            <span className="font-mono text-xs text-ink-2">{dayNote(s.etDay)}</span>
          </div>
          {dayInvalid ? (
            <p id="sim-day-hint" className="m-0 mt-2 text-[13px] text-refuse">
              Pick a date from {withYear(WINDOW.first)} to {withYear(WINDOW.last)}.
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="sim-time" className="text-sm font-medium">
                Time
              </label>
              <span className="font-mono text-sm font-semibold">{clockLabel(s.intent.minute)} ET</span>
            </div>
            <input
              id="sim-time"
              type="range"
              min={0}
              max={DAY_MINUTES - 1}
              step={1}
              value={s.intent.minute}
              onChange={(e) => setIntent({ minute: Number(e.target.value) })}
              aria-valuetext={`${clockLabel(s.intent.minute)} ET`}
              className="time-range"
              style={
                {
                  "--open": `${((session?.openMin ?? 0) / DAY_MINUTES) * 100}%`,
                  "--close": `${((session?.closeMin ?? 0) / DAY_MINUTES) * 100}%`,
                } as CSSProperties
              }
            />
            <div className="flex justify-between gap-3 font-mono text-[11px] text-ink-2">
              <span>00:00</span>
              <span>
                {session ? `NYSE ${clockLabel(session.openMin)}–${clockLabel(session.closeMin)}` : "NYSE closed all day"}
              </span>
              <span>23:59</span>
            </div>
          </div>
        </fieldset>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-head px-5 py-4">
          <span className="font-mono text-xs font-semibold">SIMULATOR</span>
          <span className="font-mono text-[11px] text-ink-2">default mandate · not the contract</span>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 pb-2 pt-5">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[11px] text-ink-2">INTENT</span>
            <span className="text-[26px] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere]">
              {simIntentLabel(s.intent)}
            </span>
          </div>
          <span className="font-mono text-xs text-ink-2">{momentLabel(s.etDay, s.intent.minute)}</span>
        </div>

        <ol aria-label="Simulated checks" className="m-0 list-none px-3 pb-3 pt-2">
          {result.checks.map((c, i) => (
            <Fragment key={c.label}>
              {i === 7 && result.balance !== undefined ? (
                <Row n="—" label="Balance" detail={result.balance} mark="FAIL" check="balance" />
              ) : null}
              <Row
                n={String(i + 1).padStart(2, "0")}
                label={c.label}
                detail={c.detail}
                mark={c.mark}
                check={String(i + 1)}
                fixed={c.fixed}
              />
            </Fragment>
          ))}
        </ol>

        {/* The live region itself never remounts; only its text changes. */}
        <div role="status" aria-live="polite" aria-atomic="true" className="mx-3 mb-3">
          <div
            data-verdict={result.allowed ? "allowed" : "refused"}
            data-reason={result.reason}
            className={`flex flex-col gap-2 rounded-[14px] px-[18px] py-4 text-white ${result.allowed ? "bg-accent" : "bg-ink"}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px] opacity-80">IF EXECUTED NOW · SIMULATED</span>
                <span className="text-[26px] font-semibold tracking-[-0.03em]">{result.allowed ? "Allowed" : "Refused"}</span>
              </div>
              <span className="font-mono text-[13px] font-semibold [overflow-wrap:anywhere]">{result.reason}</span>
            </div>
            <p className="m-0 text-sm leading-normal opacity-90">
              {result.reason === "OK" ? "It says yes. Change one thing to make it say no." : REASON_MEANING[result.reason]}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 px-5 pb-5">
          <button
            type="button"
            onClick={run}
            disabled={!parsed || full}
            className="pill-dark cursor-pointer border-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-ink"
          >
            Execute
          </button>
          <a className="pill-line" href={postUrl(postText(s, result), link)} target="_blank" rel="noopener noreferrer">
            Post on X<span aria-hidden="true"> ↗</span>
          </a>
          <button type="button" onClick={copyLink} className="pill-line cursor-pointer bg-white">
            {copy === "copied" ? "Link copied" : "Copy link"}
          </button>
        </div>
        <p aria-live="polite" aria-atomic="true" className={`m-0 px-5 font-mono text-xs text-ink-2${notice ? " pb-4" : ""}`}>
          {notice}
        </p>
        {copy === "manual" ? (
          <div className="flex flex-col gap-1.5 px-5 pb-5">
            <label htmlFor="sim-link" className="text-[13px] text-ink-2">
              Copy this link:
            </label>
            <input
              id="sim-link"
              readOnly
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="min-h-10 w-full min-w-0 rounded-[10px] border border-line-strong bg-white px-3 font-mono text-xs text-ink"
            />
          </div>
        ) : null}

        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-mono text-[11px] text-ink-2">TODAY · {dayLabel(isoOfDay(s.etDay)).toUpperCase()}</span>
            <button
              type="button"
              onClick={() => {
                setS((p) => ({ ...p, tape: [] }));
                setNotice("");
              }}
              disabled={s.tape.length === 0}
              className="min-h-9 cursor-pointer rounded-full border border-line-strong bg-white px-3.5 text-xs font-medium text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset day
            </button>
          </div>
          {day.tape.length === 0 ? (
            <p className="m-0 mt-3 text-sm leading-normal text-ink-2">
              Nothing executed yet. The day starts with {formatUsd(FACTS.forkVaultUsd.value * USD6)} USDC and no stock;
              another date starts a new day.
            </p>
          ) : (
            <ol aria-label="Today's decisions" className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
              {day.tape.map((e, i) => (
                // The tape only grows or empties, so the index is a stable key.
                <li key={i} data-allowed={e.allowed} className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-xs">
                  <span className="[overflow-wrap:anywhere]">
                    <span className="text-ink-2">{clockLabel(e.intent.minute)}</span> {simIntentLabel(e.intent)}
                  </span>
                  <span className={e.allowed ? "text-accent" : "font-semibold text-refuse"}>
                    {e.allowed ? "Allowed" : `Refused · ${e.reason}`}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <dl className="m-0 mt-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <div>
              <dt className="font-mono text-[11px] text-ink-2">SPENT TODAY</dt>
              <dd className="m-0 mt-1 font-mono text-sm font-semibold">
                {formatUsd(summary.spent6)} of {formatUsd(FACTS.mandate.value.dailyCapUsd * USD6)}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[11px] text-ink-2">WEIGHT · MAX {pct(FACTS.mandate.value.maxWeightBps)}</dt>
              <dd className="m-0 mt-1 font-mono text-sm">
                {FACTS.basket.value.map((t) => `${t} ${pct(summary.weightBps[t])}`).join(" · ")}
              </dd>
            </div>
          </dl>
          {full ? <p className="m-0 mt-3 text-[13px] text-ink-2">The day is full: reset it to keep going.</p> : null}
        </div>
      </div>
    </div>
  );
}
