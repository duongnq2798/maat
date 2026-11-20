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

describe("the session at the block", () => {
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
    expect(text).toBe("An agent under Maat's default mandate would pass the market checks for NVDAc, GOOGLc and AAPLc. The vault's own checks are not run here.");
    expect(text.toLowerCase()).not.toContain("safe");
  });

  it("ignores tokens outside the basket", () => {
    const all = [...basket({}), { symbol: "ANTc", inBasket: false, mandate: "TOKEN_NOT_ALLOWED" as const, market: "PREMIUM_TOO_HIGH" as const, checks: [], feedAgeSec: null, premiumBps: null }];
    expect(headline(all).kind).toBe("pass-all");
  });
});
