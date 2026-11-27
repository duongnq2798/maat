import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LedgerTable } from "@/components/LedgerTable";
import { type DecisionRow, decisionLabel, gasLabel, getDecisions, intentLabel } from "@/content/decisions";
import { REASON_MEANING } from "@/content/reasons";

const NOTE = /Recorded by the agent loop on a fork of Base mainnet at block 53,551,627/;

function setup(rows: readonly DecisionRow[] = getDecisions()) {
  render(<LedgerTable rows={rows} heading={<h2>Every answer is public. Especially no.</h2>} />);
  const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
  return {
    bodyRows,
    chip: (name: string) => screen.getByRole("button", { name }),
    /** The text of one column in each body row: 0 time, 1 intent, 2 decision, 3 note, 4 gas used. */
    column: (i: number) => bodyRows().map((row) => within(row).getAllByRole("cell")[i]!.textContent),
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
    expect(bodyRows()[0]).toHaveTextContent("Refused · Market closed");
    expect(bodyRows()[0]).toHaveTextContent("111,116");
  });

  it("keeps the fork source note in every view", async () => {
    const { chip } = setup();
    for (const name of ["All", "Allowed", "Refused"]) {
      await userEvent.click(chip(name));
      expect(screen.getByText(NOTE)).toBeInTheDocument();
    }
  });

  it("says so when a filter matches nothing, in the table and in the phone's cards", async () => {
    const { bodyRows, chip } = setup(getDecisions().filter((r) => r.allowed));
    await userEvent.click(chip("Refused"));
    expect(bodyRows()).toHaveLength(1);
    expect(within(screen.getByRole("table")).getByText("No refused decisions yet.")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Decisions" })).getByText("No refused decisions yet.")).toBeInTheDocument();
  });

  // Spec 2026-11-27, landing "explain in 10 seconds", section 4: on a phone the 820 px table hid its DECISION column off
  // the screen. Below 640 px the table gives way to one card per decision (CSS: hidden sm:block and sm:hidden), each
  // with its intent, time, verdict, code, note and gas, the verdict on the card's second line.
  it("gives a phone one card per decision, with the verdict in it, and follows the filter", async () => {
    const { chip } = setup();
    const region = screen.getByRole("region", { name: "Decision ledger" });
    const cards = screen.getByRole("list", { name: "Decisions" });
    expect(region).toHaveClass("hidden", "sm:block");
    expect(cards).toHaveClass("sm:hidden");
    const items = () => within(cards).getAllByRole("listitem");
    const rows = getDecisions();
    expect(items()).toHaveLength(rows.length);
    for (const [i, r] of rows.entries()) {
      const item = items()[i]!;
      expect(item).toHaveTextContent(intentLabel(r));
      expect(item).toHaveTextContent(`${r.timeLabel} ET`);
      expect(within(item).getByText(decisionLabel(r))).toBeInTheDocument();
      expect(within(item).getByText(r.reason).tagName).toBe("CODE");
      expect(item).toHaveTextContent(`gas used ${gasLabel(r)}`);
    }
    await userEvent.click(chip("Refused"));
    expect(items()).toHaveLength(1);
    expect(items()[0]).toHaveTextContent("Refused · Market closed");
  });

  it("says in the fork note that the vault's mainnet decisions are on the mainnet ledger, and promises no link", () => {
    setup();
    expect(screen.getByText(NOTE).textContent).toBe(
      "Recorded by the agent loop on a fork of Base mainnet at block 53,551,627, against the real B20 tokens, Aerodrome pools and the Aave V4 Equities Hub. The vault's mainnet decisions, each linked to Basescan, are on the mainnet ledger.",
    );
    expect(screen.queryByText(/will link/)).toBeNull();
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

  it("shows the verdict and the reason's plain label in the badge, and the code beside it", () => {
    const { bodyRows } = setup();
    const [first, , , last] = bodyRows();
    expect(within(first!).getByText("Allowed · All checks passed")).toBeInTheDocument();
    expect(within(first!).getByText("OK").tagName).toBe("CODE");
    expect(within(last!).getByText("Refused · Market closed")).toBeInTheDocument();
    expect(within(last!).getByText("MARKET_CLOSED").tagName).toBe("CODE");
  });

  it("shows what the code means in a refused row that has no note", () => {
    const refused = getDecisions().find((r) => !r.allowed)!;
    const { column } = setup([{ ...refused, note: undefined }]);
    expect(column(3)).toEqual([REASON_MEANING.MARKET_CLOSED]);
  });

  it("leaves the note empty in an allowed row that has no note", () => {
    const allowed = getDecisions()
      .filter((r) => r.allowed)
      .map((r) => ({ ...r, note: undefined }));
    const { column } = setup(allowed);
    expect(column(3)).toEqual(allowed.map(() => ""));
  });

  it("keeps a row's own note over the meaning of its code", () => {
    const { column } = setup();
    expect(column(3)).toEqual(getDecisions().map((r) => r.note));
  });
});
