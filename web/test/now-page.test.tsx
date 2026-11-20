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
import { HEAD_MAX_LAG_SEC, REFRESH_MS } from "@/lib/live/freshness";
import { LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
import { decodeSnapshot } from "@/lib/live/snapshot";
import { headline, headlineText, judgeToken, sessionAt, VAULT_NOT_RUN } from "@/lib/live/verdict";
import deployments from "@/content/generated/deployments.json";
import { SITE } from "@/lib/site";
import fixture from "./fixtures/live-aggregate3.json";
import { failSlot, passingBasket, roundData, SLOTS, type Slot, slotIndex } from "./helpers/live";

// The deployments table the page reads is a copy that a test may change, so no test depends on whether MarketCalendar
// is deployed yet: the tests of each session source say which one they want.
vi.mock("@/content/generated/deployments.json", async (importOriginal) => ({
  default: structuredClone((await importOriginal<{ default: unknown }>()).default),
}));

const calendarRow = () => deployments.find((r) => r.network === "Base mainnet" && r.contract === "MarketCalendar")!;
const deployedCalendar = calendarRow().address;
/** Put `address` in the table's Base mainnet MarketCalendar row ("" for none), for this test only. */
const deployCalendar = (address: string) => void (calendarRow().address = address);
afterEach(() => deployCalendar(deployedCalendar));

/** A MarketCalendar address for the tests of the onchain session source. */
const CAL = "0x00000000000000000000000000000000000000ca";

const BLOCK = BigInt(fixture.expected.blockNumber); // 60,013,066
const TS = Number(fixture.expected.timestamp); // Fri 2026-11-20 16:43:08 UTC, 11:43 ET: in session
const SAT = Date.UTC(2026, 10, 21, 15, 0, 0) / 1000; // Sat 2026-11-21 15:00 UTC, 10:00 ET: closed
const MANDATE = FACTS.mandate.value;
/** SNDKc's effectiveAt in the fixture: its 8x multiplier took effect then (2026-11-20 05:00 UTC). */
const SNDK_EFFECTIVE_AT = 1_795_150_800;

/** The recorded answer, with the block number and timestamp words replaced and, if asked, one token's call failed. */
function results(opts: { timestamp?: number; block?: bigint; fail?: { symbol: string; slot: Slot } } = {}): CallResult[] {
  const r = decodeAggregate3(fixture.response as Hex);
  r[0] = { success: true, returnData: `0x${word(opts.block ?? BLOCK)}` };
  r[1] = { success: true, returnData: `0x${word(BigInt(opts.timestamp ?? TS))}` };
  return opts.fail === undefined ? r : failSlot(r, opts.fail.symbol, opts.fail.slot);
}

/** What the mandate says about that answer, from FACTS: the board must say the same. */
function expected(r: CallResult[]) {
  const s = decodeSnapshot(r, MANDATE.twapWindowSec);
  const session = sessionAt({ timestamp: s.timestamp, calendar: { source: "repo" } });
  const verdicts = s.tokens.map((t) => judgeToken(t, { timestamp: s.timestamp, session }));
  return { tokens: s.tokens, verdicts, headline: headline(verdicts), session };
}

type Answer = CallResult[] | "down";

const isMulticall = (tx: { to: Hex }) => tx.to.toLowerCase() === MULTICALL3.toLowerCase();

/**
 * A reader that answers like Base: the multicall from `answer`, and a deployed MarketCalendar's isOpen like the repo
 * calendar at the block's timestamp, or with a failed call. `multicalls()` counts the multicalls only: a deployed
 * calendar adds one call to each good reading.
 */
function fakeReader(first: Answer, calendar: "repo" | "down" = "repo") {
  let answer = first;
  const call = vi.fn(async (tx: { to: Hex; data: Hex }, _block: "latest" | bigint): Promise<{ data: Hex; endpoint: string }> => {
    const a = answer;
    if (a === "down") throw new RpcError(LIVE_RPCS.map((endpoint) => ({ endpoint, message: "HTTP 503" })));
    if (!isMulticall(tx)) {
      if (calendar === "down") throw new RpcError(LIVE_RPCS.map((endpoint) => ({ endpoint, message: "HTTP 503" })));
      const ts = Number(BigInt(a[1]!.returnData));
      return { data: `0x${word(regularSession(ts).open ? 1n : 0n)}`, endpoint: LIVE_RPCS[0]! };
    }
    return { data: encodeAggregate3Result(a), endpoint: LIVE_RPCS[0]! };
  });
  const reader: LiveReader = { call };
  return {
    reader,
    call,
    multicalls: () => call.mock.calls.filter(([tx]) => isMulticall(tx)).length,
    set: (next: Answer) => void (answer = next),
  };
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
    expect(within(nav).getByRole("link", { name: "Docs" })).toHaveAttribute("href", SITE.docsUrl);
    expect(within(nav).getByRole("link", { name: /View on GitHub/ })).toHaveAttribute("href", SITE.repoUrl);
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

  it("names the calls of the one multicall, the repo calendar and the endpoints, in the order they are tried", () => {
    deployCalendar("");
    setup();
    for (const call of ["aggregate3", "getBlockNumber()", "getCurrentBlockTimestamp()", "isPaused(0)", "uiMultiplier()", "effectiveAt()", "latestRoundData()"]) {
      expect(method()).toHaveTextContent(call);
    }
    expect(method()).toHaveTextContent(`observe([${MANDATE.twapWindowSec}, 0])`);
    expect(method()).toHaveTextContent(`${2 + SLOTS.length * NAV_TOKENS.length} calls in one request`);
    expect(method()).toHaveTextContent("web/content/calendar.ts");
    expect([...method().querySelectorAll("[data-endpoint]")].map((li) => li.textContent)).toEqual([...LIVE_RPCS]);
    expect(method()).toHaveTextContent("nothing is signed");
  });

  it("says a deployed MarketCalendar gives the session, with its Basescan link, once the deployments table names it", () => {
    deployCalendar(CAL);
    setup();
    expect(method()).toHaveTextContent(
      `A second eth_call at the same block asks MarketCalendar (${CAL}) isOpen(blockTimestamp, REGULAR). A failed call counts as closed.`,
    );
    const link = within(method()).getByRole("link", { name: CAL });
    expect(link).toHaveAttribute("href", `https://basescan.org/address/${CAL}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(method()).not.toHaveTextContent("web/content/calendar.ts");
    neverSafe();
  });

  it("gives the method section the id the verdict line links its vault checks not run to", () => {
    const c = setup();
    const section = c.querySelector<HTMLElement>("section#method")!;
    expect(section).not.toBeNull();
    expect(section).toBe(method());
    expect(section).toHaveAttribute("aria-labelledby", "method-title");
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
async function mount(first: Answer, wallSec = TS + 14, calendar: "repo" | "down" = "repo") {
  vi.setSystemTime(wallSec * 1000);
  const fake = fakeReader(first, calendar);
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

/**
 * A verdict cell: the code, and the words a reader sees for it. A pass in either column reads "Market checks pass",
 * never REASON_LABEL.OK ("All checks passed"): checks 3, 8 and 9 need a vault and are not run here.
 */
function expectVerdict(el: HTMLElement, code: ReasonCode) {
  if (code === "OK") {
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
    deployCalendar("");
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

  it("asks a deployed MarketCalendar at the block it read, and names it, with its Basescan link, as the session's source", async () => {
    deployCalendar(CAL);
    const fake = await mount(results());
    const e = expected(results());
    expect(fake.multicalls()).toBe(1);
    const asked = fake.call.mock.calls.filter(([tx]) => !isMulticall(tx));
    expect(asked).toHaveLength(1);
    expect(asked[0]![0].to).toBe(CAL);
    expect(asked[0]![1]).toBe(BLOCK);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(board()).toHaveTextContent(`${e.session.detail} (MarketCalendar at ${CAL})`);
    expect(within(board()).getByRole("link", { name: CAL })).toHaveAttribute("href", `https://basescan.org/address/${CAL}`);
    expect(board()).not.toHaveTextContent("repo calendar");
    // It answers as the repo calendar does, so the verdicts are the same.
    expect(verdictSentence()).toBe(headlineText(e.headline));
    neverSafe();
  });

  it("counts a deployed MarketCalendar it could not read as closed, and says so", async () => {
    deployCalendar(CAL);
    await mount(passingBasket(results()), TS + 14, "down");
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(board()).toHaveTextContent(`MarketCalendar unreadable · counted closed (MarketCalendar at ${CAL})`);
    // A basket that passes every market check in session is refused: the session counts as closed.
    expect(verdictSentence()).toBe(headlineText({ kind: "refuse-all", reason: "MARKET_CLOSED" }));
    for (const symbol of FACTS.basket.value) for (const el of values(symbol, "mandate")) expectVerdict(el, "MARKET_CLOSED");
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
      for (const el of values(t.symbol, "mandate")) expectVerdict(el, v.mandate);
      for (const el of values(t.symbol, "market")) expectVerdict(el, v.market);
    });
    neverSafe();
  });

  it("never says All checks passed: a pass in either column reads Market checks pass, since checks 3, 8 and 9 are not run", async () => {
    const r = passingBasket(results());
    await mount(r);
    const e = expected(r);
    // The reading passes the market checks for most tokens and the default mandate for the basket: both columns pass.
    expect(e.verdicts.filter((v) => v.market === "OK").length).toBeGreaterThan(0);
    expect(e.verdicts.filter((v) => v.mandate === "OK").length).toBeGreaterThan(0);
    for (const v of e.verdicts) {
      for (const col of ["mandate", "market"] as const) {
        if (v[col] !== "OK") continue;
        for (const el of values(v.symbol, col)) {
          expect(el.textContent, `${v.symbol} ${col}`).toBe("Market checks pass");
          expect(reasonOf(el)).toBeNull();
        }
      }
    }
    expect(board().textContent).not.toContain(REASON_LABEL.OK);
    expect(board().querySelector('[data-reason-tag="OK"]')).toBeNull();
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
    for (const el of values("ANTc", "market")) expectVerdict(el, ant.market);
  });

  it("holds SNDKc in the multiplier cooldown while its last change is within multiplierCooldownSec", async () => {
    await mount(results());
    const sndk = expected(results()).verdicts.find((v) => v.symbol === "SNDKc")!;
    const cooling = TS < SNDK_EFFECTIVE_AT + MANDATE.multiplierCooldownSec;
    expect(sndk.market).toBe(cooling ? "MULTIPLIER_COOLDOWN" : "OK");
    for (const el of values("SNDKc", "market")) expectVerdict(el, sndk.market);
    for (const el of values("SNDKc", "effectiveAt")) expect(el.textContent).toBe(formatDateUtc(SNDK_EFFECTIVE_AT));
  });

  it("says could not read for a pool whose observe failed, and shows the verdict that implies", async () => {
    const r = results({ fail: { symbol: "NVDAc", slot: "observe" } });
    await mount(r);
    const nvda = expected(r).verdicts.find((v) => v.symbol === "NVDAc")!;
    for (const el of values("NVDAc", "twap")) expect(el.textContent).toBe("could not read");
    for (const el of values("NVDAc", "premium")) expect(el.textContent).toBe("could not read");
    for (const el of values("NVDAc", "mandate")) expectVerdict(el, nvda.mandate);
    for (const el of values("NVDAc", "market")) expectVerdict(el, nvda.market);
    // In session, with a fresh feed and an unchanged multiplier, the missing TWAP is the first failure.
    expect(nvda.market).toBe("BAD_PRICE");
    // The other pools still answered.
    for (const el of values("GOOGLc", "twap")) expect(el.textContent).not.toBe("could not read");
  });

  /** The cells a failed call leaves unread: the premium needs both the feed and the pool. */
  const UNREAD_BY_SLOT: Record<Slot, readonly string[]> = {
    isPaused: ["paused"],
    uiMultiplier: ["multiplier"],
    effectiveAt: ["effectiveAt"],
    latestRoundData: ["feedAge", "nav", "premium"],
    observe: ["twap", "premium"],
  };
  const READ_COLS = ["feedAge", "nav", "twap", "premium", "paused", "multiplier", "effectiveAt"] as const;

  it.each(SLOTS)("says could not read where a failed %s call leaves a value unread, and shows the verdicts judgeToken gives", async (slot) => {
    // From a basket that passes every market check, so the failed call is the only thing that can change NVDAc's verdict.
    const r = failSlot(passingBasket(results()), "NVDAc", slot);
    await mount(r);
    const e = expected(r);
    const nvda = e.verdicts.find((v) => v.symbol === "NVDAc")!;
    for (const col of READ_COLS) {
      const unread = UNREAD_BY_SLOT[slot].includes(col);
      for (const el of values("NVDAc", col)) expect(el.textContent === "could not read", `${slot} → ${col}`).toBe(unread);
    }
    for (const el of values("NVDAc", "mandate")) expectVerdict(el, nvda.mandate);
    for (const el of values("NVDAc", "market")) expectVerdict(el, nvda.market);
    expect(verdictSentence()).toBe(headlineText(e.headline));
    // Only NVDAc's call failed: the other tokens still show what they read.
    for (const col of READ_COLS) for (const el of values("GOOGLc", col)) expect(el.textContent).not.toBe("could not read");
  });

  it.each([
    ["answered zero", 0n, "both"],
    ["was updated after the block", "future", "feedAge"],
  ] as const)("says no valid price when a feed %s, and shows the verdicts judgeToken gives", async (_, answer, unpriced) => {
    const base = passingBasket(results());
    const nvda8 = decodeSnapshot(base, MANDATE.twapWindowSec).tokens.find((t) => t.symbol === "NVDAc")!.twap8!;
    const r = [...base];
    r[slotIndex("NVDAc", "latestRoundData")] = {
      success: true,
      returnData: answer === "future" ? roundData(nvda8, BigInt(TS + 60)) : roundData(answer, BigInt(TS - 10)),
    };
    await mount(r);
    const nvda = expected(r).verdicts.find((v) => v.symbol === "NVDAc")!;
    expect(nvda.feedAgeSec).toBeNull();
    for (const el of values("NVDAc", "feedAge")) expect(el.textContent).toBe("no valid price");
    for (const el of values("NVDAc", "nav")) expect(el.textContent).toBe(formatUsd8(answer === "future" ? nvda8 : answer));
    for (const el of values("NVDAc", "premium")) {
      if (unpriced === "both") expect(el.textContent).toBe("no valid price");
      else expect(el).toHaveTextContent(`${nvda.premiumBps} bps`);
    }
    for (const el of values("NVDAc", "mandate")) expectVerdict(el, nvda.mandate);
    for (const el of values("NVDAc", "market")) expectVerdict(el, nvda.market);
    expect(nvda.market).toBe("BAD_PRICE");
  });

  it("links vault checks not run to the method when the default mandate refuses no basket token", async () => {
    const r = passingBasket(results());
    await mount(r);
    const e = expected(r);
    expect(e.headline.kind).toBe("pass-all");
    const line = board().querySelector<HTMLElement>("[data-verdict-line]")!;
    expect(line).toHaveAttribute("data-verdict-line", "pass-all");
    const link = within(line).getByRole("link", { name: VAULT_NOT_RUN });
    expect(link).toHaveAttribute("href", "#method");
    // The link is inside the sentence: it reads as headlineText, and the announcement stays plain text.
    expect(verdictSentence()).toBe(headlineText(e.headline));
    expect(screen.getByRole("status").textContent).toBe(`Live. ${headlineText(e.headline)}`);
    expect(screen.getByRole("status").querySelector("a")).toBeNull();
  });

  it.each([
    ["mixed", () => failSlot(passingBasket(results()), "NVDAc", "observe"), TS],
    ["refuse-all", () => passingBasket(results({ timestamp: SAT })), SAT],
  ] as const)("does not link vault checks not run when the headline is %s", async (kind, make, at) => {
    const r = make();
    await mount(r, at + 14);
    expect(expected(r).headline.kind).toBe(kind);
    expect(board().querySelector("[data-verdict-line]")).toHaveAttribute("data-verdict-line", kind);
    expect(board().querySelector("[data-verdict-line] a")).toBeNull();
    expect(screen.queryByRole("link", { name: VAULT_NOT_RUN })).toBeNull();
  });

  it("says NOT LIVE when the RPC's latest block is far behind the visitor's clock, and mutes the rows", async () => {
    const lag = HEAD_MAX_LAG_SEC + 180;
    await mount(results(), TS + lag);
    expect(board()).toHaveAttribute("data-now-board", "behind");
    expect(screen.getByText("NOT LIVE")).toBeInTheDocument();
    expect(screen.queryByText("LIVE")).toBeNull();
    expect(board()).toHaveTextContent(`the RPC's latest block 60,013,066 is ${formatAge(lag)} behind your clock`);
    expect(board().querySelector("[data-verdict-line]")).toHaveAttribute("data-tone", "muted");
    expect(document.querySelector("[data-now-rows]")).toHaveAttribute("data-tone", "muted");
    expect(screen.getByRole("status").textContent).toBe(`Not live. ${headlineText(expected(results()).headline)}`);
    // The values read are still shown, muted, not replaced by dashes.
    for (const el of values("AAPLc", "nav")) expect(el.textContent).toBe(formatUsd8(expected(results()).tokens.find((t) => t.symbol === "AAPLc")!.feed!.answer));
    neverSafe();
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
    expect(fake.multicalls()).toBe(2);
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
    expect(fake.multicalls()).toBe(2);
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    for (const el of values("AAPLc", "nav")) expect(el.textContent).not.toBe("—");
    neverSafe();
  });
});
