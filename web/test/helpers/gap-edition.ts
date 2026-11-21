import { describe, expect, it } from "vitest";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { EditionFileSchema, type EditionFile } from "@/lib/gap/schema";

type Win = EditionFile["windows"][number];
type Complete = Extract<Win, { status: "complete" }>;

/** Blocks Base makes in a day at 5 a second: the block shift of a week is 7 of these. */
const BLOCKS_PER_DAY = 5 * 86_400;

/**
 * What a data-only rerun after a pending window ends changes: a copy of `real` in which every pending window is complete.
 * Each is built from the latest complete window before it, shifted by the difference of their closes and by that many
 * days of blocks, so its figures are as consistent as the committed ones. `head` moves to an hour after the last open.
 */
export function withPendingWindowsMeasured(real: EditionFile): EditionFile {
  if (real.windows.every((w) => w.status === "complete")) return real;
  const out: Win[] = [];
  for (const w of real.windows) {
    if (w.status === "complete") {
      out.push(w);
      continue;
    }
    const template = [...out].reverse().find((x): x is Complete => x.status === "complete");
    if (!template) throw new Error(`no complete window before ${w.id} to shift`);
    expect(w.openTs - w.closeTs, "the shifted window must last as long as its template").toBe(template.openTs - template.closeTs);
    const dTs = w.closeTs - template.closeTs;
    const dBlocks = Math.round(dTs / 86_400) * BLOCKS_PER_DAY;
    const update = <U extends { block: number; ts: number }>(u: U): U => ({ ...u, block: u.block + dBlocks, ts: u.ts + dTs });
    const point = <T,>([ts, p]: [number, T]): [number, T] => [ts + dTs, p];
    out.push({
      status: "complete",
      id: w.id,
      closeTs: w.closeTs,
      openTs: w.openTs,
      closeLabel: w.closeLabel,
      openLabel: w.openLabel,
      blocks: { from: template.blocks.from + dBlocks, to: template.blocks.to + dBlocks },
      tokens: template.tokens.map((t) => ({
        ...t,
        freeze: t.freeze && {
          ...t.freeze,
          from: update(t.freeze.from),
          to: update(t.freeze.to),
          swapsRead: { from: t.freeze.swapsRead.from + dBlocks, to: t.freeze.swapsRead.to + dBlocks },
        },
        largestGap: t.largestGap && { ...t.largestGap, block: t.largestGap.block + dBlocks, ts: t.largestGap.ts + dTs },
        series: { pool: t.series.pool.map(point), feed: t.series.feed.map(point) },
      })),
    });
  }
  const last = real.windows.at(-1)!;
  return EditionFileSchema.parse({ ...real, head: { block: real.head.block + 14 * BLOCKS_PER_DAY, ts: last.openTs + 3600 }, windows: out });
}

/** The checks every edition file must pass, named after the file. */
export function editionFileChecks(name: string, json: unknown): void {
  describe(name, () => {
    const parsed = EditionFileSchema.safeParse(json);
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
