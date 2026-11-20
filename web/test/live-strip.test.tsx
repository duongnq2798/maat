import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStrip } from "@/components/live/LiveStrip";
import { useLiveSnapshot } from "@/components/live/useLiveSnapshot";
import { type Hex, MULTICALL3 } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { REASON_LABEL, type ReasonCode, reasonText } from "@/content/reasons";
import { type CallResult, decodeAggregate3, encodeAggregate3Result, word } from "@/lib/live/abi";
import { HEAD_MAX_LAG_SEC, LIVE_MAX_AGE_MS, REFRESH_MS } from "@/lib/live/freshness";
import { LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
import { decodeSnapshot } from "@/lib/live/snapshot";
import { headline, headlineText, judgeToken, sessionAt, VAULT_NOT_RUN } from "@/lib/live/verdict";
import fixture from "./fixtures/live-aggregate3.json";
import { failSlot, passingBasket } from "./helpers/live";

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

type Edit = (r: CallResult[]) => CallResult[];

/** What the mandate says about that answer, from FACTS: the strip must say the same. */
function expected(timestamp: number, edit: Edit = (r) => r) {
  const s = decodeSnapshot(edit(results(timestamp)), FACTS.mandate.value.twapWindowSec);
  const session = sessionAt({ timestamp: s.timestamp, calendar: { source: "repo" } });
  const verdicts = s.tokens.map((t) => judgeToken(t, { timestamp: s.timestamp, session }));
  return { headline: headline(verdicts), verdicts };
}

/** The recorded answer at `timestamp`, changed by `edit` if given; or no answer at all. */
type Answer = { timestamp: number; block?: bigint; edit?: Edit } | "down" | "hang";

/**
 * A reader that answers like Base: the recorded multicall, and a deployed MarketCalendar (if any) like the repo calendar.
 * `hold()` keeps the next calls in flight until `release(answer)`.
 */
function fakeReader(first: Answer) {
  let answer = first;
  let gate: { promise: Promise<void>; open: () => void } | undefined;
  const call = vi.fn(async (tx: { to: Hex; data: Hex }): Promise<{ data: Hex; endpoint: string }> => {
    if (gate) await gate.promise;
    const a = answer;
    if (a === "down") throw new RpcError(LIVE_RPCS.map((endpoint) => ({ endpoint, message: "HTTP 503" })));
    if (a === "hang") return new Promise(() => {});
    if (tx.to.toLowerCase() !== MULTICALL3.toLowerCase()) {
      return { data: `0x${word(regularSession(a.timestamp).open ? 1n : 0n)}`, endpoint: LIVE_RPCS[0]! };
    }
    const r = results(a.timestamp, a.block);
    return { data: encodeAggregate3Result(a.edit ? a.edit(r) : r), endpoint: LIVE_RPCS[0]! };
  });
  const reader: LiveReader = { call };
  return {
    reader,
    call,
    set: (next: Answer) => void (answer = next),
    hold: () => {
      let open = () => {};
      const promise = new Promise<void>((resolve) => (open = resolve));
      gate = { promise, open };
    },
    release: (next: Answer) => {
      answer = next;
      const g = gate;
      gate = undefined;
      g?.open();
    },
  };
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

  it("links vault checks not run to the method on /now when the default mandate refuses no basket token", async () => {
    await mount({ timestamp: FRI, edit: passingBasket }, FRI + 14);
    const { headline: h } = expected(FRI, passingBasket);
    expect(h.kind).toBe("pass-all");
    const line = strip().querySelector<HTMLElement>("[data-verdict-line]")!;
    expect(line).toHaveAttribute("data-verdict-line", "pass-all");
    const link = screen.getByRole("link", { name: VAULT_NOT_RUN });
    expect(line).toContainElement(link);
    expect(link).toHaveAttribute("href", "/now#method");
    // The link is inside the sentence: it reads as headlineText, and the announcement stays plain text.
    expect(verdictSentence()).toBe(headlineText(h));
    expect(screen.getByRole("status").textContent).toBe(`Live. ${headlineText(h)}`);
    expect(screen.getByRole("status").querySelector("a")).toBeNull();
    // A pass never claims every check: checks 3, 8 and 9 need a vault.
    expect(strip()).not.toHaveTextContent(REASON_LABEL.OK);
  });

  it.each([
    ["mixed", FRI, ((r) => failSlot(passingBasket(r), "NVDAc", "observe")) as Edit],
    ["refuse-all", SAT, undefined],
  ] as const)("does not link vault checks not run when the headline is %s", async (kind, at, edit) => {
    await mount({ timestamp: at, edit }, at + 14);
    expect(expected(at, edit).headline.kind).toBe(kind);
    expect(strip().querySelector("[data-verdict-line]")).toHaveAttribute("data-verdict-line", kind);
    expect(strip().querySelector("[data-verdict-line] a")).toBeNull();
    expect(screen.queryByRole("link", { name: VAULT_NOT_RUN })).toBeNull();
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

  it("keeps focus on Retry while it reads, gives Retry back when it fails, and moves focus to the strip when it works", async () => {
    const fake = await mount("down", SAT + 14);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();

    fake.hold();
    fireEvent.click(retry);
    await advance(0);
    expect(retry).toHaveTextContent("Retrying…");
    expect(retry).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(retry);
    expect(strip()).toHaveTextContent("Could not read Base mainnet");
    fireEvent.click(retry); // ignored while the retry is in flight
    expect(fake.call).toHaveBeenCalledTimes(2);

    fake.release("down");
    await advance(0);
    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(retry).not.toHaveAttribute("aria-disabled");
    expect(document.activeElement).toBe(retry);

    fake.hold();
    fireEvent.click(retry);
    await advance(0);
    fake.release({ timestamp: SAT });
    await advance(0);
    expect(fake.call).toHaveBeenCalledTimes(3);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(retry).not.toBeInTheDocument();
    expect(strip()).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(strip());
  });

  it("sets no state and schedules nothing once unmounted during a read", async () => {
    const errors = vi.spyOn(console, "error");
    try {
      vi.setSystemTime((SAT + 14) * 1000);
      const fake = fakeReader({ timestamp: SAT });
      fake.hold();
      const { unmount } = render(<LiveStrip reader={fake.reader} />);
      await advance(0);
      expect(fake.call).toHaveBeenCalledTimes(1);
      unmount();
      fake.release({ timestamp: SAT });
      await advance(0);
      expect(vi.getTimerCount()).toBe(0);
      await advance(REFRESH_MS * 3);
      expect(fake.call).toHaveBeenCalledTimes(1);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("calls a reading that aged on a hidden tab stale, with its age, and never blames the RPC's head for it", async () => {
    // The head was 3 s behind when it was read; then the tab stays hidden for 3 min.
    await mount({ timestamp: SAT - 3 }, SAT);
    visibility = "hidden";
    await advance(180_000);
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    expect(strip()).toHaveTextContent("last read block 60,013,066, 3 min ago");
    expect(strip()).not.toHaveTextContent("behind your clock");
  });

  it("calls a reading stale once the wall clock passes the live limit, even while the monotonic clock slept", async () => {
    await mount({ timestamp: SAT }, SAT + 3);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    // The device slept for 100 s: the wall clock jumped, the timers and performance.now() did not run.
    vi.setSystemTime((SAT + 3 + 100) * 1000);
    await advance(5_000);
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    expect(strip()).toHaveTextContent("last read block 60,013,066, 1 min 45 s ago");
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

describe("a page that wakes up", () => {
  /**
   * The visitor's two clocks, moved by hand: they jump while no timer runs, as when a phone suspends the tab or the
   * browser keeps the page in its back/forward cache.
   */
  function sleepyClocks(wallSec: number) {
    const c = { mono: 1_000_000, wall: wallSec };
    return {
      nowMs: () => c.mono,
      wallSec: () => c.wall,
      sleep: (sec: number) => {
        c.mono += sec * 1000;
        c.wall += sec;
      },
    };
  }

  /** The hook with a live weekend reading, then asleep for 10 min with the next read held. */
  async function asleep() {
    const clock = sleepyClocks(SAT + 14);
    const fake = fakeReader({ timestamp: SAT });
    const hook = renderHook(() => useLiveSnapshot({ reader: fake.reader, nowMs: clock.nowMs, wallSec: clock.wallSec }));
    await advance(0);
    expect(hook.result.current.state.status).toBe("live");
    fake.hold();
    clock.sleep(600);
    return { hook, fake };
  }

  it("calls the old reading stale as soon as the tab is visible again, before the read it starts has answered", async () => {
    const { hook, fake } = await asleep();
    visibility = "hidden";
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    visibility = "visible";
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    // The read has started and is held: only the clocks can have changed the state.
    expect(fake.call).toHaveBeenCalledTimes(2);
    const state = hook.result.current.state;
    expect(state.status).toBe("stale");
    expect(state.status === "stale" && state.ageMs).toBe(600_000);
    // The answer at the new head makes it live again.
    fake.release({ timestamp: SAT + 600 });
    await advance(0);
    expect(hook.result.current.state.status).toBe("live");
  });

  it("calls the old reading stale as soon as the page is shown from the back/forward cache, and reads again", async () => {
    const { hook, fake } = await asleep();
    // The tab never reported itself hidden: only pageshow says the page is back.
    act(() => void window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    expect(fake.call).toHaveBeenCalledTimes(2);
    const state = hook.result.current.state;
    expect(state.status).toBe("stale");
    expect(state.status === "stale" && state.ageMs).toBe(600_000);
    fake.release({ timestamp: SAT + 600 });
    await advance(0);
    expect(hook.result.current.state.status).toBe("live");
  });
});
