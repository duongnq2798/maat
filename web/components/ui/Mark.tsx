import { MARK, PALETTE } from "@/brand/mark";

export function Mark({ size = 30 }: { size?: number }) {
  const o = MARK.order;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${MARK.size} ${MARK.size}`} aria-hidden="true" focusable="false">
      <rect width={MARK.size} height={MARK.size} rx={MARK.radius} fill={PALETTE.ink} />
      <path d={MARK.beam} fill="none" stroke={PALETTE.paper} strokeWidth={MARK.beamWidth} strokeLinecap="round" />
      <path d={MARK.feather} fill={PALETTE.feather} />
      <rect x={o.x} y={o.y} width={o.size} height={o.size} rx={o.radius} fill={PALETTE.paper} />
    </svg>
  );
}
