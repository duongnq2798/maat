import { DOCS_FACTS } from "../../content/docs-facts";
import { FACTS } from "../../content/facts";
import { clockLabel, formatInt } from "../../content/format";

/** Every number the docs may cite: the landing page's FACTS plus the docs-only DOCS_FACTS. */
export const ALL_FACTS = { ...FACTS, ...DOCS_FACTS };
const F = ALL_FACTS;

type FactKey = keyof typeof ALL_FACTS;

interface FactText {
  /** What the page shows, units included. */
  readonly text: string;
  /** The ALL_FACTS entry it comes from; its `source` is the tooltip and the default-parameters citation. */
  readonly from: FactKey;
}

const t = (text: string, from: FactKey): FactText => ({ text, from });
const usd = (n: number) => `$${n < 1 ? n.toFixed(2) : formatInt(n)}`;
const bps = (n: number) => `${formatInt(n)} bps`;
const m = F.mandate.value;
const gas = F.gas.value;
const prem = F.premiumsBps.value;

/**
 * Every value a docs page may show with <Fact name="…" />, as text. A dotted name reads one field of a
 * structured fact. Adding a number to the docs means adding it here, and to DOCS_FACTS
 * (content/docs-facts.ts) with a parity test in test/docs-facts.test.ts.
 */
export const FACT_TEXT = {
  checksPerTrade: t(String(F.checksPerTrade.value), "checksPerTrade"),
  refusalCount: t(String(F.refusalCount.value), "refusalCount"),
  timelockHours: t(`${F.timelockHours.value} hours`, "timelockHours"),
  gracePeriodDays: t(`${F.gracePeriodDays.value} days`, "gracePeriodDays"),
  forkBlock: t(formatInt(F.forkBlock.value), "forkBlock"),
  forkDay: t(F.forkDay.value, "forkDay"),
  forkTimeEt: t(`${F.forkTimeEt.value} ET`, "forkTimeEt"),
  weekendOffsetDays: t(String(F.weekendOffsetDays.value), "weekendOffsetDays"),
  feedAgeSec: t(`${F.feedAgeSec.value} s`, "feedAgeSec"),
  nvdaUiMultiplier: t(F.nvdaUiMultiplier.value, "nvdaUiMultiplier"),
  "premiumsBps.NVDAc": t(bps(prem.NVDAc), "premiumsBps"),
  "premiumsBps.GOOGLc": t(bps(prem.GOOGLc), "premiumsBps"),
  "premiumsBps.AAPLc": t(bps(prem.AAPLc), "premiumsBps"),
  "mandate.sessionMode": t(m.sessionMode, "mandate"),
  "mandate.maxStalenessSec": t(`${formatInt(m.maxStalenessSec)} s`, "mandate"),
  "mandate.maxPremiumBps": t(bps(m.maxPremiumBps), "mandate"),
  "mandate.maxSlippageBps": t(bps(m.maxSlippageBps), "mandate"),
  "mandate.twapWindowSec": t(`${formatInt(m.twapWindowSec)} s`, "mandate"),
  "mandate.multiplierCooldownSec": t(`${m.multiplierCooldownSec / 3600} hours`, "mandate"),
  "mandate.perTradeCapUsd": t(usd(m.perTradeCapUsd), "mandate"),
  "mandate.dailyCapUsd": t(usd(m.dailyCapUsd), "mandate"),
  "mandate.maxWeightBps": t(bps(m.maxWeightBps), "mandate"),
  "mandate.minHealthFactor": t(m.minHealthFactor.toFixed(1), "mandate"),
  "mandate.targetHealthFactor": t(m.targetHealthFactor.toFixed(1), "mandate"),
  "mandate.deriskWindowSec": t(`${m.deriskWindowSec / 3600} hours`, "mandate"),
  maxDeriskWindowHours: t(`${F.maxDeriskWindowHours.value} hours`, "maxDeriskWindowHours"),
  "gas.buy": t(formatInt(gas.buy), "gas"),
  "gas.supply": t(formatInt(gas.supply), "gas"),
  "gas.borrow": t(formatInt(gas.borrow), "gas"),
  "gas.refusalLog": t(formatInt(gas.refusalLog), "gas"),
  nyseOpen: t(`${clockLabel(F.nyseSessionMin.value.open)} ET`, "nyseSessionMin"),
  nyseClose: t(`${clockLabel(F.nyseSessionMin.value.close)} ET`, "nyseSessionMin"),
  feedEdge: t(`${clockLabel(F.feedEdgeMin.value)} ET`, "feedEdgeMin"),
  earlyClose: t(`${clockLabel(F.earlyCloseMin.value)} ET`, "earlyCloseMin"),
  "etOffsetHours.dst": t(`${F.etOffsetHours.value.dst} hours`, "etOffsetHours"),
  "etOffsetHours.standard": t(`${F.etOffsetHours.value.standard} hours`, "etOffsetHours"),
  priceDecimals: t(`${F.priceDecimals.value} decimals`, "priceDecimals"),
  usdcDecimals: t(`${F.usdcDecimals.value} decimals`, "usdcDecimals"),
  maxTokenDecimals: t(`${F.maxTokenDecimals.value} decimals`, "maxTokenDecimals"),
  healthFactorBound: t(F.healthFactorBound.value.toFixed(1), "healthFactorBound"),
  "calendarPreload.holidays": t(String(F.calendarPreload.value.holidays), "calendarPreload"),
  "calendarPreload.earlyCloses": t(String(F.calendarPreload.value.earlyCloses), "calendarPreload"),
  loopMinutes: t(`${F.loopMinutes.value} minutes`, "loopMinutes"),
  offSessionMinutes: t(`${F.offSessionMinutes.value} minutes`, "offSessionMinutes"),
  rebalanceDriftPct: t(`${F.rebalanceDriftPct.value} percentage points`, "rebalanceDriftPct"),
  targetWeightPct: t(`${F.targetWeightPct.value}%`, "targetWeightPct"),
  pendingWindowMinutes: t(`${F.pendingWindowMinutes.value} minutes`, "pendingWindowMinutes"),
  executorGasEth: t(`about ${F.executorGasEth.value} ETH`, "executorGasEth"),
  cashReservePct: t(`${F.cashReservePct.value}%`, "cashReservePct"),
  runwayDays: t(`${F.runwayDays.value} days`, "runwayDays"),
  billMinUsd: t(usd(F.billMinUsd.value), "billMinUsd"),
  minTradeUsd: t(usd(F.minTradeUsd.value), "minTradeUsd"),
  maxTxPerDay: t(String(F.maxTxPerDay.value), "maxTxPerDay"),
  dailyComputeUsd: t(usd(F.dailyComputeUsd.value), "dailyComputeUsd"),
  maxIntents: t(String(F.maxIntents.value), "maxIntents"),
  maxRationaleChars: t(String(F.maxRationaleChars.value), "maxRationaleChars"),
  maxGas: t(formatInt(F.maxGas.value), "maxGas"),
  executeGasFloor: t(formatInt(F.executeGasFloor.value), "executeGasFloor"),
  treasuryUsd: t(`${usd(F.treasuryUsd.value.min)} to ${usd(F.treasuryUsd.value.max)}`, "treasuryUsd"),
  x402Price: t(F.x402Price.value, "x402Price"),
  solidityVersion: t(F.solidityVersion.value, "solidityVersion"),
  addressesVerifiedOn: t(F.addressesVerifiedOn.value, "addressesVerifiedOn"),
  amzncPoolLiquidityUsd: t(`about ${usd(F.amzncPoolLiquidityUsd.value)}`, "amzncPoolLiquidityUsd"),
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
