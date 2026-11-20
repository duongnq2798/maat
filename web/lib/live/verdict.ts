import { localTime, regularSession, WEEKDAY_NAMES } from "@/content/calendar";
import { CHECK_LABELS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { andList, clockLabel } from "@/content/format";
import { type ReasonCode, reasonText, type RefusalCode } from "@/content/reasons";
import { premiumBps } from "./price";
import type { LiveSnapshot, TokenReading } from "./snapshot";

export interface Limits {
  maxStalenessSec: number;
  maxPremiumBps: number;
  multiplierCooldownSec: number;
}

const MANDATE = FACTS.mandate.value;
export const DEFAULT_LIMITS: Limits = {
  maxStalenessSec: MANDATE.maxStalenessSec,
  maxPremiumBps: MANDATE.maxPremiumBps,
  multiplierCooldownSec: MANDATE.multiplierCooldownSec,
};

export interface Session {
  open: boolean;
  source: "repo" | "onchain";
  /** "Saturday · NYSE closed", "Friday · open until 16:00 ET", "19:05 ET · closed at 16:00". */
  detail: string;
}

function sessionDetail(ts: number): { open: boolean; detail: string } {
  const s = regularSession(ts);
  const t = localTime(ts);
  const name = WEEKDAY_NAMES[t.weekday] ?? "";
  const at = `${clockLabel(t.minuteOfDay)} ET`;
  if (s.open) return { open: true, detail: `${name} · open until ${clockLabel(s.closeMin)} ET` };
  switch (s.why) {
    case "holiday":
      return { open: false, detail: `${s.holiday} · NYSE closed` };
    case "weekend":
      return { open: false, detail: `${name} · NYSE closed` };
    case "before-open":
      return { open: false, detail: `${at} · opens ${clockLabel(s.openMin)}` };
    case "after-close":
      return {
        open: false,
        detail:
          s.closeMin < FACTS.nyseSessionMin.value.close
            ? `${at} · early close ${clockLabel(s.closeMin)}`
            : `${at} · closed at ${clockLabel(s.closeMin)}`,
      };
  }
}

/** The session at the block: MarketCalendar when deployed (a failed read counts as closed), else the repo's REGULAR calendar. */
export function sessionAt(snapshot: Pick<LiveSnapshot, "timestamp" | "calendar">): Session {
  const repo = sessionDetail(snapshot.timestamp);
  if (snapshot.calendar.source === "onchain") {
    return { open: snapshot.calendar.open === true, source: "onchain", detail: repo.detail };
  }
  return { open: repo.open, source: "repo", detail: repo.detail };
}

export type Mark = "PASS" | "FAIL" | "SKIP" | "NOT_RUN";

export interface LiveCheck {
  n: number;
  label: string;
  mark: Mark;
  detail: string;
}

export interface TokenVerdict {
  symbol: string;
  inBasket: boolean;
  /** What MandateVault would answer, from check 1. */
  mandate: ReasonCode;
  /** The same from check 2 on, ignoring the basket. */
  market: ReasonCode;
  /** The nine rows of the mandate run; for a token outside the basket row 1 fails and rows 2-7 show the market run. */
  checks: LiveCheck[];
  feedAgeSec: number | null;
  premiumBps: bigint | null;
}

interface Outcome {
  /** "OK" when the check passes. */
  reason: ReasonCode;
  detail: string;
}

const ok = (detail: string): Outcome => ({ reason: "OK", detail });
const fail = (reason: RefusalCode, detail: string): Outcome => ({ reason, detail });

function hours(sec: number): string {
  return String(Math.round((sec / 3600) * 10) / 10);
}

const NOT_RUN_DETAIL: Readonly<Record<number, string>> = {
  3: "needs a deployed vault",
  8: "needs a vault's balances",
  9: "needs a vault's balances",
};

export function judgeToken(
  r: TokenReading,
  ctx: { timestamp: number; session: Session; limits?: Limits },
): TokenVerdict {
  const limits = ctx.limits ?? DEFAULT_LIMITS;
  const { timestamp, session } = ctx;
  const inBasket = (FACTS.basket.value as readonly string[]).includes(r.symbol);

  // The feed, read once: valid when it can be priced, whatever the session says.
  const feed = r.feed;
  const feedValid = feed !== null && feed.answer > 0n && feed.updatedAt !== 0n && feed.updatedAt <= BigInt(timestamp);
  const feedAgeSec = feedValid ? timestamp - Number(feed.updatedAt) : null;
  const dexPremium = r.twap8 !== null && feed !== null && feed.answer > 0n ? premiumBps(r.twap8, feed.answer) : null;

  const out: Outcome[] = [];
  out[1] = inBasket ? ok("in the basket") : fail("TOKEN_NOT_ALLOWED", "not in the basket");
  out[2] =
    r.paused === false ? ok("not paused") : fail("TOKEN_PAUSED", r.paused === true ? "paused" : "could not read");
  out[4] = session.open ? ok(session.detail) : fail("MARKET_CLOSED", session.detail);

  if (feedAgeSec === null) out[5] = fail("BAD_PRICE", feed === null ? "feed unreadable" : "no valid price");
  else if (feedAgeSec > limits.maxStalenessSec) {
    out[5] = fail("FEED_STALE", `${feedAgeSec}s > ${limits.maxStalenessSec}s`);
  } else out[5] = ok(`${feedAgeSec}s ≤ ${limits.maxStalenessSec}s`);

  const cool = hours(limits.multiplierCooldownSec);
  if (r.uiMultiplier === null || r.effectiveAt === null) out[6] = fail("MULTIPLIER_COOLDOWN", "could not read");
  else if (r.effectiveAt > BigInt(timestamp)) out[6] = fail("MULTIPLIER_COOLDOWN", "change scheduled");
  else if (r.effectiveAt !== 0n && BigInt(timestamp) < r.effectiveAt + BigInt(limits.multiplierCooldownSec)) {
    const ago = timestamp - Number(r.effectiveAt);
    out[6] = fail("MULTIPLIER_COOLDOWN", `changed ${hours(ago)} h ago, cooldown ${cool} h`);
  } else out[6] = ok(`no change in ${cool} h`);

  if (r.twap8 === null) out[7] = fail("BAD_PRICE", "pool TWAP unreadable");
  else if (dexPremium === null) out[7] = fail("BAD_PRICE", "no valid oracle price");
  else if (dexPremium > BigInt(limits.maxPremiumBps)) {
    out[7] = fail("PREMIUM_TOO_HIGH", `${dexPremium} > ${limits.maxPremiumBps} bps`);
  } else out[7] = ok(`${dexPremium} ≤ ${limits.maxPremiumBps} bps`);

  // One run of the nine checks from check `from`, first failure stops (the rest of 4-7 is SKIP).
  const run = (from: number): { rows: LiveCheck[]; reason: ReasonCode } => {
    const rows: LiveCheck[] = [];
    let reason: ReasonCode = "OK";
    for (let n = 1; n <= 9; n++) {
      const label = CHECK_LABELS[n - 1] ?? "";
      const o = out[n];
      if (o === undefined) rows.push({ n, label, mark: "NOT_RUN", detail: NOT_RUN_DETAIL[n] ?? "" });
      else if (n < from || reason !== "OK") rows.push({ n, label, mark: "SKIP", detail: "not reached" });
      else if (o.reason === "OK") rows.push({ n, label, mark: "PASS", detail: o.detail });
      else {
        reason = o.reason;
        rows.push({ n, label, mark: "FAIL", detail: o.detail });
      }
    }
    return { rows, reason };
  };

  const mandateRun = run(1);
  const marketRun = run(2);
  const first = mandateRun.rows[0];
  const checks = inBasket || first === undefined ? mandateRun.rows : [first, ...marketRun.rows.slice(1)];
  return {
    symbol: r.symbol,
    inBasket,
    mandate: mandateRun.reason,
    market: marketRun.reason,
    checks,
    feedAgeSec,
    premiumBps: dexPremium,
  };
}

export type Headline =
  | { kind: "refuse-all"; reason: RefusalCode }
  | { kind: "mixed"; refused: { symbol: string; reason: RefusalCode }[]; passed: string[] }
  | { kind: "pass-all"; passed: string[] };

/** Over the basket tokens only, in basket order. */
export function headline(verdicts: readonly TokenVerdict[]): Headline {
  const inBasket = FACTS.basket.value
    .map((s) => verdicts.find((v) => v.inBasket && v.symbol === s))
    .filter((v): v is TokenVerdict => v !== undefined);
  const refused: { symbol: string; reason: RefusalCode }[] = [];
  const passed: string[] = [];
  for (const v of inBasket) {
    if (v.mandate === "OK") passed.push(v.symbol);
    else refused.push({ symbol: v.symbol, reason: v.mandate });
  }
  const first = refused[0];
  if (first === undefined) return { kind: "pass-all", passed };
  if (passed.length === 0 && refused.every((x) => x.reason === first.reason)) {
    return { kind: "refuse-all", reason: first.reason };
  }
  return { kind: "mixed", refused, passed };
}

const LEAD = "An agent under Maat's default mandate would";

export function headlineText(h: Headline): string {
  switch (h.kind) {
    case "refuse-all":
      return `${LEAD} REFUSE: ${reasonText(h.reason)}`;
    case "pass-all":
      return `${LEAD} pass the market checks for ${andList(h.passed)}. The vault's own checks are not run here.`;
    case "mixed": {
      const refused = h.refused.map((x) => `${x.symbol}: ${reasonText(x.reason)}`).join("; ");
      const tail = h.passed.length > 0 ? ` Market checks pass for ${andList(h.passed)}.` : "";
      return `${LEAD} REFUSE ${refused}.${tail}`;
    }
  }
}
