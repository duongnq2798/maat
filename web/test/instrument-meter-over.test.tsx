import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Meter } from "@/components/instrument/Meter";
import { FACTS } from "@/content/facts";

const m = FACTS.mandate.value;

/** The meter's root, its fill and its written number, for a premium reading against FACTS.mandate.value. */
function setup(value: number) {
  const { container } = render(<Meter value={value} limit={m.maxPremiumBps} unit="bps" />);
  const root = container.firstElementChild as HTMLElement;
  const [track, number] = [...root.children] as [HTMLElement, HTMLElement];
  return { root, fill: track.firstElementChild as HTMLElement, number };
}

// A Meter writes its reading rounded to a whole unit, so data-over follows that written reading: the refusal colour
// never sits beside a number that reads as at the limit.
describe("Meter past its limit, by the reading it writes (components/instrument/Meter.tsx)", () => {
  it("does not mark a fractional reading that rounds to the limit", () => {
    const { root, fill, number } = setup(100.4);
    expect(root).not.toHaveAttribute("data-over");
    expect(fill.style.width).toBe("100%");
    expect(number.textContent).toBe("100 bps / 100 bps");
  });

  it("marks a fractional reading that rounds past the limit, and writes it", () => {
    const { root, fill, number } = setup(100.6);
    expect(root).toHaveAttribute("data-over", "");
    expect(fill.style.width).toBe("100%");
    expect(number.textContent).toBe("101 bps / 100 bps");
  });
});
