import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Meter, meterPercent, meterText } from "@/components/instrument/Meter";
import { RULER, Ruler } from "@/components/instrument/Ruler";
import { FACTS } from "@/content/facts";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");
const m = FACTS.mandate.value;

/** The meter's parts: the root, the aria-hidden track, its fill, and the written number. */
function setup(ui: ReactElement) {
  const { container } = render(ui);
  const root = container.firstElementChild as HTMLElement;
  const [track, number] = [...root.children] as [HTMLElement, HTMLElement];
  return { root, track, fill: track.firstElementChild as HTMLElement, number };
}

describe("meterPercent and meterText (components/instrument/Meter.tsx)", () => {
  it("scales a reading to its limit, 0 to 100", () => {
    expect(meterPercent(0, 100)).toBe(0);
    expect(meterPercent(53, 100)).toBe(53);
    expect(meterPercent(100, 100)).toBe(100);
    expect(meterPercent(45_000, m.maxStalenessSec)).toBe(50);
  });

  it("pins a reading past its limit at 100", () => {
    expect(meterPercent(101, 100)).toBe(100);
    expect(meterPercent(1e12, 100)).toBe(100);
  });

  it("refuses a limit that is not positive and finite", () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => meterPercent(1, bad), String(bad)).toThrow(/positive, finite limit/);
    }
  });

  it("refuses a reading that is negative or not finite", () => {
    for (const bad of [-0.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => meterPercent(bad, 100), String(bad)).toThrow(/finite value of 0 or more/);
    }
  });

  it("writes the reading, floored, over the limit, in the limit wording", () => {
    expect(meterText(53, m.maxPremiumBps, "bps")).toBe("53 bps / 100 bps");
    expect(meterText(52.6, m.maxPremiumBps, "bps")).toBe("52 bps / 100 bps");
    expect(meterText(14, m.maxStalenessSec, "s")).toBe("14 s / 90,000 s (25 h)");
  });

  it("refuses a limit that is not a whole number, through formatLimit", () => {
    expect(() => meterText(1, 1.5, "bps")).toThrow(/whole number/);
  });
});

describe("Meter (components/instrument/Meter.tsx)", () => {
  it("reads its full scale from the limit prop, fed by FACTS", () => {
    const { root, fill, number } = setup(<Meter value={53} limit={m.maxPremiumBps} unit="bps" />);
    expect(root).toHaveAttribute("data-meter", "");
    expect(root).not.toHaveAttribute("data-over");
    expect(fill.style.width).toBe("53%");
    expect(number.textContent).toBe("53 bps / 100 bps");
  });

  it("moves its full scale with the limit: the same reading on another limit fills another share", () => {
    const { fill, number } = setup(<Meter value={53} limit={m.maxSlippageBps} unit="bps" />);
    expect(fill.style.width).toBe(`${(53 / 150) * 100}%`);
    expect(number.textContent).toBe("53 bps / 150 bps");
  });

  it("marks a reading past its limit, pins the bar, and still writes the reading", () => {
    const { root, fill, number } = setup(<Meter value={108_000} limit={m.maxStalenessSec} unit="s" />);
    expect(root).toHaveAttribute("data-over", "");
    expect(fill.style.width).toBe("100%");
    expect(number.textContent).toBe("108,000 s (30 h) / 90,000 s (25 h)");
  });

  it("hides the bar from assistive tech; the written number is the reading", () => {
    const { track, number } = setup(<Meter value={0} limit={m.maxPremiumBps} unit="bps" />);
    expect(track).toHaveAttribute("aria-hidden", "true");
    expect(track.textContent).toBe("");
    expect(number).not.toHaveAttribute("aria-hidden");
    expect(number.textContent).toBe("0 bps / 100 bps");
  });

  it.each([
    ["faceplate", "text-label"],
    ["chassis", "text-lcd-2"],
  ] as const)("on the %s, writes its number in %s", (on, colour) => {
    const { root, number } = setup(<Meter value={1} limit={m.maxPremiumBps} unit="bps" on={on} className="w-40" />);
    expect(root).toHaveAttribute("data-on", on);
    expect(root.className).toBe("meter inline-flex flex-col gap-1 w-40");
    expect(number.className).toBe(`font-mono text-[11px] tabular-nums ${colour}`);
  });

  it("refuses to render a bad limit or a bad reading rather than draw a wrong bar", () => {
    expect(() => render(<Meter value={1} limit={0} unit="bps" />)).toThrow(/positive, finite limit/);
    expect(() => render(<Meter value={Number.NaN} limit={100} unit="bps" />)).toThrow(/finite value/);
  });

  it("draws a hairline track, a pass fill, and a refuse fill past the limit", () => {
    expect(css).toMatch(/\.meter-track\s*\{\s*display:\s*block;\s*height:\s*2px;\s*background:\s*var\(--color-line\);\s*\}/);
    expect(css).toMatch(/\.meter\[data-on="chassis"\] \.meter-track\s*\{\s*background:\s*var\(--color-chassis-line\);\s*\}/);
    expect(css).toMatch(/\.meter-fill\s*\{\s*display:\s*block;\s*height:\s*100%;\s*background:\s*var\(--color-lamp-pass\);\s*\}/);
    expect(css).toMatch(/\.meter\[data-over\] \.meter-fill\s*\{\s*background:\s*var\(--color-lamp-refuse\);\s*\}/);
  });
});

describe("Ruler (components/instrument/Ruler.tsx)", () => {
  it("is an empty aria-hidden div", () => {
    const { container } = render(<Ruler className="mt-8" />);
    const ruler = container.firstElementChild as HTMLElement;
    expect(ruler.tagName).toBe("DIV");
    expect(ruler).toHaveAttribute("aria-hidden", "true");
    expect(ruler).toHaveAttribute("data-ruler", "");
    expect(ruler.className).toBe("ruler mt-8");
    expect(ruler.childNodes).toHaveLength(0);
  });

  it("draws a minor tick every 8 px and a major one every 56 px, 12 px tall", () => {
    expect(RULER).toEqual({ minorPx: 8, majorPx: 56, heightPx: 12 });
    const block = /\.ruler\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain(`height: ${RULER.heightPx}px;`);
    expect(block).toContain(`repeating-linear-gradient(to right, var(--color-tick) 0 1px, transparent 1px ${RULER.majorPx}px)`);
    expect(block).toContain(`repeating-linear-gradient(to right, var(--color-tick) 0 1px, transparent 1px ${RULER.minorPx}px)`);
    expect(block).toContain(`background-size: 100% ${RULER.heightPx}px, 100% ${RULER.heightPx / 2}px;`);
  });
});
