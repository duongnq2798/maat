# Live strip and /now Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-line strip under the landing H1 and a `/now` page that read Base mainnet in the browser and say what an agent under Maat's default mandate would do right now, for the 13 B20 tokens with a NAV feed.

**Architecture:** A dependency-free reader in `web/lib/live/` sends one Multicall3 `aggregate3` `eth_call` over a keyless public RPC, decodes it with a small ABI codec, prices the pools with ports of `PriceLib`/`TickMath`, and judges each token in contract order. A React hook refreshes it and classifies freshness; the strip and `/now` render the result. The static export carries no chain value.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript 7 (`strict`, `noUncheckedIndexedAccess`), Tailwind 4, vitest 5 + Testing Library + jsdom, Playwright 1.65 with axe.

**Spec:** `docs/superpowers/specs/2026-11-20-maat-web-live-strip-design.md`

## Global Constraints

- Work in `web/`. Run `npm ci` once in `web/` before the first test. Node 24.
- No new npm dependency. `@noble/hashes` (devDependency) may be used in tests only.
- RPC endpoints, in order: `https://base-rpc.publicnode.com`, then `https://mainnet.base.org`. Never read any environment variable for them, never read `.env`, never use `BASE_RPC_URL` or `NEXT_PUBLIC_BASE_RPC_URL`.
- Nothing signs or sends a transaction. Only `eth_call`.
- Copy: never the words "safe" or "safety" in the strip, `/now` or the simulator note. Verdict wording comes from `REASON_LABEL` / `reasonText` / `ReasonTag` (`web/content/reasons.ts`, `web/components/ui/ReasonTag.tsx`). Never invent numbers; every threshold comes from `FACTS.mandate` (`web/content/facts.ts`).
- Every committed file is in English.
- Thresholds come from `FACTS.mandate` at runtime (`maxStalenessSec`, `maxPremiumBps`, `twapWindowSec`, `multiplierCooldownSec`) — another branch changes their values; never hard-code 3600, 100 or 1800 outside tests that read `FACTS`.
- Git: stage with `git add -- <files>`, commit with `git commit -F <file>` (write the message to a file in the scratchpad), every message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--amend`, never force push, never bare `git stash`. Never add `grep.exe.stackdump`, `web/grep.exe.stackdump` or `docs/superpowers/roadmap/`.
- Playwright: always `--workers=2`; only one Playwright run on port 4173 at a time (check with `netstat -ano | grep 4173` first).
- Commands: `npm test -- <file>` runs one vitest file; `npm run typecheck`; `npm run build && npm run check:out`; `npx playwright test --workers=2 <spec>` after a build.

## Review Focus

- A Multicall3 sub-call to an address without code succeeds with empty `returnData`: the decoder must treat empty or short data as a failed call, not as zero. (Task 1 test "short returnData is a failure".)
- The first RPC answers with an HTTP 200 whose body is a JSON-RPC error (rate limit): the reader must fall to the next endpoint, and report both errors if all fail. (Task 3 test "falls back on a JSON-RPC error body".)
- A refresh fails after a good reading: the old verdict must be shown as not live, with its age, never with the LIVE pill. (Task 5 test "stale after a failed refresh".)
- The RPC serves an old head (block timestamp minutes behind the visitor's clock): not live. (Task 5 test "behind".)
- A feed `updatedAt` later than the block timestamp, a zero or negative answer: `BAD_PRICE`, not a negative age. (Task 4 test "future updatedAt is BAD_PRICE".)

---

## File map

| File | Responsibility |
|---|---|
| `web/content/b20-nav.ts` | The 13 tokens: symbol, name, token, feed, pool, with sources |
| `web/lib/live/abi.ts` | Hex words, selectors, call encoders, `aggregate3` encode/decode, result decoders |
| `web/lib/live/price.ts` | `twapTick`, `sqrtPriceAtTick`, `priceFromSqrt`, `premiumBps` |
| `web/lib/live/rpc.ts` | `LIVE_RPCS`, `LiveReader`, `createReader` (fetch, timeout, fallback) |
| `web/lib/live/snapshot.ts` | `buildCalls`, `decodeSnapshot`, `readSnapshot` |
| `web/lib/live/verdict.ts` | `judgeToken`, `sessionAt`, `headline`, `headlineText` |
| `web/lib/live/freshness.ts` | `classify` and the live/stale/behind thresholds |
| `web/lib/live/format.ts` | Age, USD, bps, multiplier, date and block formatting |
| `web/components/live/useLiveSnapshot.ts` | The refresh loop as a hook |
| `web/components/live/VerdictLine.tsx` | The headline sentence with `ReasonTag`s |
| `web/components/live/LiveStrip.tsx` | The strip under the H1 |
| `web/components/live/NowBoard.tsx` | The `/now` client board (status, headline, table, cards) |
| `web/app/(site)/now/page.tsx` | The `/now` route, metadata, method section |
| `web/components/sections/Hero.tsx` | Mounts the strip under the H1 |
| `web/components/Simulator.tsx` | The Now-chip note |
| `web/app/sitemap.ts`, `web/lib/check-out.ts`, `web/scripts/check-out.ts` | `/now` in the sitemap and the export check |
| `web/e2e/fake-live-rpc.ts`, `web/e2e/live.spec.ts` | Fake RPC routing and end-to-end scenarios |
| `web/test/fixtures/live-aggregate3.json` | A real `aggregate3` request/response from Base with viem's decoding |

---

### Task 1: Token list and ABI codec

**Files:**
- Create: `web/content/b20-nav.ts`, `web/lib/live/abi.ts`, `web/test/fixtures/live-aggregate3.json` (copy from `C:/Users/eric/AppData/Local/Temp/claude/6b5eabb05911c2d0/61abfc37-afbf-4d60-8d9c-d2fd8e0083f7/scratchpad/m5/live-aggregate3.json`)
- Test: `web/test/b20-nav.test.ts`, `web/test/live-abi.test.ts`

**Interfaces:**
- Produces:
  - `type Hex = \`0x${string}\``
  - `interface NavToken { symbol: string; name: string; token: Hex; feed: Hex; pool: Hex }`, `NAV_TOKENS: readonly NavToken[]` (13, in the order below), `MULTICALL3: Hex`
  - `SELECTORS` record; `encodeCall(selector: Hex, ...words: bigint[]): Hex`; `encodeObserve(secondsAgo: readonly number[]): Hex`
  - `interface Call3 { target: Hex; allowFailure: boolean; callData: Hex }`, `interface CallResult { success: boolean; returnData: Hex }`
  - `encodeAggregate3(calls: readonly Call3[]): Hex`, `decodeAggregate3(data: Hex): CallResult[]`, `encodeAggregate3Result(results: readonly CallResult[]): Hex` (tests and e2e use it to build fake answers)
  - Result decoders returning `null` when the call failed or its data is too short: `decodeUint(r: CallResult): bigint | null`, `decodeBool(r): boolean | null`, `decodeRoundData(r): { answer: bigint; updatedAt: bigint } | null`, `decodeObserve(r): { tickCumulatives: bigint[] } | null`

- [ ] **Step 1: Write the token list**

`web/content/b20-nav.ts`:

```ts
/**
 * The B20 tokens that have a NAV: Coinbase's keyless list (GET https://api.coinbase.com/v1/tokenized-stocks, read
 * 2026-11-20) returns 378 tokens and gives `nav_price` for exactly these 13; the NAV is the answer of the Chainlink
 * feed "Coinbase X" on Base. Verified on Base mainnet on 2026-11-20 (block ~60,013,066): B20 factory
 * 0xb20f000000000000000000000000000000000000 isB20(token) is true; each proxy's description() is "Coinbase X"
 * ("Coinbase ANT / USD" for ANT) with 8 decimals; each pool is the Aerodrome Slipstream USDC pool with tick spacing 10
 * from factory 0x9CB220581b91b0C83223012FE69688b92aD07a76, token0() = USDC, token1() = the token, observe([1800, 0])
 * answers. There is no COINc token, so Chainlink's "Coinbase COIN" feed has nothing to price here.
 */
export type Hex = `0x${string}`;

export interface NavToken {
  readonly symbol: string;
  /** The underlying company, as Coinbase's list names it. */
  readonly name: string;
  readonly token: Hex;
  /** Chainlink proxy, 8 decimals. */
  readonly feed: Hex;
  /** Aerodrome Slipstream pool, token0 = USDC (6 decimals), token1 = the token (8 decimals). */
  readonly pool: Hex;
}

export const MULTICALL3: Hex = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const USDC_DECIMALS = 6;
export const B20_DECIMALS = 8;

export const NAV_TOKENS: readonly NavToken[] = [
  { symbol: "AAPLc", name: "Apple Inc.", token: "0xb200000000000000000000C2e324d24d7eEcd1fb", feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988", pool: "0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6" },
  { symbol: "AMZNc", name: "Amazon.com Inc.", token: "0xb200000000000000000000d9192b6B456483C2E8", feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295", pool: "0x532e0F46d1e528507FC9454d5847C231f23bDDf6" },
  { symbol: "ANTc", name: "Anthropic, PBC", token: "0xb20000000000000000000016e38FD364d271Ba28", feed: "0xeEDc7412E991a3F2BD693eb2aC7fB0F27d4660dA", pool: "0x599C4225FE90214795a0be228D20d7680f8CED15" },
  { symbol: "CRCLc", name: "Circle Internet Group Inc.", token: "0xB20000000000000000000019f6E7C675b73C2e4D", feed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33", pool: "0x294666AD6a415E8C33Af801225c04079BB4f1133" },
  { symbol: "GOOGLc", name: "Alphabet Inc.", token: "0xb2000000000000000000002D0BA3164cc74f58B7", feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", pool: "0x16c70F04C3080a127486Cdf5a4C33c066bBF47C3" },
  { symbol: "INTCc", name: "Intel Corporation", token: "0xB2000000000000000000004AFF16039bA04bdFBc", feed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB", pool: "0x3D384288fA79B51De882B06B617aB7989CcAd4f3" },
  { symbol: "METAc", name: "Meta Platforms Inc.", token: "0xb2000000000000000000008bC8786B856E61707C", feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D", pool: "0xd072410fa13D242e1d53721Bcf7AF02e3455DC96" },
  { symbol: "MSFTc", name: "Microsoft Corporation", token: "0xB200000000000000000000Ab99cFa739E253872B", feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c", pool: "0x2740C0faAb738F6e346e545fDE02aEF9B1A01ee7" },
  { symbol: "MSTRc", name: "Strategy Inc.", token: "0xb2000000000000000000004884b426556b92883d", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a", pool: "0x66DCd42E6314B287110922AE36cB2a8bdEECc153" },
  { symbol: "NVDAc", name: "NVIDIA Corporation", token: "0xb20000000000000000000078ee7ce2fE4908108C", feed: "0x04689a41629776563E6822F76f2e57D148d28513", pool: "0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC" },
  { symbol: "SNDKc", name: "Sandisk Corporation", token: "0xb200000000000000000000397293Cb8cda9a10c5", feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA", pool: "0x2836e062a3fe75943a7F4A552E2365b98E414E75" },
  { symbol: "SPCXc", name: "Space Exploration Technologies Corp.", token: "0xb2000000000000000000007b9fcbd005511aCBd5", feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68", pool: "0x880dB7Dda4407D99508574E680d067D1164B3cFE" },
  { symbol: "TSLAc", name: "Tesla Inc.", token: "0xb2000000000000000000001e800a7f5189430cD0", feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4", pool: "0x7A33000372f3F028f074182CCb9d16cBEEfBF920" },
];
```

- [ ] **Step 2: Write the token-list test**

`web/test/b20-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import { NAV_TOKENS } from "@/content/b20-nav";
import addresses from "@/content/generated/base-addresses.json";

const byName = new Map(addresses.map((a) => [a.name, a.value.toLowerCase()]));

describe("the B20 tokens with a NAV", () => {
  it("lists 13 distinct tokens, ANTc included and no COINc", () => {
    expect(NAV_TOKENS).toHaveLength(13);
    expect(new Set(NAV_TOKENS.map((t) => t.symbol)).size).toBe(13);
    expect(NAV_TOKENS.map((t) => t.symbol)).toContain("ANTc");
    expect(NAV_TOKENS.map((t) => t.symbol)).not.toContain("COINc");
  });

  it("names every basket token with the contracts' own token, feed and pool", () => {
    for (const symbol of FACTS.basket.value) {
      const t = NAV_TOKENS.find((x) => x.symbol === symbol);
      const key = symbol.replace(/c$/, "").toUpperCase(); // NVDAc -> NVDA
      expect(t?.token.toLowerCase()).toBe(byName.get(`${key}C`));
      expect(t?.feed.toLowerCase()).toBe(byName.get(`${key}_FEED`));
      expect(t?.pool.toLowerCase()).toBe(byName.get(`${key}C_USDC_POOL`));
    }
  });

  it("uses 0xb2-prefixed B20 addresses and 20-byte hex everywhere", () => {
    for (const t of NAV_TOKENS) {
      expect(t.token.toLowerCase().startsWith("0xb2")).toBe(true);
      for (const a of [t.token, t.feed, t.pool]) expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
    }
  });
});
```

- [ ] **Step 3: Write the failing codec test**

`web/test/live-abi.test.ts`:

```ts
import { keccak_256 } from "@noble/hashes/sha3.js";
import { describe, expect, it } from "vitest";
import { NAV_TOKENS, MULTICALL3 } from "@/content/b20-nav";
import {
  decodeAggregate3, decodeBool, decodeObserve, decodeRoundData, decodeUint, encodeAggregate3,
  encodeAggregate3Result, encodeCall, encodeObserve, SELECTORS, type Call3,
} from "@/lib/live/abi";
import fixture from "./fixtures/live-aggregate3.json";

const selector = (sig: string) =>
  `0x${Buffer.from(keccak_256(new TextEncoder().encode(sig))).subarray(0, 4).toString("hex")}`;

const SIGNATURES: Record<keyof typeof SELECTORS, string> = {
  aggregate3: "aggregate3((address,bool,bytes)[])",
  getBlockNumber: "getBlockNumber()",
  getCurrentBlockTimestamp: "getCurrentBlockTimestamp()",
  isPaused: "isPaused(uint8)",
  uiMultiplier: "uiMultiplier()",
  effectiveAt: "effectiveAt()",
  latestRoundData: "latestRoundData()",
  observe: "observe(uint32[])",
  isOpen: "isOpen(uint256,uint8)",
};

/** The fixture's call order: block number, block timestamp, then per token isPaused(0), uiMultiplier, effectiveAt, latestRoundData, observe([1800, 0]). */
function fixtureCalls(): Call3[] {
  const calls: Call3[] = [
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getBlockNumber) },
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getCurrentBlockTimestamp) },
  ];
  for (const t of NAV_TOKENS) {
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.isPaused, 0n) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.uiMultiplier) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.effectiveAt) });
    calls.push({ target: t.feed, allowFailure: true, callData: encodeCall(SELECTORS.latestRoundData) });
    calls.push({ target: t.pool, allowFailure: true, callData: encodeObserve([fixture.twapWindowSec, 0]) });
  }
  return calls;
}

describe("the live ABI codec", () => {
  it("uses the keccak-256 selector of every signature", () => {
    for (const [k, sig] of Object.entries(SIGNATURES)) expect(SELECTORS[k as keyof typeof SELECTORS]).toBe(selector(sig));
  });

  it("encodes the recorded aggregate3 request byte for byte", () => {
    expect(encodeAggregate3(fixtureCalls()).toLowerCase()).toBe(fixture.request.toLowerCase());
  });

  it("decodes the recorded response as viem did", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    expect(results).toHaveLength(2 + 5 * NAV_TOKENS.length);
    expect(decodeUint(results[0]!)).toBe(BigInt(fixture.expected.blockNumber));
    expect(decodeUint(results[1]!)).toBe(BigInt(fixture.expected.timestamp));
    fixture.expected.tokens.forEach((e, i) => {
      const r = results.slice(2 + i * 5, 7 + i * 5);
      expect(decodeBool(r[0]!)).toBe(e.paused);
      expect(decodeUint(r[1]!)).toBe(BigInt(e.uiMultiplier));
      expect(decodeUint(r[2]!)).toBe(BigInt(e.effectiveAt));
      expect(decodeRoundData(r[3]!)).toEqual({ answer: BigInt(e.answer), updatedAt: BigInt(e.updatedAt) });
      expect(decodeObserve(r[4]!)?.tickCumulatives).toEqual(e.tickCumulatives.map(BigInt));
    });
  });

  it("round-trips results, failures included", () => {
    const results = [
      { success: true, returnData: encodeCall("0x", 7n).slice(0, 66) as `0x${string}` },
      { success: false, returnData: "0x" as const },
      { success: true, returnData: "0x01020304" as const },
    ];
    expect(decodeAggregate3(encodeAggregate3Result(results))).toEqual(results);
  });

  it("treats a failed call as null", () => {
    const failed = { success: false, returnData: `0x${"00".repeat(31)}01` as `0x${string}` };
    expect(decodeBool(failed)).toBeNull();
    expect(decodeUint(failed)).toBeNull();
    expect(decodeRoundData(failed)).toBeNull();
    expect(decodeObserve(failed)).toBeNull();
  });

  it("short returnData is a failure: a call to an address without code succeeds with no data", () => {
    const empty = { success: true, returnData: "0x" as const };
    expect(decodeBool(empty)).toBeNull();
    expect(decodeUint(empty)).toBeNull();
    expect(decodeRoundData({ success: true, returnData: `0x${"00".repeat(64)}` })).toBeNull();
    expect(decodeObserve({ success: true, returnData: `0x${"00".repeat(32)}` })).toBeNull();
  });

  it("decodes negative tick cumulatives as signed", () => {
    // observe() returning int56[] [-5, -1] and uint160[] [0, 0]
    const w = (n: bigint) => (n & ((1n << 256n) - 1n)).toString(16).padStart(64, "0");
    const data = `0x${[w(0x40n), w(0xa0n), w(2n), w(-5n), w(-1n), w(2n), w(0n), w(0n)].join("")}` as `0x${string}`;
    expect(decodeObserve({ success: true, returnData: data })?.tickCumulatives).toEqual([-5n, -1n]);
  });
});
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd web && npm test -- test/b20-nav.test.ts test/live-abi.test.ts`
Expected: `b20-nav` passes once Step 1 exists; `live-abi` FAILS (cannot resolve `@/lib/live/abi`).

- [ ] **Step 5: Implement the codec**

`web/lib/live/abi.ts`:

```ts
import type { Hex } from "@/content/b20-nav";

/** The few ABI shapes the live reader needs. Every word is 32 bytes, written as 64 hex characters. */
const WORD = 64;
const MASK = (1n << 256n) - 1n;

export const SELECTORS = {
  aggregate3: "0x82ad56cb",
  getBlockNumber: "0x42cbb15c",
  getCurrentBlockTimestamp: "0x0f28c97d",
  isPaused: "0xbc61e733",
  uiMultiplier: "0xa60bf13d",
  effectiveAt: "0x97a4064f",
  latestRoundData: "0xfeaf968c",
  observe: "0x883bdbfd",
  isOpen: "0x3fef6f98",
} as const satisfies Record<string, Hex>;

export interface Call3 {
  target: Hex;
  allowFailure: boolean;
  callData: Hex;
}

export interface CallResult {
  success: boolean;
  returnData: Hex;
}

/** A 256-bit word, two's complement for negatives. */
export function word(n: bigint): string {
  return (n & MASK).toString(16).padStart(WORD, "0");
}

const strip = (h: Hex | string) => (h.startsWith("0x") ? h.slice(2) : h);
const pad32 = (hex: string) => hex.padEnd(Math.ceil(hex.length / WORD) * WORD, "0");

/** A call with only static arguments: the selector, then one word per argument. */
export function encodeCall(selector: Hex | "0x", ...args: bigint[]): Hex {
  return `0x${strip(selector)}${args.map(word).join("")}`;
}

/** observe(uint32[] secondsAgos). */
export function encodeObserve(secondsAgo: readonly number[]): Hex {
  return `0x${strip(SELECTORS.observe)}${word(0x20n)}${word(BigInt(secondsAgo.length))}${secondsAgo.map((s) => word(BigInt(s))).join("")}`;
}

/** The tail of a dynamic `bytes`: its length, then the data right-padded to a whole word. */
function bytesTail(data: Hex): string {
  const hex = strip(data);
  return `${word(BigInt(hex.length / 2))}${pad32(hex)}`;
}

/** An array of dynamic tuples: the length, one offset per element (from the first offset), then the elements. */
function dynamicArray(elements: readonly string[]): string {
  let offset = elements.length * 32;
  const heads: string[] = [];
  for (const e of elements) {
    heads.push(word(BigInt(offset)));
    offset += e.length / 2;
  }
  return `${word(BigInt(elements.length))}${heads.join("")}${elements.join("")}`;
}

/** aggregate3((address target, bool allowFailure, bytes callData)[] calls). */
export function encodeAggregate3(calls: readonly Call3[]): Hex {
  const tuples = calls.map((c) => `${word(BigInt(c.target))}${word(c.allowFailure ? 1n : 0n)}${word(0x60n)}${bytesTail(c.callData)}`);
  return `0x${strip(SELECTORS.aggregate3)}${word(0x20n)}${dynamicArray(tuples)}`;
}

/** The return of aggregate3, (bool success, bytes returnData)[]: what a node sends back. Tests and the e2e fake use it. */
export function encodeAggregate3Result(results: readonly CallResult[]): Hex {
  const tuples = results.map((r) => `${word(r.success ? 1n : 0n)}${word(0x40n)}${bytesTail(r.returnData)}`);
  return `0x${word(0x20n)}${dynamicArray(tuples)}`;
}

/** The word at byte offset `at`, or undefined past the end. */
function readWord(hex: string, at: number): bigint | undefined {
  const start = at * 2;
  if (start + WORD > hex.length) return undefined;
  return BigInt(`0x${hex.slice(start, start + WORD)}`);
}

function need(v: bigint | undefined, what: string): bigint {
  if (v === undefined) throw new Error(`aggregate3 result is cut short at ${what}`);
  return v;
}

/** Decode the aggregate3 return. A malformed body throws: the whole reading is then a failure. */
export function decodeAggregate3(data: Hex): CallResult[] {
  const hex = strip(data);
  const base = Number(need(readWord(hex, 0), "the array offset"));
  const n = Number(need(readWord(hex, base), "the array length"));
  const heads = base + 32;
  const out: CallResult[] = [];
  for (let i = 0; i < n; i++) {
    const at = heads + Number(need(readWord(hex, heads + i * 32), `offset ${i}`));
    const success = need(readWord(hex, at), `success ${i}`) === 1n;
    const bytesAt = at + Number(need(readWord(hex, at + 32), `bytes offset ${i}`));
    const len = Number(need(readWord(hex, bytesAt), `bytes length ${i}`));
    const start = (bytesAt + 32) * 2;
    if (start + len * 2 > hex.length) throw new Error(`aggregate3 result is cut short in returnData ${i}`);
    out.push({ success, returnData: `0x${hex.slice(start, start + len * 2)}` });
  }
  return out;
}

const signed = (w: bigint) => (w >= 1n << 255n ? w - (1n << 256n) : w);

/** The data of a successful call with at least `words` words, or null. */
function words(r: CallResult, count: number): string | null {
  if (!r.success) return null;
  const hex = strip(r.returnData);
  return hex.length >= count * WORD ? hex : null;
}

export function decodeUint(r: CallResult): bigint | null {
  const hex = words(r, 1);
  return hex === null ? null : (readWord(hex, 0) ?? null);
}

export function decodeBool(r: CallResult): boolean | null {
  const v = decodeUint(r);
  return v === null ? null : v !== 0n;
}

/** latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound). */
export function decodeRoundData(r: CallResult): { answer: bigint; updatedAt: bigint } | null {
  const hex = words(r, 5);
  if (hex === null) return null;
  return { answer: signed(readWord(hex, 32) ?? 0n), updatedAt: readWord(hex, 96) ?? 0n };
}

/** observe(uint32[]) → (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s). */
export function decodeObserve(r: CallResult): { tickCumulatives: bigint[] } | null {
  const hex = words(r, 2);
  if (hex === null) return null;
  const at = Number(readWord(hex, 0) ?? 0n);
  const n = readWord(hex, at);
  if (n === undefined || n > 64n) return null;
  const tickCumulatives: bigint[] = [];
  for (let i = 0; i < Number(n); i++) {
    const w = readWord(hex, at + 32 + i * 32);
    if (w === undefined) return null;
    tickCumulatives.push(signed(w));
  }
  return { tickCumulatives };
}
```

Note: `NavToken`'s `Hex` lives in `content/b20-nav.ts`; `lib/live/abi.ts` re-exports nothing else. If `encodeCall("0x", 7n)` in the round-trip test reads oddly: it is one bare word.

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd web && npm test -- test/b20-nav.test.ts test/live-abi.test.ts && npm run typecheck`
Expected: PASS, typecheck clean. If "encodes the recorded request byte for byte" fails, compare the first differing offset: element offsets count from the first offset word, not from the length word.

- [ ] **Step 7: Commit**

```bash
git add -- web/content/b20-nav.ts web/lib/live/abi.ts web/test/b20-nav.test.ts web/test/live-abi.test.ts web/test/fixtures/live-aggregate3.json
git commit -F <msg-file>   # feat(web): list the 13 B20s with a NAV and add a small ABI codec for one multicall
```

---

### Task 2: Pool price and premium

**Files:**
- Create: `web/lib/live/price.ts`
- Test: `web/test/live-price.test.ts`

**Interfaces:**
- Produces: `twapTick(tickCumulatives: readonly bigint[], windowSec: number): bigint | null` (expects `[then, now]`); `sqrtPriceAtTick(tick: bigint): bigint`; `priceFromSqrt(sqrtPriceX96: bigint, stockIsToken0: boolean, stockDecimals: number, quoteDecimals: number): bigint` (USD, 8 decimals); `twapPrice8(tickCumulatives: readonly bigint[], windowSec: number): bigint | null` (for these pools: stock is token1, 8 and 6 decimals); `premiumBps(dex: bigint, oracle: bigint): bigint`.

- [ ] **Step 1: Write the failing test**

`web/test/live-price.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { premiumBps, priceFromSqrt, sqrtPriceAtTick, twapPrice8, twapTick } from "@/lib/live/price";

describe("pool price, as contracts/src/lib/PriceLib.sol computes it", () => {
  it("matches TickMath at tick 0 and at both bounds", () => {
    expect(sqrtPriceAtTick(0n)).toBe(79228162514264337593543950336n);
    expect(sqrtPriceAtTick(-887272n)).toBe(4295128739n);
    expect(sqrtPriceAtTick(887272n)).toBe(1461446703485210103287273052203988822378723970342n);
    expect(() => sqrtPriceAtTick(887273n)).toThrow(RangeError);
  });

  it("matches PriceLib.t.sol: NVDAc/USDC slot0 on 2026-11-06 is $185.08", () => {
    const p = priceFromSqrt(58237376898234626810359736464n, false, 8, 6);
    expect(p >= 18507832337n && p <= 18507832339n).toBe(true);
  });

  it("matches PriceLib.t.sol when the stock is token0", () => {
    const p = priceFromSqrt(107703686134665736396608634880n, true, 8, 6);
    expect(Number(p) / 18480000000).toBeCloseTo(1, 3);
  });

  it("matches PriceLib.t.sol test_twapPrice: tick -6932 over 1800 s is about $200", () => {
    const p = twapPrice8([0n, -6932n * 1800n], 1800);
    expect(p).not.toBeNull();
    expect(Number(p) / 200e8).toBeCloseTo(1, 2);
  });

  it("rounds a negative average tick toward negative infinity, as the contract does", () => {
    expect(twapTick([0n, -7n], 2)).toBe(-4n); // -3.5 -> -4
    expect(twapTick([0n, -6n], 2)).toBe(-3n);
    expect(twapTick([0n, 7n], 2)).toBe(3n);
  });

  it("returns null for a missing window or a cut series", () => {
    expect(twapTick([0n], 1800)).toBeNull();
    expect(twapTick([0n, 1n], 0)).toBeNull();
    expect(twapPrice8([], 1800)).toBeNull();
  });

  it("computes the premium as the absolute gap over the oracle, rounded down", () => {
    expect(premiumBps(10_100n, 10_000n)).toBe(100n);
    expect(premiumBps(9_899n, 10_000n)).toBe(101n);
    expect(premiumBps(10_000n, 10_000n)).toBe(0n);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npm test -- test/live-price.test.ts`
Expected: FAIL (cannot resolve `@/lib/live/price`).

- [ ] **Step 3: Implement**

`web/lib/live/price.ts`:

```ts
import { B20_DECIMALS, USDC_DECIMALS } from "@/content/b20-nav";

/** Ports of contracts/src/lib/PriceLib.sol and v4-core TickMath.getSqrtPriceAtTick, in bigint. Prices are USD with 8 decimals. */

const MAX_TICK = 887272n;
const Q32 = 1n << 32n;
const MAX_UINT256 = (1n << 256n) - 1n;

// v4-core/src/libraries/TickMath.sol, the factor for each bit of |tick|.
const FACTORS: ReadonlyArray<readonly [bigint, bigint]> = [
  [0x2n, 0xfff97272373d413259a46990580e213an],
  [0x4n, 0xfff2e50f5f656932ef12357cf3c7fdccn],
  [0x8n, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
  [0x10n, 0xffcb9843d60f6159c9db58835c926644n],
  [0x20n, 0xff973b41fa98c081472e6896dfb254c0n],
  [0x40n, 0xff2ea16466c96a3843ec78b326b52861n],
  [0x80n, 0xfe5dee046a99a2a811c461f1969c3053n],
  [0x100n, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
  [0x200n, 0xf987a7253ac413176f2b074cf7815e54n],
  [0x400n, 0xf3392b0822b70005940c7a398e4b70f3n],
  [0x800n, 0xe7159475a2c29b7443b29c7fa6e889d9n],
  [0x1000n, 0xd097f3bdfd2022b8845ad8f792aa5825n],
  [0x2000n, 0xa9f746462d870fdf8a65dc1f90e061e5n],
  [0x4000n, 0x70d869a156d2a1b890bb3df62baf32f7n],
  [0x8000n, 0x31be135f97d08fd981231505542fcfa6n],
  [0x10000n, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
  [0x20000n, 0x5d6af8dedb81196699c329225ee604n],
  [0x40000n, 0x2216e584f5fa1ea926041bedfe98n],
  [0x80000n, 0x48a170391f7dc42444e8fa2n],
];

export function sqrtPriceAtTick(tick: bigint): bigint {
  const abs = tick < 0n ? -tick : tick;
  if (abs > MAX_TICK) throw new RangeError(`tick ${tick} is outside ±${MAX_TICK}`);
  let price = (abs & 0x1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 1n << 128n;
  for (const [bit, factor] of FACTORS) if ((abs & bit) !== 0n) price = (price * factor) >> 128n;
  if (tick > 0n) price = MAX_UINT256 / price;
  return (price + Q32 - 1n) >> 32n;
}

/** PriceLib.priceFromSqrt. */
export function priceFromSqrt(sqrtPriceX96: bigint, stockIsToken0: boolean, stockDecimals: number, quoteDecimals: number): bigint {
  const scale = 10n ** BigInt(stockDecimals + 8 - quoteDecimals);
  if (stockIsToken0) {
    const ratioX96 = (sqrtPriceX96 * sqrtPriceX96) >> 96n;
    return (ratioX96 * scale) >> 96n;
  }
  const inv = (1n << 192n) / sqrtPriceX96;
  return (inv * scale) / sqrtPriceX96;
}

/** The average tick of PriceLib.twapPrice: (now − then) / window, rounded toward negative infinity. */
export function twapTick(tickCumulatives: readonly bigint[], windowSec: number): bigint | null {
  const [then, now] = tickCumulatives;
  if (then === undefined || now === undefined || !Number.isInteger(windowSec) || windowSec <= 0) return null;
  const w = BigInt(windowSec);
  const delta = now - then;
  let tick = delta / w;
  if (delta < 0n && delta % w !== 0n) tick -= 1n;
  return tick;
}

/** PriceLib.twapPrice for the 13 pools of content/b20-nav.ts: the stock is token1, 8 decimals against USDC's 6. */
export function twapPrice8(tickCumulatives: readonly bigint[], windowSec: number): bigint | null {
  const tick = twapTick(tickCumulatives, windowSec);
  if (tick === null) return null;
  try {
    const p = priceFromSqrt(sqrtPriceAtTick(tick), false, B20_DECIMALS, USDC_DECIMALS);
    return p === 0n ? null : p;
  } catch {
    return null;
  }
}

/** PriceLib.premiumBps. */
export function premiumBps(dex: bigint, oracle: bigint): bigint {
  const diff = dex > oracle ? dex - oracle : oracle - dex;
  return (diff * 10_000n) / oracle;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd web && npm test -- test/live-price.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- web/lib/live/price.ts web/test/live-price.test.ts
git commit -F <msg-file>   # feat(web): port PriceLib's TWAP price and premium for the live reader
```

---

### Task 3: RPC reader and snapshot

**Files:**
- Create: `web/lib/live/rpc.ts`, `web/lib/live/snapshot.ts`
- Test: `web/test/live-rpc.test.ts`, `web/test/live-snapshot.test.ts`

**Interfaces:**
- Consumes: Task 1 (`NAV_TOKENS`, `MULTICALL3`, `SELECTORS`, `encodeCall`, `encodeObserve`, `encodeAggregate3`, `decodeAggregate3`, decoders, `encodeAggregate3Result`), Task 2 (`twapPrice8`).
- Produces:
  - `LIVE_RPCS: readonly string[]` = `["https://base-rpc.publicnode.com", "https://mainnet.base.org"]`
  - `interface LiveReader { call(tx: { to: Hex; data: Hex }, block: "latest" | bigint): Promise<{ data: Hex; endpoint: string }> }`
  - `class RpcError extends Error { failures: readonly { endpoint: string; message: string }[] }`
  - `createReader(opts?: { urls?: readonly string[]; fetch?: typeof fetch; timeoutMs?: number }): LiveReader`
  - `interface TokenReading { symbol: string; paused: boolean | null; uiMultiplier: bigint | null; effectiveAt: bigint | null; feed: { answer: bigint; updatedAt: bigint } | null; twap8: bigint | null }`
  - `type CalendarReading = { source: "repo" } | { source: "onchain"; address: Hex; open: boolean | null }`
  - `interface LiveSnapshot { block: bigint; timestamp: number; endpoint: string; calendar: CalendarReading; tokens: TokenReading[] }`
  - `buildCalls(twapWindowSec: number): Call3[]`, `decodeSnapshot(results: CallResult[], twapWindowSec: number): { block: bigint; timestamp: number; tokens: TokenReading[] }`
  - `readSnapshot(reader: LiveReader, opts?: { twapWindowSec?: number; calendar?: Hex | null }): Promise<LiveSnapshot>`; `calendarAddress(): Hex | null` reads the Base mainnet `MarketCalendar` row of `content/generated/deployments.json` (empty address → null)

- [ ] **Step 1: Write the failing reader test**

`web/test/live-rpc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createReader, LIVE_RPCS, RpcError } from "@/lib/live/rpc";

const ok = (result: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
const rpcError = (message: string) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32011, message } }), { status: 200 });

describe("the keyless live reader", () => {
  it("tries the keyless endpoints in order, publicnode first", () => {
    expect(LIVE_RPCS).toEqual(["https://base-rpc.publicnode.com", "https://mainnet.base.org"]);
  });

  it("sends one eth_call and returns the data with the endpoint that answered", async () => {
    const f = vi.fn(async () => ok("0xabcd"));
    const reader = createReader({ fetch: f as unknown as typeof fetch });
    await expect(reader.call({ to: "0x01", data: "0x02" }, "latest")).resolves.toEqual({ data: "0xabcd", endpoint: LIVE_RPCS[0] });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(LIVE_RPCS[0]);
    expect(JSON.parse(String(init.body))).toMatchObject({ method: "eth_call", params: [{ to: "0x01", data: "0x02" }, "latest"] });
  });

  it("sends a block number as a hex tag", async () => {
    const f = vi.fn(async () => ok("0x"));
    await createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, 60_013_066n);
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).params[1]).toBe("0x393b40a");
  });

  it("falls back on a JSON-RPC error body", async () => {
    const f = vi.fn().mockResolvedValueOnce(rpcError("request limit reached")).mockResolvedValueOnce(ok("0x11"));
    const r = await createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, "latest");
    expect(r).toEqual({ data: "0x11", endpoint: LIVE_RPCS[1] });
  });

  it("falls back on HTTP errors and network failures, then reports every failure", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockRejectedValueOnce(new TypeError("fetch failed"));
    const p = createReader({ fetch: f as unknown as typeof fetch }).call({ to: "0x01", data: "0x02" }, "latest");
    await expect(p).rejects.toBeInstanceOf(RpcError);
    await p.catch((e: RpcError) => {
      expect(e.failures.map((x) => x.endpoint)).toEqual([...LIVE_RPCS]);
      expect(e.failures[0]?.message).toContain("503");
      expect(e.failures[1]?.message).toContain("fetch failed");
    });
  });

  it("gives up on an endpoint after the timeout", async () => {
    vi.useFakeTimers();
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const p = createReader({ fetch: f as unknown as typeof fetch, timeoutMs: 8000, urls: ["https://a.example"] }).call({ to: "0x01", data: "0x02" }, "latest");
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await caught).toBeInstanceOf(RpcError);
    vi.useRealTimers();
  });

  it("rejects a result that is not hex", async () => {
    const f = vi.fn(async () => ok("nope"));
    await expect(createReader({ fetch: f as unknown as typeof fetch, urls: ["https://a.example"] }).call({ to: "0x01", data: "0x02" }, "latest")).rejects.toBeInstanceOf(RpcError);
  });
});
```

- [ ] **Step 2: Implement the reader**

`web/lib/live/rpc.ts`:

```ts
import type { Hex } from "@/content/b20-nav";

/**
 * Keyless Base RPCs the browser calls, in order: the same list as the W2 ledger. base-rpc.publicnode.com answers with
 * CORS open; mainnet.base.org rate-limits hard, so it is the fallback. No environment variable is read here: nothing
 * private can reach the browser bundle.
 */
export const LIVE_RPCS: readonly string[] = ["https://base-rpc.publicnode.com", "https://mainnet.base.org"];

export interface LiveReader {
  call(tx: { to: Hex; data: Hex }, block: "latest" | bigint): Promise<{ data: Hex; endpoint: string }>;
}

export class RpcError extends Error {
  constructor(readonly failures: readonly { endpoint: string; message: string }[]) {
    super(failures.map((f) => `${f.endpoint}: ${f.message}`).join("; "));
    this.name = "RpcError";
  }
}

const HEX = /^0x[0-9a-fA-F]*$/;

export function createReader(opts: { urls?: readonly string[]; fetch?: typeof fetch; timeoutMs?: number } = {}): LiveReader {
  const urls = opts.urls ?? LIVE_RPCS;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const timeoutMs = opts.timeoutMs ?? 8000;
  let id = 0;
  return {
    async call(tx, block) {
      const tag = block === "latest" ? "latest" : `0x${block.toString(16)}`;
      const body = JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "eth_call", params: [{ to: tx.to, data: tx.data }, tag] });
      const failures: { endpoint: string; message: string }[] = [];
      for (const endpoint of urls) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        try {
          const res = await doFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, signal: ctl.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
          if (json.error) throw new Error(json.error.message ?? "JSON-RPC error");
          if (typeof json.result !== "string" || !HEX.test(json.result)) throw new Error("the result is not hex");
          return { data: json.result as Hex, endpoint };
        } catch (e) {
          failures.push({ endpoint, message: ctl.signal.aborted ? `no answer in ${timeoutMs / 1000} s` : e instanceof Error ? e.message : String(e) });
        } finally {
          clearTimeout(timer);
        }
      }
      throw new RpcError(failures);
    },
  };
}
```

- [ ] **Step 3: Write the failing snapshot test**

`web/test/live-snapshot.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MULTICALL3, NAV_TOKENS } from "@/content/b20-nav";
import { decodeAggregate3, encodeAggregate3, encodeAggregate3Result, encodeCall, SELECTORS, word } from "@/lib/live/abi";
import type { LiveReader } from "@/lib/live/rpc";
import { buildCalls, calendarAddress, decodeSnapshot, readSnapshot } from "@/lib/live/snapshot";
import fixture from "./fixtures/live-aggregate3.json";

const recorded = (): LiveReader => ({ call: vi.fn(async () => ({ data: fixture.response as `0x${string}`, endpoint: "https://base-rpc.publicnode.com" })) });

describe("one reading of Base", () => {
  it("builds the recorded request: block, timestamp, then five calls per token", () => {
    expect(encodeAggregate3(buildCalls(fixture.twapWindowSec)).toLowerCase()).toBe(fixture.request.toLowerCase());
  });

  it("decodes the recorded block, timestamp and every token", () => {
    const s = decodeSnapshot(decodeAggregate3(fixture.response as `0x${string}`), fixture.twapWindowSec);
    expect(s.block).toBe(BigInt(fixture.expected.blockNumber));
    expect(s.timestamp).toBe(Number(fixture.expected.timestamp));
    expect(s.tokens.map((t) => t.symbol)).toEqual(NAV_TOKENS.map((t) => t.symbol));
    const sndk = s.tokens.find((t) => t.symbol === "SNDKc");
    expect(sndk?.uiMultiplier).toBe(8_000_000_000_000_000_000n);
    expect(sndk?.effectiveAt).toBe(1_795_150_800n);
    for (const t of s.tokens) {
      expect(t.paused).toBe(false);
      expect(t.feed?.answer).toBeGreaterThan(0n);
      expect(t.twap8).toBeGreaterThan(0n);
    }
  });

  it("keeps a failed sub-call as null instead of dropping the token", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    results[2 + 3] = { success: false, returnData: "0x" }; // AAPLc latestRoundData
    results[2 + 4] = { success: true, returnData: "0x" }; // AAPLc observe, no data
    const s = decodeSnapshot(results, fixture.twapWindowSec);
    expect(s.tokens[0]?.feed).toBeNull();
    expect(s.tokens[0]?.twap8).toBeNull();
  });

  it("refuses a reading without a block number or timestamp", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    results[0] = { success: false, returnData: "0x" };
    expect(() => decodeSnapshot(results, fixture.twapWindowSec)).toThrow(/block/);
  });

  it("refuses a reading with the wrong number of results", () => {
    expect(() => decodeSnapshot([], fixture.twapWindowSec)).toThrow(/results/);
  });

  it("reads the repo calendar until MarketCalendar is in the deployments table", async () => {
    expect(calendarAddress()).toBeNull();
    const s = await readSnapshot(recorded(), { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(s.calendar).toEqual({ source: "repo" });
    expect(s.endpoint).toBe("https://base-rpc.publicnode.com");
  });

  it("asks a deployed MarketCalendar at the same block", async () => {
    const cal = "0x00000000000000000000000000000000000000ca" as const;
    const call = vi.fn()
      .mockResolvedValueOnce({ data: fixture.response, endpoint: "https://base-rpc.publicnode.com" })
      .mockResolvedValueOnce({ data: `0x${word(0n)}`, endpoint: "https://base-rpc.publicnode.com" });
    const s = await readSnapshot({ call }, { twapWindowSec: fixture.twapWindowSec, calendar: cal });
    expect(s.calendar).toEqual({ source: "onchain", address: cal, open: false });
    expect(call.mock.calls[1]).toEqual([{ to: cal, data: encodeCall(SELECTORS.isOpen, BigInt(fixture.expected.timestamp), 0n) }, BigInt(fixture.expected.blockNumber)]);
  });

  it("sends its multicall to Multicall3 at latest", async () => {
    const reader = recorded();
    await readSnapshot(reader, { twapWindowSec: fixture.twapWindowSec, calendar: null });
    expect(reader.call).toHaveBeenCalledWith({ to: MULTICALL3, data: encodeAggregate3(buildCalls(fixture.twapWindowSec)) }, "latest");
  });

  it("decodes a synthetic answer built with the result encoder", () => {
    const results = decodeAggregate3(fixture.response as `0x${string}`);
    const again = decodeAggregate3(encodeAggregate3Result(results));
    expect(decodeSnapshot(again, fixture.twapWindowSec).block).toBe(BigInt(fixture.expected.blockNumber));
  });
});
```

- [ ] **Step 4: Implement the snapshot**

`web/lib/live/snapshot.ts`:

```ts
import { type Hex, MULTICALL3, NAV_TOKENS } from "@/content/b20-nav";
import { FACTS } from "@/content/facts";
import deployments from "@/content/generated/deployments.json";
import {
  type Call3, type CallResult, decodeAggregate3, decodeBool, decodeObserve, decodeRoundData, decodeUint,
  encodeAggregate3, encodeCall, encodeObserve, SELECTORS,
} from "./abi";
import { twapPrice8 } from "./price";
import type { LiveReader } from "./rpc";

export interface TokenReading {
  symbol: string;
  /** isPaused(0), the transfer feature; null when the call failed. */
  paused: boolean | null;
  uiMultiplier: bigint | null;
  effectiveAt: bigint | null;
  feed: { answer: bigint; updatedAt: bigint } | null;
  /** The pool's TWAP over the mandate window, USD with 8 decimals; null when observe failed or gave no price. */
  twap8: bigint | null;
}

export type CalendarReading = { source: "repo" } | { source: "onchain"; address: Hex; open: boolean | null };

export interface LiveSnapshot {
  block: bigint;
  /** The block's timestamp, seconds. */
  timestamp: number;
  /** The RPC that answered the multicall. */
  endpoint: string;
  calendar: CalendarReading;
  tokens: TokenReading[];
}

const PER_TOKEN = 5;
const REGULAR = 0n; // enum SessionMode in contracts/src/Types.sol

export function buildCalls(twapWindowSec: number): Call3[] {
  const calls: Call3[] = [
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getBlockNumber) },
    { target: MULTICALL3, allowFailure: true, callData: encodeCall(SELECTORS.getCurrentBlockTimestamp) },
  ];
  for (const t of NAV_TOKENS) {
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.isPaused, 0n) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.uiMultiplier) });
    calls.push({ target: t.token, allowFailure: true, callData: encodeCall(SELECTORS.effectiveAt) });
    calls.push({ target: t.feed, allowFailure: true, callData: encodeCall(SELECTORS.latestRoundData) });
    calls.push({ target: t.pool, allowFailure: true, callData: encodeObserve([twapWindowSec, 0]) });
  }
  return calls;
}

export function decodeSnapshot(results: CallResult[], twapWindowSec: number): { block: bigint; timestamp: number; tokens: TokenReading[] } {
  if (results.length !== 2 + PER_TOKEN * NAV_TOKENS.length) throw new Error(`expected ${2 + PER_TOKEN * NAV_TOKENS.length} results, got ${results.length}`);
  const block = decodeUint(results[0]!);
  const timestamp = decodeUint(results[1]!);
  if (block === null || timestamp === null) throw new Error("the multicall gave no block number or timestamp");
  const tokens = NAV_TOKENS.map((t, i): TokenReading => {
    const r = results.slice(2 + i * PER_TOKEN, 2 + (i + 1) * PER_TOKEN);
    const obs = decodeObserve(r[4]!);
    return {
      symbol: t.symbol,
      paused: decodeBool(r[0]!),
      uiMultiplier: decodeUint(r[1]!),
      effectiveAt: decodeUint(r[2]!),
      feed: decodeRoundData(r[3]!),
      twap8: obs === null ? null : twapPrice8(obs.tickCumulatives, twapWindowSec),
    };
  });
  return { block, timestamp: Number(timestamp), tokens };
}

/** The Base mainnet MarketCalendar of deployments/README.md, or null while its address cell is empty. */
export function calendarAddress(rows: readonly { network: string; contract: string; address: string }[] = deployments): Hex | null {
  const a = rows.find((r) => r.network === "Base mainnet" && r.contract === "MarketCalendar")?.address.trim() ?? "";
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Hex) : null;
}

export async function readSnapshot(reader: LiveReader, opts: { twapWindowSec?: number; calendar?: Hex | null } = {}): Promise<LiveSnapshot> {
  const window = opts.twapWindowSec ?? FACTS.mandate.value.twapWindowSec;
  const calendar = opts.calendar === undefined ? calendarAddress() : opts.calendar;
  const { data, endpoint } = await reader.call({ to: MULTICALL3, data: encodeAggregate3(buildCalls(window)) }, "latest");
  const s = decodeSnapshot(decodeAggregate3(data), window);
  if (calendar === null) return { ...s, endpoint, calendar: { source: "repo" } };
  const open = await reader.call({ to: calendar, data: encodeCall(SELECTORS.isOpen, BigInt(s.timestamp), REGULAR) }, s.block);
  return { ...s, endpoint, calendar: { source: "onchain", address: calendar, open: decodeBool({ success: true, returnData: open.data }) } };
}
```

- [ ] **Step 5: Run both tests**

Run: `cd web && npm test -- test/live-rpc.test.ts test/live-snapshot.test.ts && npm run typecheck`
Expected: PASS. (`deployments.json` rows have more fields; the parameter type takes a structural subset.)

- [ ] **Step 6: Commit**

```bash
git add -- web/lib/live/rpc.ts web/lib/live/snapshot.ts web/test/live-rpc.test.ts web/test/live-snapshot.test.ts
git commit -F <msg-file>   # feat(web): read the 13 B20s in one keyless multicall at one block
```

---

### Task 4: The verdict

**Files:**
- Create: `web/lib/live/verdict.ts`
- Test: `web/test/live-verdict.test.ts`

**Interfaces:**
- Consumes: `TokenReading`, `LiveSnapshot` (Task 3); `premiumBps` (Task 2); `regularSession`, `localTime`, `WEEKDAY_NAMES` (`content/calendar.ts`); `clockLabel` (`content/format.ts`); `FACTS`, `CHECK_LABELS` (`content/engine.ts`), `REASON_LABEL`, `reasonText`, `type ReasonCode`, `type RefusalCode`.
- Produces:
  - `interface Limits { maxStalenessSec: number; maxPremiumBps: number; multiplierCooldownSec: number }`, `DEFAULT_LIMITS: Limits` (from `FACTS.mandate.value`)
  - `interface Session { open: boolean; source: "repo" | "onchain"; detail: string }` — detail like "Saturday · NYSE closed", "Friday · open until 16:00 ET", "19:05 ET · closed at 16:00", "Thanksgiving · NYSE closed", "17:58 ET · early close 13:00"
  - `sessionAt(snapshot: Pick<LiveSnapshot, "timestamp" | "calendar">): Session`
  - `type Mark = "PASS" | "FAIL" | "SKIP" | "NOT_RUN"`; `interface LiveCheck { n: number; label: string; mark: Mark; detail: string }`
  - `interface TokenVerdict { symbol: string; inBasket: boolean; mandate: ReasonCode; market: ReasonCode; checks: LiveCheck[]; feedAgeSec: number | null; premiumBps: bigint | null }`
  - `judgeToken(r: TokenReading, ctx: { timestamp: number; session: Session; limits?: Limits }): TokenVerdict`
  - `type Headline = { kind: "refuse-all"; reason: RefusalCode } | { kind: "mixed"; refused: { symbol: string; reason: RefusalCode }[]; passed: string[] } | { kind: "pass-all"; passed: string[] }`
  - `headline(verdicts: readonly TokenVerdict[]): Headline` (over basket tokens only, basket order)
  - `headlineText(h: Headline): string` (plain text, for aria and titles)

Rules (spec section 4, contract order, first failure stops; later checks are `SKIP` with "not reached"):

1. Token allowed: `FACTS.basket` contains the symbol, else `TOKEN_NOT_ALLOWED`. Only for `mandate`; `market` starts at 2.
2. Token not paused: `paused === false` passes; `true` or `null` → `TOKEN_PAUSED` ("paused" / "could not read").
3. Vault policy: always `NOT_RUN`, detail "needs a deployed vault"; never fails.
4. Market session: `session.open` else `MARKET_CLOSED`; detail = `session.detail`.
5. Feed: `feed === null`, `answer <= 0n`, `updatedAt === 0n` or `updatedAt > timestamp` → `BAD_PRICE`; else age = `timestamp − updatedAt`; age > `maxStalenessSec` → `FEED_STALE`. Detail "`{age}`s ≤ `{max}`s".
6. Multiplier: `uiMultiplier === null` or `effectiveAt === null` → `MULTIPLIER_COOLDOWN` ("could not read"); `effectiveAt > timestamp` → fail ("change scheduled"); `effectiveAt !== 0n && timestamp < effectiveAt + cooldown` → fail ("changed `{h}` h ago, cooldown `{c}` h"); else pass ("no change in `{c}` h").
7. Premium: `twap8 === null` → `BAD_PRICE` ("pool TWAP unreadable"); premium = `premiumBps(twap8, answer)`; > `maxPremiumBps` → `PREMIUM_TOO_HIGH`. Detail "`{p}` ≤ `{max}` bps".
8, 9: `NOT_RUN`, detail "needs a vault's balances".

`feedAgeSec` and `premiumBps` are filled whenever the inputs were readable, even if an earlier check failed (the table shows them); they never come from a failed read.

- [ ] **Step 1: Write the failing test**

`web/test/live-verdict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FACTS } from "@/content/facts";
import type { TokenReading } from "@/lib/live/snapshot";
import { DEFAULT_LIMITS, headline, headlineText, judgeToken, sessionAt, type Session } from "@/lib/live/verdict";

const SAT = Date.UTC(2026, 10, 21, 15, 0) / 1000; // Sat 2026-11-21 10:00 ET
const FRI = Date.UTC(2026, 10, 20, 16, 43) / 1000; // Fri 2026-11-20 11:43 ET, in session
const open: Session = { open: true, source: "repo", detail: "Friday · open until 16:00 ET" };
const closed: Session = { open: false, source: "repo", detail: "Saturday · NYSE closed" };
const m = FACTS.mandate.value;

function reading(over: Partial<TokenReading> = {}): TokenReading {
  return {
    symbol: "NVDAc",
    paused: false,
    uiMultiplier: 1_000_537_939_576_369_481n,
    effectiveAt: 0n,
    feed: { answer: 13_607_516_085n, updatedAt: BigInt(FRI - 102) },
    twap8: 13_607_516_085n + 13_607_516_085n / 400n, // 25 bps over
    ...over,
  };
}

describe("what an agent under the default mandate would do", () => {
  it("passes the market checks in session with a fresh feed and a small premium", () => {
    const v = judgeToken(reading(), { timestamp: FRI, session: open });
    expect(v.mandate).toBe("OK");
    expect(v.market).toBe("OK");
    expect(v.feedAgeSec).toBe(102);
    expect(v.premiumBps).toBe(25n);
    expect(v.checks.map((c) => c.mark)).toEqual(["PASS", "PASS", "NOT_RUN", "PASS", "PASS", "PASS", "PASS", "NOT_RUN", "NOT_RUN"]);
  });

  it("refuses MARKET_CLOSED on a weekend before reading the feed", () => {
    const v = judgeToken(reading({ feed: { answer: 1n, updatedAt: BigInt(SAT - 50 * 3600) } }), { timestamp: SAT, session: closed });
    expect(v.mandate).toBe("MARKET_CLOSED");
    expect(v.checks[4]?.mark).toBe("SKIP");
  });

  it("refuses a token outside the basket first, and still says what the market says", () => {
    const v = judgeToken(reading({ symbol: "ANTc" }), { timestamp: FRI, session: open });
    expect(v.inBasket).toBe(false);
    expect(v.mandate).toBe("TOKEN_NOT_ALLOWED");
    expect(v.market).toBe("OK");
  });

  it("refuses a paused token, and a pause flag it could not read", () => {
    expect(judgeToken(reading({ paused: true }), { timestamp: FRI, session: open }).mandate).toBe("TOKEN_PAUSED");
    expect(judgeToken(reading({ paused: null }), { timestamp: FRI, session: open }).mandate).toBe("TOKEN_PAUSED");
  });

  it("refuses FEED_STALE past maxStalenessSec, and passes at exactly the limit", () => {
    const at = (age: number) => judgeToken(reading({ feed: { answer: 1n, updatedAt: BigInt(FRI - age) }, twap8: 1n }), { timestamp: FRI, session: open });
    expect(at(m.maxStalenessSec).market).toBe("OK");
    expect(at(m.maxStalenessSec + 1).market).toBe("FEED_STALE");
  });

  it("future updatedAt is BAD_PRICE, and so are zero, negative and missing answers", () => {
    for (const feed of [{ answer: 1n, updatedAt: BigInt(FRI + 1) }, { answer: 0n, updatedAt: BigInt(FRI) }, { answer: -5n, updatedAt: BigInt(FRI) }, { answer: 1n, updatedAt: 0n }, null]) {
      const v = judgeToken(reading({ feed }), { timestamp: FRI, session: open });
      expect(v.market).toBe("BAD_PRICE");
      expect(v.feedAgeSec).toBeNull();
    }
  });

  it("refuses MULTIPLIER_COOLDOWN within the cooldown after effectiveAt, and for a scheduled change", () => {
    const eff = BigInt(FRI - 11 * 3600);
    expect(judgeToken(reading({ effectiveAt: eff }), { timestamp: FRI, session: open }).market).toBe("MULTIPLIER_COOLDOWN");
    expect(judgeToken(reading({ effectiveAt: BigInt(FRI + 60) }), { timestamp: FRI, session: open }).market).toBe("MULTIPLIER_COOLDOWN");
    expect(judgeToken(reading({ effectiveAt: BigInt(FRI - m.multiplierCooldownSec) }), { timestamp: FRI, session: open }).market).toBe("OK");
    expect(judgeToken(reading({ uiMultiplier: null }), { timestamp: FRI, session: open }).market).toBe("MULTIPLIER_COOLDOWN");
  });

  it("refuses PREMIUM_TOO_HIGH above maxPremiumBps, and BAD_PRICE without a TWAP", () => {
    const a = 10_000_000_000n;
    const over = a + (a * BigInt(m.maxPremiumBps + 1)) / 10_000n;
    const v = judgeToken(reading({ feed: { answer: a, updatedAt: BigInt(FRI) }, twap8: over }), { timestamp: FRI, session: open });
    expect(v.market).toBe("PREMIUM_TOO_HIGH");
    expect(judgeToken(reading({ twap8: null }), { timestamp: FRI, session: open }).market).toBe("BAD_PRICE");
  });

  it("reads its limits from FACTS.mandate", () => {
    expect(DEFAULT_LIMITS).toEqual({ maxStalenessSec: m.maxStalenessSec, maxPremiumBps: m.maxPremiumBps, multiplierCooldownSec: m.multiplierCooldownSec });
  });
});

describe("the session at the block", () => {
  it("uses the repo calendar until MarketCalendar is deployed", () => {
    expect(sessionAt({ timestamp: SAT, calendar: { source: "repo" } })).toEqual({ open: false, source: "repo", detail: "Saturday · NYSE closed" });
    expect(sessionAt({ timestamp: FRI, calendar: { source: "repo" } })).toMatchObject({ open: true, detail: "Friday · open until 16:00 ET" });
  });

  it("follows a deployed calendar, and counts a failed read as closed", () => {
    expect(sessionAt({ timestamp: FRI, calendar: { source: "onchain", address: "0x00000000000000000000000000000000000000ca", open: false } }).open).toBe(false);
    expect(sessionAt({ timestamp: FRI, calendar: { source: "onchain", address: "0x00000000000000000000000000000000000000ca", open: null } }).open).toBe(false);
  });
});

describe("the headline", () => {
  const basket = (reasons: Record<string, "OK" | "MARKET_CLOSED" | "PREMIUM_TOO_HIGH">) =>
    FACTS.basket.value.map((symbol) => ({ symbol, inBasket: true, mandate: reasons[symbol] ?? "OK", market: reasons[symbol] ?? "OK", checks: [], feedAgeSec: null, premiumBps: null }));

  it("says REFUSE with the plain label when the basket shares one refusal", () => {
    const h = headline(basket({ NVDAc: "MARKET_CLOSED", GOOGLc: "MARKET_CLOSED", AAPLc: "MARKET_CLOSED" }));
    expect(h).toEqual({ kind: "refuse-all", reason: "MARKET_CLOSED" });
    expect(headlineText(h)).toBe("An agent under Maat's default mandate would REFUSE: Market closed (MARKET_CLOSED)");
  });

  it("names each refused token when the results differ", () => {
    const h = headline(basket({ AAPLc: "PREMIUM_TOO_HIGH" }));
    expect(headlineText(h)).toBe("An agent under Maat's default mandate would REFUSE AAPLc: Pool price too far from oracle (PREMIUM_TOO_HIGH). Market checks pass for NVDAc and GOOGLc.");
  });

  it("never says safe when nothing is refused", () => {
    const text = headlineText(headline(basket({})));
    expect(text).toBe("An agent under Maat's default mandate would pass the market checks for NVDAc, GOOGLc and AAPLc. The vault's own checks are not run here.");
    expect(text.toLowerCase()).not.toContain("safe");
  });

  it("ignores tokens outside the basket", () => {
    const all = [...basket({}), { symbol: "ANTc", inBasket: false, mandate: "TOKEN_NOT_ALLOWED" as const, market: "PREMIUM_TOO_HIGH" as const, checks: [], feedAgeSec: null, premiumBps: null }];
    expect(headline(all).kind).toBe("pass-all");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npm test -- test/live-verdict.test.ts`
Expected: FAIL (cannot resolve `@/lib/live/verdict`).

- [ ] **Step 3: Implement `web/lib/live/verdict.ts`**

Write it to the rules above. Required details:
- `sessionAt`: `regularSession(timestamp)` from `content/calendar.ts` gives `open` and the reason; build `detail` like the simulator's private `sessionDetail` (`content/simulator.ts:117-134`): open → "`{Weekday}` · open until `{HH:MM}` ET"; weekend → "`{Weekday}` · NYSE closed"; holiday → "`{name}` · NYSE closed"; before-open → "`{HH:MM}` ET · opens `{HH:MM}`"; after-close → "`{HH:MM}` ET · closed at `{HH:MM}`" or "· early close `{HH:MM}`" when the close is before `FACTS.nyseSessionMin.value.close`. With `calendar.source === "onchain"`, `open = calendar.open === true` and `source: "onchain"`; the detail still comes from the repo calendar's wording.
- `judgeToken` builds all nine rows with labels from `CHECK_LABELS` (`content/engine.ts`) and `n` 1-9; `mandate` runs from check 1, `market` from check 2; the `checks` array describes the `mandate` run, except for tokens outside the basket where row 1 is `FAIL` and rows 2-7 show the `market` run's marks (so the table can show both). Keep it a pure function.
- `headline`: filter `inBasket`, keep basket order (`FACTS.basket.value`). All refused with one reason → `refuse-all`; none refused → `pass-all`; else `mixed`.
- `headlineText`: exactly the three sentences pinned by the tests, with `reasonText` for the reason and `andList` (`content/format.ts`) for lists. For `mixed` with several refused tokens join the clauses with "; " ("would REFUSE AAPLc: … (…); GOOGLc: … (…)."); with none passed, drop the "Market checks pass" sentence.

- [ ] **Step 4: Run it to see it pass**

Run: `cd web && npm test -- test/live-verdict.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- web/lib/live/verdict.ts web/test/live-verdict.test.ts
git commit -F <msg-file>   # feat(web): judge each B20 as MandateVault would for a BUY, check by check
```

---

### Task 5: Freshness, the hook, and the strip on the landing

**Files:**
- Create: `web/lib/live/freshness.ts`, `web/lib/live/format.ts`, `web/components/live/useLiveSnapshot.ts`, `web/components/live/VerdictLine.tsx`, `web/components/live/LiveStrip.tsx`
- Modify: `web/components/sections/Hero.tsx` (mount `<LiveStrip />` directly after the `<h1>`), `web/lib/check-out.ts` (landing rule below)
- Test: `web/test/live-freshness.test.ts`, `web/test/live-strip.test.tsx`, `web/test/check-out.test.ts` (one case)

**Interfaces:**
- Consumes: `LiveReader`, `createReader`, `RpcError` (Task 3), `readSnapshot`, `LiveSnapshot` (Task 3), `judgeToken`, `sessionAt`, `headline`, `headlineText`, `Headline`, `TokenVerdict` (Task 4), `ReasonTag`.
- Produces:
  - `LIVE_MAX_AGE_MS = 90_000`, `HEAD_MAX_LAG_SEC = 120`, `REFRESH_MS = 30_000`
  - `type LiveState = { status: "reading" } | { status: "error"; message: string } | { status: "live" | "stale" | "behind"; reading: Reading; ageMs: number; lagSec: number; refreshFailed: boolean }` where `interface Reading { snapshot: LiveSnapshot; verdicts: TokenVerdict[]; headline: Headline; session: Session; readAtMs: number }`
  - `classify(last: Reading | undefined, lastAttemptFailed: boolean, nowMs: number, wallSec: number, lastError?: string): LiveState` (order: no reading → reading/error; refresh failed → stale; lag > 120 → behind; age > 90 s → stale; else live)
  - `useLiveSnapshot(opts?: { reader?: LiveReader; refreshMs?: number; nowMs?: () => number; wallSec?: () => number }): { state: LiveState; refresh: () => void; endpoints: readonly string[] }` — `nowMs` defaults to `performance.now()`, `wallSec` to `Date.now() / 1000`
  - `format.ts`: `formatBlock(n: bigint): string` ("60,013,066"), `formatAge(sec: number): string` ("14 s", "3 min 4 s", "2 h 5 min", "2 d 3 h"), `formatUsd8(v: bigint): string` ("$136.08"), `formatMultiplier(wad: bigint): string` ("1.000538", "8"), `formatUtc(sec: number): string` ("16:43:08 UTC"), `formatEt(sec: number): string` ("11:43 ET", via `localTime`), `formatDateUtc(sec: number): string` ("2026-11-20 05:00 UTC")
  - `<VerdictLine headline={h} tone="ink" | "muted" />` renders the headline with `ReasonTag` (`tone="neutral"`, `layout="inline"`), and `aria-label={headlineText(h)}` on the wrapper only if needed for screen readers to read it as one sentence
  - `<LiveStrip reader? />`

Behavior:
- The hook does nothing during server render. After mount it reads once; then every `REFRESH_MS` while `document.visibilityState === "visible"`; on `visibilitychange` to visible it reads at once if the last attempt is older than `REFRESH_MS`. It never runs two reads at once. It re-classifies every 5 s so the age and stale state move without a new read. A failed read keeps the last good reading (marked by `classify`).
- The strip reserves its height (`min-h-[3.25rem]` at phone width, one line from `sm`), so the landing does not shift. In the static HTML it shows "Reading Base mainnet…" plus `<noscript>`: "The live line needs JavaScript. Right now on Base explains what it reads." with a link to `/now`.
- Live: a pill "LIVE" (accent, with a dot; the dot is `aria-hidden`), "Base block {n}" linking `https://basescan.org/block/{n}` (`target="_blank" rel="noopener noreferrer"`), the block time "{UTC} · {ET}", the session detail, the `VerdictLine`, and "All 13 B20s →" linking `/now`.
- Stale / behind: a pill "NOT LIVE" (ink-2 border), then "last read block {n}, {age} ago" (stale) or "the RPC's latest block {n} is {lag} behind your clock" (behind), then the verdict in muted text. No LIVE pill anywhere.
- Error: "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data." and a "Retry" button calling `refresh`.
- The whole strip is one `role="status"` `aria-live="polite"` region that does not remount.
- `check-out` landing rule: in `checkExport`, require the HTML to contain the strip's static text "Reading Base mainnet" and to contain no "LIVE" pill text (`>LIVE<`) and no `basescan.org/block/`. Add the matching case to `test/check-out.test.ts`.

- [ ] **Step 1: Write the failing freshness test**

`web/test/live-freshness.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Implement `freshness.ts` and `format.ts`, run the test to pass**

Run: `cd web && npm test -- test/live-freshness.test.ts`
Expected: PASS. Add `format.ts` cases to the same commit with a small `test/live-format.test.ts` covering each example string listed under Interfaces.

- [ ] **Step 3: Write the failing strip test**

`web/test/live-strip.test.tsx` — render `<LiveStrip reader={fake} />` with a fake reader whose `call` resolves from `test/fixtures/live-aggregate3.json` (rewrite the timestamp word for the weekend case by building results with `encodeAggregate3Result` and replacing result 1 with `word(BigInt(SAT))`), `vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "Date", "performance"] })`, and `vi.setSystemTime` near the block time. Cases:
- the static render (`renderToString`) holds "Reading Base mainnet" and no block number;
- weekend reading → text "LIVE", "Base block 60,013,066" linking `https://basescan.org/block/60013066`, "Saturday · NYSE closed", "An agent under Maat's default mandate would REFUSE", "Market closed", "MARKET_CLOSED", a link "All 13 B20s" to `/now`;
- the recorded in-session reading (Fri 11:43 ET) → "would pass the market checks for NVDAc, GOOGLc and AAPLc" (the fixture's basket premiums are under 100 bps; compute from FACTS in the test rather than assuming);
- a refresh that rejects after a good reading → "NOT LIVE", "last read block", and no "LIVE" pill (query by exact text `"LIVE"`);
- a first read that rejects → the error sentence and a Retry button; clicking Retry with a reader that now resolves → "LIVE";
- after `LIVE_MAX_AGE_MS` with reads failing → "NOT LIVE";
- `document.body.textContent` never contains "safe" (case-insensitive) in any of these states.

- [ ] **Step 4: Implement the hook, `VerdictLine`, `LiveStrip`; mount it in `Hero.tsx` right after the `<h1>`; run**

Run: `cd web && npm test -- test/live-strip.test.tsx test/page.test.tsx test/top.test.tsx && npm run typecheck`
Expected: PASS. `page.test.tsx` and `top.test.tsx` render the landing: they must still pass (the strip renders its reading state there; if a test counts links or headings, the strip adds two links and no heading — update the count only if the test pins a total, and say so in the commit message).

- [ ] **Step 5: Add the export rule and run the build check**

Run: `cd web && npm test -- test/check-out.test.ts && npm run build && npm run check:out`
Expected: PASS; `check:out` prints its ready line.

- [ ] **Step 6: Commit**

```bash
git add -- web/lib/live/freshness.ts web/lib/live/format.ts web/components/live/ web/components/sections/Hero.tsx web/lib/check-out.ts web/test/live-freshness.test.ts web/test/live-format.test.ts web/test/live-strip.test.tsx web/test/check-out.test.ts
git commit -F <msg-file>   # feat(web): a live line under the landing H1 that reads Base and says when it is not live
```

---

### Task 6: The /now page and the simulator's Now note

**Files:**
- Create: `web/app/(site)/now/page.tsx`, `web/components/live/NowBoard.tsx`
- Modify: `web/app/sitemap.ts` (add `/now`, priority 0.8, `changeFrequency: "always"`), `web/lib/check-out.ts` + `web/scripts/check-out.ts` (check `out/now.html`), `web/components/Simulator.tsx` (Now note)
- Test: `web/test/now-page.test.tsx`, `web/test/simulator.test.tsx` (new cases), `web/test/check-out.test.ts` (new case)

**Interfaces:**
- Consumes: everything in `lib/live/`, `useLiveSnapshot`, `VerdictLine`, `NAV_TOKENS`, `FACTS`, `Nav`, `Footer`, `SectionHeading`.
- Produces: route `/now` (static export `out/now.html`), `checkNowPage(html: string): string[]` in `lib/check-out.ts`.

Page (`app/(site)/now/page.tsx`, a server component):
- `export const metadata`: title "Right now on Base · Maat" (follow `SITE.name`), description "What an agent under Maat's default mandate would do right now with the 13 B20 tokens that have a NAV, read from Base mainnet in your browser." (50-160 characters), `alternates.canonical: "/now"`, `openGraph` with `url: "/now"` and the landing's OG image object (copy the `ogImage` object from `app/(site)/layout.tsx`; PR #15 moves it to `lib/og-image.ts` later — do not create that file here).
- Layout: skip link, `<Nav />`, `<main id="main">` with an `h1` "Right now on Base", a lead "Read from Base mainnet in your browser, one block at a time. Nothing is signed, and this site has no server.", then `<NowBoard />`, then a server-rendered section `h2` "How this page reads Base" (spec 6.2 last bullet; list the calls of spec 3.1, the check order table of spec 4 with each threshold's value and `FACTS.mandate.source`, the calendar source, the endpoints `LIVE_RPCS`, and the token list with Basescan links for token, feed and pool), then `<Footer />`.
- The Nav's in-page links (`#how`, …) point at the landing; on `/now` they must point at `/#how` etc. Change `Nav` to take an optional `base` prop (`"" | "/"`, default `""`) and prefix hrefs with it; the landing passes nothing.

`NowBoard` (client):
- Status line: LIVE / NOT LIVE pill as in the strip, block (Basescan link), block time UTC and ET, session detail and its source ("repo calendar, web/content/calendar.ts" or "MarketCalendar at {address}"), "Read from {endpoint}", a "Refresh" button.
- `VerdictLine` for the headline.
- From `md` up: a `<table>` inside `<div className="card overflow-x-auto" data-scroll-x>` with a `<caption>` and the columns of spec 6.2. Below `md`: one `<article>` card per token with the same values as a `<dl>`. Render both and hide one with `hidden md:block` / `md:hidden`, so tests can query either.
- Cell values: feed age "`formatAge`" with "max `{formatAge(max)}`"; NAV `formatUsd8(answer)`; TWAP `formatUsd8(twap8)`; premium "`{p}` bps" with "max `{max}`"; paused "no"/"yes"/"could not read"; `formatMultiplier`; `effectiveAt` → "none" when 0 else `formatDateUtc`; verdicts with `ReasonTag` (`OK` shows "All checks passed" via `REASON_LABEL.OK` for the market column; the mandate column for basket tokens shows "Market checks pass" for OK). Failed reads say "could not read".
- In the static HTML, `NowBoard` renders the reading state; the table rows show the token symbol and name with "—" cells, never values.

Simulator note (`components/Simulator.tsx`):
- When `now` is set and the selected moment equals it (the same condition as the Now chip's `on`), render under the checks list, above the verdict box, a `<p>` with the text: "Now sets the time only. The rows tagged fork value hold Base block {formatInt(FACTS.forkBlock.value)} ({dayLabel(FACTS.forkDay.value)}, {FACTS.forkTimeEt.value} ET), not now. " and a link "Read the live values on Right now on Base" to `/now`.
- In that state the row tag text reads "fork value" instead of "fork".

- [ ] **Step 1: Write the failing tests**

`web/test/now-page.test.tsx`: render the page component (as `test/page.test.tsx` renders the landing) and assert one `h1` "Right now on Base", no skipped heading level, the method section lists all 13 symbols with Basescan links for each token, feed and pool address in `NAV_TOKENS`, the thresholds equal `FACTS.mandate` values, the endpoints equal `LIVE_RPCS`, and no "safe". Render `<NowBoard reader={fake} />` with the fixture: 13 table rows; ANTc row shows "TOKEN_NOT_ALLOWED" and its market verdict; SNDKc's market verdict is `MULTIPLIER_COOLDOWN` when the fixture's timestamp is within `FACTS.mandate.value.multiplierCooldownSec` of `1_795_150_800`, else `OK` (compute in the test); a failed observe for one token shows "could not read" in its TWAP cell.

`web/test/simulator.test.tsx` (add to the existing `describe`): with the clock set inside `WINDOW` (reuse the file's existing Now-chip setup at lines 243-280), clicking Now shows "Now sets the time only" and a link to `/now`, and the fork tags read "fork value"; choosing another preset hides the note and the tags read "fork".

`web/test/check-out.test.ts`: `checkNowPage` passes for a minimal valid HTML and reports a missing canonical `/now`, a missing "Right now on Base" `h1`, and a baked block number (`basescan.org/block/`).

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npm test -- test/now-page.test.tsx test/simulator.test.tsx test/check-out.test.ts`
Expected: FAIL on the new cases only.

- [ ] **Step 3: Implement page, board, Nav prop, sitemap, simulator note, `checkNowPage` (wire it into `scripts/check-out.ts` for `out/now.html`)**

- [ ] **Step 4: Run everything**

Run: `cd web && npm test && npm run typecheck && npm run build && npm run check:out`
Expected: all vitest files pass; `check:out` ready. `test/readme.test.ts` or docs tests may pin the sitemap or page list: if one fails, update the pinned list and say why in the commit message.

- [ ] **Step 5: Commit**

```bash
git add -- "web/app/(site)/now/page.tsx" web/components/live/NowBoard.tsx web/components/sections/Nav.tsx web/app/sitemap.ts web/lib/check-out.ts web/scripts/check-out.ts web/components/Simulator.tsx web/test/now-page.test.tsx web/test/simulator.test.tsx web/test/check-out.test.ts
git commit -F <msg-file>   # feat(web): /now reads the 13 B20s with a NAV live, and the simulator's Now names its fork values
```

---

### Task 7: End to end, and the docs that name the pages

**Files:**
- Create: `web/e2e/fake-live-rpc.ts`, `web/e2e/live.spec.ts`
- Modify: every existing `web/e2e/*.spec.ts` that opens `/` (route the RPC hosts to the fake in a `test.beforeEach`), `web/README.md` (one line naming `/now` and `lib/live/`), `README.md` only if it lists the site's pages
- Test: the specs themselves

**Interfaces:**
- Consumes: `encodeAggregate3Result`, `decodeAggregate3`, `word`, `LIVE_RPCS` (import from `../lib/live/abi.ts` and `../lib/live/rpc.ts` with relative paths; Playwright runs as Node ESM, so JSON imports need `with { type: "json" }`).
- Produces: `routeLiveRpc(page: Page, scenario: "weekend" | "session" | "down" | { results: CallResult[] }): Promise<{ calls: () => number; set(s): void }>` — routes `https://base-rpc.publicnode.com/**` and `https://mainnet.base.org/**`; for `eth_call` to Multicall3 answers the fixture's results (with the timestamp word replaced for "weekend": Sat 2026-11-21 15:00 UTC; and with the block-number word kept); "down" answers HTTP 503 on both.

- [ ] **Step 1: Write the fake and the specs**

`web/e2e/live.spec.ts` scenarios (each `collectErrors(page)` must stay empty except for the "down" scenario's two 503 network errors, which the spec filters by URL):
1. Landing, weekend: the strip shows "LIVE", "Base block 60,013,066", "REFUSE", "Market closed"; the "All 13 B20s" link goes to `/now`.
2. Landing, RPC down then up: the error sentence and Retry show; `set("weekend")`, click Retry → "LIVE".
3. `/now`, session: 13 rows; ANTc shows `TOKEN_NOT_ALLOWED`; the method section names both endpoints.
4. `/now` at 375 × 812: `measureFit(page)` reports no page overflow and no clipped card; cards, not the table, are visible.
5. axe on `/now` after the reading arrives: no violations (follow `e2e/docs-a11y.spec.ts` for the AxeBuilder setup).
6. The simulator: click Now → the note links `/now`.

- [ ] **Step 2: Build and run**

Run (check the port first): `cd web && netstat -ano | grep 4173; npm run build && npx playwright test --workers=2`
Expected: every spec passes, the old ones included.

- [ ] **Step 3: Docs line**

In `web/README.md`, under the section that lists pages or folders, add: "`/now` (Right now on Base) reads Base mainnet in the browser through `lib/live/`: one Multicall3 call over keyless public RPCs, judged like `MandateVault` for a BUY." Run `npm test -- test/readme.test.ts` if it exists.

- [ ] **Step 4: Commit**

```bash
git add -- web/e2e/fake-live-rpc.ts web/e2e/live.spec.ts web/e2e/*.spec.ts web/README.md
git commit -F <msg-file>   # test(web): drive the live strip and /now end to end against a fake RPC
```

---

## Self-review notes

- Spec 2 → Task 1; 3.1/3.2 → Tasks 1-3; 4 → Task 4; 5 → Task 5; 6.1 → Task 5; 6.2 → Task 6; 6.3 → Task 6; 7 → every task; 8 is out of scope.
- Names used across tasks: `NAV_TOKENS`, `MULTICALL3`, `SELECTORS`, `encodeCall`, `encodeObserve`, `encodeAggregate3`, `decodeAggregate3`, `encodeAggregate3Result`, `word`, `decodeUint`, `decodeBool`, `decodeRoundData`, `decodeObserve`, `twapPrice8`, `premiumBps`, `LIVE_RPCS`, `LiveReader`, `createReader`, `RpcError`, `TokenReading`, `LiveSnapshot`, `CalendarReading`, `buildCalls`, `decodeSnapshot`, `readSnapshot`, `calendarAddress`, `Limits`, `DEFAULT_LIMITS`, `Session`, `sessionAt`, `LiveCheck`, `TokenVerdict`, `judgeToken`, `Headline`, `headline`, `headlineText`, `Reading`, `LiveState`, `classify`, `useLiveSnapshot`, `VerdictLine`, `LiveStrip`, `NowBoard`, `checkNowPage`, `routeLiveRpc`.
