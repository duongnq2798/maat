import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import type { TokenReading } from "@/lib/live/snapshot";
import { DEFAULT_LIMITS, headline, headlineText, judgeToken, sessionAt, type Session } from "@/lib/live/verdict";

const SAT = Date.UTC(2026, 10, 21, 15, 0) / 1000; // Sat 2026-11-21 10:00 ET
const FRI = Date.UTC(2026, 10, 20, 16, 43) / 1000; // Fri 2026-11-20 11:43 ET, in session
const open: Session = { open: true, source: "repo", detail: "Friday · open until 16:00 ET" };
const closed: Session = { open: false, source: "repo", detail: "Saturday · NYSE closed" };
const m = FACTS.mandate.value;

function reading(over: Partial<TokenReading> = {}): TokenReading {
  return {
    symbol: "NVDAc",
    paused: false,
    uiMultiplier: 1_000_537_939_576_369_481n,
    effectiveAt: 0n,
    feed: { answer: 13_600_000_000n, updatedAt: BigInt(FRI - 102) },
    twap8: 13_600_000_000n + 34_000_000n, // exactly 25 bps over
    ...over,
  };
}

describe("what an agent under the default mandate would do", () => {
  it("passes the market checks in session with a fresh feed and a small premium", () => {
    const v = judgeToken(reading(), { timestamp: FRI, session: open });
    expect(v.mandate).toBe("OK");
    expect(v.market).toBe("OK");
    expect(v.feedAgeSec).toBe(102);
    expect(v.premiumBps).toBe(25n);
    expect(v.checks.map((c) => c.mark)).toEqual(["PASS", "PASS", "NOT_RUN", "PASS", "PASS", "PASS", "PASS", "NOT_RUN", "NOT_RUN"]);
  });

  it("refuses MARKET_CLOSED on a weekend before reading the feed", () => {
    const v = judgeToken(reading({ feed: { answer: 1n, updatedAt: BigInt(SAT - 50 * 3600) } }), { timestamp: SAT, session: closed });
    expect(v.mandate).toBe("MARKET_CLOSED");
    expect(v.checks[4]?.mark).toBe("SKIP");
  });

  it("refuses a token outside the basket first, and still says what the market says", () => {
    const v = judgeToken(reading({ symbol: "ANTc" }), { timestamp: FRI, session: open });
    expect(v.inBasket).toBe(false);
    expect(v.mandate).toBe("TOKEN_NOT_ALLOWED");
    expect(v.market).toBe("OK");
  });

  it("refuses a paused token, and a pause flag it could not read", () => {
    expect(judgeToken(reading({ paused: true }), { timestamp: FRI, session: open }).mandate).toBe("TOKEN_PAUSED");
    expect(judgeToken(reading({ paused: null }), { timestamp: FRI, session: open }).mandate).toBe("TOKEN_PAUSED");
  });

  it("refuses FEED_STALE past maxStalenessSec, and passes at exactly the limit", () => {
    const at = (age: number) => judgeToken(reading({ feed: { answer: 1n, updatedAt: BigInt(FRI - age) }, twap8: 1n }), { timestamp: FRI, session: open });
    expect(at(m.maxStalenessSec).market).toBe("OK");
    expect(at(m.maxStalenessSec + 1).market).toBe("FEED_STALE");
  });

  it("future updatedAt is BAD_PRICE, and so are zero, negative and missing answers", () => {
    for (const feed of [{ answer: 1n, updatedAt: BigInt(FRI + 1) }, { answer: 0n, updatedAt: BigInt(FRI) }, { answer: -5n, updatedAt: BigInt(FRI) }, { answer: 1n, updatedAt: 0n }, null]) {
      const v = judgeToken(reading({ feed }), { timestamp: FRI, session: open });
      expect(v.market).toBe("BAD_PRICE");
      expect(v.feedAgeSec).toBeNull();
    }
  });

  it("refuses MULTIPLIER_COOLDOWN within the cooldown after effectiveAt, and for a scheduled change", () => {
    const eff = BigInt(FRI - 11 * 3600);
    expect(judgeToken(reading({ effectiveAt: eff }), { timestamp: FRI, session: open }).market).toBe("MULTIPLIER_COOLDOWN");
    expect(judgeToken(reading({ effectiveAt: BigInt(FRI + 60) }), { timestamp: FRI, session: open }).market).toBe("MULTIPLIER_COOLDOWN");
    expect(judgeToken(reading({ effectiveAt: BigInt(FRI - m.multiplierCooldownSec) }), { timestamp: FRI, session: open }).market).toBe("OK");
    expect(judgeToken(reading({ uiMultiplier: null }), { timestamp: FRI, session: open }).market).toBe("MULTIPLIER_COOLDOWN");
  });

  it("refuses PREMIUM_TOO_HIGH above maxPremiumBps, and BAD_PRICE without a TWAP", () => {
    const a = 10_000_000_000n;
    const over = a + (a * BigInt(m.maxPremiumBps + 1)) / 10_000n;
    const v = judgeToken(reading({ feed: { answer: a, updatedAt: BigInt(FRI) }, twap8: over }), { timestamp: FRI, session: open });
    expect(v.market).toBe("PREMIUM_TOO_HIGH");
    expect(judgeToken(reading({ twap8: null }), { timestamp: FRI, session: open }).market).toBe("BAD_PRICE");
  });

  it("reads its limits from FACTS.mandate", () => {
    expect(DEFAULT_LIMITS).toEqual({ maxStalenessSec: m.maxStalenessSec, maxPremiumBps: m.maxPremiumBps, multiplierCooldownSec: m.multiplierCooldownSec });
  });
});

describe("rows after a failure and outside the basket", () => {
  it("marks exactly the rows after a failed session check", () => {
    const v = judgeToken(reading({ feed: { answer: 1n, updatedAt: BigInt(SAT - 50 * 3600) } }), { timestamp: SAT, session: closed });
    expect(v.checks.map((c) => c.mark)).toEqual(["PASS", "PASS", "NOT_RUN", "FAIL", "SKIP", "SKIP", "SKIP", "NOT_RUN", "NOT_RUN"]);
    expect(v.checks.slice(4, 7).map((c) => c.detail)).toEqual(["not reached", "not reached", "not reached"]);
  });

  it("still fills the feed age and premium when an earlier check failed", () => {
    const answer = 13_600_000_000n;
    const updatedAt = SAT - 3600;
    const twap8 = answer + 34_000_000n;
    const v = judgeToken(reading({ feed: { answer, updatedAt: BigInt(updatedAt) }, twap8 }), { timestamp: SAT, session: closed });
    expect(v.mandate).toBe("MARKET_CLOSED");
    expect(v.feedAgeSec).toBe(SAT - updatedAt);
    expect(v.premiumBps).toBe(((twap8 - answer) * 10_000n) / answer);
  });

  it("shows ANTc failing row 1 and the market run in rows 2-7", () => {
    const v = judgeToken(reading({ symbol: "ANTc" }), { timestamp: FRI, session: open });
    const market = judgeToken(reading(), { timestamp: FRI, session: open });
    expect(v.checks[0]?.mark).toBe("FAIL");
    expect(v.checks.slice(1, 7).map((c) => c.mark)).toEqual(market.checks.slice(1, 7).map((c) => c.mark));
    expect(v.mandate).toBe("TOKEN_NOT_ALLOWED");
    expect(v.market).toBe("OK");
  });

  it("floors the hours, so a cooldown about to end does not read as its full length", () => {
    const v = judgeToken(reading({ effectiveAt: BigInt(FRI - m.multiplierCooldownSec + 1) }), { timestamp: FRI, session: open });
    const h = Math.floor(((m.multiplierCooldownSec - 1) * 10) / 3600) / 10;
    expect(v.market).toBe("MULTIPLIER_COOLDOWN");
    expect(v.checks[5]?.detail).toBe(`changed ${h} h ago, cooldown ${m.multiplierCooldownSec / 3600} h`);
  });
});

describe("the session at the block", () => {
  const address = "0x00000000000000000000000000000000000000ca";
  const THANKS = Date.UTC(2026, 10, 26, 15, 0) / 1000;
  const BEFORE = Date.UTC(2026, 10, 23, 13, 0) / 1000;
  const AFTER = Date.UTC(2026, 10, 23, 22, 0) / 1000;
  const EARLY = Date.UTC(2026, 10, 27, 19, 0) / 1000;

  it("words every kind of closed day", () => {
    const d = (timestamp: number) => sessionAt({ timestamp, calendar: { source: "repo" } }).detail;
    expect(d(THANKS)).toBe("Thanksgiving · NYSE closed");
    expect(d(BEFORE)).toBe("08:00 ET · opens 09:30");
    expect(d(AFTER)).toBe("17:00 ET · closed at 16:00");
    expect(d(EARLY)).toBe("14:00 ET · early close 13:00");
  });

  it("pins the four onchain cases", () => {
    const on = (timestamp: number, open: boolean | null) => sessionAt({ timestamp, calendar: { source: "onchain", address, open } });
    expect(on(FRI, null)).toEqual({ open: false, source: "onchain", detail: "MarketCalendar unreadable · counted closed" });
    expect(on(FRI, true)).toEqual({ open: true, source: "onchain", detail: "Friday · open until 16:00 ET" });
    expect(on(SAT, false)).toEqual({ open: false, source: "onchain", detail: "Saturday · NYSE closed" });
    expect(on(SAT, true)).toEqual({ open: true, source: "onchain", detail: "MarketCalendar: open" });
    expect(on(FRI, false)).toEqual({ open: false, source: "onchain", detail: "MarketCalendar: closed" });
  });

  it("uses the repo calendar until MarketCalendar is deployed", () => {
    expect(sessionAt({ timestamp: SAT, calendar: { source: "repo" } })).toEqual({ open: false, source: "repo", detail: "Saturday · NYSE closed" });
    expect(sessionAt({ timestamp: FRI, calendar: { source: "repo" } })).toMatchObject({ open: true, detail: "Friday · open until 16:00 ET" });
  });

  it("follows a deployed calendar, and counts a failed read as closed", () => {
    expect(sessionAt({ timestamp: FRI, calendar: { source: "onchain", address: "0x00000000000000000000000000000000000000ca", open: false } }).open).toBe(false);
    expect(sessionAt({ timestamp: FRI, calendar: { source: "onchain", address: "0x00000000000000000000000000000000000000ca", open: null } }).open).toBe(false);
  });
});

describe("the headline", () => {
  const basket = (reasons: Record<string, "OK" | "MARKET_CLOSED" | "PREMIUM_TOO_HIGH">) =>
    FACTS.basket.value.map((symbol) => ({ symbol, inBasket: true, mandate: reasons[symbol] ?? "OK", market: reasons[symbol] ?? "OK", checks: [], feedAgeSec: null, premiumBps: null }));

  it("says REFUSE with the plain label when the basket shares one refusal", () => {
    const h = headline(basket({ NVDAc: "MARKET_CLOSED", GOOGLc: "MARKET_CLOSED", AAPLc: "MARKET_CLOSED" }));
    expect(h).toEqual({ kind: "refuse-all", reason: "MARKET_CLOSED" });
    expect(headlineText(h)).toBe("An agent under Maat's default mandate would REFUSE: Market closed (MARKET_CLOSED)");
  });

  it("names each refused token when the results differ", () => {
    const h = headline(basket({ AAPLc: "PREMIUM_TOO_HIGH" }));
    expect(headlineText(h)).toBe("An agent under Maat's default mandate would REFUSE AAPLc: Pool price too far from oracle (PREMIUM_TOO_HIGH). Market checks pass for NVDAc and GOOGLc.");
  });

  it("never says safe when nothing is refused", () => {
    const text = headlineText(headline(basket({})));
    expect(text).toBe("An agent under Maat's default mandate would pass the market checks for NVDAc, GOOGLc and AAPLc; vault checks not run.");
    expect(text.toLowerCase()).not.toContain("safe");
  });

  it("joins several refusals with a semicolon and names who passes", () => {
    const h = headline(basket({ AAPLc: "PREMIUM_TOO_HIGH", GOOGLc: "FEED_STALE" } as never));
    expect(headlineText(h)).toBe(
      "An agent under Maat's default mandate would REFUSE GOOGLc: Price feed out of date (FEED_STALE); AAPLc: Pool price too far from oracle (PREMIUM_TOO_HIGH). Market checks pass for NVDAc.",
    );
  });

  it("drops the passing sentence when all three are refused for different reasons", () => {
    const h = headline(basket({ NVDAc: "MARKET_CLOSED", GOOGLc: "FEED_STALE", AAPLc: "PREMIUM_TOO_HIGH" } as never));
    expect(h.kind).toBe("mixed");
    expect(headlineText(h)).not.toContain("Market checks pass");
  });

  it("ignores tokens outside the basket", () => {
    const all = [...basket({}), { symbol: "ANTc", inBasket: false, mandate: "TOKEN_NOT_ALLOWED" as const, market: "PREMIUM_TOO_HIGH" as const, checks: [], feedAgeSec: null, premiumBps: null }];
    expect(headline(all).kind).toBe("pass-all");
  });
});
