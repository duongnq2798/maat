import { describe, expect, it } from "vitest";
import { BASKET, USDC } from "../src/addresses.js";
import { readVaultState, StateUnavailable } from "../src/chain/state.js";
import { CALENDAR, CREDIT, FEEDS, MANDATE, POOL, PRICES, VAULT, standardScene, withCalendar } from "./fakes/fakeChain.js";

describe("readVaultState", () => {
  it("reads the standard scene", async () => {
    const s = await readVaultState(standardScene().client(), VAULT);
    expect(s.blockNumber).toBe(100n);
    expect(s.day).toBe(1_794_000_000n / 86_400n);
    expect(s.usdcBalance).toBe(100_000_000n);
    expect(s.newRevenue).toBe(0n);
    expect(s.marketOpen).toBe(true);
    expect(s.tokens.map((t) => t.symbol)).toEqual(["NVDAc", "GOOGLc", "AAPLc"]);
    expect(s.tokens[0]?.price8).toBe(PRICES[0]);
    expect(s.tokens[0]?.feedAge).toBe(30n);
    expect(s.credit).toEqual({ readable: true, debt: 0n, healthFactor: 2n ** 256n - 1n });
    expect(s.equityUsd6).toBe(100_000_000n);
  });

  it("pins every read to one block", async () => {
    const f = standardScene();
    const multicallBlocks: unknown[] = [];
    const client = f.client();
    const orig = client.multicall;
    client.multicall = (async (p: { blockNumber?: bigint }) => {
      multicallBlocks.push(p.blockNumber);
      return orig(p as never);
    }) as typeof client.multicall;
    await readVaultState(client, VAULT);
    expect(multicallBlocks.length).toBeGreaterThan(0);
    expect(multicallBlocks.every((b) => b === 100n)).toBe(true);
  });

  it("values balance plus supplied collateral and nets debt", async () => {
    const f = standardScene()
      .set(BASKET[0]!.address, "balanceOf", 50_000_000n) // 0.5 NVDAc
      .set(CREDIT, "suppliedOf", (a) => (a[0] === BASKET[0]!.address ? 50_000_000n : 0n))
      .set(CREDIT, "debt", 5_000_001n)
      .set(CREDIT, "healthFactor", 2_797_934_000_000_000_000n);
    const s = await readVaultState(f.client(), VAULT);
    expect(s.tokens[0]?.supplied).toBe(50_000_000n);
    expect(s.tokens[0]?.valueUsd6).toBe(186_674_865n); // 1 NVDAc
    expect(s.equityUsd6).toBe(100_000_000n + 186_674_865n - 5_000_001n);
  });

  it("reports new revenue", async () => {
    const s = await readVaultState(standardScene().set(USDC, "balanceOf", 130_000_000n).client(), VAULT);
    expect(s.newRevenue).toBe(30_000_000n);
  });

  it("degrades a token whose feed is unreadable", async () => {
    const s = await readVaultState(standardScene().fail(FEEDS[1]!, "latestRoundData").client(), VAULT);
    expect(s.tokens[1]?.price8).toBeNull();
    expect(s.tokens[1]?.feedAge).toBeNull();
    expect(s.tokens[1]?.valueUsd6).toBe(0n);
  });

  it("keeps each feed's round id and updatedAt for the blob, also for an answer the vault would refuse", async () => {
    const f = standardScene().set(FEEDS[2]!, "latestRoundData", [36893488147419105055n, 0n, 0n, 1_793_999_000n, 36893488147419105055n]);
    const s = await readVaultState(f.fail(FEEDS[1]!, "latestRoundData").client(), VAULT);
    expect(s.tokens.map((t) => [t.roundId, t.updatedAt])).toEqual([
      [1n, f.block.timestamp - 30n],
      [null, null],
      [36893488147419105055n, 1_793_999_000n],
    ]);
    expect(s.tokens[2]?.price8).toBeNull();
  });

  it("reads each pool's TWAP over the mandate's twapWindow, as PriceLib.twapPrice does", async () => {
    // Tick 0 is a price of 1 USDC unit per stock unit: $100 for an 8-decimal stock against 6-decimal USDC.
    const f = standardScene()
      .set(POOL, "observe", () => [[0n, 0n], [0n, 0n]])
      .set(POOL, "token0", USDC);
    const s = await readVaultState(f.client(), VAULT);
    expect(s.tokens.map((t) => t.twap8)).toEqual([10_000_000_000n, 10_000_000_000n, 10_000_000_000n]);
    expect(f.calls.filter((c) => c.functionName === "observe").map((c) => c.args)).toEqual(BASKET.map(() => [[1800, 0]]));
    // A pool whose token0 is NVDAc: +6932 ticks over 1800 s is about $200 for it and about $50 for the token1 stocks.
    const g = standardScene()
      .set(POOL, "observe", () => [[0n, 6932n * 1800n], [0n, 0n]])
      .set(POOL, "token0", BASKET[0]!.address);
    const t = (await readVaultState(g.client(), VAULT)).tokens;
    expect(Number(t[0]!.twap8) / 200e8).toBeCloseTo(1, 2);
    expect(Number(t[1]!.twap8) / 50e8).toBeCloseTo(1, 2);
  });

  it("has no TWAP when observe or token0 fails, the window is 0 or the token has no pool", async () => {
    const both = () => standardScene().set(POOL, "observe", () => [[0n, 0n], [0n, 0n]]).set(POOL, "token0", USDC);
    const none = async (f: ReturnType<typeof standardScene>) => (await readVaultState(f.client(), VAULT)).tokens.map((t) => t.twap8);
    expect(await none(both().fail(POOL, "observe"))).toEqual([null, null, null]);
    expect(await none(both().fail(POOL, "token0"))).toEqual([null, null, null]);
    expect(await none(both().set(VAULT, "mandate", { ...MANDATE, twapWindow: 0 }))).toEqual([null, null, null]);
    const noPool = both().set(VAULT, "tokenConfig", () => [true, FEEDS[0], "0x0000000000000000000000000000000000000000", 4000]);
    expect(await none(noPool)).toEqual([null, null, null]);
    expect(noPool.calls.some((c) => c.functionName === "observe")).toBe(false);
  });

  it("marks credit unreadable instead of throwing", async () => {
    const s = await readVaultState(standardScene().fail(CREDIT, "debt").client(), VAULT);
    expect(s.credit?.readable).toBe(false);
  });

  it("has no credit block when the mandate has no adapter", async () => {
    const f = standardScene();
    const { MANDATE } = await import("./fakes/fakeChain.js");
    f.set(VAULT, "mandate", { ...MANDATE, creditAdapter: "0x0000000000000000000000000000000000000000" });
    const s = await readVaultState(f.client(), VAULT);
    expect(s.credit).toBeNull();
    expect(s.tokens.every((t) => t.supplied === 0n)).toBe(true);
  });

  it("reports an unreadable lastMultiplier as null, not 0", async () => {
    const s = await readVaultState(standardScene().fail(VAULT, "lastMultiplier").client(), VAULT);
    expect(s.tokens.every((t) => t.lastMultiplier === null)).toBe(true);
  });

  it("treats an unreadable calendar as unknown", async () => {
    const s = await readVaultState(standardScene().fail(CALENDAR, "isOpen").client(), VAULT);
    expect(s.marketOpen).toBeNull();
    expect(s.calendar).toBeNull();
  });

  const NOV26 = 1_795_651_200n; // 2026-11-26T00:00Z; New York is on EST (UTC-5)

  it("reads the NYSE local day at the state block's timestamp", async () => {
    const f = withCalendar(standardScene());
    f.block = { number: 100n, timestamp: NOV26 + 15n * 3600n }; // Thanksgiving, 10:00 ET
    const s = await readVaultState(f.client(), VAULT);
    expect(s.marketOpen).toBe(false);
    expect(s.calendar).toEqual({ etDay: 20_783n, weekday: 4, minuteOfDay: 600, holiday: true, earlyCloseMin: 0 });
  });

  it("takes the holiday and early close of the date localTime names, not of the UTC date", async () => {
    const f = withCalendar(standardScene());
    f.block = { number: 100n, timestamp: NOV26 + 86_400n + 4n * 3600n + 1800n }; // Friday 04:30 UTC: Thursday 23:30 ET
    const s = await readVaultState(f.client(), VAULT);
    expect(s.calendar).toEqual({ etDay: 20_783n, weekday: 4, minuteOfDay: 1410, holiday: true, earlyCloseMin: 0 });
    f.block = { number: 100n, timestamp: NOV26 + 86_400n + 19n * 3600n }; // Friday 14:00 ET
    expect((await readVaultState(f.client(), VAULT)).calendar).toEqual({ etDay: 20_784n, weekday: 5, minuteOfDay: 840, holiday: false, earlyCloseMin: 780 });
  });

  it("reads the calendar views in the multicall that reads isOpen", async () => {
    const f = withCalendar(standardScene());
    const client = f.client();
    const batches: string[][] = [];
    const orig = client.multicall;
    client.multicall = (async (p: { contracts: { functionName: string }[] }) => {
      batches.push(p.contracts.map((c) => c.functionName));
      return orig(p as never);
    }) as typeof client.multicall;
    await readVaultState(client, VAULT);
    const withIsOpen = batches.filter((b) => b.includes("isOpen"));
    expect(withIsOpen).toHaveLength(1);
    expect(withIsOpen[0]).toEqual(expect.arrayContaining(["localTime", "isHoliday", "earlyCloseMin"]));
    expect(f.calls.filter((c) => c.functionName === "localTime").map((c) => c.args)).toEqual([[f.block.timestamp]]);
  });

  it("reports the calendar as null, not an error, when one of its views fails", async () => {
    for (const view of ["localTime", "isHoliday", "earlyCloseMin"]) {
      const s = await readVaultState(withCalendar(standardScene()).fail(CALENDAR, view).client(), VAULT);
      expect(s.calendar, view).toBeNull();
      expect(s.marketOpen, view).not.toBeNull();
    }
  });

  it("throws StateUnavailable when a vault-level read fails", async () => {
    await expect(readVaultState(standardScene().fail(VAULT, "mandate").client(), VAULT)).rejects.toBeInstanceOf(StateUnavailable);
    await expect(readVaultState(standardScene().fail(USDC, "balanceOf").client(), VAULT)).rejects.toBeInstanceOf(StateUnavailable);
  });

  it("throws StateUnavailable when a token balanceOf read fails", async () => {
    const f = standardScene().fail(BASKET[0]!.address, "balanceOf");
    await expect(readVaultState(f.client(), VAULT)).rejects.toBeInstanceOf(StateUnavailable);
  });

  it("throws StateUnavailable when a token decimals read fails", async () => {
    const f = standardScene().fail(BASKET[0]!.address, "decimals");
    await expect(readVaultState(f.client(), VAULT)).rejects.toBeInstanceOf(StateUnavailable);
  });

  it("throws StateUnavailable when getBlock fails", async () => {
    const client = standardScene().client();
    client.getBlock = (async () => {
      throw new Error("rpc down");
    }) as typeof client.getBlock;
    await expect(readVaultState(client, VAULT)).rejects.toBeInstanceOf(StateUnavailable);
  });
});
