import { describe, expect, it } from "vitest";
import { CHECK_LABELS, MOMENT_ORDER, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";

describe("engine moments (spec §3)", () => {
  it("has one check per spec check, Saturday first", () => {
    expect(CHECK_LABELS).toHaveLength(FACTS.checksPerTrade.value);
    expect(MOMENT_ORDER).toEqual(["sat", "thu"]);
  });

  it("Saturday stops at the market session check", () => {
    const s = MOMENTS.sat;
    expect([s.toggleLabel, s.intent, s.when]).toEqual(["Sat 7 Nov", "BUY GOOGLc · $10", "Sat 7 Nov · weekend"]);
    expect(s.checks.map((c) => c.mark)).toEqual(["PASS", "PASS", "PASS", "FAIL", "SKIP", "SKIP", "SKIP", "SKIP", "SKIP"]);
    expect(s.checks.map((c) => c.detail)).toEqual([
      "GOOGLc in mandate",
      "transfers active",
      "authorized",
      "Saturday · NYSE closed",
      "not reached",
      "not reached",
      "not reached",
      "not reached",
      "not reached",
    ]);
    expect(s.checks[3]?.label).toBe("Market session");
    expect([s.allowed, s.reason, s.outcome]).toEqual([false, "MARKET_CLOSED", "Decision logged · gas 111,116"]);
  });

  it("Thursday passes all nine", () => {
    const t = MOMENTS.thu;
    expect([t.toggleLabel, t.intent, t.when]).toEqual(["Thu 5 Nov · 10:30", "BUY NVDAc · $20", "Thu 5 Nov · 10:30 ET"]);
    expect(t.checks.every((c) => c.mark === "PASS")).toBe(true);
    expect(t.checks.map((c) => [c.label, c.detail])).toEqual([
      ["Token allowed", "NVDAc in mandate"],
      ["Token not paused", "transfers active"],
      ["Vault policy", "authorized"],
      ["Market session", "REGULAR · open"],
      // The replayed run's vault had maxStaleness 3600, not today's 90000 default.
      ["Feed freshness", "14s ≤ 3600s"],
      ["Multiplier stable", "no change 24h"],
      ["DEX premium", "53 ≤ 100 bps"],
      ["Size limits", "$20 ≤ $50 · $100/day"],
      ["Concentration", "weight ≤ 40%"],
    ]);
    expect([t.allowed, t.reason, t.outcome]).toEqual([true, "OK", "Swap executed · gas 758,192"]);
  });
});
