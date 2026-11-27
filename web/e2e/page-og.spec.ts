import { expect, test } from "@playwright/test";
import { CARD_PAGES } from "../content/page-cards";

// The link previews of /now, /ledger, /gap-index and /proof, on the real build: each page's exported HTML names its own
// card, and the static host serves that card as a 1200x630 PNG. The HTML is read as a link preview's crawler reads it,
// without running the page, so no page reads Base here.

const pngSize = (b: Buffer) => ({ png: b.subarray(1, 4).toString("latin1"), width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
const meta = (html: string, attribute: "property" | "name", name: string) =>
  new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`).exec(html)?.[1];

test.describe("the pages' own link previews", () => {
  for (const page of CARD_PAGES) {
    test(`${page} names /og${page}.png, a 1200x630 PNG drawn at build time`, async ({ request }) => {
      const res = await request.get(page);
      expect(res.status()).toBe(200);
      const html = await res.text();
      const card = new RegExp(`/og${page}\\.png$`);
      expect(meta(html, "property", "og:image")).toMatch(card);
      expect(meta(html, "name", "twitter:image")).toMatch(card);
      expect(meta(html, "property", "og:image:width")).toBe("1200");
      expect(meta(html, "property", "og:image:height")).toBe("630");
      expect(meta(html, "property", "og:image")).not.toMatch(/opengraph-image\.png/);

      const image = await request.get(`/og${page}.png`);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
      expect(pngSize(await image.body())).toEqual({ png: "PNG", width: 1200, height: 630 });
    });
  }

  test("leaves the landing's image on the landing", async ({ request }) => {
    const html = await (await request.get("/")).text();
    expect(meta(html, "property", "og:image")).toMatch(/\/opengraph-image\.png/);
  });
});
