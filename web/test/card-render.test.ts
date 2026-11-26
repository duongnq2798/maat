// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SatoriNode } from "satori";
import { beforeAll, describe, expect, it } from "vitest";
import { CARD_LAYOUTS, balanceSvg, cardFileName, cardSvg, renderCard, TICK_COLOR, type CardLayout } from "@/brand/card";
import { PALETTE } from "@/brand/mark";
import { pngSize } from "@/brand/render";
import { BALANCE } from "@/components/instrument/Balance";
import { cardModel, type CardModel } from "@/lib/card/model";
import { parseCardFile } from "@/lib/card/read";
import { AGENT, cardCase, fixtureJson, OWNER, usdcTransfer } from "./helpers/card";
import { VECTORS } from "./helpers/maat-v1";

const WEB = process.cwd();
const LAYOUTS = Object.keys(CARD_LAYOUTS) as CardLayout[];
const one = () => cardModel(parseCardFile(fixtureJson("weighing-card-1.json")));
const two = () => cardModel(parseCardFile(fixtureJson("weighing-card-2.json")));

interface Box {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  props: Record<string, unknown>;
}

/** Every text satori drew on the card, with its box. */
async function drawn(model: CardModel, layout: CardLayout): Promise<Box[]> {
  const boxes: Box[] = [];
  await cardSvg(model, layout, (n: SatoriNode) => {
    if (n.textContent) boxes.push({ text: n.textContent, left: n.left, top: n.top, right: n.left + n.width, bottom: n.top + n.height, props: n.props });
  });
  return boxes;
}
const find = (boxes: readonly Box[], text: string) => {
  const b = boxes.find((x) => x.text === text);
  if (!b) throw new Error(`not drawn: "${text}"; drawn: ${boxes.map((x) => JSON.stringify(x.text)).join(", ")}`);
  return b;
};

// The longest strings a card can be asked to hold: a 600-character rationale with a disclosure and the closed note,
// three adopted briefs of 280 bytes with 200-character replies, the longest reason code and verdict, and a band.
const LONG_TEXT =
  "NVDAc sits 6.1 points under its 23.3% target and GOOGLc 2.4 over it, so the policy suggests a 12 USD buy of NVDAc to close half the gap without touching the 30% cash reserve. " +
  "The feed answered 41 seconds ago and the pool's 30-minute TWAP is 38 bps over Chainlink, inside the 100 bps limit. ".repeat(2) +
  "I expect the vault to refuse this because NYSE is closed for the weekend; I am proposing it so that the refusal is on the record.";
function worst(kind: "mainnet" | "fork" = "fork"): CardModel {
  const t = LONG_TEXT.slice(0, 556);
  const blob = `maat:v1:{"b":62500000,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x${"0".repeat(64)}","m":"claude-sonnet-5-5","q":[7,8,9],"r":"run-card-test","s":[],"t":${JSON.stringify(`${t} (market closed, weekend)`)}}`;
  const brief = "W".repeat(280);
  return cardModel(
    cardCase({
      kind,
      ordinal: kind === "mainnet" ? 1234 : null,
      from: AGENT,
      blob,
      reason: "MULTIPLIER_COOLDOWN",
      amount: 49_999_990_000n,
      briefs: [7, 8, 9].map((id) => ({ id, text: brief, from: AGENT, reply: "R".repeat(200) })),
    }),
  );
}
function longBill(): CardModel {
  const blob = `maat:v1:{"b":62500000,"c":"0123456789abcdef0123456789abcdef01234567","j":"0x${"0".repeat(64)}","k":"bill","r":"run-card-test","s":[],"t":"Compute bill: $1234.567891 of Claude API usage unpaid as of UTC day 20784"}`;
  return cardModel(cardCase({ kind: "simulated", from: AGENT, action: "PAY_EXPENSE", amount: 1_234_567_891n, blob, payee: AGENT, extraLogs: [usdcTransfer(AGENT, 1_234_567_891n)] }));
}
function plainAgent(): CardModel {
  return cardModel(cardCase({ from: AGENT, blob: VECTORS.V1.blob, reason: "MARKET_CLOSED", timestamp: Date.parse("2026-11-28T15:00:00Z") / 1000 }));
}

describe("the Balance on a card", () => {
  const css = readFileSync(join(WEB, "app/globals.css"), "utf8");

  it("tips at the site's tilt for a refusal and stays level otherwise", () => {
    expect(css).toMatch(/\.balance\[data-verdict="refused"\]\s*\{\s*--tilt:\s*-6deg;/);
    expect(BALANCE.refusedDeg).toBe(-6);
    expect(balanceSvg({ verdict: "refused", ticks: Array(9).fill("SKIP") })).toContain(`rotate(${BALANCE.refusedDeg} ${BALANCE.pivot.x} ${BALANCE.pivot.y})`);
    expect(balanceSvg({ verdict: "allowed", ticks: Array(9).fill("SKIP") })).not.toContain("rotate(");
  });

  it("moves the pans with the beam as app/globals.css does: 8 units times the tilt's sine and cosine", () => {
    expect(css).toContain('.balance-pan[data-pan="feather"] {\n    translate: calc(8px * (1 - cos(var(--tilt)))) calc(-8px * sin(var(--tilt)));');
    expect(css).toContain('.balance-pan[data-pan="order"] {\n    translate: calc(-8px * (1 - cos(var(--tilt)))) calc(8px * sin(var(--tilt)));');
    const rad = (BALANCE.refusedDeg * Math.PI) / 180;
    const fx = (8 * (1 - Math.cos(rad))).toFixed(4);
    const fy = (-8 * Math.sin(rad)).toFixed(4);
    const svg = balanceSvg({ verdict: "refused", ticks: Array(9).fill("SKIP") });
    expect(svg).toContain(`translate(${Number(fx)} ${Number(fy)})`);
    expect(svg).toContain(`translate(${-Number(fx)} ${-Number(fy)})`);
  });

  it("colours its ticks with the site's tick tokens", () => {
    const token = (name: string) => new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)?.[1]?.toUpperCase();
    expect(TICK_COLOR).toEqual({ PASS: token("lamp-pass"), FAIL: token("lamp-refuse"), SKIP: token("tick") });
    const svg = balanceSvg(one().balance);
    const count = (c: string) => svg.split(`stroke="${c}"`).length - 1;
    expect([count(TICK_COLOR.PASS), count(TICK_COLOR.FAIL), count(TICK_COLOR.SKIP)]).toEqual([3, 1, 5]);
  });
});

describe("the card files", () => {
  let first: Awaited<ReturnType<typeof renderCard>> = [];
  beforeAll(async () => {
    first = await renderCard(one());
  }, 60_000);

  it("are a 1600x900 and a 1080x1350 PNG, named for the Decision", () => {
    expect(first.map((f) => [f.file, pngSize(f.png)])).toEqual([
      ["weighing-1-dfdb6739-1600x900.png", { width: 1600, height: 900 }],
      ["weighing-1-dfdb6739-1080x1350.png", { width: 1080, height: 1350 }],
    ]);
    expect(cardFileName(one(), "wide")).toBe("weighing-1-dfdb6739-1600x900.png");
  });

  it("render the same bytes every time", async () => {
    const again = await renderCard(one());
    for (const [i, f] of again.entries()) expect(f.png.equals(first[i]!.png), f.file).toBe(true);
  }, 60_000);

  // The committed card is the SVG satori draws: resvg's PNG bytes can differ by a pixel between operating systems.
  // After a deliberate change to the card, rewrite both files with: npx vitest run test/card-render.test.ts -u
  it.each(LAYOUTS)("re-draw the committed fixture card (%s) byte for byte", async (layout) => {
    const { width, height } = CARD_LAYOUTS[layout];
    await expect(await cardSvg(one(), layout)).toMatchFileSnapshot(`fixtures/weighing-card-1-${width}x${height}.svg`);
  }, 30_000);
});

describe("what a card shows", () => {
  it.each(LAYOUTS)("Weighing № 1 (%s): every part of the frame", async (layout) => {
    const boxes = await drawn(one(), layout);
    for (const text of [
      "maat",
      "Tue 24 Nov · NYSE open 09:30-16:00 ET",
      "09:28 ET · before the 09:30 open",
      "Weighing № 1",
      "MARKET_CLOSED",
      "Refused · Market closed (MARKET_CLOSED)",
      "BUY · NVDAc · $5.00",
      "owner, by hand",
      "no rationale in this tx",
      "rationaleHash 0x0baa4c52…57f6",
      "block 61,700,601 · tx 0xdfdb6739…6c3b",
      "Own treasury only. Not offered to US persons.",
      "Every trade is weighed.",
    ]) {
      find(boxes, text);
    }
    expect(boxes.some((b) => b.text.includes("hash verified"))).toBe(false);
  }, 30_000);

  it.each(LAYOUTS)("an agent's verified rationale (%s), quoted with its model", async (layout) => {
    const boxes = await drawn(plainAgent(), layout);
    find(boxes, "hash verified");
    find(boxes, "Maat's agent · claude-sonnet-5-5");
    find(boxes, "“Fixture rationale: NVDAc is under its target weight and the feed is fresh, so buy 5 USD.”");
    find(boxes, "agent");
  }, 30_000);

  it.each(LAYOUTS)("a bill (%s) on a neutral plate, never as a trade", async (layout) => {
    const m = cardModel(cardCase({ action: "PAY_EXPENSE", amount: 1_000_000n, payee: OWNER, extraLogs: [usdcTransfer(OWNER, 1_000_000n)] }));
    const boxes = await drawn(m, layout);
    const headline = find(boxes, "Expense paid");
    find(boxes, "Expense paid · $1.00 · to the owner's allowlisted address");
    const style = headline.props.style as { color?: string };
    expect(style.color).toBe(PALETTE.ink);
    expect(boxes.some((b) => /^(BUY|SELL) /.test(b.text))).toBe(false);
  }, 30_000);

  it.each(LAYOUTS)("a brief-driven Decision (%s) with its brief id, and no brief text it has not read", async (layout) => {
    const boxes = await drawn(cardModel(cardCase({ from: AGENT, blob: VECTORS.V5.blob })), layout);
    find(boxes, "Brief #7");
    find(boxes, "brief text not available");
    find(boxes, "Reply: reply not available");
    find(boxes, "brief-driven");
  }, 30_000);

  it.each(LAYOUTS.flatMap((l) => (["fork", "simulated", "preview"] as const).map((k) => [l, k] as const)))(
    "a %s card of a %s read prints its band on the image",
    async (layout, kind) => {
      const boxes = await drawn(cardModel(cardCase({ kind })), layout);
      find(boxes, { fork: "FORK REPLAY", simulated: "SIMULATED", preview: "PREVIEW, NOT A DECISION" }[kind]);
      find(boxes, "Weighing · not numbered");
    },
    30_000,
  );

  it.each(LAYOUTS)("a mainnet card (%s) has no band", async (layout) => {
    const boxes = await drawn(two(), layout);
    expect(boxes.some((b) => ["FORK REPLAY", "SIMULATED", "PREVIEW, NOT A DECISION"].includes(b.text))).toBe(false);
    find(boxes, "Allowed");
    find(boxes, "Allowed · All checks passed (OK)");
  }, 30_000);
});

describe("a card's layout", () => {
  const cases: [string, () => CardModel][] = [
    ["Weighing № 1", one],
    ["Weighing № 2", two],
    ["an agent's rationale", plainAgent],
    ["the longest brief-driven refusal", () => worst()],
    ["the longest numbered refusal", () => worst("mainnet")],
    ["a long bill", longBill],
  ];

  it.each(LAYOUTS.flatMap((l) => cases.map(([name, m]) => [l, name, m] as const)))(
    "%s: %s keeps every text inside the margins, clear of every other text",
    async (layout, _name, model) => {
      const { width, height } = CARD_LAYOUTS[layout];
      const boxes = await drawn(model(), layout);
      // The band runs edge to edge; everything else keeps 48 px from each edge.
      for (const b of boxes) {
        const edge = b.text === model().band ? 0 : 48;
        expect([b.text, b.left >= edge, b.top >= edge, b.right <= width - edge, b.bottom <= height - edge]).toEqual([b.text, true, true, true, true]);
      }
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          expect(overlap, `"${a.text}" overlaps "${b.text}"`).toBe(false);
        }
      }
      // The footer and the sign-off close the card, below everything else.
      const footerTop = Math.min(find(boxes, "Own treasury only. Not offered to US persons.").top, find(boxes, "Every trade is weighed.").top);
      const others = boxes.filter((b) => !["Own treasury only. Not offered to US persons.", "Every trade is weighed."].includes(b.text) && !b.text.startsWith("block "));
      expect(Math.max(...others.map((b) => b.bottom))).toBeLessThanOrEqual(footerTop);
    },
    60_000,
  );

  it.each(LAYOUTS)("%s: the agent's disclosure survives the excerpt of the longest rationale", async (layout) => {
    const boxes = await drawn(worst(), layout);
    const quote = boxes.find((b) => b.text.startsWith("“"));
    expect(quote?.text).toContain("I expect the vault to refuse this because NYSE is closed for the weekend; I am proposing it so that the refusal is on the record.");
    expect(quote?.text.endsWith(" (market closed, weekend)”")).toBe(true);
  }, 30_000);
});
