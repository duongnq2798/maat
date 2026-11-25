import { getAddress, type Address } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf, BASKET, USDC } from "../src/addresses.js";
import { readVaultState, type CalendarDay, type VaultState } from "../src/chain/state.js";
import { loadConfig } from "../src/config.js";
import { PROBE_TEXT_PREFIX } from "../src/rationale/blob.js";
import {
  MAX_PROBES_PER_DAY,
  parseProbes,
  planProbes,
  probeCandidates,
  probeDeadline,
  probeIso,
  probeText,
} from "../src/probes.js";
import { CALENDAR_MATH, FEEDS, MANDATE, POOL, VAULT, standardScene, type FakeChain } from "./fakes/fakeChain.js";

const ms = (iso: string) => Date.parse(iso);
const s = (iso: string) => BigInt(ms(iso) / 1000);

/** The calendar's day at `iso`, as MarketCalendar reports it. */
function calendarAt(iso: string): CalendarDay {
  const [etDay, weekday, minuteOfDay] = CALENDAR_MATH.localTime(ms(iso) / 1000);
  return { etDay: BigInt(etDay), weekday, minuteOfDay, holiday: CALENDAR_MATH.holidays.has(etDay), earlyCloseMin: CALENDAR_MATH.earlyCloseMin.get(etDay) ?? 0 };
}

describe("MAAT_PROBES", () => {
  it("is read as one raw string, so no value can stop the agent from starting", () => {
    const base = {
      BASE_RPC_URL: "https://mainnet.base.org",
      MAAT_VAULT: "0x1111111111111111111111111111111111111111",
      MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
      MAAT_EXPENSE_PAYEE: "0x3333333333333333333333333333333333333333",
    };
    expect(loadConfig(base).probes).toBeUndefined();
    expect(loadConfig({ ...base, MAAT_PROBES: "" }).probes).toBeUndefined();
    for (const raw of ["2026-11-27T17:58:00Z", "tomorrow, 2026-13-01T00:00:00Z,,", "2026-11-27 17:58"]) {
      expect(loadConfig({ ...base, MAAT_PROBES: raw }).probes).toBe(raw);
    }
  });

  it("takes comma-separated UTC instants, in any order, and runs them in time order", () => {
    const r = parseProbes(" 2026-11-27T18:01:00Z, 2026-11-26T14:31:00Z,2026-11-27T17:58Z ");
    expect(r.problems).toEqual([]);
    expect(r.at.map(probeIso)).toEqual(["2026-11-26T14:31:00Z", "2026-11-27T17:58:00Z", "2026-11-27T18:01:00Z"]);
  });

  it("has nothing to run when unset or blank", () => {
    expect(parseProbes(undefined)).toEqual({ at: [], problems: [] });
    expect(parseProbes(" , ")).toEqual({ at: [], problems: [] });
  });

  it("leaves out an entry that is not an ISO-8601 UTC instant, and says so", () => {
    const r = parseProbes("2026-11-27 17:58,2026-11-27T17:58:00+00:00,2026-11-27T17:58:00.000Z,2026-02-30T10:00:00Z,2026-11-27T24:00:00Z,soon,2026-11-27T18:01:00Z");
    expect(r.at.map(probeIso)).toEqual(["2026-11-27T18:01:00Z"]);
    expect(r.problems).toEqual(
      ['"2026-11-27 17:58"', '"2026-11-27T17:58:00+00:00"', '"2026-11-27T17:58:00.000Z"', '"2026-02-30T10:00:00Z"', '"2026-11-27T24:00:00Z"', '"soon"'].map(
        (v) => `${v} is not an ISO-8601 UTC instant such as 2026-11-27T17:58:00Z; left out`,
      ),
    );
  });

  it("runs a duplicated instant once and says so", () => {
    const r = parseProbes("2026-11-27T17:58:00Z,2026-11-27T17:58Z");
    expect(r.at.map(probeIso)).toEqual(["2026-11-27T17:58:00Z"]);
    expect(r.problems).toEqual(["2026-11-27T17:58:00Z is listed more than once; it runs once"]);
  });

  it(`keeps at most ${MAX_PROBES_PER_DAY} instants on one UTC day, the earliest, and says which it left out`, () => {
    const r = parseProbes("2026-11-27T20:00:00Z,2026-11-27T17:58:00Z,2026-11-27T18:01:00Z,2026-11-27T14:31:00Z,2026-11-28T00:00:00Z");
    expect(r.at.map(probeIso)).toEqual(["2026-11-27T14:31:00Z", "2026-11-27T17:58:00Z", "2026-11-27T18:01:00Z", "2026-11-28T00:00:00Z"]);
    expect(r.problems).toEqual(["2026-11-27T20:00:00Z is probe 4 on UTC day 2026-11-27; at most 3 run a day, so it is left out"]);
  });
});

describe("planProbes", () => {
  const at = ["2026-11-26T14:31:00Z", "2026-11-27T17:58:00Z", "2026-11-27T18:01:00Z"].map(ms);

  it("schedules what is still to come, calls missed what passed before the start, and never reruns a probe", () => {
    const recorded: Record<string, string> = { "2026-11-26T14:31:00Z": "sent" };
    const plan = planProbes(at, ms("2026-11-27T18:00:00Z"), (iso) => recorded[iso]);
    expect(plan.earlier).toEqual([{ at: at[0], outcome: "sent" }]);
    expect(plan.missed).toEqual([at[1]]);
    expect(plan.due).toEqual([at[2]]);
  });

  it("calls missed an instant that passed before the start even by a second", () => {
    expect(planProbes([at[1]!], at[1]! + 1, () => undefined)).toEqual({ due: [], missed: [at[1]], earlier: [] });
    expect(planProbes([at[1]!], at[1]!, () => undefined)).toEqual({ due: [at[1]], missed: [], earlier: [] });
  });
});

describe("probeDeadline", () => {
  it("is 17:59:30 UTC on Friday 27 November, 30 s before the 13:00 ET early close", () => {
    const d = probeDeadline(s("2026-11-27T17:58:00Z"), calendarAt("2026-11-27T17:58:00Z"), 0);
    expect(new Date(Number(d.by) * 1000).toISOString()).toBe("2026-11-27T17:59:30.000Z");
    expect(d.close).toBe("the 13:00 ET early close");
  });

  it("is 30 s before 16:00 ET on a full day, in both EST and EDT", () => {
    const wed = probeDeadline(s("2026-11-25T15:07:42Z"), calendarAt("2026-11-25T15:07:42Z"), 0);
    expect(new Date(Number(wed.by) * 1000).toISOString()).toBe("2026-11-25T20:59:30.000Z");
    expect(wed.close).toBe("the 16:00 ET close");
    const summer = probeDeadline(s("2027-06-15T14:00:00Z"), calendarAt("2027-06-15T14:00:00Z"), 0);
    expect(new Date(Number(summer.by) * 1000).toISOString()).toBe("2027-06-15T19:59:30.000Z");
  });

  it("under FEED_24_5 is 30 s before 20:00 ET on a Friday and before midnight ET on another day", () => {
    const fri = probeDeadline(s("2026-11-27T22:00:00Z"), calendarAt("2026-11-27T22:00:00Z"), 1);
    expect(new Date(Number(fri.by) * 1000).toISOString()).toBe("2026-11-28T00:59:30.000Z");
    expect(fri.close).toBe("20:00 ET");
    const tue = probeDeadline(s("2026-12-01T12:00:00Z"), calendarAt("2026-12-01T12:00:00Z"), 1);
    expect(new Date(Number(tue.by) * 1000).toISOString()).toBe("2026-12-02T04:59:30.000Z");
    expect(tue.close).toBe("midnight ET");
  });
});

describe("probeText", () => {
  it("starts as the spec requires and says what the probe expects (the 17:58 text is spec vector V4's)", () => {
    expect(probeText("OK", "the 13:00 ET early close")).toBe("PROBE v1, not a Claude proposal. Expected OK before the 13:00 ET early close.");
    expect(probeText("MARKET_CLOSED")).toBe("PROBE v1, not a Claude proposal. Expected MARKET_CLOSED.");
    for (const t of [probeText("OK", "the 16:00 ET close"), probeText("MARKET_CLOSED")]) expect(t.startsWith(PROBE_TEXT_PREFIX)).toBe(true);
  });
});

describe("probeCandidates", () => {
  const state = (f: FakeChain) => readVaultState(f.client(), VAULT);
  const text = probeText("OK", "the 16:00 ET close");
  const ok = (st: VaultState) => probeCandidates(st, "OK", text);
  const closedText = probeText("MARKET_CLOSED");
  const closed = (st: VaultState) => probeCandidates(st, "MARKET_CLOSED", closedText).map((p) => [p.action, p.symbol, p.amountUsd]);
  /** Every token listed with its own feed and the given allowed flag and maxWeightBps. */
  const configs = (allowed: (sym: string) => boolean, maxWeightBps = 4000) => (args: readonly unknown[]) => {
    const i = BASKET.findIndex((t) => getAddress(t.address) === getAddress(args[0] as Address));
    return [allowed(BASKET[i]!.symbol), FEEDS[i], POOL, maxWeightBps];
  };

  it("buys $1 of the least held token, in tokens() order on a tie, with nothing to sell in an all-USDC vault", async () => {
    expect(ok(await state(standardScene()))).toEqual([{ action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: text }]);
  });

  it("buys the most underweight token that $1 more keeps within its maxWeightBps, then sells $1 of the largest holding", async () => {
    // NVDAc 0.25 tokens ($46.67), AAPLc 0.01 tokens ($2.70), no GOOGLc, $100 USDC.
    const f = standardScene().set(addressOf("NVDAc"), "balanceOf", 25_000_000n).set(addressOf("AAPLc"), "balanceOf", 1_000_000n);
    expect(ok(await state(f)).map((p) => [p.action, p.symbol, p.amountUsd])).toEqual([
      ["BUY", "GOOGLc", 1],
      ["SELL", "NVDAc", 1],
    ]);
    // GOOGLc not allowed to buy: the next least held, AAPLc, is the buy.
    f.set(VAULT, "tokenConfig", configs((sym) => sym !== "GOOGLc"));
    expect(ok(await state(f))[0]).toMatchObject({ action: "BUY", symbol: "AAPLc" });
  });

  it("does not buy a token that $1 more would push over its maxWeightBps", async () => {
    const f = standardScene().set(VAULT, "tokenConfig", configs(() => true, 1));
    expect(ok(await state(f))).toEqual([]);
    f.set(addressOf("AAPLc"), "balanceOf", 1_000_000n);
    expect(ok(await state(f)).map((p) => [p.action, p.symbol])).toEqual([["SELL", "AAPLc"]]);
  });

  it("has no candidate when $1 does not fit the per-trade cap or what is left of the daily cap", async () => {
    expect(ok(await state(standardScene().set(VAULT, "mandate", { ...MANDATE, perTradeCapUsd: 999_999n })))).toEqual([]);
    expect(ok(await state(standardScene().set(VAULT, "spentOnDay", 99_000_001n)))).toEqual([]);
    expect(ok(await state(standardScene().set(VAULT, "spentOnDay", 99_000_000n)))).toHaveLength(1);
  });

  it("does not buy with less than $1 of USDC", async () => {
    expect(ok(await state(standardScene().set(USDC, "balanceOf", 999_999n)))).toEqual([]);
  });

  describe("for a probe that expects MARKET_CLOSED, which the vault answers before its balance, cap and weight checks", () => {
    it("ignores the per-trade cap, the daily cap's headroom and maxWeightBps", async () => {
      const want = [["BUY", "NVDAc", 1]];
      expect(closed(await state(standardScene().set(VAULT, "mandate", { ...MANDATE, perTradeCapUsd: 999_999n })))).toEqual(want);
      expect(closed(await state(standardScene().set(VAULT, "spentOnDay", 99_500_000n)))).toEqual(want);
      expect(closed(await state(standardScene().set(VAULT, "tokenConfig", configs(() => true, 1))))).toEqual(want);
    });

    it("buys with any USDC at all, and only a token the vault lets it buy", async () => {
      expect(closed(await state(standardScene().set(USDC, "balanceOf", 1n)))).toEqual([["BUY", "NVDAc", 1]]);
      expect(closed(await state(standardScene().set(USDC, "balanceOf", 0n)))).toEqual([]);
      // The vault answers TOKEN_NOT_ALLOWED before MARKET_CLOSED for a BUY of a token that is not allowed.
      expect(closed(await state(standardScene().set(VAULT, "tokenConfig", configs((sym) => sym === "AAPLc"))))).toEqual([["BUY", "AAPLc", 1]]);
    });

    it("sells $1 of the largest priced holding after the BUY", async () => {
      const f = standardScene().set(USDC, "balanceOf", 0n).set(addressOf("GOOGLc"), "balanceOf", 1_000_000n);
      expect(closed(await state(f))).toEqual([["SELL", "GOOGLc", 1]]);
    });
  });
});
