import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Hero } from "@/components/sections/Hero";
import { Nav } from "@/components/sections/Nav";
import { ASK_OPEN } from "@/content/ask-open";
import { HERO_DEFINITION, HERO_STEPS } from "@/content/hero";
import { SITE } from "@/lib/site";

describe("announcement bar", () => {
  it("says the vault is live on Base mainnet, unaudited and small on purpose, and names no fork run", () => {
    const { container } = render(<AnnouncementBar />);
    expect(screen.getByText("Live on Base mainnet")).toBeInTheDocument();
    // Spec 2026-11-27 section 4: a small treasury reads as a choice, not as a dormant project.
    expect(screen.getByText("Unaudited · small treasury on purpose")).toBeInTheDocument();
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

// Pages first (spec 2026-11-23 section 2, decision 3): the bar and the phone menu list the same pages, and the landing's
// section links are not in the nav.
const PAGES = [
  ["Now", "/now"],
  ["Gap Index", "/gap-index"],
  ["Ledger", "/ledger"],
  ["Docs", SITE.docsUrl],
];
const ASK_PAGES = [
  ["Ask", "/ask"],
  ["Proof", "/proof"],
];

describe("nav", () => {
  it("puts the pages first, the same in the bar and in the phone menu, and links no section of the landing", () => {
    render(<Nav askOpen={false} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    const menu = nav.querySelector<HTMLElement>("[data-phone-menu]")!;
    const { bar, menu: pages, all } = navLinks();
    expect(bar).toEqual([["maat", "#top"], ...PAGES, ["View on GitHub ↗", SITE.repoUrl]]);
    expect(within(nav).getByRole("link", { name: "Maat home" })).toBeInTheDocument();
    expect(nav.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(all.map((a) => a.getAttribute("href")).filter((h) => h?.startsWith("#") || h?.startsWith("/#"))).toEqual(["#top"]);

    // A <details>, so it opens without JavaScript; shown up to 720 px, where the links above are hidden.
    expect(menu.tagName).toBe("DETAILS");
    expect(menu.querySelector("summary")).toHaveTextContent("Menu");
    expect(menu.className.split(" ")).toContain("min-[721px]:hidden");
    expect(within(menu).getByRole("list", { name: "Pages" })).toBeInTheDocument();
    expect(pages).toEqual(PAGES);
    const navlinks = all.filter((a) => a.classList.contains("navlink") && !a.closest("[data-phone-menu]"));
    expect(navlinks.map((a) => a.textContent)).toEqual(PAGES.map(([label]) => label));
    for (const a of navlinks) expect(a.className).toBe("navlink max-[720px]:hidden");
  });

  it("points its home link at the landing from any other page, and every page link as it is", () => {
    render(<Nav onLanding={false} askOpen={false} />);
    const hrefs = navLinks().all.map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/", ...PAGES.map(([, href]) => href), ...PAGES.map(([, href]) => href), SITE.repoUrl]);
  });

  // The owner's switch, content/ask-open.ts, opens /ask; the same deploy adds Ask and Proof to the bar and the menu.
  it("adds Ask and Proof after Ledger, in the bar and in the phone menu, when the owner's switch is on", () => {
    render(<Nav askOpen />);
    const { bar, menu, all } = navLinks();
    const pages = [...PAGES.slice(0, -1), ...ASK_PAGES, ...PAGES.slice(-1)];
    expect(bar).toEqual([["maat", "#top"], ...pages, ["View on GitHub ↗", SITE.repoUrl]]);
    expect(menu).toEqual(pages);
    // In the bar they give way to the Menu up to 720 px, as the other pages do.
    const navlinks = all.filter((a) => a.classList.contains("navlink") && !a.closest("[data-phone-menu]"));
    expect(navlinks.map((a) => a.textContent)).toEqual(["Now", "Gap Index", "Ledger", "Ask", "Proof", "Docs"]);
    for (const a of navlinks) expect(a.className).toBe("navlink max-[720px]:hidden");
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
  it("states the pitch, what Maat is, its three steps and the three stats from facts", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The AI agent that knows when not to trade.");
    // Spec 2026-11-27 section 1, word for word.
    expect(HERO_DEFINITION).toBe(
      "Maat is a vault on Base. Maat's agent proposes trades in tokenized US stocks; the vault checks each one against public rules and records yes or no onchain.",
    );
    expect(screen.getByText(HERO_DEFINITION)).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "How a trade is weighed" })).getAllByRole("link");
    expect(steps.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["1Maat's agent proposes a trade", "#how"],
      ["2The vault checks 9 public rules", "#how"],
      ["3Yes or no is recorded on Base", "#how"],
    ]);
    expect(HERO_STEPS).toHaveLength(3);
    // The site's description is the page's meta description, no longer a line in the hero.
    expect(screen.queryByText(SITE.description)).toBeNull();
    const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
    expect(stat("CHECKS PER TRADE")).toBe("9");
    expect(stat("TYPED REFUSALS")).toBe("19");
    expect(stat("RULE TIMELOCK")).toBe("24h");
    // Spec 2026-11-27 section 1: the film first (its band is directly under the hero, section 2), then the simulator.
    const ctas = [...document.querySelectorAll<HTMLAnchorElement>("[data-hero-cta]")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(ctas).toEqual([
      ["Watch the film (1:40)", "#film"],
      ["Try to make it say no", "#try"],
    ]);
    expect(screen.queryByRole("link", { name: "See the vault's last decision" })).toBeNull();
    // The vault card opens the ledger instead.
    expect(screen.getByRole("link", { name: "Open the ledger" })).toHaveAttribute("href", "/ledger");
    expect(screen.getByRole("link", { name: "Verify it in 5 minutes" })).toHaveAttribute("href", SITE.quickstartUrl);
    // The engine card opens on the mainnet vault; the fork replay is the other tab, its moments in the hidden panel.
    expect(screen.getByRole("tab", { name: "Base mainnet" })).toHaveAttribute("aria-selected", "true");
    // Spec 2026-11-27 section 3: the replay's tab says when it ran and what it was.
    expect(screen.getByRole("tab", { name: "Before mainnet (fork test)" })).toHaveAttribute("aria-selected", "false");
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
