// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const css = read("app/globals.css");

describe("the 120 ms colour tick (spec 2026-11-23 section 8.3)", () => {
  it("moves nav links and pills off the snap, onto --t-tick and the instrument curve", () => {
    expect(css).toMatch(
      /\.tick-colour,\s*\.navlink,\s*\.pill-dark,\s*\.pill-line\s*\{\s*transition-property:\s*color, background-color, border-color;\s*transition-duration:\s*var\(--t-tick\);\s*transition-timing-function:\s*var\(--ease-instrument\);\s*\}/,
    );
    expect(css).toContain("--t-tick: 120ms;");
  });

  it("gives the simulator's chips the tick", () => {
    expect(read("components/Simulator.tsx")).toContain(
      "className={`tick-colour min-h-10 cursor-pointer rounded-full border px-3.5 py-2 text-[13px] font-medium ${",
    );
  });

  it("swaps the /gap-index pills' default 150 ms transition for the tick", () => {
    const tabs = read("components/gap/TokenTabs.tsx");
    expect(tabs).toContain("cursor-pointer tick-colour");
    expect(tabs).not.toContain("transition-colors");
  });
});
