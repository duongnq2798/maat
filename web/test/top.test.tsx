import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Hero } from "@/components/sections/Hero";
import { Nav } from "@/components/sections/Nav";
import { SITE } from "@/lib/site";

describe("announcement bar", () => {
  it("says this is a fork run, verbatim", () => {
    render(<AnnouncementBar />);
    expect(screen.getByText("Tested on a Base mainnet fork")).toBeInTheDocument();
    expect(screen.getByText("Mainnet launch is next. Every decision below was recorded on that fork.")).toBeInTheDocument();
    // The short form phones see in place of the sentence above.
    expect(screen.getByText("Mainnet is next.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Follow the build" })).toHaveAttribute("href", "https://x.com/maatonbase");
  });
});

describe("nav", () => {
  it("links to the sections and the ledger", () => {
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const links = within(nav)
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["maat", "#top"],
      ["How it works", "#how"],
      ["Refusals", "#reasons"],
      ["Ledger", "#ledger"],
      ["Mandate", "#mandate"],
      ["View on GitHub ↗", SITE.repoUrl],
    ]);
    expect(within(nav).getByRole("link", { name: "Maat home" })).toBeInTheDocument();
    expect(nav.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("hero", () => {
  it("states the pitch and the three stats from facts", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The AI agent that knows when not to trade.");
    expect(screen.getByText(SITE.description)).toBeInTheDocument();
    const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(stat("CHECKS PER TRADE")).toBe("9");
    expect(stat("TYPED REFUSALS")).toBe("19");
    expect(stat("RULE TIMELOCK")).toBe("24h");
    expect(screen.getByRole("link", { name: "Verify it in 5 minutes" })).toHaveAttribute("href", SITE.evaluateUrl);
    expect(screen.getByRole("link", { name: "How it weighs a trade" })).toHaveAttribute("href", "#how");
    expect(screen.getByRole("group", { name: "Choose a moment" })).toBeInTheDocument();
    expect(document.getElementById("top")).not.toBeNull();
  });
});

describe("built on", () => {
  it("names the stack in text only", () => {
    render(<BuiltOn />);
    const region = screen.getByRole("region", { name: "Built with" });
    for (const name of ["Base", "B20 stocks", "Chainlink", "Aerodrome", "Aave V4", "Coinbase CDP", "Claude"]) {
      expect(within(region).getByText(name)).toBeInTheDocument();
    }
    expect(region.querySelectorAll("img, svg")).toHaveLength(0);
  });
});
