// @vitest-environment node
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { formatHf, readTreasury, TreasuryUnavailable, valueUsd6, weightBps, type TreasuryClient } from "@/lib/chain/treasury";
import { readRepo } from "./helpers/solidity";

const VAULT: Address = "0x00000000000000000000000000000000000Aa001";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NVDAC: Address = "0xb20000000000000000000078ee7ce2fE4908108C";
const GOOGLC: Address = "0xb2000000000000000000002D0BA3164cc74f58B7";
const NVDA_FEED: Address = "0x04689a41629776563E6822F76f2e57D148d28513";
const GOOGL_FEED: Address = "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2";
const CREDIT: Address = "0x0000000000000000000000000000000000000c03";
const OWNER: Address = "0x0000000000000000000000000000000000000001";
const EXECUTOR: Address = "0x0000000000000000000000000000000000000002";
const NOW = 1_764_171_000n;
const E18 = 10n ** 18n;

const MANDATE = {
  sessionMode: 0,
  maxPremiumBps: 100,
  maxSlippageBps: 100,
  maxStaleness: 3600,
  multiplierCooldown: 86_400,
  twapWindow: 1800,
  perTradeCapUsd: 50_000_000n,
  dailyCapUsd: 100_000_000n,
  calendar: "0x0000000000000000000000000000000000000c01",
  swapAdapter: "0x0000000000000000000000000000000000000c02",
  creditAdapter: CREDIT,
  minHealthFactor: 1_500_000_000_000_000_000n,
  targetHealthFactor: 2_000_000_000_000_000_000n,
  deriskWindow: 28_800,
};

type Call = { address: Address; functionName: string; args?: readonly unknown[] };
type Answer = { status: "success"; result: unknown } | { status: "failure"; error: Error };

function fakeClient(overrides: Record<string, Answer> = {}): TreasuryClient & { calls: Call[] } {
  const ok = (result: unknown): Answer => ({ status: "success", result });
  const base: Record<string, Answer> = {
    [`${VAULT}.owner`]: ok(OWNER),
    [`${VAULT}.executor`]: ok(EXECUTOR),
    [`${VAULT}.paused`]: ok(false),
    [`${VAULT}.mandate`]: ok(MANDATE),
    [`${VAULT}.mandateHash`]: ok(`0x${"cd".repeat(32)}`),
    [`${VAULT}.tokens`]: ok([NVDAC, GOOGLC]),
    [`${VAULT}.usdc`]: ok(USDC),
    [`${VAULT}.tokenConfig.${NVDAC}`]: ok([true, NVDA_FEED, "0x0000000000000000000000000000000000000f01", 4000]),
    [`${VAULT}.tokenConfig.${GOOGLC}`]: ok([true, GOOGL_FEED, "0x0000000000000000000000000000000000000f02", 4000]),
    [`${NVDAC}.balanceOf`]: ok(E18 / 10n), // 0.1 NVDAc
    [`${NVDAC}.balanceOfUI`]: ok((E18 / 10n) * 1_000_537_939n / 1_000_000_000n),
    [`${NVDAC}.decimals`]: ok(18),
    [`${GOOGLC}.balanceOf`]: ok(E18 / 20n), // 0.05 GOOGLc
    [`${GOOGLC}.balanceOfUI`]: ok(E18 / 20n),
    [`${GOOGLC}.decimals`]: ok(18),
    [`${USDC}.balanceOf`]: ok(30_000_000n),
    [`${CREDIT}.debt`]: ok(5_000_000n),
    [`${CREDIT}.healthFactor`]: ok(2_130_000_000_000_000_000n),
    [`${CREDIT}.suppliedOf.${NVDAC}`]: ok(E18 / 10n),
    [`${CREDIT}.suppliedOf.${GOOGLC}`]: ok(0n),
    // NVDA at $200.00, GOOGL at $300.00 (8 decimals), both updated 14 s before the block.
    [`${NVDA_FEED}.latestRoundData`]: ok([1n, 20_000_000_000n, NOW - 14n, NOW - 14n, 1n]),
    [`${GOOGL_FEED}.latestRoundData`]: ok([1n, 30_000_000_000n, NOW - 14n, NOW - 14n, 1n]),
  };
  const answers = { ...base, ...overrides };
  const calls: Call[] = [];
  return {
    calls,
    getBlock: async () => ({ number: 59_800_000n, timestamp: NOW }) as never,
    multicall: (async ({ contracts }: { contracts: readonly Call[] }) =>
      contracts.map((c) => {
        calls.push(c);
        const key = [c.address, c.functionName, ...(c.args ?? []).filter((a) => typeof a === "string" && a !== VAULT)].join(".");
        return answers[key] ?? { status: "failure", error: new Error(`no answer for ${key}`) };
      })) as never,
  };
}

describe("valueUsd6", () => {
  it("is raw × price8 / 10^(decimals + 2), truncated, in USDC units", () => {
    expect(valueUsd6(E18, 18_667_486_580n, 18)).toBe(186_674_865n);
    expect(valueUsd6(1n, 1n, 18)).toBe(0n);
  });

  it("matches MandateVault._valueUsd", () => {
    const body = /function _valueUsd\([^)]*\)[^{]*\{([\s\S]*?)\}/.exec(readRepo("contracts/src/MandateVault.sol"))?.[1] ?? "";
    expect(body.replace(/\s+/g, " ").trim()).toBe("return raw * price8 / 10 ** (uint256(IB20Asset(token).decimals()) + 2);");
  });
});

describe("weightBps and formatHf", () => {
  it("returns null weight for a non-positive whole", () => {
    expect(weightBps(1n, 0n)).toBeNull();
    expect(weightBps(1n, -5n)).toBeNull();
    expect(weightBps(2_500n, 10_000n)).toBe(2500);
  });

  it("formats a WAD health factor to two decimals, and Aave's no-debt maximum as none", () => {
    expect(formatHf(2_130_000_000_000_000_000n)).toBe("2.13");
    expect(formatHf(2n ** 256n - 1n)).toBe("no debt");
  });
});

describe("readTreasury", () => {
  it("reads holdings by balanceOfUI and raw balance, values them raw × feed, and weighs them on net equity", async () => {
    const t = await readTreasury(fakeClient(), VAULT);
    expect(t).toMatchObject({ blockNumber: 59_800_000n, timestamp: Number(NOW), owner: OWNER, executor: EXECUTOR, paused: false, usdc: { ok: true, value: 30_000_000n } });
    const nvda = t.tokens.find((x) => x.symbol === "NVDAc")!;
    // 0.1 held + 0.1 supplied at $200 = $40; GOOGLc 0.05 at $300 = $15; equity = 30 + 40 + 15 − 5 = $80.
    expect(nvda).toMatchObject({
      raw: { ok: true, value: E18 / 10n },
      ui: { ok: true, value: (E18 / 10n) * 1_000_537_939n / 1_000_000_000n },
      supplied: { ok: true, value: E18 / 10n },
      price8: { ok: true, value: 20_000_000_000n },
      feedAgeSec: { ok: true, value: 14 },
      maxWeightBps: { ok: true, value: 4000 },
      valueUsd6: { ok: true, value: 40_000_000n },
      weightBps: 5000,
    });
    expect(t.equityUsd6).toEqual({ ok: true, value: 80_000_000n });
    expect(t.credit).toEqual({ debt: { ok: true, value: 5_000_000n }, healthFactor: { ok: true, value: 2_130_000_000_000_000_000n } });
    expect(t.mandate.minHealthFactor).toBe(1_500_000_000_000_000_000n);
  });

  it("reads every call at the same block", async () => {
    const c = fakeClient();
    let blocks: unknown[] = [];
    const multicall = c.multicall;
    c.multicall = (async (args: { blockNumber?: bigint }) => {
      blocks.push(args.blockNumber);
      return (multicall as (a: unknown) => unknown)(args);
    }) as never;
    await readTreasury(c, VAULT);
    expect(new Set(blocks)).toEqual(new Set([59_800_000n]));
    blocks = [];
  });

  it("marks one unreadable feed as unavailable, keeps the other stocks, and gives no equity", async () => {
    const t = await readTreasury(fakeClient({ [`${GOOGL_FEED}.latestRoundData`]: { status: "failure", error: new Error("revert") } }), VAULT);
    const googl = t.tokens.find((x) => x.symbol === "GOOGLc")!;
    expect(googl.price8).toEqual({ ok: false });
    expect(googl.valueUsd6).toEqual({ ok: false });
    expect(googl.weightBps).toBeNull();
    expect(t.tokens.find((x) => x.symbol === "NVDAc")!.valueUsd6).toEqual({ ok: true, value: 40_000_000n });
    expect(t.equityUsd6).toEqual({ ok: false });
  });

  it("treats a stale-looking feed answer from the future as unreadable, as PriceLib does", async () => {
    const t = await readTreasury(fakeClient({ [`${NVDA_FEED}.latestRoundData`]: { status: "success", result: [1n, 20_000_000_000n, 0n, NOW + 5n, 1n] } }), VAULT);
    expect(t.tokens.find((x) => x.symbol === "NVDAc")!.price8).toEqual({ ok: false });
  });

  it("has no credit section when the mandate has no credit adapter", async () => {
    const t = await readTreasury(
      fakeClient({ [`${VAULT}.mandate`]: { status: "success", result: { ...MANDATE, creditAdapter: "0x0000000000000000000000000000000000000000" } } }),
      VAULT,
    );
    expect(t.credit).toBeNull();
    expect(t.tokens.find((x) => x.symbol === "NVDAc")!.supplied).toEqual({ ok: true, value: 0n });
    expect(t.equityUsd6).toEqual({ ok: true, value: 30_000_000n + 20_000_000n + 15_000_000n });
  });

  it("throws TreasuryUnavailable when a vault read the page cannot do without fails", async () => {
    await expect(readTreasury(fakeClient({ [`${VAULT}.owner`]: { status: "failure", error: new Error("x") } }), VAULT)).rejects.toBeInstanceOf(
      TreasuryUnavailable,
    );
  });
});
