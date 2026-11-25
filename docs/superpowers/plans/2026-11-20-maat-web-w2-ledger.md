# Maat Web W2: Mainnet ledger & dashboard. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/ledger`, a read-only page that waits for the mainnet deploy today and then reads the `MandateVault`'s decisions, treasury and mandate straight from Base in the visitor's browser.

**Architecture:** The site stays a static export. A client island reads `/data/deployments.json` (generated from `deployments/README.md`); with no vault address it stays in a waiting state and makes no RPC call. With an address it reads Base through a viem fallback transport (optional `NEXT_PUBLIC_BASE_RPC_URL`, then `base-rpc.publicnode.com`, then `mainnet.base.org`): one multicall for state, a newest-first parallel `eth_getLogs` scan for events, JSON-RPC batches for block times and receipts, and `/data/rationales.json` for rationale text verified by `keccak256`.

**Tech Stack:** Next.js 16.4.5 static export, React 19.3.1, Tailwind 4, viem 2.57.16 (same pin as `agent/`), vitest 5 + Testing Library, Playwright 1.65.

**Spec:** `docs/superpowers/specs/2026-11-20-maat-web-w2-ledger-design.md`

## Global Constraints

- `output: "export"` stays in `web/next.config.ts`.
- No wallet library (wagmi, onchainkit, RainbowKit…); viem only. No chart library.
- `web/` never reads `BASE_RPC_URL` or any `.env` file. Only `NEXT_PUBLIC_BASE_RPC_URL` (optional, public) is read.
- Default RPCs: `https://base-rpc.publicnode.com`, then `https://mainnet.base.org`. Log chunk: 50,000 blocks, halving on range errors down to 200.
- Nothing on the page says "live" while `/data/deployments.json` has no `MandateVault` address.
- Every number shown is either read onchain at a stated block or comes from `content/facts.ts` with its source.
- Committed files in English. `git add -- <files>`; no `--amend`, no force push.
- Reason text goes through `lib/chain/reason.ts` only (another branch adds `REASON_LABEL` to `content/reasons.ts`).
- Charts: hand-built SVG, `role="img"` + `aria-label`, a visually hidden data table, an empty state.

## Review Focus

1. **An RPC that returns a JSON-RPC error inside HTTP 200** (range limit, rate limit): the scan must treat it as a failure for that chunk, halve on range errors, and fall through to the next transport, never record the chunk as empty. Pinned in Task 3.
2. **A storage that throws or holds garbage** (private window, quota, an old cache version): the page must still render and rescan. Pinned in Task 4.
3. **A multicall read that fails** (a token's feed unreadable, credit adapter view reverting): that cell says "unavailable"; equity is not computed from a zero. Pinned in Task 6.
4. **A deployments row with an address but no tx hash**: the scan starts from the fixed floor block instead of failing. Pinned in Task 1 and Task 8.
5. **Rationale text with non-ASCII characters or trailing whitespace**: hashing must use the exact UTF-8 bytes (viem `toBytes`), as `agent/src/intent.ts` does, so a verified badge is never lost or forged by normalization. Pinned in Task 7.

---

### Task 1: viem, deployment config and `/data/deployments.json`

**Files:**
- Modify: `web/package.json` (dependency `viem` `2.57.16`)
- Create: `web/lib/chain/config.ts`
- Create: `web/app/data/deployments.json/route.ts`
- Modify: `web/scripts/check-out.ts` (REQUIRED gains `data/deployments.json`; equality with the generated data)
- Test: `web/test/chain-config.test.ts`

**Interfaces:**
- Produces:
  - `type VaultDeployment = { vault: Address; deployTx: Hash | null }`
  - `deploymentConfig(rows: readonly Deployment[]): VaultDeployment | null`
  - `deploymentsFile(rows): { network: "Base mainnet"; chainId: 8453; vault: Address | null; deployTx: Hash | null; contracts: Deployment[] }`
  - `SCAN_FLOOR_BLOCK = 59_735_280` (Base block of 2026-11-20T01:17:11Z, measured; no Maat contract exists before it)

- [ ] **Step 1: Install viem** — `cd web && npm install --save-exact viem@2.57.16`.
- [ ] **Step 2: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { deploymentConfig, deploymentsFile, SCAN_FLOOR_BLOCK } from "@/lib/chain/config";
import { docsData } from "@/lib/docs/generated";

const row = (contract: string, address = "", tx = "") => ({ network: "Base mainnet", contract, address, tx, date: "" });

describe("deploymentConfig", () => {
  it("is null while the MandateVault row has no address (today's table)", () => {
    expect(deploymentConfig(docsData.deployments)).toBeNull();
  });
  it("returns the checksummed vault and its deploy tx", () => {
    const c = deploymentConfig([row("MandateVault", "0xb20000000000000000000078ee7ce2fe4908108c", `0x${"ab".repeat(32)}`)]);
    expect(c).toEqual({ vault: "0xb20000000000000000000078ee7ce2fE4908108C", deployTx: `0x${"ab".repeat(32)}` });
  });
  it("keeps the address when the tx cell is empty", () => {
    expect(deploymentConfig([row("MandateVault", "0xb20000000000000000000078ee7ce2fe4908108c")])?.deployTx).toBeNull();
  });
  it("throws on a malformed address or tx, so the build fails instead of the page", () => {
    expect(() => deploymentConfig([row("MandateVault", "0x1234")])).toThrow(/MandateVault address/);
    expect(() => deploymentConfig([row("MandateVault", "0xb20000000000000000000078ee7ce2fe4908108c", "0xzz")])).toThrow(/tx/);
  });
  it("ignores other networks and contracts", () => {
    expect(deploymentConfig([row("MarketCalendar", "0xb20000000000000000000078ee7ce2fe4908108c")])).toBeNull();
  });
});

describe("deploymentsFile", () => {
  it("publishes the table with the vault fields", () => {
    const f = deploymentsFile(docsData.deployments);
    expect(f).toMatchObject({ network: "Base mainnet", chainId: 8453, vault: null, deployTx: null });
    expect(f.contracts).toEqual(docsData.deployments);
  });
  it("floors the scan at a measured block", () => {
    expect(SCAN_FLOOR_BLOCK).toBe(59_735_280);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run test/chain-config.test.ts` → FAIL (module missing).
- [ ] **Step 4: Implement** `lib/chain/config.ts` with `getAddress`/`isHash` from viem; the route mirrors `app/data/abi/[name]/route.ts` (`dynamic = "force-static"`, JSON body with trailing newline).
- [ ] **Step 5: check:out** — add `"data/deployments.json"` to `REQUIRED` and compare `read("data/deployments.json")` with `JSON.stringify(deploymentsFile(docsData.deployments), null, 2) + "\n"`.
- [ ] **Step 6: Run** the test → PASS; `npm run typecheck`.
- [ ] **Step 7: Commit** `feat(web): read the vault address from the deployments table`.

### Task 2: ABIs for the browser reads

**Files:**
- Create: `web/lib/chain/abi.ts`
- Test: `web/test/chain-abi.test.ts`

**Interfaces:**
- Produces: `vaultAbi`, `creditAdapterAbi` (from `content/generated/abi.json`, typed `as const` via a cast to viem `Abi`), `b20Abi` (`balanceOf`, `balanceOfUI`, `decimals`, `uiMultiplier`), `feedAbi` (`latestRoundData`), `erc20Abi` (`balanceOf`), each `as const`.

- [ ] **Step 1: Failing test** — for every item of `b20Abi`, `feedAbi`, `erc20Abi`, find an item with the same `name` in the matching export of `agent/src/abi/generated.ts` (`b20AssetAbi`, `aggregatorV3Abi`, `erc20Abi`, parsed with the same `export const <name> = [...] as const;` slicing as `parseAbis` in `lib/docs/docs-data.ts`) and `expect` equal `inputs`, `outputs` and `stateMutability`. Also: `vaultAbi` has the `Decision` event with the seven inputs of `IMandateVaultEvents.sol` in order.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the constants.
- [ ] **Step 4: Run** → PASS. **Commit** `feat(web): browser ABIs, parity-tested against the agent's`.

### Task 3: Newest-first log scan

**Files:**
- Create: `web/lib/chain/scan.ts`
- Test: `web/test/chain-scan.test.ts`

**Interfaces:**
- Produces:
  - `planChunks(from: bigint, to: bigint, span: bigint): { from: bigint; to: bigint }[]` — newest first, inclusive bounds, last chunk clipped at `from`.
  - `isRangeError(e: unknown): boolean` — matches "block range", "range over", "limited to", "exceed maximum block range" in the error message or its `details`/`cause`.
  - `scanLogs<L>(opts: { from: bigint; to: bigint; span?: bigint; minSpan?: bigint; concurrency?: number; getLogs: (r: { from: bigint; to: bigint }) => Promise<L[]>; onChunk?: (r: { from: bigint; to: bigint; logs: L[] }) => void; signal?: AbortSignal }): Promise<{ logs: L[]; scanned: { from: bigint; to: bigint } | null; failed: { from: bigint; to: bigint }[] }>` — defaults `span 50_000n`, `minSpan 200n`, `concurrency 6`. `scanned` is the contiguous range from `to` downward that completed; `failed` lists ranges given up after the minimum span.

- [ ] **Step 1: Failing tests** — chunk plan for `(0n, 120_000n, 50_000n)` = `[[70_001,120_000],[20_001,70_000],[0,20_000]]`; a `getLogs` that throws `new Error("exceed maximum block range: 50000")` for spans > 25,000 makes the scan succeed with 25,000-block calls; a `getLogs` that always throws a range error ends with `failed` and `scanned` covering only the chunks above it; `concurrency: 2` never has more than two calls in flight (counter in the fake); an aborted signal rejects with `AbortError` and makes no new call; `onChunk` sees each completed chunk; logs are returned in descending chunk order; a non-range error (e.g. `"request limit reached"`) retries the same chunk once, then counts it as failed without halving.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** a worker pool over a queue of chunks; a range error splits the chunk into two halves pushed to the front; `scanned.from` is the lowest chunk start such that every chunk above it completed.
- [ ] **Step 4: Run** → PASS. **Commit** `feat(web): newest-first parallel log scan with range-error halving`.

### Task 4: Browser cache

**Files:**
- Create: `web/lib/chain/cache.ts`
- Test: `web/test/chain-cache.test.ts`

**Interfaces:**
- Produces:
  - `type CachedLog = { blockNumber: string; logIndex: number; transactionHash: Hash; topics: Hex[]; data: Hex }`
  - `type LedgerCache = { v: 1; vault: Address; from: string; to: string; logs: CachedLog[]; blockTimes: Record<string, number>; gasUsed: Record<string, string> }`
  - `loadCache(vault, storage?: Storage | null): LedgerCache | null`, `saveCache(c, storage?)`, `CACHE_SAFETY_BLOCKS = 150n`, `cacheKey(vault)` = `maat:ledger:v1:<lowercase vault>`.

- [ ] **Step 1: Failing tests** — round trip; an entry for another vault, another version or invalid JSON returns `null` and is removed; a storage whose `getItem`/`setItem` throws returns `null` / swallows; `storage` `null` works.
- [ ] **Step 2–4:** run, implement (validate shape with zod, already a dependency), pass. **Commit** `feat(web): cache scanned vault logs in the browser`.

### Task 5: Events, ledger model, reason display

**Files:**
- Create: `web/lib/chain/events.ts`, `web/lib/chain/ledger.ts`, `web/lib/chain/reason.ts`
- Modify: `web/content/decisions.ts` (`DecisionRow` gains optional `amountLabel?: string`, `intentId?: Hex`, `rationaleHash?: Hex`, `timestamp?: number`; `intentLabel` uses `amountLabel` when present)
- Test: `web/test/chain-ledger.test.ts`

**Interfaces:**
- Consumes: `vaultAbi` (Task 2), `ACTIONS`, `DecisionRow` (`content/decisions.ts`), `REASONS`, `REASON_MEANING` (`content/reasons.ts`), `dayLabel`/ET helpers (`content/format.ts`, `content/calendar.ts`).
- Produces:
  - `decodeVaultLogs(logs: CachedLog[]): VaultEvent[]` where `VaultEvent` is a union by `name`: `Decision { intentId, action: ActionName, token, amount, allowed, reason: ReasonCode, rationaleHash }`, `RevenueReceived { amount }`, `Funded { amount }`, `Withdrawn { token, amount }`, `MandateChangeQueued { changeHash, eta }`, `TokenConfigChangeQueued { changeHash, eta, token }`, `PayeeChangeQueued { changeHash, eta, payee, allowed }`, `ChangeCancelled { changeHash }`, `MandateApplied { mandateHash }`, `TokenConfigApplied { token }`, `PayeeApplied { payee, allowed }`, `PausedSet { paused }`, `ExecutorSet { executor }`; each with `blockNumber: bigint`, `logIndex: number`, `txHash: Hash`. Unknown topics are skipped.
  - `toDecisionRows(events, ctx: { blockTimes: Record<string, number>; gasUsed: Record<string, string>; tokens: Record<string, { symbol: string; decimals: number }>; usdc: Address }): DecisionRow[]` — newest first; `timeLabel` like `Thu 26 Nov 10:30` (ET) or `block N` when the time is unknown; `amountLabel` `$12.50` for USDC actions, `0.1083 NVDAc` for raw-stock actions.
  - `summarize(events): { allowed: number; refused: number; fundedUsd6: bigint; revenueUsd6: bigint; expensesUsd6: bigint; withdrawnUsdcUsd6: bigint; perDay: { day: string; allowed: number; refused: number }[]; byReason: { code: RefusalCode; count: number }[]; pending: { kind: "mandate" | "token" | "payee"; changeHash: Hex; eta: number; subject?: Address }[] }` (`perDay` needs block times: `summarize(events, blockTimes)`).
  - `reasonDisplay(code: ReasonCode): { label: string; code: ReasonCode; meaning: string }` — today `label = code`, `meaning = code === "OK" ? "All checks passed." : REASON_MEANING[code]`.

- [ ] **Step 1: Failing tests** — encode logs with viem `encodeEventTopics`/`encodeAbiParameters` from `vaultAbi` (a BUY allowed, a BUY refused `MARKET_CLOSED`, a PAY_EXPENSE allowed of 1.5 USDC, a `RevenueReceived` 2 USDC, a `Funded` 20 USDC, a `MandateChangeQueued` then `ChangeCancelled`, a `TokenConfigChangeQueued` still pending) and assert: decoded names and fields; rows newest first with `source: "base-mainnet"`, `txHash`, `amountLabel`; totals (`expensesUsd6 = 1_500_000n`, `revenueUsd6 = 2_000_000n`, `fundedUsd6 = 20_000_000n`); `perDay` buckets by ET date (a block at 2026-11-27T04:30Z belongs to 26 Nov ET); `byReason` sorted by count then enum order; `pending` holds only the token change. `reasonDisplay("MARKET_CLOSED").meaning` equals `REASON_MEANING.MARKET_CLOSED`.
- [ ] **Step 2–4:** run, implement, pass; also run `npx vitest run test/decisions.test.ts test/ledger-table.test.tsx` (fork rows unchanged).
- [ ] **Step 5: Commit** `feat(web): decode vault events into ledger rows and totals`.

### Task 6: Treasury reads and math

**Files:**
- Create: `web/lib/chain/treasury.ts`
- Test: `web/test/chain-treasury.test.ts`

**Interfaces:**
- Consumes: Task 2 ABIs.
- Produces:
  - `valueUsd6(raw: bigint, price8: bigint, decimals: number): bigint` = `raw * price8 / 10n ** BigInt(decimals + 2)`.
  - `weightBps(part: bigint, whole: bigint): number | null` (null when `whole <= 0n`).
  - `type Read<T> = { ok: true; value: T } | { ok: false }`
  - `type TokenHolding = { address: Address; symbol: string; decimals: Read<number>; raw: Read<bigint>; ui: Read<bigint>; supplied: Read<bigint>; price8: Read<bigint>; feedAgeSec: Read<number>; maxWeightBps: Read<number>; valueUsd6: Read<bigint>; weightBps: number | null }`
  - `type Treasury = { blockNumber: bigint; timestamp: number; owner: Address; executor: Address; paused: boolean; mandate: OnchainMandate; mandateHash: Hex; usdc: Read<bigint>; tokens: TokenHolding[]; credit: { debt: Read<bigint>; healthFactor: Read<bigint> } | null; equityUsd6: Read<bigint> }`
  - `type OnchainMandate` = the `Mandate` struct with bigint/number fields as viem decodes them.
  - `readTreasury(client: Pick<PublicClient, "multicall" | "getBlock">, vault: Address): Promise<Treasury>` — three rounds like `agent/src/chain/state.ts` `readVaultState`, with `balanceOfUI` added; `owner`, `executor`, `paused`, `mandate`, `mandateHash`, `tokens`, `usdc` must succeed (else throws `TreasuryUnavailable`); per-token and credit reads are `Read<>`; `equityUsd6` is `{ ok: false }` when any part is unreadable.
  - `formatUsd6(v: bigint): string` (`$1,234.56`), `formatHf(wad: bigint): string` (`2.13`).
  - `symbolOf(address)` from `content/generated/base-addresses.json` (NVDAC/GOOGLC/AAPLC constants), falling back to a shortened address.

- [ ] **Step 1: Failing tests** — `valueUsd6(10n**18n, 18_667_486_580n, 18) === 186_674_865n`; a parity test reads `contracts/src/MandateVault.sol`, extracts the body of `_valueUsd` and expects the expression `raw * price8 / (10 ** (dec + 2))` modulo whitespace and names; `readTreasury` with a fake `multicall` (returns `status`/`result` arrays per call list) yields holdings, weights, HF, equity; a failing feed read makes that token's `valueUsd6` and the `equityUsd6` `{ ok: false }` while other tokens still show; a failing `owner` read throws `TreasuryUnavailable`.
- [ ] **Step 2–4:** run, implement, pass. **Commit** `feat(web): read the vault's treasury with a multicall`.

### Task 7: Rationale source, verification and export

**Files:**
- Create: `web/lib/chain/rationale.ts`, `web/lib/rationales-export.ts`, `web/scripts/rationales.ts`, `web/content/generated/rationales.json` (`[]`), `web/app/data/rationales.json/route.ts`
- Modify: `web/package.json` (script `"rationales": "tsx scripts/rationales.ts"`), `web/scripts/check-out.ts` (REQUIRED `data/rationales.json`, equality)
- Test: `web/test/rationale.test.ts`

**Interfaces:**
- Produces:
  - `type RationaleEntry = { intentId: Hex; rationaleHash: Hex; text: string; txHash: Hash | null; ts: string }`
  - `interface RationaleSource { readonly name: string; lookup(ids: readonly Hex[]): Promise<Map<Hex, string>> }`
  - `staticRationaleSource(url = "/data/rationales.json", fetchImpl = fetch): RationaleSource` (keys lowercased)
  - `verifyRationale(text: string | undefined, hash: Hex): "verified" | "mismatch" | "missing"` using `keccak256(toBytes(text))`.
  - `exportRationales(rows: unknown[]): RationaleEntry[]` — keeps `kind` `intent` or `sent` rows that have a `txHash`; one entry per `intentId` (latest `ts` wins); throws `rationale hash mismatch for <intentId>` if `keccak256(toBytes(rationale)) !== rationaleHash`; sorted by `ts`.

- [ ] **Step 1: Failing tests** — `verifyRationale("Buy NVDAc: under target weight.", keccak256(toBytes("Buy NVDAc: under target weight.")))` is `verified`; `"Buy NVDAc: under target weight. "` (trailing space) against the same hash is `mismatch`; text `"Prix élevé — attendre"` verifies against its own UTF-8 hash; `undefined` is `missing`; `exportRationales` on journal lines (an `intent` with `txHash`, a `sent`, a `skip`, an `intent` without `txHash`, a duplicate `intentId`) returns two entries; a row with a wrong hash throws; `staticRationaleSource` with a fake fetch maps ids case-insensitively and returns an empty map on HTTP 404.
- [ ] **Step 2–4:** run, implement, pass. The script reads the journal path from `argv[2]`, writes the JSON with 2-space indent and a trailing newline, and prints `wrote N rationales to content/generated/rationales.json`.
- [ ] **Step 5: Commit** `feat(web): verify rationale text against the onchain hash`.

### Task 8: RPC client and the ledger hook

**Files:**
- Create: `web/lib/chain/rpc.ts`, `web/components/ledger/useLedger.ts`
- Test: `web/test/use-ledger.test.tsx`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
  - `rpcUrls(env = process.env): string[]` — `NEXT_PUBLIC_BASE_RPC_URL` (if set, trimmed, `https:` only) then the two defaults, de-duplicated.
  - `createLedgerClient(urls = rpcUrls()): PublicClient` — `createPublicClient({ chain: base, transport: fallback(urls.map((u) => http(u, { batch: { batchSize: 50 }, retryCount: 1 }))) })`.
  - `type LedgerState = { mode: "loading-config" } | { mode: "waiting" } | { mode: "error"; message: string; vault?: Address } | { mode: "mainnet"; vault: Address; treasury: Treasury | null; rows: DecisionRow[]; events: VaultEvent[]; summary: Summary; rationales: Map<Hex, string>; scan: { from: bigint; to: bigint; scannedFrom: bigint | null; failed: number; done: boolean }; updatedAt: number; rpcHost: string }`
  - `useLedger(deps?: { fetchDeployments?: () => Promise<DeploymentsFile>; client?: LedgerClient; rationaleSource?: RationaleSource; storage?: Storage | null; now?: () => number }): LedgerState & { retry: () => void }` where `LedgerClient = Pick<PublicClient, "getBlockNumber" | "getBytecode" | "readContract" | "multicall" | "getBlock" | "getLogs" | "getTransactionReceipt" | "getTransaction">`.
  - Flow: fetch deployments → `waiting` if `vault` null (no client created) → `getBytecode` + `readContract TIMELOCK == 86400n` else `error` → `readTreasury` → head = `getBlockNumber()`; floor = deploy tx receipt block, else `SCAN_FLOOR_BLOCK`; scan `(cache.to, head]` then `[floor, cache.from)` newest first via `scanLogs`; for new Decision txs batch `getBlock` (timestamps) and `getTransactionReceipt` (gas); rationale lookup; save cache up to `head - CACHE_SAFETY_BLOCKS`; refresh every 60 s while `document.visibilityState === "visible"`.

- [ ] **Step 1: Failing tests** (Testing Library `renderHook`): deployments with `vault: null` → `waiting` and the fake client's methods are never called; vault with empty bytecode → `error` naming the address; a full fake (treasury multicall, two Decision logs, block times, receipts, one rationale) → `mainnet` with two rows newest first, `scan.done`, summary counts; a cache saved under the right key afterwards; `rpcUrls({ NEXT_PUBLIC_BASE_RPC_URL: "https://x.example/rpc" })` puts it first; `rpcUrls({ NEXT_PUBLIC_BASE_RPC_URL: "http://x" })` ignores it.
- [ ] **Step 2–4:** run, implement, pass. **Commit** `feat(web): the ledger hook reads the vault from the browser`.

### Task 9: Charts

**Files:**
- Create: `web/components/charts/DecisionsPerDayChart.tsx`, `RefusalsByReasonChart.tsx`, `WeightsChart.tsx`, `HealthFactorChart.tsx`, `web/components/charts/ChartFrame.tsx` (title, empty state, hidden table)
- Test: `web/test/ledger-charts.test.tsx`

**Interfaces:**
- Consumes: `Summary["perDay"]`, `Summary["byReason"]`, `reasonDisplay`, `TokenHolding[]`, `FACTS.targetWeightPct`, `Treasury["credit"]`, `OnchainMandate`.
- Produces:
  - `DecisionsPerDayChart({ days }: { days: { day: string; allowed: number; refused: number }[] })`
  - `RefusalsByReasonChart({ reasons, selected, onSelect }: { reasons: { code: RefusalCode; count: number }[]; selected: RefusalCode | null; onSelect: (c: RefusalCode | null) => void })`
  - `WeightsChart({ holdings, targetPct }: { holdings: { symbol: string; weightBps: number | null; maxWeightBps: number | null }[]; targetPct: number })`
  - `HealthFactorChart({ hf, min, target }: { hf: number | null; min: number; target: number })`
  - Each accepts empty input and renders its empty-state sentence.

- [ ] **Step 0:** load the `dataviz` skill before writing chart code; use the site tokens (`accent` allowed, `refuse` refused, `accent-soft` bars, `line` grid) from `app/globals.css`.
- [ ] **Step 1: Failing tests** — each chart: empty input → the empty sentence and no `svg`; data → `svg[role=img]` whose `aria-label` names the totals (e.g. "Decisions per day: 3 days, 5 allowed, 2 refused"), and a hidden table with one row per datum; refusal bars are `button`s with `aria-pressed`, clicking one calls `onSelect(code)`, clicking the selected one calls `onSelect(null)`; the HF chart places the min and target marks and states "below the floor" when `hf < min`.
- [ ] **Step 2–4:** run, implement, pass. **Commit** `feat(web): ledger charts as hand-built SVG`.

### Task 10: The `/ledger` page

**Files:**
- Create: `web/app/(site)/ledger/page.tsx`, `web/components/ledger/LedgerApp.tsx` (`"use client"`), `StatusStrip.tsx`, `KpiTiles.tsx`, `TreasuryTable.tsx`, `DecisionTimeline.tsx`, `MandatePanel.tsx`, `HowWeRead.tsx`
- Modify: `web/components/sections/Nav.tsx` (prop `onLanding?: boolean`; anchors become `/#…` off the landing; "Ledger" goes to `/ledger`), `web/components/sections/Ledger.tsx` (link "Open the mainnet ledger"), `web/app/sitemap.ts` (`/ledger`), `web/scripts/check-out.ts` (REQUIRED `ledger.html`; anchors on the ledger page have targets)
- Test: `web/test/ledger-page.test.tsx`, update `web/test/page.test.tsx` / `web/test/top.test.tsx` if they assert nav hrefs

**Interfaces:**
- Consumes: `useLedger` (Task 8), charts (Task 9), `LedgerTable` + `getDecisions()` for the fork section, `mandateRows(FACTS.mandate.value)` for the waiting mandate.
- Produces: the page. `LedgerApp` takes `{ initial: "waiting" | "loading" }` from the server component (from `deploymentConfig(docsData.deployments)`) so the static HTML matches the build's data.

- [ ] **Step 1: Failing tests** — waiting state (hook mocked to `waiting`): headline, "Waiting for the mainnet deploy", no text matching `/\blive\b/i`, the configured mandate rows labeled "configured", the fork ledger present, chart empty states; mainnet state (hook mocked with fixtures from Task 5–6): status strip "Reading Base mainnet · block", vault Basescan link `https://basescan.org/address/<vault>`, timeline rows with `https://basescan.org/tx/<hash>`, a "Hash verified" and a "Hash mismatch" badge, clicking a refusal bar filters the timeline to that reason, treasury shows `balanceOfUI` quantity and "unavailable" for a failed read, mandate rows flag a difference from the default; error state shows Retry and the Basescan events link.
- [ ] **Step 2–4:** run, implement, pass. Run the full `npm test` (nav and page tests).
- [ ] **Step 5: Commit** `feat(web): the /ledger page, waiting for the mainnet deploy`.

### Task 11: E2E with a fake JSON-RPC

**Files:**
- Create: `web/e2e/fake-rpc.ts`, `web/e2e/ledger.spec.ts`
- Modify: `web/e2e/docs-a11y.spec.ts` or a new axe check inside `ledger.spec.ts`

**Interfaces:**
- Produces: `installFakeChain(page, scenario)` routing `https://base-rpc.publicnode.com/**` and `https://mainnet.base.org/**` to a handler that decodes each JSON-RPC request (single or batch) and answers `eth_chainId` (`0x2105`), `eth_blockNumber`, `eth_getCode`, `eth_call` (Multicall3 `aggregate3`, decoded with `decodeFunctionData` and answered per `(target, selector)` with `encodeFunctionResult`; also plain `TIMELOCK()`), `eth_getLogs` (scenario logs within the range), `eth_getBlockByNumber`, `eth_getTransactionReceipt`; any other host fails the test.

- [ ] **Step 1: Write** `ledger.spec.ts`:
  - waiting: for widths 360/768/1440/1920 no page overflow (`measureFit`), no console errors, no request to a host other than the test server, the waiting text visible, axe has no violations;
  - mainnet: `page.route("**/data/deployments.json")` serves a fake vault; `page.route("**/data/rationales.json")` serves one matching and one mismatching text; `installFakeChain`; assert two rows, Basescan tx links, both badges, treasury quantity, HF value, the refusal-bar filter, fit at 360 and 1440, a screenshot to `test-results/screens/ledger-*.png`.
- [ ] **Step 2: Run** `npm run build && npx playwright test e2e/ledger.spec.ts` → PASS (fix the page, not the test, on real bugs).
- [ ] **Step 3: Commit** `test(web): e2e for /ledger against a fake Base RPC`.

### Task 12: Docs

**Files:**
- Modify: `web/content/docs/get-started/status.mdx`, `README.md`, `docs/superpowers/specs/2026-11-07-maat-web-design.md` §10, `web/content/docs/guides/watch-decisions-onchain.mdx`, `web/README.md`, `deployments/README.md`

- [ ] **Step 1:** status page — the website row says the ledger page exists and reads Base from the visitor's browser once `deployments/README.md` records the vault; "Planned, not built" item 1 becomes the Supabase rationale source only, with the manifest dropped and why; keep `lastReviewed` current.
- [ ] **Step 2:** README status table — same change; the planned W2 row narrows to the Supabase rationale source and W3.
- [ ] **Step 3:** web spec §10 — a line pointing to the W2 spec and its two changes (client-side read path, no manifest).
- [ ] **Step 4:** guide — a short "On the website" paragraph linking `/ledger`; web README — `npm run rationales -- <journal.jsonl>` and the two data files; deployments README — after filling the table, `npm run docs:gen` in `web/` and commit.
- [ ] **Step 5:** `npm run docs:gen`, `npm run verify`, `npm run e2e`; fix what the docs tests flag.
- [ ] **Step 6: Commit** `docs: the mainnet ledger is built and waits for the deploy`.
