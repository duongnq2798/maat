import { describe, expect, it } from "vitest";
import { BASKET, USDC } from "../src/addresses.js";
import { readVaultState, StateUnavailable } from "../src/chain/state.js";
import { CALENDAR, CREDIT, FEEDS, PRICES, VAULT, standardScene } from "./fakes/fakeChain.js";

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
