import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { meterText } from "@/components/instrument/Meter";
import { LiveStrip, STRIP_RESERVE } from "@/components/live/LiveStrip";
import { FACTS } from "@/content/facts";
import { LIVE_RPCS } from "@/lib/live/rpc";
import { type Answer, advance, fakeReader, FRI, installLiveClocks, readingAt, SAT } from "./helpers/fake-reader";
import { passingBasket } from "./helpers/live";

installLiveClocks();

// Read by path, as the other jsdom tests do: under jsdom, Vite resolves new URL(..., import.meta.url) to an http URL.
const css = readFileSync("app/globals.css", "utf8");
const HOST = new URL(LIVE_RPCS[0]!).host;

/** The strip on its own provider, the visitor's clock at `wallSec`, the first read answered unless held. */
async function mount(first: Answer, wallSec: number, opts: { hold?: boolean } = {}) {
  vi.setSystemTime(wallSec * 1000);
  const fake = fakeReader(first);
  if (opts.hold) fake.hold();
  render(<LiveStrip reader={fake.reader} />);
  await advance(0);
  return fake;
}

const strip = () => document.querySelector<HTMLElement>("[data-live-strip]")!;
const rows = () => [...strip().querySelectorAll<HTMLElement>(":scope > p > span")];
const countdown = () => strip().querySelector("[data-countdown]");
const readAge = () => strip().querySelector("[data-read-age]")?.textContent;

describe("the live strip in its Readout (spec 2026-11-23 sections 3.5 and 6.1)", () => {
  it("keeps the strip's DOM: announcer, one <p> of three block rows, the bezel keys, then the noscript", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    const s = strip();
    expect(s).toHaveAttribute("data-readout");
    expect(s).toHaveAttribute("data-live-strip", "live");
    expect(s).toHaveAttribute("tabindex", "-1");
    expect([...s.children].map((c) => c.tagName)).toEqual(["SPAN", "P", "DIV", "NOSCRIPT"]);
    expect(s.children[2]).toHaveAttribute("data-readout-keys");
    expect(rows()).toHaveLength(3);
    for (const row of rows()) expect(row.className.split(" ")).toContain("block");
    expect(s.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(s.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("names the block link by its whole number, writes it in ten digit cells, and marks the reading live", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    const link = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(link).toHaveAttribute("href", "https://basescan.org/block/60013066");
    const digits = link.querySelector("[data-digits]")!;
    expect(digits.children).toHaveLength(10);
    expect(digits.textContent).toBe("60,013,066");
    expect(screen.getAllByText("LIVE", { exact: true })).toHaveLength(1);
    const p = strip().querySelector(":scope > p")!;
    expect(p).toHaveAttribute("data-live", "60013066");
    expect(p).toHaveAttribute("data-live-host", HOST);
    expect(p).toHaveAttribute("data-live-time", String(SAT));
  });

  it("counts down to the next open on a closed day, and HOLD freezes the countdown", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    expect(rows()[1]).toHaveTextContent("Saturday · NYSE closed · opens Mon 09:30 ET · in 1 d 23 h");
    expect(countdown()).toHaveTextContent("opens Mon 09:30 ET · in 1 d 23 h");
    const hold = screen.getByRole("button", { name: "Hold" });
    fireEvent.click(hold);
    await advance(3_600_000);
    expect(strip()).toHaveAttribute("data-live-strip", "live");
    expect(countdown()).toHaveTextContent("opens Mon 09:30 ET · in 1 d 23 h");
    fake.hold();
    fireEvent.click(hold);
    // Released: the held reading is an hour old, so it is stale, without a countdown, while the new read runs.
    expect(strip()).toHaveAttribute("data-live-strip", "stale");
    expect(countdown()).toBeNull();
    expect(rows()[1]).toHaveTextContent("Saturday · NYSE closed");
    fake.release({ timestamp: SAT + 3600 });
    await advance(0);
    expect(strip()).toHaveAttribute("data-live-strip", "live");
    expect(countdown()).toHaveTextContent("opens Mon 09:30 ET · in 1 d 22 h");
  });

  it("shows no countdown in session", async () => {
    await mount({ timestamp: FRI }, FRI + 14);
    expect(rows()[1]).toHaveTextContent("Friday · open until 16:00 ET");
    expect(countdown()).toBeNull();
  });

  it("lights a lamp and writes a premium meter for each basket token, from the reading and FACTS", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    const verdicts = readingAt(SAT).verdicts;
    const limit = FACTS.mandate.value.maxPremiumBps;
    for (const symbol of FACTS.basket.value) {
      const cell = strip().querySelector(`[data-basket-token="${symbol}"]`)!;
      expect(cell).toHaveTextContent(symbol);
      expect(cell.querySelector("[data-lamp]")).toHaveAttribute("data-lamp", "refuse");
      const v = verdicts.find((t) => t.symbol === symbol)!;
      const meter = cell.querySelector("[data-meter]");
      if (v.premiumBps === null) expect(cell).toHaveTextContent("premium not read");
      else expect(meter).toHaveTextContent(meterText(Number(v.premiumBps), limit, "bps"));
    }
    // The lamps print their word only: the one reason tag is the verdict line's.
    expect(strip().querySelectorAll("[data-reason-tag]")).toHaveLength(1);
  });

  it("lights every basket lamp PASS when the default mandate refuses none of them", async () => {
    await mount({ timestamp: FRI, edit: passingBasket }, FRI + 14);
    const lamps = [...strip().querySelectorAll("[data-basket-token] [data-lamp]")].map((l) => l.getAttribute("data-lamp"));
    expect(lamps).toEqual(["pass", "pass", "pass"]);
  });

  it("shows unlit ghost segments, and no lamp or key but HOLD, while the first read is in flight", async () => {
    await mount({ timestamp: SAT }, SAT + 14, { hold: true });
    expect(strip()).toHaveAttribute("data-live-strip", "reading");
    expect(strip().querySelector("[data-ghost]")).toHaveAttribute("data-ghost", "88,888,888");
    expect(rows()[0]).toHaveTextContent("Reading Base mainnet…");
    expect(strip().querySelector("[data-digits], [data-lamp], [data-read-age], [data-refresh-key]")).toBeNull();
    expect(screen.getByRole("button", { name: "Hold" })).toBeInTheDocument();
  });

  it("keeps HOLD in the error state, next to the line's Retry, with no Refresh", async () => {
    await mount("down", SAT + 14);
    expect(strip()).toHaveAttribute("data-live-strip", "error");
    expect(screen.getByRole("button", { name: "Hold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(strip().querySelector("[data-refresh-key], [data-read-age]")).toBeNull();
  });

  it("writes the read age and the RPC host on the bezel, says held while held, and Refresh reads at once", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    expect(readAge()).toBe(`read 0 s ago · ${HOST}`);
    await advance(5_000);
    expect(readAge()).toBe(`read 5 s ago · ${HOST}`);
    const hold = screen.getByRole("button", { name: "Hold" });
    fireEvent.click(hold);
    expect(readAge()).toBe(`held · ${HOST}`);
    fireEvent.click(hold);
    fake.hold();
    const refresh = strip().querySelector<HTMLButtonElement>("[data-refresh-key]")!;
    expect(refresh).toHaveTextContent("Refresh");
    fireEvent.click(refresh);
    expect(refresh).toHaveTextContent("Refreshing…");
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(refresh);
    expect(fake.multicalls()).toBe(2);
    fake.release({ timestamp: SAT });
    await advance(0);
    expect(refresh).toHaveTextContent("Refresh");
    expect(refresh).not.toHaveAttribute("aria-disabled");
    expect(readAge()).toBe(`read 0 s ago · ${HOST}`);
  });

  it("reserves one fixed height per breakpoint, never a min-height", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    expect(STRIP_RESERVE).toMatch(/^h-\[\d+px\] sm:h-\[\d+px\] min-\[62\.5rem\]:h-\[\d+px\] xl:h-\[\d+px\]$/);
    for (const cls of STRIP_RESERVE.split(" ")) expect(strip().className.split(" ")).toContain(cls);
    expect(strip().className).not.toMatch(/(^|\s)min-h-/);
  });

  it("draws the block number at readout size with a weight settle, and keeps the scan line hidden at rest", () => {
    expect(css).toMatch(
      /\.readout-figure\s*\{\s*font-size:\s*clamp\(26px, 2\.6vw, 38px\);\s*line-height:\s*1\.15;\s*letter-spacing:\s*-0\.02em;\s*font-weight:\s*560;\s*\}/,
    );
    expect(css).toMatch(/\.readout-digits\s*\{\s*animation:\s*wght-settle var\(--t-flip\) var\(--ease-instrument\) both;\s*\}/);
    expect(css).toMatch(/@keyframes wght-settle\s*\{\s*from\s*\{\s*font-weight:\s*300;\s*\}\s*\}/);
    expect(css).toMatch(/\.readout-scan\s*\{[^}]*position:\s*absolute;[^}]*height:\s*1px;[^}]*visibility:\s*hidden;[^}]*\}/);
  });
});
