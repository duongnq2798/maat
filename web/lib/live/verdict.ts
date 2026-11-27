import { companyGloss } from "@/content/b20-nav";
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
  // The strip and /now print the block's ET clock right before this detail, so the detail never repeats it.
  const name = WEEKDAY_NAMES[t.weekday] ?? "";
  if (s.open) return { open: true, detail: `${name} · open until ${clockLabel(s.closeMin)} ET` };
  switch (s.why) {
    case "holiday":
      return { open: false, detail: `${s.holiday} · NYSE closed` };
    case "weekend":
      return { open: false, detail: `${name} · NYSE closed` };
    case "before-open":
      return { open: false, detail: `${name} · opens ${clockLabel(s.openMin)} ET` };
    case "after-close":
      return {
        open: false,
        detail:
          s.closeMin < FACTS.nyseSessionMin.value.close
            ? `${name} · early close ${clockLabel(s.closeMin)} ET`
            : `${name} · closed at ${clockLabel(s.closeMin)} ET`,
      };
  }
}

/** The session at the block: MarketCalendar when deployed (a failed read counts as closed), else the repo's REGULAR calendar. */
export function sessionAt(snapshot: Pick<LiveSnapshot, "timestamp" | "calendar">): Session {
  const repo = sessionDetail(snapshot.timestamp);
  const cal = snapshot.calendar;
  if (cal.source === "repo") return { open: repo.open, source: "repo", detail: repo.detail };
  if (cal.open === null) return { open: false, source: "onchain", detail: "MarketCalendar unreadable · counted closed" };
  if (cal.open === repo.open) return { open: cal.open, source: "onchain", detail: repo.detail };
  return { open: cal.open, source: "onchain", detail: cal.open ? "MarketCalendar: open" : "MarketCalendar: closed" };
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

const HOUR_SEC = 3600;

/** Hours floored to 0.1 h, so a cooldown that has not ended never reads as its full length. */
function hours(sec: number): string {
  return String(Math.floor((sec * 10) / HOUR_SEC) / 10);
}

const NOT_RUN_DETAIL: Readonly<Record<number, string>> = {
  3: "needs a vault's address",
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

/** Every headline's first words; the landing's Readout sets them apart, above the verdict (components/live/VerdictLine.tsx). */
export const LEAD = "An agent under Maat's default mandate would";
/** The verdict's verb when a token is refused; the landing's Readout sets it at the verdict size in a mixed headline. */
export const REFUSE = "REFUSE";
/** Ends the headline when nothing is refused; the strip and /now link these words to the method (spec 4). */
export const VAULT_NOT_RUN = "vault checks not run";

export function headlineText(h: Headline): string {
  switch (h.kind) {
    case "refuse-all":
      return `${LEAD} ${REFUSE}: ${reasonText(h.reason)}`;
    case "pass-all":
      return `${LEAD} pass the market checks for ${andList(h.passed)}; ${VAULT_NOT_RUN}.`;
    case "mixed": {
      const refused = h.refused.map((x) => `${x.symbol}: ${reasonText(x.reason)}`).join("; ");
      const tail = h.passed.length > 0 ? ` Market checks pass for ${andList(h.passed)}.` : "";
      return `${LEAD} ${REFUSE} ${refused}.${tail}`;
    }
  }
}

/**
 * The landing hero's live line (spec 2026-11-27, landing "explain in 10 seconds", section 1): a label, then the verdict a
 * buy of each basket token would get, in the vault's own grammar, "Refused · Market closed (MARKET_CLOSED)". A reading
 * that is not live says so in its label, never "Right now".
 */
export const BUY_LEAD = "Right now, a buy would be:";
export const BUY_LEAD_NOT_LIVE = "At the last read, a buy would be:";
/**
 * The label when the default mandate refuses no basket token: the line names the tokens that pass the market checks,
 * and never says Allowed, since checks 3, 8 and 9 need a vault and the line runs none (review of PR #105: "a buy would
 * be: Market checks pass" did not parse).
 */
export const PASS_LEAD = "Right now, a buy would pass the market checks:";
export const PASS_LEAD_NOT_LIVE = "At the last read, a buy would pass the market checks:";
/** After a pass, the checks the line does not run; the hero links these words to the method on /now. */
export const OTHER_CHECKS = "The vault runs the other checks on a real trade";
/** The verdict's word when a basket token is refused; the hero sets it at the verdict size. */
export const REFUSED = "Refused";
/** Says what passed without claiming Allowed: checks 3, 8 and 9 need a vault, and the line runs none. */
export const MARKET_CHECKS_PASS = "Market checks pass";

/** A premium, labelled (spec section 4): "pool vs Chainlink 143 bps · limit 100". */
export function premiumText(bps: bigint, limit: number): string {
  return `pool vs Chainlink ${bps} bps · limit ${limit}`;
}

/** The line's label for this headline: what passed when nothing is refused, the verdict a buy would get otherwise. */
export function buyLead(h: Headline, live = true): string {
  if (h.kind === "pass-all") return live ? PASS_LEAD : PASS_LEAD_NOT_LIVE;
  return live ? BUY_LEAD : BUY_LEAD_NOT_LIVE;
}

/** The first ticker the line names: the first token that passes, or the first one refused; none in a refuse-all. */
function firstTicker(h: Headline): string | null {
  switch (h.kind) {
    case "refuse-all":
      return null;
    case "pass-all":
      return h.passed[0] ?? null;
    case "mixed":
      return h.refused[0]?.symbol ?? null;
  }
}

/**
 * What the line's first ticker stands for, "(NVIDIA, a B20 token on Base)", written right after it (spec 2026-11-27
 * section 4: a ticker is explained the first time it appears, and on a phone this line is the first place one does);
 * null when the line names no ticker or the first is not a NAV token.
 */
export function lineGloss(h: Headline): string | null {
  const symbol = firstTicker(h);
  return symbol === null ? null : companyGloss(symbol);
}

/**
 * The hero's live line as one sentence: the label, then "Refused · <reason>" when every basket token is refused for one
 * reason, "Refused for <token>: <reason>; ..." with the passing tokens after when only some are, and, when none is,
 * the tokens that pass the market checks and the checks the vault runs on a real trade. The first ticker named carries
 * its gloss (lineGloss). A premium refusal gives its premium against the limit. components/live/VerdictLine.tsx shows
 * it with each "Label (CODE)" as its ReasonTag; the strip's live region reads it as it is.
 */
export function buyLineText(
  h: Headline,
  verdicts: readonly TokenVerdict[],
  { live = true, limit = DEFAULT_LIMITS.maxPremiumBps }: { live?: boolean; limit?: number } = {},
): string {
  const lead = buyLead(h, live);
  const gloss = lineGloss(h);
  // The first ticker of the sentence, glossed; every other one bare.
  const named = (symbol: string, first: boolean) => (first && gloss !== null ? `${symbol} ${gloss}` : symbol);
  switch (h.kind) {
    case "refuse-all":
      return `${lead} ${REFUSED} · ${reasonText(h.reason)}`;
    case "pass-all":
      return `${lead} ${andList(h.passed.map((s, i) => named(s, i === 0)))}. ${OTHER_CHECKS}.`;
    case "mixed": {
      const refused = h.refused
        .map((x, i) => {
          const bps = verdicts.find((v) => v.symbol === x.symbol)?.premiumBps ?? null;
          const premium = x.reason === "PREMIUM_TOO_HIGH" && bps !== null ? ` · ${premiumText(bps, limit)}` : "";
          return `${named(x.symbol, i === 0)}: ${reasonText(x.reason)}${premium}`;
        })
        .join("; ");
      const tail = h.passed.length > 0 ? ` ${MARKET_CHECKS_PASS} for ${andList(h.passed)}.` : "";
      return `${lead} ${REFUSED} for ${refused}.${tail}`;
    }
  }
}
