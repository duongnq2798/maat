// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { formatLimit } from "@/content/format";

const m = FACTS.mandate.value;

describe("formatLimit (spec 2026-11-23 section 5.1)", () => {
  it('writes the feed-age limit as "90,000 s (25 h)", from FACTS', () => {
    expect(m.maxStalenessSec).toBe(90_000);
    expect(formatLimit(m.maxStalenessSec, "s")).toBe("90,000 s (25 h)");
  });

  it("writes every other limit in seconds the same way: whole hours first, else whole minutes", () => {
    expect(formatLimit(m.twapWindowSec, "s")).toBe("1,800 s (30 min)");
    expect(formatLimit(m.multiplierCooldownSec, "s")).toBe("86,400 s (24 h)");
    expect(formatLimit(m.deriskWindowSec, "s")).toBe("28,800 s (8 h)");
    expect(formatLimit(3600, "s")).toBe("3,600 s (1 h)");
    expect(formatLimit(5400, "s")).toBe("5,400 s (90 min)");
    expect(formatLimit(60, "s")).toBe("60 s (1 min)");
  });

  it("writes seconds alone under a minute, or when neither hours nor minutes divide them", () => {
    expect(formatLimit(45, "s")).toBe("45 s");
    expect(formatLimit(90, "s")).toBe("90 s");
    expect(formatLimit(3601, "s")).toBe("3,601 s");
    expect(formatLimit(0, "s")).toBe("0 s");
  });

  it("writes basis points with their unit, grouped", () => {
    expect(formatLimit(m.maxPremiumBps, "bps")).toBe("100 bps");
    expect(formatLimit(m.maxSlippageBps, "bps")).toBe("150 bps");
    expect(formatLimit(m.maxWeightBps, "bps")).toBe("4,000 bps");
    expect(formatLimit(0, "bps")).toBe("0 bps");
  });

  it("refuses a limit that is not a whole number of 0 or more", () => {
    for (const bad of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => formatLimit(bad, "s"), String(bad)).toThrow(/whole number/);
      expect(() => formatLimit(bad, "bps"), String(bad)).toThrow(/whole number/);
    }
  });
});
