import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Page, { metadata } from "@/app/(site)/gap-index/page";
import { GapChart } from "@/components/gap/GapChart";
import { TokenTabs } from "@/components/gap/TokenTabs";
import { NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import { formatInt } from "@/content/format";
import { etDateTime, formatHours, gapBps, PUBLISHED, signedBps, TAB_ORDER } from "@/content/gap-index";
import edition0 from "@/content/gap-index/edition-0.json";
import { ANSWER_UPDATED_TOPIC, SWAP_TOPIC } from "@/lib/gap/decode";
import { GAP_RPC } from "@/lib/gap/rpc";
import { EditionFileSchema, type EditionFile } from "@/lib/gap/schema";
import { SITE } from "@/lib/site";

type Win = EditionFile["windows"][number];
type Complete = Extract<Win, { status: "complete" }>;

const windows = PUBLISHED.flatMap((e) => e.windows);
const complete = windows.filter((w): w is Complete => w.status === "complete");
const pending = windows.filter((w) => w.status === "pending");
const nvda1113 = () => {
  const w = complete.find((x) => x.id === "2026-11-13")!;
  return { w, row: w.tokens.find((t) => t.symbol === "NVDAc")! };
};

const TWAP_SENTENCE = `the pool's spot price after a swap, not the ${FACTS.mandate.value.twapWindowSec / 60}-minute TWAP the vault checks`;
const neverSafe = (text: string) => expect(text).not.toMatch(/safe/i);

describe("the published editions", () => {
  it("holds every committed edition file, parsed with the schema, latest first", () => {
    expect(PUBLISHED.length).toBeGreaterThanOrEqual(1);
    const numbers = PUBLISHED.map((e) => e.edition);
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
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
    expect(etDateTime(1794612983)).toBe("Fri 13 Nov 18:36 ET");
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

  it("names itself in its metadata: title, description, canonical /gap-index and the landing's link preview image", () => {
    expect(metadata.title).toBe("Weekend Gap Index · Maat");
    const description = String(metadata.description);
    expect(description.length).toBeGreaterThanOrEqual(50);
    expect(description.length).toBeLessThanOrEqual(160);
    neverSafe(description);
    expect(metadata.alternates?.canonical).toBe("/gap-index");
    const image = {
      url: "/opengraph-image.png",
      type: "image/png",
      width: 1200,
      height: 630,
      alt: readFileSync(join(process.cwd(), "app/opengraph-image.alt.txt"), "utf8"),
    };
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
        `${w.closeLabel} → ${w.openLabel} · blocks ${formatInt(w.blocks.from)} → ${formatInt(w.blocks.to)}`,
      );
      for (const b of [w.blocks.from, w.blocks.to]) {
        const a = within(head).getByRole("link", { name: formatInt(b) });
        expect(a).toHaveAttribute("href", `https://basescan.org/block/${b}`);
        expect(a).toHaveAttribute("rel", "noopener noreferrer");
      }
    }
    expect(section("2026-11-13").querySelector("[data-window-headline]")!.textContent).toBe(
      "Fri 13 Nov 16:00 ET → Mon 16 Nov 09:30 ET · blocks 57,066,122 → 58,245,121",
    );
  });

  it("puts every token's figures of every complete window in its table row and in its chart", () => {
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
        expect(chart).toHaveTextContent(`${formatHours(f.hours)} frozen`);
        expect(chart).toHaveTextContent(`${formatInt(f.swapsWhileFrozen)} swaps meanwhile`);
        expect(chart).toHaveTextContent(`feed came back ${signedBps(f.returnMoveBps)}`);
        if (t.largestGap) {
          const g = gapBps(t.largestGap);
          expect(cell("gap"), name).toHaveTextContent(g);
          const links = cell("gap").querySelectorAll("a");
          expect(links, name).toHaveLength(1);
          const link = links[0]!;
          expect(link.textContent?.startsWith(g), name).toBe(true);
          expect(link).toHaveAttribute("href", `https://basescan.org/tx/${t.largestGap.tx}`);
          expect(chart.querySelector("[data-gap-value]")!.textContent).toBe(g);
          expect(chart).toHaveTextContent(`pool ${t.largestGap.above ? "above" : "below"} the held answer`);
          expect(chart).toHaveTextContent(TWAP_SENTENCE);
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
    for (const text of ["pool above the held answer", "49.40 h frozen", "17,478 swaps meanwhile", "feed came back +254 bps"]) {
      expect(chart).toHaveTextContent(text);
    }
    const below = section("2026-11-13").querySelector<HTMLElement>('[data-gap-chart="CRCLc"]')!;
    expect(below.querySelector("[data-gap-value]")!.textContent).toBe("−1,012 bps");
    expect(below.querySelector("[data-gap-value]")).toHaveClass("text-refuse");
    expect(below).toHaveTextContent("pool below the held answer");
  });

  it("says when a pending window will be measured, and shows no figure for it", () => {
    setup();
    expect(pending.length).toBeGreaterThan(0);
    for (const w of pending) {
      const s = section(w.id);
      expect(s).toHaveAttribute("data-status", "pending");
      expect(s.querySelector("[data-window-headline]")!.textContent).toBe(`${w.closeLabel} → ${w.openLabel}`);
      expect(s).toHaveTextContent(`Measured after it ends, ${w.openLabel}`);
      expect(s.querySelector("table, svg, [data-token-tabs], [data-gap-chart]")).toBeNull();
      expect(s.textContent).not.toMatch(/bps|\d h\b|swaps|blocks/);
    }
    expect(section("2026-11-20")).toHaveTextContent("Measured after it ends, Mon 23 Nov 09:30 ET");
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
    for (const text of [
      GAP_RPC,
      ANSWER_UPDATED_TOPIC,
      SWAP_TOPIC,
      "npm run gap-index -- --edition 0 --window <id> --token <SYM> --stdout",
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
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const w of complete) {
      const s = doc.querySelector(`section[data-window="${w.id}"]`)!;
      expect(s.querySelectorAll("[data-gap-chart]")).toHaveLength(NAV_TOKENS.length);
      expect(s.querySelectorAll("[hidden]")).toHaveLength(0);
      const nvda = w.tokens.find((t) => t.symbol === "NVDAc")!;
      expect(s.textContent).toContain(`${formatHours(nvda.freeze!.hours)} frozen`);
    }
    neverSafe(html);
    neverSafe(setup().textContent ?? "");
  });
});

describe("GapChart", () => {
  const draw = (w: Complete, symbol: string) => render(<GapChart row={w.tokens.find((t) => t.symbol === symbol)!} window={w} />).container;

  it("names the chart with the figures of its header and the window", () => {
    const { w } = nvda1113();
    const svg = within(draw(w, "NVDAc")).getByRole("img");
    const label = svg.getAttribute("aria-label")!;
    for (const text of [
      "NVDAc",
      w.closeLabel,
      w.openLabel,
      "+356 bps",
      "pool above the held answer",
      "49.40 h frozen",
      "17,478 swaps meanwhile",
      "feed came back +254 bps",
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
    const w = complete[0]!;
    const c = draw(w, "ANTc");
    expect(c).toHaveTextContent("feed not live in this window");
    expect(c).toHaveTextContent("0 swaps in window");
    expect(c).not.toHaveTextContent(/bps|frozen|meanwhile/);
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
  const ui = <TokenTabs windowId="2026-11-13" tabs={tabs} panels={panels} />;

  it("renders every panel with its heading and no tablist before it mounts", () => {
    const html = renderToString(ui);
    expect(html).not.toContain("tablist");
    expect(html).not.toContain("hidden");
    for (const t of tabs) expect(html).toContain(`${t.label} chart`);
  });

  it("renders a tablist of pill tabs after it mounts, each tab controlling its own panel", () => {
    render(ui);
    const list = screen.getByRole("tablist");
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
