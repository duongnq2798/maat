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

export const MANDATE = {
  sessionMode: 0,
  maxPremiumBps: 100,
  maxSlippageBps: 100,
  maxStaleness: 3600,
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
      return [true, FEEDS[i], "0x8888888888888888888888888888888888888888", 4000];
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

export const POOL: Address = "0x8888888888888888888888888888888888888888";
/** TWAP tick -6932 with the stock as token1 against 6-decimal USDC: 1.0001^6932 ~= 2, so about $200. */
export const TWAP_TICK = -6932;
export const DEX_PRICE8 = 20_000_363_238n;

/** standardScene plus the reads the Guard Service makes: NVDAc's feed sits at the pool's TWAP price (0 bps premium). */
export function marketScene(): FakeChain {
  const f = standardScene();
  const nvda = BASKET[0]!.address;
  f.set(VAULT, "multiplierChangedAt", 0n)
    .set(nvda, "isPaused", false)
    .set(nvda, "effectiveAt", 0n)
    .set(nvda, "policyId", 0n)
    .set(nvda, "balanceOf", (a) => (getAddress(a[0] as Address) === getAddress(POOL) ? 5_000_000_000n : 0n)) // 50 NVDAc
    .set(USDC, "balanceOf", (a) => (getAddress(a[0] as Address) === getAddress(POOL) ? 10_000_000_000n : 100_000_000n)) // $10k in the pool
    .set(POOL, "token0", USDC)
    .set(POOL, "observe", [[0n, BigInt(TWAP_TICK) * 1800n], [0n, 0n]])
    .set(FEEDS[0]!, "latestRoundData", [1n, DEX_PRICE8, 0n, f.block.timestamp - 30n, 1n]);
  return f;
}
