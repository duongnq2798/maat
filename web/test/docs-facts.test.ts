// @vitest-environment node
import { posix } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS_FACTS } from "@/content/docs-facts";
import { FACTS } from "@/content/facts";
import { FACT_TEXT, factTable } from "@/lib/docs/fact-text";
import { constantValue, fieldValues, readRepo, solidityNumber } from "./helpers/solidity";

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

  it("the most decimals a stock token may report", () => {
    expect(vault).toMatch(new RegExp(`if \\(d > ${DOCS_FACTS.maxTokenDecimals.value}\\) revert InvalidConfig\\(\\);`));
  });

  it("the lowest health factor floor the vault accepts is one WAD", () => {
    expect(solidityNumber(constantValue(vault, "WAD"))).toBe(DOCS_FACTS.healthFactorBound.value * 1e18);
    expect(vault).toMatch(/m\.minHealthFactor < WAD\b/);
  });

  it("the mock Aave spoke in the unit tests refuses below the same health factor, as the credit page and its scale say", () => {
    expect(readRepo("contracts/test/mocks/MockSpoke.sol")).toMatch(new RegExp(`healthFactor < ${DOCS_FACTS.healthFactorBound.value}e18\\)`));
  });

  it("agent settings defaults", () => {
    expect(zodDefault("MAAT_MAX_TX_PER_DAY")).toBe(DOCS_FACTS.maxTxPerDay.value);
    expect(zodDefault("MAAT_DEFAULT_DAILY_COMPUTE_USD")).toBe(DOCS_FACTS.dailyComputeUsd.value);
    expect(zodDefault("MAAT_MAX_LLM_USD_PER_DAY")).toBe(DOCS_FACTS.maxLlmUsdPerDay.value);
  });

  it("Claude proposal limits", () => {
    expect(tsConst("agent/src/llm/schema.ts", "MAX_INTENTS")).toBe(DOCS_FACTS.maxIntents.value);
    expect(tsConst("agent/src/llm/schema.ts", "MAX_RATIONALE_CHARS")).toBe(DOCS_FACTS.maxRationaleChars.value);
    expect(tsConst("agent/src/llm/schema.ts", "MAX_SUMMARY_CHARS")).toBe(DOCS_FACTS.maxSummaryChars.value);
    expect(tsConst("agent/src/llm/schema.ts", "MAX_AMOUNT_USD")).toBe(DOCS_FACTS.maxAmountUsd.value);
  });

  it("gas cap and the execute and syncMultiplier floors", () => {
    expect(tsConst("agent/src/exec/calls.ts", "MAX_GAS")).toBe(DOCS_FACTS.maxGas.value);
    expect(tsConst("agent/src/exec/calls.ts", "EXECUTE_GAS_FLOOR")).toBe(DOCS_FACTS.executeGasFloor.value);
    expect(tsConst("agent/src/exec/calls.ts", "SYNC_GAS_FLOOR")).toBe(DOCS_FACTS.syncGasFloor.value);
  });

  it("the receipt wait, and the window after which a pending send with no trace is dropped", () => {
    expect(tsConst("agent/src/loop/runOnce.ts", "RECEIPT_TIMEOUT_MS") / 1000).toBe(DOCS_FACTS.receiptTimeoutSec.value);
    expect(tsConst("agent/src/loop/runOnce.ts", "PENDING_WINDOW_SECONDS") / 60).toBe(DOCS_FACTS.pendingWindowMinutes.value);
  });

  it("the age at which a lock file with no readable pid is stale", () => {
    expect(tsConst("agent/src/loop/lock.ts", "UNREADABLE_STALE_MS") / 1000).toBe(DOCS_FACTS.lockStaleSec.value);
  });

  it("the slippage bound in dollars: the caps times maxSlippageBps, below the oracle-implied output", () => {
    const config = readRepo("contracts/script/MaatConfig.sol");
    const one = (field: string) => solidityNumber(fieldValues(config, field)[0] ?? "");
    const slip = one("maxSlippageBps") / solidityNumber(constantValue(vault, "BPS"));
    expect((one("perTradeCapUsd") / 1e6) * slip).toBe(DOCS_FACTS.slippageLossPerTradeUsd.value);
    expect((one("dailyCapUsd") / 1e6) * slip).toBe(DOCS_FACTS.slippageLossPerDayUsd.value);
    expect(vault).toMatch(/floorOut = expectedOut \* \(BPS - _mandate\.maxSlippageBps\) \/ BPS;/);
  });

  it("the executor's gas top-up is the figure in the agent README and in the setup script", () => {
    const readme = /send about ([\d.]+) ETH on Base to the executor address/.exec(readRepo("agent/README.md"));
    const script = /send ~([\d.]+) ETH on Base to \$\{account\.address\} for gas/.exec(readRepo("agent/scripts/cdp-setup.ts"));
    expect(Number(readme?.[1])).toBe(DOCS_FACTS.executorGasEth.value);
    expect(Number(script?.[1])).toBe(DOCS_FACTS.executorGasEth.value);
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
    expect(tsConst("agent/src/loop/runOnce.ts", "LIVE_BILL_MIN_USD6") / 1e6).toBe(DOCS_FACTS.liveBillMinUsd.value);
  });

  it("the date the Base addresses were verified is the library's NatSpec date", () => {
    const addresses = readRepo("contracts/script/BaseAddresses.sol");
    const date = /^\/\/\/ @notice Base mainnet addresses verified on (\d{4}-\d{2}-\d{2})\.$/m.exec(addresses)?.[1];
    expect(date).toBe(DOCS_FACTS.addressesVerifiedOn.value);
  });

  it("the AMZNc pool liquidity is the figure in the README and in the design spec", () => {
    const readme = /AMZNc is not in the basket: its pool held only about \$(\d+)k of liquidity/.exec(readRepo("README.md"));
    const spec = /AMZNc is excluded because its pool has only about \$(\d+)k of liquidity on 2026-11-06/.exec(
      readRepo("docs/superpowers/specs/2026-11-06-mandate-treasury-design.md"),
    );
    expect(Number(readme?.[1]) * 1000).toBe(DOCS_FACTS.amzncPoolLiquidityUsd.value);
    expect(Number(spec?.[1]) * 1000).toBe(DOCS_FACTS.amzncPoolLiquidityUsd.value);
  });

  it("treasury size is the design spec's constraint", () => {
    const spec = readRepo("docs/superpowers/specs/2026-11-06-mandate-treasury-design.md");
    const m = /small mainnet amounts \(\$(\d+)[–-](\d+)\)/.exec(spec);
    expect(m && { min: Number(m[1]), max: Number(m[2]) }).toEqual(DOCS_FACTS.treasuryUsd.value);
  });
});

/** The body of `function name(` (or of the constructor), braces included, with line comments removed. */
function bodyOf(src: string, fn: string): string {
  const start = src.search(fn === "constructor" ? /\bconstructor\s*\(/ : new RegExp(`\\bfunction ${fn}\\s*\\(`));
  if (start < 0) throw new Error(`no function ${fn}`);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1).replace(/\/\/[^\n]*/g, "");
  }
  throw new Error(`the body of ${fn} does not close`);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (s: string) => new RegExp(`(?<![\\w$])${escape(s)}(?![\\w$])`);

/**
 * The top level of the brace block that opens at `open`: the text between its braces with every nested block
 * removed. For a struct, enum or object literal that is its fields; for a contract, its members and signatures.
 */
function topLevel(src: string, open: number): string {
  let depth = 0;
  let out = "";
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return out;
    else if (depth === 1) out += ch;
  }
  throw new Error("unclosed brace");
}

/**
 * The top level of `name`'s declaration in `src`, comments removed: a Solidity contract, library, interface, struct
 * or enum, or a TS `const name = {…}`. Undefined when `src` does not declare it.
 */
function declarationIn(src: string, name: string): string | undefined {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");
  const n = escape(name);
  const start = code.search(new RegExp(`\\b(?:contract|library|interface|struct|enum)\\s+${n}\\b|\\bconst\\s+${n}\\b[^=;]*=\\s*\\{`));
  return start < 0 ? undefined : topLevel(code, code.indexOf("{", start));
}

/** The top level of `name`'s declaration in `file` or in a file it imports by a relative path. */
function declarationOf(file: string, name: string): string | undefined {
  const src = readRepo(file);
  const own = declarationIn(src, name);
  if (own !== undefined) return own;
  for (const m of src.matchAll(/^import\b[^;]*?["'](\.[^"']+)["']/gm)) {
    const rel = (m[1] ?? "").replace(/\.js$/, ".ts");
    const found = declarationIn(readRepo(posix.join(posix.dirname(file), rel)), name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** `owner.member` names a member at the top level of `owner`'s own declaration, not just two words that occur in `file`. */
const isMember = (file: string, owner: string, member: string) => word(member).test(declarationOf(file, owner) ?? "");

describe("the In code column of default-parameters names only what the code has", () => {
  const coded = Object.entries(FACT_TEXT).flatMap(([name, f]) => (f.code ? [[name, f.code] as const] : []));

  it("every row of the three settings tables has its place in the code, and no row of the figures table has one", () => {
    const page = readRepo("web/content/docs/reference/default-parameters.mdx");
    const tables = [...page.matchAll(/names=\{\[([^\]]*)\]\}/g)].map((m) => [...(m[1] ?? "").matchAll(/"([^"]+)"/g)].map((n) => n[1] ?? ""));
    expect(tables.map((names) => factTable(names).settings)).toEqual([true, true, true, false]);
  });

  it("the member check rejects a name made of two real words from different declarations", () => {
    expect(isMember("contracts/script/MaatConfig.sol", "TokenConfig", "maxWeightBps")).toBe(true);
    expect(isMember("contracts/script/MaatConfig.sol", "Mandate", "maxWeightBps")).toBe(false);
    expect(isMember("contracts/src/MandateVault.sol", "MandateVault", "TIMELOCK")).toBe(true);
    expect(isMember("contracts/src/MandateVault.sol", "MandateVault", "maxStaleness")).toBe(false);
    expect(isMember("contracts/script/Deploy.s.sol", "SessionMode", "REGULAR")).toBe(true);
    expect(isMember("agent/src/policy.ts", "DEFAULT_POLICY", "driftBps")).toBe(true);
    expect(isMember("agent/src/policy.ts", "DEFAULT_POLICY", "targetBps")).toBe(false);
  });

  it.each(coded)("%s", (_name, c) => {
    expect(c.identifier === undefined, "exactly one of identifier and literal").not.toBe(c.literal === undefined);
    const scope = c.in === undefined ? readRepo(c.file) : bodyOf(readRepo(c.file), c.in);
    const parts = c.identifier?.split(".") ?? [];
    expect(parts.length, "at most one qualifier").toBeLessThanOrEqual(2);
    for (const part of parts) expect(scope).toMatch(word(part));
    const [owner, member] = parts;
    if (owner !== undefined && member !== undefined) {
      expect(isMember(c.file, owner, member), `${member} is declared in ${owner}, in ${c.file} or a file it imports`).toBe(true);
    }
    if (c.literal !== undefined) expect(scope).toMatch(new RegExp(`(?<![\\w.])${escape(c.literal)}(?![\\w.])`));
  });
});
