import { MARK, PALETTE } from "@/brand/mark";
import type { CheckMark } from "@/content/engine";
import { FACTS } from "@/content/facts";
import type { Verdict } from "./types";

/** Where MARK.feather starts: its first point, "M9 11.5", the top of the feather. */
const FEATHER_TOP = { x: 9, y: 11.5 } as const;

/**
 * The Balance's geometry on MARK's 30-unit grid (spec 2026-11-23 section 5.1). MARK.beam splits into the fixed post and
 * base and the crossbar that tilts about the top of the post; the pans hang from the crossbar's ends.
 */
export const BALANCE = {
  post: "M15 7v15M11 22h8",
  bar: "M7 10h16",
  pivot: { x: 15, y: 10 },
  ends: { feather: { x: 7, y: 10 }, order: { x: 23, y: 10 } },
  /** The beam's angle for a refusal; an allowed trade leaves it level. Only the beam tilts (spec section 4). */
  refusedDeg: -6,
  hangerWidth: MARK.beamWidth / 3,
  tickWidth: 0.5,
} as const;

/** The nine ticks along the crossbar, one per check in order, from the feather end to the order end. */
export function tickPath(i: number): string {
  const step = (BALANCE.ends.order.x - BALANCE.ends.feather.x) / (FACTS.checksPerTrade.value - 1);
  return `M${BALANCE.ends.feather.x + step * i} 9.4v1.2`;
}

export interface BalanceProps {
  verdict: Verdict;
  /** One mark per check, in check order: PASS, FAIL or SKIP. There are always FACTS.checksPerTrade of them. */
  checks: readonly CheckMark[];
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
}

/**
 * The scale the hero weighs a trade on: MARK's post, crossbar, feather and order, with MARK's stroke and colours.
 * data-verdict keys the tilt in app/globals.css (.balance): level for allowed, -6deg for refused, and the base style is
 * that final frame, so the static HTML and reduced motion show the truth. aria-hidden: the verdict is in words elsewhere,
 * and the ticks are paths, not list items.
 */
export function Balance({ verdict, checks, size = 120, className }: BalanceProps) {
  if (checks.length !== FACTS.checksPerTrade.value) {
    throw new Error(`the Balance needs one mark per check: ${FACTS.checksPerTrade.value}, got ${checks.length}`);
  }
  const { feather, order } = BALANCE.ends;
  const box = MARK.order;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK.size} ${MARK.size}`}
      aria-hidden="true"
      focusable="false"
      data-verdict={verdict}
      className={className ? `balance ${className}` : "balance"}
    >
      <path d={BALANCE.post} fill="none" stroke={PALETTE.ink} strokeWidth={MARK.beamWidth} strokeLinecap="round" />
      <g className="balance-pan" data-pan="feather">
        <path
          d={`M${feather.x} ${feather.y}V${FEATHER_TOP.y}`}
          stroke={PALETTE.ink}
          strokeWidth={BALANCE.hangerWidth}
          strokeLinecap="round"
        />
        <path d={MARK.feather} transform={`translate(${feather.x - FEATHER_TOP.x} 0)`} fill={PALETTE.feather} />
      </g>
      <g className="balance-pan" data-pan="order">
        <path d={`M${order.x} ${order.y}V${box.y}`} stroke={PALETTE.ink} strokeWidth={BALANCE.hangerWidth} strokeLinecap="round" />
        <rect x={order.x - box.size / 2} y={box.y} width={box.size} height={box.size} rx={box.radius} fill={PALETTE.ink} />
      </g>
      <g className="balance-beam">
        <path d={BALANCE.bar} fill="none" stroke={PALETTE.ink} strokeWidth={MARK.beamWidth} strokeLinecap="round" />
        {checks.map((mark, i) => (
          <path key={i} className="balance-tick" data-tick={mark} d={tickPath(i)} strokeWidth={BALANCE.tickWidth} />
        ))}
      </g>
    </svg>
  );
}
