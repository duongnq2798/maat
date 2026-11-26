// @vitest-environment node
import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { closedLine, nowMark, openLine, placeTicks, weekAt } from "@/lib/live/week";

// The week grid of /now (culture plan Move 8a), drawn from content/calendar.ts. Every clock below is a fixed timestamp:
// the functions read no clock of their own.

/** Seconds since the epoch of a UTC wall-clock time. */
const utc = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) / 1000;

// Thanksgiving week, EST (UTC-5): Mon 23 Nov to Sun 29 Nov 2026.
const THANKSGIVING = utc(2026, 11, 26, 15, 0); // Thu 26 Nov 10:00 ET
const EARLY_CLOSE = utc(2026, 11, 27, 18, 0); // Fri 27 Nov 13:00 ET, the minute the early close shuts the session
const LAST_EARLY_MINUTE = utc(2026, 11, 27, 17, 59); // Fri 27 Nov 12:59 ET, still open
const SATURDAY = utc(2026, 11, 28, 15, 0); // Sat 28 Nov 10:00 ET
const MONDAY_NIGHT = utc(2026, 11, 24, 3, 0); // Mon 23 Nov 22:00 ET
const WEDNESDAY_CLOSE = utc(2026, 11, 25, 21, 0); // Wed 25 Nov 16:00 ET, the eve of Thanksgiving
const MONDAY_MORNING = utc(2026, 11, 30, 13, 0); // Mon 30 Nov 08:00 ET, before the open
const MONDAY_SESSION = utc(2026, 11, 30, 16, 0); // Mon 30 Nov 11:00 ET, in session

const OPEN = FACTS.nyseSessionMin.value.open; // 570, 09:30
const CLOSE = FACTS.nyseSessionMin.value.close; // 960, 16:00
const EARLY = FACTS.calendar.value.earlyCloses.find((e) => e.date === "2026-11-27")!.closeMin; // 780, 13:00

const full = [
  { kind: "overnight", fromMin: 0, toMin: OPEN },
  { kind: "open", fromMin: OPEN, toMin: CLOSE },
  { kind: "overnight", fromMin: CLOSE, toMin: 1440 },
];

describe("weekAt: the NYSE week around a clock, Monday to Sunday in New York time", () => {
  it("lays Thanksgiving week out from the calendar: three full sessions, the holiday, the early close and the weekend", () => {
    const week = weekAt(SATURDAY);
    expect(week.days.map((d) => d.label)).toEqual(["Mon 23 Nov", "Tue 24 Nov", "Wed 25 Nov", "Thu 26 Nov", "Fri 27 Nov", "Sat 28 Nov", "Sun 29 Nov"]);
    expect(week.days.map((d) => d.iso)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(week.days.map((d) => d.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(week.startTs).toBe(utc(2026, 11, 23, 5, 0)); // Mon 23 Nov 00:00 EST
    expect(week.endTs).toBe(utc(2026, 11, 30, 5, 0)); // Mon 30 Nov 00:00 EST

    const [mon, tue, wed, thu, fri, sat, sun] = week.days;
    for (const d of [mon, tue, wed]) {
      expect(d!.spans).toEqual(full);
      expect(d!.session).toEqual({ openMin: OPEN, closeMin: CLOSE });
      expect(d!.holiday).toBeNull();
      expect(d!.detail).toBe("Open 09:30–16:00 ET");
    }
    expect(thu!.spans).toEqual([{ kind: "holiday", fromMin: 0, toMin: 1440 }]);
    expect(thu!.session).toBeNull();
    expect(thu!.holiday).toBe("Thanksgiving");
    expect(thu!.detail).toBe("Closed: Thanksgiving");

    expect(EARLY).toBe(780);
    expect(fri!.spans).toEqual([
      { kind: "overnight", fromMin: 0, toMin: OPEN },
      { kind: "open", fromMin: OPEN, toMin: EARLY },
      { kind: "early-close", fromMin: EARLY, toMin: CLOSE },
      { kind: "overnight", fromMin: CLOSE, toMin: 1440 },
    ]);
    expect(fri!.session).toEqual({ openMin: OPEN, closeMin: EARLY });
    expect(fri!.detail).toBe("Open 09:30–13:00 ET, early close");

    for (const d of [sat, sun]) {
      expect(d!.spans).toEqual([{ kind: "weekend", fromMin: 0, toMin: 1440 }]);
      expect(d!.session).toBeNull();
      expect(d!.detail).toBe("Closed: weekend");
    }
  });

  it("gives every day spans that tile 00:00 to 24:00 with no gap and no overlap", () => {
    for (const ts of [THANKSGIVING, SATURDAY, MONDAY_SESSION, utc(2026, 12, 24, 15, 0), utc(2027, 3, 14, 12, 0)]) {
      for (const d of weekAt(ts).days) {
        expect(d.spans[0]!.fromMin, d.iso).toBe(0);
        expect(d.spans.at(-1)!.toMin, d.iso).toBe(1440);
        d.spans.forEach((s, i) => {
          expect(s.toMin, d.iso).toBeGreaterThan(s.fromMin);
          if (i > 0) expect(s.fromMin, d.iso).toBe(d.spans[i - 1]!.toMin);
        });
      }
    }
  });

  it("puts every clock of the same week, from Monday 00:00 to Sunday 23:59 ET, on the same Monday", () => {
    const monday = weekAt(SATURDAY).monday;
    for (const ts of [utc(2026, 11, 23, 5, 0), THANKSGIVING, EARLY_CLOSE, SATURDAY, utc(2026, 11, 30, 4, 59, 59)]) {
      expect(weekAt(ts).monday, new Date(ts * 1000).toISOString()).toBe(monday);
    }
    expect(weekAt(utc(2026, 11, 30, 5, 0)).monday).toBe(monday + 7);
    expect(weekAt(utc(2026, 11, 23, 4, 59, 59)).monday).toBe(monday - 7);
  });

  it("draws a plain week after Thanksgiving: five full sessions and the weekend", () => {
    const week = weekAt(MONDAY_SESSION);
    expect(week.days[0]!.label).toBe("Mon 30 Nov");
    expect(week.days[6]!.label).toBe("Sun 6 Dec");
    expect(week.days.slice(0, 5).map((d) => d.spans)).toEqual(Array(5).fill(full));
    expect(week.days.slice(5).map((d) => d.spans[0]!.kind)).toEqual(["weekend", "weekend"]);
  });

  it("starts and ends a week that crosses the end of US daylight time at each Monday's own midnight", () => {
    // DST ends Sun 1 Nov 2026 at 06:00 UTC: Mon 26 Oct is EDT (UTC-4), Mon 2 Nov is EST (UTC-5).
    const week = weekAt(utc(2026, 11, 1, 12, 0));
    expect(week.days[0]!.label).toBe("Mon 26 Oct");
    expect(week.startTs).toBe(utc(2026, 10, 26, 4, 0));
    expect(week.endTs).toBe(utc(2026, 11, 2, 5, 0));
  });
});

describe("nowMark: where the now line sits", () => {
  it("is on Saturday's row at 10:00 ET, and on Thanksgiving's row at 10:00 ET", () => {
    expect(nowMark(weekAt(SATURDAY), SATURDAY)).toEqual({ index: 5, minute: 600, label: "10:00 ET" });
    expect(nowMark(weekAt(THANKSGIVING), THANKSGIVING)).toEqual({ index: 3, minute: 600, label: "10:00 ET" });
  });

  it("counts the seconds into the minute, so the line moves smoothly, and labels the whole minute", () => {
    expect(nowMark(weekAt(SATURDAY), SATURDAY + 30)).toEqual({ index: 5, minute: 600.5, label: "10:00 ET" });
  });

  it("is null for a clock outside the week drawn", () => {
    expect(nowMark(weekAt(SATURDAY), MONDAY_SESSION)).toBeNull();
  });
});

describe("placeTicks: the vault's Decisions on the week", () => {
  // The two mainnet Decisions recorded in this build: Tue 24 Nov 09:28 ET (refused, MARKET_CLOSED), 11:59 ET (allowed).
  const recorded = FACTS.mainnetDecisions.value.map((l) => ({ key: l.transactionHash, timestamp: l.blockTime }));

  it("puts each recorded Decision on Tuesday's row at its ET minute", () => {
    const ticks = placeTicks(weekAt(SATURDAY), recorded);
    expect(ticks.map((t) => t.index)).toEqual([1, 1]);
    expect(ticks.map((t) => Math.floor(t.minute))).toEqual([9 * 60 + 28, 11 * 60 + 59]);
    // In chain order, oldest first, whatever order they came in.
    expect(ticks.map((t) => t.item.key)).toEqual([...recorded].sort((a, b) => a.timestamp - b.timestamp).map((r) => r.key));
    // The refusal sits two minutes before the open, in the closed window, and the allowed one in the session.
    expect(ticks[0]!.minute).toBeLessThan(OPEN);
    expect(ticks[1]!.minute).toBeGreaterThan(OPEN);
    expect(ticks[1]!.minute).toBeLessThan(CLOSE);
  });

  it("leaves out a Decision of another week, one at the next Monday's midnight, and one whose time was not read", () => {
    const ticks = placeTicks(weekAt(SATURDAY), [
      { key: "sunday-before", timestamp: utc(2026, 11, 23, 4, 59, 59) },
      { key: "first-second", timestamp: utc(2026, 11, 23, 5, 0) },
      { key: "last-second", timestamp: utc(2026, 11, 30, 4, 59, 59) },
      { key: "next-monday", timestamp: utc(2026, 11, 30, 5, 0) },
      { key: "no-time", timestamp: null },
    ]);
    expect(ticks.map((t) => [t.item.key, t.index, Math.floor(t.minute)])).toEqual([
      ["first-second", 0, 0],
      ["last-second", 6, 1439],
    ]);
  });

  it("places a Decision in the hour that repeats when daylight time ends by its own offset", () => {
    // Sun 1 Nov 2026 06:30 UTC is 01:30 EST, the second 01:30 of that night.
    const [tick] = placeTicks(weekAt(utc(2026, 11, 1, 12, 0)), [{ key: "dst", timestamp: utc(2026, 11, 1, 6, 30) }]);
    expect(tick).toMatchObject({ index: 6, minute: 90 });
  });

  it("gives no tick for no Decision", () => {
    expect(placeTicks(weekAt(SATURDAY), [])).toEqual([]);
  });
});

describe("closedLine: the large line while NYSE is closed, from the reading's block", () => {
  const closed = { open: false };
  const cases: [name: string, blockTs: number, line: string][] = [
    ["Thanksgiving, Thu 26 Nov", THANKSGIVING, "NYSE closed · the vault refuses trades until Fri 09:30 ET"],
    ["the Fri 27 Nov 13:00 ET early close", EARLY_CLOSE, "NYSE closed · the vault refuses trades until Mon 09:30 ET"],
    ["a weekend, Sat 28 Nov", SATURDAY, "NYSE closed · the vault refuses trades until Mon 09:30 ET"],
    ["a normal night, Mon 23 Nov 22:00 ET", MONDAY_NIGHT, "NYSE closed · the vault refuses trades until Tue 09:30 ET"],
    ["the Wed 25 Nov 16:00 ET close, over Thanksgiving", WEDNESDAY_CLOSE, "NYSE closed · the vault refuses trades until Fri 09:30 ET"],
    ["a Monday before the open", MONDAY_MORNING, "NYSE closed · the vault refuses trades until Mon 09:30 ET"],
  ];

  it.each(cases)("%s", (_name, blockTs, line) => {
    expect(closedLine(closed, blockTs)).toBe(line);
  });

  it("is null in session, the last minute before the early close included", () => {
    expect(closedLine({ open: true }, MONDAY_SESSION)).toBeNull();
    expect(closedLine({ open: true }, LAST_EARLY_MINUTE)).toBeNull();
  });

  it("is null when MarketCalendar says closed while the repo calendar says open: the repo cannot say when it opens", () => {
    expect(closedLine(closed, MONDAY_SESSION)).toBeNull();
  });
});

describe("openLine: the plain line in session", () => {
  it("names the close, and says when it is an early close", () => {
    expect(openLine({ open: true }, MONDAY_SESSION)).toBe("NYSE open until 16:00 ET");
    expect(openLine({ open: true }, LAST_EARLY_MINUTE)).toBe("NYSE open until 13:00 ET · early close");
  });

  it("is null while closed, and when the reading's calendar and the repo calendar disagree", () => {
    expect(openLine({ open: false }, SATURDAY)).toBeNull();
    expect(openLine({ open: true }, SATURDAY)).toBeNull();
    expect(openLine({ open: false }, MONDAY_SESSION)).toBeNull();
  });
});
