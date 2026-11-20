import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulator } from "@/components/Simulator";

function setup() {
  const user = userEvent.setup();
  render(<Simulator />);
  const verdict = () => screen.getByRole("status").firstElementChild as HTMLElement;
  return {
    user,
    verdict,
    reason: () => verdict().getAttribute("data-reason"),
    // The plain label over its code, inside the verdict box.
    tag: () => verdict().querySelector<HTMLElement>("[data-reason-tag]"),
    marks: () =>
      within(screen.getByRole("list", { name: "Simulated checks" }))
        .getAllByRole("listitem")
        .map((li) => li.getAttribute("data-mark")),
    button: (name: string) => screen.getByRole("button", { name }),
    tape: () => screen.queryByRole("list", { name: "Today's decisions" }),
  };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

describe("Simulator", () => {
  it("keeps the verdict the only status in the section, and says it previews an execution", () => {
    setup();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("IF EXECUTED NOW · SIMULATED");
    expect(screen.queryByText("VAULT DECISION · SIMULATED")).toBeNull();
  });

  it("opens on a yes: the fork's BUY at the fork moment", () => {
    const ui = setup();
    expect(ui.verdict()).toHaveAttribute("data-verdict", "allowed");
    expect(ui.marks()).toEqual(Array(9).fill("PASS"));
    expect(screen.getByRole("status")).toHaveTextContent("It says yes. Change one thing to make it say no.");
    expect(ui.tag()).toHaveAttribute("data-reason-tag", "OK");
    expect(ui.tag()?.textContent).toMatch(/^All checks passed\s*OK$/);
    // The live region reads, in order: the verdict, the plain label, its code, then the meaning line (Review Focus 3).
    expect(screen.getByRole("status")).toHaveTextContent(
      /^IF EXECUTED NOW · SIMULATED\s*Allowed\s*All checks passed\s*OK\s*It says yes\. Change one thing to make it say no\.$/,
    );
    expect(ui.button("NVDAc")).toHaveAttribute("aria-pressed", "true");
    expect(ui.button("Thu 5 Nov · 10:30")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("default mandate · not the contract")).toBeInTheDocument();
  });

  it("says no on Saturday, names the rule over its code, and explains it", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(ui.marks()).toEqual(["PASS", "PASS", "PASS", "FAIL", ...Array(5).fill("SKIP")]);
    expect(screen.getByRole("status")).toHaveTextContent("Refused");
    expect(ui.tag()).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
    expect(ui.tag()?.textContent).toMatch(/^Market closed\s*MARKET_CLOSED$/);
    expect(screen.getByRole("status")).toHaveTextContent("NYSE is closed for the mandate's session");
    // The live region reads, in order: the verdict, the plain label, its code, then the meaning line (Review Focus 3).
    expect(screen.getByRole("status")).toHaveTextContent(
      /^IF EXECUTED NOW · SIMULATED\s*Refused\s*Market closed\s*MARKET_CLOSED\s*NYSE is closed for the mandate's session: a weekend, a holiday or after hours\.$/,
    );
  });

  it("refuses the second $50 of NVDAc in a day, then resets the day", async () => {
    const ui = setup();
    await ui.user.click(ui.button("$50"));
    await ui.user.click(ui.button("Execute"));
    expect(ui.reason()).toBe("CONCENTRATION");
    await ui.user.click(ui.button("Execute"));
    const tape = ui.tape();
    if (!tape) throw new Error("no tape");
    const rows = within(tape).getAllByRole("listitem");
    // \s* leaves the gap between the label and the code to ReasonTag's inline layout.
    expect(rows.map((li) => li.textContent)).toEqual([
      "10:30 BUY NVDAc · $50Allowed",
      expect.stringMatching(/^10:30 BUY NVDAc · \$50Refused · Too much in one stock\s*CONCENTRATION$/),
    ]);
    expect(rows[0]?.querySelector("[data-reason-tag]")).toBeNull();
    expect(rows[1]?.querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "CONCENTRATION");
    expect(screen.getByText("$50 of $100")).toBeInTheDocument();
    await ui.user.click(ui.button("Reset day"));
    expect(ui.tape()).toBeNull();
    expect(ui.reason()).toBe("OK");
  });

  it("says what an Execute did, while the verdict previews the next one", async () => {
    const ui = setup();
    await ui.user.click(ui.button("$50"));
    await ui.user.click(ui.button("Execute"));
    const notice = screen.getByText("Executed 10:30 BUY NVDAc · $50: Allowed");
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(notice).toHaveAttribute("aria-atomic", "true");
    expect(notice).not.toHaveAttribute("role");
    expect(ui.reason()).toBe("CONCENTRATION");
    await ui.user.click(ui.button("Execute"));
    // The same element: the live region never remounts, only its text changes.
    expect(notice).toHaveTextContent("Executed 10:30 BUY NVDAc · $50: Refused · Too much in one stock (CONCENTRATION)");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await ui.user.click(ui.button("Reset day"));
    expect(notice).toBeEmptyDOMElement();
  });

  it("clears the Execute notice when the date changes or the amount stops parsing", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Execute"));
    const notice = screen.getByText("Executed 10:30 BUY NVDAc · $20: Allowed");
    await ui.user.click(ui.button("Fri 6 Nov · 19:00"));
    expect(notice).toBeEmptyDOMElement();
    await ui.user.click(ui.button("Thu 5 Nov · 10:30"));
    await ui.user.click(ui.button("Execute"));
    expect(notice).toHaveTextContent("Executed 10:30 BUY NVDAc · $20: Allowed");
    await ui.user.type(screen.getByRole("textbox", { name: "Amount in US dollars" }), "x");
    expect(ui.button("Execute")).toBeDisabled();
    expect(notice).toBeEmptyDOMElement();
  });

  it("starts a new day when the date changes", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Execute"));
    expect(ui.tape()).not.toBeNull();
    await ui.user.click(ui.button("Fri 6 Nov · 19:00"));
    expect(ui.tape()).toBeNull();
    expect(ui.reason()).toBe("MARKET_CLOSED");
  });

  it("shows the balance row past the vault's USDC, and blocks Execute while the amount does not parse", async () => {
    const ui = setup();
    const amount = screen.getByRole("textbox", { name: "Amount in US dollars" });
    await ui.user.clear(amount);
    await ui.user.type(amount, "$1,000");
    expect(ui.reason()).toBe("INSUFFICIENT_BALANCE");
    const checks = screen.getByRole("list", { name: "Simulated checks" });
    expect(checks.querySelector('[data-check="balance"]')).toHaveTextContent("$1,000 > $200 USDC");
    await ui.user.type(amount, "x");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Use dollars with up to two decimals, like 50 or 12.50.")).toBeInTheDocument();
    expect(ui.button("Execute")).toBeDisabled();
    expect(ui.reason()).toBe("INSUFFICIENT_BALANCE");
  });

  it("does not flag an amount typed up to a thousands comma, and keeps Execute off until it parses", async () => {
    const ui = setup();
    const amount = screen.getByRole("textbox", { name: "Amount in US dollars" });
    const error = "Use dollars with up to two decimals, like 50 or 12.50.";
    await ui.user.clear(amount);
    for (const half of ["1,", "000,", "0"]) {
      await ui.user.type(amount, half);
      expect(amount, half).not.toHaveAttribute("aria-invalid");
      expect(screen.queryByText(error), half).toBeNull();
      expect(ui.button("Execute"), half).toBeDisabled();
    }
    await ui.user.type(amount, "00");
    expect(amount).toHaveValue("1,000,000");
    expect(ui.button("Execute")).toBeEnabled();
    expect(ui.reason()).toBe("INSUFFICIENT_BALANCE");
    await ui.user.type(amount, ",");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(error)).toBeInTheDocument();
  });

  it("tells the time in New York on the slider, and closes at 16:00", () => {
    const ui = setup();
    const time = screen.getByRole("slider", { name: "Time" });
    expect(time).toHaveAttribute("aria-valuetext", "10:30 ET");
    fireEvent.change(time, { target: { value: "959" } });
    expect(ui.reason()).toBe("OK");
    fireEvent.change(time, { target: { value: "960" } });
    expect([ui.reason(), time.getAttribute("aria-valuetext")]).toEqual(["MARKET_CLOSED", "16:00 ET"]);
  });

  it("takes a date inside the window and ignores one outside it", () => {
    const ui = setup();
    const dayInput = screen.getByLabelText("Day");
    fireEvent.change(dayInput, { target: { value: "2026-11-26" } });
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(screen.getByText("Thursday · Thanksgiving, closed all day")).toBeInTheDocument();
    // A typed date outside the window stays in the field as a draft, with a hint; the day does not move.
    fireEvent.change(dayInput, { target: { value: "2027-02-01" } });
    expect(dayInput).toHaveValue("2027-02-01");
    expect(screen.getByText("Pick a date from Thu 5 Nov to Fri 1 Jan.")).toBeInTheDocument();
    expect(dayInput).toHaveAttribute("aria-invalid", "true");
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(screen.getByText("Thursday · Thanksgiving, closed all day")).toBeInTheDocument();
    fireEvent.blur(dayInput);
    expect(dayInput).toHaveValue("2026-11-26");
    expect(screen.queryByText("Pick a date from Thu 5 Nov to Fri 1 Jan.")).toBeNull();
    expect(dayInput).not.toHaveAttribute("aria-invalid");
  });

  it("shows a preset's day in the field after an out-of-window draft", async () => {
    const ui = setup();
    const dayInput = screen.getByLabelText("Day");
    fireEvent.change(dayInput, { target: { value: "2027-02-01" } });
    await ui.user.click(ui.button("Sat 7 Nov"));
    expect(dayInput).toHaveValue("2026-11-07");
    expect(screen.queryByText("Pick a date from Thu 5 Nov to Fri 1 Jan.")).toBeNull();
  });

  it("opens a share link on its own scenario, recomputing every verdict", () => {
    window.history.replaceState(null, "", "/?day=2026-11-05&at=1030&buy=NVDAc-50&tape=1030-NVDAc-50#try");
    const ui = setup();
    expect(ui.reason()).toBe("CONCENTRATION");
    const tape = ui.tape();
    if (!tape) throw new Error("no tape");
    expect(within(tape).getAllByRole("listitem")).toHaveLength(1);
  });

  it("prefills a post on X with the verdict and the link", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    const url = new URL(screen.getByRole("link", { name: "Post on X" }).getAttribute("href") ?? "");
    expect(`${url.origin}${url.pathname}`).toBe("https://x.com/intent/post");
    expect(url.searchParams.get("text")).toBe(
      "I tried to buy $20 of NVDAc on Sat 7 Nov at 10:30 ET. Maat's simulator said no: Market closed (MARKET_CLOSED).",
    );
    expect(url.searchParams.get("url")).toBe("http://localhost:3000/?day=2026-11-07&at=1030&buy=NVDAc-20#try");
  });

  it("copies the share link, or shows it when the clipboard says no", async () => {
    const ui = setup();
    await ui.user.click(ui.button("Sat 7 Nov"));
    await ui.user.click(ui.button("Copy link"));
    const link = "http://localhost:3000/?day=2026-11-07&at=1030&buy=NVDAc-20#try";
    expect(await navigator.clipboard.readText()).toBe(link);
    const notice = screen.getByText("Link copied.");
    expect(notice).toHaveAttribute("aria-live", "polite");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    await ui.user.click(ui.button("Link copied"));
    expect(screen.getByRole("textbox", { name: "Copy this link:" })).toHaveValue(link);
    expect(notice).toHaveTextContent("Copy the link below.");
    // A new link ends both the copy state and its notice.
    await ui.user.click(ui.button("Fri 6 Nov · 19:00"));
    expect(screen.queryByRole("textbox", { name: "Copy this link:" })).toBeNull();
    expect(notice).toBeEmptyDOMElement();
  });

  it("offers Now in New York time, whatever the visitor's time zone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T20:00:00Z")); // Sat 15:00 ET
    const ui = setup();
    await ui.user.click(await screen.findByRole("button", { name: "Now" }));
    expect(screen.getByText("15:00 ET")).toBeInTheDocument();
    expect(ui.reason()).toBe("MARKET_CLOSED");
  });

  it("reads the clock again when Now is clicked", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T20:00:00Z")); // Sat 15:00 ET
    const ui = setup();
    const now = await screen.findByRole("button", { name: "Now" });
    vi.setSystemTime(new Date("2026-11-07T20:05:00Z"));
    await ui.user.click(now);
    expect(screen.getByText("15:05 ET")).toBeInTheDocument();
    expect(ui.button("Now")).toHaveAttribute("aria-pressed", "true");
  });

  it("hides Now, and stays put, when the clock has left the dates the calendar lists by the click", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T20:00:00Z"));
    const ui = setup();
    const now = await screen.findByRole("button", { name: "Now" });
    vi.setSystemTime(new Date("2027-03-01T15:00:00Z"));
    await ui.user.click(now);
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
    expect(screen.getByText("10:30 ET")).toBeInTheDocument();
    expect(ui.button("Thu 5 Nov · 10:30")).toHaveAttribute("aria-pressed", "true");
  });

  it("hides Now outside the dates the calendar lists", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-01T15:00:00Z"));
    setup();
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
  });
});
