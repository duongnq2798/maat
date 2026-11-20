# Right now on Base: the live strip and /now

Date: 2026-11-20. Branch: `feat/live-strip`. Status: approved by the owner's standing approval of the 2026-11-20 strategy report (Move 5).

## 1. Goal

Before the vault is deployed, maatonbase.xyz shows nothing that is live. This change adds two things that read Base mainnet from the visitor's browser:

- **The strip.** One line under the landing H1. It names the Base block it read, the NYSE session at that block, and what an agent under Maat's default mandate would do with a BUY of each basket token, for example: "An agent under Maat's default mandate would REFUSE: Market closed".
- **`/now` ("Right now on Base").** The same reading for the 13 B20 tokens that have a NAV feed, one row each, with the values behind the verdict and the method.

Success means a judge on a phone sees a block number that matches Basescan, and every number on the page traces to a public read at that block. The site never says "safe", never presents an old reading as live, and says so when the RPC fails.

## 2. The 13 tokens

Coinbase's keyless list (`GET https://api.coinbase.com/v1/tokenized-stocks`, read 2026-11-20) returns 378 B20 tokens, and exactly 13 carry a NAV price: AAPLc, AMZNc, ANTc, CRCLc, GOOGLc, INTCc, METAc, MSFTc, MSTRc, NVDAc, SNDKc, SPCXc, TSLAc. The NAV equals the answer of the Chainlink feed "Coinbase X" on Base.

Verified on Base mainnet on 2026-11-20 for each token:

- B20 factory `0xb20f000000000000000000000000000000000000` `isB20(token)` is true;
- the Chainlink proxy's `description()` is "Coinbase X" (ANT: "Coinbase ANT / USD"), 8 decimals, and its `aggregator()` matches Chainlink's directory;
- the Aerodrome Slipstream pool (factory `0x9CB220581b91b0C83223012FE69688b92aD07a76`, tick spacing 10) has `token0()` = USDC and `token1()` = the token, and `observe([1800, 0])` answers.

ANTc has a feed ("Coinbase ANT / USD", proxy `0xeEDc7412E991a3F2BD693eb2aC7fB0F27d4660dA`). There is no COINc token: Chainlink has a "Coinbase COIN" feed, but no B20 trades against it, so COIN is not on the page.

The list lives in `web/content/b20-nav.ts` (symbol, name, token, feed, pool), with the source of every address in a comment. A test holds the three basket rows equal to `content/generated/base-addresses.json`, so the strip and the contracts name the same feeds and pools.

## 3. What is read, and how

### 3.1 One multicall at one block

Every refresh is one `eth_call` to Multicall3 (`0xcA11bde05977b3631167028862bE2a173976CA11`) `aggregate3` at `latest`, each call with `allowFailure = true`:

- `getBlockNumber()` and `getCurrentBlockTimestamp()`, so the block and its timestamp come from the same state as every value;
- per token: `isPaused(0)` (the transfer feature), `uiMultiplier()`, `effectiveAt()`;
- per feed: `latestRoundData()`;
- per pool: `observe([twapWindow, 0])`, with `twapWindow` from `FACTS.mandate.twapWindowSec`.

That is 2 + 13 × 5 = 67 calls in one request. A call that fails comes back as a failure and is judged as the contract judges it (section 4), never dropped.

When `deployments/README.md` gives a Base mainnet `MarketCalendar` address (through `content/generated/deployments.json`), a second `eth_call` at the same block number reads `isOpen(blockTimestamp, REGULAR)`. Until then the session comes from `web/content/calendar.ts`, the repo's tested port of `MarketCalendar.sol`, evaluated at the block's timestamp, and the page says which source it used.

### 3.2 The reader

`web/lib/live/` holds a reader with no dependencies:

- `rpc.ts`: JSON-RPC over `fetch`, a timeout of 8 s per request, and a fixed endpoint list tried in order: `https://base-rpc.publicnode.com`, then `https://mainnet.base.org`, the same keyless list as the W2 ledger (PR #15). No environment variable is read, so nothing private can reach the browser bundle.
- `abi.ts`: the few encoders and decoders the calls above need (static words, `uint32[]`, `aggregate3` in and out, `int56[]`). Selectors are constants; a test recomputes each one with keccak-256.
- `price.ts`: ports of `PriceLib.twapPrice` (tick average rounded toward negative infinity), `TickMath.getSqrtRatioAtTick`, `PriceLib.priceFromSqrt` and `PriceLib.premiumBps`, in `bigint`, tested against the vectors of `contracts/test/PriceLib.t.sol` and TickMath's bounds.
- `snapshot.ts`: builds the calls, decodes the answers into a `LiveSnapshot` (block, timestamp, endpoint, one `TokenReading` per token).

The reader sits behind one interface, `call({ to, data }, blockTag)`. When PR #15's viem client is on main, it can implement that interface without touching the decoders; the landing keeps this small reader so viem never loads on `/`.

## 4. The verdict

`web/lib/live/verdict.ts` is a pure function of a `TokenReading`, the block timestamp, the session and `FACTS.mandate`. It follows `MandateVault._check` and `GuardLib.checkMarket` for a BUY, in contract order, and stops at the first failure:

| # | Check | How the page decides | Reason |
|---|---|---|---|
| 1 | Token allowed | in `FACTS.basket` | `TOKEN_NOT_ALLOWED` |
| 2 | Token not paused | `isPaused(0)`; a failed call counts as paused | `TOKEN_PAUSED` |
| 3 | Vault policy | not run: it needs a deployed vault | none |
| 4 | Market session | calendar (3.1); a failed calendar call counts as closed | `MARKET_CLOSED` |
| 5 | Feed freshness | answer > 0, `updatedAt` ≠ 0 and ≤ block time, else `BAD_PRICE`; age > `maxStalenessSec` | `FEED_STALE` |
| 6 | Multiplier stable | as for a vault whose record holds the current multiplier: `effectiveAt` in the future, or within `multiplierCooldownSec` after it; a failed call counts as blocked | `MULTIPLIER_COOLDOWN` |
| 7 | DEX premium | TWAP unreadable → `BAD_PRICE`; `premiumBps(twap, answer)` > `maxPremiumBps` | `PREMIUM_TOO_HIGH` |
| 8-9 | Size, concentration | not run: they need a vault's balances | none |

Each token gets two results: **default mandate** (checks 1 to 7) and **market checks** (checks 2 to 7, as if the token were listed with the default limits). For the ten tokens outside the basket the first is always `TOKEN_NOT_ALLOWED`; the second still shows what the market says.

Wording, built from `REASON_LABEL` and `reasonText` in `web/content/reasons.ts`:

- all three basket tokens refused for the same reason: "An agent under Maat's default mandate would REFUSE: Market closed", with the code beside the label as `ReasonTag` shows it;
- different results: "would REFUSE AAPLc: Pool price too far from oracle" for each refused token, then "Market checks pass for NVDAc, GOOGLc";
- none refused: "An agent under Maat's default mandate would pass the market checks for NVDAc, GOOGLc and AAPLc", followed by "vault checks not run" linking to the method.

The words "safe" and "safety" never appear in this UI; a test pins that.

## 5. Freshness and failure

`useLiveSnapshot` reads once after hydration, then every 30 s while the tab is visible, and at once when a hidden tab comes back after more than 30 s. A reading is shown as **live** only when:

- it was read less than 90 s ago (the visitor's monotonic clock), and
- the block timestamp is within 120 s of the visitor's clock (an RPC that serves an old head is not live).

Otherwise the strip shows a labelled state, never the live pill:

| State | Shown |
|---|---|
| reading (first load, and the static HTML) | "Reading Base mainnet…" in the strip's reserved space |
| stale (a later refresh failed, or the reading aged) | "Not live · last read block N, M min ago" with the old verdict in muted text and "the RPC did not answer since" |
| behind (head older than 120 s) | "Not live · the RPC's latest block N is M min behind your clock" |
| error (no reading yet) | "Could not read Base mainnet (both public RPCs failed). Nothing is shown rather than old data." and a Retry button |

The static export carries no chain value at all: a crawler and a no-JS reader get the reading state and a `noscript` line that says the strip needs JavaScript and links `/now`. The strip reserves its height so the landing does not shift when the reading arrives.

## 6. Surfaces

### 6.1 The strip

A client island in `components/sections/Hero.tsx`, right under the H1. Live, at phone width it may wrap to two lines:

`● LIVE · Base block 60,008,725 · 16:28:40 UTC · NYSE open until 16:00 ET — An agent under Maat's default mandate would REFUSE: Market closed MARKET_CLOSED · All 13 B20s →`

The block number links to `https://basescan.org/block/N`. "All 13 B20s" links `/now`.

### 6.2 `/now`

A new static route `app/(site)/now/page.tsx` with its own title, description and canonical `/now`, in the sitemap. Server-rendered: the heading, the method and the token list (symbols and addresses, with Basescan links). Client: the reading.

- A status line: live pill, block (Basescan link), block time in UTC and ET, the endpoint list, a Refresh button.
- The headline verdict (section 4).
- One row per token, in the order of section 2: token; in the default mandate (yes/no); feed age against `maxStalenessSec`; NAV (the feed answer, USD); 30-min TWAP (USD); premium in bps against `maxPremiumBps`; paused; `uiMultiplier`; `effectiveAt` (date, or "none"); default-mandate verdict; market-check verdict. Desktop shows a table inside a horizontal scroll region; phones show one card per token. A failed call shows "could not read" in its cell and the verdict it implies.
- "How this page reads Base": the calls of 3.1, the check order of section 4 with each threshold and its `FACTS` source, the calendar source, the endpoints, and that nothing is signed and the site has no server.

### 6.3 The simulator's Now chip

The simulator computes checks 2, 3, 5, 6 and 7 from fork values (for example "14s ≤ 3600s"), tagged `fork`. When the Now chip is the selected moment, a line under the checks says: "Now sets the time only. The rows tagged fork hold Base block 53,551,627 (Thu 2026-11-05, 10:30 ET), not now. Read the live values on Right now on Base." The fork tag reads "fork value" in that state. The simulator's results are unchanged.

## 7. Testing

- Unit (vitest): selectors against keccak-256; encoder and decoder round trips; `price.ts` against `PriceLib.t.sol` vectors and TickMath bounds; the verdict for each failure in order and for each failed call; the headline wording for same, mixed and no refusals; the hook's states with fake timers and a fake reader (live, stale after a failed refresh, behind, error, retry); the strip and `/now` rendering per state; no "safe" in either; the basket rows equal `base-addresses.json`; the simulator note appears only with Now.
- Export check (`npm run check:out`): `out/now.html` exists with its canonical, and neither page's HTML holds a block number or a verdict.
- End to end (Playwright, `--workers=2`, port 4173 used by one run at a time): every spec routes the two RPC hosts to a fake that answers `aggregate3` from fixtures, so no test touches the network. Scenarios: weekend refusal; in-session pass with one premium refusal; RPC failure then recovery; `/now` at 375 px with no horizontal page scroll; axe on `/now`.

## 8. Out of scope

- Checks 3, 8 and 9, and the multiplier record of a real vault: they need the deployed vault; PR #15's ledger is where its state lives.
- Swapping the reader for PR #15's client (a later change once it is on main).
- History: the Weekend Gap Index is a separate change (`feat/weekend-gap-index`).
