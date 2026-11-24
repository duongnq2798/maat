import { formatLimit, type LimitUnit } from "@/content/format";
import { SMALL_TEXT, type Surface } from "./types";

/**
 * How full a meter is, 0 to 100. The limit must be a positive finite number and the value a finite number of 0 or
 * more; a value past the limit pins the bar at 100 (the written number still says how far past).
 */
export function meterPercent(value: number, limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) throw new Error(`a meter needs a positive, finite limit: ${limit}`);
  if (!Number.isFinite(value) || value < 0) throw new Error(`a meter reads a finite value of 0 or more: ${value}`);
  return Math.min(100, (value / limit) * 100);
}

/** What a meter writes beside its bar: the reading rounded to a whole unit, then the limit, in the limit wording. */
export function meterText(value: number, limit: number, unit: LimitUnit): string {
  return `${formatLimit(Math.round(value), unit)} / ${formatLimit(limit, unit)}`;
}

export interface MeterProps {
  /** The reading, in `unit`. */
  value: number;
  /** The full scale, read from FACTS.mandate.value by the caller (spec 2026-11-23 section 3.9), never a literal. */
  limit: number;
  unit: LimitUnit;
  on?: Surface;
  className?: string;
}

/**
 * A hairline bar scaled to `limit`, with the number written beside it (spec section 4: meters mean magnitude, and the
 * number is always written). The bar is aria-hidden; the written number is the reading. data-over marks a reading past
 * its limit, and turns the fill to the refusal lamp colour.
 */
export function Meter({ value, limit, unit, on = "faceplate", className }: MeterProps) {
  const percent = meterPercent(value, limit);
  const text = meterText(value, limit, unit);
  const classes = ["meter inline-flex flex-col gap-1", className].filter(Boolean).join(" ");
  return (
    <span data-meter="" data-on={on} data-over={value > limit ? "" : undefined} className={classes}>
      <span aria-hidden="true" className="meter-track">
        <span className="meter-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className={`font-mono text-[11px] tabular-nums ${SMALL_TEXT[on]}`}>{text}</span>
    </span>
  );
}
