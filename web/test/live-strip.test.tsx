import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStrip } from "@/components/live/LiveStrip";
import { type Hex, MULTICALL3 } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { type ReasonCode, reasonText } from "@/content/reasons";
import { type CallResult, decodeAggregate3, encodeAggregate3Result, word } from "@/lib/live/abi";
import { HEAD_MAX_LAG_SEC, LIVE_MAX_AGE_MS, REFRESH_MS } from "@/lib/live/freshness";
import { LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
import { decodeSnapshot } from "@/lib/live/snapshot";
import { headline, headlineText, judgeToken, sessionAt } from "@/lib/live/verdict";
import fixture from "./fixtures/live-aggregate3.json";

const BLOCK = BigInt(fixture.expected.blockNumber); // 60,013,066
const FRI = Number(fixture.expected.timestamp); // Fri 2026-11-20 16:43:08 UTC, 11:43 ET: in session
const SAT = Date.UTC(2026, 10, 21, 15, 0, 0) / 1000; // Sat 2026-11-21 15:00 UTC, 10:00 ET

/** The recorded answer, with the block number and timestamp words replaced. */
function results(timestamp: number, block = BLOCK): CallResult[] {
  const r = decodeAggregate3(fixture.response as Hex);
  r[0] = { success: true, returnData: `0x${word(block)}` };
  r[1] = { success: true, returnData: `0x${word(BigInt(timestamp))}` };
  return r;
}

/** What the mandate says about that answer, from FACTS: the strip must say the same. */
function expected(timestamp: number) {
  const s = decodeSnapshot(results(timestamp), FACTS.mandate.value.twapWindowSec);
  const session = sessionAt({ timestamp: s.timestamp, calendar: { source: "repo" } });
  const verdicts = s.tokens.map((t) => judgeToken(t, { timestamp: s.timestamp, session }));
  return { headline: headline(verdicts), verdicts };
}

type Answer = { timestamp: number; block?: bigint } | "down" | "hang";

/** A reader that answers like Base: the recorded multicall, and a deployed MarketCalendar (if any) like the repo calendar. */
function fakeReader(first: Answer) {
  let answer = first;
  const call = vi.fn(async (tx: { to: Hex; data: Hex }): Promise<{ data: Hex; endpoint: string }> => {
    const a = answer;
    if (a === "down") throw new RpcError(LIVE_RPCS.map((endpoint) => ({ endpoint, message: "HTTP 503" })));
    if (a === "hang") return new Promise(() => {});
    if (tx.to.toLowerCase() !== MULTICALL3.toLowerCase()) {
      return { data: `0x${word(regularSession(a.timestamp).open ? 1n : 0n)}`, endpoint: LIVE_RPCS[0]! };
    }
    return { data: encodeAggregate3Result(results(a.timestamp, a.block)), endpoint: LIVE_RPCS[0]! };
  });
  const reader: LiveReader = { call };
  return { reader, call, set: (next: Answer) => void (answer = next) };
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Render the strip with the visitor's clock at `wallSec`, and let the first read answer. */
async function mount(first: Answer, wallSec: number) {
  vi.setSystemTime(wallSec * 1000);
  const fake = fakeReader(first);
  render(<LiveStrip reader={fake.reader} />);
  await advance(0);
  return fake;
}

const strip = () => document.querySelector<HTMLElement>("[data-live-strip]")!;

/** The verdict line as one sentence: each ReasonTag read as "Label (CODE)", the way headlineText writes it. */
function verdictSentence(): string {
  const copy = strip().querySelector("[data-verdict-line]")!.cloneNode(true) as Element;
  for (const tag of copy.querySelectorAll("[data-reason-tag]")) tag.replaceWith(reasonText(tag.getAttribute("data-reason-tag") as ReasonCode));
  return copy.textContent ?? "";
}

const neverSafe = () => expect(document.body.textContent).not.toMatch(/safe/i);

describe("the live strip", () => {
  it("holds no chain value in the static HTML: only the reading state and a line for readers without JavaScript", () => {
    const fake = fakeReader({ timestamp: SAT });
    const html = renderToString(<LiveStrip reader={fake.reader} />);
    expect(html).toContain("Reading Base mainnet");
    expect(html).toMatch(/<noscript>[\s\S]*The live line needs JavaScript\.[\s\S]*Right now on Base[\s\S]*explains what it reads\.[\s\S]*<\/noscript>/);
    expect(html).toMatch(/<noscript>[\s\S]*href="\/now"[\s\S]*<\/noscript>/);
    for (const value of ["60,013,066", "60013066", ">LIVE<", "basescan.org/block/", "REFUSE"]) expect(html).not.toContain(value);
    expect(html).not.toMatch(/safe/i);
    expect(fake.call).not.toHaveBeenCalled();
  });

  it("shows the reading state in the first client render, then a weekend reading as live with its block, session and refusal", async () => {
    vi.setSystemTime((SAT + 14) * 1000);
    const fake = fakeReader({ timestamp: SAT });
    render(<LiveStrip reader={fake.reader} />);
    expect(strip()).toHaveTextContent("Reading Base mainnet…");
    expect(screen.getByRole("status")).toHaveTextContent("Reading Base mainnet…");
    await advance(0);

    const { headline: h } = expected(SAT);
    expect(h).toEqual({ kind: "refuse-all", reason: "MARKET_CLOSED" });
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    const block = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(block).toHaveAttribute("href", "https://basescan.org/block/60013066");
    expect(block).toHaveAttribute("target", "_blank");
    expect(block).toHaveAttribute("rel", "noopener noreferrer");
    expect(strip()).toHaveTextContent("15:00:00 UTC · 10:00 ET");
    expect(strip()).toHaveTextContent("Saturday · NYSE closed");
    expect(strip()).toHaveTextContent("An agent under Maat's default mandate would REFUSE");
    expect(screen.getByText("Market closed")).toBeInTheDocument();
    expect(screen.getByText("MARKET_CLOSED")).toBeInTheDocument();
    expect(verdictSentence()).toBe(headlineText(h));
    expect(screen.getByRole("link", { name: "All 13 B20s" })).toHaveAttribute("href", "/now");
    expect(screen.queryByText("Reading Base mainnet…")).toBeNull();
    neverSafe();
  });

  it("shows the recorded in-session reading with the verdict the default mandate gives it", async () => {
    await mount({ timestamp: FRI }, FRI + 14);
    const { headline: h, verdicts } = expected(FRI);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(strip()).toHaveTextContent("16:43:08 UTC · 11:43 ET");
    expect(strip()).toHaveTextContent("Friday · open until 16:00 ET");
    expect(verdictSentence()).toBe(headlineText(h));
    // The fixture's basket feeds and premiums, against FACTS.mandate: all within limits means all three pass.
    const basket = FACTS.basket.value.map((s) => verdicts.find((v) => v.symbol === s)!);
    const allPass = basket.every((v) => v.mandate === "OK");
    expect(strip()).toHaveTextContent(allPass ? "would pass the market checks for NVDAc, GOOGLc and AAPLc" : "would REFUSE");
    neverSafe();
  });

  it("says NOT LIVE when a refresh fails after a good reading, and keeps the old verdict in muted text", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    fake.set("down");
    await advance(REFRESH_MS);
    expect(fake.call).toHaveBeenCalledTimes(2);
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(strip()).toHaveTextContent("last read block 60,013,066, 30 s ago");
    expect(strip()).toHaveTextContent("the RPC did not answer since");
    expect(screen.getByRole("link", { name: "60,013,066" })).toHaveAttribute("href", "https://basescan.org/block/60013066");
    expect(verdictSentence()).toBe(headlineText(expected(SAT).headline));
    expect(strip().querySelector("[data-verdict-line]")).toHaveAttribute("data-tone", "muted");
    expect(screen.getByRole("status").textContent).toBe(`Not live. ${headlineText(expected(SAT).headline)}`);
    // The next good answer makes it live again.
    fake.set({ timestamp: SAT + 30 });
    await advance(REFRESH_MS);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    neverSafe();
  });

  it("stops saying LIVE once the reading is older than the live limit, and never runs two reads at once", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    fake.set("hang");
    await advance(REFRESH_MS);
    expect(fake.call).toHaveBeenCalledTimes(2);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    // Re-classified every 5 s without a new answer: past the limit, the old reading is no longer live.
    await advance(LIVE_MAX_AGE_MS - REFRESH_MS + 5_000);
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(strip()).toHaveTextContent("last read block 60,013,066, 1 min 35 s ago");
    expect(strip()).not.toHaveTextContent("the RPC did not answer since");
    expect(fake.call).toHaveBeenCalledTimes(2);
    neverSafe();
  });

  it("says NOT LIVE when the RPC's latest block is far behind the visitor's clock", async () => {
    await mount({ timestamp: SAT }, SAT + HEAD_MAX_LAG_SEC + 180);
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(strip()).toHaveTextContent("the RPC's latest block 60,013,066 is 5 min behind your clock");
    expect(strip().querySelector("[data-verdict-line]")).toHaveAttribute("data-tone", "muted");
    neverSafe();
  });

  it("says so when the first read fails, shows nothing old, and reads again on Retry", async () => {
    const fake = await mount("down", SAT + 14);
    expect(strip()).toHaveTextContent(
      "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.",
    );
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(strip().querySelector("[data-verdict-line]")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.",
    );
    neverSafe();
    fake.set({ timestamp: SAT });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advance(0);
    expect(fake.call).toHaveBeenCalledTimes(2);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    neverSafe();
  });

  it("does not read while the tab is hidden, and reads at once when it comes back after the refresh interval", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    visibility = "hidden";
    await advance(REFRESH_MS * 3 + 5_000);
    expect(fake.call).toHaveBeenCalledTimes(1);
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fake.call).toHaveBeenCalledTimes(2);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("waits for the next refresh when a hidden tab comes back sooner than the interval", async () => {
    const fake = await mount({ timestamp: SAT }, SAT + 14);
    visibility = "hidden";
    await advance(10_000);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fake.call).toHaveBeenCalledTimes(1);
    await advance(REFRESH_MS - 10_000);
    expect(fake.call).toHaveBeenCalledTimes(2);
  });

  it("announces only the status and the verdict: a new block alone changes nothing a screen reader hears", async () => {
    vi.setSystemTime((SAT + 14) * 1000);
    const fake = fakeReader({ timestamp: SAT });
    render(<LiveStrip reader={fake.reader} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveClass("sr-only");
    await advance(0);
    const said = `Live. ${headlineText(expected(SAT).headline)}`;
    expect(status.textContent).toBe(said);

    fake.set({ timestamp: SAT + 30, block: BLOCK + 15n });
    await advance(REFRESH_MS);
    expect(screen.getByRole("link", { name: "Base block 60,013,081" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe(said);
    // The visible strip is not a live region: the hidden line is the only one.
    expect(strip().closest("[aria-live]")).toBeNull();
    expect(strip().querySelectorAll("[aria-live]")).toHaveLength(1);
  });
});
