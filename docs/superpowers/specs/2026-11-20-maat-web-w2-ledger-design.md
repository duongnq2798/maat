# Maat Web W2: Mainnet ledger & dashboard. Design Spec

- **Date:** 2026-11-20
- **Status:** approved by the owner (decisions in §2, design sections 1–2 approved in chat; the owner asked to proceed without further check-ins). Built. `deployments/README.md` now records the Base mainnet `MandateVault`, deployed on 2026-11-24, so `/ledger` builds in its mainnet state; the waiting state of §6.2 remains for a table with no vault
- **Parent specs:** `docs/superpowers/specs/2026-11-07-maat-web-design.md` §10 (W2), `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md` §3.6 (dashboard) and §5 (compliance)

---

## 1. Goal

A read-only page, `/ledger`, that shows what the mainnet `MandateVault` decided and holds, read straight from Base. It ships now, in a waiting state, and starts reading mainnet the day the owner records the vault's address in `deployments/README.md`, with no code change.

**Success criteria**

1. Before the deploy: `/ledger` is public, says it is waiting for the mainnet deploy, sends no RPC request, shows no invented number, and keeps the labeled fork ledger.
2. After the deploy (address in `deployments/README.md`, `npm run docs:gen`, merge): the page lists every `Decision` the vault emitted, newest first, each with a Basescan link; shows balances by `balanceOfUI`, value = raw × feed, the health factor, revenue and costs, the onchain mandate with the real `mandateHash`, and four charts.
3. A rationale shows the "Hash verified" badge only when `keccak256(text)` equals the `rationaleHash` in the log, computed in the visitor's browser.
4. No secret reaches the browser or the repository. No wallet, no signing, no cookies, no analytics.
5. 360 px to 1920 px with no page scroll; Lighthouse targets of the W1 spec §1 still hold for `/`.

**Not goals:** wallet connection or an owner console; a Base App / Farcaster mini-app manifest; a health-factor history; an indexer or database of chain data; the daily diary and replay page (W3).

---

## 2. Decisions (owner, 2026-11-20)

| Question | Decision | Why |
|---|---|---|
| Read path | **Static export kept; the browser reads Base directly** through public CORS RPCs | Keeps `output: "export"`, `check:out` and the e2e suite unchanged; no server and no secret; "your browser reads the vault, no Maat server in between" |
| Before the deploy | **Public `/ledger` in a waiting state** | Judges see the structure early; the switch to mainnet needs no code change |
| Wallet | **None, read-only** | The vault holds only its own treasury; the owner signs with `cast` (`deployments/README.md`); no geofence needed (treasury spec §5 asks for one only with wallet interaction) |
| Mini-app manifest | **Dropped** | Since 2026-04-09 the Base App treats every app as a standard web app; no Farcaster manifest is needed. The owner can register the site on Base.dev |
| Rationale text | **Static export file now, behind an interface; Supabase later** | The text lives only in the agent's journal. v1 reads `/data/rationales.json`, written by a script from `journal.jsonl`. A Supabase source can replace it in a separate task; the browser verifies every text against the chain, so neither source is trusted |

The owner also asked for polished charts where they help; §6.3 lists them.

---

## 3. Measured constraints (2026-11-20)

| Fact | Value | How it was measured |
|---|---|---|
| Base block time | ~0.2 s (≈ 432,000 blocks a day) | blocks 53,550,859 (2026-11-05T15:04:25Z) and 59,735,280 (2026-11-20T01:17:11Z) on `base-rpc.publicnode.com` |
| `mainnet.base.org` `eth_getLogs` | at most 200 blocks a request, and "request limit reached" on repeated calls | direct JSON-RPC calls |
| `base-rpc.publicnode.com` `eth_getLogs` | at most 50,000 blocks a request ("exceed maximum block range: 50000"); 40 such requests at concurrency 8 took 4.1 s; CORS `*`; JSON-RPC batches supported; Multicall3 deployed | direct JSON-RPC calls |
| Other keyless Base RPCs | drpc 100, 1rpc 50, blastapi 10 blocks per `eth_getLogs`; meowrpc has no `eth_getLogs` | direct JSON-RPC calls |

Consequence: scanning a month of vault history (~13 M blocks) takes ~260 requests of 50,000 blocks, so the scan runs **newest first, in parallel, rendering rows as they arrive, with a progress line**, and caches what it has scanned.

---

## 4. Architecture

```
deployments/README.md ──docs:gen──▶ content/generated/deployments.json ──▶ /data/deployments.json (static)
agent journal.jsonl ──npm run rationales──▶ content/generated/rationales.json ──▶ /data/rationales.json (static)

/ledger (static HTML, waiting state or loading shell)
  └─ LedgerApp ("use client")
       ├─ fetch /data/deployments.json → no MandateVault address: stay waiting, no RPC call
       └─ address: viem public client, fallback transport
            [NEXT_PUBLIC_BASE_RPC_URL?] → base-rpc.publicnode.com → mainnet.base.org
            ├─ verify: bytecode at the address and TIMELOCK() == 86,400
            ├─ multicall: mandate, mandateHash, owner, executor, paused, tokens, tokenConfig,
            │             balanceOf / balanceOfUI / decimals, feeds, USDC, credit debt + HF
            ├─ eth_getLogs of the vault, 50,000-block chunks, newest first → decode every vault event
            ├─ batch: block headers (timestamps) and receipts (gas) of Decision txs
            └─ fetch /data/rationales.json → keccak256(text) vs rationaleHash, per row
```

The page reads `/data/deployments.json` at runtime instead of baking the address into the bundle, so the e2e suite can serve a fake address to the real production build (§8). The file is generated from the same table as the docs' deployment table, so production cannot disagree with itself.

`NEXT_PUBLIC_BASE_RPC_URL` is optional and public by construction (it ships in the bundle). It is meant for a domain-restricted endpoint. `BASE_RPC_URL`, the agent's and the deploy script's private endpoint, is never read by `web/`.

---

## 5. Units

Each unit is a small module with one job and a unit test.

| Unit | Path | Job |
|---|---|---|
| Deployment config | `lib/chain/config.ts` | Pick the Base mainnet `MandateVault` row from the deployments data; validate the address (20 bytes) and the tx hash (32 bytes); return `{ vault, deployTx } \| null`. A malformed address throws at build time |
| RPC list | `lib/chain/rpc.ts` | The ordered endpoint list from `NEXT_PUBLIC_BASE_RPC_URL` and the two defaults; the viem client |
| ABIs | `lib/chain/abi.ts` | `MandateVault` and `ICreditAdapter` from `content/generated/abi.json`; the few B20, Chainlink and ERC-20 items as constants, parity-tested against `agent/src/abi/generated.ts` |
| Log scan | `lib/chain/scan.ts` | Split `[from, to]` into chunks, newest first; run them with bounded concurrency; halve a chunk on a range error down to 200 blocks; report progress; stop on abort |
| Cache | `lib/chain/cache.ts` | One `localStorage` entry per vault: the contiguous scanned range, the raw logs, block timestamps and gas used. Every read and write in try/catch; a bad entry is dropped. The newest 150 blocks are never cached |
| Decode | `lib/chain/events.ts` | Vault logs → typed events (`Decision`, `RevenueReceived`, `Funded`, `Withdrawn`, the queue/apply/cancel events, `PausedSet`, `ExecutorSet`) |
| Ledger model | `lib/chain/ledger.ts` | Decisions → `DecisionRow` (source `base-mainnet`, tx hash, ET time, amount in the action's unit); totals (funded, revenue, expenses, withdrawn); decisions per ET day; refusals by reason; pending changes with their ETA |
| Treasury | `lib/chain/treasury.ts` | The multicall and its pure math: value = raw × price / 10^(decimals+2), as `MandateVault._valueUsd`; weight in bps; health factor from 1e18; equity = USDC + stock value (held + supplied) − debt. A failed read is an error, never a zero |
| Rationale | `lib/chain/rationale.ts` | `RationaleSource` interface, the static-file source, and `verifyRationale(text, hash)` → `verified` / `mismatch`; a row without text is `missing` |
| Rationale export | `lib/rationales-export.ts`, `scripts/rationales.ts` | `journal.jsonl` → `content/generated/rationales.json` (`intentId`, `rationaleHash`, `text`, `txHash`, `ts`) for every `intent` or `sent` row that reached a transaction; refuses a row whose text does not hash to its `rationaleHash` |
| Reason display | `lib/chain/reason.ts` | The one place that turns a reason code into display text. Today: the code, with `REASON_MEANING` as the note; switches to `REASON_LABEL` (another branch adds it to `content/reasons.ts`) in one line |
| Data routes | `app/data/deployments.json/route.ts`, `app/data/rationales.json/route.ts` | Static JSON from the generated files |

Amounts by action, from `agent/src/intent.ts` `buildIntent`: BUY, BORROW, REPAY and PAY_EXPENSE carry USDC (6 decimals) and show as dollars; SELL, SUPPLY and WITHDRAW_COLLATERAL carry raw stock units and show as a token quantity.

---

## 6. The page

### 6.1 Layout, top to bottom

1. **Nav** (the landing's, with anchors as `/#how` so they work from any page; "Ledger" opens `/ledger`).
2. **Header:** eyebrow "Base mainnet ledger", H1 "Every decision, read from the chain.", a lead, and a status strip: *Waiting for the mainnet deploy* before the deploy; *Reading Base mainnet · block N · updated Ns ago* after. The strip also shows the vault, owner and executor (Basescan links), whether the vault is paused, and the RPC host answering.
3. **KPI tiles:** decisions (allowed / refused), equity in USD, health factor, revenue against expenses.
4. **Charts** (§6.3).
5. **Treasury table:** token, quantity by `balanceOfUI`, raw units, feed price and its age, value, weight; a USDC row; a credit row (supplied, debt).
6. **Decision timeline:** time (ET), intent, decision (label and code), rationale with its badge (expandable), gas, Basescan link. Filters: All / Allowed / Refused, plus a reason filter set from the refusals chart.
7. **Mandate:** every field read onchain beside the value `MaatConfig.defaultMandate` sets, flagged where they differ; the full `mandateHash` with a copy button; pending changes with their ETA.
8. **How this page reads the chain:** the endpoints, the contract, the event signature, and that nothing is signed and nothing is stored outside the browser.
9. **The fork run:** the labeled fork ledger (`LedgerTable` with `getDecisions()`), unchanged.

The landing page gains one link, "Open the mainnet ledger", in its Ledger section.

### 6.2 Waiting state

Rendered statically. The status strip says the page reads nothing until `deployments/README.md` has the vault's address. KPI tiles, charts, treasury and timeline show `[after deploy]` or an empty state ("Appears after the first mainnet decision"). The mandate section shows the configured default mandate, labeled as the configuration and not as an onchain read. The word "live" appears nowhere in this state.

### 6.3 Charts

Hand-built SVG like the landing's `WeekChart` and `PremiumChart`; no chart library. Each has `role="img"`, an `aria-label` that states the data, a visually hidden table of the same numbers, and an empty state.

| Chart | Data | Form |
|---|---|---|
| Decisions per day | `Decision` events by ET day of their block | Stacked columns, allowed and refused |
| Refusals by reason | refused `Decision` events by reason | Horizontal bars, label then code; each bar is a button that filters the timeline |
| Holdings vs targets | each stock's weight now; the agent policy's target weight (`FACTS.targetWeightPct`); `maxWeightBps` from `tokenConfig` onchain | Bullet bars |
| Health factor | `healthFactor()` now; `minHealthFactor` and `targetHealthFactor` from the onchain mandate | One bullet bar with two marks; hidden when the vault has no credit adapter or no debt |

No health-factor history: the factor is not in any event, and reading it at past blocks needs an archive node per point, which free RPCs do not serve at this volume. The page says so under the chart.

### 6.4 Refresh

After the first load, the page rescans from the last scanned block every 60 s while the tab is visible, and re-reads the multicall.

---

## 7. Errors and honesty

| Situation | Behavior |
|---|---|
| `/data/deployments.json` has no vault | Waiting state; no RPC request |
| No bytecode at the address, or `TIMELOCK()` is not 86,400 | Error panel naming the address; no numbers |
| Every endpoint fails | Error panel with Retry and a link to the vault's events on Basescan |
| One read in the multicall fails | That cell shows "unavailable"; never 0 |
| Log scan stops part way | Rows found so far, a line saying which blocks were not scanned, Retry |
| Rationale text missing | "Rationale not exported yet" |
| Text does not hash to `rationaleHash` | "Hash mismatch", in the refuse color, with both hashes |

Every number on the page is either read from the chain at a stated block or comes from `content/facts.ts` with its source. The docs' deploy-claims test (`test/docs-content.test.ts`) keeps working: the page states its mode from the data, so nothing on it has to be rewritten at launch.

---

## 8. Testing

**Unit (vitest):** every unit of §5 with fixtures, including:
- config: empty table → `null`; valid row → checksummed address; malformed address → throws;
- scan: chunk plan newest first, range-error halving, concurrency bound, abort, progress;
- cache: round trip, corrupt entry dropped, storage that throws;
- treasury math against hand-computed values and a parity check of the formula in `MandateVault._valueUsd`;
- ledger model: rows, ET day buckets, totals, refusals by reason, pending changes;
- rationale: verified, mismatch, missing; export refuses a bad hash and drops rows without a transaction;
- components: the waiting state contains no "live" claim and makes no fetch to an RPC; the mainnet state (with a fake client) shows Basescan links, both badges, and the reason filter;
- charts: empty states, `aria-label` text, hidden tables.

**E2E (Playwright, on the real `out/`):**
- waiting state: the page renders, makes no request outside the site, fits 360–1920 px, no console error, axe clean;
- mainnet state: `/data/deployments.json` and `/data/rationales.json` served by the test, and every RPC host answered by a fake JSON-RPC server built with viem's encoders (`e2e/fake-rpc.ts`) that serves `eth_chainId`, `eth_blockNumber`, `eth_getCode`, `eth_call` (Multicall3 `aggregate3`), `eth_getLogs`, `eth_getBlockByNumber` and `eth_getTransactionReceipt`. Asserts rows, Basescan links, a verified and a mismatched badge, the reason filter from the chart, treasury values, the health factor, fit at every width, and no request to any host the test does not answer.

**`check:out`:** `ledger.html`, `data/deployments.json` and `data/rationales.json` are required, and both JSON files equal their generated sources.

---

## 9. Docs to update in the same change

- `web/content/docs/get-started/status.mdx`: the ledger moves from Planned to Built; the website row says the ledger page reads Base from the visitor's browser after the deploy; the manifest leaves the plan.
- `README.md` status table: the same.
- `docs/superpowers/specs/2026-11-07-maat-web-design.md` §10: points here; records that the read path stayed client-side and the manifest was dropped.
- `web/content/docs/guides/watch-decisions-onchain.mdx`: links `/ledger`.
- `web/README.md`: the `rationales` command and the two data files.
- `deployments/README.md`: after filling the table, run `npm run docs:gen` in `web/` so `/ledger` reads the vault.

---

## 10. Follow-ups (separate tasks)

- **Supabase rationale source:** the agent writes each rationale to a table with an insert-only key on the agent host; the site reads it with the anon key under a read-only row-level policy, through the same `RationaleSource` interface.
- **Readable refusal labels:** when `REASON_LABEL` lands in `content/reasons.ts`, switch `lib/chain/reason.ts` to it.
