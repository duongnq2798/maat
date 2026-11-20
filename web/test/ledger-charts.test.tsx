import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DecisionsPerDayChart } from "@/components/charts/DecisionsPerDayChart";
import { HealthFactorChart } from "@/components/charts/HealthFactorChart";
import { RefusalsByReasonChart } from "@/components/charts/RefusalsByReasonChart";
import { WeightsChart } from "@/components/charts/WeightsChart";
import { reasonDisplay } from "@/lib/chain/reason";

const DAYS = [
  { day: "2026-11-24", label: "Tue 24 Nov", allowed: 2, refused: 0 },
  { day: "2026-11-25", label: "Wed 25 Nov", allowed: 1, refused: 2 },
  { day: "2026-11-26", label: "Thu 26 Nov", allowed: 2, refused: 0 },
];

/** Data rows of the chart's table view (the header row excluded). */
const dataRows = (container: HTMLElement) => within(container.querySelector("table")!).getAllByRole("row", { hidden: true }).slice(1);

describe("DecisionsPerDayChart", () => {
  it("says so when there are no decisions, and draws nothing", () => {
    const { container } = render(<DecisionsPerDayChart days={[]} />);
    expect(screen.getByText("No decisions yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });

  it("names the totals, keys both series and has a table row per day", () => {
    const { container } = render(<DecisionsPerDayChart days={DAYS} />);
    expect(screen.getByRole("img", { name: "Decisions per day: 3 days, 5 allowed, 2 refused" })).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Allowed", "Refused"]);
    expect(dataRows(container).map((r) => r.textContent)).toEqual(["Tue 24 Nov20", "Wed 25 Nov12", "Thu 26 Nov20"]);
  });

  it("draws a column segment only where the count is above zero", () => {
    const { container } = render(<DecisionsPerDayChart days={DAYS} />);
    expect(container.querySelectorAll("[data-mark=allowed]")).toHaveLength(3);
    expect(container.querySelectorAll("[data-mark=refused]")).toHaveLength(1);
  });
});

describe("RefusalsByReasonChart", () => {
  const reasons = [
    { code: "MARKET_CLOSED" as const, count: 3 },
    { code: "SIZE_LIMIT" as const, count: 2 },
  ];

  it("says so when nothing was refused", () => {
    render(<RefusalsByReasonChart reasons={[]} selected={null} onSelect={() => {}} />);
    expect(screen.getByText("No refusals yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists each reason as a toggle button with its count", () => {
    render(<RefusalsByReasonChart reasons={reasons} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("group", { name: "Refusals by reason: 2 reasons, 5 refusals" })).toBeInTheDocument();
    const first = screen.getByRole("button", { name: new RegExp(reasonDisplay("MARKET_CLOSED").label) });
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(first).toHaveTextContent("3");
  });

  it("selects a reason on click and clears it on a second click", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<RefusalsByReasonChart reasons={reasons} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /SIZE_LIMIT/ }));
    expect(onSelect).toHaveBeenLastCalledWith("SIZE_LIMIT");

    rerender(<RefusalsByReasonChart reasons={reasons} selected="SIZE_LIMIT" onSelect={onSelect} />);
    const pressed = screen.getByRole("button", { name: /SIZE_LIMIT/ });
    expect(pressed).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pressed);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("WeightsChart", () => {
  const holdings = [
    { symbol: "NVDAc", weightBps: 2100, maxWeightBps: 3000 },
    { symbol: "GOOGLc", weightBps: null, maxWeightBps: 3000 },
    { symbol: "AAPLc", weightBps: 0, maxWeightBps: null },
  ];

  it("says so when the vault lists no stock", () => {
    render(<WeightsChart holdings={[]} targetPct={23.3} />);
    expect(screen.getByText("The vault lists no stock yet.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("names each weight and the target, and never draws an unread weight as zero", () => {
    const { container } = render(<WeightsChart holdings={holdings} targetPct={23.3} />);
    expect(
      screen.getByRole("img", { name: "Weight of net equity: NVDAc 21.0%, GOOGLc unavailable, AAPLc 0.0%; target 23.3%" }),
    ).toBeInTheDocument();
    // NVDAc only: GOOGLc was not read and AAPLc is at zero, so neither draws a bar.
    expect(container.querySelectorAll("[data-mark=weight]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-mark=cap]")).toHaveLength(2);
    expect(dataRows(container).map((r) => r.textContent)).toEqual(["NVDAc21.0%30.0%", "GOOGLcunavailable30.0%", "AAPLc0.0%—"]);
  });
});

describe("WeightsChart axis", () => {
  it("labels at most three ticks so they never crowd on a phone", () => {
    const { container } = render(<WeightsChart holdings={[{ symbol: "NVDAc", weightBps: 2980, maxWeightBps: 4000 }]} targetPct={23.3} />);
    expect([...container.querySelectorAll("[data-tick]")].map((t) => t.textContent)).toEqual(["0%", "25%", "50%"]);
  });

  it("steps by 10 for small weights", () => {
    const { container } = render(<WeightsChart holdings={[{ symbol: "NVDAc", weightBps: 1200, maxWeightBps: null }]} targetPct={10} />);
    expect([...container.querySelectorAll("[data-tick]")].map((t) => t.textContent)).toEqual(["0%", "10%", "20%"]);
  });
});

describe("HealthFactorChart", () => {
  it("says so when there is no debt", () => {
    render(<HealthFactorChart hf={null} min={1.5} target={2} />);
    expect(screen.getByText("No debt, so no health factor to watch.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("takes the empty sentence from the page, so a failed read never reads as no debt", () => {
    render(<HealthFactorChart hf={null} min={1.5} target={2} emptyText="Health factor unavailable: the read failed." />);
    expect(screen.getByText("Health factor unavailable: the read failed.")).toBeInTheDocument();
    expect(screen.queryByText("No debt, so no health factor to watch.")).toBeNull();
  });

  it("places the floor and target marks and reads above the target", () => {
    const { container } = render(<HealthFactorChart hf={2.4} min={1.5} target={2} />);
    expect(screen.getByRole("img", { name: "Health factor 2.40: floor 1.50, target 2.00, above the target" })).toBeInTheDocument();
    expect(container.querySelector("[data-mark=min]")).not.toBeNull();
    expect(container.querySelector("[data-mark=target]")).not.toBeNull();
    expect(screen.getByText("above the target")).toBeInTheDocument();
  });

  it("states it plainly when the health factor is below the floor", () => {
    render(<HealthFactorChart hf={1.42} min={1.5} target={2} />);
    expect(screen.getByText("below the floor")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /below the floor/ })).toBeInTheDocument();
  });

  it("reads between the floor and the target", () => {
    render(<HealthFactorChart hf={1.8} min={1.5} target={2} />);
    expect(screen.getByText("between the floor and the target")).toBeInTheDocument();
  });
});
