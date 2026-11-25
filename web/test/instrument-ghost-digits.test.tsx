import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Digits } from "@/components/instrument/Digits";
import { Ghost, ghostOf } from "@/components/instrument/Ghost";
import { REDUCED_MOTION_QUERY } from "@/lib/motion/reduced-motion";
import { ROLL_STAGGER_MS } from "@/lib/motion/roll-digits";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

/** A WAAPI stand-in on Element.prototype (jsdom has none), and a matchMedia that allows motion. */
function stubMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: query !== REDUCED_MOTION_QUERY, media: query })),
  );
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

describe("Ghost (components/instrument/Ghost.tsx)", () => {
  it("is an empty aria-hidden span: the 8s are generated content, never text", () => {
    const { container } = render(<Ghost pattern="88,888,888" />);
    const ghost = container.firstElementChild as HTMLElement;
    expect(ghost.tagName).toBe("SPAN");
    expect(ghost).toHaveAttribute("aria-hidden", "true");
    expect(ghost).toHaveAttribute("data-ghost", "88,888,888");
    expect(ghost.className).toBe("ghost");
    expect(ghost.textContent).toBe("");
    expect(ghost.childNodes).toHaveLength(0);
    expect(container.textContent).toBe("");
  });

  it("adds a class after its own", () => {
    const { container } = render(<Ghost pattern="88:88" className="absolute inset-0" />);
    expect((container.firstElementChild as HTMLElement).className).toBe("ghost absolute inset-0");
  });

  it("turns every digit of a sample into an 8 and keeps the separators", () => {
    expect(ghostOf("60,013,066")).toBe("88,888,888");
    expect(ghostOf("14:30:05")).toBe("88:88:88");
    expect(ghostOf("1.000537")).toBe("8.888888");
  });

  it("refuses a pattern that would show anything but unlit segments, a 0 included", () => {
    for (const bad of ["", "0", "88,888,880", "Reading", "88-88"]) {
      expect(() => render(<Ghost pattern={bad} />), JSON.stringify(bad)).toThrow(/ghost pattern/);
    }
  });

  it("is drawn from data-ghost in lcd-ghost mono, and hidden under forced-colors", () => {
    expect(css).toMatch(
      /\.ghost::before\s*\{\s*content:\s*attr\(data-ghost\);\s*color:\s*var\(--color-lcd-ghost\);\s*font-family:\s*var\(--font-mono\);\s*font-variant-numeric:\s*tabular-nums;\s*white-space:\s*pre;\s*\}/,
    );
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.ghost\s*\{\s*display:\s*none;\s*\}\s*\}/);
  });
});

describe("Digits (components/instrument/Digits.tsx)", () => {
  const cells = (root: Element) => [...root.querySelectorAll("[data-digits] > span")];

  it("writes the value as one span per character, in a digits span", () => {
    const { container } = render(<Digits value="60,013,066" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveAttribute("data-digits", "");
    expect(root.className).toBe("digits");
    expect(root.textContent).toBe("60,013,066");
    expect(cells(container).map((c) => c.textContent)).toEqual([..."60,013,066"]);
  });

  it("adds a class after its own", () => {
    const { container } = render(<Digits value="1" className="text-[38px]" />);
    expect((container.firstElementChild as HTMLElement).className).toBe("digits text-[38px]");
  });

  it("never rolls the first reading, even where motion is allowed", () => {
    const animate = stubMotion();
    render(<Digits value="60,013,066" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("rolls only the digits a new reading changed", () => {
    const animate = stubMotion();
    const { container, rerender } = render(<Digits value="60,013,066" />);
    rerender(<Digits value="60,013,071" />);
    expect(container.textContent).toBe("60,013,071");
    expect(animate.mock.contexts).toEqual([cells(container)[8], cells(container)[9]]);
    expect(animate.mock.calls.map(([, timing]) => timing.delay)).toEqual([0, ROLL_STAGGER_MS]);
  });

  it("rolls nothing on a re-render with the same reading", () => {
    const animate = stubMotion();
    const { rerender } = render(<Digits value="60,013,066" />);
    rerender(<Digits value="60,013,066" className="x" />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("writes a reading that gained a digit in full and rolls nothing", () => {
    const animate = stubMotion();
    const { container, rerender } = render(<Digits value="9,999,999" />);
    rerender(<Digits value="10,000,000" />);
    expect(container.textContent).toBe("10,000,000");
    expect(cells(container)).toHaveLength(10);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Digits value="10,000,001" />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("only writes the new reading where Element.prototype.animate is missing, as in jsdom", () => {
    expect(typeof Element.prototype.animate).toBe("undefined");
    const { container, rerender } = render(<Digits value="60,013,066" />);
    rerender(<Digits value="60,013,071" />);
    expect(container.textContent).toBe("60,013,071");
  });

  it("clips the roll to the number and keeps every cell in line", () => {
    expect(css).toMatch(
      /\.digits\s*\{\s*display:\s*inline-block;\s*clip-path:\s*inset\(0\);\s*font-family:\s*var\(--font-mono\);\s*font-variant-numeric:\s*tabular-nums;\s*white-space:\s*nowrap;\s*\}/,
    );
    expect(css).toMatch(/\.digits > span\s*\{\s*display:\s*inline-block;\s*\}/);
  });
});
