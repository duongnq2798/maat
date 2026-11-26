import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Page, { metadata } from "@/app/(site)/gap-index/page";
import { escapeHtml, GAP_TONE, GapChart } from "@/components/gap/GapChart";
import { GapWindow } from "@/components/gap/GapWindow";
import { TokenTabs } from "@/components/gap/TokenTabs";
import { WindowTable } from "@/components/gap/WindowTable";
import { NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import { etDateTime, formatHours, gapBps, gapSide, PUBLISHED, signedBps, TAB_ORDER } from "@/content/gap-index";
import edition0 from "@/content/gap-index/edition-0.json";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { pageOgImage } from "@/content/page-cards";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC } from "@/lib/gap/decode";
import { LOOKBACK_SEC } from "@/lib/gap/measure";
import { GAP_RPC, GAP_RPC_FIRST_BLOCK, GAP_RPC_FIRST_BLOCK_TS, SPAN } from "@/lib/gap/rpc";
import { EditionFileSchema, type EditionFile } from "@/lib/gap/schema";
import { SITE } from "@/lib/site";

type Win = EditionFile["windows"][number];
type Complete = Extract<Win, { status: "complete" }>;

const windows = PUBLISHED.flatMap((e) => e.windows);
const complete = windows.filter((w): w is Complete => w.status === "complete");
const nvda1113 = () => {
  const w = complete.find((x) => x.id === "2026-11-13")!;
  return { w, row: w.tokens.find((t) => t.symbol === "NVDAc")! };
};

const TWAP_SENTENCE = `the pool's spot price after a swap, not the ${FACTS.mandate.value.twapWindowSec / 60}-minute TWAP the vault checks`;
const neverSafe = (text: string) => expect(text).not.toMatch(/safe/i);

describe("the published editions", () => {
  it("holds every committed edition file, parsed with the schema, latest first, one per edition", () => {
    expect(PUBLISHED.length).toBeGreaterThanOrEqual(1);
    const numbers = PUBLISHED.map((e) => e.edition);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(PUBLISHED.find((e) => e.edition === 0)).toEqual(EditionFileSchema.parse(edition0));
  });

  it("orders the tabs with the basket first, then the rest alphabetically", () => {
    const rest = NAV_TOKENS.map((t) => t.symbol)
      .filter((s) => !(FACTS.basket.value as readonly string[]).includes(s))
      .sort();
    expect(TAB_ORDER).toEqual([...FACTS.basket.value, ...rest]);
    expect(TAB_ORDER.slice(0, 4)).toEqual(["NVDAc", "GOOGLc", "AAPLc", "AMZNc"]);
  });

  it("writes hours to two decimals, signed bps with a true minus, and ET times with their day", () => {
    expect(formatHours(49.4)).toBe("49.40 h");
    expect(formatHours(53.04)).toBe("53.04 h");
    expect(signedBps(254)).toBe("+254 bps");
    expect(signedBps(-1262)).toBe("−1,262 bps");
    expect(signedBps(0)).toBe("0 bps");
    expect(gapBps({ bps: 356, above: true })).toBe("+356 bps");
    expect(gapBps({ bps: 45, above: false })).toBe("−45 bps");
    expect(gapBps({ bps: 0, above: true })).toBe("0 bps");
    expect(etDateTime(1794612983)).toBe("Fri 13 Nov 18:36 ET");
  });

  it("puts a gap above, below, or at the held answer when it is 0 bps, whatever its flag says", () => {
    expect(gapSide({ bps: 356, above: true })).toBe("above");
    expect(gapSide({ bps: 45, above: false })).toBe("below");
    expect(gapSide({ bps: 0, above: true })).toBe("at");
    expect(gapSide({ bps: 0, above: false })).toBe("at");
  });

  it("escapes every character HTML gives a meaning, for the table views' markup", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;");
    expect(escapeHtml("Fri 13 Nov 18:36 ET")).toBe("Fri 13 Nov 18:36 ET");
  });
});

describe("the /gap-index page", () => {
  // The page holds every window's charts and tables, so it is mounted once for these read-only tests (about 2 s in
  // jsdom), outside the testing library's per-test cleanup, and unmounted after them.
  let host: HTMLDivElement;
  let root: Root;
  beforeAll(async () => {
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root.render(<Page />));
  }, 60_000);
  afterAll(() => {
    act(() => root.unmount());
    host.remove();
  });
  const setup = () => host;
  const section = (id: string) => document.querySelector<HTMLElement>(`section[data-window="${id}"]`)!;

  it("has one h1, Weekend Gap Index, and never skips a heading level on the way down", () => {
    const c = setup();
    const headings = [...c.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    const levels = headings.map((h) => Number(h.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(/^Weekend Gap Index$/);
    levels.forEach((l, i) => {
      if (i > 0) expect(l - levels[i - 1]!).toBeLessThanOrEqual(1);
    });
  });

  it("opens with a skip link and the same small header as /now", () => {
    const c = setup();
    expect(c.querySelector('a[href="#main"]')).toHaveClass("skip-link");
    expect(c.querySelector("main#main")).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Maat home" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "Docs" })).toHaveAttribute("href", SITE.docsUrl);
    expect(within(nav).getByRole("link", { name: /View on GitHub/ })).toHaveAttribute("href", SITE.repoUrl);
  });

  it("names itself in its metadata: title, description, canonical /gap-index and its own link preview image", () => {
    expect(metadata.title).toBe("Weekend Gap Index · Maat");
    const description = String(metadata.description);
    expect(description.length).toBeGreaterThanOrEqual(50);
    expect(description.length).toBeLessThanOrEqual(160);
    neverSafe(description);
    expect(metadata.alternates?.canonical).toBe("/gap-index");
    const image = pageOgImage("/gap-index");
    const og = metadata.openGraph as { url?: string; title?: string; description?: string; images?: unknown };
    expect(og.url).toBe("/gap-index");
    expect(og.title).toBe("Weekend Gap Index · Maat");
    expect(og.description).toBe(description);
    expect(og.images).toEqual([image]);
    const twitter = metadata.twitter as { card?: string; title?: string; images?: unknown };
    expect(twitter.card).toBe("summary_large_image");
    expect(twitter.title).toBe("Weekend Gap Index · Maat");
    expect(twitter.images).toEqual([image]);
  });

  it("shows the editions latest first, each with all of its windows", () => {
    const c = setup();
    const shown = [...c.querySelectorAll<HTMLElement>("section[data-edition]")].map((s) => Number(s.dataset.edition));
    expect(shown).toEqual(PUBLISHED.map((e) => e.edition));
    for (const e of PUBLISHED) {
      const ed = c.querySelector<HTMLElement>(`section[data-edition="${e.edition}"]`)!;
      expect(within(ed).getByRole("heading", { level: 2 })).toHaveTextContent(e.title);
      expect([...ed.querySelectorAll<HTMLElement>("section[data-window]")].map((s) => s.dataset.window)).toEqual(e.windows.map((w) => w.id));
    }
  });

  it("heads each complete window with its close, its open and its blocks, each block linked to Basescan", () => {
    setup();
    expect(complete.length).toBeGreaterThan(0);
    for (const w of complete) {
      const head = section(w.id).querySelector<HTMLElement>("[data-window-headline]")!;
      expect(head.textContent).toBe(
        `${w.closeLabel} → ${w.openLabel} · window ${w.id} · blocks ${formatInt(w.blocks.from)} → ${formatInt(w.blocks.to)}`,
      );
      for (const b of [w.blocks.from, w.blocks.to]) {
        const a = within(head).getByRole("link", { name: formatInt(b) });
        expect(a).toHaveAttribute("href", `https://basescan.org/block/${b}`);
        expect(a).toHaveAttribute("rel", "noopener noreferrer");
      }
    }
    expect(section("2026-11-13").querySelector("[data-window-headline]")!.textContent).toBe(
      "Fri 13 Nov 16:00 ET → Mon 16 Nov 09:30 ET · window 2026-11-13 · blocks 57,066,122 → 58,245,121",
    );
  });

  it("prints under each complete window the command that reproduces its rows, with its own edition and id, and pipe-safe", () => {
    setup();
    for (const e of PUBLISHED) {
      for (const w of e.windows) {
        const command = section(w.id).querySelector("[data-window-command]");
        if (w.status !== "complete") {
          expect(command, w.id).toBeNull();
          continue;
        }
        expect(command!.textContent, w.id).toBe(`npm run -s gap-index -- --edition ${e.edition} --window ${w.id} --token <SYM> --stdout`);
      }
    }
    // Every command the page prints keeps npm's banner out of stdout.
    expect(document.body.textContent).not.toMatch(/npm run gap-index/);
  });

  // Its own timeout, as the static HTML test has: it walks every window, and each edition adds windows.
  it("puts every token's figures of every complete window in its table row and in its chart", { timeout: 60_000 }, () => {
    setup();
    for (const w of complete) {
      const s = section(w.id);
      const rows = [...s.querySelectorAll<HTMLElement>("[data-window-table] tbody tr")];
      expect(rows.map((r) => r.dataset.token)).toEqual(TAB_ORDER);
      for (const t of w.tokens) {
        const tr = s.querySelector<HTMLElement>(`[data-window-table] tr[data-token="${t.symbol}"]`)!;
        const chart = s.querySelector<HTMLElement>(`[data-gap-chart="${t.symbol}"]`)!;
        const name = `${w.id} ${t.symbol}`;
        expect(tr, name).not.toBeNull();
        expect(chart, name).not.toBeNull();
        const cell = (col: string) => tr.querySelector<HTMLElement>(`td[data-col="${col}"]`)!;
        expect(cell("swapsInWindow").textContent, name).toBe(formatInt(t.swapsInWindow));
        if (!t.freeze) {
          expect(cell("notLive"), name).toHaveTextContent("feed not live in this window");
          expect(cell("notLive")).toHaveAttribute("colspan", "4");
          expect(chart).toHaveTextContent("feed not live in this window");
          expect(chart).toHaveTextContent(`${formatInt(t.swapsInWindow)} swaps in window`);
          continue;
        }
        const f = t.freeze;
        expect(cell("hours"), name).toHaveTextContent(formatHours(f.hours));
        expect(cell("hours")).toHaveTextContent(`${etDateTime(f.from.ts)} → ${etDateTime(f.to.ts)}`);
        expect(cell("hours")).toHaveTextContent(`blocks ${formatInt(f.from.block)} → ${formatInt(f.to.block)}`);
        // Plain selectors here: role queries over the whole page's cells take seconds in jsdom.
        expect([...cell("hours").querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")])).toEqual(
          [f.from.block, f.to.block].map((b) => [formatInt(b), `https://basescan.org/block/${b}`]),
        );
        expect(cell("swapsWhileFrozen").textContent, name).toBe(formatInt(f.swapsWhileFrozen));
        expect(cell("returnMove").textContent, name).toBe(signedBps(f.returnMoveBps));
        expect(chart).toHaveTextContent(`${formatHours(f.hours)} held without an update`);
        expect(chart).toHaveTextContent(`feed came back ${signedBps(f.returnMoveBps)}`);
        if (t.largestGap) {
          // The gap's two prices, as the edition holds them with all 8 decimals, in the chart's header and under the table's bps.
          const prices = `pool ${t.largestGap.pool} vs held ${t.largestGap.held}`;
          expect(t.largestGap.pool, name).toMatch(/^\d+\.\d{8}$/);
          expect(chart.querySelector("[data-gap-prices]")!.textContent, name).toBe(prices);
          expect(cell("gap").querySelector("[data-gap-prices]")!.textContent, name).toBe(prices);
          expect(chart.querySelector("svg[role=img]")!.getAttribute("aria-label"), name).toContain(prices);
          expect(chart).toHaveTextContent(`${formatInt(f.swapsWhileFrozen)} ${f.swapsWhileFrozen === 1 ? "swap" : "swaps"} meanwhile`);
          const g = gapBps(t.largestGap);
          const tone = GAP_TONE[gapSide(t.largestGap)];
          expect(cell("gap"), name).toHaveTextContent(g);
          const links = cell("gap").querySelectorAll("a");
          expect(links, name).toHaveLength(1);
          const link = links[0]!;
          expect(link.textContent?.startsWith(g), name).toBe(true);
          expect(link).toHaveAttribute("href", `https://basescan.org/tx/${t.largestGap.tx}`);
          // Hued like the chart, and underlined, so it reads as a link whatever its hue.
          expect(link, name).toHaveClass(tone, "underline");
          expect(chart.querySelector("[data-gap-value]")!.textContent).toBe(g);
          expect(chart.querySelector("[data-gap-value]"), name).toHaveClass(tone);
          expect(chart).toHaveTextContent(`pool ${gapSide(t.largestGap)} the held answer`);
          expect(chart).toHaveTextContent(TWAP_SENTENCE);
        } else {
          expect(chart.querySelector("[data-gap-value]")!.textContent, name).toBe("no swap meanwhile");
          expect(chart.textContent, name).not.toMatch(/\d swaps? meanwhile/);
        }
      }
      expect(s.querySelector("[data-window-table]")!.parentElement).toHaveTextContent(TWAP_SENTENCE);
    }
  });

  it("shows NVDAc's weekend of 13 November as the edition file has it", () => {
    setup();
    const chart = section("2026-11-13").querySelector<HTMLElement>('[data-gap-chart="NVDAc"]')!;
    expect(chart.querySelector("[data-gap-value]")!.textContent).toBe("+356 bps");
    expect(chart.querySelector("[data-gap-value]")).toHaveClass("text-accent");
    for (const text of ["pool above the held answer", "49.40 h held without an update", "17,478 swaps meanwhile", "feed came back +254 bps"]) {
      expect(chart).toHaveTextContent(text);
    }
    const below = section("2026-11-13").querySelector<HTMLElement>('[data-gap-chart="CRCLc"]')!;
    expect(below.querySelector("[data-gap-value]")!.textContent).toBe("−1,012 bps");
    expect(below.querySelector("[data-gap-value]")).toHaveClass("text-refuse");
    expect(below).toHaveTextContent("pool below the held answer");
  });

  it("shows no figure for a window that is pending in the committed files, and says when it will be measured", () => {
    setup();
    // Whichever windows are pending when the files are committed: a data-only rerun may leave none.
    for (const w of windows.filter((x) => x.status === "pending")) {
      const s = section(w.id);
      expect(s).toHaveAttribute("data-status", "pending");
      expect(s).toHaveTextContent(`Measured after it ends, ${w.openLabel}`);
      expect(s.querySelector("table, svg, [data-token-tabs], [data-gap-chart]")).toBeNull();
    }
  });

  it("names each window's tablist by the window's close, once the tabs mount", () => {
    setup();
    for (const w of complete) {
      const tabs = section(w.id).querySelector<HTMLElement>("[data-token-tabs]")!;
      expect(tabs).toHaveAttribute("data-token-tabs", "tabs");
      expect(tabs.querySelector('[role="tablist"]')).toHaveAttribute("aria-label", `Tokens, window closing ${w.closeLabel}`);
      expect(tabs.querySelectorAll("[data-panel]")).toHaveLength(NAV_TOKENS.length);
      expect(tabs.querySelector("[data-tabs-preview]")).toBeNull();
    }
    expect(section("2026-11-13").querySelector('[role="tablist"]')).toHaveAttribute(
      "aria-label",
      "Tokens, window closing Fri 13 Nov 16:00 ET",
    );
  });

  it("puts each window's table in a scroll region a keyboard can reach", () => {
    setup();
    for (const w of complete) {
      const region = section(w.id).querySelector<HTMLElement>("[data-window-table]")!;
      expect(region).toHaveAttribute("role", "region");
      expect(region).toHaveAttribute("tabindex", "0");
      expect(region.getAttribute("aria-label")).toContain(w.closeLabel);
      // relative too: the sr-only text in its links is absolutely positioned, and would otherwise widen the page.
      expect(region).toHaveClass("overflow-x-auto", "relative");
      expect(region.querySelector("table caption")).not.toBeNull();
    }
  });

  it("says how the numbers are read: the RPC, both topics, the command, no server, and a link to /now", () => {
    setup();
    const method = document.querySelector<HTMLElement>("section#method")!;
    expect(within(method).getByRole("heading", { level: 2 })).toHaveTextContent("How these numbers are read");
    // The command's edition and the example window come from one edition: the latest with a measured window.
    const edition = PUBLISHED.find((e) => e.windows.some((w) => w.status === "complete"))!;
    const example = edition.windows.find((w) => w.status === "complete")!.id;
    for (const text of [
      GAP_RPC,
      ANSWER_UPDATED_TOPIC,
      SWAP_TOPIC,
      `npm run -s gap-index -- --edition ${edition.edition} --window <id> --token <SYM> --stdout`,
      `such as ${example}`,
      // The keyless endpoint's floor, from the named constants, and the look-back as the code reads it.
      `The endpoint serves blocks from ${formatInt(GAP_RPC_FIRST_BLOCK)} (${new Date(GAP_RPC_FIRST_BLOCK_TS * 1000).toISOString().slice(0, 10)}), so it reproduces every window since then; older blocks need an archive node.`,
      `${formatInt(SPAN)} blocks at a time, until the last update before it, stopping once a span starts more than ${LOOKBACK_SEC / 86_400} days before the close`,
      `at most ${LOOKBACK_SEC / 86_400} days, until the first update at or after the open`,
      "logs from two aggregators in one token's ranges fail the run, and a token with no update records the latest phase",
      "Nothing here is signed, and the site has no server.",
      TWAP_SENTENCE,
    ]) {
      expect(method).toHaveTextContent(text);
    }
    expect(within(method).getAllByRole("link").some((a) => a.getAttribute("href") === "/now")).toBe(true);
  });

  it("holds every panel, every figure and no tablist in its static HTML, and never says safe", { timeout: 60_000 }, () => {
    const html = renderToString(<Page />);
    expect(html).not.toContain('role="tablist"');
    // One no-JS style for the whole page: every panel shows and the preview of the tab row does not.
    expect(html.match(/<noscript>/g)).toHaveLength(1);
    expect(html).toContain(
      '<noscript><style>[data-token-tabs="all"]>[data-panel]~[data-panel]{display:block}[data-tabs-preview]{display:none}</style></noscript>',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const w of complete) {
      const s = doc.querySelector(`section[data-window="${w.id}"]`)!;
      // Plain attribute reads: the parsed document's elements are not the test window's, which jest-dom requires.
      expect(s.querySelector("[data-token-tabs]")!.getAttribute("data-token-tabs")).toBe("all");
      expect(s.querySelector("[data-tabs-preview]")!.getAttribute("aria-hidden")).toBe("true");
      expect(s.querySelectorAll("[data-panel]")).toHaveLength(NAV_TOKENS.length);
      expect(s.querySelectorAll("[data-gap-chart]")).toHaveLength(NAV_TOKENS.length);
      expect(s.querySelectorAll("[hidden]")).toHaveLength(0);
      const nvda = w.tokens.find((t) => t.symbol === "NVDAc")!;
      expect(s.textContent).toContain(`${formatHours(nvda.freeze!.hours)} held without an update`);
    }
    neverSafe(html);
    neverSafe(setup().textContent ?? "");
  });
});

describe("a pending window", () => {
  // Built here, so the test never depends on which windows the committed files leave pending.
  const w: Win = { status: "pending", ...editionWindows(EDITIONS[0]!).find((x) => x.id === "2026-11-20")! };

  it("says when it will be measured and shows no figure", () => {
    const s = render(<GapWindow w={w} edition={0} />).container.querySelector<HTMLElement>("section")!;
    expect(s).toHaveAttribute("data-window", w.id);
    expect(s).toHaveAttribute("data-status", "pending");
    expect(s.querySelector("[data-window-headline]")!.textContent).toBe(`${w.closeLabel} → ${w.openLabel}`);
    expect(s).toHaveTextContent("Measured after it ends, Mon 23 Nov 09:30 ET");
    expect(s.querySelector("table, svg, [data-token-tabs], [data-gap-chart], a")).toBeNull();
    expect(s.textContent).not.toMatch(/bps|\d h\b|swaps|blocks|npm run/);
  });
});

describe("GapChart", () => {
  const draw = (w: Complete, symbol: string) => render(<GapChart row={w.tokens.find((t) => t.symbol === symbol)!} window={w} />).container;

  it("names the chart with the figures of its header and the window", () => {
    const { w, row } = nvda1113();
    const svg = within(draw(w, "NVDAc")).getByRole("img");
    const label = svg.getAttribute("aria-label")!;
    for (const text of [
      "NVDAc",
      w.closeLabel,
      w.openLabel,
      "+356 bps",
      "pool above the held answer",
      "49.40 h held without an update",
      "17,478 swaps meanwhile",
      "feed came back +254 bps",
      `pool ${row.largestGap!.pool} vs held ${row.largestGap!.held}`,
    ]) {
      expect(label).toContain(text);
    }
  });

  it("draws the pool line over a fading fill, the feed as a step line dashed over the freeze, and no axis or gridline", () => {
    const { w, row } = nvda1113();
    const c = draw(w, "NVDAc");
    const svg = c.querySelector("svg[role=img]")!;
    expect(svg).toHaveAttribute("viewBox", "0 0 1000 300");
    expect(svg).toHaveAttribute("preserveAspectRatio", "none");
    const pool = svg.querySelector('[data-series="pool"]')!;
    expect(pool).toHaveAttribute("vector-effect", "non-scaling-stroke");
    expect(pool).toHaveAttribute("stroke-width", "2");
    const stops = [...svg.querySelectorAll("stop")];
    expect(stops.map((s) => s.getAttribute("stop-opacity"))).toEqual(["0.18", "0"]);
    expect(svg.querySelector('[data-series="fill"]')!.getAttribute("fill")).toMatch(/^url\(#/);
    const held = svg.querySelector<SVGPathElement>('[data-series="held"]')!;
    expect(held).toHaveAttribute("stroke-dasharray");
    const span = w.openTs - w.closeTs;
    const x = (ts: number) => ((ts - w.closeTs) / span) * 1000;
    const nums = held.getAttribute("d")!.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(nums[0]).toBeCloseTo(x(Math.max(w.closeTs, row.freeze!.from.ts)), 0);
    expect(nums[2]).toBeCloseTo(x(Math.min(w.openTs, row.freeze!.to.ts)), 0);
    expect(svg.querySelector('[data-series="feed"]')).not.toBeNull();
    expect(svg.querySelector('[data-series="last"]')).not.toBeNull();
    expect(svg.querySelectorAll("text, line")).toHaveLength(0);
    const ends = c.querySelector("[data-window-ends]")!;
    expect(ends.firstElementChild).toHaveTextContent(w.closeLabel);
    expect(ends.lastElementChild).toHaveTextContent(w.openLabel);
  });

  it("lists every plotted point in a table view, in ET, with the series and the price in USD", () => {
    const { w, row } = nvda1113();
    const c = draw(w, "NVDAc");
    const details = c.querySelector("details")!;
    expect(details.querySelector("summary")).toHaveTextContent("Table view");
    const rows = [...details.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(row.series.pool.length + row.series.feed.length);
    const first = row.series.feed[0]!;
    expect(rows[0]).toHaveTextContent(`${etDateTime(first[0])}feed${first[1]}`);
    expect(details.querySelector("thead")).toHaveTextContent("USD");
  });

  it("says feed not live in this window, and the swaps in window, for a token without a live feed", () => {
    // ANTc's feed was not live in edition 0's first window: named by id, so a later edition published first changes nothing.
    const w = complete.find((x) => x.id === "2026-11-06")!;
    const c = draw(w, "ANTc");
    expect(c).toHaveTextContent("feed not live in this window");
    expect(c).toHaveTextContent("0 swaps in window");
    expect(c).not.toHaveTextContent(/bps|held without|meanwhile/);
  });

  // The y of every vertex a path draws: M and L carry x then y, H an x, V a y.
  const ysOf = (d: string) => {
    const ys: number[] = [];
    let cmd = "";
    let n = 0;
    for (const tok of d.match(/[MLHVZ]|-?\d+(?:\.\d+)?/g)!) {
      if (/[A-Z]/.test(tok)) {
        cmd = tok;
        n = 0;
      } else if (cmd === "V" || ((cmd === "M" || cmd === "L") && n++ % 2 === 1)) {
        ys.push(Number(tok));
      }
    }
    return ys;
  };

  it("maps prices to y over their range padded by 8% each side, the held answer included", () => {
    const { w, row } = nvda1113();
    const svg = draw(w, "NVDAc").querySelector("svg[role=img]")!;
    const d = (series: string) => svg.querySelector(`[data-series="${series}"]`)!.getAttribute("d")!;
    const held = Number(row.freeze!.from.answer);
    const prices = [...row.series.pool, ...row.series.feed].map(([, p]) => Number(p)).concat(held);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const pad = (max - min) * 0.08;
    const y = (p: number) => 300 - ((p - (min - pad)) / (max - min + 2 * pad)) * 300;

    // The highest and lowest points sit 0.08 / 1.16 of the height from the top and from the bottom.
    const ys = [...ysOf(d("pool")), ...ysOf(d("feed")), ...ysOf(d("held"))];
    expect(Math.min(...ys)).toBeCloseTo((300 * 0.08) / 1.16, 1);
    expect(Math.max(...ys)).toBeCloseTo(300 - (300 * 0.08) / 1.16, 1);
    expect(ysOf(d("pool"))[0]).toBeCloseTo(y(Number(row.series.pool[0]![1])), 1);
    // The held line is flat, at the held answer's y.
    expect(ysOf(d("held"))).toHaveLength(1);
    expect(ysOf(d("held"))[0]).toBeCloseTo(y(held), 1);
  });

  it("hues a below-gap row's line, fill and key refuse, and keeps the feed in ink", () => {
    const w = complete.find((x) => x.id === "2026-11-13")!;
    const row = w.tokens.find((t) => t.symbol === "CRCLc")!;
    expect(row.largestGap?.above).toBe(false);
    const c = draw(w, "CRCLc");
    const svg = c.querySelector("svg[role=img]")!;
    expect(svg).toHaveClass("text-refuse");
    expect(svg).not.toHaveClass("text-accent");
    expect(svg.querySelector('[data-series="pool"]')).toHaveAttribute("stroke", "currentColor");
    const fill = svg.querySelector('[data-series="fill"]')!.getAttribute("fill")!;
    const gradient = svg.querySelector(`[id="${/^url\(#(.+)\)$/.exec(fill)![1]}"]`)!;
    expect([...gradient.querySelectorAll("stop")].map((s) => s.getAttribute("stop-color"))).toEqual(["currentColor", "currentColor"]);
    expect(svg.querySelector('[data-series="feed"]')!.parentElement).toHaveClass("text-ink-2");
    expect(c.querySelector("li svg")).toHaveClass("text-refuse");
  });

  it("says pool at the held answer, in ink, for a gap of 0 bps, in the chart and in the table", () => {
    const { w, row } = nvda1113();
    const zero = { ...row, largestGap: { ...row.largestGap!, bps: 0, above: true } };
    const c = render(<GapChart row={zero} window={w} />).container;
    const value = c.querySelector("[data-gap-value]")!;
    expect(value.textContent).toBe("0 bps");
    expect(value).toHaveClass("text-ink");
    expect(value).not.toHaveClass("text-accent");
    expect(c).toHaveTextContent("pool at the held answer");
    const svg = c.querySelector("svg[role=img]")!;
    expect(svg).toHaveClass("text-ink");
    expect(svg.getAttribute("aria-label")).toContain("Largest gap 0 bps, pool at the held answer.");

    const t = render(<WindowTable window={{ ...w, tokens: w.tokens.map((x) => (x.symbol === "NVDAc" ? zero : x)) }} />).container;
    const cell = t.querySelector('tr[data-token="NVDAc"] td[data-col="gap"]')!;
    expect(cell.querySelector("a")).toHaveClass("text-ink", "underline");
    expect(cell.querySelector("a")).not.toHaveClass("text-accent");
    expect(cell).toHaveTextContent("0 bps");
    expect(cell).toHaveTextContent("pool at the held answer");
    expect(t.querySelector('tr[data-token="CRCLc"] td[data-col="gap"] a')).toHaveClass("text-refuse", "underline");
  });

  it("says no swap meanwhile once, and gives no count, for a freeze without a swap", () => {
    const { w, row } = nvda1113();
    const quiet = { ...row, largestGap: null, freeze: { ...row.freeze!, swapsWhileFrozen: 0 } };
    const c = render(<GapChart row={quiet} window={w} />).container;
    const header = c.querySelector("[data-gap-chart]")!.firstElementChild!;
    expect(header.textContent!.match(/no swap meanwhile/g)).toHaveLength(1);
    expect(header.textContent).not.toMatch(/\d swaps? meanwhile/);
    expect(header).toHaveTextContent(`${formatHours(row.freeze!.hours)} held without an update`);
    const label = c.querySelector("svg[role=img]")!.getAttribute("aria-label")!;
    expect(label.match(/no swap meanwhile/gi)).toHaveLength(1);
    expect(label).not.toMatch(/\d swaps? meanwhile/);
    expect(c).not.toHaveTextContent(/Largest gap|The gap compares/);
  });
});

describe("TokenTabs", () => {
  const tabs = [
    { id: "NVDAc", label: "NVDAc" },
    { id: "GOOGLc", label: "GOOGLc" },
    { id: "AAPLc", label: "AAPLc" },
  ];
  const panels = tabs.map((t) => (
    <div key={t.id}>
      <h4>{`${t.label} chart`}</h4>
    </div>
  ));
  const label = "Tokens, window closing Fri 13 Nov 16:00 ET";
  const ui = <TokenTabs windowId="2026-11-13" label={label} tabs={tabs} panels={panels} />;

  it("renders every panel with its heading and no tablist before it mounts", () => {
    const html = renderToString(ui);
    expect(html).not.toContain("tablist");
    // No panel is hidden: only the preview of the tab row is aria-hidden.
    expect(html).not.toMatch(/\shidden\b/);
    for (const t of tabs) expect(html).toContain(`${t.label} chart`);
  });

  it("puts an inert preview of the pill row first before it mounts, then the panels, without tab roles", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(ui);
    const wrapper = host.querySelector("[data-token-tabs]")!;
    expect(wrapper).toHaveAttribute("data-token-tabs", "all");
    const [preview, ...rest] = [...wrapper.children];
    expect(preview).toHaveAttribute("data-tabs-preview");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect([...preview!.children].map((s) => [s.tagName, s.textContent])).toEqual(tabs.map((t) => ["SPAN", t.label]));
    expect(preview!.querySelectorAll("button, a, [tabindex]")).toHaveLength(0);
    expect(rest).toHaveLength(tabs.length);
    for (const p of rest) {
      expect(p).toHaveAttribute("data-panel");
      for (const a of ["role", "id", "aria-labelledby", "hidden", "tabindex"]) expect(p).not.toHaveAttribute(a);
    }
  });

  it("keeps one tree through hydration: the same wrapper, panel and heading nodes, the tablist in the preview's slot", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    host.innerHTML = renderToString(ui);
    const wrapper = host.querySelector("[data-token-tabs]")!;
    const before = [...host.querySelectorAll("[data-panel]")];
    const headings = [...host.querySelectorAll("h4")];
    const previewPills = [...host.querySelectorAll("[data-tabs-preview] span")];
    const errors: unknown[] = [];
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(host, ui, { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(host.querySelector("[data-token-tabs]")).toBe(wrapper);
    expect(wrapper).toHaveAttribute("data-token-tabs", "tabs");
    expect(wrapper.firstElementChild).toHaveAttribute("role", "tablist");
    expect(host.querySelector("[data-tabs-preview]")).toBeNull();
    const after = [...host.querySelectorAll("[data-panel]")];
    expect(after).toHaveLength(tabs.length);
    after.forEach((p, i) => expect(p).toBe(before[i]));
    [...host.querySelectorAll("h4")].forEach((h, i) => expect(h).toBe(headings[i]));
    expect(after[0]).toHaveAttribute("role", "tabpanel");
    expect(after[1]).toHaveAttribute("hidden");
    // The pills keep the preview's classes, so the row keeps its height.
    const buttons = [...host.querySelectorAll('[role="tab"]')];
    previewPills.forEach((span, i) => {
      for (const c of span.classList) expect(buttons[i]).toHaveClass(c);
    });
    act(() => root!.unmount());
    host.remove();
  });

  it("renders a tablist of pill tabs after it mounts, each tab controlling its own panel", () => {
    render(ui);
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("aria-label", label);
    const all = within(list).getAllByRole("tab");
    expect(all.map((t) => t.textContent)).toEqual(tabs.map((t) => t.label));
    all.forEach((tab, i) => {
      const panel = document.getElementById(tab.getAttribute("aria-controls")!)!;
      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
      expect(tab).toHaveAttribute("aria-selected", String(i === 0));
      expect(tab).toHaveAttribute("tabindex", i === 0 ? "0" : "-1");
      if (i === 0) expect(panel).not.toHaveAttribute("hidden");
      else expect(panel).toHaveAttribute("hidden");
    });
  });

  it("moves and selects with ArrowRight, ArrowLeft, Home and End, and selects on click", () => {
    render(ui);
    const all = screen.getAllByRole("tab");
    const selected = () => all.findIndex((t) => t.getAttribute("aria-selected") === "true");
    all[0]!.focus();
    fireEvent.keyDown(all[0]!, { key: "ArrowRight" });
    expect(selected()).toBe(1);
    expect(document.activeElement).toBe(all[1]);
    expect(screen.getByRole("tabpanel")).toHaveTextContent("GOOGLc chart");
    fireEvent.keyDown(all[1]!, { key: "End" });
    expect(selected()).toBe(2);
    expect(document.activeElement).toBe(all[2]);
    fireEvent.keyDown(all[2]!, { key: "ArrowRight" });
    expect(selected()).toBe(0);
    fireEvent.keyDown(all[0]!, { key: "ArrowLeft" });
    expect(selected()).toBe(2);
    fireEvent.keyDown(all[2]!, { key: "Home" });
    expect(selected()).toBe(0);
    expect(document.activeElement).toBe(all[0]);
    expect(all[0]).toHaveAttribute("tabindex", "0");
    expect(all[2]).toHaveAttribute("tabindex", "-1");
    fireEvent.click(all[1]!);
    expect(selected()).toBe(1);
  });
});
