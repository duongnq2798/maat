import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveStrip, STRIP_RESERVE } from "@/components/live/LiveStrip";
import { VerdictLine } from "@/components/live/VerdictLine";
import { type Headline, BUY_LEAD, buyLineText, headlineText, REFUSED } from "@/lib/live/verdict";
import { LIVE_RPCS } from "@/lib/live/rpc";
import { type Answer, advance, fakeReader, FRI, installLiveClocks, readingAt, SAT } from "./helpers/fake-reader";

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
const readAge = () => strip().querySelector("[data-read-age]")?.textContent;

/** An IntersectionObserver that reports each element on screen as soon as it watches it. */
class OnScreenObserver {
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }
  observe(target: Element) {
    this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (Element.prototype as { animate?: unknown }).animate;
});

describe("the live strip in its Readout (spec 2026-11-23 sections 3.5 and 6.1; spec 2026-11-27 section 1)", () => {
  it("keeps the strip's DOM: announcer, one <p> of two block rows led by the labelled verdict, the bezel keys, then the noscript", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    const s = strip();
    expect(s).toHaveAttribute("data-readout");
    expect(s).toHaveAttribute("data-live-strip", "live");
    expect(s).toHaveAttribute("tabindex", "-1");
    expect([...s.children].map((c) => c.tagName)).toEqual(["SPAN", "P", "DIV", "NOSCRIPT"]);
    expect(s.children[2]).toHaveAttribute("data-readout-keys");
    expect(rows()).toHaveLength(2);
    for (const row of rows()) expect(row.className.split(" ")).toContain("block");
    // The labelled verdict leads (culture plan Q5), then the block it was read at, its time and the way to /now.
    const [verdict, block] = rows();
    const line = verdict!.querySelector("[data-verdict-line]")!;
    // Its label is a kicker of its own, so the verdict, in the vault's grammar, is the line set at the verdict size.
    expect(line.firstElementChild).toHaveAttribute("data-verdict-lead");
    expect(line.firstElementChild!.textContent).toBe("Right now, a buy would be:");
    expect(verdict).toHaveTextContent("Right now, a buy would be: Refused · Market closedMARKET_CLOSED");
    expect(block!.querySelector(".readout-figure")).not.toBeNull();
    expect(block).toHaveTextContent("LIVE");
    expect(block).toHaveTextContent("10:00 ET");
    expect(block).toHaveTextContent("All 13 tokenized stocks");
    expect(screen.getByRole("link", { name: "All 13 tokenized stocks" })).toHaveAttribute("href", "/now");
    expect(s.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(s.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("leaves the session, the countdown and each token's lamp and premium to /now", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    expect(strip()).not.toHaveTextContent("Saturday · NYSE closed");
    expect(strip().querySelector("[data-countdown], [data-basket], [data-lamp], [data-meter]")).toBeNull();
    expect(strip()).not.toHaveTextContent(/UTC/);
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

  it("gives the block's time in New York in session too", async () => {
    await mount({ timestamp: FRI }, FRI + 14);
    expect(rows()[1]).toHaveTextContent("11:43 ET");
  });

  it("holds the line as it is while Pause is pressed, and says At the last read once it is not live", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    const pause = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(pause);
    await advance(3_600_000);
    expect(strip()).toHaveAttribute("data-live-strip", "live");
    expect(rows()[0]).toHaveTextContent("Right now, a buy would be:");
    fake.hold();
    fireEvent.click(pause);
    // Released: the held reading is an hour old, so it is stale, and its label no longer says "Right now".
    expect(strip()).toHaveAttribute("data-live-strip", "stale");
    expect(strip()).not.toHaveTextContent("Right now");
    expect(strip()).toHaveTextContent("At the last read, a buy would be: Refused · Market closed");
    fake.release({ timestamp: SAT + 3600 });
    await advance(0);
    expect(strip()).toHaveAttribute("data-live-strip", "live");
    expect(rows()[0]).toHaveTextContent("Right now, a buy would be:");
  });

  it("shows unlit ghost segments, and no lamp or key but Pause, while the first read is in flight", async () => {
    await mount({ timestamp: SAT }, SAT + 14, { hold: true });
    expect(strip()).toHaveAttribute("data-live-strip", "reading");
    expect(strip().querySelector("[data-ghost]")).toHaveAttribute("data-ghost", "88,888,888");
    expect(rows()[0]).toHaveTextContent("Reading Base mainnet…");
    expect(strip().querySelector("[data-digits], [data-lamp], [data-read-age], [data-refresh-key]")).toBeNull();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("keeps Pause in the error state, next to the line's Retry, with no Read again", async () => {
    await mount("down", SAT + 14);
    expect(strip()).toHaveAttribute("data-live-strip", "error");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(strip().querySelector("[data-refresh-key], [data-read-age]")).toBeNull();
  });

  it("writes the read age and the RPC host on the bezel, says paused while paused, and Read again reads at once", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    expect(readAge()).toBe(`read 0 s ago · ${HOST}`);
    await advance(5_000);
    expect(readAge()).toBe(`read 5 s ago · ${HOST}`);
    const pause = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(pause);
    expect(readAge()).toBe(`paused · ${HOST}`);
    fireEvent.click(pause);
    fake.hold();
    const again = strip().querySelector<HTMLButtonElement>("[data-refresh-key]")!;
    expect(again).toHaveTextContent("Read again");
    fireEvent.click(again);
    expect(again).toHaveTextContent("Reading…");
    expect(again).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(again);
    expect(fake.multicalls()).toBe(2);
    fake.release({ timestamp: SAT });
    await advance(0);
    expect(again).toHaveTextContent("Read again");
    expect(again).not.toHaveAttribute("aria-disabled");
    expect(readAge()).toBe(`read 0 s ago · ${HOST}`);
  });

  it("runs the scan line once per new reading on screen, never for the first reading and never while paused", async () => {
    vi.stubGlobal("IntersectionObserver", OnScreenObserver);
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} }));
    const animate = vi.fn<Element["animate"]>(() => ({}) as Animation);
    Element.prototype.animate = animate as unknown as Element["animate"];
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    const scanLine = strip().querySelector("[data-scan]");
    expect(scanLine).not.toBeNull();
    expect(animate).not.toHaveBeenCalled();
    await advance(30_000);
    expect(fake.multicalls()).toBe(2);
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.contexts[0]).toBe(scanLine);
    // Paused: no read starts, and a reading that Read again asks for lands on screen without a scan.
    const pause = screen.getByRole("button", { name: "Pause" });
    fireEvent.click(pause);
    await advance(30_000);
    expect(fake.multicalls()).toBe(2);
    fake.set({ timestamp: SAT + 60 });
    fireEvent.click(strip().querySelector<HTMLButtonElement>("[data-refresh-key]")!);
    await advance(0);
    expect(fake.multicalls()).toBe(3);
    expect(strip().querySelector(":scope > p")).toHaveAttribute("data-live-time", String(SAT + 60));
    expect(animate).toHaveBeenCalledTimes(1);
    // Released: the next reading scans again.
    fireEvent.click(pause);
    await advance(30_000);
    expect(fake.multicalls()).toBe(4);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.contexts[1]).toBe(scanLine);
  });

  it("reserves one min-height per breakpoint, never a fixed height, so a taller frame grows the window", async () => {
    await mount({ timestamp: SAT }, SAT + 14);
    expect(STRIP_RESERVE).toMatch(/^min-h-\[\d+px\] sm:min-h-\[\d+px\] min-\[62\.5rem\]:min-h-\[\d+px\] xl:min-h-\[\d+px\]$/);
    for (const cls of STRIP_RESERVE.split(" ")) expect(strip().className.split(" ")).toContain(cls);
    expect(strip().className).not.toMatch(/(^|\s)([^\s:]+:)?h-\[/);
  });

  it("sets the live verdict line larger than the block number at every width, the block number with a weight settle, and keeps the scan line hidden at rest", async () => {
    // Every font size the verdict line takes, at any width and for any headline, is above the block number's one size.
    const px = (body: string) => [...body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px\s*;/g)].map((m) => Number(m[1]));
    const figure = [...css.matchAll(/\.readout-figure\s*\{([^}]*)\}/g)].flatMap((m) => px(m[1]!));
    const verdict = [...css.matchAll(/\.readout-verdict[^{,]*\{([^}]*)\}/g)].flatMap((m) => px(m[1]!));
    expect(figure).toHaveLength(1);
    expect(verdict.length).toBeGreaterThan(1);
    for (const size of verdict) expect(size).toBeGreaterThan(figure[0]!);
    expect(css).toMatch(/\.readout-figure\s*\{[^}]*font-weight:\s*560;[^}]*\}/);
    // The label sits on a line of its own above the verdict, in every headline; a headline that names a reason for
    // each token keeps its reasons at the strip's own 13 px (its verb: next test).
    expect(css).toMatch(/\.readout-verdict \[data-verdict-lead\]\s*\{[^}]*display:\s*block;[^}]*\}/);
    expect(css).not.toMatch(/\[data-verdict-lead\]\s*\{\s*display:\s*inline;/);
    expect(css).toMatch(/\.readout-verdict\[data-verdict-line="mixed"\]\s*\{[^}]*font-size:\s*13px;[^}]*\}/);
    // The live line carries the class; a muted line, on a reading that is not live, keeps the strip's own size.
    await mount({ timestamp: SAT }, SAT + 14);
    expect(strip().querySelector("[data-verdict-line]")!.className.split(" ")).toContain("readout-verdict");
    expect(css).toMatch(/\.readout-digits\s*\{\s*animation:\s*wght-settle var\(--t-flip\) var\(--ease-instrument\) both;\s*\}/);
    expect(css).toMatch(/@keyframes wght-settle\s*\{\s*from\s*\{\s*font-weight:\s*300;\s*\}\s*\}/);
    expect(css).toMatch(/\.readout-scan\s*\{[^}]*position:\s*absolute;[^}]*height:\s*1px;[^}]*visibility:\s*hidden;[^}]*\}/);
  });

  it("in a headline that refuses some tokens, sets its Refused at the verdict's own size at every width, the reasons at the strip's 13 px", () => {
    const mixed: Headline = {
      kind: "mixed",
      refused: [
        { symbol: "NVDAc", reason: "FEED_STALE" },
        { symbol: "GOOGLc", reason: "MULTIPLIER_COOLDOWN" },
      ],
      passed: ["AAPLc"],
    };
    const buy = (h: Headline) => ({ text: buyLineText(h, []), lead: BUY_LEAD, verb: REFUSED });
    const all: Headline = { kind: "refuse-all", reason: "MARKET_CLOSED" };
    const { container } = render(
      <>
        <VerdictLine headline={mixed} grammar={buy(mixed)} palette="chassis" className="readout-verdict" lead />
        <VerdictLine headline={mixed} />
        <VerdictLine headline={all} grammar={buy(all)} palette="chassis" className="readout-verdict" lead />
      </>,
    );
    const [strip, now, whole] = [...container.querySelectorAll<HTMLElement>("[data-verdict-line]")];
    // The hero's sentence, word for word, with the verb its own span right after the label; /now keeps its own.
    expect(strip!.textContent).toBe("Right now, a buy would be: Refused for NVDAc: Price feed out of dateFEED_STALE; GOOGLc: Corporate action cooldownMULTIPLIER_COOLDOWN. Market checks pass for AAPLc.");
    expect(now!.textContent).toMatch(/^An agent under Maat.s default mandate would REFUSE NVDAc: /);
    expect(headlineText(mixed)).toMatch(/^An agent under Maat.s default mandate would REFUSE /);
    const word = strip!.querySelectorAll("[data-verdict-word]");
    expect(word).toHaveLength(1);
    expect(word[0]!.textContent).toBe("Refused");
    expect(word[0]!.previousSibling?.textContent).toBe(" ");
    expect(word[0]!.previousSibling?.previousSibling).toHaveAttribute("data-verdict-lead");
    // /now's line and a refuse-all line, set whole at the verdict size, have no such span.
    expect(now!.querySelector("[data-verdict-word]")).toBeNull();
    expect(whole!.querySelector("[data-verdict-word]")).toBeNull();
    expect(whole!.textContent).toBe("Right now, a buy would be: Refused · Market closedMARKET_CLOSED");

    // The verb takes each size the verdict line takes, base, 40rem and 80rem, in the same order.
    const sizes = (selector: RegExp) =>
      [...css.matchAll(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, "g"))].map((m) => /font-size:\s*(\d+)px;/.exec(m[1]!)?.[1]);
    const verdict = sizes(/\.readout-verdict/);
    expect(verdict).toEqual(["22", "18", "22"]);
    expect(sizes(/\.readout-verdict\[data-verdict-line="mixed"\] \[data-verdict-word\]/)).toEqual(verdict);
  });

  it("labels a premium refusal with its premium against the limit (spec 2026-11-27 section 4)", () => {
    const reading = readingAt(SAT);
    const nvda = reading.verdicts.find((v) => v.symbol === "NVDAc")!;
    const verdicts = [{ ...nvda, premiumBps: 143n }];
    const h: Headline = { kind: "mixed", refused: [{ symbol: "NVDAc", reason: "PREMIUM_TOO_HIGH" }], passed: ["GOOGLc", "AAPLc"] };
    expect(buyLineText(h, verdicts, { limit: 100 })).toBe(
      "Right now, a buy would be: Refused for NVDAc: Pool price too far from oracle (PREMIUM_TOO_HIGH) · pool vs Chainlink 143 bps · limit 100. Market checks pass for GOOGLc and AAPLc.",
    );
  });
});
