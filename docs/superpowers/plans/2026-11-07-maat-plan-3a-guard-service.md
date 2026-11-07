# Maat — Plan 3A: Guard Service, x402 paid check and revenue keeper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public, read-only Guard Service in `agent/` that serves:
- the market state GuardLib checks, for each basket token;
- a free `previewIntent` proxy;
- a paid x402 endpoint, `GET /check`, which costs $0.01 and pays straight into the vault.

The agent also gets a revenue keeper that calls `notifyRevenue()`, so the payments show up as vault revenue.

**Architecture:**
- **Reads.** The guard ports GuardLib's market checks to TypeScript as integer math. It reads the same onchain inputs in one multicall pinned to one block, and gives the same verdict in the same order. A fork test proves this against `previewIntent`.
- **Server.** A Hono app with the official x402 v2 middleware. The middleware settles only after the handler answers below 400, so an RPC failure (503) costs the caller nothing.
- **No signing in the guard.** It never signs anything: the CDP facilitator submits the buyer's EIP-3009 transfer.
- **Revenue keeper.** It is one more housekeeping step in the agent's `runOnce`, going through the existing `GuardedSender` (`notifyRevenue` is already allowed there and in the CDP policy).

**Tech Stack:**
- Already in `agent/`: Node ≥ 22.9 (dev machine: 24), TypeScript 7.0.2 (NodeNext, strict), viem 2.57.16, zod 4.6.7, vitest 5.1.0, tsx, `@coinbase/cdp-sdk` 1.61.0.
- New, all pinned exact:
  - `hono` 4.13.16 and `@hono/node-server` 2.1.6;
  - `@x402/core`, `@x402/evm`, `@x402/hono`, `@x402/extensions` and `@x402/svm`, all 2.30.0;
  - `@x402/fetch` 2.30.0 (dev only).
- Fork tests: base-anvil v1.5.1.

**Spec:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md`, which this plan implements:
- §3.4 Guard Service;
- §3.2 revenue recording;
- §4 flow 1 (revenue);
- §5 "Coinbase API or RPC is down";
- §6 off-chain tests;
- §7 spike S4.

Plan 2B (`docs/superpowers/plans/2026-11-06-maat-plan-2b-agent-runtime.md`) built the `agent/` package this plan extends.

### Scope

- **In this plan:**
  - `readMarketState(token)`;
  - integer TWAP and premium math (a TickMath port);
  - the off-chain verdict;
  - the Coinbase NAV client;
  - the HTTP API: `GET /health`, `GET /state/:token`, `POST /preview`, and the paid `GET /check`;
  - rate limit, cache and CORS;
  - guard config and entrypoint;
  - the revenue keeper;
  - the fork test (preview parity, and an offline S4 that runs x402 → vault → `notifyRevenue` → `PAY_EXPENSE`);
  - the owner-only S4 mainnet script;
  - the Docker image and Fly config, and the runbook.
- **Owner only, after the tasks:** the S4 mainnet payment, `fly deploy`, DNS for `guard.maatonbase.xyz`. See "Owner steps" at the end. The implementer writes and type-checks these files and never runs them.
- **Later plans:**
  - Plan 3B: the dashboard, which reads `/state`.
  - The MCP server, the Bankr Skill and `depth2pctUSD`.
  - Automated forwarding for the S4 fallback (only if S4 fails).

### Facts verified for this plan (2026-11-07/08)

- **Versions and dates.** The x402 v2 packages 2.30.0 were published 2026-11-04 (`npm view @x402/svm time` gives `2026-11-04T20:08:47Z`). `hono` 4.13.17 is skipped because it was published the day this plan was written.
- **Facilitator.** `@coinbase/cdp-sdk` 1.61.0 has `createCdpFacilitatorClient()` in `@coinbase/cdp-sdk/x402`:
  - base URL `https://api.cdp.coinbase.com/platform/v2/x402`;
  - JWT auth from `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`.

  At runtime that subpath imports `@x402/svm` (an optional peer dependency), and `tsc` does not catch it. Without `@x402/svm` the guard dies on start with `ERR_MODULE_NOT_FOUND`, so Task 4 installs it.
- **CDP facilitator cost (CDP docs):** 1,000 settlements a month free, then $0.001 each. The x402.org facilitator runs on testnets only.
- **How money moves.** The EVM `exact` scheme pays USDC with EIP-3009 `transferWithAuthorization`, and the facilitator pays the gas.
- **When settlement happens.** `@x402/hono` 2.30.0 (`paymentMiddlewareFromHTTPServer`) works like this:
  - verify the payment;
  - run the handler;
  - if the response status is ≥ 400, cancel the settlement and skip it;
  - otherwise settle and add the `PAYMENT-RESPONSE` header.

  When the facilitator is unreachable, the middleware answers 500 and nothing is settled. The local boot smoke test behaved this way.
- **Builder code.** The CDP facilitator lists `builder-code` among its supported extensions (`CDP_EXTENSION_BUILDER_CODE`). The code must match `^[a-z0-9_]{1,32}$` (`BUILDER_CODE_PATTERN`).
- **Coinbase Tokenized Stocks API.** It lives at `https://api.coinbase.com/v1/tokenized-stocks`, is read-only and needs no key.
  - The list is paginated (`page_size` up to 500, `next_page_token`). NVDAc is on page 2 at the default size of 100.
  - `nav_price` is a JSON number that already includes the multiplier. Its currency is not documented, and it is absent on many tokens. `nav_price_updated_at` is RFC 3339.
  - Corporate actions can only be fetched by UUID (`/corporate-actions/{id}`). There is no list endpoint and no effective date for an upcoming action. A pending multiplier change is therefore read onchain through `effectiveAt()`, exactly where GuardLib checks it.
- **Fork dev accounts.** On a Base mainnet fork at block 53551627, all anvil dev accounts have EIP-7702 delegation code (`0xef0100…`). A facilitator checks such a payer's signature with ERC-1271 and answers `invalid_exact_evm_signature`. The fork test clears the buyer's code (fork only).
- **Prototype run (2026-11-08).** Every code block in this plan ran in a scratch copy of `agent/`:
  - 31 unit test files and 228 tests passed, and `tsc` was clean;
  - the fork test (Task 8) passed on base-anvil v1.5.1;
  - the guard booted with `node --import tsx src/guard/main.ts`, served `/health`, and answered 503 `UNKNOWN` with the RPC down.

## Global Constraints

- **Every mainnet transaction is signed by the owner.** The implementer:
  - never broadcasts to Base mainnet;
  - never uses a private key;
  - never runs `cast send`, `cast wallet` or `forge script --broadcast`.

  Tests send transactions only to a local anvil (`http://127.0.0.1:<port>`), using unlocked dev accounts, `anvil_impersonateAccount` and `anvil_setCode`.
- **Owner-only files.** The implementer writes and type-checks these and never runs them:
  - `agent/scripts/s4-pay.ts` (it moves 0.01 USDC on mainnet);
  - `agent/scripts/cdp-setup.ts`;
  - `agent/scripts/smoke-claude.ts`;
  - `fly deploy`, `fly secrets`, and anything that calls `setExecutor`.

  The implementer does not create CDP keys and does not log in to portal.cdp.coinbase.com, fly.io or a DNS provider.
- **The guard never signs.** It has no wallet. `loadGuardConfig` refuses to start when `CDP_WALLET_SECRET` is set.
- **Do not commit secrets.** `agent/.env`, `agent/.env.guard`, `agent/.env.s4` and `agent/data/` are git-ignored.
  - An RPC URL with a key is never written to a committed file and never printed. `main.ts` logs no RPC URL.
  - When running the fork test, take `BASE_RPC_URL` from `contracts/.env` without echoing it.
- **No paid Claude API calls** anywhere in this plan.
- **Units:**
  - USDC has 6 decimals (`usd6`), and B20 tokens have 8.
  - Prices are USD per whole token with 8 decimals (`price8`), the same as the Chainlink equity feeds and `PriceLib`.
  - Basis points are `bigint`s.
  - Every money amount in code is a `bigint`. HTTP JSON shows bigints as decimal strings and prices as formatted decimal strings (`"200.00363238"`).
- **Parity with Solidity:**
  - Integer math matches `contracts/src/lib/PriceLib.sol` and v4-core `TickMath.getSqrtPriceAtTick` to the last unit.
  - The verdict order matches `GuardLib.checkMarket`.
  - A failed read counts the way GuardLib's `catch` branches count it (fail-closed).
- **x402 terms:**
  - network `eip155:8453`, scheme `exact`, price `"$0.01"` (= `10000` USDC units);
  - `payTo` = the vault (`MAAT_VAULT`), unless the S4 fallback sets `GUARD_PAY_TO`;
  - `maxTimeoutSeconds` 120.
- **Public limits:**
  - 60 requests per minute per client IP (Fly-Client-IP), checked before the payment middleware;
  - a 15-second cache for state and preview, and a 60-second cache for the Coinbase list;
  - CORS for `https://maatonbase.xyz` and `https://www.maatonbase.xyz`.
- **Only basket tokens are served** (NVDAc, GOOGLc, AAPLc, by symbol in any case or by address). Anything else is a 404 before any RPC call.
- **Existing patterns:**
  - ESM NodeNext with `.js` import paths.
  - Tests live flat in `agent/test/`, and fakes live in `agent/test/fakes/`.
  - Edits to `runOnce.ts`, `config.ts`, `runtime.ts`, `calls.ts` and `journal.ts` are anchored on code text, not line numbers. A sibling branch, `ops-notifier`, is changing some of these files.
- Commands run in Git Bash, from `agent/`, unless noted otherwise.
- Every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Design decisions (approved 2026-11-07, so the reviewer does not have to guess)

1. **The guard lives in `agent/`** (`agent/src/guard/`, `npm run guard`), not in a separate package.
   - It reuses the ABIs, the chain readers, `previewIntent` and the types.
   - There is one lockfile, one viem and one Docker image.
   - It runs as its own process with its own env file (`.env.guard`).
2. **The API:**
   - `GET /health`: free.
   - `GET /state/:token`: free, rate-limited. It returns:
     - the Chainlink price and its age;
     - the 30-minute Aerodrome TWAP and the premium in bps;
     - the multiplier: current, last seen by the vault, `changedAt`, `effectiveAt`, and pending;
     - whether the token is paused, the policy ids, and whether the session is open or closed;
     - the pool reserves and the Coinbase NAV.
   - `POST /preview`: free, rate-limited.
     - Body: `{action, token, amount, minOut?, payee?}`, where amounts are integer strings in raw units.
     - It runs `eth_call previewIntent` with `from = executor`, pinned to the latest block.
     - It returns `{reason, allowed, block}`.
   - `GET /check?token&side&sizeUSD`: x402, $0.01, `payTo` = vault.
     - The verdict covers GuardLib's market checks (paused → session → feed → multiplier → premium), in GuardLib's order, with the same integer math and with the thresholds in Maat's mandate.
     - Vault-only checks (balance, caps, concentration) are not applied: they mean nothing for an outside agent.
     - Policy depends on the caller's address, so it is reported (`policyRestricted`) but not judged.
     - `sizeShareBps` compares the order with what the pool holds of the side the trade takes out (stock for BUY, USDC for SELL). It is information only, never a refusal.
     - RPC down → 503 `UNKNOWN`, and the caller is not charged.
3. **The revenue keeper lives in the agent's `runOnce` housekeeping.**
   - When `newRevenue ≥ MAAT_REVENUE_MIN_USD` (default $0.05), the agent sends `notifyRevenue` and journals the `RevenueReceived` amount.
   - Anyone may call `notifyRevenue`. A receipt without the event means someone else recorded the revenue first, so it is journaled, not a halt.
4. **Builder Code on the x402 settlement tx.** When `GUARD_BUILDER_CODE` is set, the route declares the `builder-code` extension and the server registers it. It is off by default; the owner turns it on after S4. If the schedule slips, this is cut first.
5. **S4:**
   - **(a) Offline, by the implementer:** the fork test runs an in-process facilitator (the same `@x402/evm` exact scheme) that settles from an anvil dev account, without a private key. It proves that the USDC lands in the vault and that `notifyRevenue` counts it.
   - **(b) Mainnet, by the owner:** run the guard locally with the CDP facilitator, then pay 0.01 USDC once with `scripts/s4-pay.ts` from a separate CDP buyer account. Before signing, the script checks that `payTo` == vault and amount == 10000.
   - **Fallback if CDP refuses a contract `payTo`:**
     - Set `GUARD_PAY_TO` to an address the owner holds.
     - The owner moves the USDC into the vault with a plain transfer. `fund()` would not count as revenue.
     - Automated forwarding needs a new CDP account and policy, so it gets its own plan, only if S4 fails.
6. **Public deploy:**
   - Fly.io app `maat-guard`, separate from the agent (separate secrets), from the same image, running `npm run guard`.
   - Fly provides HTTPS. The owner points DNS for `guard.maatonbase.xyz`.
   - One machine, because the rate limiter is in memory.
7. **Deviations from the spec, stated so the reviewer can reject them:**
   - **No `depth2pctUSD`.** The S3 recorder's depth code uses floats and sits on an unmerged branch. `sizeShareBps` and the raw pool reserves stand in for now.
   - **No Base Sepolia run** (spec §6). There is no vault on Sepolia. The fork test runs the same packages against real Base USDC.
   - **Coinbase down does not make the answer `UNKNOWN`** (spec §5 lists "Coinbase API or RPC is down → UNKNOWN"). The verdict needs only onchain data (GuardLib never reads Coinbase), so `/state` shows `nav: null` and `/check` answers normally. RPC down is still `UNKNOWN`.
   - **No corporate-action lookup.** The API has no list endpoint and no effective date, so there is nothing to query without a UUID. Pending multiplier changes come from `effectiveAt()` onchain.
   - **`/state` is free,** so an agent could compute the verdict itself without paying. This is accepted: the Plan 3B dashboard needs `/state`, and the revenue here mainly demonstrates the money loop. `/state` does not include the verdict itself.

## Review Focus

1. **The RPC fails while a paid `/check` is in flight.** Expected: 503 `{reason: "UNKNOWN"}`, payment verified but never settled, so the caller keeps their USDC. Test: `does not settle when the RPC is down (503 UNKNOWN)` (Task 5).
2. **A malformed or unsupported `/check` query** (`side=HOLD`, `sizeUSD=0`, a missing parameter, a non-basket token). Expected: 400 or 404 before the 402, so the caller never signs anything. Test: `rejects bad queries before asking for payment` (Task 5).
3. **The off-chain verdict drifts from the vault** (check order, TWAP rounding toward −∞, a tick at the edge, premium truncation, `effectiveAt` edge times). Expected: the same reason as `previewIntent` on the same block. Tests:
   - TickMath vectors and the floor rounding of a negative mean tick (Task 1);
   - the order and the boundary values of `marketReason` and `multiplierBlocked` (Task 3);
   - `matches previewIntent on the same block for every basket token` (Task 8).
4. **A burst from one client, or many clients at once.** Expected: 429 with `Retry-After` per client IP; a burst for one token costs one RPC round (the cache shares the in-flight promise); a failed load is never cached. Tests: `TtlCache` and `RateLimiter` (Task 4); `rate limits per client IP with Retry-After` and `caches state for 15 seconds` (Task 5).
5. **Revenue that someone else already recorded, or that is too small to record.** Expected: no halt and no wasted gas. A receipt without `RevenueReceived` is journaled with `amount 0` and a note, and new USDC below $0.05 waits. Tests: `does not halt when someone else recorded the revenue first` and `leaves revenue below the threshold for later` (Task 7).

Also: Coinbase down never breaks `/state` (`still answers /state when Coinbase is down, with nav null`, Task 5). An env file's blank `KEY=` lines behave like unset (`treats blank values from the env file as unset`, Task 6).

---

## File Structure

```
agent/
  package.json                    (T4, T6, T9 edit) deps; scripts "guard", "s4:pay"
  .env.guard.example              (T6)  guard env, no wallet secret
  .env.example                    (T7 edit) MAAT_REVENUE_MIN_USD
  Dockerfile, .dockerignore       (T10) one image for agent and guard
  fly.guard.toml                  (T10) Fly app maat-guard
  README.md                       (T10 edit) "Guard Service" section
  scripts/
    s4-pay.ts                     (T9)  OWNER ONLY: one 0.01 USDC x402 payment on mainnet
  src/
    chain/priceMath.ts            (T1)  TickMath + PriceLib ports (bigint)
    chain/market.ts               (T2)  readMarketState: one block, every GuardLib input
    chain/state.ts                (T2 edit) export Result, must, opt
    guard/verdict.ts              (T3)  marketReason, multiplierBlocked, verdict
    guard/coinbase.ts             (T4)  fetchNavQuotes (Tokenized Stocks API)
    guard/cache.ts                (T4)  TtlCache (shares in-flight loads)
    guard/rateLimit.ts            (T4)  RateLimiter, clientKey, rateLimit middleware
    guard/x402.ts                 (T5)  checkRoutes, checkPayment (x402 v2 middleware)
    guard/views.ts                (T5)  resolveToken, toJson, stateView, verdictView
    guard/app.ts                  (T5)  createGuardApp (Hono)
    guard/config.ts               (T6)  loadGuardConfig
    guard/main.ts                 (T6)  entrypoint (node-server)
    config.ts                     (T6, T7 edit) export field/address; MAAT_REVENUE_MIN_USD
    exec/calls.ts                 (T7 edit) encodeNotifyRevenue, NOTIFY_GAS_FLOOR
    ledger/journal.ts             (T7 edit) housekeeping row for notifyRevenue
    loop/runOnce.ts               (T7 edit) revenue keeper
    runtime.ts                    (T7 edit) revenueMinUsd6
  test/
    priceMath.test.ts (T1), market.test.ts (T2), verdict.test.ts (T3)
    coinbase.test.ts, cacheRateLimit.test.ts (T4)
    guardApp.test.ts (T5), guardConfig.test.ts (T6)
    runOnce.test.ts, config.test.ts, runtime.test.ts (T7 edit)
    fakes/fakeChain.ts            (T2 edit) POOL, TWAP_TICK, DEX_PRICE8, marketScene
    fakes/fakeFacilitator.ts      (T5)  FakeFacilitator, fakeBuyer
    fakes/fakeReceipts.ts         (T7 edit) RevenueReceived
    integration/guard.fork.test.ts (T8) parity + offline S4 on a Base fork
.gitignore                        (T6 edit) agent/.env.guard, agent/.env.s4
deployments/README.md             (T10 edit) "Guard Service and S4 (owner only)"
```

Tasks are ordered by dependency: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10. Each task ends with a green `npx vitest run && npx tsc --noEmit` and one commit. **Before Task 7, bring the branch up to date with `main`**: in a Claude Code worktree use the app's sync-with-base tool, otherwise run `git merge main`. Sibling branches (ops-notifier, s3-pool-recorder) may have changed `runOnce.ts`, `config.ts`, `runtime.ts`, `.env.example` and `fakeChain.ts`.

---

### Task 1: Integer price math (TickMath and PriceLib ports)

**Files:**
- Create: `agent/src/chain/priceMath.ts`
- Test: `agent/test/priceMath.test.ts`

**Interfaces:**
- Consumes: nothing. The constants are copied from v4-core `TickMath.sol` (`contracts/lib/v4-core/src/libraries/TickMath.sol`). The tick-0 and ±`MAX_TICK` test vectors pin them. The `priceFromSqrt` vectors are the ones in `contracts/test/PriceLib.t.sol`.
- Produces (`src/chain/priceMath.ts`):
  - `PRICE_DECIMALS = 8`, `MAX_TICK = 887_272`
  - `sqrtPriceAtTick(tick: number): bigint`: Q64.96, rounded up; throws `tick … out of range` on |tick| > MAX_TICK or on a non-integer
  - `mulDiv(a: bigint, b: bigint, d: bigint): bigint`
  - `priceFromSqrt(sqrtPriceX96: bigint, stockIsToken0: boolean, stockDecimals: number, quoteDecimals: number): bigint`: 8-decimal USD price
  - `twapTick(cumAgo: bigint, cumNow: bigint, window: number): number`: rounded toward −∞
  - `premiumBps(dexPrice8: bigint, oraclePrice8: bigint): bigint`: truncated

- [ ] **Step 1: Write the failing test**

`agent/test/priceMath.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MAX_TICK, premiumBps, priceFromSqrt, sqrtPriceAtTick, twapTick } from "../src/chain/priceMath.js";

describe("sqrtPriceAtTick (TickMath port)", () => {
  it("matches TickMath at tick 0 and at both bounds", () => {
    expect(sqrtPriceAtTick(0)).toBe(79228162514264337593543950336n); // 2^96
    expect(sqrtPriceAtTick(-MAX_TICK)).toBe(4295128739n); // TickMath.MIN_SQRT_PRICE
    expect(sqrtPriceAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n); // MAX_SQRT_PRICE
  });

  it("is monotonic and symmetric around 0", () => {
    expect(sqrtPriceAtTick(1)).toBeGreaterThan(sqrtPriceAtTick(0));
    expect(sqrtPriceAtTick(-1)).toBeLessThan(sqrtPriceAtTick(0));
    const up = sqrtPriceAtTick(6932);
    const down = sqrtPriceAtTick(-6932);
    // up * down ~= 2^192 (within rounding)
    const product = (up * down) >> 96n;
    expect(product > (1n << 96n) - 2n ** 40n && product < (1n << 96n) + 2n ** 40n).toBe(true);
  });

  it("rejects ticks out of range and non-integers", () => {
    expect(() => sqrtPriceAtTick(MAX_TICK + 1)).toThrow(/out of range/);
    expect(() => sqrtPriceAtTick(1.5)).toThrow(/out of range/);
  });
});

describe("priceFromSqrt (PriceLib port, same vectors as contracts/test/PriceLib.t.sol)", () => {
  it("stock is token1: the NVDAc/USDC slot0 of 2026-11-06 is ~$185.08", () => {
    const p = priceFromSqrt(58237376898234626810359736464n, false, 8, 6);
    expect(p >= 18507832337n && p <= 18507832339n).toBe(true);
  });

  it("stock is token0: sqrt(1.848) * 2^96 encodes $184.80", () => {
    const p = priceFromSqrt(107703686134665736396608634880n, true, 8, 6);
    const rel = Number(p - 18480000000n) / 18480000000;
    expect(Math.abs(rel)).toBeLessThan(1e-4);
  });

  it("tick -6932 with the stock as token1 is ~$200 (the MockPool vector)", () => {
    const p = priceFromSqrt(sqrtPriceAtTick(-6932), false, 8, 6);
    const rel = Number(p - 20000000000n) / 20000000000;
    expect(Math.abs(rel)).toBeLessThan(1e-3);
  });
});

describe("twapTick", () => {
  it("divides the cumulative delta by the window", () => {
    expect(twapTick(0n, -6932n * 1800n, 1800)).toBe(-6932);
    expect(twapTick(100n, 100n + 7n * 60n, 60)).toBe(7);
  });

  it("rounds a negative non-integer mean down, like PriceLib", () => {
    expect(twapTick(0n, -6932n * 1800n - 1n, 1800)).toBe(-6933);
    expect(twapTick(0n, 6932n * 1800n + 1n, 1800)).toBe(6932);
  });
});

describe("premiumBps", () => {
  it("is symmetric and truncates, like PriceLib", () => {
    expect(premiumBps(101_00000000n, 100_00000000n)).toBe(100n);
    expect(premiumBps(99_00000000n, 100_00000000n)).toBe(100n);
    expect(premiumBps(100_00000000n, 100_00000000n)).toBe(0n);
    expect(premiumBps(100_00999999n, 100_00000000n)).toBe(0n);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/priceMath.test.ts`
Expected: FAIL, `Failed to load url ../src/chain/priceMath.js` (or "Cannot find module").

- [ ] **Step 3: Implement**

`agent/src/chain/priceMath.ts`:

```ts
/**
 * Integer ports of contracts/src/lib/PriceLib.sol and v4-core TickMath.getSqrtPriceAtTick, so the guard computes the
 * same TWAP price and premium as the vault, to the last unit. Prices are USD per 1 whole token with 8 decimals.
 */
export const PRICE_DECIMALS = 8;
export const MAX_TICK = 887_272;

const Q32 = 1n << 32n;
const Q96 = 1n << 96n;
const MAX_UINT256 = (1n << 256n) - 1n;

// 1/sqrt(1.0001^(2^i)) in Q128.128, for bits 1..19 of |tick| (TickMath.sol, same order).
const BIT_FACTORS: readonly bigint[] = [
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

/** TickMath.getSqrtPriceAtTick: sqrt(1.0001^tick) as a Q64.96, rounded up. */
export function sqrtPriceAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || Math.abs(tick) > MAX_TICK) throw new Error(`tick ${tick} out of range`);
  const abs = BigInt(Math.abs(tick));
  let price = (abs & 1n) !== 0n ? 0xfffcb933bd6fad37aa2d162d1a594001n : 1n << 128n;
  BIT_FACTORS.forEach((f, i) => {
    if ((abs & (1n << BigInt(i + 1))) !== 0n) price = (price * f) >> 128n;
  });
  if (tick > 0) price = MAX_UINT256 / price;
  return (price + Q32 - 1n) >> 32n;
}

/** FullMath.mulDiv for non-negative inputs: floor(a * b / d). */
export function mulDiv(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("mulDiv by zero");
  return (a * b) / d;
}

/** PriceLib.priceFromSqrt: the stock's USD price (8 decimals) at a pool sqrt price. */
export function priceFromSqrt(sqrtPriceX96: bigint, stockIsToken0: boolean, stockDecimals: number, quoteDecimals: number): bigint {
  const scale = 10n ** BigInt(stockDecimals + PRICE_DECIMALS - quoteDecimals);
  if (stockIsToken0) {
    const ratioX96 = mulDiv(sqrtPriceX96, sqrtPriceX96, Q96);
    return mulDiv(ratioX96, scale, Q96);
  }
  const inv = mulDiv(Q96, Q96, sqrtPriceX96);
  return mulDiv(inv, scale, sqrtPriceX96);
}

/** The mean tick of observe([window, 0]), rounded toward negative infinity like PriceLib.twapPrice. */
export function twapTick(cumAgo: bigint, cumNow: bigint, window: number): number {
  if (window <= 0) throw new Error("twap window must be positive");
  const delta = cumNow - cumAgo;
  const w = BigInt(window);
  let tick = delta / w; // bigint division truncates toward zero, like Solidity
  if (delta < 0n && delta % w !== 0n) tick -= 1n;
  return Number(tick);
}

/** PriceLib.premiumBps: |dex - oracle| / oracle in basis points, truncated. */
export function premiumBps(dexPrice8: bigint, oraclePrice8: bigint): bigint {
  if (oraclePrice8 <= 0n) throw new Error("oracle price must be positive");
  const diff = dexPrice8 > oraclePrice8 ? dexPrice8 - oraclePrice8 : oraclePrice8 - dexPrice8;
  return (diff * 10_000n) / oraclePrice8;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/priceMath.test.ts && npx tsc --noEmit`
Expected: PASS, 9 tests; `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/chain/priceMath.ts test/priceMath.test.ts
git commit -m "feat(agent): port TickMath and PriceLib price math to bigint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Market state reader (`readMarketState`)

**Files:**
- Modify: `agent/src/chain/state.ts` (export `Result`, `must`, `opt`)
- Modify: `agent/test/fakes/fakeChain.ts` (append the pool fixtures and `marketScene`)
- Create: `agent/src/chain/market.ts`
- Test: `agent/test/market.test.ts`

**Interfaces:**
- Consumes:
  - From Task 1: `MAX_TICK`, `premiumBps`, `priceFromSqrt`, `sqrtPriceAtTick`, `twapTick`.
  - Existing: `StateClient`, `StateUnavailable` (`src/chain/state.ts`), `USDC_DECIMALS` (`src/units.ts`), `symbolOf`, `TokenSymbol` (`src/addresses.ts`), the ABIs in `src/abi/index.ts`.
- Produces (`src/chain/market.ts`):
  - `clPoolAbi` (`token0()`, `observe(uint32[])`)
  - `FEATURE_TRANSFER = 0`
  - `POLICY_SCOPES { sender, receiver, executor }` (keccak of the B20 scope strings)
  - `class TokenNotCovered extends Error { token: Address }`
  - `interface MarketState`:
    - `block`, `timestamp: bigint`
    - `token: Address`, `symbol: TokenSymbol | undefined`, `decimals: number`
    - `feed`, `pool: Address`, `allowed`, `vaultPaused: boolean`, `sessionMode: number`
    - `marketOpen`, `tokenPaused: boolean | null`
    - `oracle: { price8; updatedAt; age } | null`, `dex: { tick: number; price8 } | null`, `premiumBps: bigint | null`
    - `multiplier: { current: bigint | null; last; changedAt; effectiveAt: bigint | null }`
    - `policyIds: { sender; receiver; executor: bigint | null }`
    - `reserves: { stock; usdc: bigint | null }`
    - `limits: { maxStaleness; twapWindow; maxPremiumBps; multiplierCooldown: number }`
  - `readMarketState(client: StateClient, vault: Address, token: Address): Promise<MarketState>`. It throws `StateUnavailable` when the block or the vault reads fail, and `TokenNotCovered` when the vault has no feed or pool for the token.
  - Test fakes: `POOL`, `TWAP_TICK = -6932`, `DEX_PRICE8 = 20_000_363_238n`, `marketScene(): FakeChain`.

- [ ] **Step 1: Export the result helpers from `state.ts`**

In `agent/src/chain/state.ts`, add `export` to the three declarations. The bodies stay as they are:

```ts
export type Result = { status: "success"; result: unknown } | { status: "failure"; error: unknown };

export function must<T>(r: Result | undefined, what: string): T {
```

```ts
export function opt<T>(r: Result | undefined): T | null {
```

- [ ] **Step 2: Add the market fixtures to the fake chain**

Append to `agent/test/fakes/fakeChain.ts`. The file already imports `getAddress`, `Address`, `USDC` and `BASKET`:

```ts
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
```

- [ ] **Step 3: Write the failing test**

`agent/test/market.test.ts`:

```ts
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
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run test/market.test.ts`
Expected: FAIL, cannot resolve `../src/chain/market.js`.

- [ ] **Step 5: Implement**

`agent/src/chain/market.ts`:

```ts
import { keccak256, parseAbi, toBytes, zeroAddress, type Address } from "viem";
import { aggregatorV3Abi, b20AssetAbi, erc20Abi, mandateVaultAbi, marketCalendarAbi } from "../abi/index.js";
import { symbolOf, type TokenSymbol } from "../addresses.js";
import { USDC_DECIMALS } from "../units.js";
import { MAX_TICK, premiumBps, priceFromSqrt, sqrtPriceAtTick, twapTick } from "./priceMath.js";
import type { Mandate } from "../types.js";
import { must, opt, StateUnavailable, type Result, type StateClient } from "./state.js";

/** Aerodrome Slipstream pool, the two reads PriceLib.twapPrice makes. */
export const clPoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
]);

/** contracts/src/interfaces/IB20Asset.sol, B20Constants. */
export const FEATURE_TRANSFER = 0;
export const POLICY_SCOPES = {
  sender: keccak256(toBytes("TRANSFER_SENDER_POLICY")),
  receiver: keccak256(toBytes("TRANSFER_RECEIVER_POLICY")),
  executor: keccak256(toBytes("TRANSFER_EXECUTOR_POLICY")),
} as const;

/** The token has no feed or pool in Maat's vault, so the guard has nothing to check it against. */
export class TokenNotCovered extends Error {
  constructor(readonly token: Address) {
    super(`token ${token} has no feed and pool in the vault`);
    this.name = "TokenNotCovered";
  }
}

/**
 * Everything GuardLib.checkMarket reads for one token, at one block. A null field is a read that failed; the verdict
 * treats it the way GuardLib does (fail-closed).
 */
export interface MarketState {
  block: bigint;
  timestamp: bigint;
  token: Address;
  symbol: TokenSymbol | undefined;
  decimals: number;
  feed: Address;
  pool: Address;
  /** BUY is allowed for this token in Maat's vault (false: exit-only there). */
  allowed: boolean;
  vaultPaused: boolean;
  sessionMode: number;
  marketOpen: boolean | null;
  tokenPaused: boolean | null;
  oracle: { price8: bigint; updatedAt: bigint; age: bigint } | null;
  dex: { tick: number; price8: bigint } | null;
  premiumBps: bigint | null;
  /** current = uiMultiplier(); last / changedAt = the vault's bookkeeping; effectiveAt = scheduled update time. */
  multiplier: { current: bigint | null; last: bigint; changedAt: bigint; effectiveAt: bigint | null };
  policyIds: { sender: bigint | null; receiver: bigint | null; executor: bigint | null };
  /** What the pool holds: the stock (raw units) and USDC (6 decimals). */
  reserves: { stock: bigint | null; usdc: bigint | null };
  limits: { maxStaleness: number; twapWindow: number; maxPremiumBps: number; multiplierCooldown: number };
}

export async function readMarketState(client: StateClient, vault: Address, token: Address): Promise<MarketState> {
  let block: { number: bigint | null; timestamp: bigint };
  try {
    block = await client.getBlock({ blockTag: "latest" });
  } catch (e) {
    throw new StateUnavailable("getBlock failed", { cause: e });
  }
  if (block.number === null) throw new StateUnavailable("latest block has no number");
  const blockNumber = block.number;
  const now = block.timestamp;
  const call = async (contracts: readonly unknown[]) => {
    try {
      return (await client.multicall({ contracts: contracts as never, allowFailure: true, blockNumber })) as Result[];
    } catch (e) {
      throw new StateUnavailable("multicall failed", { cause: e });
    }
  };

  const r1 = await call([
    { address: vault, abi: mandateVaultAbi, functionName: "mandate" },
    { address: vault, abi: mandateVaultAbi, functionName: "paused" },
    { address: vault, abi: mandateVaultAbi, functionName: "usdc" },
    { address: vault, abi: mandateVaultAbi, functionName: "tokenConfig", args: [token] },
    { address: vault, abi: mandateVaultAbi, functionName: "lastMultiplier", args: [token] },
    { address: vault, abi: mandateVaultAbi, functionName: "multiplierChangedAt", args: [token] },
  ]);
  const mandate = must<Mandate>(r1[0], "mandate");
  const vaultPaused = must<boolean>(r1[1], "paused");
  const usdc = must<Address>(r1[2], "usdc");
  const [allowed, feed, pool] = must<readonly [boolean, Address, Address, number]>(r1[3], "tokenConfig");
  const last = must<bigint>(r1[4], "lastMultiplier");
  const changedAt = must<bigint>(r1[5], "multiplierChangedAt");
  if (feed === zeroAddress || pool === zeroAddress) throw new TokenNotCovered(token);

  const r2 = await call([
    { address: token, abi: b20AssetAbi, functionName: "decimals" },
    { address: token, abi: b20AssetAbi, functionName: "isPaused", args: [FEATURE_TRANSFER] },
    { address: token, abi: b20AssetAbi, functionName: "uiMultiplier" },
    { address: token, abi: b20AssetAbi, functionName: "effectiveAt" },
    { address: token, abi: b20AssetAbi, functionName: "policyId", args: [POLICY_SCOPES.sender] },
    { address: token, abi: b20AssetAbi, functionName: "policyId", args: [POLICY_SCOPES.receiver] },
    { address: token, abi: b20AssetAbi, functionName: "policyId", args: [POLICY_SCOPES.executor] },
    { address: token, abi: b20AssetAbi, functionName: "balanceOf", args: [pool] },
    { address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [pool] },
    { address: feed, abi: aggregatorV3Abi, functionName: "latestRoundData" },
    { address: pool, abi: clPoolAbi, functionName: "token0" },
    { address: pool, abi: clPoolAbi, functionName: "observe", args: [[mandate.twapWindow, 0]] },
    { address: mandate.calendar, abi: marketCalendarAbi, functionName: "isOpen", args: [now, mandate.sessionMode] },
  ]);
  const decimals = Number(must<number>(r2[0], `${token}.decimals()`));

  // Same validity rule as PriceLib.readFeed: positive answer, updatedAt in (0, now].
  const round = opt<readonly [bigint, bigint, bigint, bigint, bigint]>(r2[9]);
  const oracle =
    round !== null && round[1] > 0n && round[3] > 0n && round[3] <= now ? { price8: round[1], updatedAt: round[3], age: now - round[3] } : null;

  const token0 = opt<Address>(r2[10]);
  const cum = opt<readonly [readonly bigint[], readonly bigint[]]>(r2[11]);
  let dex: MarketState["dex"] = null;
  if (token0 !== null && cum !== null && mandate.twapWindow > 0 && cum[0].length === 2) {
    const tick = twapTick(cum[0][0]!, cum[0][1]!, mandate.twapWindow);
    if (Math.abs(tick) <= MAX_TICK) {
      const stockIsToken0 = token0.toLowerCase() === token.toLowerCase();
      const price8 = priceFromSqrt(sqrtPriceAtTick(tick), stockIsToken0, decimals, USDC_DECIMALS);
      if (price8 > 0n) dex = { tick, price8 };
    }
  }

  return {
    block: blockNumber,
    timestamp: now,
    token,
    symbol: symbolOf(token),
    decimals,
    feed,
    pool,
    allowed,
    vaultPaused,
    sessionMode: mandate.sessionMode,
    marketOpen: opt<boolean>(r2[12]),
    tokenPaused: opt<boolean>(r2[1]),
    oracle,
    dex,
    premiumBps: oracle && dex ? premiumBps(dex.price8, oracle.price8) : null,
    multiplier: { current: opt<bigint>(r2[2]), last, changedAt, effectiveAt: opt<bigint>(r2[3]) },
    policyIds: { sender: opt<bigint>(r2[4]), receiver: opt<bigint>(r2[5]), executor: opt<bigint>(r2[6]) },
    reserves: { stock: opt<bigint>(r2[7]), usdc: opt<bigint>(r2[8]) },
    limits: {
      maxStaleness: mandate.maxStaleness,
      twapWindow: mandate.twapWindow,
      maxPremiumBps: mandate.maxPremiumBps,
      multiplierCooldown: mandate.multiplierCooldown,
    },
  };
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/market.test.ts test/state.test.ts && npx tsc --noEmit`
Expected: PASS. `market.test.ts` has 8 tests, and `state.test.ts` is unchanged and still green.

- [ ] **Step 7: Commit**

```bash
git add src/chain/state.ts src/chain/market.ts test/fakes/fakeChain.ts test/market.test.ts
git commit -m "feat(agent): read every GuardLib market input at one block

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Off-chain verdict (GuardLib.checkMarket order)

**Files:**
- Create: `agent/src/guard/verdict.ts`
- Test: `agent/test/verdict.test.ts`

**Interfaces:**
- Consumes: `MarketState` (Task 2), `ReasonName` (`src/types.ts`), `valueUsd6` (`src/units.ts`).
- Produces (`src/guard/verdict.ts`):
  - `type Side = "BUY" | "SELL"`
  - `type MarketReason`: `"OK" | "TOKEN_PAUSED" | "MARKET_CLOSED" | "BAD_PRICE" | "FEED_STALE" | "MULTIPLIER_COOLDOWN" | "PREMIUM_TOO_HIGH"`
  - `interface Verdict { reason; ok; side; sizeUsd6: bigint; sizeShareBps: bigint | null; policyRestricted: boolean; multiplierPending: boolean }`
  - `multiplierBlocked(s: MarketState): boolean`
  - `marketReason(s: MarketState): MarketReason`
  - `verdict(s: MarketState, side: Side, sizeUsd6: bigint): Verdict`

The order is `GuardLib.checkMarket` without its policy check. A null read means the read failed and counts as GuardLib's `catch` branch: paused, closed, `BAD_PRICE`, or blocked.

- [ ] **Step 1: Write the failing test**

`agent/test/verdict.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MarketState } from "../src/chain/market.js";
import { marketReason, multiplierBlocked, verdict } from "../src/guard/verdict.js";

const NOW = 1_794_000_000n;
const DAY = 86_400n;

function state(over: Partial<MarketState> = {}): MarketState {
  return {
    block: 100n,
    timestamp: NOW,
    token: "0xb20000000000000000000078ee7ce2fE4908108C",
    symbol: "NVDAc",
    decimals: 8,
    feed: "0x7777777777777777777777777777777777777771",
    pool: "0x8888888888888888888888888888888888888888",
    allowed: true,
    vaultPaused: false,
    sessionMode: 0,
    marketOpen: true,
    tokenPaused: false,
    oracle: { price8: 20_000_000_000n, updatedAt: NOW - 30n, age: 30n },
    dex: { tick: -6932, price8: 20_100_000_000n },
    premiumBps: 50n,
    multiplier: { current: 10n ** 18n, last: 10n ** 18n, changedAt: 0n, effectiveAt: 0n },
    policyIds: { sender: 0n, receiver: 0n, executor: 0n },
    reserves: { stock: 5_000_000_000n, usdc: 10_000_000_000n }, // 50 shares at $200 = $10k, and $10k of USDC
    limits: { maxStaleness: 3600, twapWindow: 1800, maxPremiumBps: 100, multiplierCooldown: 86400 },
    ...over,
  };
}
const mult = (m: Partial<MarketState["multiplier"]>) => state({ multiplier: { ...state().multiplier, ...m } });

describe("marketReason", () => {
  it("is OK on a healthy market", () => {
    expect(marketReason(state())).toBe("OK");
  });

  it("follows the order of GuardLib.checkMarket", () => {
    const allWrong = state({
      tokenPaused: true,
      marketOpen: false,
      oracle: null,
      dex: null,
      premiumBps: null,
      multiplier: { current: 2n, last: 1n, changedAt: NOW, effectiveAt: NOW + 1n },
    });
    expect(marketReason(allWrong)).toBe("TOKEN_PAUSED");
    expect(marketReason({ ...allWrong, tokenPaused: false })).toBe("MARKET_CLOSED");
    expect(marketReason({ ...allWrong, tokenPaused: false, marketOpen: true })).toBe("BAD_PRICE");
    const stale = state({ oracle: { price8: 1n, updatedAt: NOW - 3601n, age: 3601n }, multiplier: allWrong.multiplier });
    expect(marketReason(stale)).toBe("FEED_STALE");
    expect(marketReason({ ...stale, oracle: state().oracle })).toBe("MULTIPLIER_COOLDOWN");
    expect(marketReason(state({ dex: null, premiumBps: null }))).toBe("BAD_PRICE");
    expect(marketReason(state({ premiumBps: 101n }))).toBe("PREMIUM_TOO_HIGH");
  });

  it("fails closed on unreadable pause and calendar reads", () => {
    expect(marketReason(state({ tokenPaused: null }))).toBe("TOKEN_PAUSED");
    expect(marketReason(state({ marketOpen: null }))).toBe("MARKET_CLOSED");
  });

  it("accepts values exactly at the limits", () => {
    expect(marketReason(state({ oracle: { price8: 1n, updatedAt: NOW - 3600n, age: 3600n } }))).toBe("OK");
    expect(marketReason(state({ premiumBps: 100n }))).toBe("OK");
  });
});

describe("multiplierBlocked (GuardLib.multiplierBlocked)", () => {
  it("blocks a multiplier that moved away from the last value the vault saw, or cannot be read", () => {
    expect(multiplierBlocked(mult({ current: 10n ** 18n + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ current: null }))).toBe(true);
    expect(multiplierBlocked(mult({ last: 0n, current: null }))).toBe(false); // last = 0 skips the comparison
  });

  it("blocks inside the cooldown after the vault saw a change", () => {
    expect(multiplierBlocked(mult({ changedAt: NOW - DAY + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ changedAt: NOW - DAY }))).toBe(false);
  });

  it("blocks a scheduled update and the cooldown after it", () => {
    expect(multiplierBlocked(mult({ effectiveAt: NOW + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ effectiveAt: NOW - DAY + 1n }))).toBe(true);
    expect(multiplierBlocked(mult({ effectiveAt: NOW - DAY }))).toBe(false);
    expect(multiplierBlocked(mult({ effectiveAt: null }))).toBe(true);
  });
});

describe("verdict", () => {
  it("sizes a BUY against the stock in the pool and a SELL against its USDC", () => {
    expect(verdict(state(), "BUY", 1_000_000_000n).sizeShareBps).toBe(1000n); // $1k of $10k of stock
    expect(verdict(state(), "SELL", 2_500_000_000n).sizeShareBps).toBe(2500n);
  });

  it("reports a size larger than the pool instead of refusing", () => {
    const v = verdict(state(), "SELL", 20_000_000_000n);
    expect(v.sizeShareBps).toBe(20_000n);
    expect(v.reason).toBe("OK");
  });

  it("leaves sizeShareBps null when the reserve is unknown or empty", () => {
    expect(verdict(state({ reserves: { stock: null, usdc: 0n } }), "BUY", 1n).sizeShareBps).toBeNull();
    expect(verdict(state({ reserves: { stock: null, usdc: 0n } }), "SELL", 1n).sizeShareBps).toBeNull();
    expect(verdict(state({ oracle: null }), "BUY", 1n).sizeShareBps).toBeNull();
  });

  it("reports policy restrictions and pending multiplier updates without refusing on them", () => {
    const v = verdict(state({ policyIds: { sender: 0n, receiver: 7n, executor: 0n } }), "BUY", 1n);
    expect(v.policyRestricted).toBe(true);
    expect(v.reason).toBe("OK");
    expect(verdict(state({ policyIds: { sender: null, receiver: 0n, executor: 0n } }), "BUY", 1n).policyRestricted).toBe(true);
    expect(verdict(state(), "BUY", 1n).multiplierPending).toBe(false);
    expect(verdict(mult({ effectiveAt: NOW + 10n }), "BUY", 1n).multiplierPending).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/verdict.test.ts`
Expected: FAIL, cannot resolve `../src/guard/verdict.js`.

- [ ] **Step 3: Implement**

`agent/src/guard/verdict.ts`:

```ts
import type { MarketState } from "../chain/market.js";
import type { ReasonName } from "../types.js";
import { valueUsd6 } from "../units.js";

export type Side = "BUY" | "SELL";

/** The GuardLib.checkMarket reasons the paid check can return. POLICY_BLOCKED is left out: it depends on the caller. */
export type MarketReason = Extract<
  ReasonName,
  "OK" | "TOKEN_PAUSED" | "MARKET_CLOSED" | "BAD_PRICE" | "FEED_STALE" | "MULTIPLIER_COOLDOWN" | "PREMIUM_TOO_HIGH"
>;

export interface Verdict {
  reason: MarketReason;
  ok: boolean;
  side: Side;
  sizeUsd6: bigint;
  /** sizeUsd6 against what the pool holds of the side the trade takes out, in bps. Information only, never a refusal. */
  sizeShareBps: bigint | null;
  /** A non-zero (or unreadable) transfer policy id: whether the caller passes depends on the caller, so it is reported. */
  policyRestricted: boolean;
  multiplierPending: boolean;
}

/** GuardLib.multiplierBlocked on a snapshot. A null read counts as blocked, like the library's catch branches. */
export function multiplierBlocked(s: MarketState): boolean {
  const { current, last, changedAt, effectiveAt } = s.multiplier;
  const now = s.timestamp;
  const cooldown = BigInt(s.limits.multiplierCooldown);
  if (last !== 0n && (current === null || current !== last)) return true;
  if (changedAt !== 0n && now < changedAt + cooldown) return true;
  if (effectiveAt === null) return true;
  if (effectiveAt > now) return true;
  return effectiveAt !== 0n && now < effectiveAt + cooldown;
}

/** GuardLib.checkMarket in the same order, minus the transfer-path policy check. */
export function marketReason(s: MarketState): MarketReason {
  if (s.tokenPaused !== false) return "TOKEN_PAUSED";
  if (s.marketOpen !== true) return "MARKET_CLOSED";
  if (s.oracle === null) return "BAD_PRICE";
  if (s.oracle.age > BigInt(s.limits.maxStaleness)) return "FEED_STALE";
  if (multiplierBlocked(s)) return "MULTIPLIER_COOLDOWN";
  if (s.dex === null || s.premiumBps === null) return "BAD_PRICE";
  if (s.premiumBps > BigInt(s.limits.maxPremiumBps)) return "PREMIUM_TOO_HIGH";
  return "OK";
}

export function verdict(s: MarketState, side: Side, sizeUsd6: bigint): Verdict {
  const reason = marketReason(s);
  // BUY takes stock out of the pool, SELL takes USDC out.
  let outUsd6: bigint | null = null;
  if (side === "SELL") outUsd6 = s.reserves.usdc;
  else if (s.reserves.stock !== null && s.oracle !== null) outUsd6 = valueUsd6(s.reserves.stock, s.oracle.price8, s.decimals);
  const ids = s.policyIds;
  return {
    reason,
    ok: reason === "OK",
    side,
    sizeUsd6,
    sizeShareBps: outUsd6 === null || outUsd6 === 0n ? null : (sizeUsd6 * 10_000n) / outUsd6,
    policyRestricted: [ids.sender, ids.receiver, ids.executor].some((id) => id !== 0n),
    multiplierPending: s.multiplier.effectiveAt === null || s.multiplier.effectiveAt > s.timestamp,
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/verdict.test.ts && npx tsc --noEmit`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/guard/verdict.ts test/verdict.test.ts
git commit -m "feat(agent): off-chain market verdict in GuardLib order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Dependencies, Coinbase NAV client, cache and rate limiter

**Files:**
- Modify: `agent/package.json`, `agent/package-lock.json` (via `npm install`)
- Create: `agent/src/guard/coinbase.ts`, `agent/src/guard/cache.ts`, `agent/src/guard/rateLimit.ts`
- Test: `agent/test/coinbase.test.ts`, `agent/test/cacheRateLimit.test.ts`

**Interfaces:**
- Consumes: `hono` (the `MiddlewareHandler` type).
- Produces:
  - `src/guard/coinbase.ts`:
    - `COINBASE_STOCKS_URL`
    - `interface NavQuote { symbol: string; navPrice: number | null; navUpdatedAt: string | null; multiplier: number }`
    - `type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>`
    - `class CoinbaseUnavailable extends Error`
    - `fetchNavQuotes(fetchFn?: FetchLike, baseUrl?: string, timeoutMs?: number): Promise<Map<Address, NavQuote>>`, keyed by checksummed address
  - `src/guard/cache.ts`: `class TtlCache<T> { constructor(ttlMs: number, now?: () => number, maxEntries?: number); get(key: string, load: () => Promise<T>): Promise<T> }`
  - `src/guard/rateLimit.ts`:
    - `class RateLimiter { constructor(perMinute: number, now?: () => number); take(key: string): number }`, which returns the retry delay in seconds, or 0
    - `clientKey(headers): string`
    - `rateLimit(limiter): MiddlewareHandler`, which answers 429 `{ error: "RATE_LIMITED", retryAfterSeconds }` with `Retry-After`

- [ ] **Step 1: Install the pinned dependencies**

```bash
npm install --save-exact hono@4.13.16 @hono/node-server@2.1.6 @x402/core@2.30.0 @x402/evm@2.30.0 @x402/hono@2.30.0 @x402/extensions@2.30.0 @x402/svm@2.30.0
npm install --save-exact --save-dev @x402/fetch@2.30.0
npm ls @x402/core
```

Expected: `npm ls` shows one `@x402/core@2.30.0`. Every other copy is `deduped`, including the one under `@coinbase/cdp-sdk@1.61.0`. `npm audit` still reports exactly the 3 known high findings (`@coinbase/cdp-sdk`, `abitype`, `zod`; README → "Known issue: npm audit"). The new packages add none. `@x402/svm` is there because `@coinbase/cdp-sdk/x402` imports it at runtime (see "Facts verified").

- [ ] **Step 2: Write the failing tests**

`agent/test/coinbase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { CoinbaseUnavailable, fetchNavQuotes, type FetchLike } from "../src/guard/coinbase.js";

const NVDA = "0xb20000000000000000000078ee7ce2fE4908108C";
// Shape copied from a live response on 2026-11-06 (description and icon fields dropped).
const NVDA_ROW = {
  contract_address: NVDA.toLowerCase(),
  symbol: "NVDAc",
  name: "NVIDIA Corporation",
  decimals: 8,
  multiplier: 1.0005379395763694,
  nav_price: 187.96606001,
  nav_price_updated_at: "2026-11-06T21:39:16Z",
};

function pages(...bodies: unknown[]): { fetchFn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: FetchLike = async (url) => {
    urls.push(url);
    const body = bodies[urls.length - 1];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchFn, urls };
}

describe("fetchNavQuotes", () => {
  it("walks next_page_token and keys quotes by checksummed address", async () => {
    const { fetchFn, urls } = pages(
      { tokens: [{ contract_address: "0xb200000000000000000000000000000000000001", symbol: "BIRDc", multiplier: 1 }], next_page_token: "abc=" },
      { tokens: [NVDA_ROW] },
    );
    const q = await fetchNavQuotes(fetchFn, "https://x.test/v1/tokenized-stocks");
    expect(urls).toEqual(["https://x.test/v1/tokenized-stocks?page_size=500", "https://x.test/v1/tokenized-stocks?page_size=500&page_token=abc%3D"]);
    expect(q.get(NVDA)).toEqual({ symbol: "NVDAc", navPrice: 187.96606001, navUpdatedAt: "2026-11-06T21:39:16Z", multiplier: 1.0005379395763694 });
    expect(q.get(getAddress("0xb200000000000000000000000000000000000001"))?.navPrice).toBeNull();
  });

  it("skips rows that do not match the schema", async () => {
    const { fetchFn } = pages({ tokens: [{ symbol: "BROKEN" }, { ...NVDA_ROW, contract_address: "not-an-address" }, NVDA_ROW] });
    const q = await fetchNavQuotes(fetchFn);
    expect([...q.keys()]).toEqual([NVDA]);
  });

  it("throws CoinbaseUnavailable on HTTP errors, bad bodies and network failures", async () => {
    const http500: FetchLike = async () => new Response("down", { status: 500 });
    const notJson: FetchLike = async () => new Response("<html>", { status: 200 });
    const wrongShape: FetchLike = async () => new Response(JSON.stringify({ items: [] }), { status: 200 });
    const offline: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    for (const f of [http500, notJson, wrongShape, offline]) {
      await expect(fetchNavQuotes(f)).rejects.toBeInstanceOf(CoinbaseUnavailable);
    }
  });

  it("stops after 10 pages instead of looping forever", async () => {
    const endless: FetchLike = async () => new Response(JSON.stringify({ tokens: [], next_page_token: "again" }), { status: 200 });
    await expect(fetchNavQuotes(endless)).rejects.toThrow(/more than 10 pages/);
  });
});
```

`agent/test/cacheRateLimit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/guard/cache.js";
import { clientKey, RateLimiter } from "../src/guard/rateLimit.js";

describe("TtlCache", () => {
  it("serves one load per key per TTL and shares the in-flight promise", async () => {
    let t = 0;
    let loads = 0;
    const cache = new TtlCache<number>(15_000, () => t);
    const load = async () => ++loads;
    const [a, b] = await Promise.all([cache.get("k", load), cache.get("k", load)]);
    expect([a, b, loads]).toEqual([1, 1, 1]);
    t = 14_999;
    expect(await cache.get("k", load)).toBe(1);
    t = 15_000;
    expect(await cache.get("k", load)).toBe(2);
    expect(await cache.get("other", load)).toBe(3);
  });

  it("does not cache a failed load", async () => {
    const cache = new TtlCache<number>(15_000, () => 0);
    await expect(cache.get("k", async () => Promise.reject(new Error("rpc down")))).rejects.toThrow("rpc down");
    expect(await cache.get("k", async () => 7)).toBe(7);
  });
});

describe("RateLimiter", () => {
  it("allows perMinute requests per key per minute, then gives a retry delay", () => {
    let t = 0;
    const rl = new RateLimiter(2, () => t);
    expect([rl.take("a"), rl.take("a"), rl.take("b")]).toEqual([0, 0, 0]);
    t = 20_000;
    expect(rl.take("a")).toBe(40);
    t = 60_000;
    expect(rl.take("a")).toBe(0);
  });
});

describe("clientKey", () => {
  const h = (m: Record<string, string>) => new Headers(m);
  it("prefers Fly-Client-IP, then the first X-Forwarded-For hop, then one shared bucket", () => {
    expect(clientKey(h({ "fly-client-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientKey(h({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" }))).toBe("2.2.2.2");
    expect(clientKey(h({}))).toBe("local");
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run test/coinbase.test.ts test/cacheRateLimit.test.ts`
Expected: FAIL, cannot resolve `../src/guard/coinbase.js` and `../src/guard/cache.js`.

- [ ] **Step 4: Implement**

`agent/src/guard/coinbase.ts`:

```ts
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

/** docs.base.org/sdks/tokenized-stocks/overview: read-only, no API key. */
export const COINBASE_STOCKS_URL = "https://api.coinbase.com/v1/tokenized-stocks";
const PAGE_SIZE = 500; // the documented cap
const MAX_PAGES = 10;

/** Only the fields the guard shows. nav_price is absent on many tokens; it already includes the multiplier. */
const tokenSchema = z.object({
  contract_address: z.string(),
  symbol: z.string(),
  multiplier: z.number(),
  nav_price: z.number().optional(),
  nav_price_updated_at: z.string().optional(),
});
const pageSchema = z.object({ tokens: z.array(z.unknown()), next_page_token: z.string().optional() });

export interface NavQuote {
  symbol: string;
  /** Coinbase does not document the currency; the dashboard labels it "NAV", not "USD". */
  navPrice: number | null;
  navUpdatedAt: string | null;
  multiplier: number;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export class CoinbaseUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CoinbaseUnavailable";
  }
}

/** Walks every page of GET /v1/tokenized-stocks. Tokens that fail the schema are skipped, not fatal. */
export async function fetchNavQuotes(
  fetchFn: FetchLike = fetch,
  baseUrl = COINBASE_STOCKS_URL,
  timeoutMs = 5_000,
): Promise<Map<Address, NavQuote>> {
  const quotes = new Map<Address, NavQuote>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${baseUrl}?page_size=${PAGE_SIZE}${pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : ""}`;
    let body: unknown;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch (e) {
      throw new CoinbaseUnavailable(`tokenized-stocks list failed: ${(e as Error).message}`, { cause: e });
    }
    const p = pageSchema.safeParse(body);
    if (!p.success) throw new CoinbaseUnavailable("tokenized-stocks list has an unexpected shape");
    for (const raw of p.data.tokens) {
      const t = tokenSchema.safeParse(raw);
      if (!t.success || !isAddress(t.data.contract_address, { strict: false })) continue;
      quotes.set(getAddress(t.data.contract_address), {
        symbol: t.data.symbol,
        navPrice: t.data.nav_price ?? null,
        navUpdatedAt: t.data.nav_price_updated_at ?? null,
        multiplier: t.data.multiplier,
      });
    }
    pageToken = p.data.next_page_token;
    if (!pageToken) return quotes;
  }
  throw new CoinbaseUnavailable(`tokenized-stocks list has more than ${MAX_PAGES} pages`);
}
```

`agent/src/guard/cache.ts`:

```ts
/**
 * A time-to-live cache that also shares the in-flight promise, so a burst of requests for one key costs one RPC round.
 * A rejected load is never cached: the next request tries again.
 */
export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 1_000,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    if (this.entries.size >= this.maxEntries) this.entries.clear(); // keys are bounded in practice; this is a backstop
    const value = load();
    this.entries.set(key, { at: this.now(), value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
}
```

`agent/src/guard/rateLimit.ts`:

```ts
import type { MiddlewareHandler } from "hono";

/** Fixed one-minute window per client key. In memory: one Fly machine runs the guard. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Seconds until the caller may retry, or 0 when this request is allowed. */
  take(key: string): number {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) {
      if (this.windows.size > 10_000) this.windows.clear();
      this.windows.set(key, { start: t, count: 1 });
      return 0;
    }
    if (w.count >= this.perMinute) return Math.ceil((w.start + 60_000 - t) / 1000);
    w.count += 1;
    return 0;
  }
}

/**
 * Fly's proxy sets Fly-Client-IP; the first X-Forwarded-For hop is the fallback for other proxies. Without either
 * (a local run) every caller shares one bucket, which is the safe direction to fail.
 */
export function clientKey(headers: { get(name: string): string | null | undefined }): string {
  return headers.get("fly-client-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function rateLimit(limiter: RateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const retry = limiter.take(clientKey(c.req.raw.headers));
    if (retry > 0) {
      c.header("Retry-After", String(retry));
      return c.json({ error: "RATE_LIMITED", retryAfterSeconds: retry }, 429);
    }
    await next();
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/coinbase.test.ts test/cacheRateLimit.test.ts && npx tsc --noEmit`
Expected: PASS, 4 + 4 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/guard/coinbase.ts src/guard/cache.ts src/guard/rateLimit.ts test/coinbase.test.ts test/cacheRateLimit.test.ts
git commit -m "feat(agent): Coinbase NAV client, TTL cache and per-IP rate limit for the guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: HTTP API and the x402 paid check

**Files:**
- Create: `agent/src/guard/x402.ts`, `agent/src/guard/views.ts`, `agent/src/guard/app.ts`
- Create: `agent/test/fakes/fakeFacilitator.ts`
- Test: `agent/test/guardApp.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 2–4: `readMarketState`, `TokenNotCovered`, `MarketState`, `verdict`, `TtlCache`, `fetchNavQuotes`, `CoinbaseUnavailable`, `FetchLike`, `NavQuote`, `RateLimiter`, `rateLimit`.
  - Existing: `previewIntent` (`src/chain/preview.ts`), `StateUnavailable`, `ACTIONS`, `actionId`, `SESSION_MODES` (`src/types.ts`), `usdToUsdc6`, `USDC_DECIMALS` (`src/units.ts`), `BASKET`.
  - Test fakes: `marketScene`, `FEEDS`, `VAULT`, `EXECUTOR`.
- Produces:
  - `src/guard/x402.ts`:
    - `BASE_NETWORK = "eip155:8453"`, `CHECK_PRICE = "$0.01"`, `CHECK_PRICE_USDC6 = 10_000n`
    - `checkRoutes(payTo: Address, builderCode?: string): RoutesConfig`
    - `checkPayment(facilitator: FacilitatorClient, payTo: Address, builderCode?: string): MiddlewareHandler`
  - `src/guard/views.ts`:
    - `resolveToken(param: string): Address | null`, which accepts basket tokens only
    - `toJson(value: unknown): string`, which writes bigints as decimal strings
    - `stateView(s, nav)`, `verdictView(s, v)`
  - `src/guard/app.ts`:
    - `type GuardClient = Pick<PublicClient, "getBlock" | "multicall" | "readContract">`
    - `interface GuardDeps { client; vault; executor; payTo; facilitator; builderCode?; rateLimitPerMinute; corsOrigins: string[]; fetchFn?; now? }`
    - `createGuardApp(d: GuardDeps): Hono`
  - Test fakes (`test/fakes/fakeFacilitator.ts`):
    - `FakeFacilitator`, which accepts every payment and records `verified` and `settled`
    - `BUYER`
    - `fakeBuyer(): x402Client`, whose signer returns a fixed signature

Middleware order on `/check`:
1. CORS.
2. The rate limit.
3. Query validation: 400/404 before any 402.
4. The x402 payment middleware.
5. The handler.

A handler answer of 503 (RPC down) or 404 makes the middleware cancel settlement.

- [ ] **Step 1: Write the test fakes**

`agent/test/fakes/fakeFacilitator.ts`:

```ts
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { Address, Hex } from "viem";

/** Accepts every payment and records what it was asked to verify and settle. No network, no keys. */
export class FakeFacilitator implements FacilitatorClient {
  verified: PaymentRequirements[] = [];
  settled: { payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
  extensions: string[] = [];

  async getSupported() {
    return { kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" as const }], extensions: this.extensions, signers: {} };
  }

  async verify(_payload: PaymentPayload, requirements: PaymentRequirements) {
    this.verified.push(requirements);
    return { isValid: true, payer: BUYER };
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements) {
    this.settled.push({ payload, requirements });
    return { success: true, transaction: `0x${"ab".repeat(32)}`, network: requirements.network, payer: BUYER };
  }
}

export const BUYER: Address = "0x9999999999999999999999999999999999999999";

/** An x402 client whose signer returns a fixed signature: enough for a facilitator that does not check it. */
export function fakeBuyer(): x402Client {
  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: { address: BUYER, signTypedData: async () => `0x${"11".repeat(65)}` as Hex },
  });
  return client;
}
```

- [ ] **Step 2: Write the failing test**

`agent/test/guardApp.test.ts`:

```ts
import { decodePaymentResponseHeader, wrapFetchWithPayment } from "@x402/fetch";
import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { BASKET, USDC } from "../src/addresses.js";
import { createGuardApp, type GuardClient } from "../src/guard/app.js";
import type { FetchLike } from "../src/guard/coinbase.js";
import { EXECUTOR, FEEDS, VAULT, marketScene, type FakeChain } from "./fakes/fakeChain.js";
import { FakeFacilitator, fakeBuyer } from "./fakes/fakeFacilitator.js";

const NVDA = BASKET[0]!.address;
const NAV_ROW = { contract_address: NVDA.toLowerCase(), symbol: "NVDAc", multiplier: 1.0005, nav_price: 200.1, nav_price_updated_at: "2026-11-06T21:39:16Z" };
const coinbaseUp: FetchLike = async () => new Response(JSON.stringify({ tokens: [NAV_ROW] }), { status: 200 });
const coinbaseDown: FetchLike = async () => new Response("down", { status: 503 });

function setup(opts: { chain?: FakeChain; reason?: number; fetchFn?: FetchLike; perMinute?: number; builderCode?: string } = {}) {
  const chain = opts.chain ?? marketScene();
  const reads: { account: unknown; blockNumber: unknown; args: unknown }[] = [];
  const client = {
    ...chain.client(),
    readContract: async (p: { account: unknown; blockNumber: unknown; args: unknown }) => {
      reads.push(p);
      if (opts.reason === undefined) throw new Error("execution reverted");
      return opts.reason;
    },
  } as unknown as GuardClient;
  const facilitator = new FakeFacilitator();
  const app = createGuardApp({
    client,
    vault: VAULT,
    executor: EXECUTOR,
    payTo: VAULT,
    facilitator,
    rateLimitPerMinute: opts.perMinute ?? 60,
    corsOrigins: ["https://maatonbase.xyz"],
    fetchFn: opts.fetchFn ?? coinbaseUp,
    ...(opts.builderCode ? { builderCode: opts.builderCode } : {}),
  });
  const appFetch = (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
  const paidFetch = wrapFetchWithPayment(appFetch, fakeBuyer());
  return { app, chain, reads, facilitator, appFetch, paidFetch };
}

const url = (path: string) => `http://guard.test${path}`;

describe("guard app: free endpoints", () => {
  it("GET /health", async () => {
    const res = await setup().app.request("/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /state/:token reads the chain and adds the Coinbase NAV", async () => {
    const res = await setup().app.request("/state/nvdac");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      symbol: "NVDAc",
      block: "100",
      marketStatus: "OPEN",
      sessionMode: "REGULAR",
      paused: false,
      chainlink: { price: "200.00363238", ageSeconds: "30" },
      dexTwap: { price: "200.00363238", tick: -6932, windowSeconds: 1800 },
      premiumBps: "0",
      multiplier: { pendingUpdate: false },
      pool: { stock: "50", usdc: "10000" },
      nav: { price: 200.1, multiplier: 1.0005 },
    });
  });

  it("still answers /state when Coinbase is down, with nav null", async () => {
    const res = await setup({ fetchFn: coinbaseDown }).app.request(`/state/${NVDA}`);
    expect(res.status).toBe(200);
    expect((await res.json()).nav).toBeNull();
  });

  it("404s a token outside the basket and 503s when the RPC is down", async () => {
    const { app } = setup();
    expect((await app.request(`/state/${USDC}`)).status).toBe(404);
    expect((await app.request("/state/TSLAc")).status).toBe(404);
    const down = setup({ chain: marketScene().fail(VAULT, "mandate") });
    const res = await down.app.request("/state/NVDAc");
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("UNKNOWN");
  });

  it("caches state for 15 seconds", async () => {
    const { app, chain } = setup();
    await app.request("/state/NVDAc");
    const n = chain.calls.length;
    await app.request("/state/NVDAc");
    expect(chain.calls.length).toBe(n);
  });

  it("POST /preview calls previewIntent as the executor, pinned to the latest block", async () => {
    const { app, reads } = setup({ reason: 0 });
    const res = await app.request("/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "BUY", token: NVDA, amount: "5000000" }),
    });
    expect(await res.json()).toEqual({ reason: "OK", allowed: true, block: "100" });
    expect(reads[0]?.account).toBe(EXECUTOR);
    expect(reads[0]?.blockNumber).toBe(100n);
    expect((reads[0]?.args as [{ action: number; amount: bigint }])[0]).toMatchObject({ action: 0, amount: 5_000_000n });
  });

  it("POST /preview names the refusal, rejects a bad body and 503s a failed eth_call", async () => {
    const refused = await setup({ reason: 6 }).app.request("/preview", {
      method: "POST",
      body: JSON.stringify({ action: "SELL", token: NVDA, amount: "1" }),
    });
    expect(await refused.json()).toMatchObject({ reason: "MARKET_CLOSED", allowed: false });
    const bad = await setup({ reason: 0 }).app.request("/preview", { method: "POST", body: JSON.stringify({ action: "BUY", token: NVDA, amount: "-1" }) });
    expect(bad.status).toBe(400);
    const notJson = await setup({ reason: 0 }).app.request("/preview", { method: "POST", body: "{" });
    expect(notJson.status).toBe(400);
    const down = await setup().app.request("/preview", { method: "POST", body: JSON.stringify({ action: "BUY", token: NVDA, amount: "1" }) });
    expect(down.status).toBe(503);
  });

  it("rate limits per client IP with Retry-After", async () => {
    const { app } = setup({ perMinute: 2 });
    const h = { "fly-client-ip": "203.0.113.7" };
    expect((await app.request("/state/NVDAc", { headers: h })).status).toBe(200);
    expect((await app.request("/state/NVDAc", { headers: h })).status).toBe(200);
    const limited = await app.request("/state/NVDAc", { headers: h });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await app.request("/state/NVDAc", { headers: { "fly-client-ip": "203.0.113.8" } })).status).toBe(200);
  });

  it("allows GET from the website origin (CORS)", async () => {
    const res = await setup().app.request("/state/NVDAc", { headers: { origin: "https://maatonbase.xyz" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://maatonbase.xyz");
  });
});

describe("guard app: paid GET /check", () => {
  const CHECK = "/check?token=NVDAc&side=buy&sizeUSD=1000";

  it("answers 402 with payTo = vault and 0.01 USDC on Base", async () => {
    const res = await setup().app.request(CHECK);
    expect(res.status).toBe(402);
    const header = res.headers.get("payment-required");
    expect(header).toBeTruthy();
    const required = JSON.parse(Buffer.from(header!, "base64").toString("utf8"));
    expect(required.x402Version).toBe(2);
    expect(required.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      payTo: VAULT,
    });
    expect(getAddress(required.accepts[0].asset)).toBe(getAddress(USDC));
  });

  it("returns the verdict after payment and settles once to the vault", async () => {
    const { paidFetch, facilitator } = setup();
    const res = await paidFetch(url(CHECK));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ symbol: "NVDAc", side: "BUY", sizeUSD: "1000", reason: "OK", ok: true, premiumBps: "0", sizeShareBps: "999" }); // $1000 of 50 NVDAc at $200.0036
    expect(facilitator.settled).toHaveLength(1);
    expect(facilitator.settled[0]?.requirements).toMatchObject({ payTo: VAULT, amount: "10000" });
    expect(decodePaymentResponseHeader(res.headers.get("payment-response")!)).toMatchObject({ success: true });
  });

  it("returns a refusal reason as a paid 200: the verdict is the product", async () => {
    const chain = marketScene().set(FEEDS[0]!, "latestRoundData", [1n, 20_000_363_238n, 0n, 1_794_000_000n - 7200n, 1n]);
    const { paidFetch, facilitator } = setup({ chain });
    const res = await paidFetch(url(CHECK));
    expect((await res.json()).reason).toBe("FEED_STALE");
    expect(facilitator.settled).toHaveLength(1);
  });

  it("does not settle when the RPC is down (503 UNKNOWN)", async () => {
    const { paidFetch, facilitator } = setup({ chain: marketScene().fail(VAULT, "mandate") });
    const res = await paidFetch(url(CHECK));
    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("UNKNOWN");
    expect(facilitator.verified).toHaveLength(1);
    expect(facilitator.settled).toHaveLength(0);
  });

  it("rejects bad queries before asking for payment", async () => {
    const { app, facilitator } = setup();
    for (const q of ["/check?token=NVDAc&side=HOLD&sizeUSD=1", "/check?token=NVDAc&side=BUY&sizeUSD=0", "/check?token=NVDAc&side=BUY", "/check?token=TSLAc&side=BUY&sizeUSD=1"]) {
      const res = await app.request(q);
      expect([400, 404]).toContain(res.status);
      expect(res.headers.get("payment-required")).toBeNull();
    }
    expect(facilitator.verified).toHaveLength(0);
  });

  it("declares the builder-code extension when a code is configured", async () => {
    const res = await setup({ builderCode: "bc_maat" }).app.request(CHECK);
    const required = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString("utf8"));
    expect(required.extensions["builder-code"].info).toMatchObject({ a: "bc_maat" });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/guardApp.test.ts`
Expected: FAIL, cannot resolve `../src/guard/app.js`.

- [ ] **Step 4: Implement the payment route**

`agent/src/guard/x402.ts`:

```ts
import { x402ResourceServer, type FacilitatorClient, type RoutesConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { BUILDER_CODE, builderCodeResourceServerExtension, declareBuilderCodeExtension } from "@x402/extensions/builder-code";
import { paymentMiddleware } from "@x402/hono";
import type { MiddlewareHandler } from "hono";
import type { Address } from "viem";

/** CAIP-2 id of Base mainnet. The exact scheme turns a "$" price into USDC on this network. */
export const BASE_NETWORK = "eip155:8453" as const;
export const CHECK_PRICE = "$0.01";
/** CHECK_PRICE in USDC units: what a buyer signs for and what reaches payTo. */
export const CHECK_PRICE_USDC6 = 10_000n;

export function checkRoutes(payTo: Address, builderCode?: string): RoutesConfig {
  return {
    "GET /check": {
      accepts: { scheme: "exact", price: CHECK_PRICE, network: BASE_NETWORK, payTo, maxTimeoutSeconds: 120 },
      description: "Market-safety verdict for one B20 stock trade on Base (GuardLib.checkMarket off-chain)",
      mimeType: "application/json",
      ...(builderCode ? { extensions: { [BUILDER_CODE]: declareBuilderCodeExtension(builderCode) } } : {}),
    },
  };
}

/**
 * Charges CHECK_PRICE for GET /check and settles after the handler, only when it answers below 400. The facilitator
 * submits the EIP-3009 transfer and pays its gas; the guard never signs.
 */
export function checkPayment(facilitator: FacilitatorClient, payTo: Address, builderCode?: string): MiddlewareHandler {
  const server = new x402ResourceServer(facilitator).register(BASE_NETWORK, new ExactEvmScheme());
  if (builderCode) server.registerExtension(builderCodeResourceServerExtension);
  return paymentMiddleware(checkRoutes(payTo, builderCode), server);
}
```

- [ ] **Step 5: Implement the JSON views**

`agent/src/guard/views.ts`:

```ts
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import { BASKET } from "../addresses.js";
import type { MarketState } from "../chain/market.js";
import { PRICE_DECIMALS } from "../chain/priceMath.js";
import { SESSION_MODES } from "../types.js";
import { USDC_DECIMALS } from "../units.js";
import type { NavQuote } from "./coinbase.js";
import type { Verdict } from "./verdict.js";

/** A basket symbol (any case) or address. Anything else is not served: the guard only knows Maat's vault tokens. */
export function resolveToken(param: string): Address | null {
  if (isAddress(param, { strict: false })) {
    const a = getAddress(param);
    return BASKET.some((t) => getAddress(t.address) === a) ? a : null;
  }
  const t = BASKET.find((b) => b.symbol.toLowerCase() === param.toLowerCase());
  return t ? getAddress(t.address) : null;
}

/** JSON.stringify with bigints as decimal strings: JSON numbers lose precision past 2^53. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

const usd8 = (v: bigint) => formatUnits(v, PRICE_DECIMALS);

export function stateView(s: MarketState, nav: NavQuote | null) {
  return {
    token: s.token,
    symbol: s.symbol ?? null,
    block: s.block,
    timestamp: s.timestamp,
    marketStatus: s.marketOpen === null ? "UNKNOWN" : s.marketOpen ? "OPEN" : "CLOSED",
    sessionMode: SESSION_MODES[s.sessionMode] ?? s.sessionMode,
    paused: s.tokenPaused,
    chainlink: s.oracle && { price: usd8(s.oracle.price8), updatedAt: s.oracle.updatedAt, ageSeconds: s.oracle.age },
    dexTwap: s.dex && { price: usd8(s.dex.price8), tick: s.dex.tick, windowSeconds: s.limits.twapWindow },
    premiumBps: s.premiumBps,
    multiplier: {
      current: s.multiplier.current,
      lastSeenByVault: s.multiplier.last,
      changedAt: s.multiplier.changedAt,
      effectiveAt: s.multiplier.effectiveAt,
      pendingUpdate: s.multiplier.effectiveAt === null || s.multiplier.effectiveAt > s.timestamp,
    },
    policyIds: s.policyIds,
    pool: {
      address: s.pool,
      stock: s.reserves.stock === null ? null : formatUnits(s.reserves.stock, s.decimals),
      usdc: s.reserves.usdc === null ? null : formatUnits(s.reserves.usdc, USDC_DECIMALS),
    },
    nav: nav && { price: nav.navPrice, updatedAt: nav.navUpdatedAt, multiplier: nav.multiplier, source: "api.coinbase.com" },
    limits: s.limits,
  };
}

export function verdictView(s: MarketState, v: Verdict) {
  return {
    token: s.token,
    symbol: s.symbol ?? null,
    side: v.side,
    sizeUSD: formatUnits(v.sizeUsd6, USDC_DECIMALS),
    reason: v.reason,
    ok: v.ok,
    block: s.block,
    timestamp: s.timestamp,
    feedAgeSeconds: s.oracle?.age ?? null,
    chainlinkPrice: s.oracle ? usd8(s.oracle.price8) : null,
    dexTwapPrice: s.dex ? usd8(s.dex.price8) : null,
    premiumBps: s.premiumBps,
    sizeShareBps: v.sizeShareBps,
    policyRestricted: v.policyRestricted,
    multiplierPending: v.multiplierPending,
    limits: s.limits,
  };
}
```

- [ ] **Step 6: Implement the app**

`agent/src/guard/app.ts`:

```ts
import type { FacilitatorClient } from "@x402/core/server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { isAddress, type Address, type PublicClient } from "viem";
import { z } from "zod";
import { readMarketState, TokenNotCovered, type MarketState } from "../chain/market.js";
import { previewIntent } from "../chain/preview.js";
import { StateUnavailable } from "../chain/state.js";
import { ACTIONS, actionId } from "../types.js";
import { usdToUsdc6 } from "../units.js";
import { TtlCache } from "./cache.js";
import { CoinbaseUnavailable, fetchNavQuotes, type FetchLike, type NavQuote } from "./coinbase.js";
import { rateLimit, RateLimiter } from "./rateLimit.js";
import { stateView, resolveToken, toJson, verdictView } from "./views.js";
import { verdict } from "./verdict.js";
import { checkPayment } from "./x402.js";

export type GuardClient = Pick<PublicClient, "getBlock" | "multicall" | "readContract">;

export interface GuardDeps {
  client: GuardClient;
  vault: Address;
  executor: Address;
  payTo: Address;
  facilitator: FacilitatorClient;
  builderCode?: string;
  rateLimitPerMinute: number;
  corsOrigins: string[];
  fetchFn?: FetchLike;
  now?: () => number;
}

const ZERO32 = `0x${"00".repeat(32)}` as const;
const uint = z.string().regex(/^\d{1,78}$/, "a non-negative integer string").transform((v) => BigInt(v));
const previewBody = z.object({
  action: z.enum(ACTIONS),
  token: z.string().refine((v) => isAddress(v, { strict: false }), "not an address"),
  amount: uint,
  minOut: uint.optional(),
  payee: z.string().refine((v) => isAddress(v, { strict: false }), "not an address").optional(),
});
const checkQuery = z.object({
  token: z.string(),
  side: z.string().transform((v) => v.toUpperCase()).pipe(z.enum(["BUY", "SELL"])),
  sizeUSD: z.coerce.number().positive().max(1_000_000_000),
});

function send(c: Context, body: unknown, status: 200 | 400 | 404 | 503 = 200) {
  return c.body(toJson(body), status, { "content-type": "application/json; charset=utf-8" });
}

export function createGuardApp(d: GuardDeps): Hono {
  const now = d.now ?? Date.now;
  const states = new TtlCache<MarketState>(15_000, now);
  const previews = new TtlCache<{ reason: string; block: bigint }>(15_000, now);
  const navs = new TtlCache<Map<Address, NavQuote>>(60_000, now);

  const state = (token: Address) => states.get(token, () => readMarketState(d.client, d.vault, token));
  const nav = async (token: Address): Promise<NavQuote | null> => {
    try {
      return (await navs.get("all", () => fetchNavQuotes(d.fetchFn))).get(token) ?? null;
    } catch (e) {
      if (e instanceof CoinbaseUnavailable) return null; // NAV is context; the verdict reads only the chain
      throw e;
    }
  };
  // RPC down, or a token the vault does not cover, become answers instead of 500s. 503 also cancels x402 settlement.
  const failure = (c: Context, e: unknown) => {
    if (e instanceof TokenNotCovered) return send(c, { error: "TOKEN_NOT_COVERED" }, 404);
    if (e instanceof StateUnavailable) return send(c, { reason: "UNKNOWN", error: e.message }, 503);
    throw e;
  };

  const app = new Hono();
  app.use("*", cors({ origin: d.corsOrigins, allowMethods: ["GET", "POST"] }));
  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/state/*", rateLimit(new RateLimiter(d.rateLimitPerMinute, now)));
  app.use("/preview", rateLimit(new RateLimiter(d.rateLimitPerMinute, now)));
  app.use("/check", rateLimit(new RateLimiter(d.rateLimitPerMinute, now)));

  app.get("/state/:token", async (c) => {
    const token = resolveToken(c.req.param("token"));
    if (!token) return send(c, { error: "TOKEN_NOT_COVERED" }, 404);
    try {
      const [s, q] = await Promise.all([state(token), nav(token)]);
      return send(c, stateView(s, q));
    } catch (e) {
      return failure(c, e);
    }
  });

  app.post("/preview", async (c) => {
    const parsed = previewBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return send(c, { error: "BAD_REQUEST", issues: parsed.error.issues.map((i) => i.message) }, 400);
    const p = parsed.data;
    const intent = {
      id: ZERO32,
      action: actionId(p.action),
      token: p.token as Address,
      amount: p.amount,
      minOut: p.minOut ?? 0n,
      payee: (p.payee ?? "0x0000000000000000000000000000000000000000") as Address,
      rationaleHash: ZERO32,
    };
    const key = toJson(intent);
    try {
      const r = await previews.get(key, async () => {
        const block = await d.client.getBlock({ blockTag: "latest" }).catch((e: unknown) => {
          throw new StateUnavailable("getBlock failed", { cause: e });
        });
        if (block.number === null) throw new StateUnavailable("latest block has no number");
        const pr = await previewIntent(d.client, d.vault, d.executor, intent, block.number);
        if (pr.result === "UNKNOWN") throw new StateUnavailable(pr.error ?? "previewIntent failed");
        return { reason: pr.result, block: block.number };
      });
      return send(c, { reason: r.reason, allowed: r.reason === "OK", block: r.block });
    } catch (e) {
      return failure(c, e);
    }
  });

  // Validate before the payment middleware, so a bad request costs the caller nothing and signs nothing.
  app.use("/check", async (c, next) => {
    const q = checkQuery.safeParse(c.req.query());
    if (!q.success) return send(c, { error: "BAD_REQUEST", issues: q.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    if (!resolveToken(q.data.token)) return send(c, { error: "TOKEN_NOT_COVERED" }, 404);
    await next();
  });
  app.use("/check", checkPayment(d.facilitator, d.payTo, d.builderCode));
  app.get("/check", async (c) => {
    const q = checkQuery.parse(c.req.query());
    const token = resolveToken(q.token)!;
    try {
      const s = await state(token);
      return send(c, verdictView(s, verdict(s, q.side, usdToUsdc6(q.sizeUSD))));
    } catch (e) {
      return failure(c, e);
    }
  });

  return app;
}
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/guardApp.test.ts && npx tsc --noEmit`
Expected: PASS, 15 tests. The paid tests go through the real `@x402/fetch` client and the real `@x402/hono` middleware; only the facilitator and the signature are fake. In particular:
- the 402 carries `payTo` = vault, `amount` `"10000"` and Base USDC;
- a paid 200 settles exactly once and has `PAYMENT-RESPONSE`;
- a 503 is verified but never settled.

- [ ] **Step 8: Commit**

```bash
git add src/guard/x402.ts src/guard/views.ts src/guard/app.ts test/fakes/fakeFacilitator.ts test/guardApp.test.ts
git commit -m "feat(agent): guard HTTP API with the x402 paid check paying the vault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Guard config, entrypoint and boot check

**Files:**
- Modify: `agent/src/config.ts` (export `field` and `address`)
- Create: `agent/src/guard/config.ts`, `agent/src/guard/main.ts`, `agent/.env.guard.example`
- Modify: `agent/package.json` (script `guard`)
- Modify: `.gitignore` (root)
- Test: `agent/test/guardConfig.test.ts`

**Interfaces:**
- Consumes: `createGuardApp` (Task 5); `field` and `address` (`src/config.ts`); `createCdpFacilitatorClient` (`@coinbase/cdp-sdk/x402`); `HTTPFacilitatorClient` (`@x402/core/server`); `serve` (`@hono/node-server`); `BUILDER_CODE_PATTERN` (`@x402/extensions/builder-code`).
- Produces:
  - `src/guard/config.ts`:
    - `interface GuardConfig { rpcUrl; vault; executor; payTo; port; rateLimitPerMinute; corsOrigins: string[]; builderCode: string | undefined; facilitator: { kind: "url"; url } | { kind: "cdp"; apiKeyId; apiKeySecret } }`
    - `loadGuardConfig(env?): GuardConfig`
  - `npm run guard`.

- [ ] **Step 1: Export the env helpers**

In `agent/src/config.ts`, add `export` to two declarations and leave their bodies as they are:

```ts
export const field = <T extends z.ZodType>(schema: T) => z.preprocess(blank, schema);
```

```ts
export const address = (name: string) =>
```

- [ ] **Step 2: Write the failing test**

`agent/test/guardConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGuardConfig } from "../src/guard/config.js";

const base = {
  BASE_RPC_URL: "https://mainnet.base.org",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  CDP_API_KEY_ID: "key-id",
  CDP_API_KEY_SECRET: "key-secret",
};

describe("loadGuardConfig", () => {
  it("pays the vault through the CDP facilitator by default", () => {
    const c = loadGuardConfig(base);
    expect(c.payTo).toBe(base.MAAT_VAULT);
    expect(c.port).toBe(8080);
    expect(c.rateLimitPerMinute).toBe(60);
    expect(c.corsOrigins).toEqual(["https://maatonbase.xyz", "https://www.maatonbase.xyz"]);
    expect(c.builderCode).toBeUndefined();
    expect(c.facilitator).toEqual({ kind: "cdp", apiKeyId: "key-id", apiKeySecret: "key-secret" });
  });

  it("takes the S4 fallback payee and a facilitator URL", () => {
    const c = loadGuardConfig({
      ...base,
      GUARD_PAY_TO: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      GUARD_FACILITATOR_URL: "http://127.0.0.1:4022",
      CDP_API_KEY_ID: "",
      CDP_API_KEY_SECRET: "",
    });
    expect(c.payTo).toBe("0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD");
    expect(c.facilitator).toEqual({ kind: "url", url: "http://127.0.0.1:4022" });
  });

  it("treats blank values from the env file as unset", () => {
    const c = loadGuardConfig({ ...base, GUARD_PAY_TO: "", GUARD_PORT: "", GUARD_BUILDER_CODE: "", GUARD_FACILITATOR_URL: "", CDP_WALLET_SECRET: "" });
    expect(c.payTo).toBe(base.MAAT_VAULT);
    expect(c.port).toBe(8080);
    expect(c.facilitator.kind).toBe("cdp");
  });

  it("refuses to start with a wallet secret in its env", () => {
    expect(() => loadGuardConfig({ ...base, CDP_WALLET_SECRET: "secret" })).toThrow(/never signs/);
  });

  it("needs the CDP API key when no facilitator URL is set", () => {
    expect(() => loadGuardConfig({ ...base, CDP_API_KEY_SECRET: "" })).toThrow(/CDP_API_KEY_ID and CDP_API_KEY_SECRET/);
  });

  it("validates the builder code and the port", () => {
    expect(loadGuardConfig({ ...base, GUARD_BUILDER_CODE: "bc_maat" }).builderCode).toBe("bc_maat");
    expect(() => loadGuardConfig({ ...base, GUARD_BUILDER_CODE: "Bad-Code" })).toThrow(/GUARD_BUILDER_CODE/);
    expect(() => loadGuardConfig({ ...base, GUARD_PORT: "70000" })).toThrow(/GUARD_PORT/);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/guardConfig.test.ts`
Expected: FAIL, cannot resolve `../src/guard/config.js`.

- [ ] **Step 4: Implement the config**

`agent/src/guard/config.ts`. `GUARD_PAY_TO` is built from `field` directly, not from `address(...).optional()`: with that form, a blank `GUARD_PAY_TO=` line fails as "required".

```ts
import { BUILDER_CODE_PATTERN } from "@x402/extensions/builder-code";
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";
import { address, field } from "../config.js";

const schema = z
  .object({
    BASE_RPC_URL: field(z.string({ error: "BASE_RPC_URL is required" }).pipe(z.url())),
    MAAT_VAULT: address("MAAT_VAULT"),
    MAAT_EXECUTOR: address("MAAT_EXECUTOR"),
    /** Where x402 payments go. Unset: the vault itself (spec 3.4). The S4 fallback sets an owner-held address. */
    GUARD_PAY_TO: field(
      z
        .string()
        .refine((v) => isAddress(v, { strict: false }), "GUARD_PAY_TO is not an address")
        .transform((v) => getAddress(v) as Address)
        .optional(),
    ),
    GUARD_PORT: field(z.coerce.number().int().min(1).max(65_535).default(8080)),
    GUARD_RATE_LIMIT_PER_MINUTE: field(z.coerce.number().int().positive().default(60)),
    GUARD_CORS_ORIGINS: field(z.string().default("https://maatonbase.xyz,https://www.maatonbase.xyz")),
    GUARD_BUILDER_CODE: field(z.string().regex(BUILDER_CODE_PATTERN, "GUARD_BUILDER_CODE must match ^[a-z0-9_]{1,32}$").optional()),
    /** A facilitator other than CDP's (a local one in tests). Unset: the CDP facilitator, which needs the API key. */
    GUARD_FACILITATOR_URL: field(z.url().optional()),
    CDP_API_KEY_ID: field(z.string().optional()),
    CDP_API_KEY_SECRET: field(z.string().optional()),
    CDP_WALLET_SECRET: field(z.string().optional()),
  })
  .superRefine((v, ctx) => {
    if (v.CDP_WALLET_SECRET !== undefined) {
      ctx.addIssue({ code: "custom", path: ["CDP_WALLET_SECRET"], message: "the guard never signs; remove CDP_WALLET_SECRET from its env" });
    }
    if (!v.GUARD_FACILITATOR_URL && (!v.CDP_API_KEY_ID || !v.CDP_API_KEY_SECRET)) {
      ctx.addIssue({ code: "custom", path: ["CDP_API_KEY_ID"], message: "the CDP facilitator needs CDP_API_KEY_ID and CDP_API_KEY_SECRET" });
    }
  });

export interface GuardConfig {
  rpcUrl: string;
  vault: Address;
  executor: Address;
  payTo: Address;
  port: number;
  rateLimitPerMinute: number;
  corsOrigins: string[];
  builderCode: string | undefined;
  facilitator: { kind: "url"; url: string } | { kind: "cdp"; apiKeyId: string; apiKeySecret: string };
}

export function loadGuardConfig(env: NodeJS.ProcessEnv = process.env): GuardConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid guard config: ${msg}`);
  }
  const v = r.data;
  return {
    rpcUrl: v.BASE_RPC_URL,
    vault: v.MAAT_VAULT,
    executor: v.MAAT_EXECUTOR,
    payTo: v.GUARD_PAY_TO ?? v.MAAT_VAULT,
    port: v.GUARD_PORT,
    rateLimitPerMinute: v.GUARD_RATE_LIMIT_PER_MINUTE,
    corsOrigins: v.GUARD_CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    builderCode: v.GUARD_BUILDER_CODE,
    facilitator: v.GUARD_FACILITATOR_URL
      ? { kind: "url", url: v.GUARD_FACILITATOR_URL }
      : { kind: "cdp", apiKeyId: v.CDP_API_KEY_ID!, apiKeySecret: v.CDP_API_KEY_SECRET! },
  };
}
```

- [ ] **Step 5: Implement the entrypoint**

`agent/src/guard/main.ts`:

```ts
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createPublicClient, http, type PublicClient } from "viem";
import { base } from "viem/chains";
import { createGuardApp } from "./app.js";
import { loadGuardConfig } from "./config.js";

const cfg = loadGuardConfig();
// Same cast as runtime.ts: it only erases the OP-stack deposit-tx types the narrow client interfaces do not model.
const client = createPublicClient({ chain: base, transport: http(cfg.rpcUrl) }) as PublicClient;
const facilitator =
  cfg.facilitator.kind === "url"
    ? new HTTPFacilitatorClient({ url: cfg.facilitator.url })
    : createCdpFacilitatorClient({ apiKeyId: cfg.facilitator.apiKeyId, apiKeySecret: cfg.facilitator.apiKeySecret });

const app = createGuardApp({
  client,
  vault: cfg.vault,
  executor: cfg.executor,
  payTo: cfg.payTo,
  facilitator,
  rateLimitPerMinute: cfg.rateLimitPerMinute,
  corsOrigins: cfg.corsOrigins,
  ...(cfg.builderCode ? { builderCode: cfg.builderCode } : {}),
});

const server = serve({ fetch: app.fetch, port: cfg.port, hostname: "0.0.0.0" }, (info) => {
  // Never log cfg.rpcUrl: it carries the RPC provider's key.
  console.log(`maat guard: port=${info.port} vault=${cfg.vault} payTo=${cfg.payTo} facilitator=${cfg.facilitator.kind}`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => server.close());
```

- [ ] **Step 6: Add the script, the env example and the ignores**

In `agent/package.json` `"scripts"`, after `"agent"`:

```json
    "guard": "node --env-file-if-exists=.env.guard --import tsx src/guard/main.ts",
```

`agent/.env.guard.example`:

```bash
# Guard Service (npm run guard). It never signs: never put CDP_WALLET_SECRET here (the guard refuses to start).
BASE_RPC_URL=https://mainnet.base.org
MAAT_VAULT=0x0000000000000000000000000000000000000000
MAAT_EXECUTOR=0x0000000000000000000000000000000000000000
# Where x402 payments go. Empty: the vault itself. Set it only for the S4 fallback (an address the owner holds).
GUARD_PAY_TO=
GUARD_PORT=8080
GUARD_RATE_LIMIT_PER_MINUTE=60
GUARD_CORS_ORIGINS=https://maatonbase.xyz,https://www.maatonbase.xyz
# Builder Code attached to the x402 settlement tx (optional; set it after S4 passes).
GUARD_BUILDER_CODE=
# Empty: the CDP facilitator, which needs the two CDP API key values below.
GUARD_FACILITATOR_URL=
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
```

In the root `.gitignore`, after the `contracts/.env` line:

```
agent/.env.guard
agent/.env.s4
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/guardConfig.test.ts test/config.test.ts && npx tsc --noEmit`
Expected: PASS. `guardConfig.test.ts` has 6 tests, and `config.test.ts` is unchanged and green.

- [ ] **Step 8: Boot check (no network, no keys)**

This starts the guard against dead RPC and facilitator ports, probes it, and stops it:

```bash
BASE_RPC_URL=http://127.0.0.1:1 MAAT_VAULT=0x1111111111111111111111111111111111111111 MAAT_EXECUTOR=0x2222222222222222222222222222222222222222 GUARD_FACILITATOR_URL=http://127.0.0.1:2 GUARD_PORT=18080 node --import tsx src/guard/main.ts & PID=$!
for i in $(seq 1 30); do curl -s -m 1 http://127.0.0.1:18080/health && break; node -e "setTimeout(()=>{},500)"; done; echo
curl -s -m 20 -w ' %{http_code}\n' http://127.0.0.1:18080/state/NVDAc
curl -s -m 5 -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:18080/check?token=NVDAc&side=HOLD&sizeUSD=1'
kill $PID
```

Expected:
- the log line `maat guard: port=18080 vault=0x1111… payTo=0x1111… facilitator=url`, with no RPC URL in it;
- `{"ok":true}`;
- `{"reason":"UNKNOWN","error":"getBlock failed"} 503`;
- `400`.

A logged `Failed to initialize: no supported payment kinds` is expected: the facilitator port is dead. If the process instead exits with `ERR_MODULE_NOT_FOUND` for `@x402/svm`, Task 4 Step 1 was skipped.

- [ ] **Step 9: Commit**

```bash
git add src/config.ts src/guard/config.ts src/guard/main.ts .env.guard.example package.json test/guardConfig.test.ts ../.gitignore
git commit -m "feat(agent): guard config and entrypoint (never signs, CDP facilitator)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Revenue keeper (`notifyRevenue` housekeeping)

**Before you start:** bring the branch up to date with `main` (see File Structure). Every edit below is anchored on code text. If a sibling branch moved an anchor, put the new code next to the same anchor and keep its meaning.

**Files:**
- Modify: `agent/src/exec/calls.ts`, `agent/src/ledger/journal.ts`, `agent/src/loop/runOnce.ts`
- Modify: `agent/src/config.ts`, `agent/src/runtime.ts`, `agent/.env.example`
- Modify: `agent/test/fakes/fakeReceipts.ts`, `agent/test/runOnce.test.ts`, `agent/test/config.test.ts`, `agent/test/runtime.test.ts`

**Interfaces:**
- Consumes: `VaultState.newRevenue` (already in `readVaultState`); `GuardedSender`, which already allows `notifyRevenue` (`ALLOWED_FUNCTIONS`); the CDP policy, which already allows `to = vault`.
- Produces:
  - `encodeNotifyRevenue(): Hex`
  - `NOTIFY_GAS_FLOOR = 100_000n`; `GAS_FLOOR.notifyRevenue`, so `GasFunction` now includes `"notifyRevenue"`
  - the journal row `{ kind: "housekeeping"; call: "notifyRevenue"; amount: bigint; txHash?; gas?; gasUsed?; note? }`
  - `REVENUE_MIN_USD6 = 50_000n`; `RunDeps.revenueMinUsd6?: bigint`
  - `AgentConfig.revenueMinUsd: number` (`MAAT_REVENUE_MIN_USD`, default 0.05)

- [ ] **Step 1: Write the failing tests**

In `agent/test/fakes/fakeReceipts.ts`, add a field after `syncEvent = true;`:

```ts
  /** notifyRevenue emits RevenueReceived(revenue); null: nothing new by then (another caller recorded it first). */
  revenue: bigint | null = null;
```

In `receipt()`, just before `return { status: this.status, transactionHash: hash, …`:

```ts
    if (call.functionName === "notifyRevenue" && this.revenue !== null) {
      logs.push(
        this.log(
          hash,
          encodeEventTopics({ abi: mandateVaultAbi, eventName: "RevenueReceived" }) as Hex[],
          encodeAbiParameters(parseAbiParameters("uint256"), [this.revenue]),
        ),
      );
    }
```

In `agent/test/runOnce.test.ts`, change the import `import { addressOf } from "../src/addresses.js";` to `import { addressOf, USDC } from "../src/addresses.js";`. Insert these tests just before `it("skips housekeeping for a token whose lastMultiplier is unreadable", …`:

```ts
  it("records new USDC as revenue with notifyRevenue before trading", async () => {
    const t = await setup({ batch: BUY20, scene: standardScene().set(USDC, "balanceOf", 130_000_000n) });
    t.receipts.revenue = 30_000_000n;
    await runOnce(t.deps);
    expect(t.receipts.calls().map((c) => c.functionName)).toEqual(["notifyRevenue", "execute"]);
    expect(codesIn(t.inner.sent[0]!.data)).toEqual(["bc_maattest"]);
    const row = (await t.journal.read()).find((e) => e.kind === "housekeeping");
    expect(row).toMatchObject({ call: "notifyRevenue", amount: "30000000", txHash: `0x${"1".padStart(64, "0")}` });
    expect(t.store.txCount(DAY)).toBe(2);
  });

  it("leaves revenue below the threshold for later", async () => {
    const t = await setup({ scene: standardScene().set(USDC, "balanceOf", 100_049_999n) });
    expect((await runOnce(t.deps)).sent).toEqual([]);
    const t2 = await setup({ scene: standardScene().set(USDC, "balanceOf", 100_049_999n) });
    t2.deps.revenueMinUsd6 = 49_999n;
    expect((await runOnce(t2.deps)).sent).toHaveLength(1);
  });

  it("journals revenue in dry-run without sending", async () => {
    const t = await setup({ mode: "dry-run", scene: standardScene().set(USDC, "balanceOf", 130_000_000n) });
    await runOnce(t.deps);
    expect(t.inner.sent).toEqual([]);
    expect((await t.journal.read()).find((e) => e.kind === "housekeeping")).toMatchObject({ call: "notifyRevenue", amount: "30000000", note: "dry-run" });
  });

  it("does not halt when someone else recorded the revenue first", async () => {
    const t = await setup({ scene: standardScene().set(USDC, "balanceOf", 130_000_000n) });
    const r = await runOnce(t.deps); // receipts.revenue stays null: the receipt carries no RevenueReceived
    expect(r.status).toBe("done");
    expect((await t.journal.read()).find((e) => e.kind === "housekeeping")).toMatchObject({ amount: "0", note: "already recorded by another caller" });
  });
```

In `agent/test/config.test.ts`, in `defaults to dry-run with the documented defaults`, after `expect(c.defaultDailyComputeUsd).toBe(0.5);`:

```ts
    expect(c.revenueMinUsd).toBe(0.05);
```

In `agent/test/runtime.test.ts`, in `live wraps the CDP sender …`, after `expect(deps.defaultDailyComputeUsd6).toBe(500_000n);`:

```ts
    expect(deps.revenueMinUsd6).toBe(50_000n);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run test/runOnce.test.ts test/config.test.ts test/runtime.test.ts`
Expected: FAIL.
- The 4 new runOnce tests fail: no `notifyRevenue` is sent, and no housekeeping row exists.
- The config assertion fails: `revenueMinUsd` is `undefined`.
- The runtime assertion fails: `revenueMinUsd6` is `undefined`.

- [ ] **Step 3: Encoder and gas floor**

In `agent/src/exec/calls.ts`, after `encodeSyncMultiplier`:

```ts
export function encodeNotifyRevenue(): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "notifyRevenue" });
}
```

Replace the `MAX_GAS` and `GAS_FLOOR` lines:

```ts
export const MAX_GAS = 3_000_000n;
export const GAS_FLOOR = { execute: EXECUTE_GAS_FLOOR, syncMultiplier: SYNC_GAS_FLOOR } as const;
```

with:

```ts
/** notifyRevenue swallows nothing (one balanceOf, one SSTORE, one event); the floor is headroom, checked on the fork. */
export const NOTIFY_GAS_FLOOR = 100_000n;
export const MAX_GAS = 3_000_000n;
export const GAS_FLOOR = { execute: EXECUTE_GAS_FLOOR, syncMultiplier: SYNC_GAS_FLOOR, notifyRevenue: NOTIFY_GAS_FLOOR } as const;
```

- [ ] **Step 4: Journal row**

In `agent/src/ledger/journal.ts`, after the `call: "syncMultiplier"` housekeeping member of `JournalEntry`:

```ts
  /** amount: USDC (6 decimals) the vault recorded as revenue; on a dry run, what it would record. */
  | { kind: "housekeeping"; runId: string; call: "notifyRevenue"; amount: bigint; txHash?: Hex; gas?: bigint; gasUsed?: bigint; note?: string }
```

- [ ] **Step 5: The keeper in `runOnce`**

In `agent/src/loop/runOnce.ts`:

1. Add `encodeNotifyRevenue` to the `../exec/calls.js` import.
2. After `export const PENDING_WINDOW_BLOCKS = 300n;`:

```ts
/** Default for RunDeps.revenueMinUsd6: below $0.05 of new USDC, recording it costs more gas than it is worth. */
export const REVENUE_MIN_USD6 = 50_000n;
```

3. In `RunDeps`, before `runId?: string;`:

```ts
  /** New USDC (x402 payments, creator fees) at or above this is recorded with notifyRevenue. */
  revenueMinUsd6?: bigint;
```

4. Just before `export async function runOnce(`:

```ts
/** What notifyRevenue recorded. 0 when another caller recorded it first (anyone may call notifyRevenue). */
function revenueIn(receipt: TransactionReceipt, vault: Address): bigint {
  const logs = parseEventLogs({ abi: mandateVaultAbi, eventName: "RevenueReceived", logs: receipt.logs });
  return logs.filter((x) => getAddress(x.address) === getAddress(vault)).reduce((sum, x) => sum + x.args.amount, 0n);
}
```

5. Right after the `syncMultiplier` housekeeping loop closes, that is after the line `if (!multiplierSynced(r, d.vault, t.address)) throw new Halt(…);` and its closing `}`, and before `let dirty = report.sent.length > 0;`:

```ts
    // Housekeeping: record inbound USDC (x402 payments to the vault) as revenue, so it shows without waiting for a trade.
    if (s.newRevenue >= (d.revenueMinUsd6 ?? REVENUE_MIN_USD6)) {
      if (!sender) {
        await j.append({ kind: "housekeeping", runId, call: "notifyRevenue", amount: s.newRevenue, note: "dry-run" });
      } else {
        checkCap();
        const data = encodeNotifyRevenue();
        const gas = await gasFor("notifyRevenue", data);
        d.store.recordTx(day);
        const hash = await sender.send({ to: d.vault, data, idempotencyKey: `revenue:${runId}`, gas });
        report.sent.push(hash);
        const r = await receiptOf(hash);
        if (r.status !== "success") throw new Halt(`tx ${hash} reverted`);
        const amount = revenueIn(r, d.vault);
        await j.append({
          kind: "housekeeping",
          runId,
          call: "notifyRevenue",
          amount,
          txHash: hash,
          gas,
          gasUsed: r.gasUsed,
          ...(amount === 0n ? { note: "already recorded by another caller" } : {}),
        });
      }
    }
```

The existing `let dirty = report.sent.length > 0;` re-read that follows now also covers this send.

- [ ] **Step 6: Config, runtime and env example**

In `agent/src/config.ts`:
- Schema, after `MAAT_DEFAULT_DAILY_COMPUTE_USD`:

  ```ts
      MAAT_REVENUE_MIN_USD: field(z.coerce.number().nonnegative().default(0.05)),
  ```

- `AgentConfig`, after `defaultDailyComputeUsd: number;`:

  ```ts
    /** New USDC at or above this is recorded as revenue with notifyRevenue. */
    revenueMinUsd: number;
  ```

- `loadConfig` return object, after `defaultDailyComputeUsd: …,`:

  ```ts
      revenueMinUsd: v.MAAT_REVENUE_MIN_USD,
  ```

In `agent/src/runtime.ts`, after `defaultDailyComputeUsd6: usdToUsdc6(cfg.defaultDailyComputeUsd),`:

```ts
    revenueMinUsd6: usdToUsdc6(cfg.revenueMinUsd),
```

In `agent/.env.example`, after `MAAT_DEFAULT_DAILY_COMPUTE_USD=0.5`:

```bash
# New USDC (x402 payments) at or above this is recorded as revenue with notifyRevenue().
MAAT_REVENUE_MIN_USD=0.05
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: every file passes. `runOnce.test.ts` gains 4 tests (35 in the prototype, before sibling merges). The existing test `sends every transaction with an explicit gas limit at or above its floor` keeps passing, because `GAS_FLOOR` now has a `notifyRevenue` entry.

- [ ] **Step 8: Commit**

```bash
git add src/exec/calls.ts src/ledger/journal.ts src/loop/runOnce.ts src/config.ts src/runtime.ts .env.example test/fakes/fakeReceipts.ts test/runOnce.test.ts test/config.test.ts test/runtime.test.ts
git commit -m "feat(agent): record inbound USDC as revenue with notifyRevenue housekeeping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Fork test (preview parity and offline S4)

**Files:**
- Create: `agent/test/integration/guard.fork.test.ts`

**Interfaces:**
- Consumes:
  - `startAnvil`, `deployStack` (`test/integration/anvil.ts` and `deploy.ts`, Plan 2B);
  - `readMarketState`, `marketReason`, `previewIntent`, `createGuardApp`, `BASE_NETWORK`, `CHECK_PRICE_USDC6`;
  - `encodeNotifyRevenue`, `encodeExecute`, `gasLimit`, `NOTIFY_GAS_FLOOR`, `GuardedSender`, `RpcSender`, `builderSuffix`;
  - `x402Facilitator` (`@x402/core/facilitator`), `toFacilitatorEvmSigner` (`@x402/evm`), the exact scheme for facilitator and client, `wrapFetchWithPayment`, `decodePaymentResponseHeader`, `x402Client` (`@x402/fetch`).
- Produces: nothing for later tasks. It is the evidence for the spec's §6 preview parity and for S4 part (a).

What it proves, at block 53551627 (NYSE open, feeds fresh):
1. **Parity.** For NVDAc, GOOGLc and AAPLc, `marketReason(readMarketState(...))` equals `previewIntent(BUY $1)` from the executor on the same block. A SELL of 1 raw unit gives `INSUFFICIENT_BALANCE` when the market is OK (the vault holds no stock), and otherwise the same market reason.
2. **S4 offline:**
   - The buyer (anvil account 3, with its EIP-7702 code cleared on the fork) pays `GET /check` through the real x402 client and middleware.
   - An in-process facilitator (account 4) settles the EIP-3009 transfer.
   - The vault's USDC rises by exactly 10000.
   - The executor sends `notifyRevenue` through `GuardedSender` with the Builder Code: `RevenueReceived(10000)`, `gasUsed < NOTIFY_GAS_FLOOR`.
   - `execute(PAY_EXPENSE 10000 → payee)` is allowed, and the payee receives it.

- [ ] **Step 1: Write the test**

`agent/test/integration/guard.fork.test.ts`:

```ts
import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { registerExactEvmScheme as registerClientScheme } from "@x402/evm/exact/client";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseEther, parseEventLogs, type Address, type Hex, type PublicClient } from "viem";
import { base } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../../src/abi/index.js";
import { BASKET, USDC } from "../../src/addresses.js";
import { readMarketState } from "../../src/chain/market.js";
import { previewIntent } from "../../src/chain/preview.js";
import { builderSuffix } from "../../src/exec/builderCode.js";
import { encodeExecute, encodeNotifyRevenue, gasLimit, NOTIFY_GAS_FLOOR } from "../../src/exec/calls.js";
import { GuardedSender, RpcSender } from "../../src/exec/sender.js";
import { createGuardApp, type GuardClient } from "../../src/guard/app.js";
import { marketReason } from "../../src/guard/verdict.js";
import { BASE_NETWORK, CHECK_PRICE_USDC6 } from "../../src/guard/x402.js";
import { actionId } from "../../src/types.js";
import { startAnvil } from "./anvil.js";
import { deployStack } from "./deploy.js";

const RPC = process.env.BASE_RPC_URL;
const BLOCK_SESSION = 53_551_627n; // same block as agent.fork.test.ts: NYSE open, feeds fresh
const ZERO32 = `0x${"00".repeat(32)}` as const;

describe.skipIf(!RPC)("guard service on a Base fork", () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>>;
  let stack: Awaited<ReturnType<typeof deployStack>>;
  let pub: PublicClient;
  const transport = () => http(anvil.url, { timeout: 600_000 });

  beforeAll(async () => {
    anvil = await startAnvil({ forkUrl: RPC!, block: BLOCK_SESSION, port: 8548 });
    stack = await deployStack(anvil.url);
    pub = createPublicClient({ chain: base, transport: transport() }) as PublicClient;
  });

  afterAll(async () => {
    await anvil?.stop();
  });

  it("matches previewIntent on the same block for every basket token (spec 6: preview parity)", async () => {
    for (const t of BASKET) {
      const s = await readMarketState(pub, stack.vault, t.address);
      const market = marketReason(s);
      const intent = (action: "BUY" | "SELL", amount: bigint) => ({
        id: ZERO32, action: actionId(action), token: t.address, amount, minOut: 0n, payee: stack.payee, rationaleHash: ZERO32,
      });
      const buy = await previewIntent(pub, stack.vault, stack.executor, intent("BUY", 1_000_000n), s.block);
      const sell = await previewIntent(pub, stack.vault, stack.executor, intent("SELL", 1n), s.block);
      // The vault checks the market first, then its own books: $1 of a $200 vault passes them; it holds no stock to sell.
      expect({ token: t.symbol, buy: buy.result }).toEqual({ token: t.symbol, buy: market });
      expect({ token: t.symbol, sell: sell.result }).toEqual({ token: t.symbol, sell: market === "OK" ? "INSUFFICIENT_BALANCE" : market });
    }
  });

  it("x402 pays straight into the vault, notifyRevenue records it, and PAY_EXPENSE spends it (S4, offline)", async () => {
    const wallet = createWalletClient({ chain: base, transport: transport() });
    const test = createTestClient({ chain: base, transport: transport(), mode: "anvil" });
    const accounts = (await wallet.getAddresses()) as Address[];
    const buyer = accounts[3]!;
    const relayer = accounts[4]!;
    const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

    // On Base mainnet the anvil dev accounts carry EIP-7702 delegations (code 0xef0100...), so the facilitator would
    // check the buyer's signature with ERC-1271 and answer invalid_exact_evm_signature. Make it a plain EOA, fork only.
    await test.setCode({ address: buyer, bytecode: "0x" });

    // EIP-3009 windows use the wall clock (validAfter = now - 600); bring the fork's clock to now.
    await test.setNextBlockTimestamp({ timestamp: BigInt(Math.floor(Date.now() / 1000)) });
    await test.mine({ blocks: 1 });

    // 1 USDC for the buyer from the NVDAc pool, impersonated on the fork only.
    const [, , pool] = await pub.readContract({ address: stack.vault, abi: mandateVaultAbi, functionName: "tokenConfig", args: [BASKET[0]!.address] });
    await test.impersonateAccount({ address: pool });
    await test.setBalance({ address: pool, value: parseEther("1") });
    await wait(await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [buyer, 1_000_000n], account: pool, chain: base }));
    await test.stopImpersonatingAccount({ address: pool });

    // An in-process facilitator: the same @x402/evm exact scheme CDP runs, submitting from an anvil dev account.
    const facilitatorSigner = toFacilitatorEvmSigner({
      address: relayer,
      readContract: (a) => pub.readContract(a as never),
      verifyTypedData: (a) => pub.verifyTypedData(a as never),
      writeContract: (a) => wallet.writeContract({ ...a, account: relayer, chain: base } as never),
      sendTransaction: (a) => wallet.sendTransaction({ ...a, account: relayer, chain: base }),
      waitForTransactionReceipt: (a) => pub.waitForTransactionReceipt(a),
      getCode: (a) => pub.getCode(a),
    });
    const local = registerFacilitatorScheme(new x402Facilitator(), { signer: facilitatorSigner, networks: BASE_NETWORK });
    const facilitator: FacilitatorClient = {
      verify: (p, r) => local.verify(p, r),
      settle: (p, r) => local.settle(p, r),
      getSupported: async () => local.getSupported() as never,
    };

    const app = createGuardApp({
      client: pub as GuardClient,
      vault: stack.vault,
      executor: stack.executor,
      payTo: stack.vault,
      facilitator,
      rateLimitPerMinute: 60,
      corsOrigins: [],
    });
    // The buyer signs through anvil's unlocked account (eth_signTypedData_v4): no private key in this test.
    const buyerClient = new x402Client();
    registerClientScheme(buyerClient, {
      signer: { address: buyer, signTypedData: (m) => wallet.signTypedData({ ...m, account: buyer } as never) },
    });
    const appFetch = (async (input: RequestInfo | URL, init?: RequestInit) => app.fetch(new Request(input, init))) as typeof fetch;
    const paidFetch = wrapFetchWithPayment(appFetch, buyerClient);

    const usdcOf = (a: Address) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });
    const vaultBefore = await usdcOf(stack.vault);
    const res = await paidFetch("http://guard.test/check?token=NVDAc&side=BUY&sizeUSD=100");
    // On a 402 the PAYMENT-REQUIRED header carries the facilitator's reason: show it instead of a bare status.
    const why = res.status === 200 ? null : JSON.parse(Buffer.from(res.headers.get("payment-required") ?? "", "base64").toString("utf8") || "{}").error;
    expect({ status: res.status, why }).toEqual({ status: 200, why: null });
    const body = await res.json();
    // The clock jump left the feed hours old: the verdict is a refusal, and it is still a paid answer.
    expect(["FEED_STALE", "MARKET_CLOSED"]).toContain(body.reason);
    const receipt = decodePaymentResponseHeader(res.headers.get("payment-response")!);
    expect(receipt.success).toBe(true);
    expect((await wait(receipt.transaction as Hex)).status).toBe("success");
    expect(await usdcOf(stack.vault)).toBe(vaultBefore + CHECK_PRICE_USDC6);

    // The agent's keeper path: GuardedSender, Builder Code, gas floor.
    const sender = new GuardedSender(new RpcSender(wallet, stack.executor), { vault: stack.vault, suffix: builderSuffix("bc_maattest") });
    const notifyData = encodeNotifyRevenue();
    const notifyGas = gasLimit("notifyRevenue", await pub.estimateGas({ account: stack.executor, to: stack.vault, data: notifyData }));
    const notify = await wait(await sender.send({ to: stack.vault, data: notifyData, idempotencyKey: "fork-revenue", gas: notifyGas }));
    expect(notify.status).toBe("success");
    expect(notify.gasUsed).toBeLessThan(NOTIFY_GAS_FLOOR);
    const revenue = parseEventLogs({ abi: mandateVaultAbi, eventName: "RevenueReceived", logs: notify.logs });
    expect(revenue.map((l) => l.args.amount)).toEqual([CHECK_PRICE_USDC6]);

    const payeeBefore = await usdcOf(stack.payee);
    const pay = { id: `0x${"5e".repeat(32)}` as Hex, action: actionId("PAY_EXPENSE"), token: USDC, amount: CHECK_PRICE_USDC6, minOut: 0n, payee: stack.payee, rationaleHash: ZERO32 };
    const payData = encodeExecute(pay);
    const payGas = gasLimit("execute", await pub.estimateGas({ account: stack.executor, to: stack.vault, data: payData }));
    const paid = await wait(await sender.send({ to: stack.vault, data: payData, idempotencyKey: "fork-expense", gas: payGas }));
    const decision = parseEventLogs({ abi: mandateVaultAbi, eventName: "Decision", logs: paid.logs })[0]!;
    expect(decision.args.allowed).toBe(true);
    expect(await usdcOf(stack.payee)).toBe(payeeBefore + CHECK_PRICE_USDC6);
  });
});
```

- [ ] **Step 2: Type-check, then run it on the fork**

You need everything the Plan 2B fork test needs (see `agent/README.md` → Test): base-anvil v1.5.1, `contracts/out` built, and `MAAT_ANVIL_BIN` on Windows. Port 8548 must be free.

Read the RPC URL from `contracts/.env` without printing it, and filter it out of any output:

```bash
npx tsc --noEmit
export BASE_RPC_URL="$(grep -m1 '^BASE_RPC_URL=' ../contracts/.env | cut -d= -f2- | tr -d '\r' | sed -e 's/^"//' -e 's/"$//')"
export MAAT_ANVIL_BIN="$HOME/.foundry/versions/base-v1.5.1/anvil.exe"   # Windows; leave unset on macOS/Linux
npx vitest run --config vitest.integration.config.ts test/integration/guard.fork.test.ts 2>&1 | python -c "import os,sys
u=os.environ['BASE_RPC_URL']
[sys.stdout.write(l.replace(u,'[RPC]')) for l in sys.stdin]"
```

In a Claude Code session, run the vitest line in the background: it takes about a minute on a public RPC.

Expected: `Tests 2 passed (2)`. Without `BASE_RPC_URL` the suite is skipped.

A failure of `x402 pays straight into the vault…` shows the facilitator's reason, for example `why: "invalid_exact_evm_signature"`. That one means the buyer still has code: check the `setCode` line.

- [ ] **Step 3: Commit**

```bash
git add test/integration/guard.fork.test.ts
git commit -m "test(agent): fork proof of guard/vault parity and x402 revenue into the vault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: S4 mainnet script (OWNER ONLY, type-check only)

**Files:**
- Create: `agent/scripts/s4-pay.ts`
- Modify: `agent/package.json` (script `s4:pay`)

**Interfaces:**
- Consumes: `CdpClient` (`@coinbase/cdp-sdk`); `x402Client`, `wrapFetchWithPayment`, `decodePaymentResponseHeader` (`@x402/fetch`); the client `registerExactEvmScheme`; `BASE_NETWORK`, `CHECK_PRICE`, `CHECK_PRICE_USDC6` (Task 5); `USDC`.
- Produces: `npm run s4:pay -- <guard URL>`. **The implementer never runs it.** It signs a real payment with the owner's CDP buyer account.

The script refuses to sign unless the guard's 402 offers exactly 10000 units of Base USDC to `MAAT_VAULT`. The client is also capped with `setSpendControls({ maxAmountPerPayment: "$0.01" })` and a policy that keeps only that offer. The script then checks that the vault balance rose by exactly 10000.

- [ ] **Step 1: Write the script**

`agent/scripts/s4-pay.ts`:

```ts
/**
 * Spike S4 on mainnet, OWNER ONLY: pays one 0.01 USDC x402 call to a running guard and checks the USDC landed in the
 * vault. It signs with a separate CDP buyer account (never the executor), so it needs the owner's CDP keys and wallet
 * secret in agent/.env.s4. An agent never runs this script.
 *
 *   npm run s4:pay -- http://localhost:8080
 */
import { CdpClient } from "@coinbase/cdp-sdk";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createPublicClient, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { USDC } from "../src/addresses.js";
import { BASE_NETWORK, CHECK_PRICE, CHECK_PRICE_USDC6 } from "../src/guard/x402.js";

const guard = process.argv[2] ?? "http://localhost:8080";
const vault = getAddress(process.env.MAAT_VAULT ?? "");
const rpc = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const buyerName = process.env.S4_BUYER_ACCOUNT ?? "maat-s4-buyer";
const url = `${guard}/check?token=NVDAc&side=BUY&sizeUSD=100`;

const pub = createPublicClient({ chain: base, transport: http(rpc) });
const usdcOf = (a: Address) => pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [a] });

// 1. Read the offer before signing anything: exactly 0.01 USDC on Base, to the vault.
const offer = await fetch(url);
const header = offer.headers.get("payment-required");
if (offer.status !== 402 || !header) throw new Error(`expected a 402 with PAYMENT-REQUIRED, got ${offer.status}`);
const accepts = (JSON.parse(Buffer.from(header, "base64").toString("utf8")).accepts ?? []) as { payTo: string; amount: string; network: string; asset: string }[];
const ok = (r: { payTo: string; amount: string; network: string; asset: string }) =>
  getAddress(r.payTo) === vault && r.amount === CHECK_PRICE_USDC6.toString() && r.network === BASE_NETWORK && getAddress(r.asset) === getAddress(USDC);
if (!accepts.some(ok)) throw new Error(`the guard does not offer ${CHECK_PRICE} USDC to the vault ${vault}: ${JSON.stringify(accepts)}`);

// 2. Pay with the buyer account, capped to this one offer.
const cdp = new CdpClient(); // CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET
const buyer = await cdp.evm.getOrCreateAccount({ name: buyerName });
const balance = await usdcOf(buyer.address);
if (balance < CHECK_PRICE_USDC6) throw new Error(`fund ${buyer.address} with at least 0.01 USDC on Base first (has ${balance})`);
const client = new x402Client().setSpendControls({ maxAmountPerPayment: CHECK_PRICE });
client.registerPolicy((_v, reqs) => reqs.filter(ok));
registerExactEvmScheme(client, { signer: { address: buyer.address, signTypedData: (m) => buyer.signTypedData(m as never) } });

const before = await usdcOf(vault);
const res = await wrapFetchWithPayment(fetch, client)(url);
console.log(`status ${res.status}: ${await res.text()}`);
const paid = res.headers.get("payment-response");
if (!paid) throw new Error("no PAYMENT-RESPONSE header: the payment did not settle");
const settle = decodePaymentResponseHeader(paid);
console.log(`settled: success=${settle.success} tx=${settle.transaction}`);
const r = await pub.waitForTransactionReceipt({ hash: settle.transaction as Hex });
const after = await usdcOf(vault);
console.log(`vault USDC ${before} -> ${after} (tx status ${r.status})`);
if (after - before !== CHECK_PRICE_USDC6) throw new Error("S4 FAIL: the vault did not receive exactly 0.01 USDC; use the GUARD_PAY_TO fallback");
console.log("S4 PASS: x402 paid straight into the vault. Next: the agent's notifyRevenue records it.");
```

- [ ] **Step 2: Add the script entry**

In `agent/package.json` `"scripts"`, after `"guard"`:

```json
    "s4:pay": "node --env-file-if-exists=.env.s4 --import tsx scripts/s4-pay.ts",
```

- [ ] **Step 3: Type-check (do not run)**

Run: `npx tsc --noEmit`
Expected: no output. Do **not** run `npm run s4:pay`.

- [ ] **Step 4: Commit**

```bash
git add scripts/s4-pay.ts package.json
git commit -m "feat(agent): owner-only S4 script paying one x402 check into the vault

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docker image, Fly config and runbook

**Files:**
- Create: `agent/Dockerfile`, `agent/.dockerignore`, `agent/fly.guard.toml`
- Modify: `agent/README.md`, `deployments/README.md`

**Interfaces:**
- Consumes: `npm run guard` (Task 6), `npm run s4:pay` (Task 9).
- Produces: the owner's deploy path. The image holds `src/` only: no `scripts/`, no tests, no env files.

The dev machine has neither Docker nor flyctl. The image is first built by the owner's `fly deploy`, on Fly's remote builder. If Docker is available, run `docker build -t maat-agent .` in `agent/` as an extra check.

- [ ] **Step 1: Write the image and Fly files**

`agent/Dockerfile`:

```dockerfile
# One image for the agent and the Guard Service. The Fly app maat-guard runs `npm run guard` (fly.guard.toml).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx, a devDependency, runs the TypeScript sources, so dev dependencies are installed too.
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
EXPOSE 8080
CMD ["npm", "run", "guard"]
```

`agent/.dockerignore`:

```
node_modules
data
test
scripts
.env*
```

`agent/fly.guard.toml`:

```toml
# Fly app for the public Guard Service. Secrets (BASE_RPC_URL, MAAT_VAULT, MAAT_EXECUTOR, CDP_API_KEY_ID,
# CDP_API_KEY_SECRET) are set with `fly secrets set`; never CDP_WALLET_SECRET. Deploy: fly deploy -c fly.guard.toml
app = "maat-guard"
primary_region = "iad"

[build]
  dockerfile = "Dockerfile"

[env]
  GUARD_PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  # One always-on machine: the rate limiter and the caches live in memory.
  auto_stop_machines = "off"
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "10s"
    interval = "30s"
    method = "GET"
    path = "/health"
    timeout = "5s"
```

- [ ] **Step 2: Runbook in `agent/README.md`**

Insert before `## Data`:

````markdown
## Guard Service

A read-only HTTP service for the market checks GuardLib makes, for other agents and for the dashboard. It never signs. It refuses to start when `CDP_WALLET_SECRET` is in its env.

```bash
cp .env.guard.example .env.guard   # then fill in the vault, executor, RPC and the CDP API key (not the wallet secret)
npm run guard
```

| Endpoint | Price | Returns |
|---|---|---|
| `GET /health` | free | `{ "ok": true }` |
| `GET /state/:token` | free | Chainlink price and age; 30-minute Aerodrome TWAP; premium (bps); multiplier (current, last seen by the vault, `changedAt`, `effectiveAt`, pending); paused; policy ids; session; pool reserves; Coinbase NAV |
| `POST /preview` | free | `previewIntent` from the executor: `{ reason, allowed, block }`. Body: `{ action, token, amount, minOut?, payee? }` (amounts are integer strings in raw units) |
| `GET /check?token&side&sizeUSD` | 0.01 USDC on Base (x402) | the market verdict in GuardLib order (`reason`, `ok`), plus `sizeShareBps`, `policyRestricted`, `multiplierPending` |

How the endpoints behave:
- `token` is a basket symbol (NVDAc, GOOGLc, AAPLc, any case) or address. Any other token gets 404.
- Each IP gets 60 requests per minute. State and previews are cached for 15 s, and the Coinbase list for 60 s.
- If the RPC is down, `/state`, `/preview` and `/check` answer 503 `{"reason":"UNKNOWN"}`, and `/check` does not charge.
- If Coinbase is down, `nav` is `null` and everything else still answers.
- A bad `/check` query gets 400 before any payment request.

x402 payments go straight to the vault (`payTo` = `MAAT_VAULT`; the S4 fallback overrides it with `GUARD_PAY_TO`). The agent records them as revenue: once at least `MAAT_REVENUE_MIN_USD` (default 0.05) of new USDC has arrived, its next round sends `notifyRevenue()` and journals `call: "notifyRevenue"`.

The public deploy is the Fly app `maat-guard` (`fly.guard.toml`), built from the same image as the agent. The owner runbook is in `deployments/README.md` → "Guard Service and S4 (owner only)".
````

In `## Test`, after the bullet list about the fork test's requirements, add:

```markdown
The integration run also includes `test/integration/guard.fork.test.ts` on port 8548. It covers guard/vault parity on the same block, and an x402 payment settled into the vault, then recorded by `notifyRevenue` and spent by `PAY_EXPENSE`. On a Base fork every anvil dev account has EIP-7702 code, so the test clears the buyer's code (fork only).
```

- [ ] **Step 3: Owner runbook in `deployments/README.md`**

Append at the end:

````markdown
## Guard Service and S4 (owner only)

The guard has no wallet. Every step here that moves money is signed by a CDP account the owner controls.

### S4: can x402 pay straight into the vault?

1. Create `agent/.env.guard` from `agent/.env.guard.example`:
   - `BASE_RPC_URL`, `MAAT_VAULT`, `MAAT_EXECUTOR`;
   - `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`;
   - leave `GUARD_PAY_TO` and `GUARD_FACILITATOR_URL` empty;
   - no `CDP_WALLET_SECRET`.

   Run it: `cd agent && npm run guard`. Expect the log line `maat guard: … payTo=<vault> facilitator=cdp`.
2. Create `agent/.env.s4`:
   - `MAAT_VAULT`, `BASE_RPC_URL`;
   - `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`;
   - optionally `S4_BUYER_ACCOUNT` (default `maat-s4-buyer`).

   This account is a separate buyer, never the executor.
3. Run `npm run s4:pay -- http://localhost:8080` once. The first run creates the buyer account and stops with `fund <address> with at least 0.01 USDC`. Send it 0.01–0.05 USDC on Base, then run again. The script:
   - signs only if the guard offers exactly 0.01 USDC on Base to the vault;
   - prints the settlement tx and the vault's USDC before and after;
   - ends with `S4 PASS` or `S4 FAIL`.
4. On `S4 PASS`, the agent's next round sends `notifyRevenue()` (journal: `kind: "housekeeping", call: "notifyRevenue"`). The `RevenueReceived` event is on Basescan.
5. On `S4 FAIL` (the facilitator refuses a contract `payTo`):
   - Set `GUARD_PAY_TO` to an address you hold, then restart the guard.
   - From time to time, move the collected USDC into the vault with a plain ERC-20 `transfer`. Do not use `fund()`, which does not count as revenue.
   - Automating that forward needs its own CDP account and policy, and its own plan.

### Public deploy (Fly.io)

From `agent/`:

```bash
fly apps create maat-guard
fly secrets set -a maat-guard BASE_RPC_URL=... MAAT_VAULT=0x... MAAT_EXECUTOR=0x... CDP_API_KEY_ID=... CDP_API_KEY_SECRET=...
fly deploy -c fly.guard.toml
fly scale count 1 -a maat-guard
fly certs add guard.maatonbase.xyz -a maat-guard
```

Then:
- Point DNS for `guard.maatonbase.xyz` as `fly certs add` instructs.
- Check that `https://guard.maatonbase.xyz/health` returns `{"ok":true}`, and that `https://guard.maatonbase.xyz/check?token=NVDAc&side=BUY&sizeUSD=100` returns 402 with a `PAYMENT-REQUIRED` header whose `payTo` is the vault.
- After S4 passes, optionally attach Maat's Builder Code to the settlement tx: `fly secrets set -a maat-guard GUARD_BUILDER_CODE=<code>`.
- Never set `CDP_WALLET_SECRET` on this app: the guard refuses to start with it.
````

- [ ] **Step 4: Full check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: every file passes, and `tsc` is clean. Then:
- `git status --short` lists only the files above;
- `git grep -n "BASE_RPC_URL=" -- ':!*.example' ':!*.md'` finds no URL with a key.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore fly.guard.toml README.md ../deployments/README.md
git commit -m "docs(agent): guard image, Fly config and the owner's S4 and deploy runbook

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Owner steps (not for the implementer)

These spend money or touch accounts. The owner runs them after the branch is merged, following `deployments/README.md` → "Guard Service and S4 (owner only)":

1. **S4 on mainnet:**
   - Run the guard locally with the CDP facilitator.
   - Fund the CDP buyer account `maat-s4-buyer` with 0.01–0.05 USDC on Base.
   - Run `npm run s4:pay -- http://localhost:8080`, and expect `S4 PASS`.
   - The agent's next round records the payment (`notifyRevenue`, journal `call: "notifyRevenue"`).
   - On `S4 FAIL`, use the fallback in the runbook.
2. **Deploy:**
   - `fly apps create maat-guard`
   - set the secrets (no wallet secret)
   - `fly deploy -c fly.guard.toml`
   - `fly scale count 1`
   - `fly certs add guard.maatonbase.xyz`
   - point DNS
3. **Check the public service:** `https://guard.maatonbase.xyz/health` returns `{"ok":true}`, and `/check?token=NVDAc&side=BUY&sizeUSD=100` returns 402 with `payTo` = vault.
4. **Optional, after S4 passes:** `fly secrets set GUARD_BUILDER_CODE=<Maat's code>` (the same code as `MAAT_BUILDER_CODE`).
