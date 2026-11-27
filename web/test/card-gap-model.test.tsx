// The Gap Index card's model (lib/card/gap.ts) against /gap-index itself: every figure, label, line and path the card
// draws for a window is the one the page's components print for it, read from the same edition file.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { commandParts } from "@/components/gap/Command";
import { GapChart } from "@/components/gap/GapChart";
import { GapWindow } from "@/components/gap/GapWindow";
import { WindowTable } from "@/components/gap/WindowTable";
import { formatInt } from "@/content/format";
import { closureNote, type CompleteWindow, formatHours, rowsInTabOrder } from "@/content/gap-index";
import edition0 from "@/content/gap-index/edition-0.json";
import { GAP_FOOTER, gapCardModel } from "@/lib/card/gap";
import { SIGN_OFF } from "@/lib/card/model";
import { decisionCounts, type Sender } from "@/lib/gap/decisions";
import { EditionFileSchema, type EditionFile } from "@/lib/gap/schema";
import { syntheticEdition1 } from "./helpers/gap-edition";

const e0 = EditionFileSchema.parse(edition0);
const complete = (e: EditionFile) => e.windows.filter((w): w is CompleteWindow => w.status === "complete");
const e1 = syntheticEdition1(e0);

function dom(ui: ReactElement): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(ui);
  return host;
}
const text = (el: Element | null | undefined) => el?.textContent ?? null;

/** Edition 1 with every Decision sent by the owner by hand, as the vault's executor() is today. */
function ownerEdition1(n: number): EditionFile {
  const windows = e1.windows.map((w) => {
    if (w.status !== "complete" || !w.decisions) return w;
    const template = w.decisions.list[0] ?? { block: w.blocks.from, logIndex: 0, ts: w.closeTs, tx: `0x${"0".repeat(63)}1`, sender: "owner" as Sender, allowed: false, reason: "MARKET_CLOSED" as const };
    const list = Array.from({ length: n }, (_, i) => ({ ...template, block: w.blocks.from + i * 600, ts: w.closeTs + i * 120, tx: `0x${(i + 1).toString(16).padStart(64, "0")}`, sender: "owner" as Sender }));
    return { ...w, decisions: { ...w.decisions, ...decisionCounts(list), list } };
  });
  return EditionFileSchema.parse({ ...e1, windows });
}

describe("the Gap Index card's figures are /gap-index's", () => {
  it("covers every window of the committed edition 0, and each is complete", () => {
    expect(e0.windows.map((w) => [w.id, w.status])).toEqual([
      ["2026-11-06", "complete"],
      ["2026-11-13", "complete"],
      ["2026-11-20", "complete"],
    ]);
  });

  for (const w of complete(e0)) {
    for (const row of rowsInTabOrder(w)) {
      it(`${w.id} ${row.symbol}: the big figure, its side and prices, and the table's columns`, () => {
        const m = gapCardModel(e0, w.id, row.symbol);
        const chart = dom(<GapChart row={row} window={w} />);
        const tr = dom(<WindowTable window={w} />).querySelector(`tr[data-token="${row.symbol}"]`)!;
        const labels = [...dom(<WindowTable window={w} />).querySelectorAll("thead th")].map((th) => th.textContent);
        // Each cell's column under the headers: a token without an interval spans the four interval columns with one cell.
        const cols = [...tr.querySelectorAll("td")].flatMap((td) => Array<string | null>(td.colSpan).fill(td.getAttribute("data-col")));

        expect(m.symbol).toBe(row.symbol);
        expect(m.name).toBe(text(chart.querySelector("h4 span")));
        if (m.figure.kind === "gap") {
          expect(m.figure.label).toBe("Largest gap");
          expect(chart.textContent).toContain(m.figure.label);
          expect(m.figure.value).toBe(text(chart.querySelector("[data-gap-value]")));
          expect(text(tr.querySelector('[data-col="gap"] a'))).toBe(`${m.figure.value}, its transaction on Basescan`);
          expect(chart.textContent).toContain(`${m.figure.sideText} · ${m.figure.at}`);
          expect(m.figure.prices).toBe(text(chart.querySelector("[data-gap-prices]")));
          expect(m.figure.prices).toBe(text(tr.querySelector("[data-gap-prices]")));
        } else if (row.freeze) {
          expect(m.figure.text).toBe(text(chart.querySelector("[data-gap-value]")));
        } else {
          expect(m.figure.text).toBe(text(tr.querySelector('[data-col="noFreeze"], [data-col="notLive"]')));
          expect(chart.textContent).toContain(m.figure.text);
        }
        // Each figure under the big one is a column of the page's table, with that column's header.
        for (const s of m.stats) {
          const at = cols.indexOf(s.key);
          expect(at, s.key).toBeGreaterThanOrEqual(0);
          expect(s.label).toBe(labels[at + 1]);
          const cell = tr.querySelector(`[data-col="${s.key}"]`)!;
          expect(s.value).toBe(s.key === "hours" ? text(cell.querySelector("span")) : text(cell));
        }
        expect(m.stats.map((s) => s.key)).toEqual(row.freeze ? ["hours", "swapsWhileFrozen", "returnMove", "swapsInWindow"] : ["swapsInWindow"]);
      });

      it(`${w.id} ${row.symbol}: the chart's paths, ends and keys`, () => {
        const m = gapCardModel(e0, w.id, row.symbol);
        const chart = dom(<GapChart row={row} window={w} />);
        const d = (series: string) => chart.querySelector(`[data-series="${series}"]`)?.getAttribute("d") ?? "";
        if (!m.chart) {
          expect(chart.querySelector("svg[role=img]")).toBeNull();
          expect(chart.textContent).toContain(m.nothingToPlot);
          return;
        }
        expect([m.chart.line, m.chart.fill, m.chart.solid, m.chart.dashed]).toEqual([d("pool"), d("fill"), d("feed"), d("held")]);
        expect(m.chart.last && `M${m.chart.last[0]} ${m.chart.last[1]}h0`).toBe(chart.querySelector('[data-series="last"] path')?.getAttribute("d") ?? null);
        expect(m.ends).toEqual([...chart.querySelectorAll("[data-window-ends] span")].map((s) => s.textContent));
        expect(m.legend).toEqual([...chart.querySelectorAll("[data-window-ends] + ul li")].map((li) => li.textContent));
        expect(m.legend.length).toBeGreaterThan(0);
      });
    }
  }

  it("shows by default the token /gap-index shows first in a window's tabs", () => {
    for (const w of complete(e0)) {
      expect(gapCardModel(e0, w.id).symbol).toBe(rowsInTabOrder(w)[0]!.symbol);
    }
    expect(gapCardModel(e0, "2026-11-13").symbol).toBe("NVDAc");
  });

  it("writes NVDAc's 13 Nov window as the page does", () => {
    const m = gapCardModel(e0, "2026-11-13", "NVDAc");
    expect(m.figure).toEqual({
      kind: "gap",
      label: "Largest gap",
      value: "+356 bps",
      side: "above",
      sideText: "pool above the held answer",
      at: expect.stringMatching(/^\w{3} \d{1,2} Nov \d{2}:\d{2} ET$/),
      prices: expect.stringMatching(/^pool \d+\.\d{8} vs held \d+\.\d{8}$/),
    });
    expect(m.stats.map((s) => [s.label, s.value])).toEqual([
      ["Without a feed update", "49.40 h"],
      ["Swaps meanwhile", "17,478"],
      ["Feed came back", "+254 bps"],
      ["Swaps in window", "25,549"],
    ]);
  });
});

describe("the window, why it closed, and where the figures come from", () => {
  for (const w of complete(e0)) {
    it(`${w.id}: its ET span and blocks as its headline prints them, and the weekend that closed it`, () => {
      const m = gapCardModel(e0, w.id);
      const s = dom(<GapWindow w={w} edition={0} />);
      expect(m.span).toBe(text(s.querySelector("h3")));
      expect(text(s.querySelector("[data-window-headline] p"))).toBe(` · window ${w.id} · ${m.blocks}`);
      expect(m.title).toBe(`Gap Index · edition 0 · window ${w.id}`);
      // The page prints no note for a plain weekend; the card says what closed it, in the note's own words and hours.
      expect(closureNote(w)).toBeNull();
      expect(s.querySelector("[data-window-note]")).toBeNull();
      expect(m.note).toBe(`The weekend · ${formatHours((w.openTs - w.closeTs) / 3600)} closed`);
      expect(m.note).toBe("The weekend · 65.50 h closed");
    });
  }

  it("prints the closure note /gap-index prints for a holiday window and an early close", () => {
    const [thanksgiving, friday] = complete(e1);
    for (const w of [thanksgiving!, friday!]) {
      const s = dom(<GapWindow w={w} edition={1} />);
      expect(gapCardModel(e1, w.id).note).toBe(text(s.querySelector("[data-window-note]")));
    }
    expect(gapCardModel(e1, "2026-11-25").note).toBe("Thanksgiving, Thu 26 Nov · 41.50 h closed");
    expect(gapCardModel(e1, "2026-11-27").note).toBe("Early close at 13:00 ET, then the weekend · 68.50 h closed");
    expect(gapCardModel(e1, "2026-11-25").title).toBe("Gap Index · edition 1 · window 2026-11-25");
  });

  it("names the edition file and its head block, and the command that reproduces the row", () => {
    const m = gapCardModel(e0, "2026-11-20", "MSTRc");
    expect(m.source).toBe(`web/content/gap-index/edition-0.json · head block ${formatInt(e0.head.block)}`);
    expect(m.source).toBe("web/content/gap-index/edition-0.json · head block 61,273,559");
    expect(m.command).toBe(commandParts(0, "2026-11-20", "MSTRc").join(" "));
    expect(m.command).toBe("npm run -s gap-index -- --edition 0 --window 2026-11-20 --token MSTRc --stdout");
  });

  it("carries the data footer voice.md requires and the sign-off", () => {
    const m = gapCardModel(e0, "2026-11-06");
    expect([m.footer, m.signOff]).toEqual([GAP_FOOTER, SIGN_OFF]);
    expect(GAP_FOOTER).toBe("Data, not a signal. Not offered to US persons.");
    expect(SIGN_OFF).toBe("Every trade is weighed.");
  });

  it("names its files for the edition, the window and the token", () => {
    expect(gapCardModel(e0, "2026-11-13").stem).toBe("gap-index-0-2026-11-13-NVDAc");
    expect(gapCardModel(e0, "2026-11-06", "ANTc").stem).toBe("gap-index-0-2026-11-06-ANTc");
  });
});

describe("the vault's Decisions in the window", () => {
  it("says edition 0 does not count them, as the page prints no Decisions line for it", () => {
    for (const w of complete(e0)) {
      const m = gapCardModel(e0, w.id);
      expect(dom(<GapWindow w={w} edition={0} />).querySelector("[data-window-decisions]")).toBeNull();
      expect(m.decisions).toEqual({ counted: false, sentence: "Edition 0 does not count the vault's Decisions.", rows: [] });
    }
  });

  it("prints the Decisions sentence /gap-index prints, then each Decision with its /ledger sender label", () => {
    for (const w of complete(e1)) {
      const m = gapCardModel(e1, w.id);
      const line = dom(<GapWindow w={w} edition={1} />).querySelector("[data-window-decisions]");
      expect(m.decisions.counted).toBe(true);
      expect(m.decisions.sentence).toBe(text(line));
      expect(m.decisions.rows).toHaveLength(w.decisions!.count);
    }
    expect(gapCardModel(e1, "2026-11-25").decisions.sentence).toBe("The vault recorded no Decision in this window.");
    const friday = gapCardModel(e1, "2026-11-27").decisions;
    expect(friday.sentence).toBe("The vault recorded 3 Decisions in this window: 2 from the agent and 1 probe. It refused all 3 with MARKET_CLOSED. Each one is on the ledger.");
    expect(friday.rows.map((r) => [r.verdict, r.sender])).toEqual([
      ["Refused · Market closed (MARKET_CLOSED)", "probe"],
      ["Refused · Market closed (MARKET_CLOSED)", "agent"],
      ["Refused · Market closed (MARKET_CLOSED)", "agent"],
    ]);
    expect(friday.rows[0]!.at).toBe("Fri 27 Nov 13:01 ET");
  });

  it("labels an operator's Decision owner, by hand, never the agent's", () => {
    const m = gapCardModel(ownerEdition1(2), "2026-11-27");
    expect(m.decisions.sentence).toBe("The vault recorded 2 Decisions in this window: 2 from the owner by hand. It refused both with MARKET_CLOSED. Each one is on the ledger.");
    expect(m.decisions.rows.map((r) => r.sender)).toEqual(["owner, by hand", "owner, by hand"]);
    expect(JSON.stringify(m.decisions)).not.toMatch(/\bagent\b/);
  });

  it("labels a Decision sent through another contract as /ledger does", () => {
    const e = ownerEdition1(1);
    const windows = e.windows.map((w) => {
      if (w.status !== "complete" || !w.decisions || w.decisions.count === 0) return w;
      const list = w.decisions.list.map((d) => ({ ...d, sender: "unlabelled" as Sender }));
      return { ...w, decisions: { ...w.decisions, ...decisionCounts(list), list } };
    });
    const m = gapCardModel(EditionFileSchema.parse({ ...e, windows }), "2026-11-27");
    expect(m.decisions.rows.map((r) => r.sender)).toEqual(["sender not labeled"]);
  });
});

describe("what the card refuses to draw", () => {
  it("refuses a window the edition does not hold, naming the ones it does", () => {
    expect(() => gapCardModel(e0, "2026-11-14")).toThrow("edition 0 has no window 2026-11-14: its windows are 2026-11-06, 2026-11-13, 2026-11-20");
  });

  it("refuses a pending window: it has no figures until it ends", () => {
    const [first, ...rest] = e1.windows as [CompleteWindow, ...EditionFile["windows"]];
    const pending = { status: "pending" as const, id: first.id, closeTs: first.closeTs, openTs: first.openTs, closeLabel: first.closeLabel, openLabel: first.openLabel };
    const file = EditionFileSchema.parse({ ...e1, windows: [pending, ...rest] });
    expect(() => gapCardModel(file, "2026-11-25")).toThrow("window 2026-11-25 of edition 1 is pending: it is measured after it ends, Fri 27 Nov 09:30 ET");
  });

  it("refuses a token the window does not hold, naming the ones it does", () => {
    expect(() => gapCardModel(e0, "2026-11-13", "nvdac")).toThrow("window 2026-11-13 of edition 0 has no token nvdac: its tokens are NVDAc, GOOGLc, AAPLc, AMZNc");
  });
});
