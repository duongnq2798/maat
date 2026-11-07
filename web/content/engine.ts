import { type DecisionRow, gasLabel, getDecisions, intentLabel } from "./decisions";
import { FACTS } from "./facts";
import { dayLabel } from "./format";
import type { ReasonCode } from "./reasons";

export type MomentId = "sat" | "thu";
export type CheckMark = "PASS" | "FAIL" | "SKIP";

export interface EngineCheck {
  readonly label: string;
  readonly detail: string;
  readonly mark: CheckMark;
}

export interface EngineMoment {
  readonly id: MomentId;
  readonly toggleLabel: string;
  readonly intent: string;
  readonly when: string;
  readonly checks: readonly EngineCheck[];
  readonly allowed: boolean;
  readonly reason: ReasonCode;
  readonly outcome: string;
}

/** Spec §3.1 order. The vault stops at the first failing check, so later ones are never reached. */
export const CHECK_LABELS = [
  "Token allowed",
  "Token not paused",
  "Vault policy",
  "Market session",
  "Feed freshness",
  "Multiplier stable",
  "DEX premium",
  "Size limits",
  "Concentration",
] as const;

function run(details: readonly string[], failAt?: number): EngineCheck[] {
  return CHECK_LABELS.map((label, i): EngineCheck => {
    if (failAt === undefined || i < failAt) return { label, detail: details[i] ?? "", mark: "PASS" };
    if (i === failAt) return { label, detail: details[i] ?? "", mark: "FAIL" };
    return { label, detail: "not reached", mark: "SKIP" };
  });
}

// The engine replays two rows of the fork ledger, so the two can never disagree.
const rows = getDecisions();
function pick(match: (r: DecisionRow) => boolean, what: string): DecisionRow {
  const row = rows.find(match);
  if (!row) throw new Error(`the fork ledger has no ${what}`);
  return row;
}
function gasOf(r: DecisionRow): string {
  if (r.gasUsed === undefined) throw new Error(`no gas recorded for ${intentLabel(r)}`);
  return gasLabel(r);
}

const refused = pick((r) => !r.allowed && r.action === "BUY", "refused BUY");
const bought = pick((r) => r.allowed && r.action === "BUY", "allowed BUY");
const m = FACTS.mandate.value;
const satDay = dayLabel(FACTS.forkDay.value, FACTS.weekendOffsetDays.value);
const thuDay = dayLabel(FACTS.forkDay.value);
const time = FACTS.forkTimeEt.value;

export const MOMENTS: Readonly<Record<MomentId, EngineMoment>> = {
  sat: {
    id: "sat",
    toggleLabel: satDay,
    intent: intentLabel(refused),
    when: `${satDay} · weekend`,
    checks: run([`${refused.symbol} in mandate`, "transfers active", "authorized", "Saturday · NYSE closed"], 3),
    allowed: false,
    reason: refused.reason,
    outcome: `Decision logged · gas ${gasOf(refused)}`,
  },
  thu: {
    id: "thu",
    toggleLabel: `${thuDay} · ${time}`,
    intent: intentLabel(bought),
    when: `${thuDay} · ${time} ET`,
    checks: run([
      `${bought.symbol} in mandate`,
      "transfers active",
      "authorized",
      `${m.sessionMode} · open`,
      `${FACTS.feedAgeSec.value}s ≤ ${m.maxStalenessSec}s`,
      `no change ${m.multiplierCooldownSec / 3600}h`,
      `${FACTS.premiumsBps.value.NVDAc} ≤ ${m.maxPremiumBps} bps`,
      `$${bought.amountUsd} ≤ $${m.perTradeCapUsd} · $${m.dailyCapUsd}/day`,
      `weight ≤ ${m.maxWeightBps / 100}%`,
    ]),
    allowed: true,
    reason: bought.reason,
    outcome: `Swap executed · gas ${gasOf(bought)}`,
  },
};

export const MOMENT_ORDER: readonly MomentId[] = ["sat", "thu"];
