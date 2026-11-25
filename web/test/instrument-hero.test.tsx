import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Hero } from "@/components/sections/Hero";
import { FACTS } from "@/content/facts";
import { SITE } from "@/lib/site";

const css = readFileSync("app/globals.css", "utf8");
const hero = () => document.getElementById("top")!;
const classes = (el: Element) => el.getAttribute("class")!.split(" ");

describe("the hero (spec 2026-11-23 sections 6.1, 6.2 and 9.1)", () => {
  it("draws the tick ruler where the masked grid was", () => {
    render(<Hero />);
    const ruler = hero().querySelector(":scope > [data-ruler]");
    expect(ruler).not.toBeNull();
    expect(ruler).toHaveAttribute("aria-hidden", "true");
    expect(hero().querySelector(".grid-bg")).toBeNull();
    expect(hero().querySelector(".hero-glow")).not.toBeNull();
  });

  it("sets the H1 at clamp(44px,5.4vw,78px), line-height .96 and -0.055em, with its words unchanged", () => {
    render(<Hero />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(classes(h1)).toEqual(
      expect.arrayContaining(["text-[clamp(44px,5.4vw,78px)]", "leading-[0.96]", "tracking-[-0.055em]", "font-semibold"]),
    );
    expect(h1).toHaveTextContent("The AI agent that knows when not to trade.");
  });

  it("puts both CTAs right after the lead: 52 px and stacked on phones, 44 px in a row from sm", () => {
    render(<Hero />);
    const ctas = [...hero().querySelectorAll<HTMLAnchorElement>("[data-hero-cta]")];
    expect(ctas.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Verify it in 5 minutes", SITE.quickstartUrl],
      ["Try to make it say no", "#try"],
    ]);
    for (const a of ctas) expect(classes(a)).toEqual(expect.arrayContaining(["min-h-[52px]", "sm:min-h-11", "justify-center"]));
    const group = ctas[0]!.parentElement!;
    expect(classes(group)).toEqual(expect.arrayContaining(["flex", "flex-col", "sm:flex-row"]));
    const lead = group.previousElementSibling!;
    expect(lead.tagName).toBe("P");
    expect(lead).toHaveTextContent(SITE.description);
    expect(lead.previousElementSibling).toHaveAttribute("data-live-strip");
  });

  it("engraves the spec plate's labels and marks each figure with the fact it comes from", () => {
    render(<Hero />);
    const plate = [
      ["CHECKS PER TRADE", "checksPerTrade", String(FACTS.checksPerTrade.value)],
      ["TYPED REFUSALS", "refusalCount", String(FACTS.refusalCount.value)],
      ["RULE TIMELOCK", "timelockHours", `${FACTS.timelockHours.value}h`],
    ] as const;
    for (const [label, fact, value] of plate) {
      const dt = screen.getByText(label);
      expect(dt.tagName).toBe("DT");
      expect(classes(dt)).toEqual(expect.arrayContaining(["font-mono", "text-[11px]", "tracking-[0.12em]", "text-label"]));
      const dd = dt.nextElementSibling!;
      expect(dd.tagName).toBe("DD");
      expect(dd).toHaveAttribute("data-fact", fact);
      expect(dd.textContent).toBe(value);
    }
  });

  it("sets .h2 at clamp(32px, 3.6vw, 52px) and -0.045em, balanced", () => {
    expect(css).toMatch(
      /\.h2\s*\{\s*margin:\s*0;\s*font-size:\s*clamp\(32px, 3\.6vw, 52px\);\s*line-height:\s*1\.02;\s*letter-spacing:\s*-0\.045em;\s*font-weight:\s*600;\s*text-wrap:\s*balance;\s*\}/,
    );
  });
});
