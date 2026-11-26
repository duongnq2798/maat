import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PremiumChart } from "@/components/charts/PremiumChart";
import { WeekChart } from "@/components/charts/WeekChart";
import { HowItWorks } from "@/components/sections/HowItWorks";
import { Problem } from "@/components/sections/Problem";
import { CodePanel } from "@/components/ui/CodePanel";
import { FACTS } from "@/content/facts";
import { PUBLISHED } from "@/content/gap-index";

const width = (el: Element | null | undefined) => Number(el?.getAttribute("width"));

describe("WeekChart", () => {
  it("draws the feed week and NYSE sessions to scale", () => {
    const { container } = render(<WeekChart />);
    const feed = container.querySelectorAll('rect[data-part="feed"]');
    expect([...feed].map(width)).toEqual([207.1, 7.1]);
    expect(width(container.querySelector('rect[data-part="frozen"]'))).toBe(85.7);
    const sessions = container.querySelectorAll('rect[data-part="session"]');
    expect(sessions).toHaveLength(5);
    expect([...sessions].map(width)).toEqual(Array(5).fill(11.6));
    expect(sessions[0]?.getAttribute("x")).toBe("27");
    // The lexicon (docs/brand/lexicon.md): a feed is held without an update, never frozen; a short label says "feed held".
    expect(screen.getByRole("img")).toHaveAccessibleName(/ET, held without an update over the weekend;/);
    expect([...container.querySelectorAll("text")].map((t) => t.textContent)).toContain("feed held");
    expect(container.textContent).not.toMatch(/frozen/i);
  });
});

describe("PremiumChart", () => {
  it("scales each bar to its measured premium against the limit", () => {
    const { container } = render(<PremiumChart />);
    const limit = FACTS.mandate.value.maxPremiumBps;
    const scale = (241.3 - 58) / limit;
    for (const [symbol, bps] of Object.entries(FACTS.premiumsBps.value)) {
      const g = container.querySelector(`g[data-symbol="${symbol}"]`);
      expect(width(g?.querySelector("rect")) / scale).toBeCloseTo(bps, 0);
      expect(g).toHaveTextContent(`${bps} bps`);
    }
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Measured premiums of the DEX TWAP over the Chainlink price in session: AAPLc 29, GOOGLc 49, NVDAc 53 basis points, against a 100 basis point limit",
    );
  });
});

describe("Problem", () => {
  it("shows the three traps, each named in plain words over its refusal code, with fact-backed numbers", () => {
    const { container } = render(<Problem />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Tokenized stocks trade 24/7. Their prices don't.");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "The price feed sleeps every weekend.",
      "The pool can drift from fair value.",
      "A split quietly changes the math.",
    ]);
    // Each card's badge: the plain label over the code, both in the refuse colour.
    const badges = [...container.querySelectorAll("article [data-reason-tag]")];
    expect(badges.map((b) => [b.firstElementChild?.textContent, b.lastElementChild?.textContent])).toEqual([
      ["Market closed", "MARKET_CLOSED"],
      ["Pool price too far from oracle", "PREMIUM_TOO_HIGH"],
      ["Corporate action cooldown", "MULTIPLIER_COOLDOWN"],
    ]);
    for (const b of badges) {
      expect(b.firstElementChild).toHaveClass("text-refuse");
      expect(b.lastElementChild).toHaveClass("text-refuse");
    }
    expect(screen.getByText("1.000537939576369481")).toBeInTheDocument();
    expect(screen.getByText("24h pause")).toBeInTheDocument();
    expect(screen.getByText(/compares a 30-minute Aerodrome TWAP/)).toBeInTheDocument();
    expect(screen.getByText(/pauses that token for 24 hours/)).toBeInTheDocument();
  });

  it("links the Weekend Gap Index by its latest edition's title", () => {
    render(<Problem />);
    const latest = [...PUBLISHED].sort((a, b) => b.edition - a.edition)[0]!;
    const link = screen.getByRole("link", { name: `Weekend Gap Index · ${latest.title}` });
    expect(link).toHaveAttribute("href", "/gap-index");
  });
});

describe("CodePanel", () => {
  it("prints event Decision exactly as the contract declares it", () => {
    const { container } = render(<CodePanel />);
    expect(container.querySelector("pre")?.textContent).toBe(
      [
        "event Decision(",
        "    bytes32 indexed intentId,",
        "    Action  action,",
        "    address indexed token,",
        "    uint256 amount,",
        "    bool    allowed,",
        "    Reason  reason,",
        "    bytes32 rationaleHash",
        ");",
      ].join("\n"),
    );
    expect(screen.getByText("solidity 0.8.28")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Decision event in Solidity" })).toHaveAttribute("tabindex", "0");
  });
});

describe("HowItWorks", () => {
  it("walks the four steps and decodes the Saturday refusal", () => {
    const { container } = render(<HowItWorks />);
    expect(container.querySelector("section#how")).not.toBeNull();
    // The mechanism line, word for word (docs/brand/lexicon.md).
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Claude proposes\. The vault decides\.$/);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Claude proposes",
      "Preview as executor",
      "The vault weighs it",
      "Recorded either way",
    ]);
    expect(screen.getByText(/^Every 15 minutes in session/)).toBeInTheDocument();
    expect(screen.getByText(/^Nine checks in order/)).toBeInTheDocument();
    const decoded = screen.getByText("DECODED · SAT 7 NOV · BASE FORK").parentElement!;
    const pairs = [...decoded.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
    expect(pairs).toEqual([
      ["action", "BUY"],
      ["token", "GOOGLc"],
      ["amount", "10.00 USDC"],
      ["allowed", "false"],
      ["reason", "MARKET_CLOSED // Market closed"],
      ["rationaleHash", "[from mainnet tx]"],
    ]);
    // The value stays the decoded code; its plain label follows as a muted comment.
    expect(within(decoded).getByText("// Market closed")).toHaveClass("text-ink-2");
    expect(within(decoded).getByText(/Base Builder Code \(ERC-8021\)/)).toBeInTheDocument();
  });
});
