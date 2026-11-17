import { render, screen, within } from "@testing-library/react";
import type { Root } from "fumadocs-core/page-tree";
import { describe, expect, it } from "vitest";
import { EventSignature, ForkLedger, MandateTable, READER_PATHS, ReasonTable, RouterCards } from "@/components/docs/content";
import {
  Architecture,
  DecisionLoop,
  HealthFactorScale,
  marketWeek,
  MarketWeek,
  MultiplierFlow,
  TimelockFlow,
  TreasuryLoop,
} from "@/components/docs/diagrams";
import { SectionIndex } from "@/components/docs/SectionIndex";
import { getDecisions } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { REASON_MEANING, REASON_MEANING_DOCS, REASONS } from "@/content/reasons";
import { DOCS_IA } from "@/lib/docs/ia";
import { docsSlug, urlSlug } from "@/lib/docs/links";
import { docsTree } from "@/lib/docs/remark-component-text";
import { sectionIndex } from "@/lib/docs/sections";

describe("data tables", () => {
  it("ReasonTable lists every refusal with its enum id and a link to its entry", () => {
    render(<ReasonTable />);
    const rows = within(screen.getByRole("region", { name: "Refusal codes" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + REASONS.length);
    const closed = screen.getByRole("link", { name: "MARKET_CLOSED" });
    expect(closed).toHaveAttribute("href", "/docs/concepts/refusal-codes#market_closed");
    expect(closed.closest("tr")).toHaveTextContent(`MARKET_CLOSED${REASONS.indexOf("MARKET_CLOSED") + 1}Market`);
    expect(closed.closest("tr")).toHaveTextContent(REASON_MEANING_DOCS.MARKET_CLOSED);
    expect(closed.closest("tr")).not.toHaveTextContent(REASON_MEANING.MARKET_CLOSED);
  });

  it("MandateTable shows the landing page's mandate rows", () => {
    render(<MandateTable />);
    const rows = within(screen.getByRole("region", { name: "Default mandate" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + mandateRows(FACTS.mandate.value).length);
    expect(screen.getByText("$50")).toBeInTheDocument();
  });

  it("EventSignature prints the Decision event and refuses any other", () => {
    const { container } = render(<EventSignature name="Decision" />);
    expect(screen.getByText(/bytes32 indexed intentId,/)).toBeInTheDocument();
    // The block scrolls sideways, so a keyboard user must be able to focus it (axe scrollable-region-focusable).
    expect(container.querySelector("pre")).toHaveAttribute("tabindex", "0");
    expect(() => EventSignature({ name: "Paused" })).toThrow("only Decision is in FACTS");
  });

  it("ForkLedger has one row per fork decision and names the fork block", () => {
    render(<ForkLedger />);
    const rows = within(screen.getByRole("region", { name: "Decisions from the fork run" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + getDecisions().length);
    expect(screen.getByText("REFUSED · MARKET_CLOSED")).toBeInTheDocument();
    expect(screen.getByText(/block 53,551,627/)).toBeInTheDocument();
  });
});

describe("RouterCards", () => {
  it("links each reader to their first page", () => {
    render(<RouterCards exists={() => true} />);
    expect(screen.getAllByRole("link")).toHaveLength(READER_PATHS.length);
    expect(screen.getByRole("link", { name: "Verify it in five minutes →" })).toHaveAttribute("href", "/docs/get-started/quickstart");
  });

  it("shows a page that has not shipped without a link", () => {
    render(<RouterCards exists={(slug) => !slug.startsWith("security/")} />);
    expect(screen.getAllByRole("link")).toHaveLength(READER_PATHS.length - 1);
    expect(screen.getByText("Security model (coming soon)")).toBeInTheDocument();
  });
});

describe("SectionIndex", () => {
  // The tree Fumadocs builds from content/docs, the same builder as the sidebar's; the IA is the independent oracle.
  // The path is relative to web/, as the build reads it (the test helpers' file URLs do not resolve under jsdom).
  const tree = docsTree("content/docs");
  const iaPage = new Map(DOCS_IA.flatMap((s) => s.pages).map((p) => [p.slug, p]));
  const sections = DOCS_IA.filter((s) => s.dir !== "");

  /** Each card as a reader sees it: the link's text and target, and the line under it. */
  const cards = (root: HTMLElement) =>
    [...root.querySelectorAll("li")].map((li) => ({
      title: li.querySelector("a")?.textContent,
      href: li.querySelector("a")?.getAttribute("href"),
      description: li.querySelector("p")?.textContent,
    }));

  it.each(sections.map((s) => [s.dir, s] as const))("%s lists the folder's pages in sidebar order, each with its description", (dir, s) => {
    const { container } = render(<SectionIndex tree={tree} section={dir} />);
    const expected = s.pages
      .filter((p) => p.slug !== `${dir}/index`)
      .flatMap((p) => [p, ...(s.links ?? []).filter((l) => l.after === p.slug).map((l) => iaPage.get(l.slug)!)])
      .map((p) => ({ title: p.title, href: `/docs/${p.slug}`, description: p.description }));
    expect(cards(container)).toEqual(expected);
  });

  it("puts Reference under the sidebar's groups, with Refusal codes among the contracts", () => {
    const { container } = render(<SectionIndex tree={tree} section="reference" />);
    const groups = [...container.querySelectorAll("section")].map((g) => ({
      name: g.querySelector("h2")?.textContent,
      pages: cards(g).map((c) => c.href),
    }));
    expect(groups).toEqual([
      {
        name: "Contracts",
        pages: ["mandate-vault", "events", "errors", "types"]
          .map((p) => `/docs/reference/${p}`)
          .concat("/docs/concepts/refusal-codes", "/docs/reference/market-calendar", "/docs/reference/adapters"),
      },
      { name: "Agent", pages: ["/docs/reference/agent-configuration", "/docs/reference/agent-scripts"] },
      { name: "Data", pages: ["/docs/reference/base-addresses", "/docs/reference/default-parameters"] },
    ]);
  });

  it("on the docs home, maps the sections: each title links its own page, with that page's description", () => {
    const { container } = render(<SectionIndex tree={tree} />);
    expect(cards(container)).toEqual(
      sections.map((s) => ({ title: s.title, href: `/docs/${s.dir}`, description: iaPage.get(`${s.dir}/index`)!.description })),
    );
    // The home page itself is not a card on its own map.
    expect(screen.queryByRole("link", { name: "Maat docs" })).toBeNull();
  });

  it("fails on a section with no page of its own, rather than listing nothing", () => {
    expect(() => SectionIndex({ tree, section: "nope" })).toThrow("no docs folder has its own page at /docs/nope");
  });
});

describe("sectionIndex", () => {
  // A tree with what content/docs does not have yet: a separator without a name, a page without a description, a link
  // to a page of another folder and a link out of the docs.
  const tree: Root = {
    name: "Docs",
    children: [
      { type: "page", name: "Home", url: "/docs", description: "The home." },
      {
        type: "folder",
        name: "A",
        index: { type: "page", name: "A", url: "/docs/a", description: "Section A." },
        children: [
          { type: "page", name: "One", url: "/docs/a/one", description: "Page one." },
          { type: "separator" },
          { type: "page", name: "Two", url: "/docs/a/two" },
          { type: "separator", name: "More" },
          { type: "page", name: "Three", url: "/docs/b/three" },
          { type: "page", name: "Out", url: "https://example.com", external: true },
        ],
      },
      {
        type: "folder",
        name: "B",
        index: { type: "page", name: "B", url: "/docs/b" },
        children: [{ type: "page", name: "Three", url: "/docs/b/three", description: "Page three." }],
      },
    ],
  };

  it("groups a folder's entries by separator, keeps an unnamed one as a break, and fills in a link's description", () => {
    expect(sectionIndex(tree, "a")).toEqual([
      { cards: [{ title: "One", url: "/docs/a/one", description: "Page one." }] },
      { cards: [{ title: "Two", url: "/docs/a/two" }] },
      {
        name: "More",
        cards: [
          { title: "Three", url: "/docs/b/three", description: "Page three." },
          { title: "Out", url: "https://example.com" },
        ],
      },
    ]);
  });

  it("on the root, lists each folder as a card for its own page and leaves out the home page", () => {
    expect(sectionIndex(tree, "")).toEqual([
      {
        cards: [
          { title: "A", url: "/docs/a", description: "Section A." },
          { title: "B", url: "/docs/b" },
        ],
      },
    ]);
  });

  it("fails on a folder without a page of its own", () => {
    const bare: Root = { name: "Docs", children: [{ type: "folder", name: "C", children: [] }] };
    expect(() => sectionIndex(bare, "")).toThrow("the docs folder C has no index.mdx");
  });
});

describe("diagrams", () => {
  it.each([
    ["DecisionLoop", <DecisionLoop key="d" />, "How one round of the agent loop reaches a decision", 4],
    ["Architecture", <Architecture key="a" />, "Who does what, from Claude to the Base protocols", 5],
    ["TimelockFlow", <TimelockFlow key="t" />, "How a rule change goes through the timelock", 4],
    ["TreasuryLoop", <TreasuryLoop key="l" />, "The treasury loop the agent is built to run", 4],
    ["MultiplierFlow", <MultiplierFlow key="m" />, "How a multiplier change blocks a stock", 4],
  ])("%s is a labelled list of steps", (_name, node, label, steps) => {
    render(node);
    expect(within(screen.getByRole("list", { name: label })).getAllByRole("listitem")).toHaveLength(steps);
  });

  it("HealthFactorScale lists the ranges from the highest, with the default floor and target and the lowest floor allowed", () => {
    render(<HealthFactorScale />);
    const list = screen.getByRole("list", {
      name: "What the vault returns for the health factor a BORROW, or a WITHDRAW_COLLATERAL against debt, would leave",
    });
    const bands = within(list)
      .getAllByRole("listitem")
      .map((li) => [...li.querySelectorAll("p")].slice(0, 2).map((p) => p.textContent));
    expect(bands).toEqual([
      ["2.0 and above", "Allowed"],
      ["1.5 to under 2.0", "DERISK_WINDOW in the window"],
      ["1.0 to under 1.5", "HEALTH_FACTOR_LOW"],
      ["Below 1.0", "Never a floor"],
    ]);
  });

  it("HealthFactorScale draws each range's verdict as a colour that repeats its words, hidden from a screen reader", () => {
    const { container } = render(<HealthFactorScale />);
    const edges = [...container.querySelectorAll("li > span")];
    expect(edges.map((e) => e.getAttribute("aria-hidden"))).toEqual(["true", "true", "true", "true"]);
    expect(edges.map((e) => e.getAttribute("data-tone"))).toEqual(["allowed", "conditional", "refused", "refused"]);
  });

  it("diagram numbers come from FACTS", () => {
    render(
      <>
        <DecisionLoop />
        <TimelockFlow />
      </>,
    );
    expect(screen.getByText("Up to 9 checks run in the contract for a BUY or a SELL. A Decision event records the verdict.")).toBeInTheDocument();
    expect(screen.getByText("Nothing can apply it for 24 hours.")).toBeInTheDocument();
    expect(screen.getByText(/every 15 minutes in session and every 60 minutes outside/)).toBeInTheDocument();
    render(<MultiplierFlow />);
    expect(screen.getByText(/^The stock stays blocked until the cooldown, 24 hours by default, has passed since the recording/)).toBeInTheDocument();
  });

  it("marketWeek follows MarketCalendar.isOpen: weekdays for REGULAR, Sunday to Friday at the feed edge for 24/5", () => {
    const { open, close } = FACTS.nyseSessionMin.value;
    const edge = FACTS.feedEdgeMin.value;
    const w = marketWeek();
    expect(w.REGULAR).toEqual([[[open, close]], [[open, close]], [[open, close]], [[open, close]], [[open, close]], [], []]);
    expect(w.FEED_24_5).toEqual([[[0, 1440]], [[0, 1440]], [[0, 1440]], [[0, 1440]], [[0, edge]], [], [[edge, 1440]]]);
  });

  it("MarketWeek states each session in words", () => {
    render(<MarketWeek />);
    expect(screen.getByText(/is open Monday to Friday, 09:30 ET to 16:00 ET\./)).toBeInTheDocument();
    expect(screen.getByText(/is open Sunday 20:00 ET to Friday 20:00 ET, around the clock\./)).toBeInTheDocument();
  });
});

describe("docsSlug", () => {
  it.each([
    ["/docs", []],
    ["/docs/concepts/nine-checks", ["concepts", "nine-checks"]],
    ["/docs/concepts/nine-checks#why-the-order-matters", ["concepts", "nine-checks"]],
    ["/docs/help/faq?x=1", ["help", "faq"]],
    ["/", null],
    ["/docsx", null],
    ["https://github.com/duongnq2798/maat", null],
    ["#anchor", null],
  ])("%s", (href, slug) => {
    expect(docsSlug(href)).toEqual(slug);
  });
});

describe("urlSlug", () => {
  it.each([
    ["index", []],
    ["concepts/index", ["concepts"]],
    ["concepts/nine-checks", ["concepts", "nine-checks"]],
  ])("%s", (slug, url) => {
    expect(urlSlug(slug)).toEqual(url);
  });
});
