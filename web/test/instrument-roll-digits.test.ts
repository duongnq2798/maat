import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion, REDUCED_MOTION_QUERY } from "@/lib/motion/reduced-motion";
import { ROLL_EASING, ROLL_KEYFRAMES, ROLL_MS, ROLL_STAGGER_MS, rollDigits } from "@/lib/motion/roll-digits";

/** One span per character, as Digits renders them. */
const cellsOf = (text: string) =>
  [...text].map((ch) => {
    const cell = document.createElement("span");
    cell.textContent = ch;
    return cell;
  });
const textOf = (cells: readonly HTMLElement[]) => cells.map((c) => c.textContent).join("");

/** A matchMedia that answers `reduce` for the reduced-motion query. */
function stubMotion(reduce: boolean) {
  const matchMedia = vi.fn((query: string) => ({ matches: query === REDUCED_MOTION_QUERY && reduce, media: query }));
  vi.stubGlobal("matchMedia", matchMedia);
  return matchMedia;
}

/** A WAAPI stand-in on Element.prototype: jsdom has none. */
function stubAnimate() {
  // The parameters are Element.animate's, so the test can read the keyframes and timing each call was given.
  const animate = vi.fn(function (this: Element, _keyframes: Keyframe[], _timing: KeyframeAnimationOptions) {
    return { target: this } as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: animate });
  return animate;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe("prefersReducedMotion (lib/motion/reduced-motion.ts)", () => {
  it("is true where window.matchMedia is missing, as in jsdom", () => {
    expect(typeof window.matchMedia).toBe("undefined");
    expect(prefersReducedMotion()).toBe(true);
  });

  it("asks the reduced-motion query and returns its answer", () => {
    const matchMedia = stubMotion(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    stubMotion(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe("rollDigits (lib/motion/roll-digits.ts)", () => {
  it("only writes the text where Element.prototype.animate is missing, as in jsdom", () => {
    stubMotion(false);
    expect(typeof Element.prototype.animate).toBe("undefined");
    const cells = cellsOf("60,013,066");
    expect(rollDigits(cells, "60,013,066", "60,013,071")).toEqual([]);
    expect(textOf(cells)).toBe("60,013,071");
  });

  it("rolls only the changed characters, 240 ms each, 30 ms apart, in cell order", () => {
    stubMotion(false);
    const animate = stubAnimate();
    const cells = cellsOf("60,013,066");
    const started = rollDigits(cells, "60,013,066", "60,013,071");
    expect(textOf(cells)).toBe("60,013,071");
    expect(started).toHaveLength(2);
    expect(animate.mock.contexts).toEqual([cells[8], cells[9]]);
    expect(animate.mock.calls.map(([, timing]) => timing)).toEqual([
      { duration: ROLL_MS, delay: 0, easing: ROLL_EASING, fill: "backwards" },
      { duration: ROLL_MS, delay: ROLL_STAGGER_MS, easing: ROLL_EASING, fill: "backwards" },
    ]);
    expect(animate.mock.calls[0]?.[0]).toEqual(ROLL_KEYFRAMES);
  });

  it("rolls the cells React has already written: it compares with `from`, not with the cells", () => {
    stubMotion(false);
    const animate = stubAnimate();
    const cells = cellsOf("60,013,071");
    expect(rollDigits(cells, "60,013,066", "60,013,071")).toHaveLength(2);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("writes the text and rolls nothing under reduced motion", () => {
    stubMotion(true);
    const animate = stubAnimate();
    const cells = cellsOf("60,013,066");
    expect(rollDigits(cells, "60,013,066", "60,013,071")).toEqual([]);
    expect(textOf(cells)).toBe("60,013,071");
    expect(animate).not.toHaveBeenCalled();
  });

  it("rolls nothing when the reading is unchanged", () => {
    stubMotion(false);
    const animate = stubAnimate();
    expect(rollDigits(cellsOf("60,013,066"), "60,013,066", "60,013,066")).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
  });

  it("writes but never rolls a reading that changed length, and leaves cells of the old length alone", () => {
    stubMotion(false);
    const animate = stubAnimate();
    const grown = cellsOf("10,000,000");
    expect(rollDigits(grown, "9,999,999", "10,000,000")).toEqual([]);
    expect(textOf(grown)).toBe("10,000,000");
    const old = cellsOf("9,999,999");
    expect(rollDigits(old, "9,999,999", "10,000,000")).toEqual([]);
    expect(textOf(old)).toBe("9,999,999");
    expect(animate).not.toHaveBeenCalled();
  });
});
