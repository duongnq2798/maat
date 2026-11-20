import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Page, { metadata } from "@/app/(site)/now/page";
import { NowBoard } from "@/components/live/NowBoard";
import { type Hex, MULTICALL3, NAV_TOKENS } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { CHECK_LABELS } from "@/content/engine";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import { REASON_LABEL, type ReasonCode, reasonText } from "@/content/reasons";
import { type CallResult, decodeAggregate3, encodeAggregate3Result, word } from "@/lib/live/abi";
import { formatAge, formatDateUtc, formatMultiplier, formatUsd8 } from "@/lib/live/format";
import { REFRESH_MS } from "@/lib/live/freshness";
import { LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
import { decodeSnapshot } from "@/lib/live/snapshot";
import { headline, headlineText, judgeToken, sessionAt } from "@/lib/live/verdict";
import fixture from "./fixtures/live-aggregate3.json";

const BLOCK = BigInt(fixture.expected.blockNumber); // 60,013,066
const TS = Number(fixture.expected.timestamp); // Fri 2026-11-20 16:43:08 UTC, 11:43 ET: in session
const MANDATE = FACTS.mandate.value;
/** The five calls per token in the multicall, after the block number and the timestamp: observe is the fifth. */
const PER_TOKEN = 5;
const OBSERVE = 4;
/** SNDKc's effectiveAt in the fixture: its 8x multiplier took effect then (2026-11-20 05:00 UTC). */
const SNDK_EFFECTIVE_AT = 1_795_150_800;

/** The recorded answer, with the block number and timestamp words replaced and, if asked, one pool's observe failed. */
function results(opts: { timestamp?: number; block?: bigint; failObserve?: string } = {}): CallResult[] {
  const r = decodeAggregate3(fixture.response as Hex);
  r[0] = { success: true, returnData: `0x${word(opts.block ?? BLOCK)}` };
  r[1] = { success: true, returnData: `0x${word(BigInt(opts.timestamp ?? TS))}` };
  if (opts.failObserve !== undefined) {
    const i = NAV_TOKENS.findIndex((t) => t.symbol === opts.failObserve);
    r[2 + i * PER_TOKEN + OBSERVE] = { success: false, returnData: "0x" };
  }
  return r;
}

/** What the mandate says about that answer, from FACTS: the board must say the same. */
function expected(r: CallResult[]) {
  const s = decodeSnapshot(r, MANDATE.twapWindowSec);
  const session = sessionAt({ timestamp: s.timestamp, calendar: { source: "repo" } });
  const verdicts = s.tokens.map((t) => judgeToken(t, { timestamp: s.timestamp, session }));
  return { tokens: s.tokens, verdicts, headline: headline(verdicts), session };
}

type Answer = CallResult[] | "down";

/** A reader that answers like Base: the multicall from `answer`, and a deployed MarketCalendar (if any) like the repo calendar. */
function fakeReader(first: Answer) {
  let answer = first;
  const call = vi.fn(async (tx: { to: Hex; data: Hex }): Promise<{ data: Hex; endpoint: string }> => {
    const a = answer;
    if (a === "down") throw new RpcError(LIVE_RPCS.map((endpoint) => ({ endpoint, message: "HTTP 503" })));
    if (tx.to.toLowerCase() !== MULTICALL3.toLowerCase()) {
      const ts = Number(BigInt(a[1]!.returnData));
      return { data: `0x${word(regularSession(ts).open ? 1n : 0n)}`, endpoint: LIVE_RPCS[0]! };
    }
    return { data: encodeAggregate3Result(a), endpoint: LIVE_RPCS[0]! };
  });
  const reader: LiveReader = { call };
  return { reader, call, set: (next: Answer) => void (answer = next) };
}

const neverSafe = () => expect(document.body.textContent).not.toMatch(/safe/i);

describe("the /now page", () => {
  const setup = () => render(<Page />).container;
  const method = () => document.querySelector<HTMLElement>("#method")!;

  it("has one h1, Right now on Base, and never skips a heading level on the way down", () => {
    const c = setup();
    const headings = [...c.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    const levels = headings.map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Right now on Base$/);
    levels.forEach((l, i) => {
      if (i > 0) expect(l - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
    expect(c).toHaveTextContent(
      "Read from Base mainnet in your browser, one block at a time. Nothing is signed, and this site has no server.",
    );
  });

  it("opens with a skip link to its main content and its own small header, never the landing's in-page links", () => {
    const c = setup();
    const skip = c.querySelector('a[href="#main"]');
    expect(skip).toHaveClass("skip-link");
    expect(c.querySelector("main#main")).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Maat home" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "How Maat decides" })).toHaveAttribute("href", "/#how");
    expect(within(nav).getByRole("link", { name: "Docs" })).toHaveAttribute("href", "/docs");
    expect(within(nav).getByRole("link", { name: /View on GitHub/ })).toHaveAttribute("href", "https://github.com/duongnq2798/maat");
    expect([...c.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href"))).toEqual(["#main"]);
  });

  it("names itself in its metadata: title, description, canonical /now and the landing's link preview image", () => {
    expect(metadata.title).toBe("Right now on Base · Maat");
    const description = String(metadata.description);
    expect(description).toBe(
      "What an agent under Maat's default mandate would do right now with the 13 B20 tokens that have a NAV, read from Base mainnet in your browser.",
    );
    expect(description.length).toBeGreaterThanOrEqual(50);
    expect(description.length).toBeLessThanOrEqual(160);
    expect(metadata.alternates?.canonical).toBe("/now");
    const image = {
      url: "/opengraph-image.png",
      type: "image/png",
      width: 1200,
      height: 630,
      alt: readFileSync(join(process.cwd(), "app/opengraph-image.alt.txt"), "utf8"),
    };
    const og = metadata.openGraph as { url?: string; title?: string; description?: string; images?: unknown };
    expect(og.url).toBe("/now");
    expect(og.title).toBe("Right now on Base · Maat");
    expect(og.description).toBe(description);
    expect(og.images).toEqual([image]);
    const twitter = metadata.twitter as { card?: string; title?: string; images?: unknown };
    expect(twitter.card).toBe("summary_large_image");
    expect(twitter.title).toBe("Right now on Base · Maat");
    expect(twitter.images).toEqual([image]);
  });

  it("lists all 13 tokens in the method, each with Basescan links for its token, feed and pool", () => {
    setup();
    const links = within(method())
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(NAV_TOKENS).toHaveLength(13);
    for (const t of NAV_TOKENS) {
      const item = method().querySelector<HTMLElement>(`[data-method-token="${t.symbol}"]`)!;
      expect(item, t.symbol).not.toBeNull();
      expect(item).toHaveTextContent(t.symbol);
      expect(item).toHaveTextContent(t.name);
      for (const address of [t.token, t.feed, t.pool]) {
        const a = within(item).getByRole("link", { name: address });
        expect(a).toHaveAttribute("href", `https://basescan.org/address/${address}`);
        expect(a).toHaveAttribute("target", "_blank");
        expect(a).toHaveAttribute("rel", "noopener noreferrer");
      }
    }
    expect(links).toContain(`https://basescan.org/address/${MULTICALL3}`);
    // No reading in the method: a block link would be a chain value baked into the page.
    expect(links.some((h) => h?.includes("basescan.org/block/"))).toBe(false);
  });

  it("gives the thresholds as FACTS.mandate holds them, with their source", () => {
    setup();
    const shown = Object.fromEntries(
      [...method().querySelectorAll<HTMLElement>("[data-threshold]")].map((el) => [el.dataset.threshold, el]),
    );
    const keys = ["maxStalenessSec", "maxPremiumBps", "twapWindowSec", "multiplierCooldownSec"] as const;
    expect(Object.keys(shown).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      expect(Number(shown[k]!.dataset.value), k).toBe(MANDATE[k]);
      expect(shown[k]).toHaveTextContent(formatInt(MANDATE[k]));
    }
    expect(method()).toHaveTextContent(FACTS.mandate.source);
  });

  it("lists the nine checks in contract order, with the code each one refuses with", () => {
    setup();
    const items = [...method().querySelectorAll<HTMLElement>("[data-method-check]")];
    expect(items.map((li) => li.dataset.methodCheck)).toEqual(CHECK_LABELS.map((_, i) => String(i + 1)));
    items.forEach((li, i) => expect(li).toHaveTextContent(CHECK_LABELS[i]!));
    const codes = items.map((li) => li.querySelector("[data-reason-tag]")?.getAttribute("data-reason-tag") ?? null);
    expect(codes).toEqual([
      "TOKEN_NOT_ALLOWED",
      "TOKEN_PAUSED",
      null,
      "MARKET_CLOSED",
      "FEED_STALE",
      "MULTIPLIER_COOLDOWN",
      "PREMIUM_TOO_HIGH",
      null,
      null,
    ]);
  });

  it("names the calls of the one multicall, the calendar and the endpoints, in the order they are tried", () => {
    setup();
    for (const call of ["aggregate3", "getBlockNumber()", "getCurrentBlockTimestamp()", "isPaused(0)", "uiMultiplier()", "effectiveAt()", "latestRoundData()"]) {
      expect(method()).toHaveTextContent(call);
    }
    expect(method()).toHaveTextContent(`observe([${MANDATE.twapWindowSec}, 0])`);
    expect(method()).toHaveTextContent(`${2 + PER_TOKEN * NAV_TOKENS.length} calls in one request`);
    expect(method()).toHaveTextContent("web/content/calendar.ts");
    expect([...method().querySelectorAll("[data-endpoint]")].map((li) => li.textContent)).toEqual([...LIVE_RPCS]);
    expect(method()).toHaveTextContent("nothing is signed");
  });

  it("holds no chain value in its static HTML, and never says safe", () => {
    const html = renderToString(<Page />);
    expect(html).toContain("Reading Base mainnet");
    for (const value of ["60,013,066", ">LIVE<", "basescan.org/block/", "data-verdict-line"]) expect(html).not.toContain(value);
    expect(html).not.toMatch(/safe/i);
    setup();
    neverSafe();
  });
});

let visibility: DocumentVisibilityState = "visible";

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Render the board with the visitor's clock at `wallSec`, and let the first read answer. */
async function mount(first: Answer, wallSec = TS + 14) {
  vi.setSystemTime(wallSec * 1000);
  const fake = fakeReader(first);
  render(<NowBoard reader={fake.reader} />);
  await advance(0);
  return fake;
}

const board = () => document.querySelector<HTMLElement>("[data-now-board]")!;
const row = (symbol: string) => document.querySelector<HTMLElement>(`tbody tr[data-token="${symbol}"]`)!;
const card = (symbol: string) => document.querySelector<HTMLElement>(`article[data-token="${symbol}"]`)!;
/** The same value in the table's cell and in the card's <dd>. */
const values = (symbol: string, col: string) => [
  row(symbol).querySelector<HTMLElement>(`td[data-col="${col}"]`)!,
  card(symbol).querySelector<HTMLElement>(`dd[data-col="${col}"]`)!,
];
const reasonOf = (el: HTMLElement) => el.querySelector("[data-reason-tag]")?.getAttribute("data-reason-tag") ?? null;

/** The headline as one sentence: each ReasonTag read as "Label (CODE)", the way headlineText writes it. */
function verdictSentence(): string {
  const copy = board().querySelector("[data-verdict-line]")!.cloneNode(true) as Element;
  for (const tag of copy.querySelectorAll("[data-reason-tag]")) tag.replaceWith(reasonText(tag.getAttribute("data-reason-tag") as ReasonCode));
  return copy.textContent ?? "";
}

/** A verdict cell: the code, and the words a reader sees for it. */
function expectVerdict(el: HTMLElement, code: ReasonCode, column: "mandate" | "market") {
  if (code === "OK" && column === "mandate") {
    expect(reasonOf(el)).toBeNull();
    expect(el.textContent).toBe("Market checks pass");
    return;
  }
  expect(reasonOf(el)).toBe(code);
  expect(el).toHaveTextContent(REASON_LABEL[code]);
}

describe("the /now board", () => {
  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it("holds the reading state in its static HTML: each token's symbol and name, and a dash in every other cell", () => {
    const fake = fakeReader(results());
    const html = renderToString(<NowBoard reader={fake.reader} />);
    expect(html).toContain("Reading Base mainnet");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const rows = [...doc.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.getAttribute("data-token"))).toEqual(NAV_TOKENS.map((t) => t.symbol));
    rows.forEach((r, i) => {
      expect(r.querySelector("th")?.textContent).toContain(NAV_TOKENS[i]!.symbol);
      expect(r.querySelector("th")?.textContent).toContain(NAV_TOKENS[i]!.name);
      const cells = [...r.querySelectorAll("td")];
      expect(cells).toHaveLength(10);
      for (const td of cells) expect(td.textContent).toBe("—");
    });
    for (const dd of doc.querySelectorAll("article dd")) expect(dd.textContent).toBe("—");
    expect(doc.querySelectorAll("article")).toHaveLength(13);
    const e = expected(results());
    for (const value of ["60,013,066", ">LIVE<", "basescan.org/block/", "data-verdict-line", formatUsd8(e.tokens[0]!.feed!.answer)]) {
      expect(html).not.toContain(value);
    }
    expect(html).not.toMatch(/safe/i);
    expect(fake.call).not.toHaveBeenCalled();
  });

  it("shows the live reading's block, time, session and its source, the endpoint that answered, and the headline", async () => {
    await mount(results());
    const e = expected(results());
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    const block = screen.getByRole("link", { name: "Base block 60,013,066" });
    expect(block).toHaveAttribute("href", "https://basescan.org/block/60013066");
    expect(block).toHaveAttribute("target", "_blank");
    expect(block).toHaveAttribute("rel", "noopener noreferrer");
    expect(board()).toHaveTextContent("16:43:08 UTC · 11:43 ET");
    expect(board()).toHaveTextContent(e.session.detail);
    expect(board()).toHaveTextContent("repo calendar, web/content/calendar.ts");
    expect(board()).toHaveTextContent(`Read from ${LIVE_RPCS[0]}`);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(verdictSentence()).toBe(headlineText(e.headline));
    expect(screen.getByRole("status").textContent).toBe(`Live. ${headlineText(e.headline)}`);
    neverSafe();
  });

  it("shows one row and one card per token, with the values read and the two verdicts judgeToken gives", async () => {
    await mount(results());
    const e = expected(results());
    expect([...document.querySelectorAll<HTMLElement>("tbody tr")].map((r) => r.dataset.token)).toEqual(NAV_TOKENS.map((t) => t.symbol));
    expect([...document.querySelectorAll("article")].map((a) => a.getAttribute("data-token"))).toEqual(NAV_TOKENS.map((t) => t.symbol));
    NAV_TOKENS.forEach((t, i) => {
      const r = e.tokens[i]!;
      const v = e.verdicts[i]!;
      expect(r.symbol).toBe(t.symbol);
      for (const el of values(t.symbol, "basket")) expect(el.textContent).toBe(v.inBasket ? "yes" : "no");
      for (const el of values(t.symbol, "feedAge")) {
        expect(el).toHaveTextContent(formatAge(v.feedAgeSec!));
        expect(el).toHaveTextContent(`max ${formatAge(MANDATE.maxStalenessSec)}`);
      }
      for (const el of values(t.symbol, "nav")) expect(el.textContent).toBe(formatUsd8(r.feed!.answer));
      for (const el of values(t.symbol, "twap")) expect(el.textContent).toBe(formatUsd8(r.twap8!));
      for (const el of values(t.symbol, "premium")) {
        expect(el).toHaveTextContent(`${v.premiumBps} bps`);
        expect(el).toHaveTextContent(`max ${MANDATE.maxPremiumBps}`);
      }
      for (const el of values(t.symbol, "paused")) expect(el.textContent).toBe("no");
      for (const el of values(t.symbol, "multiplier")) expect(el.textContent).toBe(formatMultiplier(r.uiMultiplier!));
      for (const el of values(t.symbol, "effectiveAt")) {
        expect(el.textContent).toBe(r.effectiveAt === 0n ? "none" : formatDateUtc(Number(r.effectiveAt)));
      }
      for (const el of values(t.symbol, "mandate")) expectVerdict(el, v.mandate, "mandate");
      for (const el of values(t.symbol, "market")) expectVerdict(el, v.market, "market");
    });
    neverSafe();
  });

  it("refuses ANTc as not allowed by the default mandate, and still shows what the market checks say", async () => {
    await mount(results());
    const ant = expected(results()).verdicts.find((v) => v.symbol === "ANTc")!;
    expect(ant.inBasket).toBe(false);
    for (const el of values("ANTc", "mandate")) {
      expect(reasonOf(el)).toBe("TOKEN_NOT_ALLOWED");
      expect(el).toHaveTextContent("Token not allowed");
      expect(el).toHaveTextContent("TOKEN_NOT_ALLOWED");
    }
    for (const el of values("ANTc", "market")) expectVerdict(el, ant.market, "market");
  });

  it("holds SNDKc in the multiplier cooldown while its last change is within multiplierCooldownSec", async () => {
    await mount(results());
    const sndk = expected(results()).verdicts.find((v) => v.symbol === "SNDKc")!;
    const cooling = TS < SNDK_EFFECTIVE_AT + MANDATE.multiplierCooldownSec;
    expect(sndk.market).toBe(cooling ? "MULTIPLIER_COOLDOWN" : "OK");
    for (const el of values("SNDKc", "market")) expectVerdict(el, sndk.market, "market");
    for (const el of values("SNDKc", "effectiveAt")) expect(el.textContent).toBe(formatDateUtc(SNDK_EFFECTIVE_AT));
  });

  it("says could not read for a pool whose observe failed, and shows the verdict that implies", async () => {
    const r = results({ failObserve: "NVDAc" });
    await mount(r);
    const nvda = expected(r).verdicts.find((v) => v.symbol === "NVDAc")!;
    for (const el of values("NVDAc", "twap")) expect(el.textContent).toBe("could not read");
    for (const el of values("NVDAc", "premium")) expect(el.textContent).toBe("could not read");
    for (const el of values("NVDAc", "mandate")) expectVerdict(el, nvda.mandate, "mandate");
    for (const el of values("NVDAc", "market")) expectVerdict(el, nvda.market, "market");
    // In session, with a fresh feed and an unchanged multiplier, the missing TWAP is the first failure.
    expect(nvda.market).toBe("BAD_PRICE");
    // The other pools still answered.
    for (const el of values("GOOGLc", "twap")) expect(el.textContent).not.toBe("could not read");
  });

  it("puts the table in a scroll region a keyboard can reach, with a caption, and the cards beside it for phones", async () => {
    await mount(results());
    const region = screen.getByRole("region", { name: /13 B20s/ });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("data-scroll-x");
    expect(region).toHaveClass("card", "overflow-x-auto", "hidden", "md:block");
    expect(within(region).getByRole("table").querySelector("caption")).not.toBeNull();
    const cards = document.querySelector<HTMLElement>("[data-now-cards]")!;
    expect(cards).toHaveClass("md:hidden");
    expect(cards.querySelectorAll("article dl")).toHaveLength(13);
  });

  it("reads again on Refresh, keeps the announcement unless the status or the verdict changes", async () => {
    const fake = await mount(results());
    const status = screen.getByRole("status");
    const said = status.textContent;
    fake.set(results({ timestamp: TS + 2, block: BLOCK + 1n }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await advance(0);
    expect(fake.call).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("link", { name: "Base block 60,013,067" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe(said);
    expect(board().querySelectorAll("[aria-live]")).toHaveLength(1);
  });

  it("says NOT LIVE when a refresh fails after a good reading, and keeps the old values in muted text", async () => {
    const fake = await mount(results());
    fake.set("down");
    await advance(REFRESH_MS);
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(board()).toHaveTextContent("last read block 60,013,066, 30 s ago");
    expect(board()).toHaveTextContent("the RPC did not answer since");
    expect(board().querySelector("[data-verdict-line]")).toHaveAttribute("data-tone", "muted");
    expect(document.querySelector("[data-now-rows]")).toHaveAttribute("data-tone", "muted");
    expect(screen.getByRole("status").textContent).toBe(`Not live. ${headlineText(expected(results()).headline)}`);
    neverSafe();
  });

  it("says so when the first read fails, shows no values, and reads again on Retry", async () => {
    const fake = await mount("down");
    expect(board()).toHaveTextContent(
      "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data.",
    );
    expect(board().querySelector("[data-verdict-line]")).toBeNull();
    for (const td of document.querySelectorAll("tbody td")) expect(td.textContent).toBe("—");
    fake.set(results());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await advance(0);
    expect(fake.call).toHaveBeenCalledTimes(2);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    for (const el of values("AAPLc", "nav")) expect(el.textContent).not.toBe("—");
    neverSafe();
  });
});
