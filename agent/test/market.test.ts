import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { BASKET, USDC } from "../src/addresses.js";
import { readMarketState, TokenNotCovered } from "../src/chain/market.js";
import { StateUnavailable } from "../src/chain/state.js";
import { CALENDAR, DEX_PRICE8, FEEDS, POOL, TWAP_TICK, VAULT, marketScene } from "./fakes/fakeChain.js";

const NVDA = BASKET[0]!.address;

describe("readMarketState", () => {
  it("reads every GuardLib input for one token", async () => {
    const s = await readMarketState(marketScene().client(), VAULT, NVDA);
    expect(s.block).toBe(100n);
    expect(s.symbol).toBe("NVDAc");
    expect(s.decimals).toBe(8);
    expect(getAddress(s.pool)).toBe(getAddress(POOL));
    expect(s.allowed).toBe(true);
    expect(s.vaultPaused).toBe(false);
    expect(s.marketOpen).toBe(true);
    expect(s.tokenPaused).toBe(false);
    expect(s.oracle).toEqual({ price8: DEX_PRICE8, updatedAt: 1_794_000_000n - 30n, age: 30n });
    expect(s.dex).toEqual({ tick: TWAP_TICK, price8: DEX_PRICE8 });
    expect(s.premiumBps).toBe(0n);
    expect(s.multiplier).toEqual({ current: 10n ** 18n, last: 10n ** 18n, changedAt: 0n, effectiveAt: 0n });
    expect(s.policyIds).toEqual({ sender: 0n, receiver: 0n, executor: 0n });
    expect(s.reserves).toEqual({ stock: 5_000_000_000n, usdc: 10_000_000_000n });
    expect(s.limits).toEqual({ maxStaleness: 3600, twapWindow: 1800, maxPremiumBps: 100, multiplierCooldown: 86400 });
  });

  it("asks the pool for observe([twapWindow, 0]) and pins every read to one block", async () => {
    const f = marketScene();
    const client = f.client();
    const blocks: unknown[] = [];
    const orig = client.multicall;
    client.multicall = (async (p: { blockNumber?: bigint }) => {
      blocks.push(p.blockNumber);
      return orig(p as never);
    }) as typeof client.multicall;
    await readMarketState(client, VAULT, NVDA);
    expect(blocks).toEqual([100n, 100n]);
    expect(f.calls.find((c) => c.functionName === "observe")?.args).toEqual([[1800, 0]]);
  });

  it("prices the stock as token0 too", async () => {
    // With the stock as token0 the price is 1.0001^tick, so the mirrored tick gives the same ~$200.
    const f = marketScene().set(POOL, "token0", NVDA).set(POOL, "observe", [[0n, 6932n * 1800n], [0n, 0n]]);
    const s = await readMarketState(f.client(), VAULT, NVDA);
    expect(s.dex?.tick).toBe(6932);
    expect(s.dex?.price8).toBeGreaterThan(19_990_000_000n);
    expect(s.dex?.price8).toBeLessThan(20_010_000_000n);
  });

  it("computes the premium against the oracle", async () => {
    const f = marketScene().set(FEEDS[0]!, "latestRoundData", [1n, 19_600_000_000n, 0n, 1_794_000_000n - 30n, 1n]);
    const s = await readMarketState(f.client(), VAULT, NVDA);
    expect(s.premiumBps).toBe(((DEX_PRICE8 - 19_600_000_000n) * 10_000n) / 19_600_000_000n);
  });

  it("nulls an oracle round that PriceLib.readFeed would reject", async () => {
    for (const round of [
      [1n, 0n, 0n, 1_794_000_000n - 30n, 1n], // zero answer
      [1n, DEX_PRICE8, 0n, 0n, 1n], // never updated
      [1n, DEX_PRICE8, 0n, 1_794_000_001n, 1n], // updated in the future
    ]) {
      const s = await readMarketState(marketScene().set(FEEDS[0]!, "latestRoundData", round).client(), VAULT, NVDA);
      expect(s.oracle).toBeNull();
      expect(s.premiumBps).toBeNull();
    }
  });

  it("nulls failed token, pool and calendar reads instead of throwing", async () => {
    const f = marketScene().fail(NVDA, "isPaused").fail(NVDA, "effectiveAt").fail(POOL, "observe").fail(CALENDAR, "isOpen");
    const s = await readMarketState(f.client(), VAULT, NVDA);
    expect(s.tokenPaused).toBeNull();
    expect(s.multiplier.effectiveAt).toBeNull();
    expect(s.dex).toBeNull();
    expect(s.marketOpen).toBeNull();
  });

  it("refuses a token the vault does not cover", async () => {
    const f = marketScene().set(VAULT, "tokenConfig", [false, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000", 0]);
    await expect(readMarketState(f.client(), VAULT, USDC)).rejects.toBeInstanceOf(TokenNotCovered);
  });

  it("throws StateUnavailable when the vault itself is unreadable", async () => {
    await expect(readMarketState(marketScene().fail(VAULT, "mandate").client(), VAULT, NVDA)).rejects.toBeInstanceOf(StateUnavailable);
  });
});
