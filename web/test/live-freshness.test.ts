import { describe, expect, it } from "vitest";
import { classify, HEAD_MAX_LAG_SEC, LIVE_MAX_AGE_MS } from "@/lib/live/freshness";
import type { Reading } from "@/lib/live/freshness";

const reading = (timestamp: number, readAtMs: number) => ({ snapshot: { timestamp }, readAtMs }) as unknown as Reading;

describe("when a reading is live", () => {
  it("says reading before the first answer, and error when the first read failed", () => {
    expect(classify(undefined, false, 0, 0)).toEqual({ status: "reading" });
    expect(classify(undefined, true, 0, 0, "both failed")).toEqual({ status: "error", message: "both failed" });
  });

  it("is live when fresh and the head is current", () => {
    expect(classify(reading(1000, 0), false, 1_000, 1010).status).toBe("live");
  });

  it("is stale after a failed refresh, whatever its age", () => {
    const s = classify(reading(1000, 0), true, 1_000, 1010);
    expect(s).toMatchObject({ status: "stale", refreshFailed: true });
  });

  it("is stale once older than the live limit", () => {
    expect(classify(reading(1000, 0), false, LIVE_MAX_AGE_MS + 1, 1010).status).toBe("stale");
  });

  it("is behind when the RPC's head is far behind the visitor's clock", () => {
    expect(classify(reading(1000, 0), false, 1_000, 1000 + HEAD_MAX_LAG_SEC + 1)).toMatchObject({ status: "behind", lagSec: HEAD_MAX_LAG_SEC + 1 });
  });

  it("is still live at the limits themselves, and gives the reading's age and lag", () => {
    expect(classify(reading(1000, 0), false, LIVE_MAX_AGE_MS, 1000 + HEAD_MAX_LAG_SEC)).toMatchObject({
      status: "live",
      ageMs: LIVE_MAX_AGE_MS,
      lagSec: HEAD_MAX_LAG_SEC,
      refreshFailed: false,
    });
  });

  it("checks a failed refresh before the lag, and the lag before the age", () => {
    const old = LIVE_MAX_AGE_MS + 1;
    const far = 1000 + HEAD_MAX_LAG_SEC + 1;
    expect(classify(reading(1000, 0), true, old, far).status).toBe("stale");
    expect(classify(reading(1000, 0), false, old, far).status).toBe("behind");
  });

  it("gives an error a message even when none was passed", () => {
    expect(classify(undefined, true, 0, 0)).toMatchObject({ status: "error", message: expect.any(String) });
  });
});
