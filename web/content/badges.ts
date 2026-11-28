import { FACTS } from "./facts";
import { dayLabel } from "./format";

/**
 * "5-7 Nov": the days of the fork test, from its fork block's day (Thu 5 Nov) to the day of its weekend BUY, which the
 * test reaches by moving its clock (content/facts.ts forkDay and weekendOffsetDays).
 */
function forkDays(): string {
  const [, firstDay, firstMonth] = dayLabel(FACTS.forkDay.value).split(" ");
  const [, lastDay, lastMonth] = dayLabel(FACTS.forkDay.value, FACTS.weekendOffsetDays.value).split(" ");
  return firstMonth === lastMonth ? `${firstDay}-${lastDay} ${firstMonth}` : `${firstDay} ${firstMonth}-${lastDay} ${lastMonth}`;
}

/** The days of the fork test, "5-7 Nov", as every fork badge writes them. */
export const FORK_DAYS = forkDays();

/**
 * The words of the landing's data badges (spec 2026-11-27, landing "explain in 10 seconds", section 3): every number
 * from the fork test before mainnet, or from the in-browser simulator, carries one, so no reader takes it for a reading
 * of the vault on Base mainnet. CSS sets them in capitals; the DOM keeps this case.
 */
export const DATA_BADGE = {
  fork: `fork · ${FORK_DAYS}`,
  simulated: "simulated",
} as const;

export type DataKind = keyof typeof DATA_BADGE;

/** What a badge means, for its title: a pointer hovering it reads the long form. */
export const DATA_BADGE_TITLE: Readonly<Record<DataKind, string>> = {
  fork: `From the fork test of ${FORK_DAYS}, on a copy of Base mainnet, before the vault went live`,
  simulated: "Computed in your browser by the simulator, not read from the vault",
};
