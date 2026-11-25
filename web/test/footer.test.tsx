import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Footer } from "@/components/sections/Footer";
import type { Deployment } from "@/lib/docs/docs-data";

/** The lines the footer gave before the deploy, which no longer hold on any page it closes. */
const BEFORE_THE_DEPLOY = /goes live|will be posted|as they happen|first weekend/i;

const LEAD = /^Every decision|^The vault has been on Base mainnet/;

describe("Footer", () => {
  it("says the vault has been on Base mainnet since the day deployments/README.md records, and where its decisions are", () => {
    render(<Footer />);
    expect(screen.getByText(LEAD).textContent).toBe(
      "The vault has been on Base mainnet since Tue 24 Nov 2026, with a small treasury. Every decision it makes, refusals included, is public on the mainnet ledger.",
    );
    // The lead names the ledger, and /now and /gap-index have no other link to it, so the footer carries one.
    expect(screen.getByRole("link", { name: "Mainnet ledger" })).toHaveAttribute("href", "/ledger");
  });

  it("no longer calls mainnet the future", () => {
    const { container } = render(<Footer />);
    expect(container.textContent).not.toMatch(BEFORE_THE_DEPLOY);
  });

  it("names no day for a table with no vault, and still says where the decisions are", () => {
    const empty: Deployment[] = [{ network: "Base mainnet", contract: "MandateVault", address: "", tx: "", date: "" }];
    const { container } = render(<Footer deployments={empty} />);
    expect(screen.getByText(LEAD).textContent).toBe("Every decision the vault makes, refusals included, is public on the mainnet ledger.");
    expect(container.textContent).not.toMatch(BEFORE_THE_DEPLOY);
  });
});
