import {
  DAY_SECONDS,
  etToTimestamp,
  holidayName,
  isoOfDay,
  type LocalTime,
  localTime,
  parseIsoDay,
  regularSession,
  type Session,
  sessionWindow,
  WEEKDAY_NAMES,
  WINDOW,
  weekday,
} from "./calendar";
import { getDecisions } from "./decisions";
import { CHECK_LABELS, type EngineCheck } from "./engine";
import { FACTS } from "./facts";
import { clockLabel, dayLabel, minuteOfClock, numberWord } from "./format";
import type { ReasonCode, RefusalCode } from "./reasons";

/**
 * BUY intents against the default mandate, one ET day at a time (spec 2026-11-08 §3). Only what can be decided
 * offline is computed; checks 2, 3, 5, 6 and 7 hold the fork's values. The contract is the source of truth.
 */

export type BasketToken = (typeof FACTS.basket.value)[number];
export type SimToken = BasketToken | "OTHER";

/** FACTS.feedAgeSec is the age of this token's Chainlink answer at the fork block; no age was measured for the others. */
export const FEED_AGE_TOKEN: BasketToken = "NVDAc";

export const TOKENS: readonly SimToken[] = [...FACTS.basket.value, "OTHER"];

export function tokenLabel(t: SimToken): string {
  return t === "OTHER" ? "Other token" : t;
}

function isBasketToken(s: string): s is BasketToken {
  return (FACTS.basket.value as readonly string[]).includes(s);
}

export interface SimIntent {
  readonly token: SimToken;
  /** USDC in, 6 decimals, as the vault counts it. */
  readonly usd6: number;
  /** ET minute of the day. */
  readonly minute: number;
}

export interface TapeEntry {
  readonly intent: SimIntent;
  readonly allowed: boolean;
  readonly reason: ReasonCode;
}

export interface SimDay {
  /** ET day number, day 0 = 1970-01-01. */
  readonly etDay: number;
  readonly tape: readonly TapeEntry[];
}

export interface SimCheck extends EngineCheck {
  /** A fork value the simulator does not compute. */
  readonly fixed: boolean;
}

export interface SimResult {
  readonly checks: readonly SimCheck[];
  /** Set when the vault's balance check, between checks 7 and 8, refuses the intent. */
  readonly balance?: string;
  readonly allowed: boolean;
  readonly reason: ReasonCode;
}

const m = FACTS.mandate.value;
// regularSession() is the only market window the simulator has; a FEED_24_5 mandate would need its own.
if (m.sessionMode !== "REGULAR") {
  throw new Error(`the simulator models REGULAR sessions only; FACTS.mandate.sessionMode is ${m.sessionMode}`);
}
const USD6 = 1_000_000;
const BPS = 10_000;
const START6 = FACTS.forkVaultUsd.value * USD6;
const TRADE_CAP6 = m.perTradeCapUsd * USD6;
const DAILY_CAP6 = m.dailyCapUsd * USD6;

export const MAX_TAPE = 10;
/** $51 trips the per-trade cap; $100 trips both caps. */
export const AMOUNT_CHIPS_USD = [10, 20, m.perTradeCapUsd, m.perTradeCapUsd + 1, m.dailyCapUsd] as const;

/** 50_000_000 → "$50", 12_500_000 → "$12.50", 1_000_000_000 → "$1,000". */
export function formatUsd(usd6: number): string {
  const cents = Math.round(usd6 / 10_000);
  const digits = cents % 100 === 0 ? 0 : 2;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 50_000_000 → "50", 12_500_000 → "12.50": the amount field and share links. */
export function amountText(usd6: number): string {
  const cents = Math.round(usd6 / 10_000);
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/**
 * An amount as people type it, in USDC with 6 decimals, or undefined. Spaces around it, one leading "$" ("$ 20"),
 * commas only as thousands groups ("1,000", "12,345,678.5") and, when there is no period, one decimal comma with
 * one or two digits ("12,50", "12,5") for keypads in comma-decimal locales. Anything else is not an amount.
 */
export function parseUsd(text: string): number | undefined {
  const amount = text.trim().replace(/^\$\s*/, "");
  const match = /^(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{0,2}))?$/.exec(amount) ?? /^(\d+),(\d{1,2})$/.exec(amount);
  if (!match) return undefined;
  const whole = (match[1] ?? "").replace(/,/g, "");
  if (whole.length > 9) return undefined;
  return Number(whole) * USD6 + Number((match[2] ?? "").padEnd(2, "0")) * 10_000;
}

const pct = (bps: number) => `${bps / 100}%`;

export function simIntentLabel(i: SimIntent): string {
  return `BUY ${tokenLabel(i.token)} · ${formatUsd(i.usd6)}`;
}

export function momentLabel(etDay: number, minute: number): string {
  return `${dayLabel(isoOfDay(etDay))} · ${clockLabel(minute)} ET`;
}

/** "Thursday", "Saturday · closed all day", "Thursday · Thanksgiving, closed all day", "Friday · closes 13:00". */
export function dayNote(etDay: number): string {
  const name = WEEKDAY_NAMES[weekday(etDay)] ?? "";
  const holiday = holidayName(etDay);
  if (holiday !== undefined) return `${name} · ${holiday}, closed all day`;
  const session = sessionWindow(etDay);
  if (!session) return `${name} · closed all day`;
  return session.closeMin < FACTS.nyseSessionMin.value.close ? `${name} · closes ${clockLabel(session.closeMin)}` : name;
}

function sessionDetail(s: Session, t: LocalTime): string {
  const name = WEEKDAY_NAMES[t.weekday] ?? "";
  const at = clockLabel(t.minuteOfDay);
  if (s.open) return `${name} · open until ${clockLabel(s.closeMin)}`;
  switch (s.why) {
    case "holiday":
      return `${s.holiday} · NYSE closed`;
    case "weekend":
      return `${name} · NYSE closed`;
    case "before-open":
      return `${at} · opens ${clockLabel(s.openMin)}`;
    case "after-close":
      return s.closeMin < FACTS.nyseSessionMin.value.close
        ? `${at} · early close ${clockLabel(s.closeMin)}`
        : `${at} · closed at ${clockLabel(s.closeMin)}`;
  }
}

interface Book {
  usdc6: number;
  held6: Record<BasketToken, number>;
}

/** The vault after the day's allowed buys, holdings at cost. */
function book(tape: readonly TapeEntry[]): Book {
  const held6 = Object.fromEntries(FACTS.basket.value.map((t) => [t, 0])) as Record<BasketToken, number>;
  let usdc6 = START6;
  for (const e of tape) {
    if (!e.allowed || e.intent.token === "OTHER") continue;
    held6[e.intent.token] += e.intent.usd6;
    usdc6 -= e.intent.usd6;
  }
  return { usdc6, held6 };
}

const totalOf = (b: Book) => b.usdc6 + Object.values(b.held6).reduce((sum, v) => sum + v, 0);

/** MandateVault.spentOnDay[today()]: the allowed buys in the same UTC day as ts. */
function spentOnUtcDay(day: SimDay, ts: number): number {
  const utcDay = Math.floor(ts / DAY_SECONDS);
  return day.tape
    .filter((e) => e.allowed && Math.floor(etToTimestamp(day.etDay, e.intent.minute) / DAY_SECONDS) === utcDay)
    .reduce((sum, e) => sum + e.intent.usd6, 0);
}

/** MandateVault._check for a BUY, in contract order: the first failure stops the run. */
export function evaluate(day: SimDay, intent: SimIntent): SimResult {
  const ts = etToTimestamp(day.etDay, intent.minute);
  const checks: SimCheck[] = [];
  const check = (pass: boolean, detail: string, fixed = false): boolean => {
    checks.push({ label: CHECK_LABELS[checks.length] ?? "", detail, mark: pass ? "PASS" : "FAIL", fixed });
    return pass;
  };
  const stop = (reason: RefusalCode, balance?: string): SimResult => {
    while (checks.length < CHECK_LABELS.length) {
      checks.push({ label: CHECK_LABELS[checks.length] ?? "", detail: "not reached", mark: "SKIP", fixed: false });
    }
    return { checks, allowed: false, reason, ...(balance === undefined ? {} : { balance }) };
  };

  const { token, usd6 } = intent;
  if (token === "OTHER") {
    check(false, "not in the mandate");
    return stop("TOKEN_NOT_ALLOWED");
  }
  check(true, `${token} in mandate`);
  check(true, "transfers active", true);
  check(true, "authorized", true);
  const session = regularSession(ts);
  if (!check(session.open, sessionDetail(session, localTime(ts)))) return stop("MARKET_CLOSED");
  check(
    true,
    token === FEED_AGE_TOKEN ? `${FACTS.feedAgeSec.value}s ≤ ${m.maxStalenessSec}s` : `assumed fresh · max ${m.maxStalenessSec}s`,
    true,
  );
  check(true, `no change ${m.multiplierCooldownSec / 3600}h`, true);
  check(true, `${FACTS.premiumsBps.value[token]} ≤ ${m.maxPremiumBps} bps`, true);

  // The vault checks the balance after the market checks and before the caps.
  const b = book(day.tape);
  if (usd6 === 0) return stop("INSUFFICIENT_BALANCE", "amount is zero");
  if (usd6 > b.usdc6) return stop("INSUFFICIENT_BALANCE", `${formatUsd(usd6)} > ${formatUsd(b.usdc6)} USDC`);

  const spent6 = spentOnUtcDay(day, ts) + usd6;
  const size =
    usd6 > TRADE_CAP6
      ? `${formatUsd(usd6)} > ${formatUsd(TRADE_CAP6)} per trade`
      : spent6 > DAILY_CAP6
        ? `${formatUsd(spent6)} > ${formatUsd(DAILY_CAP6)} today`
        : `${formatUsd(usd6)} ≤ ${formatUsd(TRADE_CAP6)} · ${formatUsd(spent6)} of ${formatUsd(DAILY_CAP6)} today`;
  if (!check(usd6 <= TRADE_CAP6 && spent6 <= DAILY_CAP6, size)) return stop("SIZE_LIMIT");

  // _weightAfterBuyBps, with holdings at cost: (held + in) * BPS / total, rounded down.
  const total6 = totalOf(b);
  const weight = total6 === 0 ? BPS : Math.floor(((b.held6[token] + usd6) * BPS) / total6);
  const over = weight > m.maxWeightBps;
  if (!check(!over, `${token} ${pct(weight)} ${over ? ">" : "≤"} ${pct(m.maxWeightBps)}`)) return stop("CONCENTRATION");
  return { checks, allowed: true, reason: "OK" };
}

/** execute(): the intent and its verdict join the day's tape; only an allowed buy moves money. */
export function execute(day: SimDay, intent: SimIntent): SimDay {
  if (day.tape.length >= MAX_TAPE) return day;
  const { allowed, reason } = evaluate(day, intent);
  return { ...day, tape: [...day.tape, { intent, allowed, reason }] };
}

/** A day rebuilt from its intents: every verdict is recomputed, none is taken on trust. */
export function replay(etDay: number, intents: readonly SimIntent[]): SimDay {
  return intents.reduce<SimDay>((d, i) => execute(d, i), { etDay, tape: [] });
}

export interface DaySummary {
  readonly spent6: number;
  readonly weightBps: Readonly<Record<BasketToken, number>>;
}

export function daySummary(day: SimDay): DaySummary {
  const b = book(day.tape);
  const total6 = totalOf(b);
  const weightBps = Object.fromEntries(
    FACTS.basket.value.map((t) => [t, Math.floor((b.held6[t] * BPS) / total6)]),
  ) as Record<BasketToken, number>;
  return { spent6: START6 - b.usdc6, weightBps };
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly etDay: number;
  readonly minute: number;
}

function dayNumber(iso: string): number {
  const d = parseIsoDay(iso);
  if (d === undefined) throw new Error(`not a date: ${iso}`);
  return d;
}

const forkDay = dayNumber(FACTS.forkDay.value);
const forkMinute = minuteOfClock(FACTS.forkTimeEt.value);
const thanksgiving = FACTS.calendar.value.holidays.find((h) => h.name === "Thanksgiving");
const earlyClose = FACTS.calendar.value.earlyCloses[0];
if (!thanksgiving || !earlyClose) throw new Error("the calendar lists no Thanksgiving or no early close");

/** The moments of the brief. A chip without a time sets the fork's time of day. */
export const PRESETS: readonly Preset[] = [
  {
    id: "fork",
    label: `${dayLabel(FACTS.forkDay.value)} · ${FACTS.forkTimeEt.value}`,
    etDay: forkDay,
    minute: forkMinute,
  },
  {
    id: "weekend",
    label: dayLabel(FACTS.forkDay.value, FACTS.weekendOffsetDays.value),
    etDay: forkDay + FACTS.weekendOffsetDays.value,
    minute: forkMinute,
  },
  { id: "after-hours", label: `${dayLabel(FACTS.forkDay.value, 1)} · 19:00`, etDay: forkDay + 1, minute: 19 * 60 },
  { id: "holiday", label: thanksgiving.name, etDay: dayNumber(thanksgiving.date), minute: forkMinute },
  {
    id: "early-close",
    label: `${dayLabel(earlyClose.date)} · ${clockLabel(earlyClose.closeMin + 30)}`,
    etDay: dayNumber(earlyClose.date),
    minute: earlyClose.closeMin + 30,
  },
];

export interface Scenario {
  readonly etDay: number;
  readonly intent: SimIntent;
  /** Intents executed earlier that day, in order. */
  readonly tape: readonly SimIntent[];
}

const forkBuy = getDecisions().find((r) => r.source === "base-fork" && r.allowed && r.action === "BUY");
if (!forkBuy || !isBasketToken(forkBuy.symbol)) throw new Error("the fork ledger has no allowed BUY of a basket token");
const forkToken: BasketToken = forkBuy.symbol;

/** The fork's allowed BUY at the fork moment: the simulator opens on a yes. */
export const DEFAULT_SCENARIO: Scenario = {
  etDay: forkDay,
  intent: { token: forkToken, usd6: forkBuy.amountUsd * USD6, minute: forkMinute },
  tape: [],
};

const hhmm = (minute: number) => clockLabel(minute).replace(":", "");
const leg = (i: SimIntent) => `${i.token === "OTHER" ? "other" : i.token}-${amountText(i.usd6)}`;

/** A share link's query: ?day=2026-11-07&at=1030&buy=NVDAc-50&tape=1030-NVDAc-50,1100-GOOGLc-20 */
export function encodeScenario(s: Scenario): string {
  const parts = [`day=${isoOfDay(s.etDay)}`, `at=${hhmm(s.intent.minute)}`, `buy=${leg(s.intent)}`];
  if (s.tape.length > 0) parts.push(`tape=${s.tape.map((i) => `${hhmm(i.minute)}-${leg(i)}`).join(",")}`);
  return `?${parts.join("&")}`;
}

function parseMinute(text: string): number | undefined {
  const match = /^([01]\d|2[0-3])([0-5]\d)$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function parseLeg(text: string): Pick<SimIntent, "token" | "usd6"> | undefined {
  const match = /^([A-Za-z]+)-([\d.]+)$/.exec(text);
  if (!match) return undefined;
  const symbol = match[1] ?? "";
  const token: SimToken | undefined = symbol === "other" ? "OTHER" : isBasketToken(symbol) ? symbol : undefined;
  const usd6 = parseUsd(match[2] ?? "");
  return token === undefined || usd6 === undefined ? undefined : { token, usd6 };
}

/** A share link back to its scenario. Anything malformed falls back to the default, field by field. */
export function decodeScenario(search: string): Scenario {
  const q = new URLSearchParams(search);
  const d = DEFAULT_SCENARIO;
  const day = parseIsoDay(q.get("day") ?? "");
  const buy = parseLeg(q.get("buy") ?? "");
  const tape = (q.get("tape") ?? "")
    .split(",")
    .flatMap((entry): SimIntent[] => {
      const [at = "", ...rest] = entry.split("-");
      const minute = parseMinute(at);
      const part = parseLeg(rest.join("-"));
      return minute === undefined || part === undefined ? [] : [{ ...part, minute }];
    })
    .slice(0, MAX_TAPE);
  return {
    etDay: day !== undefined && day >= WINDOW.first && day <= WINDOW.last ? day : d.etDay,
    intent: {
      token: buy?.token ?? d.intent.token,
      usd6: buy?.usd6 ?? d.intent.usd6,
      minute: parseMinute(q.get("at") ?? "") ?? d.intent.minute,
    },
    tape,
  };
}

/** The post a visitor shares on X. */
export function postText(s: Scenario, r: Pick<SimResult, "allowed" | "reason">): string {
  const what = `${formatUsd(s.intent.usd6)} of ${s.intent.token === "OTHER" ? "a token outside the mandate" : s.intent.token}`;
  const when = `${dayLabel(isoOfDay(s.etDay))} at ${clockLabel(s.intent.minute)} ET`;
  if (!r.allowed) return `I tried to buy ${what} on ${when}. Maat said no: ${r.reason}.`;
  const nine = numberWord(FACTS.checksPerTrade.value).toLowerCase();
  return `I asked Maat to buy ${what} on ${when}. All ${nine} checks passed. Can you make it say no?`;
}

/** X's web intent: a plain link, no script. The share link rides along once it is absolute (after hydration). */
export function postUrl(text: string, link: string): string {
  const url = /^https?:\/\//.test(link) ? `&url=${encodeURIComponent(link)}` : "";
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}${url}`;
}
