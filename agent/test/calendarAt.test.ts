import { describe, expect, it } from "vitest";
import { readCalendarAt } from "../src/chain/state.js";
import { CALENDAR, CALENDAR_MATH, FakeChain, withCalendar } from "./fakes/fakeChain.js";

const s = (iso: string) => BigInt(Date.parse(iso) / 1000);
const etDayOf = (iso: string) => BigInt(CALENDAR_MATH.localTime(Number(s(iso)))[0]);

describe("readCalendarAt", () => {
  it("reads the calendar's verdict and NYSE date for any instant, not just the block's", async () => {
    const f = withCalendar(new FakeChain());
    expect(await readCalendarAt(f.client(), CALENDAR, 0, s("2026-11-27T17:58:00Z"), 100n)).toEqual({
      open: true,
      day: { etDay: etDayOf("2026-11-27T17:58:00Z"), weekday: 5, minuteOfDay: 12 * 60 + 58, holiday: false, earlyCloseMin: 780 },
    });
    expect(await readCalendarAt(f.client(), CALENDAR, 0, s("2026-11-27T18:01:00Z"), 100n)).toMatchObject({ open: false, day: { minuteOfDay: 13 * 60 + 1 } });
    expect(await readCalendarAt(f.client(), CALENDAR, 0, s("2026-11-26T14:31:00Z"), 100n)).toMatchObject({
      open: false,
      day: { weekday: 4, minuteOfDay: 9 * 60 + 31, holiday: true, earlyCloseMin: 0 },
    });
  });

  it("asks isOpen under the given session mode, at the instant", async () => {
    const f = withCalendar(new FakeChain());
    const at = s("2026-11-27T22:00:00Z");
    expect((await readCalendarAt(f.client(), CALENDAR, 1, at, 100n))?.open).toBe(true);
    expect((await readCalendarAt(f.client(), CALENDAR, 0, at, 100n))?.open).toBe(false);
    expect(f.calls.filter((c) => c.functionName === "isOpen").map((c) => c.args)).toEqual([
      [at, 1],
      [at, 0],
    ]);
  });

  it("is null when a calendar view fails or the multicall throws", async () => {
    const f = withCalendar(new FakeChain()).fail(CALENDAR, "earlyCloseMin");
    expect(await readCalendarAt(f.client(), CALENDAR, 0, s("2026-11-27T17:58:00Z"), 100n)).toBeNull();
    const g = withCalendar(new FakeChain()).fail(CALENDAR, "isOpen");
    expect(await readCalendarAt(g.client(), CALENDAR, 0, s("2026-11-27T17:58:00Z"), 100n)).toBeNull();
    const broken = { ...g.client(), multicall: async () => Promise.reject(new Error("rpc down")) };
    expect(await readCalendarAt(broken, CALENDAR, 0, s("2026-11-27T17:58:00Z"), 100n)).toBeNull();
  });
});
