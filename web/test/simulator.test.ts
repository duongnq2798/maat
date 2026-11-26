import { zeroAddress, zeroHash } from "viem";
import { describe, expect, it, vi } from "vitest";
import { isoOfDay, parseIsoDay, WINDOW } from "@/content/calendar";
import { getDecisions } from "@/content/decisions";
import { CHECK_LABELS, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { minuteOfClock } from "@/content/format";
import { PREVIEW_ID, previewIntentArgs, previewTokens } from "@/lib/chain/preview";
import {
  AMOUNT_CHIPS_USD,
  OTHER_TOKEN_STAND_IN,
  vaultComparison,
  vaultRequest,
  vaultRequestLabel,
  amountPending,
  amountText,
  DEFAULT_SCENARIO,
  daySummary,
  dayNote,
  decodeScenario,
  encodeScenario,
  evaluate,
  execute,
  FEED_AGE_TOKEN,
  formatUsd,
  MAX_TAPE,
  momentLabel,
  PRESETS,
  parseUsd,
  postText,
  postUrl,
  replay,
  type SimIntent,
  type SimResult,
  type SimToken,
  simIntentLabel,
} from "@/content/simulator";

const THU = "2026-11-05";
const day = (iso: string): number => {
  const d = parseIsoDay(iso);
  if (d === undefined) throw new Error(`bad test date ${iso}`);
  return d;
};
const buy = (token: SimToken, usd: number, at = "10:30"): SimIntent => ({
  token,
  usd6: Math.round(usd * 100) * 10_000,
  minute: minuteOfClock(at),
});
const on = (iso: string, before: SimIntent[] = []) => replay(day(iso), before);
const marks = (r: SimResult) => r.checks.map((c) => c.mark);
const failAt = (r: SimResult) => r.checks.findIndex((c) => c.mark === "FAIL");

describe("simulator: one BUY against the default mandate", () => {
  it("allows the fork's BUY at the fork moment, all nine checks passing", () => {
    const r = evaluate(on(THU), buy("NVDAc", 20));
    expect([r.allowed, r.reason, r.balance]).toEqual([true, "OK", undefined]);
    expect(r.checks.map((c) => c.label)).toEqual([...CHECK_LABELS]);
    expect(r.checks.map((c) => [c.mark, c.detail])).toEqual([
      ["PASS", "NVDAc in mandate"],
      ["PASS", "transfers active"],
      ["PASS", "authorized"],
      ["PASS", "Thursday · open until 16:00"],
      ["PASS", "14s ≤ 90000s"],
      ["PASS", "no change 24h"],
      ["PASS", "53 ≤ 100 bps"],
      ["PASS", "$20 ≤ $50 · $20 of $100 today"],
      ["PASS", "NVDAc 10% ≤ 40%"],
    ]);
    expect(r.checks.map((c) => c.fixed)).toEqual([false, true, true, false, true, true, true, false, false]);
  });

  it("refuses a token outside the mandate at check 1", () => {
    const r = evaluate(on(THU), buy("OTHER", 20));
    expect([r.allowed, r.reason]).toEqual([false, "TOKEN_NOT_ALLOWED"]);
    expect(marks(r)).toEqual(["FAIL", ...Array(8).fill("SKIP")]);
    expect(r.checks[0]?.detail).toBe("not in the mandate");
    expect(r.checks.slice(1).every((c) => c.detail === "not reached")).toBe(true);
  });

  it.each([
    ["Saturday", "2026-11-07", "10:30", "Saturday · NYSE closed"],
    ["Sunday", "2026-11-08", "10:30", "Sunday · NYSE closed"],
    ["Thanksgiving", "2026-11-26", "10:30", "Thanksgiving · NYSE closed"],
    ["Christmas", "2026-12-25", "10:30", "Christmas · NYSE closed"],
    ["before the open", THU, "09:29", "09:29 · opens 09:30"],
    ["at the close", THU, "16:00", "16:00 · closed at 16:00"],
    ["Friday evening", "2026-11-06", "19:00", "19:00 · closed at 16:00"],
    ["at an early close", "2026-11-27", "13:00", "13:00 · early close 13:00"],
  ])("refuses at check 4 when the market is closed: %s", (_name, iso, at, detail) => {
    const r = evaluate(on(iso), buy("NVDAc", 20, at));
    expect([r.allowed, r.reason, failAt(r)]).toEqual([false, "MARKET_CLOSED", 3]);
    expect(r.checks[3]?.detail).toBe(detail);
    expect(marks(r).slice(4)).toEqual(Array(5).fill("SKIP"));
  });

  it.each([
    [THU, "09:30", "Thursday · open until 16:00"],
    [THU, "15:59", "Thursday · open until 16:00"],
    ["2026-11-27", "12:59", "Friday · open until 13:00"],
  ])("is open on %s at %s", (iso, at, detail) => {
    const r = evaluate(on(iso), buy("GOOGLc", 10, at));
    expect(r.reason).toBe("OK");
    expect(r.checks[3]?.detail).toBe(detail);
  });

  it("shows each token's measured premium", () => {
    expect(evaluate(on(THU), buy("GOOGLc", 10)).checks[6]?.detail).toBe("49 ≤ 100 bps");
    expect(evaluate(on(THU), buy("AAPLc", 10)).checks[6]?.detail).toBe("29 ≤ 100 bps");
  });

  it("shows the feed age only for the feed it was measured on", () => {
    expect(evaluate(on(THU), buy("NVDAc", 10)).checks[4]?.detail).toBe("14s ≤ 90000s");
    for (const token of ["GOOGLc", "AAPLc"] as const) {
      const check = evaluate(on(THU), buy(token, 10)).checks[4];
      expect([check?.detail, check?.mark, check?.fixed]).toEqual(["assumed fresh · max 90000s", "PASS", true]);
    }
  });

  it("names the measured token in the fact that holds the feed age", () => {
    expect(FACTS.feedAgeSec.source).toContain(FEED_AGE_TOKEN);
  });

  it.each([
    ["a zero amount", 0, "amount is zero"],
    ["more than the vault holds", 250, "$250 > $200 USDC"],
  ])("checks the balance between checks 7 and 8: %s", (_name, usd, balance) => {
    const r = evaluate(on(THU), buy("NVDAc", usd));
    expect([r.allowed, r.reason, r.balance]).toEqual([false, "INSUFFICIENT_BALANCE", balance]);
    expect(marks(r)).toEqual([...Array(7).fill("PASS"), "SKIP", "SKIP"]);
  });

  it("refuses past the per-trade cap at check 8, to the cent", () => {
    const r = evaluate(on(THU), buy("NVDAc", 51));
    expect([r.reason, failAt(r), r.checks[7]?.detail]).toEqual(["SIZE_LIMIT", 7, "$51 > $50 per trade"]);
    expect(evaluate(on(THU), buy("NVDAc", 50.01)).reason).toBe("SIZE_LIMIT");
    expect(evaluate(on(THU), buy("NVDAc", 50)).reason).toBe("OK");
  });
});

describe("simulator: one day of trades", () => {
  it("refuses past the daily cap once allowed buys add up", () => {
    const r = evaluate(on(THU, [buy("NVDAc", 50), buy("GOOGLc", 50)]), buy("AAPLc", 1));
    expect([r.reason, failAt(r), r.checks[7]?.detail]).toEqual(["SIZE_LIMIT", 7, "$101 > $100 today"]);
  });

  it("refuses a buy that would push one stock past 40%", () => {
    const r = evaluate(on(THU, [buy("NVDAc", 50)]), buy("NVDAc", 50));
    expect([r.reason, failAt(r)]).toEqual(["CONCENTRATION", 8]);
    expect(r.checks[7]?.detail).toBe("$50 ≤ $50 · $100 of $100 today");
    expect(r.checks[8]?.detail).toBe("NVDAc 50% > 40%");
  });

  it("allows a weight of exactly 40%", () => {
    const r = evaluate(on(THU, [buy("NVDAc", 50)]), buy("NVDAc", 30));
    expect([r.reason, r.checks[8]?.detail]).toEqual(["OK", "NVDAc 40% ≤ 40%"]);
  });

  it("logs refusals without moving money", () => {
    const d = on(THU, [buy("OTHER", 50), buy("NVDAc", 51), buy("NVDAc", 20, "17:00")]);
    expect(d.tape.map((e) => e.reason)).toEqual(["TOKEN_NOT_ALLOWED", "SIZE_LIMIT", "MARKET_CLOSED"]);
    expect(daySummary(d).spent6).toBe(0);
    expect(evaluate(d, buy("NVDAc", 50)).checks[7]?.detail).toBe("$50 ≤ $50 · $50 of $100 today");
  });

  it("recomputes every verdict when it rebuilds a day", () => {
    const d = on(THU, [buy("NVDAc", 50), buy("NVDAc", 50), buy("GOOGLc", 50)]);
    expect(d.tape.map((e) => [e.allowed, e.reason])).toEqual([
      [true, "OK"],
      [false, "CONCENTRATION"],
      [true, "OK"],
    ]);
    expect(daySummary(d)).toEqual({ spent6: 100_000_000, weightBps: { NVDAc: 2500, GOOGLc: 2500, AAPLc: 0 } });
  });

  it(`keeps at most ${MAX_TAPE} entries`, () => {
    const full = on(THU, Array.from({ length: MAX_TAPE }, () => buy("OTHER", 1)));
    expect(full.tape).toHaveLength(MAX_TAPE);
    expect(execute(full, buy("NVDAc", 1))).toBe(full);
  });
});

describe("simulator: parity with the Decision engine replay", () => {
  const fork = day(FACTS.forkDay.value);
  const minute = minuteOfClock(FACTS.forkTimeEt.value);
  const forkBuy = (allowed: boolean): SimIntent => {
    const r = getDecisions().find((d) => d.source === "base-fork" && d.action === "BUY" && d.allowed === allowed);
    if (!r) throw new Error(`the fork ledger has no ${allowed ? "allowed" : "refused"} BUY`);
    return { token: r.symbol as SimToken, usd6: r.amountUsd * 1_000_000, minute };
  };

  it("gives the Thursday moment for the fork's allowed BUY", () => {
    const r = evaluate(replay(fork, []), forkBuy(true));
    expect([marks(r), r.reason]).toEqual([MOMENTS.thu.checks.map((c) => c.mark), MOMENTS.thu.reason]);
  });

  it("gives the Saturday moment for the refused BUY two days later", () => {
    const r = evaluate(replay(fork + FACTS.weekendOffsetDays.value, []), forkBuy(false));
    expect([marks(r), r.reason]).toEqual([MOMENTS.sat.checks.map((c) => c.mark), MOMENTS.sat.reason]);
    expect(r.checks[3]?.detail).toBe(MOMENTS.sat.checks[3]?.detail);
  });

  it("opens on the Thursday moment", () => {
    expect(DEFAULT_SCENARIO).toEqual({ etDay: fork, intent: forkBuy(true), tape: [] });
  });
});

describe("simulator: presets and copy", () => {
  it("offers the moments of the brief, all inside the window", () => {
    expect(PRESETS.map((p) => [p.label, isoOfDay(p.etDay), p.minute])).toEqual([
      ["Thu 5 Nov · 10:30", "2026-11-05", 630],
      ["Sat 7 Nov", "2026-11-07", 630],
      ["Fri 6 Nov · 19:00", "2026-11-06", 1140],
      ["Thanksgiving", "2026-11-26", 630],
      ["Fri 27 Nov · 13:30", "2026-11-27", 810],
    ]);
    for (const p of PRESETS) expect(p.etDay >= WINDOW.first && p.etDay <= WINDOW.last, p.id).toBe(true);
  });

  it("offers amounts on either side of the caps", () => {
    expect(AMOUNT_CHIPS_USD).toEqual([10, 20, 50, 51, 100]);
  });

  it("labels an intent, a moment and a day", () => {
    expect(simIntentLabel(buy("OTHER", 12.5))).toBe("BUY Other token · $12.50");
    expect(momentLabel(day(THU), 630)).toBe("Thu 5 Nov · 10:30 ET");
    expect(dayNote(day(THU))).toBe("Thursday");
    expect(dayNote(day("2026-11-07"))).toBe("Saturday · closed all day");
    expect(dayNote(day("2026-11-26"))).toBe("Thursday · Thanksgiving, closed all day");
    expect(dayNote(day("2026-11-27"))).toBe("Friday · closes 13:00");
  });

  it("reads amounts the way people type them", () => {
    expect(["50", "$1,000", " 20 ", "12.5", "50.", "0", "999999999.99"].map((t) => parseUsd(t))).toEqual([
      50e6, 1000e6, 20e6, 12.5e6, 50e6, 0, 999_999_999.99e6,
    ]);
    for (const bad of ["", "abc", "-5", "1e5", "0.001", "1234567890", ".5"]) expect(parseUsd(bad), bad).toBeUndefined();
  });

  it("reads thousands commas, a leading dollar sign and a decimal comma, and nothing looser", () => {
    const good = ["12,50", "12,5", "1,00", "1,000.50", "12,345,678.5", "$ 20", " $20 ", "$1,000", "1,000", "12,505"];
    expect(good.map((t) => parseUsd(t))).toEqual([12.5e6, 12.5e6, 1e6, 1000.5e6, 12_345_678.5e6, 20e6, 20e6, 1000e6, 1000e6, 12_505e6]);
    for (const bad of ["5 0", "1,0,0", "20$", "1,00,000", "$$20", "12,50.5", "1,", "1,000,", "1,234,567,890", "$"]) {
      expect(parseUsd(bad), bad).toBeUndefined();
    }
  });

  it("holds an amount typed up to a comma as pending, not wrong, while a keystroke can still finish it", () => {
    for (const half of ["1,", "$1,", " 12, ", "123456789,", "1,000,", "1,000,0", "1,000,00", "999,999,"]) {
      expect(amountPending(half), half).toBe(true);
    }
    for (const not of ["1", "1,0", "1,000", "", "$", "x", "1,0,", "1,00,", "1,,", ",", "1234567890,", "999,999,999,", "1,000.5,"]) {
      expect(amountPending(not), not).toBe(false);
    }
  });

  it("formats dollars like the rest of the page", () => {
    expect([formatUsd(50e6), formatUsd(12.5e6), formatUsd(1000e6), formatUsd(0)]).toEqual(["$50", "$12.50", "$1,000", "$0"]);
    expect([amountText(50e6), amountText(12.5e6)]).toEqual(["50", "12.50"]);
  });

  it("writes the post for a refusal and for a yes", () => {
    const sat = { ...DEFAULT_SCENARIO, etDay: day("2026-11-07"), intent: buy("NVDAc", 50) };
    expect(postText(sat, evaluate(replay(sat.etDay, []), sat.intent))).toBe(
      "I tried to buy $50 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: Market closed (MARKET_CLOSED).",
    );
    expect(postText(DEFAULT_SCENARIO, { allowed: true, reason: "OK" })).toBe(
      "I asked Maat's simulator to buy $20 of NVDAc on Thu 5 Nov at 10:30 ET. All nine checks passed. Can you make it say no?",
    );
    expect(postText({ ...DEFAULT_SCENARIO, intent: buy("OTHER", 5) }, { allowed: false, reason: "TOKEN_NOT_ALLOWED" })).toBe(
      "I tried to buy $5 of a token outside the mandate on Thu 5 Nov at 10:30 ET. Maat's simulator said no: Token not allowed (TOKEN_NOT_ALLOWED).",
    );
  });

  it("links to X's post intent, adding the share link once it is absolute", () => {
    expect(postUrl("a b", "https://maat.example/?day=2026-11-07#try")).toBe(
      "https://x.com/intent/post?text=a%20b&url=https%3A%2F%2Fmaat.example%2F%3Fday%3D2026-11-07%23try",
    );
    expect(postUrl("a b", "?day=2026-11-07#try")).toBe("https://x.com/intent/post?text=a%20b");
  });
});

describe("simulator: the mandate it models", () => {
  it("refuses to load for a mandate that is not REGULAR", async () => {
    vi.resetModules();
    vi.doMock("@/content/facts", async (importOriginal) => {
      const real = await importOriginal<typeof import("@/content/facts")>();
      const mandate = { ...real.FACTS.mandate, value: { ...real.FACTS.mandate.value, sessionMode: "FEED_24_5" as const } };
      return { ...real, FACTS: { ...real.FACTS, mandate } };
    });
    try {
      await expect(import("@/content/simulator")).rejects.toThrow(
        "the simulator models REGULAR sessions only; FACTS.mandate.sessionMode is FEED_24_5",
      );
    } finally {
      vi.doUnmock("@/content/facts");
      vi.resetModules();
    }
  });
});

describe("simulator: share links", () => {
  it("writes the default scenario", () => {
    expect(encodeScenario(DEFAULT_SCENARIO)).toBe("?day=2026-11-05&at=1030&buy=NVDAc-20");
  });

  it("round-trips a day with a tape", () => {
    const s = {
      etDay: day("2026-11-27"),
      intent: buy("OTHER", 12.5, "13:30"),
      tape: [buy("NVDAc", 50, "09:30"), buy("AAPLc", 0.99, "12:59")],
    };
    expect(encodeScenario(s)).toBe("?day=2026-11-27&at=1330&buy=other-12.50&tape=0930-NVDAc-50,1259-AAPLc-0.99");
    expect(decodeScenario(encodeScenario(s))).toEqual(s);
  });

  it("falls back to the default, field by field", () => {
    expect(decodeScenario("")).toEqual(DEFAULT_SCENARIO);
    expect(decodeScenario("?day=2031-01-01&at=2400&buy=TSLA-5")).toEqual(DEFAULT_SCENARIO);
    expect(decodeScenario("?day=2026-11-04")).toEqual(DEFAULT_SCENARIO);
    expect(decodeScenario("?day=2026-11-07&buy=NVDAc-abc")).toEqual({ ...DEFAULT_SCENARIO, etDay: day("2026-11-07") });
    expect(decodeScenario("?tape=1030-NVDAc-50,junk,0960-NVDAc-5,1031-AAPLc-1").tape).toEqual([
      buy("NVDAc", 50),
      buy("AAPLc", 1, "10:31"),
    ]);
  });

  it(`keeps the first ${MAX_TAPE} entries of a long tape, and reads encoded commas`, () => {
    const tape = Array.from({ length: MAX_TAPE + 2 }, (_, i) => `1030-NVDAc-${i + 1}`).join(",");
    expect(decodeScenario(`?tape=${tape}`).tape).toHaveLength(MAX_TAPE);
    expect(decodeScenario("?tape=1030-NVDAc-50%2C1031-AAPLc-1").tape).toHaveLength(2);
  });
});

describe("simulator: asking the real vault", () => {
  const addressOf = (symbol: string) => {
    const t = previewTokens().find((p) => p.symbol === symbol);
    if (!t) throw new Error(`previewTokens() has no ${symbol}`);
    return t.address;
  };

  it("sends a basket BUY as previewIntent takes it: the token's address, the USDC in and no payee", () => {
    for (const t of FACTS.basket.value) {
      expect(vaultRequest(buy(t, 20)), t).toEqual({ action: "BUY", token: addressOf(t), amount: 20_000_000n });
      expect(previewIntentArgs(vaultRequest(buy(t, 12.5))), t).toEqual({
        id: PREVIEW_ID,
        action: 0,
        token: addressOf(t),
        amount: 12_500_000n,
        minOut: 0n,
        payee: zeroAddress,
        rationaleHash: zeroHash,
      });
    }
  });

  it("asks about USDC for the other token, which the vault has no BUY rule for", () => {
    expect(OTHER_TOKEN_STAND_IN).toBe("USDC");
    expect(vaultRequest(buy("OTHER", 20))).toEqual({ action: "BUY", token: addressOf("USDC"), amount: 20_000_000n });
    expect(vaultRequestLabel(buy("OTHER", 20))).toBe("BUY USDC · $20");
    expect(vaultRequestLabel(buy("NVDAc", 12.5))).toBe("BUY NVDAc · $12.50");
  });

  it("keeps every cent of the amount, zero included, and leaves the moment out", () => {
    expect(vaultRequest(buy("NVDAc", 999_999_999.99)).amount).toBe(999_999_999_990_000n);
    expect(vaultRequest(buy("NVDAc", 0)).amount).toBe(0n);
    // The vault answers at the head block, by its own clock: the simulated moment is not part of the call.
    expect(vaultRequest(buy("GOOGLc", 20, "19:00"))).toEqual(vaultRequest(buy("GOOGLc", 20, "10:30")));
  });

  it("says when the vault gives the simulation's answer", () => {
    const c = vaultComparison({ sim: "OK", vault: "OK", etDay: day(THU), minute: minuteOfClock("10:30"), blockNumber: 61_964_493n });
    expect(c.same).toBe(true);
    expect(c.text).toBe(
      "Same answer as the simulation. The vault gave it at block 61,964,493, from its live prices, calendar and holdings.",
    );
  });

  it("says plainly when they differ, and why they can", () => {
    const c = vaultComparison({
      sim: "OK",
      vault: "MARKET_CLOSED",
      etDay: day(THU),
      minute: minuteOfClock("10:30"),
      blockNumber: 61_964_493n,
    });
    expect(c.same).toBe(false);
    expect(c.text).toBe(
      `They differ. The simulation is a model: it answers for Thu 5 Nov · 10:30 ET, with the fork's values and a day that starts with $${FACTS.forkVaultUsd.value} USDC. The vault answered at block 61,964,493, at that block's time, from its live prices, calendar, holdings and mandate.`,
    );
  });
});
