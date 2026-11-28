import { SourcePlate } from "@/components/instrument/SourcePlate";
import { DATA_BADGE, DATA_BADGE_TITLE, type DataKind, FORK_DAYS } from "@/content/badges";

/** The provenance plate each kind draws: the fork test is a replay of Base, the simulator a simulation of the vault. */
const PLATE = { fork: "replay", simulated: "simulated" } as const;

export interface DataBadgeProps {
  kind: DataKind;
  /**
   * A fork badge's first word in place of "fork", "fork value" for example, still followed by the test's days. Only for
   * a fork badge.
   */
  word?: string;
  /** Words after the badge's own, "block 53,551,627" for example, after a middle dot. */
  detail?: string;
  /** Passed to the plate, "forkBlock" for example, as Fig marks a figure with the fact it comes from. */
  fact?: string;
  className?: string;
}

/**
 * The small badge on a number from the fork test or the simulator (spec 2026-11-27, landing "explain in 10 seconds",
 * section 3): "fork · 5-7 Nov" or "simulated", as a provenance plate (components/instrument/SourcePlate.tsx) on a hairline
 * chip. data-badge carries its kind, so a test finds every badge on the page.
 */
export function DataBadge({ kind, word, detail, fact, className }: DataBadgeProps) {
  const head = kind === "fork" && word !== undefined ? `${word} · ${FORK_DAYS}` : DATA_BADGE[kind];
  const words = detail === undefined ? head : `${head} · ${detail}`;
  return (
    <SourcePlate
      kind={PLATE[kind]}
      data-badge={kind}
      data-fact={fact}
      title={DATA_BADGE_TITLE[kind]}
      className={["shrink-0 whitespace-nowrap rounded-md border border-line bg-white px-1.5 py-0.5 leading-4 tracking-[0.08em]", className]
        .filter(Boolean)
        .join(" ")}
    >
      {words}
    </SourcePlate>
  );
}
