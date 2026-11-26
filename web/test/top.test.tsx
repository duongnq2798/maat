import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Hero } from "@/components/sections/Hero";
import { Nav } from "@/components/sections/Nav";
import { ASK_OPEN } from "@/content/ask-open";
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

/** The nav's links outside the phone menu and inside it, as [text, href]. */
function navLinks() {
  const nav = screen.getByRole("navigation", { name: "Main" });
  const menu = nav.querySelector<HTMLElement>("[data-phone-menu]")!;
  const pair = (a: HTMLElement) => [a.textContent, a.getAttribute("href")];
  const all = within(nav).getAllByRole("link");
  return { bar: all.filter((a) => !menu.contains(a)).map(pair), menu: within(menu).getAllByRole("link").map(pair), all };
}

describe("nav", () => {
  it("links to the sections and the ledger, and opens a phone menu of the pages", () => {
    render(<Nav askOpen={false} />);
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
    render(<Nav onLanding={false} askOpen={false} />);
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

  // The owner's switch, content/ask-open.ts, opens /ask; the same deploy adds Ask and Proof to the bar and the menu.
  it("adds Ask and Proof before Docs, in the bar and in the phone menu, when the owner's switch is on", () => {
    render(<Nav askOpen />);
    const { bar, menu, all } = navLinks();
    expect(bar).toEqual([
      ["maat", "#top"],
      ["How it works", "#how"],
      ["Refusals", "#reasons"],
      ["Try it", "#try"],
      ["Ledger", "/ledger"],
      ["Mandate", "#mandate"],
      ["Ask", "/ask"],
      ["Proof", "/proof"],
      ["Docs", SITE.docsUrl],
      ["GitHub ↗", SITE.repoUrl],
    ]);
    expect(menu).toEqual([
      ["Ledger", "/ledger"],
      ["Now", "/now"],
      ["Gap Index", "/gap-index"],
      ["Ask", "/ask"],
      ["Proof", "/proof"],
      ["Docs", SITE.docsUrl],
    ]);
    // In the bar they give way to the Menu up to 720 px, as the section links do. With two more links, every bar link
    // takes 10 px side padding and the pill reads GitHub, so the docked reading keeps its 340 px on the row at 1280 px
    // (e2e/instrument-nav.spec.ts).
    const navlinks = all.filter((a) => a.classList.contains("navlink") && !a.closest("[data-phone-menu]"));
    expect(navlinks.map((a) => a.textContent)).toEqual(["How it works", "Refusals", "Try it", "Ledger", "Mandate", "Ask", "Proof", "Docs"]);
    for (const a of navlinks) expect(a.className).toBe("navlink px-2.5 max-[720px]:hidden");
  });

  it("links /ask and /proof as they are from any other page, and by default follows the owner's switch", () => {
    render(<Nav onLanding={false} askOpen />);
    const hrefs = navLinks().all.map((a) => a.getAttribute("href"));
    expect(hrefs.filter((h) => h === "/ask" || h === "/proof")).toEqual(["/ask", "/proof", "/ask", "/proof"]);
    cleanup();

    for (const onLanding of [true, false]) {
      render(<Nav onLanding={onLanding} />);
      const linked = navLinks().all.some((a) => ["/ask", "/proof"].includes(a.getAttribute("href") ?? ""));
      expect(linked, `onLanding=${onLanding}`).toBe(ASK_OPEN);
      cleanup();
    }
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
