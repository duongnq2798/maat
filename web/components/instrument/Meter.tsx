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

/**
 * The whole-unit reading a meter writes and judges: the value floored, the way the contract reads it. PriceLib.premiumBps
 * is integer division and a feed's age is whole seconds, so 100.6 bps passes a 100 bps limit and 90,000.9 s a 90,000 s one.
 */
export function meterReading(value: number): number {
  return Math.floor(value);
}

/** What a meter writes beside its bar: the reading floored to a whole unit, then the limit, in the limit wording. */
export function meterText(value: number, limit: number, unit: LimitUnit): string {
  return `${formatLimit(meterReading(value), unit)} / ${formatLimit(limit, unit)}`;
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
 * its limit, and turns the fill to the refusal lamp colour. It compares the reading as meterText writes it, floored to a
 * whole unit as the contract compares it, so the refusal colour never sits beside a number that reads as at the limit.
 */
export function Meter({ value, limit, unit, on = "faceplate", className }: MeterProps) {
  const percent = meterPercent(value, limit);
  const text = meterText(value, limit, unit);
  const reading = meterReading(value);
  const classes = ["meter inline-flex flex-col gap-1", className].filter(Boolean).join(" ");
  return (
    <span data-meter="" data-on={on} data-over={reading > limit ? "" : undefined} className={classes}>
      <span aria-hidden="true" className="meter-track">
        <span className="meter-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className={`font-mono text-[11px] tabular-nums ${SMALL_TEXT[on]}`}>{text}</span>
    </span>
  );
}
