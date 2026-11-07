import { describe, expect, it } from "vitest";
import { gate, LOGGABLE_REASONS } from "../src/refusals.js";

describe("gate", () => {
  it("executes OK intents", () => expect(gate("OK", false)).toEqual({ send: true, kind: "execute" }));
  it("does nothing when the guard is unknown", () => expect(gate("UNKNOWN", false)).toEqual({ send: false, why: "guard state unknown (RPC)" }));
  it("logs a market refusal once per day", () => {
    expect(gate("MARKET_CLOSED", false)).toEqual({ send: true, kind: "log-refusal" });
    expect(gate("MARKET_CLOSED", true)).toEqual({ send: false, why: "MARKET_CLOSED already logged today" });
  });
  it("never spends gas on bookkeeping refusals", () => {
    expect(gate("INSUFFICIENT_BALANCE", false)).toEqual({ send: false, why: "INSUFFICIENT_BALANCE not worth a log tx" });
    expect(gate("VAULT_PAUSED", false).send).toBe(false);
  });
  it("lists exactly the market-safety reasons", () => {
    expect([...LOGGABLE_REASONS].sort()).toEqual(
      ["BAD_PRICE", "CONCENTRATION", "DERISK_WINDOW", "FEED_STALE", "HEALTH_FACTOR_LOW", "MARKET_CLOSED", "MULTIPLIER_COOLDOWN", "POLICY_BLOCKED", "PREMIUM_TOO_HIGH", "SIZE_LIMIT", "TOKEN_PAUSED"],
    );
  });
});
