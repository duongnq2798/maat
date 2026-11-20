import type { Page, Route } from "@playwright/test";
import fixture from "../test/fixtures/live-aggregate3.json" with { type: "json" };
import { type Hex, MULTICALL3, NAV_TOKENS } from "../content/b20-nav";
import { regularSession } from "../content/calendar";
import { type CallResult, decodeAggregate3, decodeObserve, encodeAggregate3Result, SELECTORS, word } from "../lib/live/abi";
import { twapPrice8 } from "../lib/live/price";
import { LIVE_RPCS } from "../lib/live/rpc";

/**
 * A fake Base for the e2e specs: both keyless RPC hosts the browser calls (LIVE_RPCS) answer from the recorded
 * Multicall3 reading in test/fixtures/live-aggregate3.json, so no spec touches the network.
 */

/** The recorded block, 60,013,066. */
export const FIXTURE_BLOCK = BigInt(fixture.expected.blockNumber);
/** The recorded block's timestamp: Fri 2026-11-20 16:43:08 UTC, 11:43 ET, in session. */
export const SESSION_TS = Number(fixture.expected.timestamp);
/** Sat 2026-11-21 15:00 UTC, 10:00 ET: the NYSE is closed. */
export const WEEKEND_TS = Date.UTC(2026, 10, 21, 15, 0, 0) / 1000;

/**
 * What the fake answers: the recorded reading at a weekend timestamp or as recorded (in session), both RPCs failing with
 * HTTP 503, or the multicall results given.
 */
export type Scenario = "weekend" | "session" | "down" | { results: CallResult[] };

/** The recorded multicall results, with the block-number word kept and the timestamp word set to `timestamp`. */
export function fixtureResults(timestamp: number = SESSION_TS): CallResult[] {
  const r = decodeAggregate3(fixture.response as Hex);
  r[0] = { success: true, returnData: `0x${word(FIXTURE_BLOCK)}` };
  r[1] = { success: true, returnData: `0x${word(BigInt(timestamp))}` };
  return r;
}

/** Where one token's call sits in the results: after the block number and the timestamp, five calls per token. */
function slot(symbol: string, call: "latestRoundData" | "observe"): number {
  const i = NAV_TOKENS.findIndex((t) => t.symbol === symbol);
  if (i < 0) throw new Error(`no NAV token ${symbol}`);
  return 2 + i * 5 + (call === "latestRoundData" ? 3 : 4);
}

/** A token's pool TWAP over `windowSec`, USD with 8 decimals, as the page computes it from the same results. */
export function twapOf(results: readonly CallResult[], symbol: string, windowSec: number): bigint {
  const obs = decodeObserve(results[slot(symbol, "observe")]!);
  const twap = obs === null ? null : twapPrice8(obs.tickCumulatives, windowSec);
  if (twap === null) throw new Error(`${symbol} has no TWAP in these results`);
  return twap;
}

/** The same results with one token's feed answering `answer` (8 decimals), last updated at `updatedAt`. */
export function withFeed(results: readonly CallResult[], symbol: string, answer: bigint, updatedAt: number): CallResult[] {
  const out = [...results];
  // latestRoundData: (roundId, answer, startedAt, updatedAt, answeredInRound).
  const data = `0x${word(1n)}${word(answer)}${word(BigInt(updatedAt))}${word(BigInt(updatedAt))}${word(1n)}` as Hex;
  out[slot(symbol, "latestRoundData")] = { success: true, returnData: data };
  return out;
}

function results(s: Exclude<Scenario, "down">): CallResult[] {
  if (s === "weekend") return fixtureResults(WEEKEND_TS);
  if (s === "session") return fixtureResults(SESSION_TS);
  return s.results;
}

// The public RPCs answer with CORS open; so does the fake, so the browser reads its answers.
const CORS = { "access-control-allow-origin": "*" };

interface JsonRpcRequest {
  id?: unknown;
  method?: string;
  params?: [{ to?: string; data?: string }?, string?];
}

export interface LiveRpc {
  /** How many JSON-RPC requests reached the fake, over both hosts. */
  calls(): number;
  /** What the fake answers from now on, held requests included. */
  set(s: Scenario): void;
  /** With `hold`: answer the requests held so far, and every later one at once. */
  release(): void;
}

/**
 * Routes both hosts of LIVE_RPCS to the fake. An eth_call to Multicall3's aggregate3 gets the scenario's results; an
 * isOpen call to a MarketCalendar (once deployments name one) gets the repo calendar's answer at that timestamp;
 * anything else gets a JSON-RPC error. "down" answers HTTP 503 on both hosts. With `hold`, every request waits for
 * `release()`, so a spec can look at the page while it is still reading.
 */
export async function routeLiveRpc(page: Page, scenario: Scenario, opts: { hold?: boolean } = {}): Promise<LiveRpc> {
  let current = scenario;
  let count = 0;
  let open = () => {};
  let gate: Promise<void> | undefined = opts.hold ? new Promise<void>((resolve) => (open = resolve)) : undefined;

  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { ...CORS, "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST" } });
      return;
    }
    count++;
    if (gate) await gate;
    const s = current;
    if (s === "down") {
      await route.fulfill({ status: 503, headers: CORS, contentType: "text/plain", body: "Service Unavailable" });
      return;
    }
    const rpc = (request.postDataJSON() ?? {}) as JsonRpcRequest;
    const reply = (body: { result: Hex } | { error: { code: number; message: string } }) =>
      route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, ...body }) });
    const tx = rpc.params?.[0];
    const to = tx?.to?.toLowerCase() ?? "";
    const data = tx?.data ?? "";
    if (rpc.method !== "eth_call") {
      await reply({ error: { code: -32601, message: `the fake RPC answers eth_call only, not ${rpc.method}` } });
    } else if (to === MULTICALL3.toLowerCase() && data.startsWith(SELECTORS.aggregate3)) {
      await reply({ result: encodeAggregate3Result(results(s)) });
    } else if (data.startsWith(SELECTORS.isOpen)) {
      // isOpen(uint64 timestamp, SessionMode mode): the timestamp is the first word after the selector.
      const ts = Number(BigInt(`0x${data.slice(10, 74)}`));
      await reply({ result: `0x${word(regularSession(ts).open ? 1n : 0n)}` });
    } else {
      await reply({ error: { code: -32000, message: `the fake RPC has no answer for a call to ${to}` } });
    }
  };

  for (const url of LIVE_RPCS) await page.route(`${url}/**`, handler);
  return {
    calls: () => count,
    set: (s) => void (current = s),
    release: () => {
      gate = undefined;
      open();
    },
  };
}
