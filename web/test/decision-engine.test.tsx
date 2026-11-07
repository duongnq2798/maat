import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DecisionEngine } from "@/components/DecisionEngine";

function setup() {
  render(<DecisionEngine />);
  return {
    sat: () => screen.getByRole("button", { name: "Sat 7 Nov" }),
    thu: () => screen.getByRole("button", { name: "Thu 5 Nov · 10:30" }),
    list: () => screen.getByRole("list", { name: "Mandate checks" }),
    marks: () =>
      within(screen.getByRole("list", { name: "Mandate checks" }))
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-mark")),
    verdict: () => screen.getByRole("status"),
  };
}

describe("DecisionEngine", () => {
  it("opens on Saturday: refused at check 4, checks 5-9 not reached", () => {
    const ui = setup();
    expect(ui.sat()).toHaveAttribute("aria-pressed", "true");
    expect(ui.thu()).toHaveAttribute("aria-pressed", "false");
    expect(ui.marks()).toEqual(["PASS", "PASS", "PASS", "FAIL", "SKIP", "SKIP", "SKIP", "SKIP", "SKIP"]);
    expect(ui.verdict()).toHaveTextContent("Refused");
    expect(ui.verdict()).toHaveTextContent("MARKET_CLOSED");
    expect(ui.verdict()).toHaveTextContent("Decision logged · gas 111,116");
    expect(ui.verdict().firstElementChild).toHaveAttribute("data-verdict", "refused");
    expect(ui.verdict().firstElementChild).toHaveAttribute("data-reason", "MARKET_CLOSED");
    expect(screen.getByText("replay · Base fork · block 53,551,627")).toBeInTheDocument();
  });

  it("Thursday passes all nine and is allowed", async () => {
    const ui = setup();
    await userEvent.click(ui.thu());
    expect(ui.thu()).toHaveAttribute("aria-pressed", "true");
    expect(ui.sat()).toHaveAttribute("aria-pressed", "false");
    expect(ui.marks()).toEqual(Array(9).fill("PASS"));
    expect(ui.verdict()).toHaveTextContent("Allowed");
    expect(ui.verdict()).toHaveTextContent("Swap executed · gas 758,192");
    expect(ui.verdict().firstElementChild).toHaveAttribute("data-verdict", "allowed");
  });

  it("keeps the same live region node, so screen readers announce the change", async () => {
    const ui = setup();
    const before = ui.verdict();
    await userEvent.click(ui.thu());
    expect(ui.verdict()).toBe(before);
    expect(before).toHaveAttribute("aria-live", "polite");
  });

  it("clicking the pressed moment replays it without changing state", async () => {
    const ui = setup();
    const firstList = ui.list();
    await userEvent.click(ui.sat());
    expect(ui.list()).not.toBe(firstList);
    expect(ui.sat()).toHaveAttribute("aria-pressed", "true");
    expect(ui.marks()).toHaveLength(9);
    expect(ui.verdict()).toHaveTextContent("Refused");
  });

  it("toggles from the keyboard", async () => {
    const ui = setup();
    ui.thu().focus();
    await userEvent.keyboard("{Enter}");
    expect(ui.verdict()).toHaveTextContent("Allowed");
    ui.sat().focus();
    await userEvent.keyboard(" ");
    expect(ui.verdict()).toHaveTextContent("Refused");
  });
});
