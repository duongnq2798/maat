// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nextOpen, regularSession } from "@/content/calendar";

/** Seconds since the epoch of a UTC wall-clock time. */
const utc = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
const iso = (ts: number) => new Date(ts * 1000).toISOString();

describe("nextOpen (content/calendar.ts)", () => {
  const cases: [name: string, at: number, next: number][] = [
    ["Saturday 21 Nov to Monday 23 Nov 09:30 EST", utc(2026, 11, 21, 15, 0), utc(2026, 11, 23, 14, 30)],
    ["the Wednesday 16:00 close skips Thanksgiving to Friday 27 Nov", utc(2026, 11, 25, 21, 0), utc(2026, 11, 27, 14, 30)],
    ["Thanksgiving, Thursday 26 Nov, to Friday 27 Nov", utc(2026, 11, 26, 15, 0), utc(2026, 11, 27, 14, 30)],
    ["the 13:00 ET early close of Friday 27 Nov to Monday 30 Nov", utc(2026, 11, 27, 18, 0), utc(2026, 11, 30, 14, 30)],
    ["the last open minute of Friday 27 Nov to Monday 30 Nov", utc(2026, 11, 27, 17, 59), utc(2026, 11, 30, 14, 30)],
    ["before the open of Friday 27 Nov to that same open", utc(2026, 11, 27, 13, 0), utc(2026, 11, 27, 14, 30)],
    ["one second before an open to that open", utc(2026, 11, 23, 14, 29, 59), utc(2026, 11, 23, 14, 30)],
    ["the open instant itself to the next day's open", utc(2026, 11, 23, 14, 30), utc(2026, 11, 24, 14, 30)],
    ["the 13:00 close of Christmas Eve over Christmas to Monday 28 Dec", utc(2026, 12, 24, 18, 0), utc(2026, 12, 28, 14, 30)],
    ["Friday 12 Mar 2027 over the DST start to Monday 15 Mar 09:30 EDT", utc(2027, 3, 12, 21, 0), utc(2027, 3, 15, 13, 30)],
    ["Friday 30 Oct 2026 over the DST end to Monday 2 Nov 09:30 EST", utc(2026, 10, 30, 20, 0), utc(2026, 11, 2, 14, 30)],
  ];

  it.each(cases)("%s", (_name, at, next) => {
    expect(iso(nextOpen(at))).toBe(iso(next));
  });

  it("is always a later instant where the market has just opened, with no open in between", () => {
    const from = utc(2026, 11, 20, 0, 0);
    const to = utc(2027, 1, 8, 0, 0);
    const step = 11 * 3600 + 7 * 60 + 13; // 11 h 7 min 13 s, so the samples fall on every hour of the week
    const opensAt = (minute: number) => regularSession(minute).open && !regularSession(minute - 60).open;
    let checked = 0;
    for (let ts = from; ts < to; ts += step) {
      const next = nextOpen(ts);
      expect(next, iso(ts)).toBeGreaterThan(ts);
      expect(next % 60, iso(ts)).toBe(0);
      expect(opensAt(next), iso(ts)).toBe(true);
      for (let minute = Math.ceil((ts + 1) / 60) * 60; minute < next; minute += 60) {
        if (opensAt(minute)) throw new Error(`${iso(ts)}: an open at ${iso(minute)} comes before ${iso(next)}`);
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("refuses a timestamp that is not finite", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => nextOpen(bad), String(bad)).toThrow(/finite timestamp/);
    }
  });
});
