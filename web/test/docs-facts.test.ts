// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DOCS_FACTS } from "@/content/docs-facts";
import { FACTS } from "@/content/facts";
import { constantValue, readRepo, solidityNumber } from "./helpers/solidity";

describe("facts the docs cite (docs spec §2.4)", () => {
  const vault = readRepo("contracts/src/MandateVault.sol");
  const calendar = readRepo("contracts/src/MarketCalendar.sol");
  const config = readRepo("agent/src/config.ts");
  /** The constructor body only: the public addHoliday/setEarlyClose wrappers call the same helpers. */
  const ctor = /constructor\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(calendar)?.[1] ?? "";
  const zodDefault = (name: string) => {
    const v = new RegExp(`\\b${name}: field\\([^\\n]*\\.default\\(([\\d.]+)\\)\\)`).exec(config)?.[1];
    if (v === undefined) throw new Error(`no numeric default for ${name} in agent/src/config.ts`);
    return Number(v);
  };
  const tsConst = (file: string, name: string) => solidityNumber(constantValue(readRepo(file), name));

  it("adds no key FACTS already has", () => {
    expect(Object.keys(DOCS_FACTS).filter((k) => Object.hasOwn(FACTS, k))).toEqual([]);
  });

  it("timelock grace period and the de-risk window cap", () => {
    expect(solidityNumber(constantValue(vault, "GRACE_PERIOD"))).toBe(DOCS_FACTS.gracePeriodDays.value * 86_400);
    expect(solidityNumber(constantValue(vault, "MAX_DERISK_WINDOW"))).toBe(DOCS_FACTS.maxDeriskWindowHours.value * 3600);
  });

  it("calendar preload: holidays, early closes and their close time", () => {
    expect(ctor).not.toBe("");
    expect([...ctor.matchAll(/_addHoliday\(/g)]).toHaveLength(DOCS_FACTS.calendarPreload.value.holidays);
    const closes = [...ctor.matchAll(/_setEarlyClose\([^)]*,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    expect(closes).toHaveLength(DOCS_FACTS.calendarPreload.value.earlyCloses);
    expect(new Set(closes)).toEqual(new Set([DOCS_FACTS.earlyCloseMin.value]));
  });

  it("Eastern time offsets, the price decimals and the USDC decimals", () => {
    const offsets = /\?\s*(\d+) hours\s*:\s*(\d+) hours/.exec(calendar);
    expect({ dst: Number(offsets?.[1]), standard: Number(offsets?.[2]) }).toEqual(DOCS_FACTS.etOffsetHours.value);
    const price = readRepo("contracts/src/lib/PriceLib.sol");
    expect(solidityNumber(constantValue(price, "PRICE_DECIMALS"))).toBe(DOCS_FACTS.priceDecimals.value);
    expect(solidityNumber(constantValue(price, "USDC_DECIMALS"))).toBe(DOCS_FACTS.usdcDecimals.value);
    expect(vault).toMatch(new RegExp(`decimals\\(\\) != ${DOCS_FACTS.usdcDecimals.value}\\)`));
  });

  it("the lowest health factor floor the vault accepts is one WAD", () => {
    expect(solidityNumber(constantValue(vault, "WAD"))).toBe(DOCS_FACTS.healthFactorBound.value * 1e18);
    expect(vault).toMatch(/m\.minHealthFactor < WAD\b/);
  });

  it("agent settings defaults", () => {
    expect(zodDefault("MAAT_MAX_TX_PER_DAY")).toBe(DOCS_FACTS.maxTxPerDay.value);
    expect(zodDefault("MAAT_DEFAULT_DAILY_COMPUTE_USD")).toBe(DOCS_FACTS.dailyComputeUsd.value);
  });

  it("Claude proposal limits", () => {
    expect(tsConst("agent/src/llm/schema.ts", "MAX_INTENTS")).toBe(DOCS_FACTS.maxIntents.value);
    expect(tsConst("agent/src/llm/schema.ts", "MAX_RATIONALE_CHARS")).toBe(DOCS_FACTS.maxRationaleChars.value);
  });

  it("gas cap and execute floor", () => {
    expect(tsConst("agent/src/exec/calls.ts", "MAX_GAS")).toBe(DOCS_FACTS.maxGas.value);
    expect(tsConst("agent/src/exec/calls.ts", "EXECUTE_GAS_FLOOR")).toBe(DOCS_FACTS.executeGasFloor.value);
  });

  it("policy: cash reserve, runway and the smallest suggestion", () => {
    const policy = readRepo("agent/src/policy.ts");
    const param = (name: string) =>
      Number(new RegExp(`DEFAULT_POLICY[^;]*\\b${name}:\\s*([\\d_]+)`).exec(policy)?.[1]?.replaceAll("_", ""));
    expect(param("cashReserveBps") / 100).toBe(DOCS_FACTS.cashReservePct.value);
    expect(param("runwayDays")).toBe(DOCS_FACTS.runwayDays.value);
    expect(param("minTradeUsd6") / 1e6).toBe(DOCS_FACTS.minTradeUsd.value);
  });

  it("off-session cadence and the smallest bill", () => {
    const minutes = /OFF_SESSION_MS\s*=\s*(\d+)\s*\*\s*60_000/.exec(readRepo("agent/src/loop/scheduler.ts"))?.[1];
    expect(Number(minutes)).toBe(DOCS_FACTS.offSessionMinutes.value);
    expect(tsConst("agent/src/loop/runOnce.ts", "BILL_MIN_USD6") / 1e6).toBe(DOCS_FACTS.billMinUsd.value);
  });

  it("treasury size is the design spec's constraint", () => {
    const spec = readRepo("docs/superpowers/specs/2026-11-06-mandate-treasury-design.md");
    const m = /small mainnet amounts \(\$(\d+)[–-](\d+)\)/.exec(spec);
    expect(m && { min: Number(m[1]), max: Number(m[2]) }).toEqual(DOCS_FACTS.treasuryUsd.value);
  });
});
