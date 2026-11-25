import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Hero } from "@/components/sections/Hero";
import { Nav } from "@/components/sections/Nav";
import { SITE } from "@/lib/site";

describe("announcement bar", () => {
  it("says the vault is live on Base mainnet and unaudited, and names no fork run", () => {
    const { container } = render(<AnnouncementBar />);
    expect(screen.getByText("Live on Base mainnet")).toBeInTheDocument();
    expect(screen.getByText("Unaudited.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Follow the build" })).toHaveAttribute("href", "https://x.com/maatonbase");
    // The age of the last Decision shows only once a live read has landed; none runs here.
    expect(container.querySelector("[data-vault-bar]")).toBeNull();
    expect(container.textContent).not.toMatch(/fork/i);
  });
});

describe("nav", () => {
  it("links to the sections and the ledger, and opens a phone menu of the pages", () => {
    render(<Nav />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const menu = nav.querySelector<HTMLElement>("[data-phone-menu]")!;
    const outside = within(nav)
      .getAllByRole("link")
      .filter((a) => !menu.contains(a))
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(outside).toEqual([
      ["maat", "#top"],
      ["How it works", "#how"],
      ["Refusals", "#reasons"],
      ["Try it", "#try"],
      ["Ledger", "/ledger"],
      ["Mandate", "#mandate"],
      ["Docs", SITE.docsUrl],
      ["View on GitHub ↗", SITE.repoUrl],
    ]);
    expect(within(nav).getByRole("link", { name: "Maat home" })).toBeInTheDocument();
    expect(nav.querySelector("svg")).toHaveAttribute("aria-hidden", "true");

    // A <details>, so it opens without JavaScript; shown up to 720 px, where the links above are hidden.
    expect(menu.tagName).toBe("DETAILS");
    expect(menu.querySelector("summary")).toHaveTextContent("Menu");
    expect(menu.className.split(" ")).toContain("min-[721px]:hidden");
    const pages = within(menu).getByRole("list", { name: "Pages" });
    expect(within(pages).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Ledger", "/ledger"],
      ["Now", "/now"],
      ["Gap Index", "/gap-index"],
      ["Docs", SITE.docsUrl],
    ]);
  });

  it("points its section links at the landing from any other page", () => {
    render(<Nav onLanding={false} />);
    const links = within(screen.getByRole("navigation", { name: "Main" }))
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "/",
      "/#how",
      "/#reasons",
      "/#try",
      "/ledger",
      "/#mandate",
      "/ledger",
      "/now",
      "/gap-index",
      SITE.docsUrl,
      SITE.docsUrl,
      SITE.repoUrl,
    ]);
  });
});

describe("hero", () => {
  it("states the pitch, the three stats from facts, and leads to the ledger", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The AI agent that knows when not to trade.");
    expect(screen.getByText(SITE.description)).toBeInTheDocument();
    const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(stat("CHECKS PER TRADE")).toBe("9");
    expect(stat("TYPED REFUSALS")).toBe("19");
    expect(stat("RULE TIMELOCK")).toBe("24h");
    expect(screen.getByRole("link", { name: "See the vault's last decision" })).toHaveAttribute("href", "/ledger");
    expect(screen.getByRole("link", { name: "Try to make it say no" })).toHaveAttribute("href", "#try");
    expect(screen.getByRole("link", { name: "Verify it in 5 minutes" })).toHaveAttribute("href", SITE.quickstartUrl);
    // The engine card opens on the mainnet vault; the fork replay is the other tab, its moments in the hidden panel.
    expect(screen.getByRole("tab", { name: "Base mainnet" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Fork replay" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("group", { name: "Choose a moment", hidden: true })).not.toBeVisible();
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
