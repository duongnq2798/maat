// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Hex } from "@/content/b20-nav";
import { countdownText } from "@/lib/live/countdown";
import type { LiveSnapshot } from "@/lib/live/snapshot";
import { sessionAt } from "@/lib/live/verdict";

const at = (iso: string) => Date.parse(iso) / 1000;
/** Fri 2026-11-20 16:43:08 UTC, 11:43 ET: in session. */
const FRI = at("2026-11-20T16:43:08Z");
/** Sat 2026-11-21 15:00 UTC, 10:00 ET. */
const SAT = at("2026-11-21T15:00:00Z");
/** Mon 2026-11-23 12:00 UTC, 07:00 ET: before the open. */
const MON = at("2026-11-23T12:00:00Z");
const CALENDAR: Hex = "0x00000000000000000000000000000000000000ca";

/** The countdown the strip shows for a block at `blockTs`, read from the repo calendar or with MarketCalendar's answer. */
function countdown(blockTs: number, nowSec: number, onchain?: boolean | null): string | null {
  const calendar: LiveSnapshot["calendar"] =
    onchain === undefined ? { source: "repo" } : { source: "onchain", address: CALENDAR, open: onchain };
  return countdownText(sessionAt({ timestamp: blockTs, calendar }), blockTs, nowSec);
}

describe("countdownText (spec 2026-11-23 section 6.1, amendment A9)", () => {
  it.each([
    ["a Saturday block read 14 s later", SAT, SAT + 14, "opens Mon 09:30 ET · in 1 d 23 h"],
    ["a block an hour later, read 14 s after it", SAT + 3600, SAT + 3614, "opens Mon 09:30 ET · in 1 d 22 h"],
    ["Thanksgiving", at("2026-11-26T15:00:00Z"), at("2026-11-26T15:00:00Z"), "opens Fri 09:30 ET · in 23 h 30 min"],
    ["after Friday's 13:00 ET early close", at("2026-11-27T18:00:00Z"), at("2026-11-27T18:00:00Z"), "opens Mon 09:30 ET · in 2 d 20 h"],
    ["Wednesday after the close, with Thanksgiving next", at("2026-11-25T21:00:00Z"), at("2026-11-25T21:00:00Z"), "opens Fri 09:30 ET · in 1 d 17 h"],
  ])("names the next open's day and time for %s", (_, blockTs, nowSec, text) => {
    expect(countdown(blockTs, nowSec)).toBe(text);
  });

  it.each([
    ["at 07:00 ET", MON, MON, "in 2 h 30 min"],
    ["61 s later", MON, MON + 61, "in 2 h 28 min"],
    ["30 s before the open", at("2026-11-23T14:29:30Z"), at("2026-11-23T14:29:30Z"), "in under 1 min"],
  ])("says only how long when the open is later the same ET day: %s", (_, blockTs, nowSec, text) => {
    expect(countdown(blockTs, nowSec)).toBe(text);
  });

  it("keeps one text through each minute: it changes once a minute, never every second", () => {
    expect(countdown(MON, MON + 1)).toBe("in 2 h 29 min");
    expect(countdown(MON, MON + 59)).toBe("in 2 h 29 min");
    expect(countdown(MON, MON + 60)).toBe("in 2 h 29 min");
    expect(countdown(MON, MON + 61)).toBe("in 2 h 28 min");
  });

  it.each([
    ["in session", FRI, undefined],
    ["when MarketCalendar cannot be read in the repo calendar's session", FRI, null],
    ["when MarketCalendar says closed and the repo calendar says open", FRI, false],
    ["when MarketCalendar says open and the repo calendar says closed", SAT, true],
  ])("shows no countdown %s", (_, blockTs, onchain) => {
    expect(countdown(blockTs, blockTs + 14, onchain)).toBeNull();
  });

  it("counts down when MarketCalendar agrees the NYSE is closed", () => {
    expect(countdown(SAT, SAT + 14, false)).toBe("opens Mon 09:30 ET · in 1 d 23 h");
  });
});
