import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "@/app/page";
import { REASONS } from "@/content/reasons";
import { SITE } from "@/lib/site";

function setup() {
  return render(<Page />).container;
}

describe("landing page", () => {
  it("has one h1 and never skips a heading level on the way down", () => {
    const levels = [...setup().querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    levels.forEach((l, i) => {
      if (i > 0) expect(l - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
  });

  it("every in-page link has a target", () => {
    const c = setup();
    const ids = new Set([...c.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href")!.slice(1)));
    expect([...ids].sort()).toEqual(["how", "ledger", "main", "mandate", "reasons", "top"]);
    for (const id of ids) expect(c.querySelector(`#${id}`), `#${id}`).not.toBeNull();
  });

  it("orders the sections like the comp", () => {
    const c = setup();
    const ids = [...c.querySelectorAll("#top, #how, #reasons, #ledger, #mandate")].map((el) => el.id);
    expect(ids).toEqual(["top", "how", "reasons", "ledger", "mandate"]);
  });

  it("lists all nineteen refusals once and highlights only MARKET_CLOSED", () => {
    const c = setup();
    const section = c.querySelector("#reasons") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Nineteen typed ways to say no.");
    const chips = [...section.querySelectorAll("li")].map((li) => li.textContent);
    expect([...chips].sort()).toEqual([...REASONS].sort());
    expect([...section.querySelectorAll("li[data-hot]")].map((li) => li.textContent)).toEqual(["MARKET_CLOSED"]);
  });

  it("shows the mandate sheet and its public timelock", () => {
    const c = setup();
    const section = c.querySelector("#mandate") as HTMLElement;
    expect(section.querySelectorAll("dl > div")).toHaveLength(12);
    expect(within(section).getByText("timelock 24h")).toBeInTheDocument();
    expect(within(section).getByText("mandateHash [after deploy]")).toBeInTheDocument();
    expect(within(section).getByText(/waits 24 hours/)).toBeInTheDocument();
  });

  it("explains the treasury loop with fact-backed numbers", () => {
    setup();
    expect(screen.getByText(/pay about one cent/)).toBeInTheDocument();
    expect(screen.getByText(/rebalanced past a 5% drift/)).toBeInTheDocument();
  });

  it("closes with the CTA, disclaimer and tagline verbatim", () => {
    setup();
    expect(screen.getByRole("link", { name: "Follow @maatonbase" })).toHaveAttribute("href", SITE.xUrl);
    expect(screen.getByRole("link", { name: "Open the ledger" })).toHaveAttribute("href", "#ledger");
    expect(screen.getByText(SITE.disclaimer)).toBeInTheDocument();
    expect(screen.getByText(SITE.tagline)).toBeInTheDocument();
  });

  it("never shows a made-up hash and keeps the mainnet placeholders", () => {
    const text = setup().textContent ?? "";
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40,}/);
    expect(text).toContain("[after deploy]");
    expect(text).toContain("[from mainnet tx]");
  });

  it("uses no raster images", () => {
    expect(setup().querySelectorAll("img")).toHaveLength(0);
  });
});
