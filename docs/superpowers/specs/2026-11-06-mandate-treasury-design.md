# Maat — Design Spec

> Product name: **Maat** (inspired by the goddess Ma'at, who weighs the heart against a feather). Tagline: *"Every trade is weighed."* Former name in the research notes: Mandate Treasury. The technical contract names (`MandateVault`, `GuardLib`…) are unchanged.

- **Date:** 2026-11-06
- **Hackathon:** Base Builder Quest – Stocks Maxxing Season · **Track: Agentic Stock Finance**
- **Submission deadline:** 23:59 UTC on 2026-12-05 (target submission date: 2026-12-04)
- **Decision source:** internal research notes (not published)

---

## 1. Goals & success criteria

**One-line story:** *"The agent that knows when NOT to trade."* An AI agent earns its own USDC, builds its own treasury of tokenized stocks (B20) on Base, and borrows USDC against those stocks to pay for compute. Every action must pass through an **onchain mandate**: the LLM only proposes, and the contract decides.

**Who uses it:**
1. **MVP (weeks 1–2):** a single agent owned by the team: "Agent #1". This is the showcase.
2. **Expansion (week 3):** `MandateFactory` lets any agent builder deploy their own vault, with an SDK and a Bankr Skill. Agent #1 is the first user. This gives a real path to traction if the judging criteria weight traction heavily.
3. **Out of scope:** accepting money from individual users (the risk of managing assets on their behalf, Reg S).

**Success =**
- A 3-minute video with the moment the **vault refuses a real trade on mainnet** (Thanksgiving, 26 Nov, or a weekend), with a Basescan link.
- The full loop runs on Base mainnet: USDC revenue → buy B20 → supply to Aave V4 → borrow USDC → repay the debt.
- Contracts verified, Builder Code attached to every transaction, public repo, and a README that states clearly what was built during the Quest Period.
- At least 1 vault deployed by a third party through the factory (stretch).
- A series of build-in-public posts on X (≥2 posts per week) and a public decision log.

**Constraints:** 1–2 developers using Claude Code; small mainnet amounts ($20–200); every mainnet transaction is signed by the owner or by an executor with spending limits; no US users; no claim of shareholder rights.

---

## 2. Architecture overview

```
┌──────────────────────────── OFF-CHAIN ────────────────────────────┐
│                                                                    │
│  Agent Runtime (TS)          Guard Service (TS)                    │
│  ┌──────────────────┐        ┌─────────────────────────────┐       │
│  │ loop every 15min │──state▶│ readMarketState(token)      │◀─x402─┼── external agent/customer
│  │ Claude API → Intent│◀─────│ preview(intent) → verdict   │       │   pays USDC per check
│  │ + rationale      │        │ (same logic as GuardLib)    │       │
│  └────────┬─────────┘        └─────────────────────────────┘       │
│           │ execute(intent) via CDP Server Wallet (executor)       │
│           │ + Builder Code dataSuffix                              │
│  Diary Publisher ◀─ read Decision events ─┐                        │
│  (dashboard + X post drafts)               │                        │
└───────────┼────────────────────────────────┼───────────────────────┘
            ▼                                │
┌──────────────────────────── ON-CHAIN (Base mainnet) ───────────────┐
│  MandateVault ──uses──▶ GuardLib (MarketCalendar, oracle, premium,  │
│     │                    multiplier, pause/policy checks)           │
│     ├──▶ SwapAdapter (Aerodrome Slipstream)                         │
│     ├──▶ CreditAdapter (Aave V4 Equities Hub | Morpho fallback)     │
│     └── emit Decision(intentId, action, allowed, reason, rationaleHash)│
│  MandateFactory (stretch) → deploy MandateVault + Mandate params    │
│  Read: B20 tokens (uiMultiplier, paused, policy) · Chainlink feeds  │
└─────────────────────────────────────────────────────────────────────┘
            ▲
Dashboard (Next.js + wagmi/viem, opens inside the Base App): balances via balanceOfUI,
HF, market status, mandate, decision log
```

**Design principles:**
- **The contract is the source of truth.** The Guard Service only explains refusals and reports errors early. It is not the main line of defense. If the agent is hit by prompt injection or the executor key leaks, the mandate still caps the maximum damage.
- **Refusals are also recorded onchain.** `execute()` does not revert when the guard refuses. It emits `Decision(allowed=false, reason)` and returns. The log of "the agent refused because…" is the product, and it is the build-in-public content.
- **One job per unit.** GuardLib knows nothing about Aave; the adapters know nothing about the LLM.

---

## 3. Components

### 3.1 `GuardLib` (Solidity library + contract `MarketCalendar`)
Returns `(bool ok, ReasonCode reason)` for a `(token, action, amount)`. The checks, in order:

| # | Check | Data source | Reason code |
|---|---|---|---|
| 1 | The token is in the mandate's allowlist | Mandate | `TOKEN_NOT_ALLOWED` |
| 2 | The token has not paused the feature needed | B20 paused features | `TOKEN_PAUSED` |
| 3 | The vault is allowed to receive/transfer the token (policy) | `policyExists` + `isAuthorized` | `POLICY_BLOCKED` |
| 4 | The market is open under the mandate's `sessionMode`: `REGULAR` (NYSE 9:30–16:00 ET, the default for Agent #1) or `FEED_24_5` (Sunday 20:00 → Friday 20:00 ET). Both exclude the holidays in the list the owner updates | `MarketCalendar` | `MARKET_CLOSED` |
| 5 | The feed is still live: `block.timestamp − updatedAt ≤ maxStaleness` | Chainlink `latestRoundData` | `FEED_STALE` |
| 6 | No multiplier change within `cooldown` hours, and no scheduled update waiting to take effect | B20 `uiMultiplier` + scheduled-update state | `MULTIPLIER_COOLDOWN` |
| 7 | The DEX price deviates from the oracle price by ≤ `maxPremiumBps` | Aerodrome pool TWAP (30 min) vs Chainlink | `PREMIUM_TOO_HIGH` |
| 8 | Order size ≤ the per-trade limit and the daily limit | Mandate + counters in the vault | `SIZE_LIMIT` |
| 9 | After the order, each token's weight ≤ `maxWeightBps` | **Raw** balance (`balanceOf`) × Chainlink price. The feed is already the price of 1 raw token (the multiplier is already included), so `balanceOfUI` is not used for valuation | `CONCENTRATION` |

**Checks applied by action type:**
- **Buy/sell B20:** all checks apply.
- **Supply / borrow:** checks 1–6 apply. When the market is closed, only risk-*reducing* actions are allowed (repay, add collateral). No additional borrowing.
- **PAY_EXPENSE:** only the payee allowlist check and check 8 apply. The agent can still pay bills when the market is closed.
- **Repay / add collateral:** always allowed, unless blocked by checks 2–3. A risk-reducing action is never blocked because the market is closed.

`MarketCalendar` holds only the ET session hours with the DST offset and the list of 2026 holidays and early closes. The owner can make the calendar **stricter** immediately (add holidays, set earlier closes). To loosen it, deploy a new calendar and switch to it through the mandate (24h timelock).

### 3.2 `MandateVault`
- **Roles:**
  - `owner` (the team's wallet): changes the mandate through the 24h timelock and withdraws funds to the owner's address.
  - `executor` (the agent's CDP Server Wallet): may only call `execute(Intent)`.
- **`Intent`:** `{ id, action ∈ {BUY, SELL, SUPPLY, WITHDRAW_COLLATERAL, BORROW, REPAY, PAY_EXPENSE}, token, amount, minOut, payee, rationaleHash }`. `PAY_EXPENSE` only transfers USDC to a `payee` that is in `allowedPayees`, and it counts toward `dailyCapUSD`; all other actions ignore `payee`. `rationaleHash` is the hash of the LLM's explanation; the text is stored off-chain and shown on the dashboard.
- **Mandate (onchain commitment, with a `mandateHash`):**
  - `allowedTokens`, `allowedRouters`, `creditVenue`, `allowedPayees`, `sessionMode`
  - `maxPremiumBps` (default 100; initially 50, raised after measuring real premiums of 29–53 bps in session), `maxStaleness`, `multiplierCooldown` (24h)
  - `perTradeCapUSD`, `dailyCapUSD`, `maxWeightBps`
  - `targetHF`, `minHF`
  - `fridayDeriskWindow`: during the N hours before the feed freezes at Friday 20:00 ET (default 8, so that a REGULAR session still has 4 trading hours, 12:00–16:00 ET, inside the window), only actions whose post-order HF is ≥ `targetHF + buffer` are allowed
- **Revenue recording:** USDC transferred into the vault (from x402 or creator fees) is recorded through `notifyRevenue()`. Anyone can call this function. It compares the current USDC balance with the balance recorded last time (after subtracting spending made by the vault itself), then emits `RevenueReceived(delta)`.
- **`minOut` is mandatory:** the contract computes its own floor from the oracle price × (1 − maxSlippage) and takes the larger of that floor and the agent's `minOut`. The LLM cannot set an arbitrary slippage.
- **Event:** `Decision(intentId, action, token, amount, allowed, reason, rationaleHash)`, `MandateUpdateQueued/Applied`, `RevenueReceived`.

### 3.3 Adapters
- **`ISwapAdapter`:** `swapExactIn(tokenIn, tokenOut, amountIn, minOut) → amountOut`. First implementation: Aerodrome Slipstream (CL pool USDC/B20).
- **`ICreditAdapter`:** `supply`, `withdraw`, `borrow`, `repay`, `healthFactor`. First implementation: **Aave V4 Equities Hub**. Fallback: a Morpho Blue NVDAc/USDC market, where the team supplies some USDC liquidity itself.
- Each adapter is a separate contract, allowlisted in the mandate. Changing the venue does not require changing the vault.

### 3.4 Guard Service (TypeScript, viem)
- The `readMarketState(token)` function returns `{ marketStatus, feedAgeSec, chainlinkPrice, dexTwapPrice, premiumBps, multiplier, pendingMultiplierUpdate, paused, policyOk, depth2pctUSD, navPrice }`. Sources: Chainlink, the Aerodrome pool, B20, and the Coinbase API (`nav_price`, corporate actions).
- `preview(intent)` simulates exactly the GuardLib logic (it reads through `eth_call` to the `previewIntent` view function on the vault). This way off-chain and onchain do not diverge.
- **x402 endpoint `GET /check?token&side&sizeUSD`** (price ~0.01 USDC per call, `payTo` = the vault address). This is Agent #1's revenue source and also product A2 (FrozenFeed Guard) for other agents to use.
- **MCP server** (tools `market_status`, `check_trade`) + **Bankr Skill** (a SKILL.md that tells the agent to call `check_trade` before a stock order). These two parts are week-3 stretch goals.

### 3.5 Agent Runtime (TypeScript)
- **Loop every 15 minutes** (in session) and every 1 hour (out of session):
  1. Read state: the vault, market state, HF, new revenue.
  2. Call the Claude API (model `claude-sonnet-5-5` for the loop, `claude-opus-5-5` for the end-of-day diary) with a system prompt that contains the mandate and the investment policy. The output is JSON `Intent[]` with a `rationale`. Tool use has a fixed schema.
  3. Call `previewIntent` for each intent. If it is refused, still send `execute` when the reason is "worth logging" (for example `MARKET_CLOSED` when the agent wants to buy). A rate limit avoids wasting gas: at most 1 refusal record per reason per day.
  4. Sign and send through the CDP Server Wallet (executor), which has a spend cap. Every tx carries the Builder Code `dataSuffix`.
- **Default investment policy** (simple, transparent, no "price guessing"):
  - Target basket GOOGLc/NVDAc/AAPLc at equal weights (AMZNc is excluded because its pool has only about $34k of liquidity on 2026-11-06). 30% of revenue stays in USDC.
  - Rebalance when drift exceeds ±5%.
  - Borrow when the USDC balance is below the expected 7-day compute cost, provided the post-borrow HF is ≥ `targetHF`.
  - Repay debt when revenue arrives.
- **Compute cost:** the Claude API cost is recorded per day and used as the "bill" that the agent must pay in USDC through a `PAY_EXPENSE` intent to the expense wallet in `allowedPayees`.

### 3.6 Diary Publisher & Dashboard
- **Dashboard (Next.js + wagmi/viem, SIWE, a standard web app that opens in the Base App):**
  - Portfolio: shows quantities by `balanceOfUI`, value = raw `balanceOf` × feed price, a market-status gauge for each ticker, HF, revenue/cost.
  - **`Decision` timeline**: with a "refused" filter and Basescan links.
  - Mandate page: parameters + `mandateHash`.
- **Diary:** every evening, a job aggregates the day's events and generates a diary entry with Claude (stored on the dashboard, and used to produce a draft X post). **The owner posts to X**: this fits the build-in-public spirit and avoids the risk of the account being treated as automated.
- **Replay page:** replays scenarios on a fork (HIMS squeeze, multiplier change, frozen feed) together with the vault's decisions.

### 3.7 `MandateFactory` (stretch, week 3)
- `createVault(mandateParams, executor)` → deploy vault (clone EIP-1167), emit `VaultCreated`.
- Ships with "Conservative/Balanced" mandate templates and a 5-minute guide in the README.

---

## 4. Main data flows

1. **Revenue:** an outside customer calls `/check` → x402 pays USDC to the vault → `notifyRevenue` → the agent sees the new USDC.
2. **Buy (in session):** the agent issues `BUY NVDAc $20` → `previewIntent` ok → `execute` → GuardLib pass → SwapAdapter → `Decision(allowed=true)`.
3. **Buy (market closed/Thanksgiving):** same intent → GuardLib returns `MARKET_CLOSED` or `FEED_STALE` → `Decision(allowed=false)`. The agent reads the reason and switches to `BORROW $5` → blocked, because additional borrowing is not allowed while the market is closed → the agent uses its USDC reserve to pay the compute bill. The log records this whole sequence.
4. **Before 20:00 ET on Friday:** inside `fridayDeriskWindow` → the agent proposes `REPAY` to bring HF up to `targetHF + buffer`.
5. **Multiplier change** (dividend): `UIMultiplierUpdated` event → 24h cooldown → every buy/sell order for that token is blocked with `MULTIPLIER_COOLDOWN`.

---

## 5. Error handling & safety

| Situation | Behavior |
|---|---|
| The LLM returns invalid JSON or a meaningless intent | Validate the schema off-chain → skip and log. The contract is still the final gate |
| Prompt injection / executor key leaked | The attacker can only call `execute` within the mandate: cannot withdraw funds outside the allowlist, and is bound by the daily cap, the per-trade cap and the slippage floor |
| Swap fails (thin liquidity) | The adapter reverts → the vault catches the error → `Decision(allowed=false, SWAP_FAILED)` |
| Aave V4 cannot be used from a contract | Switch to the Morpho adapter (the interface is already designed) |
| A B20 transfer reverts because of policy | Check 3 blocks it first. If it still reverts, record `POLICY_BLOCKED` |
| Coinbase API or RPC is down | The Guard Service returns `UNKNOWN`. The agent takes no action. The contract still checks by itself using onchain data |
| The Chainlink feed dies unexpectedly during the session | `FEED_STALE` → only risk reduction is allowed |
| The owner wants to change the mandate | Queue + 24h timelock + public event |

**Compliance:**
- The dashboard has a US geofence (by IP) and a self-declared non-US confirmation for the wallet-interaction part. Disclaimer: "not investment advice, no shareholder rights".
- The MVP does not accept user funds.
- The treasury is small and belongs to the team.

---

## 6. Testing

- **Foundry unit tests** for GuardLib: each reason code, session-hour/DST/holiday boundaries, staleness, multiplier cooldown, premium.
- **Foundry fork tests on Base mainnet** (fixed block). B20 is a precompile (bytecode `0xef`), so this needs **Foundry ≥ 1.8.4** with `hardfork = "base:Cobalt"`: a real swap through Aerodrome, supply/borrow/repay through Aave V4, reading `uiMultiplier`/`balanceOfUI`, and a policy check against the vault address.
- **Replay scenarios (fork + mock):**
  1. The feed freezes over the weekend
  2. A HIMS-style +93% premium (mock pool)
  3. The multiplier changes midway
  4. The token is paused
  5. A leaked executor tries to withdraw funds
- **Off-chain:** test that `preview` matches the contract on the same block. Test the agent loop with a mock LLM (fixed output). Test the x402 endpoint end to end on Base Sepolia before going to mainnet.
- **Mainnet smoke test** with $20 before each demo recording.

---

## 7. Scope & schedule

**Week 0 (6–13 Nov) — spikes & verification (make-or-break):**
- S1: buy $20 of NVDAc → supply to Aave V4 → borrow $5 → repay, first from an EOA, then from a minimal contract. *The owner signs the transactions.*
- S2: verify whether the Chainlink equity feed price already includes the multiplier (compared with `nav_price` and the pool price), to settle the premium-check formula.
- S3: record Aero pool data for 10 tickers every hour over the weekend of 7–8 Nov.
- S4: confirm whether the CDP x402 facilitator can pay directly to a contract address.
- Telegram: judging criteria, prize structure, Aave V4 smart-account borrower.

**Week 1 (13–20 Nov):** GuardLib + MarketCalendar + MandateVault + SwapAdapter (fork tests green), v0 mainnet deploy, Guard Service `readMarketState`/`preview`.

**Week 2 (20–27 Nov):** Aave V4 CreditAdapter, agent runtime + CDP executor, x402 endpoint, dashboard v0, **run live through Thanksgiving, 26 Nov, and record the demo**.

**Week 3 (27 Nov – 4 Dec):** diary + replay page, MandateFactory + MCP/Bankr Skill (stretch), README, 3-minute video, X post, submit the form on **4 Dec**.

**Cuts if the schedule slips (in order):** Factory → MCP/Bankr Skill → Replay page → x402 (replace it with a manual USDC deposit recorded as "revenue") → Aave (move the credit part to a fork). Never cut GuardLib, the Decision log, or the mainnet demo.

**Out of scope:** a token of our own, accepting user funds, an AMM hook, a prediction market, a weekend price oracle as a standalone product.

---

## 8. 3-minute demo script (draft)

| Time | Content |
|---|---|
| 0:00–0:15 | Hook: "Most trading agents don't know the market is closed. Ours refuses to trade." Use only incident figures that are verified and sourced (for example the 2026 agent wallet incident), and do not criticize partners |
| 0:15–0:45 | The problems specific to tokenized stocks: the feed freezes on weekends, premium, multiplier |
| 0:45–1:30 | Live mainnet: x402 revenue → the vault buys NVDAc (Basescan + Builder Code) → supply to Aave, borrow USDC to pay for compute |
| 1:30–2:15 | Thanksgiving: the agent wants to buy → `MARKET_CLOSED` → the agent adjusts on its own. HIMS replay: the buy is blocked at +93% |
| 2:15–2:45 | Architecture: "LLM proposes, contract decides". Mandate hash, timelock |
| 2:45–3:00 | Factory/Skill: any agent on Base can use it. Repo link + dashboard |

---

## 9. Assumptions to verify (open risks)

1. A contract (not an EOA) can supply B20 and borrow on the Aave V4 Equities Hub at small scale (S1).
2. ~~Chainlink equity feed price vs. token price~~ **Verified 2026-11-06:** the "Coinbase NVDA" feed returns 184.57691531, which matches the API's `nav_price`. The feed is the price of 1 raw token with the multiplier already applied, so it must not be multiplied by the multiplier again. The Aero pool TWAP also matches (off by about 0.17%).
3. Session calendar: the 24/5 feed (Sunday 20:00 → Friday 20:00 ET) differs from the regular NYSE session hours. By default Agent #1 uses `REGULAR` (safer, better pool liquidity). The S3 data will show whether the after-hours premium is stable enough to enable `FEED_24_5`.
4. The Aerodrome pool has `observe()` for a 30-minute TWAP. If it does not, use a TWAP computed by the Guard Service and check it onchain against the spot price with a tighter limit.
5. x402 pays directly into the contract (S4). If that does not work, it pays into the agent wallet, which then forwards to the vault.
6. The official judging criteria (especially the "50% traction" claim) may force the Factory/Skill to be prioritized earlier.
