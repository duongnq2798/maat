import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "@/app/(site)/page";
import { FACTS } from "@/content/facts";
import { REASON_GROUPS, REASON_LABEL, REASON_MEANING, REASONS, type RefusalCode } from "@/content/reasons";
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
    // The nav lists pages, not the landing's sections, so the in-page links are the skip link, the home link and the
    // hero's and the sections' own links. The hero's three steps open How it works (spec 2026-11-27 section 1); its first
    // CTA and the footer's "Watch the film" open the film band (section 2); its audience line's "agent builders" opens
    // the builders' section (cold read of 2026-11-28, gap 1).
    expect([...ids].sort()).toEqual(["agents", "film", "how", "main", "reasons", "top", "try"]);
    for (const id of ids) expect(c.querySelector(`#${id}`), `#${id}`).not.toBeNull();
  });

  it("defines the mandate where the page's prose first names it (spec 2026-11-27 section 4)", () => {
    const c = setup();
    // The text a reader sees, in order: not a hidden tab panel, not the noscript line, and not the agent's note, which
    // is quoted verbatim.
    let text = "";
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest("[hidden], noscript, [data-hero-note]")) continue;
      text += `${n.textContent} `;
    }
    const at = text.search(/\bmandate\b/i);
    expect(at).toBeGreaterThan(-1);
    expect(text.slice(at)).toMatch(/^mandate \(the vault's public rule set\)/);
  });

  // Spec 2026-11-27, landing "explain in 10 seconds", section 3: what Maat is, the film, why it matters, how it works and
  // who can reuse it, then the simulator and the reference; the stack it is built on closes the page, above the footer.
  // Spec 2026-11-28, landing "a calmer first screen", section 2: the vault's real answers sit between the hero and the film.
  it("orders the sections to explain before they prove, the vault's real answers and then the film band under the hero", () => {
    const c = setup();
    const main = c.querySelector("main")!;
    const order = [...main.children].map((el) => el.id || el.getAttribute("aria-labelledby") || el.getAttribute("aria-label"));
    expect(order).toEqual([
      "top",
      "record",
      "film",
      "problem-title",
      "how",
      "agents",
      "try",
      "reasons",
      "mandate",
      "loop-title",
      "Built with",
    ]);
    expect(c.querySelector("#top")!.nextElementSibling).toBe(c.querySelector("#record"));
    expect(c.querySelector("#record")!.nextElementSibling).toBe(c.querySelector("#film"));
    expect(main.nextElementSibling!.tagName).toBe("FOOTER");
  });

  it("leaves the fork run's ledger to /ledger: no ledger section, table or fork rows on the landing", () => {
    const c = setup();
    expect(c.querySelector("#ledger")).toBeNull();
    expect(c.querySelector("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "Decision ledger" })).toBeNull();
    expect(c.textContent).not.toContain("Every answer is public.");
  });

  // Spec 2026-11-27 section 3: every number of the fork test or the simulator carries a badge, "fork · 5-7 Nov" or
  // "simulated", in the Problem charts and the simulator too; the hero's mainnet face carries none.
  it("badges every fork or simulated number: the Problem's premiums and multiplier, the replay and the simulator", () => {
    const c = setup();
    const badges = (root: Element, kind: "fork" | "simulated") =>
      [...root.querySelectorAll<HTMLElement>(`[data-badge="${kind}"]`)].map((b) => b.textContent);
    const problem = c.querySelector('section[aria-labelledby="problem-title"]')!;
    const replay = c.querySelector("#engine-panel-fork")!;
    const sim = c.querySelector("#try")!;
    const [week, premium, multiplier] = [...problem.querySelectorAll("article")];
    expect(badges(premium!, "fork")).toEqual(["fork · 5-7 Nov"]);
    expect(badges(multiplier!, "fork")).toEqual(["fork · 5-7 Nov"]);
    // The week chart draws the contract's calendar, not a fork reading: no badge.
    expect(week!.querySelector("[data-badge]")).toBeNull();
    expect(badges(replay, "fork")).toEqual(["fork · 5-7 Nov · block 53,551,627"]);
    expect(c.querySelector("#engine-panel-mainnet [data-badge]")).toBeNull();
    expect(badges(sim, "simulated")).toEqual(["simulated", "simulated"]);
    const fixed = [...sim.querySelectorAll("li[data-fixed]")];
    expect(fixed.length).toBeGreaterThan(0);
    for (const row of fixed) expect(badges(row, "fork")).toEqual(["fork · 5-7 Nov"]);
    // The notes under the simulator that give the fork test's block, feed age, premiums and starting balance carry its
    // badge too; the note on what the simulator simulates carries none.
    const notes = [...sim.querySelectorAll<HTMLElement>("p[data-try-note]")];
    expect(notes.map((n) => [n.dataset.tryNote, badges(n, "fork")])).toEqual([
      ["Simulated", []],
      ["Fixed at fork values", ["fork · 5-7 Nov"]],
      ["Starting point", ["fork · 5-7 Nov"]],
    ]);
    // Every badge sits on a number of the fork test or the simulator: none elsewhere on the page.
    const elsewhere = [...c.querySelectorAll("[data-badge]")].filter((b) => !problem.contains(b) && !sim.contains(b) && !replay.contains(b));
    expect(elsewhere).toEqual([]);
    for (const b of c.querySelectorAll("[data-badge]")) expect(b).toHaveAttribute("title");
  });

  // Spec 2026-11-27 section 3: the five groups show by default with their counts and plain labels; "Show all 19" opens
  // the codes; MARKET_CLOSED stays highlighted in both views.
  it("shows the five refusal groups by default, with their counts and labels, and MARKET_CLOSED filled", () => {
    const c = setup();
    const section = c.querySelector("#reasons") as HTMLElement;
    const groups = [...section.querySelectorAll<HTMLElement>("[data-group]")];
    expect(groups.map((g) => [g.querySelector("h3")!.textContent, g.querySelector("h3")!.nextElementSibling!.textContent])).toEqual(
      REASON_GROUPS.map((g) => [g.title, String(g.codes.length)]),
    );
    for (const [i, g] of groups.entries()) {
      const labels = g.querySelector<HTMLElement>("ul[data-labels]")!;
      expect(labels).not.toHaveAttribute("hidden");
      expect([...labels.children].map((li) => li.textContent)).toEqual(REASON_GROUPS[i]!.codes.map((code) => REASON_LABEL[code]));
      expect(g.querySelector("ul[id]")).toHaveAttribute("hidden");
    }
    expect([...section.querySelectorAll<HTMLElement>("li[data-label][data-hot]")].map((li) => li.dataset.label)).toEqual(["MARKET_CLOSED"]);
    const toggle = within(section).getByRole("button", { name: "Show all 19" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle.getAttribute("aria-controls")!.split(" ")).toEqual(groups.map((g) => g.querySelector("ul[id]")!.id));
    // The toggle comes before the groups it opens, so opening them never moves it (e2e/smoke.spec.ts checks the screen).
    for (const g of groups) expect(toggle.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens all nineteen refusals once on Show all 19, each titled by its plain label, and highlights only MARKET_CLOSED", () => {
    const c = setup();
    const section = c.querySelector("#reasons") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Nineteen typed ways to say no.");
    fireEvent.click(within(section).getByRole("button", { name: "Show all 19" }));
    const toggle = within(section).getByRole("button", { name: "Show the groups only" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    for (const list of section.querySelectorAll("ul[data-labels]")) expect(list).toHaveAttribute("hidden");
    for (const list of section.querySelectorAll("ul[id]")) expect(list).not.toHaveAttribute("hidden");
    const items = [...section.querySelectorAll<HTMLElement>("li[data-code]")];
    expect(items.map((li) => li.dataset.code).sort()).toEqual([...REASONS].sort());
    // Each item reads its plain label first, then its code as a tag, then the plain-English meaning.
    for (const li of items) {
      const code = li.dataset.code as RefusalCode;
      expect(li.children).toHaveLength(2);
      const [tag, meaning] = [...li.children];
      expect(tag).toHaveAttribute("data-reason-tag", code);
      expect(tag!.firstElementChild!.textContent).toBe(REASON_LABEL[code]);
      expect(tag!.lastElementChild!.textContent).toBe(code);
      expect(meaning!.textContent).toBe(REASON_MEANING[code]);
    }
    expect([...section.querySelectorAll<HTMLElement>("li[data-code][data-hot]")].map((li) => li.dataset.code)).toEqual(["MARKET_CLOSED"]);
    fireEvent.click(toggle);
    expect(within(section).getByRole("button", { name: "Show all 19" })).toHaveAttribute("aria-expanded", "false");
    for (const list of section.querySelectorAll("ul[id]")) expect(list).toHaveAttribute("hidden");
  });

  it("lets a visitor try the mandate, labeled as a simulation of the default one", () => {
    const c = setup();
    const section = c.querySelector("#try") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent("Try to make it say no.");
    expect(section).toHaveTextContent("A simulation of the default mandate, running in your browser.");
    expect(section).toHaveTextContent("The contract is the source of truth.");
    expect(within(section).getByText("default mandate · not the contract")).toBeInTheDocument();
    expect(section).toHaveTextContent(
      "weekends, and the 12 holidays and 3 early closes the calendar lists, up to Fri 24 Dec 2027)",
    );
    expect(section).toHaveTextContent("53 bps for NVDAc, 49 bps for GOOGLc and 29 bps for AAPLc");
    expect(section).toHaveTextContent(
      "an NVDAc feed answer 14 s old (the GOOGLc and AAPLc feeds are assumed fresh), multiplier unchanged",
    );
    expect(section).toHaveTextContent("the token list, the per-trade and daily caps, the weight and the vault's USDC balance.");
    expect(section).toHaveTextContent("Each day starts with $200 USDC and no stock");
    expect(within(section).getByRole("link", { name: "MarketCalendar.sol" })).toHaveAttribute(
      "href",
      `${SITE.repoUrl}/blob/main/contracts/src/MarketCalendar.sol`,
    );
    expect(within(section).getByRole("link", { name: "MandateVault.sol" })).toHaveAttribute(
      "href",
      `${SITE.repoUrl}/blob/main/contracts/src/MandateVault.sol`,
    );
  });

  it("shows the mandate sheet and its public timelock", () => {
    const c = setup();
    const section = c.querySelector("#mandate") as HTMLElement;
    expect(section.querySelectorAll("dl > div")).toHaveLength(12);
    expect(within(section).getByText("timelock 24h")).toBeInTheDocument();
    // The sheet is the default mandate (contracts/script/MaatConfig.sol) the owner deployed on Base mainnet, and the chip
    // is that vault's mandateHash(), shortened.
    expect(within(section).getByText("mandateHash 0x77a277…661b")).toBeInTheDocument();
    expect(within(section).getByText("default · Base mainnet")).toBeInTheDocument();
    expect(within(section).getByText(/waits 24 hours/)).toBeInTheDocument();
  });

  it("explains the treasury loop with fact-backed numbers and where each step stands", () => {
    setup();
    expect(screen.getByRole("heading", { level: 2, name: "One step is live." })).toBeInTheDocument();
    expect(screen.getByText(/rebalanced past a 5% drift/)).toBeInTheDocument();
    // README "Status": x402 was dropped for this season. On Base mainnet the vault has recorded buys only:
    // supply and borrow ran in fork tests, and no PAY_EXPENSE has been sent.
    const labels = [...document.querySelectorAll("section[aria-labelledby=loop-title] li > span")].map((el) => el.textContent);
    expect(labels).toEqual([
      "01 · EARN · DROPPED",
      "02 · BUY · LIVE",
      "03 · SUPPLY · FORK ONLY",
      "04 · BORROW · FORK ONLY",
      "05 · PAY · NOT YET",
    ]);
    expect(screen.queryByText(/pays its own way/)).toBeNull();
  });

  it("closes with the CTA, disclaimer and tagline verbatim", () => {
    setup();
    expect(screen.getByRole("link", { name: "Follow @maatonbase" })).toHaveAttribute("href", SITE.xUrl);
    // Spec 2026-11-27 section 2: "Watch it say no." gains the film, in the page on the landing.
    expect(screen.getByRole("link", { name: "Watch the film" })).toHaveAttribute("href", "#film");
    expect(screen.getByRole("link", { name: "Read the code" })).toHaveAttribute("href", SITE.repoUrl);
    const links = within(screen.getByRole("list", { name: "Project links" }))
      .getAllByRole("link")
      .map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([
      ["Mainnet ledger", "/ledger"],
      ["Docs", SITE.docsUrl],
      ["Source on GitHub", SITE.repoUrl],
      ["Run the tests in 5 minutes", SITE.quickstartUrl],
      ["Fork evidence", SITE.forkEvidenceUrl],
      ["MIT License", SITE.licenseUrl],
      [SITE.xHandle, SITE.xUrl],
    ]);
    expect(screen.getByText(SITE.disclaimer)).toBeInTheDocument();
    expect(screen.getByText(SITE.tagline)).toBeInTheDocument();
  });

  it("never shows a made-up hash: How it works decodes the agent's recorded Decision, its rationaleHash shortened", () => {
    const text = setup().textContent ?? "";
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40,}/);
    expect(text).not.toContain("[from mainnet tx]");
    const agent = FACTS.mainnetDecisions.value.find((l) => l.sender === "agent")!;
    const rationaleHash = `0x${agent.data.slice(2 + 4 * 64)}`;
    expect(text).toContain(`rationaleHash${rationaleHash.slice(0, 10)}…${rationaleHash.slice(-4)}`);
  });

  // Cold read of 2026-11-28, gap 6: below sm Claude's reason shows in How it works, from sm at the foot of the hero.
  it("shows Claude's reason once per breakpoint", () => {
    const c = setup();
    const figures = [...c.querySelectorAll("figure[data-hero-reason]")];
    expect(figures).toHaveLength(2);
    const inTop = c.querySelector("#top figure[data-hero-reason]")!;
    const inHow = c.querySelector("#how figure[data-hero-reason]")!;
    expect(inTop.getAttribute("class")!.split(" ")).toContain("max-sm:hidden");
    expect(inHow.getAttribute("class")!.split(" ")).toContain("sm:hidden");
    // The same words: only the round line's place differs, after the attribution on a phone (review of PR #120).
    const pieces = (fig: Element) => [...fig.querySelectorAll("figcaption > *, blockquote, figcaption + div > *")].map((e) => e.textContent).sort();
    expect(pieces(inHow)).toEqual(pieces(inTop));
    expect(inHow.textContent!.length).toBe(inTop.textContent!.length);
  });

  it("uses no raster images", () => {
    // The film's poster is its <video>'s own attribute, not an <img> (spec 2026-11-27 section 2).
    expect(setup().querySelectorAll("img")).toHaveLength(0);
  });
});
