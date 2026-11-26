import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, type Address } from "viem";
import type { StateClient } from "../../src/chain/state.js";
import { USDC, BASKET } from "../../src/addresses.js";

// `{} | null` rather than `unknown`, so a function literal still gets a contextual `args` type.
type Answer = {} | null | ((args: readonly unknown[]) => unknown);

export class FakeChain {
  answers = new Map<string, Answer>();
  block = { number: 100n, timestamp: 1_794_000_000n };
  calls: { address: Address; functionName: string; args: readonly unknown[] }[] = [];

  set(address: Address, functionName: string, value: Answer): this {
    this.answers.set(`${getAddress(address)}:${functionName}`, value);
    return this;
  }

  fail(address: Address, functionName: string): this {
    this.answers.delete(`${getAddress(address)}:${functionName}`);
    return this;
  }

  client(): StateClient {
    return {
      getBlock: async () => this.block,
      multicall: async ({ contracts }: { contracts: readonly { address: Address; functionName: string; args?: readonly unknown[] }[] }) =>
        contracts.map((c) => {
          const args = c.args ?? [];
          this.calls.push({ address: c.address, functionName: c.functionName, args });
          const key = `${getAddress(c.address)}:${c.functionName}`;
          if (!this.answers.has(key)) return { status: "failure", error: new Error(`no answer for ${key}`) };
          const a = this.answers.get(key);
          return { status: "success", result: typeof a === "function" ? (a as (x: readonly unknown[]) => unknown)(args) : a };
        }),
    } as unknown as StateClient;
  }
}

export const VAULT: Address = "0x1111111111111111111111111111111111111111";
export const EXECUTOR: Address = "0x2222222222222222222222222222222222222222";
export const CALENDAR: Address = "0x4444444444444444444444444444444444444444";
export const SWAP: Address = "0x5555555555555555555555555555555555555555";
export const CREDIT: Address = "0x6666666666666666666666666666666666666666";
export const FEEDS: Address[] = [
  "0x7777777777777777777777777777777777777771",
  "0x7777777777777777777777777777777777777772",
  "0x7777777777777777777777777777777777777773",
];
export const PRICES = [18667486580n, 28000000000n, 27000000000n]; // NVDA $186.67, GOOGL $280, AAPL $270
/** The pool every token's config names; it answers observe() and token0() only when a test sets them. */
export const POOL: Address = "0x8888888888888888888888888888888888888888";

export const MANDATE = {
  sessionMode: 0,
  maxPremiumBps: 100,
  maxSlippageBps: 150,
  maxStaleness: 90000,
  multiplierCooldown: 86400,
  twapWindow: 1800,
  perTradeCapUsd: 50_000_000n,
  dailyCapUsd: 100_000_000n,
  calendar: CALENDAR,
  swapAdapter: SWAP,
  creditAdapter: CREDIT,
  minHealthFactor: 1_500_000_000_000_000_000n,
  targetHealthFactor: 2_000_000_000_000_000_000n,
  deriskWindow: 28800,
};

const DAY_S = 86_400;
const civilDay = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
const weekdayOf = (day: number) => (day + 4) % 7; // 0 = Sunday, as DateLib.weekday
const nthSunday = (y: number, m: number, n: number) => {
  const first = civilDay(y, m, 1);
  return first + ((7 - weekdayOf(first)) % 7) + (n - 1) * 7;
};

/** The NYSE closures MarketCalendar's constructor preloads, as contracts/test/vectors/gen-vectors.mjs wrote them. */
export interface CalendarVectors {
  holidays: { date: string; etDay: number; name: string }[];
  earlyCloses: { date: string; etDay: number; closeMin: number }[];
  sessionChecks: { date: string; et: string; ts: number; regularOpen: boolean; feedOpen: boolean }[];
}
export const CALENDAR_VECTORS: CalendarVectors = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "..", "contracts", "test", "vectors", "nyse-calendar.json"), "utf8"),
);

/** MarketCalendar's math, line for line, with the holidays and early closes its constructor sets. */
export const CALENDAR_MATH = {
  holidays: new Set(CALENDAR_VECTORS.holidays.map((h) => h.etDay)),
  earlyCloseMin: new Map(CALENDAR_VECTORS.earlyCloses.map((e) => [e.etDay, e.closeMin] as const)),
  etOffsetSeconds(ts: number): number {
    const y = new Date(ts * 1000).getUTCFullYear();
    const dstStart = nthSunday(y, 3, 2) * DAY_S + 7 * 3600;
    const dstEnd = nthSunday(y, 11, 1) * DAY_S + 6 * 3600;
    return ts >= dstStart && ts < dstEnd ? 4 * 3600 : 5 * 3600;
  },
  localTime(ts: number): [etDay: number, weekday: number, minuteOfDay: number] {
    const local = ts - this.etOffsetSeconds(ts);
    const etDay = Math.floor(local / DAY_S);
    return [etDay, weekdayOf(etDay), Math.floor((local % DAY_S) / 60)];
  },
  isOpen(ts: number, mode: number): boolean {
    const [day, wd, minute] = this.localTime(ts);
    if (this.holidays.has(day)) return false;
    if (mode === 0) {
      if (wd === 0 || wd === 6) return false;
      return minute >= 570 && minute < (this.earlyCloseMin.get(day) ?? 960);
    }
    if (wd === 6) return false;
    if (wd === 0) return minute >= 1200;
    if (wd === 5) return minute < 1200;
    return true;
  },
};

/** Answers the calendar's views the way MarketCalendar does, at whatever block timestamp the scene is at. */
export function withCalendar(f: FakeChain): FakeChain {
  return f
    .set(CALENDAR, "isOpen", ([ts, mode]) => CALENDAR_MATH.isOpen(Number(ts), Number(mode)))
    .set(CALENDAR, "localTime", ([ts]) => CALENDAR_MATH.localTime(Number(ts)).map(BigInt))
    .set(CALENDAR, "isHoliday", ([day]) => CALENDAR_MATH.holidays.has(Number(day)))
    .set(CALENDAR, "earlyCloseMin", ([day]) => CALENDAR_MATH.earlyCloseMin.get(Number(day)) ?? 0);
}

/** $100 USDC, no stock, no debt, market open, all feeds fresh. Tweak with set()/fail() per test. */
export function standardScene(): FakeChain {
  const f = new FakeChain();
  f.set(VAULT, "executor", EXECUTOR)
    .set(VAULT, "paused", false)
    .set(VAULT, "mandate", MANDATE)
    .set(VAULT, "tokens", BASKET.map((t) => t.address))
    .set(VAULT, "usdc", USDC)
    .set(VAULT, "recordedUsdc", 100_000_000n)
    .set(VAULT, "spentOnDay", 0n)
    .set(VAULT, "tokenConfig", (args) => {
      const i = BASKET.findIndex((t) => getAddress(t.address) === getAddress(args[0] as Address));
      return [true, FEEDS[i], POOL, 4000];
    })
    .set(VAULT, "lastMultiplier", 1_000_000_000_000_000_000n)
    .set(USDC, "balanceOf", 100_000_000n)
    .set(CALENDAR, "isOpen", true)
    .set(CREDIT, "suppliedOf", 0n)
    .set(CREDIT, "debt", 0n)
    .set(CREDIT, "healthFactor", 2n ** 256n - 1n);
  BASKET.forEach((t, i) => {
    f.set(t.address, "balanceOf", 0n)
      .set(t.address, "decimals", 8)
      .set(t.address, "uiMultiplier", 1_000_000_000_000_000_000n)
      .set(FEEDS[i]!, "latestRoundData", [1n, PRICES[i]!, 0n, f.block.timestamp - 30n, 1n]);
  });
  return f;
}
