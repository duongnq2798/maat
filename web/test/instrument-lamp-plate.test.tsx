import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LAMP_WORD, Lamp, type LampState } from "@/components/instrument/Lamp";
import { type PlateKind, SourcePlate } from "@/components/instrument/SourcePlate";
import { SMALL_TEXT, type Surface } from "@/components/instrument/types";
import { REASON_LABEL, REASONS } from "@/content/reasons";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

const STATES: readonly LampState[] = ["pass", "refuse", "skip", "reading"];
const SURFACES: readonly Surface[] = ["faceplate", "chassis"];

describe("Lamp (components/instrument/Lamp.tsx)", () => {
  it.each<[LampState, string]>([
    ["pass", "PASS"],
    ["refuse", "REFUSE"],
    ["skip", "SKIP"],
  ])("%s prints its word, %s, as its only text", (state, word) => {
    const { container } = render(<Lamp state={state} />);
    const lamp = container.firstElementChild as HTMLElement;
    expect(lamp.tagName).toBe("SPAN");
    expect(lamp).toHaveAttribute("data-lamp", state);
    expect(lamp.textContent).toBe(word);
    expect(LAMP_WORD[state]).toBe(word);
  });

  it("prints the words its caller gives in place of its own, keeping its state", () => {
    const { container } = render(<Lamp state="refuse" word="Refused" />);
    const lamp = container.firstElementChild as HTMLElement;
    expect(lamp.textContent).toBe("Refused");
    expect(lamp).toHaveAttribute("data-lamp", "refuse");
  });

  it("prints no word while reading", () => {
    const { container } = render(<Lamp state="reading" />);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild).toHaveAttribute("data-lamp", "reading");
  });

  it.each(STATES)("%s never prints a ReasonTag, a reason code or a reason label", (state) => {
    const { container } = render(<Lamp state={state} on="chassis" />);
    expect(container.querySelector("[data-reason-tag]")).toBeNull();
    const text = container.textContent ?? "";
    for (const code of REASONS) {
      expect(text.includes(code), code).toBe(false);
      expect(text.includes(REASON_LABEL[code]), REASON_LABEL[code]).toBe(false);
    }
  });

  it.each(SURFACES)("on the %s, prints its word in that surface's small-text colour", (on) => {
    const { container } = render(<Lamp state="pass" on={on} className="ml-2" />);
    const lamp = container.firstElementChild as HTMLElement;
    expect(lamp).toHaveAttribute("data-on", on);
    expect(lamp.className).toBe(`lamp inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold ${SMALL_TEXT[on]} ml-2`);
  });

  it("draws the lamp from data-lamp: lit cores, a ring for skip, the 6 px lamp-on ring, and a border under forced-colors", () => {
    expect(css).toMatch(/\.lamp\[data-lamp="pass"\]\s*\{\s*--lamp:\s*var\(--color-lamp-pass\);\s*\}/);
    expect(css).toMatch(/\.lamp\[data-lamp="refuse"\]\s*\{\s*--lamp:\s*var\(--color-lamp-refuse\);\s*\}/);
    expect(css).toMatch(/\.lamp\[data-on="chassis"\]\s*\{\s*--lamp:\s*var\(--color-lcd-ghost\);\s*\}/);
    expect(css).toMatch(/\.lamp::before\s*\{[^}]*content:\s*"";[^}]*background-color:\s*var\(--lamp\);[^}]*transition:\s*background-color var\(--t-tick\)/);
    expect(css).toMatch(/\.lamp\[data-lamp="pass"\]::before,\s*\.lamp\[data-lamp="refuse"\]::before\s*\{\s*animation:\s*lamp-on var\(--t-flip\)/);
    expect(css).toMatch(/\.lamp\[data-lamp="skip"\]::before\s*\{\s*border:\s*1px solid var\(--color-ink-3\);\s*background-color:\s*transparent;\s*\}/);
    expect(css).toMatch(/@keyframes lamp-on\s*\{\s*from\s*\{\s*box-shadow:\s*0 0 0 6px[^}]*\}\s*to\s*\{\s*box-shadow:\s*0 0 0 0 transparent;\s*\}\s*\}/);
    expect(css).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.lamp::before\s*\{\s*border:\s*1px solid CanvasText;\s*\}\s*\}/);
  });
});

describe("SourcePlate (components/instrument/SourcePlate.tsx)", () => {
  it("keeps its words in their DOM case after an aria-hidden shape, uppercase by CSS only", () => {
    const { container } = render(<SourcePlate kind="replay">replay · Base fork · block 53,551,627</SourcePlate>);
    const plate = container.firstElementChild as HTMLElement;
    expect(plate.tagName).toBe("SPAN");
    expect(plate).toHaveAttribute("data-plate", "replay");
    expect(plate.textContent).toBe("replay · Base fork · block 53,551,627");
    expect(plate.classList.contains("uppercase")).toBe(true);
    const shape = plate.firstElementChild as HTMLElement;
    expect(shape).toHaveAttribute("data-plate-shape", "");
    expect(shape).toHaveAttribute("aria-hidden", "true");
    expect(shape.textContent).toBe("");
  });

  it("passes other props, such as data-fact, through to the plate", () => {
    const { container } = render(
      <SourcePlate kind="replay" data-fact="forkBlock" on="chassis" className="mt-1">
        replay · Base fork · block 53,551,627
      </SourcePlate>,
    );
    const plate = container.firstElementChild as HTMLElement;
    expect(plate).toHaveAttribute("data-fact", "forkBlock");
    expect(plate.className).toBe("plate inline-flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase text-lcd-2 mt-1");
  });

  it.each<PlateKind>(["live", "replay", "edition", "simulated", "planned"])("draws the %s shape in app/globals.css", (kind) => {
    render(<SourcePlate kind={kind}>words</SourcePlate>);
    expect(css).toContain(`.plate[data-plate="${kind}"] > [data-plate-shape] {`);
  });

  it("engraves the words at .12em and gives each kind its shape", () => {
    expect(css).toMatch(/\.plate\s*\{\s*letter-spacing:\s*0\.12em;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="live"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*999px;\s*background:\s*currentColor;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="replay"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*999px;\s*background:\s*repeating-linear-gradient\(/);
    expect(css).toMatch(/\.plate\[data-plate="edition"\] > \[data-plate-shape\]\s*\{\s*background:\s*currentColor;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="simulated"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*2px;\s*\}/);
    expect(css).toMatch(/\.plate\[data-plate="planned"\] > \[data-plate-shape\]\s*\{\s*border-radius:\s*999px;\s*border-style:\s*dashed;\s*\}/);
  });
});
