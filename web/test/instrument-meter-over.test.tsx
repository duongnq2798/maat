import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter, meterReading } from "@/components/instrument/Meter";
import type { LimitUnit } from "@/content/format";
import { FACTS } from "@/content/facts";

const m = FACTS.mandate.value;

/** The meter's root, its fill and its written number, for a reading against a limit from FACTS.mandate.value. */
function setup(value: number, limit: number = m.maxPremiumBps, unit: LimitUnit = "bps") {
  const { container } = render(<Meter value={value} limit={limit} unit={unit} />);
  const root = container.firstElementChild as HTMLElement;
  const [track, number] = [...root.children] as [HTMLElement, HTMLElement];
  return { root, fill: track.firstElementChild as HTMLElement, number };
}

// A Meter writes its reading floored to a whole unit, the way the contract compares it (PriceLib.premiumBps is integer
// division, and a feed's age is whole seconds), and data-over follows that written reading: the refusal colour never
// sits beside a number that reads as at the limit, and never marks a reading the contract would pass.
describe("Meter past its limit, by the floored reading it writes (components/instrument/Meter.tsx)", () => {
  it("floors a reading to a whole unit", () => {
    expect(meterReading(100)).toBe(100);
    expect(meterReading(100.4)).toBe(100);
    expect(meterReading(100.6)).toBe(100);
    expect(meterReading(100.999)).toBe(100);
    expect(meterReading(0.9)).toBe(0);
  });

  it.each([100.4, 100.6])("does not mark %s against a 100 bps limit, and writes it as 100", (value) => {
    const { root, fill, number } = setup(value);
    expect(root).not.toHaveAttribute("data-over");
    expect(fill.style.width).toBe("100%");
    expect(number.textContent).toBe("100 bps / 100 bps");
  });

  it("marks a whole unit past the limit, and writes it", () => {
    const { root, fill, number } = setup(101);
    expect(root).toHaveAttribute("data-over", "");
    expect(fill.style.width).toBe("100%");
    expect(number.textContent).toBe("101 bps / 100 bps");
  });

  it("floors seconds the same way: a fraction of a second past the staleness limit is not over", () => {
    const under = setup(m.maxStalenessSec + 0.9, m.maxStalenessSec, "s");
    expect(under.root).not.toHaveAttribute("data-over");
    expect(under.number.textContent).toBe("90,000 s (25 h) / 90,000 s (25 h)");

    const over = setup(m.maxStalenessSec + 1, m.maxStalenessSec, "s");
    expect(over.root).toHaveAttribute("data-over", "");
    expect(over.number.textContent).toBe("90,001 s / 90,000 s (25 h)");
  });
});
