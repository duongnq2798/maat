// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { EditionFileSchema, type EditionFile } from "@/lib/gap/schema";

const DIR = fileURLToPath(new URL("../content/gap-index/", import.meta.url));
const listing = readdirSync(DIR);
const files = listing.filter((f) => /^edition-\d+\.json$/.test(f)).sort();

describe("committed gap-index editions", () => {
  it("looked in the content folder", () => {
    expect(listing).toContain("editions.ts");
    for (const f of files) expect(EDITIONS.some((e) => `edition-${e.edition}.json` === f)).toBe(true);
  });

  for (const name of files) {
    describe(name, () => {
      const parsed = EditionFileSchema.safeParse(JSON.parse(readFileSync(`${DIR}${name}`, "utf8")));
      it("parses with the schema", () => {
        expect(parsed.error?.issues ?? []).toEqual([]);
      });
      if (!parsed.success) return;
      const file: EditionFile = parsed.data;

      it("holds the windows of its edition", () => {
        const def = EDITIONS.find((e) => e.edition === file.edition)!;
        expect(name).toBe(`edition-${file.edition}.json`);
        expect([file.title, file.from, file.to]).toEqual([def.title, def.from, def.to]);
        expect(file.windows.map(({ id, closeTs, openTs, closeLabel, openLabel }) => ({ id, closeTs, openTs, closeLabel, openLabel }))).toEqual(editionWindows(def));
        for (const w of file.windows) expect(w.status === "pending").toBe(w.openTs > file.head.ts);
      });

      for (const w of file.windows) {
        if (w.status !== "complete") continue;
        for (const t of w.tokens) {
          it(`${w.id} ${t.symbol} is consistent`, () => {
            if (!t.feedLive) expect(t.freeze).toBeNull();
            for (const [ts] of [...t.series.pool, ...t.series.feed]) {
              expect(ts).toBeGreaterThanOrEqual(w.closeTs);
              expect(ts).toBeLessThan(w.openTs);
            }
            if (t.freeze) {
              if (t.freeze.from.block >= w.blocks.from && t.freeze.to.block <= w.blocks.to) {
                expect(t.freeze.swapsWhileFrozen).toBeLessThanOrEqual(t.swapsInWindow);
              }
              expect(t.freeze.swapsRead.from).toBeLessThanOrEqual(Math.min(w.blocks.from, t.freeze.from.block));
              expect(t.freeze.swapsRead.to).toBeGreaterThanOrEqual(Math.max(w.blocks.to, t.freeze.to.block));
            }
            if (t.largestGap) {
              expect(t.freeze).not.toBeNull();
              expect(t.largestGap.block).toBeGreaterThanOrEqual(t.freeze!.from.block);
              expect(t.largestGap.block).toBeLessThanOrEqual(t.freeze!.to.block);
              expect(t.largestGap.held).toBe(t.freeze!.from.answer);
            }
          });
        }
      }
    });
  }
});
