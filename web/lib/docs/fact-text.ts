import { DOCS_FACTS } from "../../content/docs-facts";
import { FACTS } from "../../content/facts";
import { clockLabel, formatInt } from "../../content/format";

/** Every number the docs may cite: the landing page's FACTS plus the docs-only DOCS_FACTS. */
export const ALL_FACTS = { ...FACTS, ...DOCS_FACTS };
const F = ALL_FACTS;

type FactKey = keyof typeof ALL_FACTS;

/**
 * Where the code sets a value, for the In code and Source file columns of the default-parameters page: the name
 * the code gives the value or, when it gives none, the literal it writes. test/docs-facts.test.ts checks that each
 * one occurs in `file`, inside the body of `in` when that is given. Never a name the code does not use.
 */
export interface FactCode {
  /** The repository file that sets the value. */
  readonly file: string;
  /**
   * The code's own name for the value, e.g. "Mandate.maxStaleness", with at most one qualifier. Every dotted part
   * occurs in the file (in the body of `in` when that is given), and for X.Y, Y is declared at the top level of X's
   * own declaration, in the file or in a file it imports by a relative path.
   */
  readonly identifier?: string;
  /** The value as the code writes it, when the code gives it no name, e.g. "18". */
  readonly literal?: string;
  /** The function whose body sets it, e.g. "defaultMandate", or "constructor". */
  readonly in?: string;
}

interface FactText {
  /** What the page shows, units included. */
  readonly text: string;
  /** The ALL_FACTS entry it comes from; its `source` is the tooltip and the Source of a figure on default-parameters. */
  readonly from: FactKey;
  /** A plain name for the value: the first column of the default-parameters tables. */
  readonly label: string;
  /** Where the code sets it. Measurements, counts, dates, derived values and plans have none. */
  readonly code?: FactCode;
}

const t = (text: string, from: FactKey, label: string, code?: FactCode): FactText =>
  code === undefined ? { text, from, label } : { text, from, label, code };
const usd = (n: number) => `$${n < 1 ? n.toFixed(2) : formatInt(n)}`;
const cents = (n: number) => `$${n.toFixed(2)}`;
const bps = (n: number) => `${formatInt(n)} bps`;
const m = F.mandate.value;
const gas = F.gas.value;
const prem = F.premiumsBps.value;

const VAULT = "contracts/src/MandateVault.sol";
const CALENDAR = "contracts/src/MarketCalendar.sol";
const PRICE_LIB = "contracts/src/lib/PriceLib.sol";
const MAAT_CONFIG = "contracts/script/MaatConfig.sol";
const DEPLOY = "contracts/script/Deploy.s.sol";
const CONFIG = "agent/src/config.ts";
const POLICY = "agent/src/policy.ts";
const SCHEDULER = "agent/src/loop/scheduler.ts";
const RUN_ONCE = "agent/src/loop/runOnce.ts";
const LOCK = "agent/src/loop/lock.ts";
const SCHEMA = "agent/src/llm/schema.ts";
const CALLS = "agent/src/exec/calls.ts";

const id = (file: string, identifier: string, fn?: string): FactCode =>
  fn === undefined ? { file, identifier } : { file, identifier, in: fn };
const lit = (file: string, literal: string, fn: string): FactCode => ({ file, literal, in: fn });
/** A field of the default mandate, as MaatConfig.defaultMandate() sets it. */
const mandateField = (field: string) => id(MAAT_CONFIG, `Mandate.${field}`, "defaultMandate");

/**
 * Every value a docs page may show with <Fact name="…" />, as text, with the label and the place in the code that
 * the default-parameters page shows. A dotted name reads one field of a structured fact. Adding a number to the
 * docs means adding it here, and to DOCS_FACTS (content/docs-facts.ts) with a parity test in test/docs-facts.test.ts.
 */
export const FACT_TEXT = {
  checksPerTrade: t(String(F.checksPerTrade.value), "checksPerTrade", "Checks per trade"),
  refusalCount: t(String(F.refusalCount.value), "refusalCount", "Refusal codes"),
  timelockHours: t(`${F.timelockHours.value} hours`, "timelockHours", "Timelock delay", id(VAULT, "MandateVault.TIMELOCK")),
  gracePeriodDays: t(
    `${F.gracePeriodDays.value} days`,
    "gracePeriodDays",
    "Window to apply a queued change",
    id(VAULT, "MandateVault.GRACE_PERIOD"),
  ),
  forkBlock: t(formatInt(F.forkBlock.value), "forkBlock", "Fork block"),
  forkDay: t(F.forkDay.value, "forkDay", "Date of the fork block"),
  forkTimeEt: t(`${F.forkTimeEt.value} ET`, "forkTimeEt", "Time of the fork block"),
  weekendOffsetDays: t(String(F.weekendOffsetDays.value), "weekendOffsetDays", "Days the agent fork test moves its clock for the weekend BUY"),
  feedAgeSec: t(`${F.feedAgeSec.value} s`, "feedAgeSec", "Age of the NVDA feed answer at the fork block"),
  nvdaUiMultiplier: t(F.nvdaUiMultiplier.value, "nvdaUiMultiplier", "NVDAc uiMultiplier at the fork block"),
  "premiumsBps.NVDAc": t(bps(prem.NVDAc), "premiumsBps", "Premium measured at the fork block, NVDAc"),
  "premiumsBps.GOOGLc": t(bps(prem.GOOGLc), "premiumsBps", "Premium measured at the fork block, GOOGLc"),
  "premiumsBps.AAPLc": t(bps(prem.AAPLc), "premiumsBps", "Premium measured at the fork block, AAPLc"),
  "mandate.sessionMode": t(m.sessionMode, "mandate", "Session mode", id(DEPLOY, "SessionMode.REGULAR", "run")),
  "mandate.maxStalenessSec": t(
    `${formatInt(m.maxStalenessSec)} s`,
    "mandate",
    "Oldest feed answer accepted",
    mandateField("maxStaleness"),
  ),
  "mandate.maxPremiumBps": t(bps(m.maxPremiumBps), "mandate", "Premium limit", mandateField("maxPremiumBps")),
  "mandate.maxSlippageBps": t(bps(m.maxSlippageBps), "mandate", "Slippage limit", mandateField("maxSlippageBps")),
  "mandate.twapWindowSec": t(`${formatInt(m.twapWindowSec)} s`, "mandate", "TWAP window", mandateField("twapWindow")),
  "mandate.multiplierCooldownSec": t(
    `${m.multiplierCooldownSec / 3600} hours`,
    "mandate",
    "Cooldown after a multiplier change",
    mandateField("multiplierCooldown"),
  ),
  "mandate.perTradeCapUsd": t(usd(m.perTradeCapUsd), "mandate", "Per-trade cap", mandateField("perTradeCapUsd")),
  "mandate.dailyCapUsd": t(usd(m.dailyCapUsd), "mandate", "Daily cap", mandateField("dailyCapUsd")),
  "mandate.maxWeightBps": t(
    bps(m.maxWeightBps),
    "mandate",
    "Largest weight of one stock",
    id(MAAT_CONFIG, "TokenConfig.maxWeightBps", "basket"),
  ),
  "mandate.minHealthFactor": t(m.minHealthFactor.toFixed(1), "mandate", "Health factor floor", mandateField("minHealthFactor")),
  "mandate.targetHealthFactor": t(
    m.targetHealthFactor.toFixed(1),
    "mandate",
    "Health factor floor in the de-risk window",
    mandateField("targetHealthFactor"),
  ),
  "mandate.deriskWindowSec": t(`${m.deriskWindowSec / 3600} hours`, "mandate", "De-risk window", mandateField("deriskWindow")),
  maxDeriskWindowHours: t(
    `${F.maxDeriskWindowHours.value} hours`,
    "maxDeriskWindowHours",
    "Longest de-risk window allowed",
    id(VAULT, "MandateVault.MAX_DERISK_WINDOW"),
  ),
  "gas.buy": t(formatInt(gas.buy), "gas", "Gas used by a BUY in the fork run"),
  "gas.supply": t(formatInt(gas.supply), "gas", "Gas used by a SUPPLY in the fork run"),
  "gas.borrow": t(formatInt(gas.borrow), "gas", "Gas used by a BORROW in the fork run"),
  "gas.refusalLog": t(formatInt(gas.refusalLog), "gas", "Gas used by a logged refusal in the fork run"),
  nyseOpen: t(`${clockLabel(F.nyseSessionMin.value.open)} ET`, "nyseSessionMin", "Session open", id(CALENDAR, "MarketCalendar.OPEN_MIN")),
  nyseClose: t(
    `${clockLabel(F.nyseSessionMin.value.close)} ET`,
    "nyseSessionMin",
    "Session close",
    id(CALENDAR, "MarketCalendar.CLOSE_MIN"),
  ),
  feedEdge: t(`${clockLabel(F.feedEdgeMin.value)} ET`, "feedEdgeMin", "Feed edge", id(CALENDAR, "MarketCalendar.FEED_EDGE_MIN")),
  earlyClose: t(
    `${clockLabel(F.earlyCloseMin.value)} ET`,
    "earlyCloseMin",
    "Close on a shipped early-close day",
    lit(CALENDAR, String(F.earlyCloseMin.value), "constructor"),
  ),
  "etOffsetHours.dst": t(
    `${F.etOffsetHours.value.dst} hours`,
    "etOffsetHours",
    "Hours behind UTC in daylight saving time",
    lit(CALENDAR, `${F.etOffsetHours.value.dst} hours`, "etOffsetSeconds"),
  ),
  "etOffsetHours.standard": t(
    `${F.etOffsetHours.value.standard} hours`,
    "etOffsetHours",
    "Hours behind UTC in standard time",
    lit(CALENDAR, `${F.etOffsetHours.value.standard} hours`, "etOffsetSeconds"),
  ),
  priceDecimals: t(`${F.priceDecimals.value} decimals`, "priceDecimals", "Decimals of a price", id(PRICE_LIB, "PriceLib.PRICE_DECIMALS")),
  usdcDecimals: t(`${F.usdcDecimals.value} decimals`, "usdcDecimals", "USDC decimals", id(PRICE_LIB, "PriceLib.USDC_DECIMALS")),
  maxTokenDecimals: t(
    `${F.maxTokenDecimals.value} decimals`,
    "maxTokenDecimals",
    "Most decimals a stock may have",
    lit(VAULT, String(F.maxTokenDecimals.value), "_requireValidTokenConfig"),
  ),
  healthFactorBound: t(
    F.healthFactorBound.value.toFixed(1),
    "healthFactorBound",
    "Lowest health factor floor allowed",
    id(VAULT, "WAD", "_requireValidCredit"),
  ),
  "calendarPreload.holidays": t(String(F.calendarPreload.value.holidays), "calendarPreload", "Holidays the calendar ships with"),
  "calendarPreload.earlyCloses": t(String(F.calendarPreload.value.earlyCloses), "calendarPreload", "Early closes the calendar ships with"),
  loopMinutes: t(`${F.loopMinutes.value} minutes`, "loopMinutes", "Time between rounds in session", id(SCHEDULER, "IN_SESSION_MS")),
  offSessionMinutes: t(
    `${F.offSessionMinutes.value} minutes`,
    "offSessionMinutes",
    "Time between rounds outside the session",
    id(SCHEDULER, "OFF_SESSION_MS"),
  ),
  rebalanceDriftPct: t(
    `${F.rebalanceDriftPct.value} percentage points`,
    "rebalanceDriftPct",
    "Drift that triggers a rebalance",
    id(POLICY, "DEFAULT_POLICY.driftBps"),
  ),
  targetWeightPct: t(`${F.targetWeightPct.value}%`, "targetWeightPct", "Target weight of each stock"),
  pendingWindowBlocks: t(
    `${F.pendingWindowBlocks.value} blocks`,
    "pendingWindowBlocks",
    "Blocks before a send with no trace is dropped",
    id(RUN_ONCE, "PENDING_WINDOW_BLOCKS"),
  ),
  executorGasEth: t(`about ${F.executorGasEth.value} ETH`, "executorGasEth", "ETH for the executor's gas (estimate)"),
  cashReservePct: t(`${F.cashReservePct.value}%`, "cashReservePct", "Cash target", id(POLICY, "DEFAULT_POLICY.cashReserveBps")),
  runwayDays: t(`${F.runwayDays.value} days`, "runwayDays", "Compute runway kept in USDC", id(POLICY, "DEFAULT_POLICY.runwayDays")),
  billMinUsd: t(usd(F.billMinUsd.value), "billMinUsd", "Smallest compute bill paid", id(RUN_ONCE, "BILL_MIN_USD6")),
  minTradeUsd: t(usd(F.minTradeUsd.value), "minTradeUsd", "Smallest suggestion kept", id(POLICY, "DEFAULT_POLICY.minTradeUsd6")),
  maxTxPerDay: t(String(F.maxTxPerDay.value), "maxTxPerDay", "Most transactions per UTC day", id(CONFIG, "MAAT_MAX_TX_PER_DAY")),
  dailyComputeUsd: t(
    usd(F.dailyComputeUsd.value),
    "dailyComputeUsd",
    "Daily compute cost assumed before any history",
    id(CONFIG, "MAAT_DEFAULT_DAILY_COMPUTE_USD"),
  ),
  maxIntents: t(String(F.maxIntents.value), "maxIntents", "Most intents per proposal", id(SCHEMA, "MAX_INTENTS")),
  maxRationaleChars: t(
    String(F.maxRationaleChars.value),
    "maxRationaleChars",
    "Most characters in a rationale",
    id(SCHEMA, "MAX_RATIONALE_CHARS"),
  ),
  maxSummaryChars: t(
    formatInt(F.maxSummaryChars.value),
    "maxSummaryChars",
    "Most characters in a proposal's summary",
    id(SCHEMA, "MAX_SUMMARY_CHARS"),
  ),
  maxAmountUsd: t(usd(F.maxAmountUsd.value), "maxAmountUsd", "Largest amount of one proposed intent", id(SCHEMA, "MAX_AMOUNT_USD")),
  maxGas: t(formatInt(F.maxGas.value), "maxGas", "Gas limit cap", id(CALLS, "MAX_GAS")),
  executeGasFloor: t(formatInt(F.executeGasFloor.value), "executeGasFloor", "Lowest gas limit for execute", id(CALLS, "EXECUTE_GAS_FLOOR")),
  syncGasFloor: t(
    formatInt(F.syncGasFloor.value),
    "syncGasFloor",
    "Lowest gas limit for syncMultiplier",
    id(CALLS, "SYNC_GAS_FLOOR"),
  ),
  receiptTimeoutSec: t(`${F.receiptTimeoutSec.value} s`, "receiptTimeoutSec", "Time a round waits for a receipt", id(RUN_ONCE, "RECEIPT_TIMEOUT_MS")),
  lockStaleSec: t(
    `${F.lockStaleSec.value} s`,
    "lockStaleSec",
    "Age at which an unreadable lock file is stale",
    id(LOCK, "UNREADABLE_STALE_MS"),
  ),
  slippageLossPerTradeUsd: t(
    cents(F.slippageLossPerTradeUsd.value),
    "slippageLossPerTradeUsd",
    "Most a trade at the per-trade cap can fill below the oracle price",
  ),
  slippageLossPerDayUsd: t(
    cents(F.slippageLossPerDayUsd.value),
    "slippageLossPerDayUsd",
    "Most the swaps of one UTC day can fill below the oracle price",
  ),
  treasuryUsd: t(`${usd(F.treasuryUsd.value.min)} to ${usd(F.treasuryUsd.value.max)}`, "treasuryUsd", "Planned treasury size"),
  x402Price: t(F.x402Price.value, "x402Price", "Planned price of an x402 check"),
  solidityVersion: t(F.solidityVersion.value, "solidityVersion", "Solidity version"),
  addressesVerifiedOn: t(F.addressesVerifiedOn.value, "addressesVerifiedOn", "Date the Base addresses were verified"),
  amzncPoolLiquidityUsd: t(
    `about ${usd(F.amzncPoolLiquidityUsd.value)}`,
    "amzncPoolLiquidityUsd",
    "AMZNc pool liquidity when the basket was chosen",
  ),
} as const satisfies Record<string, FactText>;

export type FactName = keyof typeof FACT_TEXT;

export function isFactName(name: string): name is FactName {
  return Object.hasOwn(FACT_TEXT, name);
}

/** The text and source for a name, or an error that names the bad key (the build fails on a typo). */
export function factFor(name: string): { text: string; source: string } {
  if (!isFactName(name)) throw new Error(`<Fact name="${name}" /> is not in FACT_TEXT (lib/docs/fact-text.ts)`);
  const f = FACT_TEXT[name];
  return { text: f.text, source: F[f.from].source };
}

/** name → text, the shape the facts lint in lib/docs/content-checks.ts takes. */
export const FACT_TEXT_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(FACT_TEXT).map(([k, v]) => [k, v.text]),
);

/** One row of a <FactTable />. */
export interface FactRow {
  readonly name: string;
  readonly label: string;
  readonly text: string;
  readonly source: string;
  readonly code: FactCode | undefined;
}

/** The column heads of a <FactTable />: a setting says where the code sets it, a figure cites its source. */
export const FACT_TABLE_HEAD = {
  settings: ["Setting", "In code", "Value", "Source file"],
  figures: ["Figure", "Value", "Source"],
} as const;

/**
 * The rows of a <FactTable />. It is a table of settings when every row says where the code sets it, and a table
 * of figures when none does. A table that mixes the two throws, so the build fails.
 */
export function factTable(names: readonly string[]): { readonly settings: boolean; readonly rows: readonly FactRow[] } {
  const rows = names.map((name): FactRow => {
    const { text, source } = factFor(name);
    const f: FactText = FACT_TEXT[name as FactName];
    return { name, label: f.label, text, source, code: f.code };
  });
  const figures = rows.filter((r) => r.code === undefined).map((r) => r.name);
  if (figures.length > 0 && figures.length < rows.length) {
    throw new Error(`<FactTable /> mixes settings and figures; rows with no place in the code: ${figures.join(", ")} (lib/docs/fact-text.ts)`);
  }
  return { settings: figures.length === 0, rows };
}

/** The In code cell as plain and code runs: "`Mandate.maxStaleness` in `defaultMandate`", "literal `18` in `_requireValidTokenConfig`". */
export function codeParts(c: FactCode): readonly { readonly code: boolean; readonly text: string }[] {
  const what =
    c.identifier !== undefined
      ? [{ code: true, text: c.identifier }]
      : [
          { code: false, text: "literal " },
          { code: true, text: c.literal ?? "" },
        ];
  return c.in === undefined ? what : [...what, { code: false, text: " in " }, { code: true, text: c.in }];
}
