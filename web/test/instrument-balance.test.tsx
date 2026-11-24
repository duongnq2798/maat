import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MARK, PALETTE } from "@/brand/mark";
import { BALANCE, Balance, tickPath } from "@/components/instrument/Balance";
import type { Verdict } from "@/components/instrument/types";
import { type CheckMark, MOMENTS } from "@/content/engine";
import { FACTS } from "@/content/facts";

// Read from web/, where vitest runs: under jsdom, import.meta.url is not a file URL.
const css = readFileSync("app/globals.css", "utf8");

const SAT = MOMENTS.sat.checks.map((c) => c.mark);
const THU = MOMENTS.thu.checks.map((c) => c.mark);

function setup(verdict: Verdict, checks: readonly CheckMark[] = SAT) {
  const { container } = render(<Balance verdict={verdict} checks={checks} />);
  const svg = container.querySelector("svg") as SVGSVGElement;
  return { container, svg };
}

describe("Balance geometry (components/instrument/Balance.tsx)", () => {
  it("splits MARK.beam into the fixed post and base and the tilting crossbar, and nothing else", () => {
    expect(BALANCE.post).toBe("M15 7v15M11 22h8");
    expect(BALANCE.bar).toBe("M7 10h16");
    expect(`${BALANCE.post}${BALANCE.bar}`).toBe(MARK.beam);
  });

  it("pivots on the top of the post and hangs the pans from the crossbar's ends, 8 units either side", () => {
    expect(BALANCE.pivot).toEqual({ x: 15, y: 10 });
    expect(BALANCE.ends).toEqual({ feather: { x: 7, y: 10 }, order: { x: 23, y: 10 } });
    expect(BALANCE.pivot.x - BALANCE.ends.feather.x).toBe(8);
    expect(BALANCE.ends.order.x - BALANCE.pivot.x).toBe(8);
    expect(BALANCE.refusedDeg).toBe(-6);
  });

  it("puts one tick per check along the crossbar, from end to end", () => {
    const ticks = Array.from({ length: FACTS.checksPerTrade.value }, (_, i) => tickPath(i));
    expect(ticks).toEqual([7, 9, 11, 13, 15, 17, 19, 21, 23].map((x) => `M${x} 9.4v1.2`));
  });
});

describe("Balance (components/instrument/Balance.tsx)", () => {
  it("is one aria-hidden, unfocusable svg on MARK's 30-unit grid, 120 px by default", () => {
    const { container, svg } = setup("refused");
    expect(container.children).toHaveLength(1);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", "0 0 30 30");
    expect(svg).toHaveAttribute("width", "120");
    expect(svg).toHaveAttribute("height", "120");
    expect(svg.getAttribute("class")).toBe("balance");
    expect(container.textContent).toBe("");
  });

  it.each<Verdict>(["allowed", "refused"])("carries data-verdict=%s for the CSS tilt", (verdict) => {
    expect(setup(verdict).svg).toHaveAttribute("data-verdict", verdict);
  });

  it("draws the post, the feather pan, the order pan, then the beam, in that order", () => {
    const { svg } = setup("refused");
    const layers = [...svg.children];
    expect(layers.map((el) => el.getAttribute("class") ?? el.tagName.toLowerCase())).toEqual([
      "path",
      "balance-pan",
      "balance-pan",
      "balance-beam",
    ]);
    const post = layers[0]!;
    expect(post.getAttribute("d")).toBe(BALANCE.post);
    expect(post.getAttribute("stroke")).toBe(PALETTE.ink);
    expect(post.getAttribute("stroke-width")).toBe(String(MARK.beamWidth));
    expect(post.getAttribute("stroke-linecap")).toBe("round");
  });

  it("hangs MARK.feather from the feather end, centred under it, in the feather colour", () => {
    const pan = setup("allowed").svg.querySelector('[data-pan="feather"]') as SVGGElement;
    const [hanger, feather] = [...pan.children];
    expect(hanger?.getAttribute("d")).toBe("M7 10V11.5");
    expect(hanger?.getAttribute("stroke-width")).toBe(String(MARK.beamWidth / 3));
    expect(feather?.getAttribute("d")).toBe(MARK.feather);
    expect(feather?.getAttribute("transform")).toBe("translate(-2 0)");
    expect(feather?.getAttribute("fill")).toBe(PALETTE.feather);
  });

  it("hangs MARK.order from the order end, centred under it, in ink", () => {
    const pan = setup("allowed").svg.querySelector('[data-pan="order"]') as SVGGElement;
    const [hanger, box] = [...pan.children];
    expect(hanger?.getAttribute("d")).toBe("M23 10V12.5");
    expect(box?.tagName.toLowerCase()).toBe("rect");
    expect([box?.getAttribute("x"), box?.getAttribute("y"), box?.getAttribute("width"), box?.getAttribute("height")]).toEqual([
      "20.5",
      String(MARK.order.y),
      String(MARK.order.size),
      String(MARK.order.size),
    ]);
    expect(box?.getAttribute("rx")).toBe(String(MARK.order.radius));
    expect(box?.getAttribute("fill")).toBe(PALETTE.ink);
  });

  it("puts the crossbar and its nine ticks in the beam, each tick marked with its check, and no list items", () => {
    const { svg } = setup("refused", THU);
    const beam = svg.querySelector(".balance-beam") as SVGGElement;
    expect(beam.firstElementChild?.getAttribute("d")).toBe(BALANCE.bar);
    const ticks = [...beam.querySelectorAll(".balance-tick")];
    expect(ticks).toHaveLength(FACTS.checksPerTrade.value);
    expect(ticks.map((t) => t.getAttribute("data-tick"))).toEqual(THU);
    expect(ticks.map((t) => t.getAttribute("d"))).toEqual(THU.map((_, i) => tickPath(i)));
    expect(svg.querySelector("li")).toBeNull();
  });

  it("refuses a list of marks that is not one per check", () => {
    expect(() => render(<Balance verdict="allowed" checks={SAT.slice(1)} />)).toThrow(/one mark per check: 9, got 8/);
    expect(() => render(<Balance verdict="allowed" checks={[...SAT, "SKIP"]} />)).toThrow(/one mark per check/);
  });

  it("takes a size and a class", () => {
    const { container } = render(<Balance verdict="allowed" checks={SAT} size={96} className="shrink-0" />);
    const svg = container.querySelector("svg") as SVGSVGElement;
    expect(svg).toHaveAttribute("width", "96");
    expect(svg.getAttribute("class")).toBe("balance shrink-0");
  });
});

describe("Balance tilt (app/globals.css)", () => {
  /** The declarations of one rule, by its exact selector. */
  const rule = (selector: string) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
    if (!m) throw new Error(`no rule ${selector}`);
    return m[1]!.replace(/\s+/g, " ").trim();
  };

  it("is level in the base style and -6deg only when refused: the base style is the final frame", () => {
    expect(rule(".balance")).toBe("--tilt: 0deg;");
    expect(rule('.balance[data-verdict="refused"]')).toBe(`--tilt: ${BALANCE.refusedDeg}deg;`);
  });

  it("turns only the beam, about the pivot, over --t-weigh on the needle curve", () => {
    expect(rule(".balance-beam")).toBe(
      `transform-box: view-box; transform-origin: ${BALANCE.pivot.x}px ${BALANCE.pivot.y}px; rotate: var(--tilt); transition: rotate var(--t-weigh) var(--ease-needle);`,
    );
  });

  it("moves each pan with its end of the beam, 8 units out, without turning it", () => {
    expect(rule(".balance-pan")).toBe("transition: translate var(--t-weigh) var(--ease-needle);");
    expect(rule('.balance-pan[data-pan="feather"]')).toBe(
      "translate: calc(8px * (1 - cos(var(--tilt)))) calc(-8px * sin(var(--tilt)));",
    );
    expect(rule('.balance-pan[data-pan="order"]')).toBe(
      "translate: calc(-8px * (1 - cos(var(--tilt)))) calc(8px * sin(var(--tilt)));",
    );
    expect(css).not.toMatch(/\.balance-pan[^{]*\{[^}]*\brotate\s*:/);
  });

  it("keeps each pan on its end of the beam at -6deg: the translation is the end's own movement", () => {
    const t = (BALANCE.refusedDeg * Math.PI) / 180;
    const r = BALANCE.pivot.x - BALANCE.ends.feather.x;
    // The feather end at -6deg, turned about the pivot (y grows downwards, so a negative angle lifts the right end).
    const featherEnd = { x: BALANCE.pivot.x - r * Math.cos(t), y: BALANCE.pivot.y - r * Math.sin(t) };
    expect(featherEnd.x - BALANCE.ends.feather.x).toBeCloseTo(r * (1 - Math.cos(t)), 12);
    expect(featherEnd.y - BALANCE.ends.feather.y).toBeCloseTo(-r * Math.sin(t), 12);
    expect(featherEnd.y).toBeGreaterThan(BALANCE.ends.feather.y);
  });

  it("colours the ticks by their check", () => {
    expect(rule(".balance-tick")).toBe("stroke: var(--color-tick); stroke-linecap: butt;");
    expect(rule('.balance-tick[data-tick="PASS"]')).toBe("stroke: var(--color-lamp-pass);");
    expect(rule('.balance-tick[data-tick="FAIL"]')).toBe("stroke: var(--color-lamp-refuse);");
  });
});
