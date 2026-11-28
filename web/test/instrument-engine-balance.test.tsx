import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionEngine, tiltFrom } from "@/components/DecisionEngine";
import { MOMENTS } from "@/content/engine";
import { WEIGH_MS } from "@/lib/motion/spring";

const css = readFileSync("app/globals.css", "utf8");

function setup() {
  const { container } = render(<DecisionEngine />);
  return {
    container,
    status: () => screen.getByRole("status"),
    list: () => screen.getByRole("list", { name: "Mandate checks" }),
    svg: () => container.querySelector<SVGSVGElement>("svg.balance")!,
    weighing: () => container.querySelector<HTMLElement>("[data-weighing]")!,
    sat: () => screen.getByRole("button", { name: MOMENTS.sat.toggleLabel }),
    thu: () => screen.getByRole("button", { name: MOMENTS.thu.toggleLabel }),
  };
}

/** Whether `b` comes after `a` in the document. */
const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("the engine card, verdict first (spec 2026-11-23 sections 3.6 and 6.1)", () => {
  it("weighs first: the Balance, then the verdict, then the nine checks, with the Balance outside both", () => {
    const ui = setup();
    const svg = ui.svg();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("data-verdict", "refused");
    expect(follows(svg, ui.status())).toBe(true);
    expect(follows(ui.status(), ui.list())).toBe(true);
    expect(svg.closest('[role="status"]')).toBeNull();
    expect(svg.closest("ol")).toBeNull();
    const ticks = [...svg.querySelectorAll("[data-tick]")].map((t) => t.getAttribute("data-tick"));
    expect(ticks).toEqual(within(ui.list()).getAllByRole("listitem").map((li) => li.getAttribute("data-mark")));
    expect(ui.container.querySelectorAll("li")).toHaveLength(9);
    expect(ui.status().firstElementChild).toHaveAttribute("data-verdict", "refused");
  });

  it("keeps the pinned texts as HTML outside the Balance, and labels the order pan from CSS", () => {
    const ui = setup();
    const plate = ui.container.querySelector('[data-plate="replay"]')!;
    // The replay plate is the fork badge of spec 2026-11-27 section 3, with the fork block.
    expect(screen.getByText("fork · 5-7 Nov · block 53,551,627")).toBe(plate);
    expect(plate).toHaveAttribute("data-fact", "forkBlock");
    expect(screen.getByText("INTENT · SCRIPTED FORK RUN")).toBeInTheDocument();
    expect(screen.getByText(MOMENTS.sat.intent)).toBeInTheDocument();
    const label = ui.weighing().querySelector(".balance-label")!;
    expect(label).toHaveAttribute("data-label", MOMENTS.sat.intent);
    expect(label).toHaveAttribute("aria-hidden", "true");
    expect(label.textContent).toBe("");
    expect(css).toMatch(/\.balance-label::before\s*\{\s*content:\s*attr\(data-label\);\s*white-space:\s*nowrap;\s*\}/);
  });

  it("remounts the weighing on every choice and starts the beam where the last moment left it", () => {
    const ui = setup();
    const nodes = [ui.weighing()];
    const tilts = [ui.weighing().getAttribute("data-tilt-from")];
    const verdicts = [ui.svg().getAttribute("data-verdict")];
    for (const press of [ui.thu, ui.thu, ui.sat, ui.thu]) {
      fireEvent.click(press());
      nodes.push(ui.weighing());
      tilts.push(ui.weighing().getAttribute("data-tilt-from"));
      verdicts.push(ui.svg().getAttribute("data-verdict"));
    }
    expect(new Set(nodes).size).toBe(5);
    expect(tilts).toEqual(["level", "refused", "level", "level", "refused"]);
    expect(verdicts).toEqual(["refused", "allowed", "allowed", "refused", "allowed"]);
  });

  it("tilts from level on first paint and on a replay, and from the last moment's angle otherwise", () => {
    expect(tiltFrom(null, "sat")).toBe("level");
    expect(tiltFrom("sat", "sat")).toBe("level");
    expect(tiltFrom("thu", "thu")).toBe("level");
    expect(tiltFrom("sat", "thu")).toBe("refused");
    expect(tiltFrom("thu", "sat")).toBe("level");
  });

  it("holds the final frame in the static HTML: the refused beam and its ticks, with a level start", () => {
    const doc = new DOMParser().parseFromString(renderToString(<DecisionEngine />), "text/html");
    const svg = doc.querySelector("svg.balance")!;
    expect(svg.getAttribute("data-verdict")).toBe("refused");
    expect(svg.closest("[data-weighing]")!.getAttribute("data-tilt-from")).toBe("level");
    expect([...svg.querySelectorAll("[data-tick]")].map((t) => t.getAttribute("data-tick"))).toEqual(
      MOMENTS.sat.checks.map((c) => c.mark),
    );
  });

  it("ends the intro inside 2.2 s: the ticks on the rows' schedule, the beam from 620 ms on the needle spring", () => {
    const ui = setup();
    const rowDelays = within(ui.list())
      .getAllByRole("listitem")
      .map((li) => Math.round(Number.parseFloat(li.style.animationDelay) * 1000));
    const tickDelays = [...css.matchAll(/\.weighing \.balance-tick:nth-child\((\d+)\)\s*\{\s*animation-delay:\s*(\d+)ms;\s*\}/g)].map(
      ([, n, ms]) => [Number(n), Number(ms)],
    );
    expect(tickDelays).toEqual(rowDelays.map((ms, i) => [i + 2, ms]));
    expect(css).toMatch(/\.weighing \.balance-tick\s*\{\s*animation:\s*tick-lit var\(--t-tick\) var\(--ease-instrument\) both;\s*\}/);
    expect(css).toMatch(/\.weighing \.balance-beam\s*\{\s*animation:\s*beam-tip var\(--t-weigh\) var\(--ease-needle\) 620ms both;\s*\}/);
    expect(css).toMatch(
      /\.weighing \.balance-pan\[data-pan="feather"\]\s*\{\s*animation:\s*pan-feather var\(--t-weigh\) var\(--ease-needle\) 620ms both;\s*\}/,
    );
    expect(css).toMatch(
      /\.weighing \.balance-pan\[data-pan="order"\]\s*\{\s*animation:\s*pan-order var\(--t-weigh\) var\(--ease-needle\) 620ms both;\s*\}/,
    );
    expect(css).toMatch(/@keyframes beam-tip\s*\{\s*from\s*\{\s*rotate:\s*var\(--tilt-from\);\s*\}\s*\}/);
    expect(css).toMatch(/\.weighing\[data-tilt-from="refused"\]\s*\{\s*--tilt-from:\s*-6deg;\s*\}/);
    expect(css).toContain("--t-weigh: 600ms;");
    expect(css).toContain("--t-tick: 120ms;");
    const rowMs = Number(/\.anim-row\s*\{\s*animation:\s*row-in (\d+)ms /.exec(css)![1]);
    const stamp = /\.anim-stamp\s*\{\s*animation:\s*stamp (\d+)ms cubic-bezier\([^)]*\) ([\d.]+)s both;\s*\}/.exec(css)!;
    const lastRow = Math.max(...rowDelays);
    const weighing = Math.max(620 + WEIGH_MS, lastRow + 120);
    expect(weighing).toBe(1520);
    const card = Math.max(weighing, lastRow + rowMs, Number(stamp[2]) * 1000 + Number(stamp[1]));
    expect(card).toBe(2150);
    expect(card).toBeLessThanOrEqual(2200);
  });
});
