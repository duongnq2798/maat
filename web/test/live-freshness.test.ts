import { describe, expect, it } from "vitest";
import { classify, HEAD_MAX_LAG_SEC, LIVE_MAX_AGE_MS } from "@/lib/live/freshness";
import type { Reading } from "@/lib/live/freshness";

/** A reading of a block stamped `timestamp`, read at `readAtMs` on the monotonic clock and `wallAtReadSec` on the wall clock. */
const reading = (timestamp: number, readAtMs: number, wallAtReadSec: number) =>
  ({ snapshot: { timestamp }, readAtMs, wallAtReadSec }) as unknown as Reading;

describe("when a reading is live", () => {
  it("says reading before the first answer, and error when the first read failed", () => {
    expect(classify(undefined, false, 0, 0)).toEqual({ status: "reading" });
    expect(classify(undefined, true, 0, 0, "both failed")).toEqual({ status: "error", message: "both failed" });
  });

  it("is live when fresh and the head is current", () => {
    expect(classify(reading(1000, 0, 1003), false, 1_000, 1004)).toMatchObject({ status: "live", ageMs: 1_000, lagSec: 3 });
  });

  it("is stale after a failed refresh, whatever its age", () => {
    const s = classify(reading(1000, 0, 1003), true, 1_000, 1004);
    expect(s).toMatchObject({ status: "stale", refreshFailed: true });
  });

  it("is live only while read less than the live limit ago", () => {
    expect(classify(reading(1000, 0, 1003), false, LIVE_MAX_AGE_MS - 1, 1003).status).toBe("live");
    expect(classify(reading(1000, 0, 1003), false, LIVE_MAX_AGE_MS, 1003).status).toBe("stale");
  });

  it("is behind when the RPC's head was far behind the visitor's clock when it was read, even just read", () => {
    const r = reading(1000, 0, 1000 + HEAD_MAX_LAG_SEC + 1);
    expect(classify(r, false, 0, 1000 + HEAD_MAX_LAG_SEC + 1)).toMatchObject({ status: "behind", lagSec: HEAD_MAX_LAG_SEC + 1, ageMs: 0 });
    expect(classify(reading(1000, 0, 1000 + HEAD_MAX_LAG_SEC), false, 0, 1000 + HEAD_MAX_LAG_SEC).status).toBe("live");
  });

  it("calls a current reading that aged stale, never behind: the RPC's lag is the one it had when it answered", () => {
    // 3 s of lag at read time, then 3 min without a new answer on both clocks: a hidden tab, or a read that hangs.
    const s = classify(reading(1000, 0, 1003), false, 180_000, 1003 + 180);
    expect(s).toMatchObject({ status: "stale", ageMs: 180_000, lagSec: 3, refreshFailed: false });
  });

  it("is stale when the wall clock moved past the live limit while the monotonic clock slept", () => {
    // A phone that slept: performance.now() paused, the wall clock did not.
    const s = classify(reading(1000, 0, 1003), false, 5_000, 1003 + LIVE_MAX_AGE_MS / 1000);
    expect(s).toMatchObject({ status: "stale", ageMs: LIVE_MAX_AGE_MS, lagSec: 3 });
    expect(classify(reading(1000, 0, 1003), false, 5_000, 1003 + LIVE_MAX_AGE_MS / 1000 - 1).status).toBe("live");
  });

  it("checks a failed refresh before the lag, and the lag before the age", () => {
    const behind = reading(1000, 0, 1000 + HEAD_MAX_LAG_SEC + 1);
    const old = LIVE_MAX_AGE_MS + 1;
    expect(classify(behind, true, old, 2000).status).toBe("stale");
    expect(classify(behind, false, old, 2000).status).toBe("behind");
  });

  it("gives an error a message even when none was passed", () => {
    expect(classify(undefined, true, 0, 0)).toMatchObject({ status: "error", message: expect.any(String) });
  });
});
