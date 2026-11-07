// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { REASON_GROUPS, REASONS } from "@/content/reasons";
import {
  constantValue,
  enumMembers,
  eventParams,
  fieldValues,
  pragmaVersion,
  readRepo,
  solidityNumber,
} from "./helpers/solidity";

const types = readRepo("contracts/src/Types.sol");
const vault = readRepo("contracts/src/MandateVault.sol");
const events = readRepo("contracts/src/IMandateVaultEvents.sol");
const calendar = readRepo("contracts/src/MarketCalendar.sol");
const config = readRepo("contracts/script/MaatConfig.sol");
const deploy = readRepo("contracts/script/Deploy.s.sol");
const forkTest = readRepo("agent/test/integration/agent.fork.test.ts");
const anvil = readRepo("agent/test/integration/anvil.ts");

describe("every fact names its source", () => {
  it.each(Object.entries(FACTS))("%s", (_name, f) => {
    expect(f.source.trim().length).toBeGreaterThan(10);
  });
});

describe("parity with the contracts and the fork run (spec §5.4)", () => {
  it("reason codes are enum Reason minus OK, in order", () => {
    expect(enumMembers(types, "Reason")).toEqual(["OK", ...REASONS]);
    expect(FACTS.refusalCount.value).toBe(enumMembers(types, "Reason").length - 1);
  });

  it("reason groups cover every code exactly once, sized like the comp", () => {
    const grouped = REASON_GROUPS.flatMap((g) => g.codes);
    expect([...grouped].sort()).toEqual([...REASONS].sort());
    expect(REASON_GROUPS.map((g) => [g.title, g.codes.length])).toEqual([
      ["Market", 5],
      ["Token and policy", 5],
      ["Limits", 4],
      ["Credit", 3],
      ["Execution", 2],
    ]);
  });

  it("timelock", () => {
    expect(solidityNumber(constantValue(vault, "TIMELOCK"))).toBe(FACTS.timelockHours.value * 3600);
  });

  it("market calendar: NYSE session minutes and the Chainlink feed edge", () => {
    expect(solidityNumber(constantValue(calendar, "OPEN_MIN"))).toBe(FACTS.nyseSessionMin.value.open);
    expect(solidityNumber(constantValue(calendar, "CLOSE_MIN"))).toBe(FACTS.nyseSessionMin.value.close);
    expect(solidityNumber(constantValue(calendar, "FEED_EDGE_MIN"))).toBe(FACTS.feedEdgeMin.value);
  });

  it("event Decision signature and compiler version", () => {
    expect(eventParams(events, "Decision")).toEqual(FACTS.decisionEvent.value);
    expect(pragmaVersion(events)).toBe(FACTS.solidityVersion.value);
  });

  it("default mandate", () => {
    const m = FACTS.mandate.value;
    const one = (field: string): number => {
      const values = fieldValues(config, field);
      expect(values, field).toHaveLength(1);
      return solidityNumber(values[0] ?? "");
    };
    expect(one("maxPremiumBps")).toBe(m.maxPremiumBps);
    expect(one("maxSlippageBps")).toBe(m.maxSlippageBps);
    expect(one("maxStaleness")).toBe(m.maxStalenessSec);
    expect(one("multiplierCooldown")).toBe(m.multiplierCooldownSec);
    expect(one("twapWindow")).toBe(m.twapWindowSec);
    expect(one("perTradeCapUsd") / 1e6).toBe(m.perTradeCapUsd);
    expect(one("dailyCapUsd") / 1e6).toBe(m.dailyCapUsd);
    expect(solidityNumber(constantValue(config, "MIN_HEALTH_FACTOR")) / 1e18).toBe(m.minHealthFactor);
    expect(solidityNumber(constantValue(config, "TARGET_HEALTH_FACTOR")) / 1e18).toBe(m.targetHealthFactor);
    expect(solidityNumber(constantValue(config, "DERISK_WINDOW"))).toBe(m.deriskWindowSec);
    expect(/defaultMandate\(\s*SessionMode\.(\w+)/.exec(deploy)?.[1]).toBe(m.sessionMode);
  });

  it("maxWeightBps is the same for all three basket tokens", () => {
    const weights = fieldValues(config, "maxWeightBps").map(solidityNumber);
    expect(weights).toEqual(Array(3).fill(FACTS.mandate.value.maxWeightBps));
  });

  it("fork block and the weekend jump", () => {
    expect(solidityNumber(constantValue(forkTest, "BLOCK_SESSION"))).toBe(FACTS.forkBlock.value);
    const days = /timestamp:\s*now\s*\+\s*(\d+)n\s*\*\s*86_400n/.exec(forkTest)?.[1];
    expect(Number(days)).toBe(FACTS.weekendOffsetDays.value);
  });

  it("NVDAc uiMultiplier at the fork block", () => {
    const m = /NVDAc\.uiMultiplier\(\) return (\d+) at block (\d+)/.exec(anvil);
    expect(m?.[2]).toBe(String(FACTS.forkBlock.value));
    const wad = (m?.[1] ?? "").padStart(19, "0");
    expect(`${wad.slice(0, -18)}.${wad.slice(-18)}`).toBe(FACTS.nvdaUiMultiplier.value);
  });

  it("measured premiums", () => {
    const found = Object.fromEntries(
      [...config.matchAll(/\b(NVDAc|GOOGLc|AAPLc) (\d+) bps/g)].map((m) => [m[1], Number(m[2])]),
    );
    expect(found).toEqual(FACTS.premiumsBps.value);
  });
});
