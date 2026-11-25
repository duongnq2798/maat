import { act } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { type Hex, MULTICALL3 } from "@/content/b20-nav";
import { regularSession } from "@/content/calendar";
import { FACTS } from "@/content/facts";
import { type CallResult, decodeAggregate3, encodeAggregate3Result, word } from "@/lib/live/abi";
import type { Reading } from "@/lib/live/freshness";
import { LIVE_RPCS, type LiveReader, RpcError } from "@/lib/live/rpc";
import { decodeSnapshot, type LiveSnapshot } from "@/lib/live/snapshot";
import { headline, judgeToken, sessionAt } from "@/lib/live/verdict";
import fixture from "../fixtures/live-aggregate3.json";

/**
 * A fake Base for P1's unit tests, the same as test/live-strip.test.tsx builds for itself: the recorded multicall answer
 * with its block and timestamp words replaced, a MarketCalendar that answers like the repo calendar, fake clocks, and a
 * tab that can be hidden. A test file calls installLiveClocks() once, at its top.
 */

/** The recorded block, 60,013,066. */
export const BLOCK = BigInt(fixture.expected.blockNumber);
/** Fri 2026-11-20 16:43:08 UTC, 11:43 ET: in session. */
export const FRI = Number(fixture.expected.timestamp);
/** Sat 2026-11-21 15:00 UTC, 10:00 ET: the NYSE is closed. */
export const SAT = Date.UTC(2026, 10, 21, 15, 0, 0) / 1000;

/** The recorded answer, with the block number and timestamp words replaced. */
export function results(timestamp: number, block = BLOCK): CallResult[] {
  const r = decodeAggregate3(fixture.response as Hex);
  r[0] = { success: true, returnData: `0x${word(block)}` };
  r[1] = { success: true, returnData: `0x${word(BigInt(timestamp))}` };
  return r;
}

export type Edit = (r: CallResult[]) => CallResult[];

/** The recorded answer at `timestamp`, changed by `edit` if given; or both RPCs failing ("down"). */
export type Answer = { timestamp: number; block?: bigint; edit?: Edit } | "down";

const isMulticall = (tx: { to: Hex }) => tx.to.toLowerCase() === MULTICALL3.toLowerCase();

/**
 * A reader that answers like Base. `hold()` keeps the next calls in flight until `release(answer)`. `multicalls()` counts
 * the multicalls only, so no test depends on whether the deployments table names a MarketCalendar, which adds one call
 * to each good reading.
 */
export function fakeReader(first: Answer) {
  let answer = first;
  let gate: { promise: Promise<void>; open: () => void } | undefined;
  const call = vi.fn(async (tx: { to: Hex; data: Hex }): Promise<{ data: Hex; endpoint: string }> => {
    if (gate) await gate.promise;
    const a = answer;
    if (a === "down") throw new RpcError(LIVE_RPCS.map((endpoint) => ({ endpoint, message: "HTTP 503" })));
    if (!isMulticall(tx)) {
      return { data: `0x${word(regularSession(a.timestamp).open ? 1n : 0n)}`, endpoint: LIVE_RPCS[0]! };
    }
    const r = results(a.timestamp, a.block);
    return { data: encodeAggregate3Result(a.edit ? a.edit(r) : r), endpoint: LIVE_RPCS[0]! };
  });
  const reader: LiveReader = { call };
  return {
    reader,
    call,
    multicalls: () => call.mock.calls.filter(([tx]) => isMulticall(tx)).length,
    set: (next: Answer) => void (answer = next),
    hold: () => {
      let open = () => {};
      const promise = new Promise<void>((resolve) => (open = resolve));
      gate = { promise, open };
    },
    release: (next: Answer) => {
      answer = next;
      const g = gate;
      gate = undefined;
      g?.open();
    },
  };
}

let visibility: DocumentVisibilityState = "visible";

/** Fakes the timers and both clocks for every test in the file, and makes document.visibilityState settable. */
export function installLiveClocks(): void {
  beforeEach(() => {
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (document as { visibilityState?: unknown }).visibilityState;
  });
}

/** Moves the fake clocks on by `ms` and lets every answer due by then arrive. */
export const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** The tab goes hidden, the way the browser says so. */
export function hideTab(): void {
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
}

/** The tab is shown again. */
export function showTab(): void {
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
}

/**
 * The recorded answer at `timestamp`, judged the way the hook judges it, as read from the first RPC with the repo
 * calendar: for tests that render a part from a state without running the hook.
 */
export function readingAt(
  timestamp: number,
  opts: { block?: bigint; edit?: Edit; readAtMs?: number; wallAtReadSec?: number } = {},
): Reading {
  const r = results(timestamp, opts.block);
  const s = decodeSnapshot(opts.edit ? opts.edit(r) : r, FACTS.mandate.value.twapWindowSec);
  const snapshot: LiveSnapshot = { ...s, endpoint: LIVE_RPCS[0]!, calendar: { source: "repo" } };
  const session = sessionAt(snapshot);
  const verdicts = snapshot.tokens.map((t) => judgeToken(t, { timestamp: snapshot.timestamp, session }));
  return {
    snapshot,
    verdicts,
    headline: headline(verdicts),
    session,
    readAtMs: opts.readAtMs ?? 0,
    wallAtReadSec: opts.wallAtReadSec ?? timestamp,
  };
}
