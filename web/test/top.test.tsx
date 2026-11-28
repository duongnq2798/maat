import { readFileSync } from "node:fs";
import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementBar } from "@/components/sections/AnnouncementBar";
import { BuiltOn } from "@/components/sections/BuiltOn";
import { Hero } from "@/components/sections/Hero";
import { Nav } from "@/components/sections/Nav";
import { ASK_OPEN } from "@/content/ask-open";
import { HERO_AUDIENCE, HERO_DEFINITION, HERO_STEPS } from "@/content/hero";
import { SITE } from "@/lib/site";

/** The bar's [short, long] phrases: CSS shows the short one below sm and the long one from sm. */
const BAR_PHRASES = [
  ["Live on Base", "Live on Base mainnet"],
  ["Unaudited", "Unaudited · small treasury on purpose"],
  ["Follow →", "Follow the build"],
] as const;

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
    // The lexicon (docs/brand/lexicon.md): the site never calls the vault safe.
    expect(container.textContent).not.toMatch(/safe/i);
  });

  it("holds a short phone line and the long line in the HTML, and lets CSS pick one, with no JavaScript", () => {
    // PR #123 review, finding 37: the long line took three rows at 360 px.
    const { container } = render(<AnnouncementBar />);
    const bar = container.querySelector<HTMLElement>("[data-announcement-bar]")!;
    for (const [short, long] of BAR_PHRASES) {
      expect(within(bar).getByText(short).className, short).toBe("sm:hidden");
      expect(within(bar).getByText(long).className, long).toBe("max-sm:hidden");
    }
    // The separators show on the phone line only, and a screen reader skips them.
    const dots = [...bar.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter((el) => el.textContent === "·");
    expect(dots).toHaveLength(2);
    for (const dot of dots) expect(dot.className).toBe("sm:hidden");
    // The phone line as a phone shows it: every element hidden below sm left out.
    const phoneText = (el: Element): string =>
      el.classList.contains("max-sm:hidden")
        ? ""
        : [...el.childNodes].map((n) => (n instanceof Element ? phoneText(n) : (n.textContent ?? ""))).join("");
    const phone = [...bar.firstElementChild!.children].map(phoneText).filter((t) => t !== "");
    expect(phone).toEqual(["Live on Base", "·", "Unaudited", "·", "Follow →"]);
    // At most 36 characters, so it fits one line at 360 px (premium-product-ui section 2.4).
    expect(phone.join(" ").length).toBeLessThanOrEqual(36);
  });

  it("keeps one link to the build, named the same at every width, with a 44 px tap target", () => {
    render(<AnnouncementBar />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", SITE.xUrl);
    // Its name is the long label even where it shows "Follow →", which the name contains (WCAG 2.5.3).
    expect(link).toHaveAccessibleName("Follow the build");
    expect(link.className.split(" ")).toContain("tap");
  });
});

/**
 * The nav's links outside the phone menu, the menu's Pages list, and the menu's foot (the repository, since spec
 * 2026-11-28 section 3), as [text, href].
 */
function navLinks() {
  const nav = screen.getByRole("navigation", { name: "Main" });
  const menu = nav.querySelector<HTMLElement>("[data-phone-menu]")!;
  const list = within(menu).getByRole("list", { name: "Pages" });
  const pair = (a: HTMLElement) => [a.textContent, a.getAttribute("href")];
  const all = within(nav).getAllByRole("link");
  return {
    bar: all.filter((a) => !menu.contains(a)).map(pair),
    menu: within(list).getAllByRole("link").map(pair),
    foot: within(menu).getAllByRole("link").filter((a) => !list.contains(a)).map(pair),
    all,
  };
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
    const { bar, menu: pages, foot, all } = navLinks();
    expect(bar).toEqual([["maat", "#top"], ...PAGES, ["View on GitHub ↗", SITE.repoUrl]]);
    // Spec 2026-11-28 section 3: the pill shows from 721 px only, and the phone menu ends on the same link, under the
    // pages, so a phone's bar holds the wordmark and Menu alone.
    const pill = all.find((a) => a.classList.contains("pill-dark"))!;
    expect(pill.className.split(" ")).toContain("max-[721px]:hidden");
    expect(foot).toEqual([["View on GitHub ↗", SITE.repoUrl]]);
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
    for (const a of navlinks) expect(a.className).toBe("navlink max-[721px]:hidden");
  });

  it("points its home link at the landing from any other page, and every page link as it is", () => {
    render(<Nav onLanding={false} askOpen={false} />);
    const hrefs = navLinks().all.map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/", ...PAGES.map(([, href]) => href), ...PAGES.map(([, href]) => href), SITE.repoUrl, SITE.repoUrl]);
  });

  // The owner's switch, content/ask-open.ts, opens /ask; the same deploy adds Ask and Proof to the bar and the menu.
  it("adds Ask and Proof after Ledger, in the bar and in the phone menu, when the owner's switch is on", () => {
    render(<Nav askOpen />);
    const { bar, menu, foot, all } = navLinks();
    const pages = [...PAGES.slice(0, -1), ...ASK_PAGES, ...PAGES.slice(-1)];
    expect(bar).toEqual([["maat", "#top"], ...pages, ["View on GitHub ↗", SITE.repoUrl]]);
    expect(menu).toEqual(pages);
    expect(foot).toEqual([["View on GitHub ↗", SITE.repoUrl]]);
    // In the bar they give way to the Menu up to 720 px, as the other pages do.
    const navlinks = all.filter((a) => a.classList.contains("navlink") && !a.closest("[data-phone-menu]"));
    expect(navlinks.map((a) => a.textContent)).toEqual(["Now", "Gap Index", "Ledger", "Ask", "Proof", "Docs"]);
    for (const a of navlinks) expect(a.className).toBe("navlink max-[721px]:hidden");
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
    // Cold read of 2026-11-28, gap 1, word for word: who Maat is for.
    expect(HERO_AUDIENCE).toEqual({
      before: "For ",
      link: "agent builders",
      href: "#agents",
      after: ", not investors: only the owner can fund the vault.",
    });
    expect(`${HERO_AUDIENCE.before}${HERO_AUDIENCE.link}${HERO_AUDIENCE.after}`).toBe(
      "For agent builders, not investors: only the owner can fund the vault.",
    );
    expect(screen.getByRole("link", { name: "agent builders" })).toHaveAttribute("href", "#agents");
    const steps = within(screen.getByRole("list", { name: "How a trade is weighed" })).getAllByRole("link");
    // No-break spaces keep "9 public" and "on Base" whole when a phone's column wraps the label (finding #36 of
    // 2026-11-28); the words are the spec's.
    expect(steps.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["1Maat's agent proposes a trade", "#how"],
      ["2The vault checks 9\u00a0public rules", "#how"],
      ["3Yes or no is recorded on\u00a0Base", "#how"],
    ]);
    expect(HERO_STEPS.map((s) => s.replace(/\u00a0/g, " "))).toEqual([
      "Maat's agent proposes a trade",
      "The vault checks 9 public rules",
      "Yes or no is recorded on Base",
    ]);
    expect(HERO_STEPS).toHaveLength(3);
    // The site's description is the page's meta description, no longer a line in the hero.
    expect(screen.queryByText(SITE.description)).toBeNull();
    // Spec 2026-11-28 section 1: the spec plate left the hero for the foot of "On the record" (test/on-the-record.test.tsx).
    expect(screen.queryByText("CHECKS PER TRADE")).toBeNull();
    // Spec 2026-11-27 section 1: the film first (its band follows "On the record" under the hero, spec 2026-11-28
    // section 2), then the simulator.
    const ctas = [...document.querySelectorAll<HTMLAnchorElement>("[data-hero-cta]")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(ctas).toEqual([
      ["Watch the film (1:40)", "#film"],
      ["Try to make it say no", "#try"],
    ]);
    expect(screen.queryByRole("link", { name: "See the vault's last decision" })).toBeNull();
    // The vault card opens the ledger instead.
    expect(screen.getByRole("link", { name: "Open the ledger" })).toHaveAttribute("href", "/ledger");
    expect(screen.getByRole("link", { name: "Run the tests in 5 minutes" })).toHaveAttribute("href", SITE.quickstartUrl);
    // The engine card opens on the mainnet vault; the fork replay is the other tab, its moments in the hidden panel.
    expect(screen.getByRole("tab", { name: "Base mainnet" })).toHaveAttribute("aria-selected", "true");
    // Spec 2026-11-27 section 3: the replay's tab says when it ran and what it was.
    expect(screen.getByRole("tab", { name: "Before mainnet (fork test)" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("group", { name: "Choose a moment", hidden: true })).not.toBeVisible();
    expect(document.getElementById("top")).not.toBeNull();
  });

  it("says only the owner can fund the vault because the vault's code holds it: fund and withdraw are onlyOwner, and no deposit", () => {
    // Vitest runs in web/.
    const vault = readFileSync("../contracts/src/MandateVault.sol", "utf8");
    expect(vault).toMatch(/function fund\(uint256 amount\) external onlyOwner/);
    expect(vault).toMatch(/function withdraw\(address token, uint256 amount\) external onlyOwner/);
    expect(vault).not.toMatch(/function (?:deposit|mint|redeem)\b/);
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
