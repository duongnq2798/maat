// @vitest-environment node
// The Gap Index card as drawn (brand/gap-card.tsx): its sizes, the same bytes every time, "below the held feed" in ink
// rather than the site's orange, the footer and sign-off on every card, and every text inside its margins.
import type { SatoriNode } from "satori";
import { beforeAll, describe, expect, it } from "vitest";
import { CARD_LAYOUTS, type CardLayout } from "@/brand/card";
import { GAP_CARD_TONE, gapCardFileName, gapCardSvg, gapChartSvg, renderGapCard } from "@/brand/gap-card";
import { PALETTE } from "@/brand/mark";
import { pngSize } from "@/brand/render";
import { GAP_TONE } from "@/components/gap/GapChart";
import { gapSide, rowsInTabOrder, type CompleteWindow } from "@/content/gap-index";
import edition0 from "@/content/gap-index/edition-0.json";
import { GAP_FOOTER, gapCardModel, type GapCardModel } from "@/lib/card/gap";
import { SIGN_OFF } from "@/lib/card/model";
import { decisionCounts, type Sender } from "@/lib/gap/decisions";
import { EditionFileSchema, type EditionFile } from "@/lib/gap/schema";
import { syntheticEdition1 } from "./helpers/gap-edition";

const LAYOUTS = Object.keys(CARD_LAYOUTS) as CardLayout[];
const e0 = EditionFileSchema.parse(edition0);
const e1 = syntheticEdition1(e0);
const complete = (e: EditionFile) => e.windows.filter((w): w is CompleteWindow => w.status === "complete");

/** Every token of edition 0 whose largest gap had the pool below the held answer, as [window, symbol]. */
const BELOW = complete(e0).flatMap((w) => w.tokens.filter((t) => t.largestGap && gapSide(t.largestGap) === "below").map((t) => [w.id, t.symbol] as const));
const ABOVE = complete(e0).flatMap((w) => w.tokens.filter((t) => t.largestGap && gapSide(t.largestGap) === "above").map((t) => [w.id, t.symbol] as const));

/** Every orange the site and the Weighing card use: --color-refuse, its tint, and the Balance's failing tick. */
const ORANGES = [PALETTE.refuse, PALETTE.refuseTint, "#FF5A1F"];

/** The card's SVG with every embedded SVG image decoded into it, so a colour inside the chart is found too. */
function withImages(svg: string): string {
  const inner = [...svg.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map((m) => Buffer.from(m[1]!, "base64").toString("utf8"));
  return [svg, ...inner].join("\n");
}

interface Box {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  props: Record<string, unknown>;
}
async function drawn(m: GapCardModel, layout: CardLayout): Promise<Box[]> {
  const boxes: Box[] = [];
  await gapCardSvg(m, layout, {
    onNodeDetected: (n: SatoriNode) => {
      if (n.textContent) boxes.push({ text: n.textContent, left: n.left, top: n.top, right: n.left + n.width, bottom: n.top + n.height, props: n.props });
    },
  });
  return boxes;
}
const find = (boxes: readonly Box[], text: string) => {
  const b = boxes.find((x) => x.text === text);
  if (!b) throw new Error(`not drawn: "${text}"; drawn: ${boxes.map((x) => JSON.stringify(x.text)).join(", ")}`);
  return b;
};
const fontSize = (b: Box) => (b.props.style as { fontSize?: number } | undefined)?.fontSize;

/** Edition 1 with `n` Decisions in each window, every one sent by the owner by hand, as executor() is today. */
function ownerEdition1(n: number): EditionFile {
  const windows = e1.windows.map((w) => {
    if (w.status !== "complete" || !w.decisions) return w;
    const list = Array.from({ length: n }, (_, i) => ({
      block: w.blocks.from + i * 600,
      logIndex: 0,
      ts: w.closeTs + 60 + i * 120,
      tx: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      sender: "owner" as Sender,
      allowed: false,
      reason: "MARKET_CLOSED" as const,
    }));
    return { ...w, decisions: { ...w.decisions, ...decisionCounts(list), list } };
  });
  return EditionFileSchema.parse({ ...e1, windows });
}

describe("the Gap Index card files", () => {
  const m = () => gapCardModel(e0, "2026-11-13");
  let first: Awaited<ReturnType<typeof renderGapCard>> = [];
  beforeAll(async () => {
    first = await renderGapCard(m());
  }, 60_000);

  it("are a 1600x900 and a 1080x1350 PNG, named for the edition, the window and the token", () => {
    expect(first.map((f) => [f.file, pngSize(f.png)])).toEqual([
      ["gap-index-0-2026-11-13-NVDAc-1600x900.png", { width: 1600, height: 900 }],
      ["gap-index-0-2026-11-13-NVDAc-1080x1350.png", { width: 1080, height: 1350 }],
    ]);
    expect(gapCardFileName(m(), "tall")).toBe("gap-index-0-2026-11-13-NVDAc-1080x1350.png");
  });

  it("render the same bytes every time", async () => {
    const again = await renderGapCard(m());
    for (const [i, f] of again.entries()) expect(f.png.equals(first[i]!.png), f.file).toBe(true);
    for (const layout of LAYOUTS) expect(await gapCardSvg(m(), layout)).toBe(await gapCardSvg(m(), layout));
  }, 60_000);
});

describe("on a shared card, orange means only a refusal", () => {
  it("draws the site's 'below the held feed' tone in ink, and 'above' in the accent", () => {
    expect(GAP_TONE.below).toBe("text-refuse");
    expect(GAP_CARD_TONE).toEqual({ above: PALETTE.accent, below: PALETTE.ink, at: PALETTE.ink });
  });

  it("has tokens below the held answer in edition 0 to test with", () => {
    expect(BELOW.length).toBeGreaterThan(0);
    expect(ABOVE.length).toBeGreaterThan(0);
  });

  it.each(BELOW)("%s %s, pool below the held answer: the chart's line, fill and dot are ink, and no orange is drawn", async (id, symbol) => {
    const m = gapCardModel(e0, id, symbol);
    expect(m.figure.kind === "gap" && m.figure.side).toBe("below");
    const chart = gapChartSvg(m, 900, 240);
    expect(chart).toContain(`stroke="${PALETTE.ink}"`);
    expect(chart).not.toContain(PALETTE.accent);
    for (const layout of LAYOUTS) {
      const svg = withImages(await gapCardSvg(m, layout, { embedFont: false })).toUpperCase();
      for (const c of ORANGES) expect(svg, `${layout} ${c}`).not.toContain(c.toUpperCase());
    }
  }, 60_000);

  it("draws a gap above the held answer in the accent", async () => {
    const [id, symbol] = ABOVE[0]!;
    const m = gapCardModel(e0, id, symbol);
    expect(gapChartSvg(m, 900, 240)).toContain(`stroke="${PALETTE.accent}"`);
    const boxes = await drawn(m, "wide");
    const value = find(boxes, m.figure.kind === "gap" ? m.figure.value : "");
    expect((value.props.style as { color?: string }).color).toBe(PALETTE.accent);
  }, 30_000);

  it.each(LAYOUTS)("draws no orange on any edition 0 card, whichever token (%s)", async (layout) => {
    for (const w of complete(e0)) {
      for (const row of rowsInTabOrder(w)) {
        const svg = withImages(await gapCardSvg(gapCardModel(e0, w.id, row.symbol), layout, { embedFont: false })).toUpperCase();
        for (const c of ORANGES) expect(svg, `${w.id} ${row.symbol} ${c}`).not.toContain(c.toUpperCase());
      }
    }
  }, 120_000);
});

describe("what a Gap Index card shows", () => {
  it.each(LAYOUTS)("edition 0, 13 Nov, NVDAc (%s): every part of the frame", async (layout) => {
    const m = gapCardModel(e0, "2026-11-13");
    const boxes = await drawn(m, layout);
    for (const text of [
      "maat",
      "Gap Index · edition 0 · window 2026-11-13",
      "blocks 57,066,122 → 58,245,121",
      "Fri 13 Nov 16:00 ET → Mon 16 Nov 09:30 ET",
      "The weekend · 65.50 h closed",
      "NVDAc",
      "LARGEST GAP",
      "+356 bps",
      "Without a feed update",
      "49.40 h",
      "Swaps meanwhile",
      "17,478",
      "Feed came back",
      "+254 bps",
      "Swaps in window",
      "25,549",
      "Edition 0 does not count the vault's Decisions.",
      "web/content/gap-index/edition-0.json · head block 61,273,559",
      GAP_FOOTER,
      SIGN_OFF,
    ]) {
      find(boxes, text);
    }
    if (m.figure.kind === "gap") {
      find(boxes, m.figure.sideText);
      find(boxes, m.figure.at);
      find(boxes, m.figure.prices);
    }
    for (const key of m.legend) find(boxes, key);
    for (const end of m.ends) find(boxes, end);
  }, 30_000);

  it.each(LAYOUTS)("edition 1's Thanksgiving window (%s): its closure note and its Decisions line", async (layout) => {
    const boxes = await drawn(gapCardModel(e1, "2026-11-25"), layout);
    find(boxes, "Thanksgiving, Thu 26 Nov · 41.50 h closed");
    find(boxes, "The vault recorded no Decision in this window.");
  }, 30_000);

  it.each(LAYOUTS)("edition 1's weekend window (%s): the Decisions sentence, then each Decision with its time and verdict", async (layout) => {
    const m = gapCardModel(ownerEdition1(2), "2026-11-27");
    const boxes = await drawn(m, layout);
    find(boxes, "Early close at 13:00 ET, then the weekend · 68.50 h closed");
    expect(find(boxes, m.decisions.sentence).text).toContain("2 from the owner by hand");
    expect(boxes.filter((b) => b.text === "Refused · Market closed (MARKET_CLOSED)")).toHaveLength(2);
    find(boxes, "Fri 27 Nov 13:01 ET");
    find(boxes, "Fri 27 Nov 13:03 ET");
    // Each row's sender chip on the wide card; the tall one leaves it out when every Decision has the sender the sentence names.
    expect(boxes.filter((b) => b.text === "owner, by hand")).toHaveLength(layout === "wide" ? 2 : 0);
  }, 30_000);

  it("edition 1's weekend window with mixed senders (tall): each row keeps its sender chip", async () => {
    const m = gapCardModel(e1, "2026-11-27");
    expect(new Set(m.decisions.rows.map((r) => r.sender)).size).toBeGreaterThan(1);
    const boxes = await drawn(m, "tall");
    const shown = boxes.filter((b) => b.text === "Refused · Market closed (MARKET_CLOSED)").length;
    expect(shown).toBeGreaterThan(0);
    const chips = boxes.filter((b) => m.decisions.rows.slice(0, shown).some((r) => r.sender === b.text));
    expect(chips.map((b) => b.text)).toEqual(m.decisions.rows.slice(0, shown).map((r) => r.sender));
  }, 30_000);

  it.each(LAYOUTS)("a token whose feed was not live (%s): says so, with its swap count, 0 included", async (layout) => {
    const m = gapCardModel(e0, "2026-11-06", "ANTc");
    const boxes = await drawn(m, layout);
    find(boxes, "feed not live in this window");
    find(boxes, "Swaps in window");
    find(boxes, "0");
    find(boxes, m.nothingToPlot);
  }, 30_000);

  it.each(LAYOUTS)("many Decisions (%s): the sentence with their count, then as many rows as fit, never past the footer", async (layout) => {
    const m = gapCardModel(ownerEdition1(40), "2026-11-27");
    const boxes = await drawn(m, layout);
    find(boxes, "The vault recorded 40 Decisions in this window: 40 from the owner by hand. It refused all 40 with MARKET_CLOSED. Each one is on the ledger.");
    const rows = boxes.filter((b) => b.text === "Refused · Market closed (MARKET_CLOSED)").length;
    expect(rows).toBeLessThan(40);
    expect(rows).toBeGreaterThan(0);
    // The first rows, in chain order: the times drawn under the sentence.
    const sentence = find(boxes, m.decisions.sentence);
    const times = boxes.filter((b) => b.top >= sentence.bottom && /^\w{3} \d+ Nov \d{2}:\d{2} ET$/.test(b.text));
    expect(times.map((b) => b.text)).toEqual(m.decisions.rows.slice(0, rows).map((r) => r.at));
  }, 60_000);
});

describe("a Gap Index card's layout", () => {
  const cases: [string, () => GapCardModel][] = [
    ...complete(e0).flatMap((w) => [
      [`edition 0 ${w.id}, the first tab`, () => gapCardModel(e0, w.id)] as [string, () => GapCardModel],
      [`edition 0 ${w.id} ANTc`, () => gapCardModel(e0, w.id, "ANTc")] as [string, () => GapCardModel],
    ]),
    [`edition 0 ${BELOW[0]![0]} ${BELOW[0]![1]}, below`, () => gapCardModel(e0, BELOW[0]![0], BELOW[0]![1])],
    ["edition 1 Thanksgiving", () => gapCardModel(e1, "2026-11-25")],
    ["edition 1 weekend, three Decisions", () => gapCardModel(e1, "2026-11-27")],
    ["edition 1 weekend, forty Decisions", () => gapCardModel(ownerEdition1(40), "2026-11-27")],
  ];

  it.each(LAYOUTS.flatMap((l) => cases.map(([name, m]) => [l, name, m] as const)))(
    "%s: %s keeps every text inside the margins, clear of every other text, the footer last",
    async (layout, _name, model) => {
      const { width, height } = CARD_LAYOUTS[layout];
      const boxes = await drawn(model(), layout);
      for (const b of boxes) expect([b.text, b.left >= 48, b.top >= 48, b.right <= width - 48, b.bottom <= height - 48]).toEqual([b.text, true, true, true, true]);
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          expect(overlap, `"${a.text}" overlaps "${b.text}"`).toBe(false);
        }
      }
      const closing = [model().source, GAP_FOOTER, SIGN_OFF];
      const top = Math.min(...closing.map((t) => find(boxes, t).top));
      const others = boxes.filter((b) => !closing.includes(b.text));
      expect(Math.max(...others.map((b) => b.bottom))).toBeLessThanOrEqual(top - 44);
    },
    60_000,
  );

  // The 1080x1350 card is the one a phone shows across its width: no text on it under 24 px; the wide card's under 18.
  it.each(LAYOUTS)("%s: no text is set below the layout's smallest size", async (layout) => {
    const smallest = { wide: 18, tall: 24 }[layout];
    for (const [, model] of cases) {
      const boxes = await drawn(model(), layout);
      expect(boxes.filter((b) => !(fontSize(b)! >= smallest)).map((b) => [b.text, fontSize(b)])).toEqual([]);
    }
  }, 120_000);
});
