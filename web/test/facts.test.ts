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
const addresses = readRepo("contracts/script/BaseAddresses.sol");
const forkDeploy = readRepo("agent/test/integration/deploy.ts");

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

  it("fork day, ET time and feed age: the doc comment on BLOCK_SESSION in BaseAddresses.sol", () => {
    const lines = addresses.split(/\r?\n/);
    const at = lines.findIndex((l) => /\bBLOCK_SESSION\s*=/.test(l));
    if (at < 1) throw new Error("BLOCK_SESSION is not declared in contracts/script/BaseAddresses.sol");
    const doc = lines[at - 1] ?? "";
    // e.g. "/// Thu 2026-11-05 15:30 UTC (10:30 ET). NVDA feed = 186.67486580, age 14 s."
    const m = /^\s*\/\/\/\s*\w{3} (\d{4}-\d{2}-\d{2}) \d{2}:\d{2} UTC \((\d{2}:\d{2}) ET\)\..*\bage (\d+) s\./.exec(doc);
    if (!m) throw new Error(`the line above BLOCK_SESSION is not the expected doc comment: ${JSON.stringify(doc)}`);
    expect(solidityNumber(constantValue(addresses, "BLOCK_SESSION"))).toBe(FACTS.forkBlock.value);
    expect(m[1]).toBe(FACTS.forkDay.value);
    expect(m[2]).toBe(FACTS.forkTimeEt.value);
    expect(Number(m[3])).toBe(FACTS.feedAgeSec.value);
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

  it("agent policy: target weight, rebalance drift and loop cadence", () => {
    const policy = readRepo("agent/src/policy.ts");
    const param = (name: string) => {
      const v = new RegExp(`DEFAULT_POLICY[^;]*\\b${name}:\\s*([\\d_]+)`).exec(policy)?.[1];
      if (v === undefined) throw new Error(`${name} not found in DEFAULT_POLICY in agent/src/policy.ts`);
      return Number(v.replaceAll("_", ""));
    };
    // policy.ts splits what is not held in USDC equally across the basket, rounding down to whole bps.
    const basket = fieldValues(config, "maxWeightBps").length;
    expect(Math.floor((10_000 - param("cashReserveBps")) / basket) / 100).toBeCloseTo(FACTS.targetWeightPct.value, 1);
    expect(param("driftBps") / 100).toBe(FACTS.rebalanceDriftPct.value);
    const minutes = /IN_SESSION_MS\s*=\s*(\d+)\s*\*\s*60_000/.exec(readRepo("agent/src/loop/scheduler.ts"))?.[1];
    expect(Number(minutes)).toBe(FACTS.loopMinutes.value);
  });

  it("gas: gasUsed per tx in the committed MAAT_GAS_LOG output of the fork run", () => {
    type Row = { runId: string; fn: string; action?: string; gasUsed: string };
    const rows = JSON.parse(readRepo("agent/test/integration/fork-gas.json")) as Row[];
    const used = (runId: string, action: string) => {
      const hit = rows.filter((r) => r.runId === runId && r.fn === "execute" && r.action === action);
      if (hit.length !== 1) throw new Error(`expected one ${runId} ${action} execute row in fork-gas.json, found ${hit.length}`);
      return Number(hit[0]!.gasUsed);
    };
    // fork-1 is the allowed BUY/SUPPLY/BORROW round; fork-2 is the market-closed BUY the vault refuses and logs.
    expect(forkTest).toMatch(/it\("logs a market-closed refusal[\s\S]*?"fork-2"/);
    expect({
      buy: used("fork-1", "BUY"),
      supply: used("fork-1", "SUPPLY"),
      borrow: used("fork-1", "BORROW"),
      refusalLog: used("fork-2", "BUY"),
    }).toEqual(FACTS.gas.value);
  });

  it("market calendar: holidays, with the names in its comments, and early closes", () => {
    const iso = (y = "", m = "", d = "") => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const holidays = [...calendar.matchAll(/_addHoliday\((\d+),\s*(\d+),\s*(\d+)\);\s*\/\/\s*([^\r\n]+)/g)].map((m) => ({
      date: iso(m[1], m[2], m[3]),
      name: (m[4] ?? "").trim(),
    }));
    const earlyCloses = [...calendar.matchAll(/_setEarlyClose\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\);/g)].map((m) => ({
      date: iso(m[1], m[2], m[3]),
      closeMin: Number(m[4]),
    }));
    expect(holidays.length * earlyCloses.length).toBeGreaterThan(0);
    expect({ holidays, earlyCloses }).toEqual(FACTS.calendar.value);
  });

  it("basket: the tokens MaatConfig.basket() lists, in order, each with a measured premium", () => {
    const body = /function basket\(\)[^{]*\{([\s\S]*?)\n\s*\}/.exec(config)?.[1];
    if (!body) throw new Error("basket() not found in contracts/script/MaatConfig.sol");
    const listed = [...body.matchAll(/toks\[\d+\]\s*=\s*A\.(\w+);/g)].map((m) => m[1]);
    expect(listed).toEqual(FACTS.basket.value.map((s) => s.toUpperCase()));
    expect(Object.keys(FACTS.premiumsBps.value).sort()).toEqual([...FACTS.basket.value].sort());
  });

  it("the fork vault starts with $200 USDC: owner.fund() in the fork deploy", () => {
    const funds = [...forkDeploy.matchAll(/functionName:\s*"fund",\s*args:\s*\[([\d_]+)n\]/g)].map((m) =>
      solidityNumber(m[1] ?? ""),
    );
    expect(funds).toEqual([FACTS.forkVaultUsd.value * 1e6]);
  });
});
