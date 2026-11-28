import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type Address, zeroAddress, zeroHash } from "viem";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { VAULT_UNREACHABLE, type RealVaultDeps } from "@/components/RealVault";
import { Simulator } from "@/components/Simulator";
import { FACTS } from "@/content/facts";
import { dayLabel, formatInt } from "@/content/format";
import type { LedgerClient } from "@/lib/chain/load";
import { PREVIEW_ID, previewTokens } from "@/lib/chain/preview";

function setup(vault?: RealVaultDeps) {
  const user = userEvent.setup();
  render(<Simulator vaultDeps={vault} />);
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
    // The live region reads, in order: the verdict, the plain label, its code, then the meaning line.
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
    // The live region reads, in order: the verdict, the plain label, its code, then the meaning line.
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
    fireEvent.change(dayInput, { target: { value: "2028-01-03" } });
    expect(dayInput).toHaveValue("2028-01-03");
    expect(screen.getByText("Pick a date from Thu 5 Nov 2026 to Fri 24 Dec 2027.")).toBeInTheDocument();
    expect(dayInput).toHaveAttribute("aria-invalid", "true");
    expect(ui.reason()).toBe("MARKET_CLOSED");
    expect(screen.getByText("Thursday · Thanksgiving, closed all day")).toBeInTheDocument();
    fireEvent.blur(dayInput);
    expect(dayInput).toHaveValue("2026-11-26");
    expect(screen.queryByText("Pick a date from Thu 5 Nov 2026 to Fri 24 Dec 2027.")).toBeNull();
    expect(dayInput).not.toHaveAttribute("aria-invalid");
  });

  it("shows a preset's day in the field after an out-of-window draft", async () => {
    const ui = setup();
    const dayInput = screen.getByLabelText("Day");
    fireEvent.change(dayInput, { target: { value: "2028-01-03" } });
    await ui.user.click(ui.button("Sat 7 Nov"));
    expect(dayInput).toHaveValue("2026-11-07");
    expect(screen.queryByText("Pick a date from Thu 5 Nov 2026 to Fri 24 Dec 2027.")).toBeNull();
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
    vi.setSystemTime(new Date("2028-01-03T15:00:00Z"));
    await ui.user.click(now);
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
    expect(screen.getByText("10:30 ET")).toBeInTheDocument();
    expect(ui.button("Thu 5 Nov · 10:30")).toHaveAttribute("aria-pressed", "true");
  });

  it("hides Now outside the dates the calendar lists", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2028-01-03T15:00:00Z"));
    setup();
    expect(screen.queryByRole("button", { name: "Now" })).toBeNull();
  });

  it("says, while Now is the moment, that the rows tagged fork value still hold the fork block, and links /now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T20:00:00Z")); // Sat 15:00 ET
    const ui = setup();
    const forkTags = () => [...document.querySelectorAll("[data-fork-tag]")].map((t) => t.textContent);
    const fixedRows = () => document.querySelectorAll("li[data-fixed]").length;
    const note = () => screen.queryByText(/^Now sets the time only\./);
    expect(note()).toBeNull();

    await ui.user.click(await screen.findByRole("button", { name: "Now" }));
    expect(ui.button("Now")).toHaveAttribute("aria-pressed", "true");
    const shown = note();
    if (!shown) throw new Error("no Now note");
    expect(shown.tagName).toBe("P");
    expect(shown).toHaveTextContent(
      `Now sets the time only. The rows tagged fork value hold what the fork test of 5-7 Nov read at Base block ${formatInt(FACTS.forkBlock.value)} (${dayLabel(FACTS.forkDay.value)}, ${FACTS.forkTimeEt.value} ET), not now. Read the live values on Right now on Base`,
    );
    // The badge's days, 5-7 Nov, are the fork test's; the note names the one its values were read on.
    expect(shown).toHaveTextContent("the fork test of 5-7 Nov read at Base block 53,551,627 (Thu 5 Nov, 10:30 ET), not now.");
    expect(within(shown).getByRole("link", { name: "Read the live values on Right now on Base" })).toHaveAttribute("href", "/now");
    expect(shown).not.toHaveTextContent(/safe/i);
    // Under the checks, above the verdict box, and outside the one live region.
    const checks = screen.getByRole("list", { name: "Simulated checks" });
    const status = screen.getByRole("status");
    expect(checks.compareDocumentPosition(shown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shown.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status).not.toContainElement(shown);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(fixedRows()).toBeGreaterThan(0);
    // Each fixed row carries the fork badge of spec 2026-11-27 section 3; under Now its first word says it is a value.
    expect(forkTags()).toEqual(Array(fixedRows()).fill("fork value · 5-7 Nov"));

    await ui.user.click(ui.button("Thu 5 Nov · 10:30"));
    expect(note()).toBeNull();
    expect(fixedRows()).toBeGreaterThan(0);
    expect(forkTags()).toEqual(Array(fixedRows()).fill("fork · 5-7 Nov"));
  });

  it("drops the Now note once the time moves off the clock's minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T20:00:00Z")); // Sat 15:00 ET
    const ui = setup();
    await ui.user.click(await screen.findByRole("button", { name: "Now" }));
    expect(screen.getByText(/^Now sets the time only\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "901" } });
    expect(ui.button("Now")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/^Now sets the time only\./)).toBeNull();
    expect([...document.querySelectorAll("[data-fork-tag]")].every((t) => t.textContent === "fork · 5-7 Nov")).toBe(true);
  });
});

const VAULT: Address = "0x00000000000000000000000000000000000Aa001";
const HEAD = 61_964_493n;
const tokenOf = (symbol: string): Address => {
  const t = previewTokens().find((p) => p.symbol === symbol);
  if (!t) throw new Error(`previewTokens() has no ${symbol}`);
  return t.address;
};

interface ReadCall {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
  blockNumber?: bigint;
}

/** A vault on a fake Base: previewIntent answers `answer` (a Reason number, an error, or a later number) at HEAD. */
function fakeVault(answer: number | Error | (() => Promise<number>)) {
  const calls: ReadCall[] = [];
  const client = {
    getBlockNumber: async () => HEAD,
    readContract: async (c: ReadCall) => {
      calls.push(c);
      if (c.functionName !== "previewIntent") throw new Error(`unexpected ${c.functionName}`);
      if (answer instanceof Error) throw answer;
      return typeof answer === "function" ? answer() : answer;
    },
  } as unknown as LedgerClient;
  return { deps: { client, vault: VAULT } satisfies RealVaultDeps, calls };
}

/** The Intent struct previewIntent gets for a BUY: a fixed id, no minOut, no payee and a zero rationale hash. */
const buyIntent = (token: Address, amount: bigint) => ({ id: PREVIEW_ID, action: 0, token, amount, minOut: 0n, payee: zeroAddress, rationaleHash: zeroHash });

describe("Simulator: asking the real vault", () => {
  const panel = () => {
    const el = document.querySelector<HTMLElement>("[data-real-vault]");
    if (!el) throw new Error("no real-vault panel");
    return el;
  };
  const state = () => panel().getAttribute("data-real-vault");
  const side = (which: "simulation" | "vault") => panel().querySelector<HTMLElement>(`[data-answer="${which}"]`);
  const ask = () => screen.getByRole("button", { name: "Ask the real vault" });
  const settles = (s: string) => vi.waitFor(() => expect(state()).toBe(s), { timeout: 5_000 });

  // The chain code loads on the first ask. Its first import in a test run is a transform that can outlast a test's
  // timeout on a busy machine, so it happens here, once, and the tests time the panel only.
  beforeAll(async () => {
    await Promise.all([import("@/lib/chain/preview"), import("@/lib/chain/rpc"), import("@/lib/chain/config"), import("@/lib/chain/load")]);
  }, 60_000);

  it("offers it as free and walletless, below the simulated verdict and outside its live region", () => {
    setup();
    expect(state()).toBe("idle");
    expect(panel()).toHaveTextContent("THE REAL VAULT · BASE MAINNET");
    expect(panel()).toHaveTextContent(
      "Sends BUY NVDAc · $20 to the deployed vault as previewIntent, a free eth_call at the latest block. No wallet: nothing is signed or sent.",
    );
    const status = screen.getByRole("status");
    expect(status.compareDocumentPosition(panel()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status).not.toContainElement(panel());
    expect(ask()).toBeEnabled();
  });

  it("sends the simulated intent as one previewIntent at the head block, and shows the vault's reason beside the simulation's", async () => {
    const vault = fakeVault(6); // MARKET_CLOSED
    const ui = setup(vault.deps);
    await ui.user.click(ask());
    await settles("answer");
    expect(vault.calls).toEqual([
      { address: VAULT, abi: expect.anything(), functionName: "previewIntent", args: [buyIntent(tokenOf("NVDAc"), 20_000_000n)], blockNumber: HEAD },
    ]);
    expect(side("simulation")?.querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "OK");
    expect(side("simulation")).toHaveTextContent(/^SIMULATION\s*Allowed\s*All checks passed\s*OK$/);
    expect(side("vault")?.querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
    expect(side("vault")).toHaveTextContent(/^REAL VAULT · BLOCK 61,964,493\s*Refused\s*Market closed\s*MARKET_CLOSED$/);
    const match = panel().querySelector("[data-vault-match]");
    expect(match).toHaveAttribute("data-vault-match", "differ");
    expect(match).toHaveTextContent(/^They differ\. The simulation is a model: it answers for Thu 5 Nov · 10:30 ET/);
    // The simulation's own answer does not move, and the verdict stays the only status.
    expect(ui.reason()).toBe("OK");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    const live = panel().querySelector("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toContainElement(side("vault"));
  });

  it("announces the vault's answer alone: the simulation's side and the comparison follow the slider, outside the live region", async () => {
    const ui = setup(fakeVault(6).deps); // MARKET_CLOSED
    const live = panel().querySelector<HTMLElement>("[aria-live]");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();
    await ui.user.click(ask());
    await settles("answer");
    // The same node from idle to answer, so the answer is announced; it holds the vault's side and nothing else.
    expect(panel().querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(panel().querySelector("[aria-live]")).toBe(live);
    expect(live).toContainElement(side("vault"));
    expect(live).not.toContainElement(side("simulation"));
    expect(live).not.toContainElement(panel().querySelector<HTMLElement>("[data-vault-match]"));
    const said = live?.textContent;
    expect(said).toBe(side("vault")?.textContent);
    for (const minute of ["631", "632", "633"]) {
      fireEvent.change(screen.getByLabelText("Time"), { target: { value: minute } });
      expect(live?.textContent).toBe(said);
    }
    expect(state()).toBe("answer");
    expect(panel().querySelector("[data-vault-match]")).toHaveTextContent(/^They differ\. The simulation is a model: it answers for Thu 5 Nov · 10:33 ET/);
  });

  it("says so when the vault gives the simulation's answer", async () => {
    const ui = setup(fakeVault(0).deps);
    await ui.user.click(ask());
    await settles("answer");
    expect(panel().querySelector("[data-vault-match]")).toHaveAttribute("data-vault-match", "same");
    expect(panel().querySelector("[data-vault-match]")).toHaveTextContent(
      "Same answer as the simulation. The vault gave it at block 61,964,493, from its live prices, calendar and holdings.",
    );
  });

  it("keeps the vault's answer when only the moment moves, and compares it with the simulation's new one", async () => {
    const ui = setup(fakeVault(0).deps);
    await ui.user.click(ask());
    await settles("answer");
    const said = panel().querySelector("[aria-live]")?.textContent;
    await ui.user.click(ui.button("Sat 7 Nov"));
    expect(state()).toBe("answer");
    // The vault's answer is not announced again: only the simulation's side and the comparison change.
    expect(panel().querySelector("[aria-live]")?.textContent).toBe(said);
    expect(side("simulation")?.querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "MARKET_CLOSED");
    expect(side("vault")?.querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "OK");
    expect(panel().querySelector("[data-vault-match]")).toHaveTextContent(/^They differ\. The simulation is a model: it answers for Sat 7 Nov · 10:30 ET/);
  });

  it("fails closed on an RPC error: a clear line, and no reason from the vault", async () => {
    const ui = setup(fakeVault(new Error("HTTP request failed.")).deps);
    await ui.user.click(ask());
    await settles("error");
    expect(panel()).toHaveTextContent(`${VAULT_UNREACHABLE} HTTP request failed.`);
    expect(side("vault")).toBeNull();
    expect(panel().querySelector("[data-vault-match]")).toBeNull();
    expect(ui.reason()).toBe("OK");
    // Asking again is allowed.
    expect(ask()).toBeEnabled();
  });

  it("fails closed when the vault answers a number that is not a Reason", async () => {
    const ui = setup(fakeVault(20).deps);
    await ui.user.click(ask());
    await settles("error");
    expect(panel()).toHaveTextContent(VAULT_UNREACHABLE);
    expect(panel()).toHaveTextContent("20 is not a Reason");
    expect(side("vault")).toBeNull();
  });

  it("asks about USDC for the other token, and says so", async () => {
    const vault = fakeVault(3); // TOKEN_NOT_ALLOWED
    const ui = setup(vault.deps);
    await ui.user.click(ui.button("Other token"));
    expect(panel()).toHaveTextContent("Sends BUY USDC · $20 to the deployed vault");
    expect(panel()).toHaveTextContent("USDC stands in for the other token: the mandate does not list it for BUY.");
    await ui.user.click(ask());
    await settles("answer");
    expect(vault.calls.map((c) => c.args?.[0])).toEqual([buyIntent(tokenOf("USDC"), 20_000_000n)]);
    expect(panel().querySelector("[data-vault-match]")).toHaveAttribute("data-vault-match", "same");
  });

  it("drops the vault's answer when the token or amount changes, and keeps a late answer off the newer intent", async () => {
    let release: (n: number) => void = () => {};
    const late = new Promise<number>((resolve) => (release = resolve));
    let first = true;
    const vault = fakeVault(() => {
      if (!first) return Promise.resolve(12); // CONCENTRATION
      first = false;
      return late;
    });
    const ui = setup(vault.deps);
    await ui.user.click(ask());
    await settles("asking");
    expect(ask()).toBeDisabled();
    expect(panel()).toHaveTextContent("Asking the vault on Base…");
    await ui.user.click(ui.button("GOOGLc"));
    expect(state()).toBe("idle");
    expect(ask()).toBeEnabled();
    await ui.user.click(ask());
    await settles("answer");
    // The first ask now answers MARKET_CLOSED; a macrotask later, every promise it chains has run.
    await act(async () => {
      release(6);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(state()).toBe("answer");
    expect(side("vault")?.querySelector("[data-reason-tag]")).toHaveAttribute("data-reason-tag", "CONCENTRATION");
    expect(vault.calls.map((c) => (c.args?.[0] as { token: Address }).token)).toEqual([tokenOf("NVDAc"), tokenOf("GOOGLc")]);
    await ui.user.click(ui.button("$50"));
    expect(state()).toBe("idle");
    expect(side("vault")).toBeNull();
  });

  it("offers no ask while the amount does not parse", async () => {
    const ui = setup(fakeVault(0).deps);
    await ui.user.type(screen.getByRole("textbox", { name: "Amount in US dollars" }), "x");
    expect(ask()).toBeDisabled();
  });

  it("asks over the site's public RPCs by default, and fails closed when they cannot be reached", async () => {
    const ui = setup();
    await ui.user.click(ask());
    await vi.waitFor(() => expect(state()).toBe("error"), { timeout: 10_000 });
    expect(panel()).toHaveTextContent(VAULT_UNREACHABLE);
    const urls = vi.mocked(fetch).mock.calls.map(([input]) => String(input instanceof Request ? input.url : input));
    expect(urls.some((u) => u.startsWith("https://base-rpc.publicnode.com"))).toBe(true);
  }, 15_000);
});
