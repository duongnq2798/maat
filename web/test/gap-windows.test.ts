// @vitest-environment node
import { describe, expect, it } from "vitest";
import { EDITIONS, editionWindows } from "@/content/gap-index/editions";
import { calendarChecks, closedWindows } from "@/lib/gap/windows";

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

describe("windows that do not start on a Friday", () => {
  it("starts a window at the Wednesday close before Thanksgiving and ends it at Friday's open", () => {
    const [w] = closedWindows("2026-11-25", "2026-11-25");
    expect(w).toEqual({
      id: "2026-11-25",
      closeTs: utc(25, 21),
      openTs: utc(27, 14, 30),
      closeLabel: "Wed 25 Nov 16:00 ET",
      openLabel: "Fri 27 Nov 09:30 ET",
    });
    expect(calendarChecks(w!)).toEqual([
      { ts: utc(25, 21) - 1, open: true },
      { ts: utc(25, 21), open: false },
      { ts: utc(26, 14, 30), open: false }, // Thanksgiving at 09:30 ET
      { ts: utc(27, 14, 30) - 1, open: false },
      { ts: utc(27, 14, 30), open: true },
    ]);
  });

  it("starts the window after Friday's 13:00 ET early close, and asks the calendar at the early close", () => {
    const [w] = closedWindows("2026-11-27", "2026-11-27");
    expect(w).toEqual({
      id: "2026-11-27",
      closeTs: utc(27, 18),
      openTs: utc(30, 14, 30),
      closeLabel: "Fri 27 Nov 13:00 ET",
      openLabel: "Mon 30 Nov 09:30 ET",
    });
    expect((w!.openTs - w!.closeTs) / 3600).toBe(68.5);
    expect(calendarChecks(w!)).toEqual([
      { ts: utc(27, 18) - 1, open: true },
      { ts: utc(27, 18), open: false },
      { ts: utc(28, 14, 30), open: false },
      { ts: utc(29, 14, 30), open: false },
      { ts: utc(30, 14, 30) - 1, open: false },
      { ts: utc(30, 14, 30), open: true },
    ]);
  });

  it("runs a window across a month end and a year end, from Thursday 31 December to Monday 4 January", () => {
    const [w] = closedWindows("2026-12-31", "2026-12-31");
    const at = (y: number, m: number, d: number, h: number, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;
    expect(w).toEqual({
      id: "2026-12-31",
      closeTs: at(2026, 12, 31, 21),
      openTs: at(2027, 1, 4, 14, 30),
      closeLabel: "Thu 31 Dec 16:00 ET",
      openLabel: "Mon 4 Jan 09:30 ET",
    });
    expect(calendarChecks(w!).map((c) => c.ts)).toEqual([
      at(2026, 12, 31, 21) - 1,
      at(2026, 12, 31, 21),
      at(2027, 1, 1, 14, 30),
      at(2027, 1, 2, 14, 30),
      at(2027, 1, 3, 14, 30),
      at(2027, 1, 4, 14, 30) - 1,
      at(2027, 1, 4, 14, 30),
    ]);
  });

  it("asks the calendar at a plain weekend's edges and its two days, as edition 0's windows have them", () => {
    const w = closedWindows("2026-11-13", "2026-11-13")[0]!;
    expect(calendarChecks(w).map((c) => [c.ts, c.open])).toEqual([
      [utc(13, 21) - 1, true],
      [utc(13, 21), false],
      [utc(14, 14, 30), false],
      [utc(15, 14, 30), false],
      [utc(16, 14, 30) - 1, false],
      [utc(16, 14, 30), true],
    ]);
  });
});

describe("EDITIONS", () => {
  it("pins editions 0 and 1", () => {
    expect(EDITIONS[0]).toMatchObject({ edition: 0, from: "2026-11-06", to: "2026-11-22" });
    expect(EDITIONS[1]).toMatchObject({ edition: 1, from: "2026-11-23", to: "2026-11-29" });
    expect(editionWindows(EDITIONS[0]!)).toHaveLength(3);
    expect(editionWindows(EDITIONS[1]!)).toHaveLength(2);
  });

  it("lists edition 1's windows in UTC, the Thanksgiving window and the weekend after the early close, and counts its Decisions", () => {
    const e1 = EDITIONS[1]!;
    expect(e1.windows).toEqual([
      { id: "2026-11-25", close: "2026-11-25T21:00:00Z", open: "2026-11-27T14:30:00Z" },
      { id: "2026-11-27", close: "2026-11-27T18:00:00Z", open: "2026-11-30T14:30:00Z" },
    ]);
    expect(e1.decisions).toBe(true);
    expect(editionWindows(e1).map((w) => [w.id, w.closeTs, w.openTs])).toEqual([
      ["2026-11-25", utc(25, 21), utc(27, 14, 30)],
      ["2026-11-27", utc(27, 18), utc(30, 14, 30)],
    ]);
    // Edition 0 lists none and counts none, so its file is written as before.
    expect(EDITIONS[0]!.windows).toBeUndefined();
    expect(EDITIONS[0]!.decisions).toBeUndefined();
  });

  it("refuses an edition whose listed windows are not the calendar's", () => {
    const e1 = EDITIONS[1]!;
    const shifted = { ...e1, windows: [{ ...e1.windows![0]!, open: "2026-11-27T13:30:00Z" }, e1.windows![1]!] };
    expect(() => editionWindows(shifted)).toThrow(/edition 1: its listed windows .* are not the calendar's/);
    expect(() => editionWindows({ ...e1, windows: e1.windows!.slice(0, 1) })).toThrow(/are not the calendar's/);
  });
});
