// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { closedWindows } from "@/lib/gap/windows";

const utc = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h, m) / 1000;

describe("closedWindows", () => {
  it("finds the three November weekends", () => {
    const w = closedWindows("2026-11-06", "2026-11-22");
    expect(w.map((x) => x.id)).toEqual(["2026-11-06", "2026-11-13", "2026-11-20"]);
    expect(w[0]).toEqual({
      id: "2026-11-06",
      closeTs: utc(6, 21),
      openTs: utc(9, 14, 30),
      closeLabel: "Fri 6 Nov 16:00 ET",
      openLabel: "Mon 9 Nov 09:30 ET",
    });
    expect(w[1]!.closeTs).toBe(utc(13, 21));
    expect(w[1]!.openTs).toBe(utc(16, 14, 30));
    expect(w[2]!.closeTs).toBe(utc(20, 21));
    expect(w[2]!.openTs).toBe(utc(23, 14, 30));
  });

  it("handles Thanksgiving and the early close", () => {
    const w = closedWindows("2026-11-23", "2026-11-29");
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({
      id: "2026-11-25",
      closeTs: utc(25, 21),
      openTs: utc(27, 14, 30),
      closeLabel: "Wed 25 Nov 16:00 ET",
      openLabel: "Fri 27 Nov 09:30 ET",
    });
    expect(w[1]).toMatchObject({ id: "2026-11-27", closeTs: utc(27, 18), openTs: utc(30, 14, 30), closeLabel: "Fri 27 Nov 13:00 ET" });
  });

  it("returns nothing for midweek or non-session closes", () => {
    expect(closedWindows("2026-11-09", "2026-11-12")).toEqual([]);
    expect(closedWindows("2026-11-07", "2026-11-08")).toEqual([]);
  });

  it("throws on a bad range", () => {
    expect(() => closedWindows("2026-11-10", "2026-11-09")).toThrow();
    expect(() => closedWindows("nope", "2026-11-09")).toThrow();
    expect(() => closedWindows("2026-11-09", "2026-13-40")).toThrow();
  });

  it("handles a single-day range", () => {
    expect(closedWindows("2026-11-13", "2026-11-13").map((x) => x.id)).toEqual(["2026-11-13"]);
  });
});

describe("EDITIONS", () => {
  it("pins editions 0 and 1", () => {
    expect(EDITIONS[0]).toMatchObject({ edition: 0, from: "2026-11-06", to: "2026-11-22" });
    expect(EDITIONS[1]).toMatchObject({ edition: 1, from: "2026-11-23", to: "2026-11-29" });
    expect(editionWindows(EDITIONS[0]!)).toHaveLength(3);
    expect(editionWindows(EDITIONS[1]!)).toHaveLength(2);
  });
});
