import { REASONS } from "../../src/types.js";
import { CALENDAR_MATH, FEEDS, PRICES, standardScene, withCalendar, type FakeChain } from "./fakeChain.js";

/** The standard scene with MarketCalendar's math, its block at `clock` (ms), and feeds that are always 30 s old. */
export function sceneAt(clock: () => number): FakeChain {
  const f = withCalendar(standardScene());
  Object.defineProperty(f, "block", { get: () => ({ number: 100n, timestamp: BigInt(Math.floor(clock() / 1000)) }) });
  FEEDS.forEach((feed, i) => f.set(feed, "latestRoundData", () => [1n, PRICES[i]!, 0n, f.block.timestamp - 30n, 1n]));
  return f;
}

/** The vault's reason at `clock` for a trade the other checks pass: OK in session, MARKET_CLOSED outside it. */
export const reasonByCalendar = (clock: () => number) => (): number =>
  CALENDAR_MATH.isOpen(Math.floor(clock() / 1000), 0) ? 0 : REASONS.indexOf("MARKET_CLOSED");

/**
 * A clock that moves only when the test moves it. `sleep` parks the caller until the clock reaches its end, or until
 * its signal aborts; `sleepers` are the parked callers.
 */
export class FakeClock {
  t: number;
  sleepers: { until: number; wake: () => void }[] = [];

  constructor(iso: string) {
    this.t = Date.parse(iso);
  }

  now = (): number => this.t;

  sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise<void>((resolve) => {
      const s = { until: this.t + ms, wake: resolve };
      this.sleepers.push(s);
      signal?.addEventListener(
        "abort",
        () => {
          this.sleepers = this.sleepers.filter((x) => x !== s);
          resolve();
        },
        { once: true },
      );
    });

  /** Moves to the earliest sleeper's end and wakes every sleeper due by then. */
  advance(): void {
    const next = Math.min(...this.sleepers.map((s) => s.until));
    this.t = Math.max(this.t, next);
    const due = this.sleepers.filter((s) => s.until <= this.t);
    this.sleepers = this.sleepers.filter((s) => s.until > this.t);
    for (const s of due) s.wake();
  }
}
