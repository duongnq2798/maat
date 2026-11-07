import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { ALL_FACTS, FACT_TEXT, factFor, isFactName } from "@/lib/docs/fact-text";

describe("FACT_TEXT", () => {
  it("formats values with their units", () => {
    const text = (n: keyof typeof FACT_TEXT) => FACT_TEXT[n].text;
    expect(text("forkBlock")).toBe("53,551,627");
    expect(text("mandate.perTradeCapUsd")).toBe("$50");
    expect(text("mandate.maxWeightBps")).toBe("4,000 bps");
    expect(text("mandate.multiplierCooldownSec")).toBe("24 hours");
    expect(text("mandate.deriskWindowSec")).toBe("8 hours");
    expect(text("mandate.targetHealthFactor")).toBe("2.0");
    expect(text("premiumsBps.NVDAc")).toBe("53 bps");
    expect(text("earlyClose")).toBe("13:00 ET");
    expect(text("billMinUsd")).toBe("$0.10");
    expect(text("dailyComputeUsd")).toBe("$0.50");
    expect(text("treasuryUsd")).toBe("$20 to $200");
    expect(text("maxGas")).toBe("3,000,000");
  });

  it("points every entry at a fact that exists", () => {
    for (const [name, f] of Object.entries(FACT_TEXT)) expect(Object.keys(ALL_FACTS), name).toContain(f.from);
  });

  it("factFor returns the text with its source, and names a bad key", () => {
    expect(factFor("timelockHours")).toEqual({ text: "24 hours", source: FACTS.timelockHours.source });
    expect(isFactName("gas.buy")).toBe(true);
    expect(isFactName("gas.sell")).toBe(false);
    expect(() => factFor("gas.sell")).toThrow('<Fact name="gas.sell" /> is not in FACT_TEXT');
  });
});
