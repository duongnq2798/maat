import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EventSignature, ForkLedger, MandateTable, READER_PATHS, ReasonTable, RouterCards } from "@/components/docs/content";
import { Architecture, DecisionLoop, marketWeek, MarketWeek, TimelockFlow, TreasuryLoop } from "@/components/docs/diagrams";
import { getDecisions } from "@/content/decisions";
import { FACTS } from "@/content/facts";
import { mandateRows } from "@/content/mandate";
import { REASONS } from "@/content/reasons";
import { docsSlug } from "@/lib/docs/links";

describe("data tables", () => {
  it("ReasonTable lists every refusal with its enum id and a link to its entry", () => {
    render(<ReasonTable />);
    const rows = within(screen.getByRole("region", { name: "Refusal codes" })).getAllByRole("row");
    expect(rows).toHaveLength(1 + REASONS.length);
    const closed = screen.getByRole("link", { name: "MARKET_CLOSED" });
    expect(closed).toHaveAttribute("href", "/docs/concepts/refusal-codes#market_closed");
    expect(closed.closest("tr")).toHaveTextContent(`MARKET_CLOSED${REASONS.indexOf("MARKET_CLOSED") + 1}Market`);
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

describe("diagrams", () => {
  it.each([
    ["DecisionLoop", <DecisionLoop key="d" />, "How one round of the agent loop reaches a decision", 4],
    ["Architecture", <Architecture key="a" />, "Who does what, from Claude to the Base protocols", 5],
    ["TimelockFlow", <TimelockFlow key="t" />, "How a rule change goes through the timelock", 4],
    ["TreasuryLoop", <TreasuryLoop key="l" />, "The treasury loop the agent is built to run", 4],
  ])("%s is a labelled list of steps", (_name, node, label, steps) => {
    render(node);
    expect(within(screen.getByRole("list", { name: label })).getAllByRole("listitem")).toHaveLength(steps);
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
