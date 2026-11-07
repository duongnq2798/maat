import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LedgerTable } from "@/components/LedgerTable";
import { type DecisionRow, getDecisions } from "@/content/decisions";

const NOTE = /Recorded by the agent loop on a fork of Base mainnet at block 53,551,627/;

function setup(rows: readonly DecisionRow[] = getDecisions()) {
  render(<LedgerTable rows={rows} heading={<h2>Every answer is public. Especially no.</h2>} />);
  return {
    bodyRows: () => within(screen.getByRole("table")).getAllByRole("row").slice(1),
    chip: (name: string) => screen.getByRole("button", { name }),
  };
}

describe("LedgerTable", () => {
  it("shows every decision first, with All pressed", () => {
    const { bodyRows, chip } = setup();
    expect(bodyRows()).toHaveLength(4);
    expect(chip("All")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Allowed")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("group", { name: "Filter decisions" })).toBeInTheDocument();
  });

  it("filters to 3 allowed and 1 refused", async () => {
    const { bodyRows, chip } = setup();
    await userEvent.click(chip("Allowed"));
    expect(bodyRows()).toHaveLength(3);
    expect(chip("Allowed")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chip("Refused"));
    expect(bodyRows()).toHaveLength(1);
    expect(bodyRows()[0]).toHaveTextContent("REFUSED · MARKET_CLOSED");
    expect(bodyRows()[0]).toHaveTextContent("111,116");
  });

  it("keeps the fork source note in every view", async () => {
    const { chip } = setup();
    for (const name of ["All", "Allowed", "Refused"]) {
      await userEvent.click(chip(name));
      expect(screen.getByText(NOTE)).toBeInTheDocument();
    }
  });

  it("says so when a filter matches nothing", async () => {
    const { bodyRows, chip } = setup(getDecisions().filter((r) => r.allowed));
    await userEvent.click(chip("Refused"));
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText("No refused decisions yet.")).toBeInTheDocument();
  });

  it("drops the fork note when no row comes from the fork", () => {
    setup(getDecisions().map((r) => ({ ...r, source: "base-mainnet" as const })));
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("scrolls the table in its own focusable region", () => {
    setup();
    const region = screen.getByRole("region", { name: "Decision ledger" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("data-scroll-x");
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });
});
