# Maat — Plan 2B: Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TypeScript agent runtime in `agent/`. Each round, the agent does the following steps:
1. Read the `MandateVault` state at a pinned block.
2. Compute the default investment policy.
3. Ask Claude (`claude-sonnet-5-5`, structured output) for `Intent[]` proposals together with a `rationale`.
4. Call `previewIntent` with `eth_call` and `from = executor`.
5. Send `execute` through the CDP Server Wallet. Every tx carries the Builder Code (ERC-8021 `dataSuffix`).
6. Write a JSONL log for Plan 3 (diary/dashboard) to read.

**Architecture:** "LLM proposes, contract decides". Claude may only propose. A deterministic chain of steps sits between Claude and the chain:
- `buildIntent` clamps the amount to the balance.
- `previewIntent` runs as the executor.
- `gate` decides whether to send, log a refusal, or skip.
- `GuardedSender` allows calls to only 3 vault functions and always attaches the Builder Code.
- The CDP policy allows only `to = vault`, `value = 0`.

The vault is still the final checkpoint. Every external dependency (RPC, Claude, CDP, receipts) goes through a narrow interface and has a fake in tests. This way the whole loop can run in unit tests without a network. One integration test runs the same loop on an anvil fork of Base with the real contracts.

**Tech Stack:**
- Node ≥ 22.9 (dev machine: 24.12), TypeScript (NodeNext, strict).
- `viem` ≥ 2.57.12, `zod` 4, `@anthropic-ai/sdk`, `@coinbase/cdp-sdk` ≥ 1.61.0, `ox` (`ox/erc8021`).
- `vitest`, `tsx`, anvil 1.9 (Foundry ≥ 1.8.4).

**Spec:** `docs/superpowers/specs/2026-11-06-mandate-treasury-design.md`: §3.5 Agent Runtime, §4 data flow, §5 error handling, §6 off-chain testing. Plan 2A (`docs/superpowers/plans/2026-11-06-maat-plan-2a-credit.md`, PR #2, branch `feat/plan-2a-credit`) provides the ABI.

**Research used for this plan:** `research/05-cdp-server-wallet.md` (CDP SDK, policy, idempotency, rate limit) and `research/06-builder-codes.md` (ERC-8021, `ox/erc8021`, test vector, code registration).

### Scope
- **In this plan:** state reading, policy, Claude proposer, intent building, preview, refusal gate, compute cost ledger and `PAY_EXPENSE` bills, CDP executor and policy, Builder Code, 15 minute/1 hour scheduler, CLI, runbook, integration test on a fork.
- **Plan 3 (later):**
  - Guard Service x402 (`/check`), MCP server, Bankr Skill.
  - End-of-day diary with `claude-opus-5-5`.
  - Dashboard Next.js.
  - Replay page.
  
  Plan 3 reads `agent/data/journal.jsonl` and the `Decision` events.

## Global Constraints

- **Every mainnet transaction is signed by the owner.** The agent (a person or a subagent executing the plan) never broadcasts to Base mainnet, never uses a private key, and never runs `cast send`, `cast wallet` or `forge script --broadcast`. The integration test sends txs only to a local anvil (`http://127.0.0.1:<port>`), using an unlocked dev account and `anvil_impersonateAccount`.
- **Only the owner runs `agent/scripts/cdp-setup.ts`.** The implementer writes and type-checks this file but **never runs it**. The implementer also does not create a CDP API key, does not call `POST https://api.base.dev/v1/agents/builder-codes`, and does not log in to dashboard.base.org or portal.cdp.coinbase.com.
- **No paid Claude API calls** in tests. Unit tests use `FixedProposer` or a fake `create`. Only the optional smoke step in Task 7 calls the real API, and only when `ANTHROPIC_API_KEY` is already present in the environment.
- **Do not commit secrets.** `agent/.env` and `agent/data/` are in `.gitignore`. An RPC URL that contains an API key must not be written to a committed file.
- Loop model: `claude-sonnet-5-5`. Call it through `client.beta.messages.create` with:
  - `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`
  - `output_config: { effort: "medium", format: { type: "json_schema", schema } }`

  Do not send `thinking`, `temperature`, `tool_choice`. Check `stop_reason` (`refusal`, `max_tokens`).
- Claude prices ($/MTok, input / output / cache read / cache write): `claude-sonnet-5-5` 2 / 10 / 0.20 / 2.50; `claude-opus-5-5` 4 / 20 / 0.20 / 5. An unknown model is priced at the opus rate.
- The Builder Code matches `^[a-z0-9_]{1,32}$`. The suffix is built with `Attribution.toDataSuffix({ codes: [code] })` from `ox/erc8021`. Test vector: `bc_a1b2c3d4` → `0x62635f61316232633364340b0080218021802180218021802180218021` (29 bytes). The hex example in the Base docs has its byte order reversed; do not use it.
- CDP: use `cdp.evm.getAccount({ name })` at run time, never `getOrCreateAccount`. Send txs with `cdp.evm.sendTransaction({ address, network: "base", transaction: { to, data, value: 0n }, idempotencyKey })`; this function returns `transactionHash` once the tx is broadcast, before it is mined. `idempotencyKey` is a UUID derived from the intent id.
- Units: USDC 6 decimals; B20 8 decimals; the Chainlink equity feed has 8 decimals and is the price of 1 raw token. Every money amount in code is a `bigint` (`usd6`), except the JSON sent to Claude (dollars as a `number`).
- The `Action` (0–6) and `Reason` (0–19) enums in `src/types.ts` must match `contracts/src/Types.sol`. A parity test reads the Solidity file directly.
- `execute()` reverts only on `NotExecutor` or `IntentAlreadyUsed`. The agent never reuses an intent id; the id is `keccak256(runId, index)`.
- "Day" is the chain's UTC day (`block.timestamp / 86400`, same as `MandateVault.today()`), not the machine clock.
- Commands run in Git Bash, from the `agent/` directory, unless noted otherwise.
- The commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

### Design decisions (so the reviewer does not have to guess)

- **Structured output instead of tool use.** Spec §3.5 says "tool use with a fixed schema". The plan uses `output_config.format` json_schema, because it is also a fixed schema but needs no tool loop. Also, a forced `tool_choice` returns 400 on `claude-sonnet-5-5`. The output is still re-checked by zod (`BatchSchema`).
- **`PAY_EXPENSE` is not in Claude's schema.** The compute bill is a deterministic number, so `runOnce` puts it at the front of the queue itself when the unpaid amount is ≥ $0.10. Claude cannot invent a payee or an amount.
- **Re-read the state after each tx.** Later proposals often depend on earlier ones (BUY → SUPPLY → BORROW). An intent built from a stale snapshot would be clamped to 0.
- **Refusals "worth logging".** These are the 11 market-safety reasons (`LOGGABLE_REASONS`, Task 5). Each reason is sent through `execute` at most once per UTC day, to produce a public `Decision(allowed=false)`. Pure bookkeeping reasons (such as `INSUFFICIENT_BALANCE`) cost no gas. A `UNKNOWN` preview (RPC error) does nothing.
- **`syncMultiplier` housekeeping.** This is a carry-over from Plan 2A. `execute` syncs only the multiplier of the token in the intent, so when the multiplier of a supplied collateral token changes, the agent calls `syncMultiplier(token)` before trading.
- **Spend cap.** The CDP policy has no per-day cap and cannot filter tuple parameters. The money limit therefore lives in the vault ($50 cap per order, $100 per day). The agent adds `MAAT_MAX_TX_PER_DAY` (default 40) to stop gas burn when an error repeats. The CDP policy only locks `to = vault`, `value = 0`, chain Base, and rejects hash signing.
- **No paymaster.** The CDP paymaster is for smart accounts only. The executor is an EOA, so the owner tops it up with a little ETH for gas.
- **ABIs generated from `contracts/out/`.** Plan 2A's note "Plan 1 doc still mentions `queueChange`" does not affect 2B, because the client ABI is generated from the Forge artifacts, not from the doc.

## Review Focus

1. **Claude proposes an amount larger than the balance, a wrong symbol, or an action that does not fit.** Expected result: clamp to the balance, or skip with a reason in the journal. Never send an intent that is certain to revert, and later proposals still run. Test: the clamp/symbol/zero cases of `buildIntent` (Task 5); `skips an invalid proposal and continues` (Task 10).
2. **RPC error in the middle of a round.** If the first read fails, do nothing (`no-state`). If the preview fails, the result is `UNKNOWN` and nothing is sent. If the re-read after a tx fails, stop the round. Test: `throws StateUnavailable …` (Task 3), `does nothing when the vault state is unavailable` and `does nothing for an intent whose preview is unknown` (Task 10).
3. **A tx was submitted but the send fails, the receipt times out, or the tx reverts.** Expected result: stop the round immediately, log `error`, still save `state.json`. The next round uses a new id, so it never sends the same intent again. Test: `halts the round when a send fails` and `halts the round on a reverted receipt` (Task 10); the idempotency key is stable per intent (Task 9).
4. **UTC day boundary.** The bill, the refusal-logging limit and the tx cap must follow the chain's day, not the clock of the machine running the agent. Test: `dailyComputeUsd6` excludes today, `hasLoggedRefusal` is per day (Task 6); `logs a market refusal onchain once per day` and `pays the compute bill first …` (Task 10, using `DAY` derived from the timestamp of the fake block).
5. **Two rounds or two processes overlap.** If that happens, the bill may be paid twice and a refusal logged twice. Expected result: rounds run sequentially within one process, and a lock file blocks a second process on the same `data/`. Test: `runs rounds back to back …` (Task 11), `acquireLock` holds/releases/takeover (Task 11).

Also, every tx must carry the Builder Code. Unit tests check `codesIn` (Task 8, 10). The fork test checks `codesIn(tx.input)` for every real tx (Task 12).

---

## File Structure

```
agent/
  package.json, tsconfig.json, vitest.config.ts, vitest.integration.config.ts, .gitignore, .env.example, README.md
  scripts/
    gen-abis.ts                 (T1)  contracts/out → src/abi/generated.ts
    smoke-claude.ts             (T7)  optional, calls the real Claude once
    cdp-setup.ts                (T9)  ONLY THE OWNER RUNS IT: creates the CDP account + policy
  src/
    abi/generated.ts, abi/index.ts   (T1)  ABI `as const`
    types.ts                    (T1)  ACTIONS, REASONS, OnchainIntent, Mandate, TokenConfig
    addresses.ts                (T2)  USDC, BASKET (NVDAc/GOOGLc/AAPLc)
    config.ts                   (T2)  env → AgentConfig (zod)
    units.ts                    (T2)  usd6 ↔ USD, token value, bps
    chain/state.ts              (T3)  readVaultState: multicall pinned to a block
    policy.ts                   (T4)  default policy → Suggestion[]
    intent.ts                   (T5)  Proposal → OnchainIntent (clamps to the balance)
    chain/preview.ts            (T5)  previewIntent via eth_call, from = executor
    refusals.ts                 (T5)  LOGGABLE_REASONS, gate()
    llm/pricing.ts              (T6)  cost per usage
    ledger/store.ts             (T6)  state.json: compute, paid, refusals, tx/day
    ledger/journal.ts           (T6)  journal.jsonl
    llm/schema.ts, llm/prompt.ts, llm/proposer.ts   (T7)  ClaudeProposer, FixedProposer
    exec/builderCode.ts         (T8)  ERC-8021 suffix
    exec/calls.ts               (T8)  encode execute / syncMultiplier
    exec/sender.ts              (T8)  TxSender, GuardedSender, RpcSender
    exec/cdpSender.ts           (T9)  CdpSender (getAccount by name)
    exec/cdpPolicy.ts           (T9)  executorPolicy(vault)
    loop/runOnce.ts             (T10) one agent round
    loop/scheduler.ts           (T11) 15 minutes / 1 hour, sequential
    loop/lock.ts                (T11) one agent per data dir
    runtime.ts                  (T11) config → RunDeps
    main.ts                     (T11) CLI --once / --dry-run
  test/
    fakes/fakeChain.ts (T3), fakes/fakeSender.ts (T8), fakes/fakeReceipts.ts (T10)
    *.test.ts                   unit, no network
    integration/                (T12) anvil fork Base: anvil.ts, deploy.ts, agent.fork.test.ts
deployments/README.md           (T11, edit) section "Switch the executor to the CDP Server Wallet"
.gitignore                      (T1, edit) agent/data/
```

Tasks are ordered by dependency: T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 → T12. Each task ends with a green `npx vitest run && npx tsc --noEmit` and one commit.

---

### Task 1: Package scaffold, generated ABIs, enum parity

**Files:**
- Create: `agent/package.json`, `agent/tsconfig.json`, `agent/vitest.config.ts`, `agent/.gitignore`
- Create: `agent/scripts/gen-abis.ts`
- Create: `agent/src/abi/generated.ts` (output of the script, committed)
- Create: `agent/src/abi/index.ts`
- Create: `agent/src/types.ts`
- Test: `agent/test/types.test.ts`, `agent/test/abi.test.ts`
- Modify: `.gitignore` (root) — add `agent/data/`

**Interfaces:**
- Consumes: Forge artifacts in `contracts/out/` (run `forge build` in `contracts/` first if `contracts/out/MandateVault.sol/MandateVault.json` is missing).
- Produces:
  - `src/abi/index.ts` exports `mandateVaultAbi`, `creditAdapterAbi`, `marketCalendarAbi`, `b20AssetAbi`, `aggregatorV3Abi`, `erc20Abi` (all `as const`).
  - `src/types.ts` exports:
    - `ACTIONS` (readonly tuple), `type ActionName`, `actionId(a: ActionName): number`
    - `REASONS` (readonly tuple), `type ReasonName`, `reasonName(n: number): ReasonName`
    - `interface OnchainIntent { id: Hex; action: number; token: Address; amount: bigint; minOut: bigint; payee: Address; rationaleHash: Hex }`
    - `interface Mandate` (field names exactly as `Types.sol`, numbers as `bigint` for uint ≥ 64 bits and `number` for smaller ones — see code)
    - `interface TokenConfig { allowed: boolean; feed: Address; pool: Address; maxWeightBps: number }`
    - `SESSION_MODES = ["REGULAR", "FEED_24_5"] as const`

- [ ] **Step 1: Create the package files**

`agent/package.json`:

```json
{
  "name": "@maat/agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.9" },
  "scripts": {
    "gen:abi": "tsx scripts/gen-abis.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:integration": "vitest run --config vitest.integration.config.ts",
    "agent": "tsx src/main.ts"
  }
}
```

`agent/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "scripts", "vitest.config.ts", "vitest.integration.config.ts"]
}
```

`agent/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
  },
});
```

`agent/.gitignore`:

```
node_modules/
data/
.env
```

Append to the root `.gitignore`:

```
agent/data/
```

Install (from `agent/`):

```bash
cd agent
npm install --save-exact viem zod @anthropic-ai/sdk
npm install --save-exact --save-dev typescript tsx vitest @types/node
```

The package uses ES modules: imports of local files end in `.js` (`import { x } from "./types.js"`), as `NodeNext` requires.

- [ ] **Step 2: Write the ABI generator**

`agent/scripts/gen-abis.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "..", "contracts", "out");
const DEST = join(here, "..", "src", "abi", "generated.ts");

const TARGETS: ReadonlyArray<readonly [string, string]> = [
  ["mandateVaultAbi", "MandateVault.sol/MandateVault.json"],
  ["creditAdapterAbi", "ICreditAdapter.sol/ICreditAdapter.json"],
  ["marketCalendarAbi", "MarketCalendar.sol/MarketCalendar.json"],
  ["b20AssetAbi", "IB20Asset.sol/IB20Asset.json"],
  ["aggregatorV3Abi", "IExternal.sol/IAggregatorV3.json"],
  ["erc20Abi", "IExternal.sol/IERC20Minimal.json"],
];

let src = "// Generated by scripts/gen-abis.ts from contracts/out. Do not edit: run `npm run gen:abi`.\n\n";
for (const [name, file] of TARGETS) {
  const abi = JSON.parse(readFileSync(join(OUT, file), "utf8")).abi;
  src += `export const ${name} = ${JSON.stringify(abi, null, 2)} as const;\n\n`;
}
mkdirSync(dirname(DEST), { recursive: true });
writeFileSync(DEST, src);
console.log(`wrote ${DEST}`);
```

Run: `npm run gen:abi`
Expected: `wrote .../agent/src/abi/generated.ts`; the file contains `export const mandateVaultAbi = [`.

`agent/src/abi/index.ts`:

```ts
export {
  mandateVaultAbi,
  creditAdapterAbi,
  marketCalendarAbi,
  b20AssetAbi,
  aggregatorV3Abi,
  erc20Abi,
} from "./generated.js";
```

- [ ] **Step 3: Write the failing tests**

`agent/test/types.test.ts` — the enum order must match `contracts/src/Types.sol` exactly, because the contract encodes `Action` and `Reason` as `uint8`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTIONS, REASONS, SESSION_MODES, actionId, reasonName } from "../src/types.js";

const typesSol = readFileSync(join(import.meta.dirname, "..", "..", "contracts", "src", "Types.sol"), "utf8");

function solEnum(name: string): string[] {
  const m = typesSol.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`));
  if (!m?.[1]) throw new Error(`enum ${name} not found`);
  return m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim().replace(/,$/, ""))
    .filter((l) => l.length > 0);
}

describe("enum parity with Types.sol", () => {
  it("Action", () => expect([...ACTIONS]).toEqual(solEnum("Action")));
  it("Reason", () => expect([...REASONS]).toEqual(solEnum("Reason")));
  it("SessionMode", () => expect([...SESSION_MODES]).toEqual(solEnum("SessionMode")));
});

describe("enum helpers", () => {
  it("maps names to ids and back", () => {
    expect(actionId("BUY")).toBe(0);
    expect(actionId("PAY_EXPENSE")).toBe(6);
    expect(reasonName(6)).toBe("MARKET_CLOSED");
    expect(reasonName(19)).toBe("DERISK_WINDOW");
  });
  it("rejects an unknown reason id", () => {
    expect(() => reasonName(20)).toThrow(/unknown reason/);
  });
});
```

`agent/test/abi.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";

const fn = (name: string) =>
  mandateVaultAbi.find((e) => e.type === "function" && e.name === name) as
    | { inputs: readonly { type: string; components?: readonly { name: string; type: string }[] }[]; outputs: readonly { type: string }[] }
    | undefined;

describe("generated MandateVault ABI", () => {
  it("execute takes the Intent tuple", () => {
    const f = fn("execute");
    expect(f?.inputs[0]?.type).toBe("tuple");
    expect(f?.inputs[0]?.components?.map((c) => `${c.name}:${c.type}`)).toEqual([
      "id:bytes32",
      "action:uint8",
      "token:address",
      "amount:uint256",
      "minOut:uint256",
      "payee:address",
      "rationaleHash:bytes32",
    ]);
    expect(f?.outputs.map((o) => o.type)).toEqual(["bool", "uint8"]);
  });
  it("previewIntent returns a Reason", () => {
    expect(fn("previewIntent")?.outputs.map((o) => o.type)).toEqual(["uint8"]);
  });
  it("has the Decision event", () => {
    expect(mandateVaultAbi.some((e) => e.type === "event" && e.name === "Decision")).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run test/types.test.ts`
Expected: FAIL with `Cannot find module '../src/types.js'` (or similar resolve error).

- [ ] **Step 5: Write `src/types.ts`**

```ts
import type { Address, Hex } from "viem";

/** Order must match contracts/src/Types.sol (test/types.test.ts enforces it). */
export const ACTIONS = ["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY", "PAY_EXPENSE"] as const;
export type ActionName = (typeof ACTIONS)[number];

export const REASONS = [
  "OK",
  "VAULT_PAUSED",
  "ACTION_NOT_SUPPORTED",
  "TOKEN_NOT_ALLOWED",
  "TOKEN_PAUSED",
  "POLICY_BLOCKED",
  "MARKET_CLOSED",
  "FEED_STALE",
  "BAD_PRICE",
  "MULTIPLIER_COOLDOWN",
  "PREMIUM_TOO_HIGH",
  "SIZE_LIMIT",
  "CONCENTRATION",
  "PAYEE_NOT_ALLOWED",
  "INSUFFICIENT_BALANCE",
  "SWAP_FAILED",
  "TRANSFER_FAILED",
  "CREDIT_FAILED",
  "HEALTH_FACTOR_LOW",
  "DERISK_WINDOW",
] as const;
export type ReasonName = (typeof REASONS)[number];

export const SESSION_MODES = ["REGULAR", "FEED_24_5"] as const;

export function actionId(a: ActionName): number {
  return ACTIONS.indexOf(a);
}

export function reasonName(n: number): ReasonName {
  const r = REASONS[n];
  if (r === undefined) throw new Error(`unknown reason id ${n}`);
  return r;
}

/** The Solidity Intent struct, ready for viem encoding. */
export interface OnchainIntent {
  id: Hex;
  action: number;
  token: Address;
  amount: bigint;
  minOut: bigint;
  payee: Address;
  rationaleHash: Hex;
}

/** Solidity Mandate. viem decodes uint<=48 as number and wider ints as bigint. */
export interface Mandate {
  sessionMode: number;
  maxPremiumBps: number;
  maxSlippageBps: number;
  maxStaleness: number;
  multiplierCooldown: number;
  twapWindow: number;
  perTradeCapUsd: bigint;
  dailyCapUsd: bigint;
  calendar: Address;
  swapAdapter: Address;
  creditAdapter: Address;
  minHealthFactor: bigint;
  targetHealthFactor: bigint;
  deriskWindow: number;
}

export interface TokenConfig {
  allowed: boolean;
  feed: Address;
  pool: Address;
  maxWeightBps: number;
}
```

- [ ] **Step 6: Run all tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 8 tests PASS; `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add .gitignore agent/package.json agent/package-lock.json agent/tsconfig.json agent/vitest.config.ts agent/.gitignore agent/scripts/gen-abis.ts agent/src/abi agent/src/types.ts agent/test/types.test.ts agent/test/abi.test.ts
git commit -m "feat(agent): scaffold TS package with generated vault ABIs and enum parity tests"
```

---

### Task 2: Addresses, config and unit math

**Files:**
- Create: `agent/src/addresses.ts`
- Create: `agent/src/config.ts`
- Create: `agent/src/units.ts`
- Create: `agent/.env.example`
- Test: `agent/test/config.test.ts`, `agent/test/units.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except `viem`.
- Produces:
  - `src/addresses.ts`: `BASE_CHAIN_ID = 8453`, `USDC: Address`, `BASKET: readonly { symbol: TokenSymbol; address: Address }[]`, `type TokenSymbol = "NVDAc" | "GOOGLc" | "AAPLc"`, `symbolOf(addr: Address): TokenSymbol | undefined`, `addressOf(sym: TokenSymbol): Address`.
  - `src/config.ts`: `type AgentConfig`, `loadConfig(env?: NodeJS.ProcessEnv): AgentConfig`.
  - `src/units.ts`: `USDC_DECIMALS = 6`, `usdToUsdc6(usd: number): bigint`, `usdc6ToUsd(v: bigint): number`, `valueUsd6(raw: bigint, price8: bigint, decimals: number): bigint`, `rawForUsd6(usd6: bigint, price8: bigint, decimals: number): bigint`, `bps(part: bigint, whole: bigint): number`, `minBig(...v: bigint[]): bigint`, `maxBig(...v: bigint[]): bigint`.

`valueUsd6` mirrors `MandateVault._valueUsd` exactly (`raw * price8 / 10^(decimals+2)`, truncating), so off-chain notional matches what the vault caps against.

- [ ] **Step 1: Write the failing tests**

`agent/test/units.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bps, maxBig, minBig, rawForUsd6, usdToUsdc6, usdc6ToUsd, valueUsd6 } from "../src/units.js";

// NVDA feed at BLOCK_SESSION (contracts/script/BaseAddresses.sol): 186.67486580, 8 decimals. B20 decimals = 8.
const NVDA_PRICE8 = 18667486580n;

describe("units", () => {
  it("converts dollars to USDC units without float drift", () => {
    expect(usdToUsdc6(20)).toBe(20_000_000n);
    expect(usdToUsdc6(0.29)).toBe(290_000n);
    expect(usdToUsdc6(1.0000004)).toBe(1_000_000n);
    expect(usdc6ToUsd(176_999_999n)).toBeCloseTo(176.999999, 6);
  });
  it("rejects negative or non-finite dollars", () => {
    expect(() => usdToUsdc6(-1)).toThrow();
    expect(() => usdToUsdc6(Number.NaN)).toThrow();
  });
  it("matches MandateVault._valueUsd", () => {
    expect(valueUsd6(100_000_000n, NVDA_PRICE8, 8)).toBe(186_674_865n); // 1 NVDAc
    expect(valueUsd6(10_704_275n, NVDA_PRICE8, 8)).toBe(19_982_190n); // fork: $20 bought this much
  });
  it("inverts valueUsd6 to at most one unit below", () => {
    const raw = rawForUsd6(20_000_000n, NVDA_PRICE8, 8);
    expect(raw).toBe(10_713_815n);
    expect(valueUsd6(raw, NVDA_PRICE8, 8)).toBe(19_999_999n);
  });
  it("computes basis points and handles a zero whole", () => {
    expect(bps(2_500n, 10_000n)).toBe(2500);
    expect(bps(1n, 0n)).toBe(0);
  });
  it("min and max over bigints", () => {
    expect(minBig(5n, 2n, 9n)).toBe(2n);
    expect(maxBig(5n, 2n, 9n)).toBe(9n);
  });
});
```

`agent/test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const base = {
  BASE_RPC_URL: "https://mainnet.base.org",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  MAAT_EXPENSE_PAYEE: "0x3333333333333333333333333333333333333333",
};

describe("loadConfig", () => {
  it("defaults to dry-run with the documented defaults", () => {
    const c = loadConfig(base);
    expect(c.mode).toBe("dry-run");
    expect(c.loopModel).toBe("claude-sonnet-5-5");
    expect(c.maxTxPerDay).toBe(40);
    expect(c.defaultDailyComputeUsd).toBe(0.5);
    expect(c.dataDir).toBe("./data");
    expect(c.vault).toBe("0x1111111111111111111111111111111111111111");
  });
  it("checksums addresses", () => {
    const c = loadConfig({ ...base, MAAT_VAULT: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" });
    expect(c.vault).toBe("0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD");
  });
  it("rejects a bad address", () => {
    expect(() => loadConfig({ ...base, MAAT_VAULT: "0x123" })).toThrow(/MAAT_VAULT/);
  });
  it("requires a Builder Code in live mode", () => {
    expect(() => loadConfig({ ...base, MAAT_MODE: "live" })).toThrow(/MAAT_BUILDER_CODE/);
    expect(loadConfig({ ...base, MAAT_MODE: "live", MAAT_BUILDER_CODE: "bc_test" }).mode).toBe("live");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/units.test.ts test/config.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`agent/src/addresses.ts`:

```ts
import { getAddress, type Address } from "viem";

/** Base mainnet, verified 2026-11-06 (contracts/script/BaseAddresses.sol). */
export const BASE_CHAIN_ID = 8453;
export const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export type TokenSymbol = "NVDAc" | "GOOGLc" | "AAPLc";

export const BASKET: readonly { symbol: TokenSymbol; address: Address }[] = [
  { symbol: "NVDAc", address: "0xb20000000000000000000078ee7ce2fE4908108C" },
  { symbol: "GOOGLc", address: "0xb2000000000000000000002D0BA3164cc74f58B7" },
  { symbol: "AAPLc", address: "0xb200000000000000000000C2e324d24d7eEcd1fb" },
];

export function symbolOf(addr: Address): TokenSymbol | undefined {
  const a = getAddress(addr);
  return BASKET.find((t) => getAddress(t.address) === a)?.symbol;
}

export function addressOf(sym: TokenSymbol): Address {
  const t = BASKET.find((b) => b.symbol === sym);
  if (!t) throw new Error(`unknown token ${sym}`);
  return getAddress(t.address);
}
```

`agent/src/units.ts`:

```ts
import { parseUnits } from "viem";

export const USDC_DECIMALS = 6;

/** Dollars (a JS number from the LLM or config) to USDC units, rounded to the nearest micro-dollar. */
export function usdToUsdc6(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`invalid dollar amount ${usd}`);
  return parseUnits(usd.toFixed(USDC_DECIMALS), USDC_DECIMALS);
}

export function usdc6ToUsd(v: bigint): number {
  return Number(v) / 10 ** USDC_DECIMALS;
}

/** Mirrors MandateVault._valueUsd: raw stock units x 8-decimal price -> USDC units, truncating. */
export function valueUsd6(raw: bigint, price8: bigint, decimals: number): bigint {
  return (raw * price8) / 10n ** BigInt(decimals + 2);
}

/** Raw stock units worth at most `usd6` at `price8`. */
export function rawForUsd6(usd6: bigint, price8: bigint, decimals: number): bigint {
  if (price8 <= 0n) return 0n;
  return (usd6 * 10n ** BigInt(decimals + 2)) / price8;
}

export function bps(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10_000n) / whole);
}

export function minBig(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b < a ? b : a));
}

export function maxBig(...v: bigint[]): bigint {
  return v.reduce((a, b) => (b > a ? b : a));
}
```

`agent/src/config.ts`:

```ts
import { getAddress, isAddress, type Address } from "viem";
import { z } from "zod";

const address = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .refine((v) => isAddress(v, { strict: false }), `${name} is not an address`)
    .transform((v) => getAddress(v) as Address);

const schema = z
  .object({
    BASE_RPC_URL: z.url(),
    MAAT_VAULT: address("MAAT_VAULT"),
    MAAT_EXECUTOR: address("MAAT_EXECUTOR"),
    MAAT_EXPENSE_PAYEE: address("MAAT_EXPENSE_PAYEE"),
    MAAT_MODE: z.enum(["dry-run", "live"]).default("dry-run"),
    MAAT_BUILDER_CODE: z.string().min(1).optional(),
    MAAT_LOOP_MODEL: z.string().default("claude-sonnet-5-5"),
    MAAT_DATA_DIR: z.string().default("./data"),
    MAAT_MAX_TX_PER_DAY: z.coerce.number().int().positive().default(40),
    MAAT_DEFAULT_DAILY_COMPUTE_USD: z.coerce.number().positive().default(0.5),
    CDP_ACCOUNT_NAME: z.string().default("maat-executor"),
  })
  .superRefine((v, ctx) => {
    if (v.MAAT_MODE === "live" && !v.MAAT_BUILDER_CODE) {
      ctx.addIssue({ code: "custom", path: ["MAAT_BUILDER_CODE"], message: "MAAT_BUILDER_CODE is required in live mode" });
    }
  });

export interface AgentConfig {
  rpcUrl: string;
  vault: Address;
  executor: Address;
  expensePayee: Address;
  mode: "dry-run" | "live";
  builderCode: string | undefined;
  loopModel: string;
  dataDir: string;
  maxTxPerDay: number;
  defaultDailyComputeUsd: number;
  cdpAccountName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const r = schema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid agent config: ${msg}`);
  }
  const v = r.data;
  return {
    rpcUrl: v.BASE_RPC_URL,
    vault: v.MAAT_VAULT,
    executor: v.MAAT_EXECUTOR,
    expensePayee: v.MAAT_EXPENSE_PAYEE,
    mode: v.MAAT_MODE,
    builderCode: v.MAAT_BUILDER_CODE,
    loopModel: v.MAAT_LOOP_MODEL,
    dataDir: v.MAAT_DATA_DIR,
    maxTxPerDay: v.MAAT_MAX_TX_PER_DAY,
    defaultDailyComputeUsd: v.MAAT_DEFAULT_DAILY_COMPUTE_USD,
    cdpAccountName: v.CDP_ACCOUNT_NAME,
  };
}
```

This uses the zod 4 API (`z.url()`, `{ error }`). If `npm ls zod` shows 3.x, install `zod@4` instead of changing the code.

`agent/.env.example`:

```
# RPC for Base mainnet (archive not required for the agent itself).
BASE_RPC_URL=https://mainnet.base.org
# From the deploy logs (deployments/README.md).
MAAT_VAULT=0x0000000000000000000000000000000000000000
# The CDP Server Wallet account address; the vault owner must setExecutor() to it.
MAAT_EXECUTOR=0x0000000000000000000000000000000000000000
MAAT_EXPENSE_PAYEE=0x0000000000000000000000000000000000000000
# dry-run (default): read, ask Claude, preview, journal; never send. live: also send through CDP.
MAAT_MODE=dry-run
# Builder Code from base.dev (required in live mode).
MAAT_BUILDER_CODE=
MAAT_LOOP_MODEL=claude-sonnet-5-5
MAAT_DATA_DIR=./data
MAAT_MAX_TX_PER_DAY=40
MAAT_DEFAULT_DAILY_COMPUTE_USD=0.5
# Anthropic API key (the SDK reads it).
ANTHROPIC_API_KEY=
# CDP Server Wallet (see agent/README.md)
CDP_ACCOUNT_NAME=maat-executor
CDP_API_KEY_ID=
CDP_API_KEY_SECRET=
CDP_WALLET_SECRET=
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS (8 from Task 1 + 10 new); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add agent/src/addresses.ts agent/src/config.ts agent/src/units.ts agent/.env.example agent/test/config.test.ts agent/test/units.test.ts
git commit -m "feat(agent): config loader, Base addresses and vault-exact unit math"
```

---

### Task 3: Vault state reader

**Files:**
- Create: `agent/src/chain/state.ts`
- Test: `agent/test/state.test.ts`
- Create: `agent/test/fakes/fakeChain.ts` (a fake `StateClient` reused by Tasks 5 and 10)

**Interfaces:**
- Consumes: `mandateVaultAbi`, `creditAdapterAbi`, `marketCalendarAbi`, `b20AssetAbi`, `aggregatorV3Abi`, `erc20Abi` (Task 1); `Mandate`, `TokenConfig` (Task 1); `valueUsd6`, `minBig` (Task 2); `symbolOf`, `TokenSymbol` (Task 2).
- Produces:
  - `type StateClient = Pick<PublicClient, "getBlock" | "multicall">`
  - `class StateUnavailable extends Error`
  - `interface TokenState { address: Address; symbol: TokenSymbol | undefined; decimals: number; config: TokenConfig; balance: bigint; supplied: bigint; price8: bigint | null; feedAge: bigint | null; uiMultiplier: bigint | null; lastMultiplier: bigint; valueUsd6: bigint }`
  - `interface CreditState { readable: boolean; debt: bigint; healthFactor: bigint }`
  - `interface VaultState { blockNumber: bigint; timestamp: bigint; day: bigint; vault: Address; usdc: Address; executor: Address; paused: boolean; usdcBalance: bigint; recordedUsdc: bigint; newRevenue: bigint; spentToday: bigint; mandate: Mandate; marketOpen: boolean | null; tokens: TokenState[]; credit: CreditState | null; equityUsd6: bigint }`
  - `readVaultState(client: StateClient, vault: Address): Promise<VaultState>` — throws `StateUnavailable` when any vault-level read fails.

All reads pin one `blockNumber` so the snapshot is consistent. `valueUsd6` of a token values `balance + supplied` at `price8` (0 when the price is unreadable, as the vault does). `equityUsd6 = usdcBalance + Σ valueUsd6 − debt` (floored at 0). `newRevenue = max(0, usdcBalance − recordedUsdc)`: what `notifyRevenue()` would emit now. `day = timestamp / 86400` (same as `MandateVault.today()`).

Failure semantics (spec §5: RPC down → do nothing):
- Any vault-level read failing (`executor`, `paused`, `mandate`, `tokens`, `recordedUsdc`, `usdc`, USDC `balanceOf`, `spentOnDay`) → throw `StateUnavailable`.
- A token-level read failing → that field becomes `null` (price, age, multiplier) or `0n` (balance, supplied), and the vault's own checks will refuse anything unsafe.
- Credit views failing → `credit = { readable: false, debt: 0n, healthFactor: 0n }`. `credit` is `null` only when `mandate.creditAdapter` is the zero address.
- `calendar.isOpen` failing → `marketOpen = null` (the scheduler treats `null` as closed).

- [ ] **Step 1: Write the fake chain**

`agent/test/fakes/fakeChain.ts` — answers `multicall` by `address:functionName`. Unknown keys fail the call (exactly how a missing contract looks through `allowFailure: true`):

```ts
import { getAddress, type Address } from "viem";
import type { StateClient } from "../../src/chain/state.js";

type Answer = unknown | ((args: readonly unknown[]) => unknown);

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
```

Add a standard vault scene builder in the same file, used by this task's tests and by Tasks 5 and 10:

```ts
import { USDC, BASKET } from "../../src/addresses.js";

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
```

Note: viem returns a struct output as an object and a multi-output function as an array; the fake returns `tokenConfig` as an array because the public getter `tokenConfig(address)` has four outputs (`allowed, feed, pool, maxWeightBps`), and `mandate()` as an object because it returns one struct. `state.ts` must handle exactly these shapes.

- [ ] **Step 2: Write the failing tests**

`agent/test/state.test.ts`:

```ts
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

  it("treats an unreadable calendar as unknown", async () => {
    const s = await readVaultState(standardScene().fail(CALENDAR, "isOpen").client(), VAULT);
    expect(s.marketOpen).toBeNull();
  });

  it("throws StateUnavailable when a vault-level read fails", async () => {
    await expect(readVaultState(standardScene().fail(VAULT, "mandate").client(), VAULT)).rejects.toBeInstanceOf(StateUnavailable);
    await expect(readVaultState(standardScene().fail(USDC, "balanceOf").client(), VAULT)).rejects.toBeInstanceOf(StateUnavailable);
  });

  it("throws StateUnavailable when getBlock fails", async () => {
    const client = standardScene().client();
    client.getBlock = (async () => {
      throw new Error("rpc down");
    }) as typeof client.getBlock;
    await expect(readVaultState(client, VAULT)).rejects.toBeInstanceOf(StateUnavailable);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/state.test.ts`
Expected: FAIL, `src/chain/state.js` not found.

- [ ] **Step 4: Implement `src/chain/state.ts`**

```ts
import { zeroAddress, type Address, type PublicClient } from "viem";
import { aggregatorV3Abi, b20AssetAbi, creditAdapterAbi, erc20Abi, mandateVaultAbi, marketCalendarAbi } from "../abi/index.js";
import { symbolOf, type TokenSymbol } from "../addresses.js";
import type { Mandate, TokenConfig } from "../types.js";
import { valueUsd6 } from "../units.js";

export type StateClient = Pick<PublicClient, "getBlock" | "multicall">;

export class StateUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StateUnavailable";
  }
}

export interface TokenState {
  address: Address;
  symbol: TokenSymbol | undefined;
  decimals: number;
  config: TokenConfig;
  balance: bigint;
  supplied: bigint;
  price8: bigint | null;
  feedAge: bigint | null;
  uiMultiplier: bigint | null;
  lastMultiplier: bigint;
  valueUsd6: bigint;
}

export interface CreditState {
  readable: boolean;
  debt: bigint;
  healthFactor: bigint;
}

export interface VaultState {
  blockNumber: bigint;
  timestamp: bigint;
  day: bigint;
  vault: Address;
  usdc: Address;
  executor: Address;
  paused: boolean;
  usdcBalance: bigint;
  recordedUsdc: bigint;
  newRevenue: bigint;
  spentToday: bigint;
  mandate: Mandate;
  marketOpen: boolean | null;
  tokens: TokenState[];
  credit: CreditState | null;
  equityUsd6: bigint;
}

type Result = { status: "success"; result: unknown } | { status: "failure"; error: unknown };

function must<T>(r: Result | undefined, what: string): T {
  if (!r || r.status !== "success") throw new StateUnavailable(`vault read failed: ${what}`, { cause: r && "error" in r ? r.error : undefined });
  return r.result as T;
}

function opt<T>(r: Result | undefined): T | null {
  return r && r.status === "success" ? (r.result as T) : null;
}

export async function readVaultState(client: StateClient, vault: Address): Promise<VaultState> {
  let block: { number: bigint | null; timestamp: bigint };
  try {
    block = await client.getBlock({ blockTag: "latest" });
  } catch (e) {
    throw new StateUnavailable("getBlock failed", { cause: e });
  }
  if (block.number === null) throw new StateUnavailable("latest block has no number");
  const blockNumber = block.number;
  const timestamp = block.timestamp;
  const day = timestamp / 86_400n;
  const call = (contracts: readonly unknown[]) =>
    client.multicall({ contracts: contracts as never, allowFailure: true, blockNumber }) as Promise<Result[]>;

  let r1: Result[];
  try {
    r1 = await call([
      { address: vault, abi: mandateVaultAbi, functionName: "executor" },
      { address: vault, abi: mandateVaultAbi, functionName: "paused" },
      { address: vault, abi: mandateVaultAbi, functionName: "mandate" },
      { address: vault, abi: mandateVaultAbi, functionName: "tokens" },
      { address: vault, abi: mandateVaultAbi, functionName: "usdc" },
      { address: vault, abi: mandateVaultAbi, functionName: "recordedUsdc" },
      { address: vault, abi: mandateVaultAbi, functionName: "spentOnDay", args: [day] },
    ]);
  } catch (e) {
    throw new StateUnavailable("multicall failed", { cause: e });
  }
  const executor = must<Address>(r1[0], "executor");
  const paused = must<boolean>(r1[1], "paused");
  const mandate = must<Mandate>(r1[2], "mandate");
  const tokenList = must<readonly Address[]>(r1[3], "tokens");
  const usdc = must<Address>(r1[4], "usdc");
  const recordedUsdc = must<bigint>(r1[5], "recordedUsdc");
  const spentToday = must<bigint>(r1[6], "spentOnDay");
  const hasCredit = mandate.creditAdapter !== zeroAddress;

  const PER_TOKEN = 5;
  const perToken = tokenList.flatMap((t) => [
    { address: vault, abi: mandateVaultAbi, functionName: "tokenConfig", args: [t] },
    { address: vault, abi: mandateVaultAbi, functionName: "lastMultiplier", args: [t] },
    { address: t, abi: b20AssetAbi, functionName: "balanceOf", args: [vault] },
    { address: t, abi: b20AssetAbi, functionName: "decimals" },
    { address: t, abi: b20AssetAbi, functionName: "uiMultiplier" },
  ]);
  const tail = [
    { address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] },
    { address: mandate.calendar, abi: marketCalendarAbi, functionName: "isOpen", args: [timestamp, mandate.sessionMode] },
    ...(hasCredit
      ? [
          { address: mandate.creditAdapter, abi: creditAdapterAbi, functionName: "debt" },
          { address: mandate.creditAdapter, abi: creditAdapterAbi, functionName: "healthFactor" },
          ...tokenList.map((t) => ({ address: mandate.creditAdapter, abi: creditAdapterAbi, functionName: "suppliedOf", args: [t] })),
        ]
      : []),
  ];
  let r2: Result[];
  try {
    r2 = await call([...perToken, ...tail]);
  } catch (e) {
    throw new StateUnavailable("multicall failed", { cause: e });
  }
  const at = (i: number) => r2[i];
  const base = tokenList.length * PER_TOKEN;
  const usdcBalance = must<bigint>(at(base), "usdc.balanceOf(vault)");
  const marketOpen = opt<boolean>(at(base + 1));

  let credit: CreditState | null = null;
  const supplied: bigint[] = tokenList.map(() => 0n);
  if (hasCredit) {
    const debt = opt<bigint>(at(base + 2));
    const hf = opt<bigint>(at(base + 3));
    const sup = tokenList.map((_, i) => opt<bigint>(at(base + 4 + i)));
    const readable = debt !== null && hf !== null && sup.every((s) => s !== null);
    credit = { readable, debt: debt ?? 0n, healthFactor: hf ?? 0n };
    sup.forEach((s, i) => (supplied[i] = s ?? 0n));
  }

  // Feeds come from tokenConfig, so they need a third round.
  const configs = tokenList.map((t, i) => {
    const c = opt<readonly [boolean, Address, Address, number]>(at(i * PER_TOKEN));
    return c ? { allowed: c[0], feed: c[1], pool: c[2], maxWeightBps: c[3] } : { allowed: false, feed: zeroAddress, pool: zeroAddress, maxWeightBps: 0 };
  });
  let r3: Result[];
  try {
    r3 = await call(configs.map((c) => ({ address: c.feed, abi: aggregatorV3Abi, functionName: "latestRoundData" })));
  } catch (e) {
    throw new StateUnavailable("multicall failed", { cause: e });
  }

  const tokens: TokenState[] = tokenList.map((address, i) => {
    const o = i * PER_TOKEN;
    const decimals = Number(opt<number>(at(o + 3)) ?? 0);
    const balance = opt<bigint>(at(o + 2)) ?? 0n;
    const round = configs[i]!.feed === zeroAddress ? null : opt<readonly [bigint, bigint, bigint, bigint, bigint]>(r3[i]);
    // Same validity rule as PriceLib.readFeed: positive answer, updatedAt in (0, now].
    const good = round !== null && round[1] > 0n && round[3] > 0n && round[3] <= timestamp;
    const price8 = good ? round[1] : null;
    const feedAge = good ? timestamp - round[3] : null;
    return {
      address,
      symbol: symbolOf(address),
      decimals,
      config: configs[i]!,
      balance,
      supplied: supplied[i]!,
      price8,
      feedAge,
      uiMultiplier: opt<bigint>(at(o + 4)),
      lastMultiplier: opt<bigint>(at(o + 1)) ?? 0n,
      valueUsd6: price8 === null || decimals === 0 ? 0n : valueUsd6(balance + supplied[i]!, price8, decimals),
    };
  });

  const gross = usdcBalance + tokens.reduce((s, t) => s + t.valueUsd6, 0n);
  const debt = credit?.debt ?? 0n;
  return {
    blockNumber,
    timestamp,
    day,
    vault,
    usdc,
    executor,
    paused,
    usdcBalance,
    recordedUsdc,
    newRevenue: usdcBalance > recordedUsdc ? usdcBalance - recordedUsdc : 0n,
    spentToday,
    mandate,
    marketOpen,
    tokens,
    credit,
    equityUsd6: gross > debt ? gross - debt : 0n,
  };
}
```

`decimals === 0` is treated as unreadable for valuation because B20 tokens have 8 decimals and USDC 6; a zero comes only from a failed read.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (10 new in `state.test.ts`); `tsc` clean. If `tsc` rejects the fake's `multicall` signature, keep the `as unknown as StateClient` cast in the fake (test-only) rather than loosening `StateClient`.

- [ ] **Step 6: Commit**

```bash
git add agent/src/chain/state.ts agent/test/state.test.ts agent/test/fakes/fakeChain.ts
git commit -m "feat(agent): block-pinned vault state reader with fail-closed semantics"
```

---

### Task 4: Investment policy (pure)

**Files:**
- Create: `agent/src/policy.ts`
- Test: `agent/test/policy.test.ts`

**Interfaces:**
- Consumes: `VaultState`, `TokenState` (Task 3); `TokenSymbol` (Task 2); `ActionName` (Task 1); `bps`, `minBig`, `maxBig`, `rawForUsd6`, `valueUsd6` (Task 2).
- Produces:
  - `interface PolicyParams { cashReserveBps: number; driftBps: number; runwayDays: number; minTradeUsd6: bigint }`
  - `const DEFAULT_POLICY: PolicyParams` = `{ cashReserveBps: 3000, driftBps: 500, runwayDays: 7, minTradeUsd6: 1_000_000n }`
  - `interface Suggestion { action: ActionName; symbol: TokenSymbol | "USDC"; amountUsd6: bigint; why: string }`
  - `interface WeightRow { symbol: TokenSymbol; weightBps: number; targetBps: number; driftBps: number; walletUsd6: bigint; suppliedUsd6: bigint }`
  - `interface PolicyView { equityUsd6: bigint; cashBps: number; targetCashBps: number; runwayNeedUsd6: bigint; spendableUsd6: bigint; weights: WeightRow[]; suggestions: Suggestion[] }`
  - `evaluatePolicy(state: VaultState, bills: { dailyComputeUsd6: bigint; unpaidUsd6: bigint }, params?: PolicyParams): PolicyView`

The policy is spec §3.5 written as code. It only *suggests*; Claude decides and the vault has the final word. Rules, in this order (the order of `suggestions` is the order the agent should execute them):

1. Targets: cash `cashReserveBps` (30%); each basket token `(10000 − cashReserveBps) / n` bps (2333). Weights are measured against `equityUsd6` (net of debt, matching the vault's concentration rule). `walletUsd6` and `suppliedUsd6` split each token's value.
2. `runwayNeedUsd6 = runwayDays × dailyComputeUsd6`. `spendableUsd6 = max(0, usdcBalance − unpaidUsd6 − runwayNeedUsd6)`.
3. **REPAY** when `credit.readable`, `debt > 0`, `newRevenue > 0`: amount `min(debt, spendableUsd6)`; skip below `minTradeUsd6`. Reduces `spendableUsd6` for later rules.
4. **SUPPLY** for each token with credit enabled, readable credit and `walletUsd6 ≥ minTradeUsd6` while `weightBps ≤ targetBps + driftBps`: amount = `walletUsd6` (stocks work as collateral; spec §1 flow buy → supply → borrow).
5. **Rebalance down**: token with `weightBps > targetBps + driftBps`: excess `= (weightBps − targetBps) × equity / 10000`, capped by `perTradeCapUsd`. If `walletUsd6 ≥ excess` → **SELL** excess. Otherwise if credit is readable and `suppliedUsd6 > 0` → **WITHDRAW_COLLATERAL** `min(excess − walletUsd6, suppliedUsd6)` (the SELL follows on a later loop). Skip below `minTradeUsd6`.
6. **Rebalance up**: token with `weightBps < targetBps − driftBps` and a readable price: deficit `= (targetBps − weightBps) × equity / 10000`, amount `min(deficit, perTradeCapUsd, spendableUsd6)`, deducted from `spendableUsd6` before the next token. Tokens in basket order. Skip below `minTradeUsd6`.
7. **BORROW** when credit is readable, some collateral is supplied (`Σ suppliedUsd6 > 0`), and `usdcBalance < runwayNeedUsd6 + unpaidUsd6`: amount `runwayNeedUsd6 + unpaidUsd6 − usdcBalance`; skip below `minTradeUsd6`. The vault requires HF after the borrow ≥ `minHealthFactor` (≥ `targetHealthFactor` in the derisk window), so the policy does not estimate HF.

No suggestions at all when `state.paused`, except REPAY (the vault lets REPAY through a pause).

`why` strings are short English facts (they go into Claude's prompt), e.g. `"NVDAc 8.0% vs target 23.3% (drift -15.3pp)"`.

- [ ] **Step 1: Write the failing tests**

`agent/test/policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { USDC } from "../src/addresses.js";
import type { TokenState, VaultState } from "../src/chain/state.js";
import { DEFAULT_POLICY, evaluatePolicy } from "../src/policy.js";
import { MANDATE } from "./fakes/fakeChain.js";

const P = [18667486580n, 28000000000n, 27000000000n];
const SYMS = ["NVDAc", "GOOGLc", "AAPLc"] as const;

function tok(i: number, walletUsd6: bigint, suppliedUsd6 = 0n): TokenState {
  // pick raw so valueUsd6 is exact enough; the policy only reads the usd fields
  return {
    address: `0xb2${String(i).padStart(38, "0")}` as `0x${string}`,
    symbol: SYMS[i],
    decimals: 8,
    config: { allowed: true, feed: "0x0000000000000000000000000000000000000001", pool: "0x0000000000000000000000000000000000000002", maxWeightBps: 4000 },
    balance: (walletUsd6 * 10n ** 10n) / P[i]!,
    supplied: (suppliedUsd6 * 10n ** 10n) / P[i]!,
    price8: P[i]!,
    feedAge: 30n,
    uiMultiplier: 10n ** 18n,
    lastMultiplier: 10n ** 18n,
    valueUsd6: walletUsd6 + suppliedUsd6,
  };
}

function state(over: Partial<VaultState> & { tokens?: TokenState[] }): VaultState {
  const tokens = over.tokens ?? [tok(0, 0n), tok(1, 0n), tok(2, 0n)];
  const usdcBalance = over.usdcBalance ?? 100_000_000n;
  const debt = over.credit?.debt ?? 0n;
  return {
    blockNumber: 1n,
    timestamp: 1_794_000_000n,
    day: 20_763n,
    vault: "0x1111111111111111111111111111111111111111",
    usdc: USDC,
    executor: "0x2222222222222222222222222222222222222222",
    paused: false,
    usdcBalance,
    recordedUsdc: usdcBalance,
    newRevenue: 0n,
    spentToday: 0n,
    mandate: MANDATE,
    marketOpen: true,
    credit: { readable: true, debt: 0n, healthFactor: 2n ** 256n - 1n },
    ...over,
    tokens,
    equityUsd6: over.equityUsd6 ?? usdcBalance + tokens.reduce((s, t) => s + t.valueUsd6, 0n) - debt,
  };
}

const noBills = { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }; // $0.50/day -> $3.50 runway

describe("evaluatePolicy", () => {
  it("all cash: buys each token toward 23.33%, capped by spendable cash", () => {
    const v = evaluatePolicy(state({}), noBills);
    expect(v.targetCashBps).toBe(3000);
    expect(v.weights.map((w) => w.targetBps)).toEqual([2333, 2333, 2333]);
    expect(v.runwayNeedUsd6).toBe(3_500_000n);
    const buys = v.suggestions.filter((s) => s.action === "BUY");
    expect(buys.map((b) => b.symbol)).toEqual(["NVDAc", "GOOGLc", "AAPLc"]);
    expect(buys.map((b) => b.amountUsd6)).toEqual([23_330_000n, 23_330_000n, 23_330_000n]);
    expect(v.suggestions.some((s) => s.action === "BORROW")).toBe(false);
  });

  it("caps a buy at perTradeCapUsd", () => {
    const v = evaluatePolicy(state({ usdcBalance: 1_000_000_000n }), noBills);
    expect(v.suggestions.find((s) => s.action === "BUY")?.amountUsd6).toBe(50_000_000n);
  });

  it("stops buying when spendable cash runs out", () => {
    const v = evaluatePolicy(state({ usdcBalance: 30_000_000n }), noBills);
    // spendable = 30 - 3.5 = 26.5; NVDAc deficit 7.0 (23.33% of 30), GOOGLc 7.0, AAPLc 7.0 -> all fit
    // with $10: spendable 6.5 -> NVDAc gets 2.333 (deficit), ... check the total never exceeds spendable
    const small = evaluatePolicy(state({ usdcBalance: 10_000_000n }), noBills);
    const total = small.suggestions.filter((s) => s.action === "BUY").reduce((a, s) => a + s.amountUsd6, 0n);
    expect(total).toBeLessThanOrEqual(small.spendableUsd6);
    expect(v.spendableUsd6).toBe(26_500_000n);
  });

  it("supplies wallet stock as collateral when not overweight", () => {
    const v = evaluatePolicy(state({ tokens: [tok(0, 20_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 80_000_000n }), noBills);
    expect(v.suggestions.find((s) => s.action === "SUPPLY")).toMatchObject({ symbol: "NVDAc", amountUsd6: 20_000_000n });
  });

  it("does not suggest credit actions when the adapter is unreadable", () => {
    const v = evaluatePolicy(
      state({ tokens: [tok(0, 20_000_000n), tok(1, 0n), tok(2, 0n)], credit: { readable: false, debt: 0n, healthFactor: 0n } }),
      noBills,
    );
    expect(v.suggestions.some((s) => ["SUPPLY", "BORROW", "REPAY", "WITHDRAW_COLLATERAL"].includes(s.action))).toBe(false);
  });

  it("sells an overweight wallet holding", () => {
    // NVDAc $60 of $100 equity = 60% vs 23.33% -> excess 36.67, capped at 50 -> 36.67
    const v = evaluatePolicy(state({ tokens: [tok(0, 60_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 40_000_000n }), noBills);
    expect(v.suggestions.find((s) => s.action === "SELL")).toMatchObject({ symbol: "NVDAc", amountUsd6: 36_670_000n });
    expect(v.suggestions.some((s) => s.action === "SUPPLY" && s.symbol === "NVDAc")).toBe(false);
  });

  it("withdraws collateral first when the overweight holding is supplied", () => {
    const v = evaluatePolicy(state({ tokens: [tok(0, 0n, 60_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 40_000_000n }), noBills);
    expect(v.suggestions.find((s) => s.action === "WITHDRAW_COLLATERAL")).toMatchObject({ symbol: "NVDAc", amountUsd6: 36_670_000n });
    expect(v.suggestions.some((s) => s.action === "SELL")).toBe(false);
  });

  it("borrows to cover the 7-day runway when collateral exists", () => {
    const v = evaluatePolicy(
      state({ tokens: [tok(0, 0n, 20_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 1_000_000n }),
      { dailyComputeUsd6: 500_000n, unpaidUsd6: 200_000n },
    );
    // need 3.5 + 0.2 - 1.0 = 2.7
    expect(v.suggestions.find((s) => s.action === "BORROW")).toMatchObject({ symbol: "USDC", amountUsd6: 2_700_000n });
  });

  it("does not borrow without supplied collateral", () => {
    const v = evaluatePolicy(state({ usdcBalance: 1_000_000n }), noBills);
    expect(v.suggestions.some((s) => s.action === "BORROW")).toBe(false);
  });

  it("repays from new revenue but keeps the runway", () => {
    const v = evaluatePolicy(
      state({ usdcBalance: 13_500_000n, newRevenue: 10_000_000n, credit: { readable: true, debt: 5_000_001n, healthFactor: 3n * 10n ** 18n }, tokens: [tok(0, 0n, 20_000_000n), tok(1, 0n), tok(2, 0n)] }),
      noBills,
    );
    // spendable = 13.5 - 3.5 = 10 -> repay min(5.000001, 10)
    expect(v.suggestions[0]).toMatchObject({ action: "REPAY", symbol: "USDC", amountUsd6: 5_000_001n });
  });

  it("only suggests REPAY while the vault is paused", () => {
    const v = evaluatePolicy(
      state({ paused: true, usdcBalance: 50_000_000n, newRevenue: 10_000_000n, credit: { readable: true, debt: 5_000_000n, healthFactor: 3n * 10n ** 18n } }),
      noBills,
    );
    expect(v.suggestions.map((s) => s.action)).toEqual(["REPAY"]);
  });

  it("skips tokens without a readable price", () => {
    const t = tok(1, 0n);
    t.price8 = null;
    const v = evaluatePolicy(state({ tokens: [tok(0, 0n), t, tok(2, 0n)] }), noBills);
    expect(v.suggestions.some((s) => s.symbol === "GOOGLc")).toBe(false);
  });

  it("ignores dust below minTradeUsd6", () => {
    const v = evaluatePolicy(state({ usdcBalance: 4_000_000n }), noBills); // spendable 0.5 -> no buys
    expect(v.suggestions.filter((s) => s.action === "BUY")).toEqual([]);
    expect(DEFAULT_POLICY.minTradeUsd6).toBe(1_000_000n);
  });

  it("orders suggestions REPAY, SUPPLY, WITHDRAW/SELL, BUY, BORROW", () => {
    const order = ["REPAY", "SUPPLY", "WITHDRAW_COLLATERAL", "SELL", "BUY", "BORROW"];
    const v = evaluatePolicy(state({ tokens: [tok(0, 10_000_000n), tok(1, 0n), tok(2, 0n)], usdcBalance: 90_000_000n }), noBills);
    const idx = v.suggestions.map((s) => order.indexOf(s.action));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/policy.test.ts`
Expected: FAIL, `src/policy.js` not found.

- [ ] **Step 3: Implement `src/policy.ts`**

```ts
import type { TokenSymbol } from "./addresses.js";
import type { VaultState } from "./chain/state.js";
import type { ActionName } from "./types.js";
import { bps, maxBig, minBig } from "./units.js";

export interface PolicyParams {
  cashReserveBps: number;
  driftBps: number;
  runwayDays: number;
  minTradeUsd6: bigint;
}

export const DEFAULT_POLICY: PolicyParams = { cashReserveBps: 3000, driftBps: 500, runwayDays: 7, minTradeUsd6: 1_000_000n };

export interface Suggestion {
  action: ActionName;
  symbol: TokenSymbol | "USDC";
  amountUsd6: bigint;
  why: string;
}

export interface WeightRow {
  symbol: TokenSymbol;
  weightBps: number;
  targetBps: number;
  driftBps: number;
  walletUsd6: bigint;
  suppliedUsd6: bigint;
}

export interface PolicyView {
  equityUsd6: bigint;
  cashBps: number;
  targetCashBps: number;
  runwayNeedUsd6: bigint;
  spendableUsd6: bigint;
  weights: WeightRow[];
  suggestions: Suggestion[];
}

const pct = (b: number) => `${(b / 100).toFixed(1)}%`;
const usd = (v: bigint) => `$${(Number(v) / 1e6).toFixed(2)}`;

export function evaluatePolicy(
  s: VaultState,
  bills: { dailyComputeUsd6: bigint; unpaidUsd6: bigint },
  params: PolicyParams = DEFAULT_POLICY,
): PolicyView {
  const equity = s.equityUsd6;
  const priced = s.tokens.filter((t): t is typeof t & { symbol: TokenSymbol } => t.symbol !== undefined);
  const targetBps = priced.length === 0 ? 0 : Math.floor((10_000 - params.cashReserveBps) / priced.length);
  const credit = s.credit !== null && s.credit.readable;

  const weights: WeightRow[] = priced.map((t) => {
    // Split the token's value between wallet and supplied collateral by raw units.
    const total = t.balance + t.supplied;
    const walletUsd6 = total === 0n ? 0n : (t.valueUsd6 * t.balance) / total;
    const suppliedUsd6 = t.valueUsd6 - walletUsd6;
    const weightBps = bps(t.valueUsd6, equity);
    return { symbol: t.symbol, weightBps, targetBps, driftBps: weightBps - targetBps, walletUsd6, suppliedUsd6 };
  });

  const runwayNeedUsd6 = BigInt(params.runwayDays) * bills.dailyComputeUsd6;
  let spendable = maxBig(0n, s.usdcBalance - bills.unpaidUsd6 - runwayNeedUsd6);
  const spendableUsd6 = spendable;
  const out: Suggestion[] = [];
  const big = (v: bigint) => v >= params.minTradeUsd6;
  const cap = s.mandate.perTradeCapUsd;
  const ofEquity = (b: number) => (BigInt(b) * equity) / 10_000n;

  // 3. REPAY
  if (credit && s.credit!.debt > 0n && s.newRevenue > 0n) {
    const amt = minBig(s.credit!.debt, spendable);
    if (big(amt)) {
      out.push({ action: "REPAY", symbol: "USDC", amountUsd6: amt, why: `new revenue ${usd(s.newRevenue)}, debt ${usd(s.credit!.debt)}` });
      spendable -= amt;
    }
  }
  if (s.paused) return view();

  // 4. SUPPLY
  if (credit) {
    for (const w of weights) {
      if (big(w.walletUsd6) && w.weightBps <= w.targetBps + params.driftBps) {
        out.push({ action: "SUPPLY", symbol: w.symbol, amountUsd6: w.walletUsd6, why: `${usd(w.walletUsd6)} of ${w.symbol} idle in the vault; use it as collateral` });
      }
    }
  }

  // 5. Rebalance down
  for (const w of weights) {
    if (w.weightBps <= w.targetBps + params.driftBps) continue;
    const excess = minBig(ofEquity(w.weightBps - w.targetBps), cap);
    const why = `${w.symbol} ${pct(w.weightBps)} vs target ${pct(w.targetBps)} (drift +${(w.driftBps / 100).toFixed(1)}pp)`;
    if (w.walletUsd6 >= excess) {
      if (big(excess)) out.push({ action: "SELL", symbol: w.symbol, amountUsd6: excess, why });
    } else if (credit && w.suppliedUsd6 > 0n) {
      const amt = minBig(excess - w.walletUsd6, w.suppliedUsd6);
      if (big(amt)) out.push({ action: "WITHDRAW_COLLATERAL", symbol: w.symbol, amountUsd6: amt, why: `${why}; withdraw before selling` });
    }
  }

  // 6. Rebalance up
  for (const w of weights) {
    const t = priced.find((p) => p.symbol === w.symbol)!;
    if (t.price8 === null || w.weightBps >= w.targetBps - params.driftBps) continue;
    const amt = minBig(ofEquity(w.targetBps - w.weightBps), cap, spendable);
    if (!big(amt)) continue;
    out.push({ action: "BUY", symbol: w.symbol, amountUsd6: amt, why: `${w.symbol} ${pct(w.weightBps)} vs target ${pct(w.targetBps)} (drift ${(w.driftBps / 100).toFixed(1)}pp)` });
    spendable -= amt;
  }

  // 7. BORROW
  const supplied = weights.reduce((a, w) => a + w.suppliedUsd6, 0n);
  const need = runwayNeedUsd6 + bills.unpaidUsd6;
  if (credit && supplied > 0n && s.usdcBalance < need) {
    const amt = need - s.usdcBalance;
    if (big(amt)) out.push({ action: "BORROW", symbol: "USDC", amountUsd6: amt, why: `USDC ${usd(s.usdcBalance)} below ${params.runwayDays}-day compute runway + bills ${usd(need)}` });
  }
  return view();

  function view(): PolicyView {
    return {
      equityUsd6: equity,
      cashBps: bps(s.usdcBalance, equity),
      targetCashBps: params.cashReserveBps,
      runwayNeedUsd6,
      spendableUsd6,
      weights,
      suggestions: out,
    };
  }
}
```

Check against the tests by hand before running: in "all cash", equity $100, target 2333 bps → `ofEquity(2333) = 23_330_000`, spendable $96.50, so three buys of $23.33 fit. In "sells an overweight wallet holding", weight 6000 → excess `ofEquity(3667) = 36_670_000`.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (14 new); `tsc` clean. If a numeric expectation is off by rounding, fix the code to the rule above, not the test, unless the rule itself says otherwise.

- [ ] **Step 5: Commit**

```bash
git add agent/src/policy.ts agent/test/policy.test.ts
git commit -m "feat(agent): deterministic investment policy that suggests, never sends"
```

---
### Task 5: Intent builder, preview from the executor, refusal gate

**Files:**
- Create: `agent/src/intent.ts`
- Create: `agent/src/chain/preview.ts`
- Create: `agent/src/refusals.ts`
- Test: `agent/test/intent.test.ts`, `agent/test/preview.test.ts`, `agent/test/refusals.test.ts`

**Interfaces:**
- Consumes: `OnchainIntent`, `ActionName`, `ReasonName`, `actionId`, `reasonName` (Task 1); `TokenSymbol`, `addressOf`, `USDC` (Task 2); `usdToUsdc6`, `rawForUsd6`, `minBig` (Task 2); `VaultState` (Task 3); `mandateVaultAbi` (Task 1).
- Produces:
  - `src/intent.ts`:
    - `interface Proposal { action: ActionName; symbol: TokenSymbol | "USDC"; amountUsd: number; rationale: string }`
    - `type BuildResult = { ok: true; intent: OnchainIntent; proposal: Proposal; amountUsd6: bigint; clamped: boolean } | { ok: false; proposal: Proposal; error: string }`
    - `intentId(runId: string, index: number): Hex`
    - `rationaleHash(text: string): Hex`
    - `buildIntent(p: Proposal, state: VaultState, ctx: { runId: string; index: number; expensePayee: Address }): BuildResult`
  - `src/chain/preview.ts`:
    - `type PreviewClient = Pick<PublicClient, "readContract">`
    - `type PreviewResult = ReasonName | "UNKNOWN"`
    - `previewIntent(client: PreviewClient, vault: Address, executor: Address, intent: OnchainIntent, blockNumber?: bigint): Promise<PreviewResult>`
  - `src/refusals.ts`:
    - `LOGGABLE_REASONS: ReadonlySet<ReasonName>`
    - `type Gate = { send: true; kind: "execute" | "log-refusal" } | { send: false; why: string }`
    - `gate(preview: PreviewResult, alreadyLogged: boolean): Gate`

**Why preview passes `account: executor`:** `GuardLib` checks the B20 executor policy against `tx.origin` (Plan 1/2A ruling). An `eth_call` whose `from` is the executor sets both `msg.sender` and `tx.origin` to it, so the preview sees the same policy verdict `execute()` will.

**Build rules (`buildIntent`):**
- BUY / SELL / SUPPLY / WITHDRAW_COLLATERAL need a basket symbol; BORROW / REPAY / PAY_EXPENSE need `"USDC"`. Otherwise `error: "symbol X does not fit ACTION"`.
- A stock symbol must be listed in `state.tokens` (by address), else `error: "X is not listed in the vault"`.
- Amounts: `usd6 = usdToUsdc6(amountUsd)`. Then:
  - BUY: `amount = min(usd6, usdcBalance)`.
  - BORROW: `amount = usd6`.
  - REPAY: `amount = min(usd6, usdcBalance, debt)` when `credit.readable && debt > 0`, else `min(usd6, usdcBalance)`.
  - PAY_EXPENSE: `amount = min(usd6, usdcBalance)`; `payee = ctx.expensePayee`.
  - SELL / SUPPLY: `raw = min(rawForUsd6(usd6, price8, decimals), balance)`.
  - WITHDRAW_COLLATERAL: `raw = min(rawForUsd6(...), supplied)`.
  - Stock actions with `price8 === null` → `error: "no price for X"`.
  - `clamped = true` when `min` lowered the amount. A resulting `amount === 0n` → `error: "amount rounds to zero"`.
- `minOut = 0n` always: the vault applies its own floor `oracle × (1 − maxSlippageBps)` and takes the larger of the two (`MandateVault._perform`).
- `payee = zeroAddress` except PAY_EXPENSE.
- `id = keccak256(encodePacked(["string", "uint256"], [runId, BigInt(index)]))`, so a retry of the same run and index can never execute twice (the vault reverts `IntentAlreadyUsed`).
- `rationaleHash = keccak256(toBytes(rationale))`. The text itself goes to the journal (Task 6) for the Plan 3 dashboard.
- `amountUsd6` in the result is the dollar size actually used (for stock actions: `valueUsd6(raw, price8, decimals)`).

**Gate rules (`gate`):** spec §3.5 step 3. A refusal is only sent onchain when it tells the "knows when NOT to trade" story, and at most once per reason per UTC day.
- `"OK"` → `{ send: true, kind: "execute" }`.
- `"UNKNOWN"` → `{ send: false, why: "guard state unknown (RPC)" }` (spec §5).
- Loggable and not yet logged → `{ send: true, kind: "log-refusal" }`; loggable and logged → `{ send: false, why: "REASON already logged today" }`.
- Anything else → `{ send: false, why: "REASON not worth a log tx" }`.
- `LOGGABLE_REASONS` = MARKET_CLOSED, FEED_STALE, BAD_PRICE, MULTIPLIER_COOLDOWN, PREMIUM_TOO_HIGH, TOKEN_PAUSED, POLICY_BLOCKED, SIZE_LIMIT, CONCENTRATION, HEALTH_FACTOR_LOW, DERISK_WINDOW. Not loggable: VAULT_PAUSED, ACTION_NOT_SUPPORTED, TOKEN_NOT_ALLOWED, PAYEE_NOT_ALLOWED, INSUFFICIENT_BALANCE (agent bookkeeping, not market safety), and SWAP_FAILED / TRANSFER_FAILED / CREDIT_FAILED (preview never returns them).

- [ ] **Step 1: Write the failing tests**

`agent/test/intent.test.ts`:

```ts
import { encodePacked, keccak256, toBytes, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf, USDC } from "../src/addresses.js";
import { readVaultState } from "../src/chain/state.js";
import { buildIntent, intentId, rationaleHash, type Proposal } from "../src/intent.js";
import { CREDIT, VAULT, standardScene } from "./fakes/fakeChain.js";

const PAYEE = "0x3333333333333333333333333333333333333333" as const;
const ctx = { runId: "run-1", index: 0, expensePayee: PAYEE };
const p = (over: Partial<Proposal>): Proposal => ({ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "buy the dip", ...over });

describe("buildIntent", async () => {
  const scene = standardScene()
    .set(addressOf("NVDAc"), "balanceOf", 10_713_815n) // $20 of NVDAc in the wallet
    .set(CREDIT, "suppliedOf", (a) => (a[0] === addressOf("NVDAc") ? 5_000_000n : 0n))
    .set(CREDIT, "debt", 3_000_000n)
    .set(CREDIT, "healthFactor", 3n * 10n ** 18n);
  const state = await readVaultState(scene.client(), VAULT);

  it("builds a BUY in USDC units", () => {
    const r = buildIntent(p({}), state, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.intent).toEqual({
      id: keccak256(encodePacked(["string", "uint256"], ["run-1", 0n])),
      action: 0,
      token: addressOf("NVDAc"),
      amount: 20_000_000n,
      minOut: 0n,
      payee: zeroAddress,
      rationaleHash: keccak256(toBytes("buy the dip")),
    });
    expect(r.clamped).toBe(false);
  });

  it("clamps a BUY to the USDC balance", () => {
    const r = buildIntent(p({ amountUsd: 500 }), state, ctx);
    expect(r.ok && r.intent.amount).toBe(100_000_000n);
    expect(r.ok && r.clamped).toBe(true);
  });

  it("converts a SELL to raw units and clamps to the wallet balance", () => {
    const r = buildIntent(p({ action: "SELL", amountUsd: 10 }), state, ctx);
    expect(r.ok && r.intent.amount).toBe(5_356_907n); // rawForUsd6(10e6, 18667486580, 8)
    const all = buildIntent(p({ action: "SELL", amountUsd: 999 }), state, ctx);
    expect(all.ok && all.intent.amount).toBe(10_713_815n);
  });

  it("clamps WITHDRAW_COLLATERAL to the supplied amount", () => {
    const r = buildIntent(p({ action: "WITHDRAW_COLLATERAL", amountUsd: 999 }), state, ctx);
    expect(r.ok && r.intent.amount).toBe(5_000_000n);
  });

  it("clamps REPAY to the debt", () => {
    const r = buildIntent(p({ action: "REPAY", symbol: "USDC", amountUsd: 50 }), state, ctx);
    expect(r.ok && r.intent).toMatchObject({ action: 5, token: USDC, amount: 3_000_000n });
  });

  it("sets the payee only for PAY_EXPENSE", () => {
    const r = buildIntent(p({ action: "PAY_EXPENSE", symbol: "USDC", amountUsd: 0.42 }), state, ctx);
    expect(r.ok && r.intent).toMatchObject({ action: 6, token: USDC, amount: 420_000n, payee: PAYEE });
  });

  it("rejects a symbol that does not fit the action", () => {
    expect(buildIntent(p({ action: "BORROW", symbol: "NVDAc" }), state, ctx)).toMatchObject({ ok: false, error: "symbol NVDAc does not fit BORROW" });
    expect(buildIntent(p({ action: "BUY", symbol: "USDC" }), state, ctx)).toMatchObject({ ok: false, error: "symbol USDC does not fit BUY" });
  });

  it("rejects a stock action without a price", async () => {
    const s2 = await readVaultState(standardScene().fail(state.tokens[0]!.config.feed, "latestRoundData").client(), VAULT);
    expect(buildIntent(p({ action: "SELL" }), s2, ctx)).toMatchObject({ ok: false, error: "no price for NVDAc" });
  });

  it("rejects an amount that rounds to zero", () => {
    expect(buildIntent(p({ amountUsd: 0.0000001 }), state, ctx)).toMatchObject({ ok: false, error: "amount rounds to zero" });
  });

  it("gives every index of a run its own id", () => {
    expect(intentId("run-1", 0)).not.toBe(intentId("run-1", 1));
    expect(intentId("run-1", 0)).not.toBe(intentId("run-2", 0));
    expect(rationaleHash("a")).toBe(keccak256(toBytes("a")));
  });
});
```

`agent/test/preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { previewIntent, type PreviewClient } from "../src/chain/preview.js";
import type { OnchainIntent } from "../src/types.js";

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const EXEC = "0x2222222222222222222222222222222222222222" as const;
const intent: OnchainIntent = {
  id: `0x${"11".repeat(32)}`,
  action: 0,
  token: "0xb20000000000000000000078ee7ce2fE4908108C",
  amount: 1n,
  minOut: 0n,
  payee: "0x0000000000000000000000000000000000000000",
  rationaleHash: `0x${"22".repeat(32)}`,
};

function client(answer: () => Promise<unknown>, seen: unknown[]): PreviewClient {
  return { readContract: (async (p: unknown) => (seen.push(p), answer())) as PreviewClient["readContract"] };
}

describe("previewIntent", () => {
  it("calls previewIntent as the executor at the pinned block", async () => {
    const seen: unknown[] = [];
    const r = await previewIntent(client(async () => 6, seen), VAULT, EXEC, intent, 123n);
    expect(r).toBe("MARKET_CLOSED");
    expect(seen[0]).toMatchObject({ address: VAULT, functionName: "previewIntent", args: [intent], account: EXEC, blockNumber: 123n });
  });
  it("returns OK", async () => {
    expect(await previewIntent(client(async () => 0, []), VAULT, EXEC, intent)).toBe("OK");
  });
  it("returns UNKNOWN when the RPC fails", async () => {
    expect(await previewIntent(client(async () => Promise.reject(new Error("timeout")), []), VAULT, EXEC, intent)).toBe("UNKNOWN");
  });
  it("returns UNKNOWN for a reason id the agent does not know", async () => {
    expect(await previewIntent(client(async () => 42, []), VAULT, EXEC, intent)).toBe("UNKNOWN");
  });
});
```

`agent/test/refusals.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gate, LOGGABLE_REASONS } from "../src/refusals.js";

describe("gate", () => {
  it("executes OK intents", () => expect(gate("OK", false)).toEqual({ send: true, kind: "execute" }));
  it("does nothing when the guard is unknown", () => expect(gate("UNKNOWN", false)).toEqual({ send: false, why: "guard state unknown (RPC)" }));
  it("logs a market refusal once per day", () => {
    expect(gate("MARKET_CLOSED", false)).toEqual({ send: true, kind: "log-refusal" });
    expect(gate("MARKET_CLOSED", true)).toEqual({ send: false, why: "MARKET_CLOSED already logged today" });
  });
  it("never spends gas on bookkeeping refusals", () => {
    expect(gate("INSUFFICIENT_BALANCE", false)).toEqual({ send: false, why: "INSUFFICIENT_BALANCE not worth a log tx" });
    expect(gate("VAULT_PAUSED", false).send).toBe(false);
  });
  it("lists exactly the market-safety reasons", () => {
    expect([...LOGGABLE_REASONS].sort()).toEqual(
      ["BAD_PRICE", "CONCENTRATION", "DERISK_WINDOW", "FEED_STALE", "HEALTH_FACTOR_LOW", "MARKET_CLOSED", "MULTIPLIER_COOLDOWN", "POLICY_BLOCKED", "PREMIUM_TOO_HIGH", "SIZE_LIMIT", "TOKEN_PAUSED"],
    );
  });
});
```

Check the SELL expectation before running: `rawForUsd6(10_000_000n, 18667486580n, 8) = 10_000_000 × 10^10 / 18_667_486_580 = 5_356_907` (truncated).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/intent.test.ts test/preview.test.ts test/refusals.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`agent/src/intent.ts`:

```ts
import { encodePacked, getAddress, keccak256, toBytes, zeroAddress, type Address, type Hex } from "viem";
import { addressOf, type TokenSymbol } from "./addresses.js";
import type { VaultState } from "./chain/state.js";
import { actionId, type ActionName, type OnchainIntent } from "./types.js";
import { minBig, rawForUsd6, usdToUsdc6, valueUsd6 } from "./units.js";

export interface Proposal {
  action: ActionName;
  symbol: TokenSymbol | "USDC";
  amountUsd: number;
  rationale: string;
}

export type BuildResult =
  | { ok: true; intent: OnchainIntent; proposal: Proposal; amountUsd6: bigint; clamped: boolean }
  | { ok: false; proposal: Proposal; error: string };

const USDC_ACTIONS: ReadonlySet<ActionName> = new Set(["BORROW", "REPAY", "PAY_EXPENSE"]);

export function intentId(runId: string, index: number): Hex {
  return keccak256(encodePacked(["string", "uint256"], [runId, BigInt(index)]));
}

export function rationaleHash(text: string): Hex {
  return keccak256(toBytes(text));
}

export function buildIntent(
  p: Proposal,
  s: VaultState,
  ctx: { runId: string; index: number; expensePayee: Address },
): BuildResult {
  const fail = (error: string): BuildResult => ({ ok: false, proposal: p, error });
  const wantsUsdc = USDC_ACTIONS.has(p.action);
  if (wantsUsdc !== (p.symbol === "USDC")) return fail(`symbol ${p.symbol} does not fit ${p.action}`);

  let usd6: bigint;
  try {
    usd6 = usdToUsdc6(p.amountUsd);
  } catch {
    return fail(`invalid amount ${p.amountUsd}`);
  }

  let token: Address;
  let amount: bigint;
  let amountUsd6: bigint;
  if (wantsUsdc) {
    token = s.usdc;
    const debt = s.credit?.readable && s.credit.debt > 0n ? s.credit.debt : null;
    amount =
      p.action === "BORROW" ? usd6 : p.action === "REPAY" && debt !== null ? minBig(usd6, s.usdcBalance, debt) : minBig(usd6, s.usdcBalance);
    amountUsd6 = amount;
  } else if (p.action === "BUY") {
    token = addressOf(p.symbol as TokenSymbol);
    if (!s.tokens.some((t) => getAddress(t.address) === token)) return fail(`${p.symbol} is not listed in the vault`);
    amount = minBig(usd6, s.usdcBalance);
    amountUsd6 = amount;
  } else {
    token = addressOf(p.symbol as TokenSymbol);
    const t = s.tokens.find((x) => getAddress(x.address) === token);
    if (!t) return fail(`${p.symbol} is not listed in the vault`);
    if (t.price8 === null) return fail(`no price for ${p.symbol}`);
    const cap = p.action === "WITHDRAW_COLLATERAL" ? t.supplied : t.balance;
    amount = minBig(rawForUsd6(usd6, t.price8, t.decimals), cap);
    amountUsd6 = valueUsd6(amount, t.price8, t.decimals);
  }
  if (amount === 0n) return fail("amount rounds to zero");

  const requested = wantsUsdc || p.action === "BUY" ? usd6 : null;
  const clamped = requested !== null ? amount < requested : amountUsd6 + 1n < usd6;
  return {
    ok: true,
    proposal: p,
    amountUsd6,
    clamped,
    intent: {
      id: intentId(ctx.runId, ctx.index),
      action: actionId(p.action),
      token,
      amount,
      minOut: 0n,
      payee: p.action === "PAY_EXPENSE" ? ctx.expensePayee : zeroAddress,
      rationaleHash: rationaleHash(p.rationale),
    },
  };
}
```

`agent/src/chain/preview.ts`:

```ts
import type { Address, PublicClient } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { REASONS, type OnchainIntent, type ReasonName } from "../types.js";

export type PreviewClient = Pick<PublicClient, "readContract">;
export type PreviewResult = ReasonName | "UNKNOWN";

/** eth_call previewIntent with from = executor, so GuardLib's tx.origin policy check matches execute(). */
export async function previewIntent(
  client: PreviewClient,
  vault: Address,
  executor: Address,
  intent: OnchainIntent,
  blockNumber?: bigint,
): Promise<PreviewResult> {
  try {
    const r = await client.readContract({
      address: vault,
      abi: mandateVaultAbi,
      functionName: "previewIntent",
      args: [intent],
      account: executor,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
    return REASONS[Number(r)] ?? "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
```

`agent/src/refusals.ts`:

```ts
import type { PreviewResult } from "./chain/preview.js";
import type { ReasonName } from "./types.js";

/** Refusals worth one onchain Decision log per UTC day: the market-safety story (spec §3.5 step 3). */
export const LOGGABLE_REASONS: ReadonlySet<ReasonName> = new Set<ReasonName>([
  "MARKET_CLOSED",
  "FEED_STALE",
  "BAD_PRICE",
  "MULTIPLIER_COOLDOWN",
  "PREMIUM_TOO_HIGH",
  "TOKEN_PAUSED",
  "POLICY_BLOCKED",
  "SIZE_LIMIT",
  "CONCENTRATION",
  "HEALTH_FACTOR_LOW",
  "DERISK_WINDOW",
]);

export type Gate = { send: true; kind: "execute" | "log-refusal" } | { send: false; why: string };

export function gate(preview: PreviewResult, alreadyLogged: boolean): Gate {
  if (preview === "OK") return { send: true, kind: "execute" };
  if (preview === "UNKNOWN") return { send: false, why: "guard state unknown (RPC)" };
  if (!LOGGABLE_REASONS.has(preview)) return { send: false, why: `${preview} not worth a log tx` };
  return alreadyLogged ? { send: false, why: `${preview} already logged today` } : { send: true, kind: "log-refusal" };
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (19 new); `tsc` clean. If `tsc` complains that `readContract` does not accept `account`, check the installed viem: `ReadContractParameters` has had `account` since viem 2.0; do not drop it, since it is the point of this task.

- [ ] **Step 5: Commit**

```bash
git add agent/src/intent.ts agent/src/chain/preview.ts agent/src/refusals.ts agent/test/intent.test.ts agent/test/preview.test.ts agent/test/refusals.test.ts
git commit -m "feat(agent): intent builder, executor-origin preview and refusal-log gate"
```

---

### Task 6: Ledger store, journal and Claude pricing

**Files:**
- Create: `agent/src/ledger/store.ts`
- Create: `agent/src/ledger/journal.ts`
- Create: `agent/src/llm/pricing.ts`
- Test: `agent/test/store.test.ts`, `agent/test/journal.test.ts`, `agent/test/pricing.test.ts`

**Interfaces:**
- Consumes: `ReasonName` (Task 1); `PreviewResult` (Task 5).
- Produces:
  - `src/llm/pricing.ts`: `interface Usage { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }`, `costUsd6(model: string, usage: Usage): bigint`.
  - `src/ledger/store.ts`: `class Store` with
    - `static open(dir: string): Promise<Store>` — creates `dir` and loads `dir/state.json` if present.
    - `recordCompute(day: bigint, usd6: bigint): void`
    - `dailyComputeUsd6(today: bigint, fallbackUsd6: bigint): bigint`
    - `unpaidUsd6(): bigint`
    - `recordPaid(usd6: bigint): void`
    - `hasLoggedRefusal(day: bigint, reason: ReasonName): boolean`
    - `recordRefusalLog(day: bigint, reason: ReasonName): void`
    - `txCount(day: bigint): number`
    - `recordTx(day: bigint): void`
    - `save(): Promise<void>` — atomic (write `state.json.tmp`, then rename).
  - `src/ledger/journal.ts`: `type JournalEntry` (union below), `class Journal { constructor(dir: string); append(e: JournalEntry): Promise<void>; read(): Promise<JournalEntry[]> }`. One JSON object per line in `dir/journal.jsonl`, bigints written as decimal strings, every line gets `ts` (ISO time).

`JournalEntry`:

```ts
export type JournalEntry =
  | { kind: "run"; runId: string; block: bigint; day: bigint; mode: "dry-run" | "live"; ok: boolean; summary: string; costUsd6: bigint; suggestions: number; proposals: number; error?: string }
  | { kind: "intent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; preview: PreviewResult; gate: string; txHash?: Hex; decision?: { allowed: boolean; reason: string } }
  | { kind: "housekeeping"; runId: string; call: "syncMultiplier"; token: Address; txHash?: Hex; note?: string }
  | { kind: "skip"; runId: string; index: number; symbol: string; action: string; error: string }
  | { kind: "error"; runId: string; message: string };
```

The journal is the off-chain half of the Decision log: Plan 3's diary and dashboard join `Decision.rationaleHash` to `rationale` here.

**Pricing** (per million tokens, from the claude-api skill model table, cached 2026-10-06):

| model | input | output | cache read | cache write (5 min) |
|---|---|---|---|---|
| `claude-sonnet-5-5` | $2.00 | $10.00 | $0.20 | $2.50 |
| `claude-opus-5-5` | $4.00 | $20.00 | $0.20 | $5.00 |

$X per million tokens is X micro-dollars per token, so `usd6 = tokens × price`. Prices are kept in cents to stay in integers: `usd6 = ceil(tokens × cents / 100)`. An unknown model is billed at the `claude-opus-5-5` row (overcharging the bill is the safe direction).

**`dailyComputeUsd6`:** mean of the recorded totals of the up-to-7 days before `today` that have any record; `fallbackUsd6` when none. Today is excluded because it is incomplete.

**Bill semantics:** `unpaidUsd6 = Σ compute − paid`, floored at 0. PAY_EXPENSE settles it (Task 10).

- [ ] **Step 1: Write the failing tests**

`agent/test/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { costUsd6 } from "../src/llm/pricing.js";

describe("costUsd6", () => {
  it("prices sonnet 5.5", () => {
    // 10k in ($0.02) + 1k out ($0.01) = $0.03
    expect(costUsd6("claude-sonnet-5-5", { input_tokens: 10_000, output_tokens: 1_000 })).toBe(30_000n);
  });
  it("prices cache reads and writes", () => {
    expect(costUsd6("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 10_000 })).toBe(20_000n + 25_000n);
  });
  it("rounds up to the next micro-dollar", () => {
    expect(costUsd6("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1 })).toBe(1n);
  });
  it("bills an unknown model at opus prices", () => {
    expect(costUsd6("claude-x", { input_tokens: 1_000_000, output_tokens: 0 })).toBe(4_000_000n);
  });
});
```

`agent/test/store.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../src/ledger/store.js";

const dir = () => mkdtemp(join(tmpdir(), "maat-store-"));

describe("Store", () => {
  it("starts empty", async () => {
    const s = await Store.open(await dir());
    expect(s.unpaidUsd6()).toBe(0n);
    expect(s.dailyComputeUsd6(100n, 500_000n)).toBe(500_000n);
    expect(s.txCount(100n)).toBe(0);
  });

  it("tracks compute, payments and the unpaid bill", async () => {
    const s = await Store.open(await dir());
    s.recordCompute(100n, 300_000n);
    s.recordCompute(100n, 200_000n);
    s.recordCompute(101n, 100_000n);
    expect(s.unpaidUsd6()).toBe(600_000n);
    s.recordPaid(450_000n);
    expect(s.unpaidUsd6()).toBe(150_000n);
    s.recordPaid(1_000_000n);
    expect(s.unpaidUsd6()).toBe(0n);
  });

  it("averages the previous 7 recorded days, excluding today", async () => {
    const s = await Store.open(await dir());
    s.recordCompute(90n, 9_000_000n); // older than 7 days before 100: ignored
    s.recordCompute(95n, 400_000n);
    s.recordCompute(99n, 600_000n);
    s.recordCompute(100n, 5_000_000n); // today: ignored
    expect(s.dailyComputeUsd6(100n, 1n)).toBe(500_000n);
  });

  it("remembers refusal logs per day and reason", async () => {
    const s = await Store.open(await dir());
    s.recordRefusalLog(100n, "MARKET_CLOSED");
    expect(s.hasLoggedRefusal(100n, "MARKET_CLOSED")).toBe(true);
    expect(s.hasLoggedRefusal(100n, "FEED_STALE")).toBe(false);
    expect(s.hasLoggedRefusal(101n, "MARKET_CLOSED")).toBe(false);
  });

  it("persists across reopen", async () => {
    const d = await dir();
    const s = await Store.open(d);
    s.recordCompute(100n, 123n);
    s.recordTx(100n);
    s.recordRefusalLog(100n, "FEED_STALE");
    await s.save();
    const again = await Store.open(d);
    expect(again.unpaidUsd6()).toBe(123n);
    expect(again.txCount(100n)).toBe(1);
    expect(again.hasLoggedRefusal(100n, "FEED_STALE")).toBe(true);
    expect(JSON.parse(await readFile(join(d, "state.json"), "utf8")).version).toBe(1);
  });

  it("refuses a state file from a future version", async () => {
    const d = await dir();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(d, "state.json"), JSON.stringify({ version: 2 }));
    await expect(Store.open(d)).rejects.toThrow(/unsupported state version/);
  });
});
```

`agent/test/journal.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Journal } from "../src/ledger/journal.js";

describe("Journal", () => {
  it("appends one JSON line per entry with bigints as strings", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    const j = new Journal(d);
    await j.append({ kind: "error", runId: "r1", message: "rpc down" });
    await j.append({ kind: "run", runId: "r2", block: 5n, day: 20_763n, mode: "dry-run", ok: true, summary: "hold", costUsd6: 30_000n, suggestions: 0, proposals: 0 });
    const lines = (await readFile(join(d, "journal.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const run = JSON.parse(lines[1]!);
    expect(run).toMatchObject({ kind: "run", block: "5", costUsd6: "30000" });
    expect(typeof run.ts).toBe("string");
    expect((await j.read()).map((e) => e.kind)).toEqual(["error", "run"]);
  });
  it("reads an empty journal as []", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-journal-"));
    expect(await new Journal(d).read()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/pricing.test.ts test/store.test.ts test/journal.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`agent/src/llm/pricing.ts`:

```ts
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Cents per million tokens (claude-api skill model table, cached 2026-10-06). Cache write = 1.25 x input (5 min TTL). */
const CENTS: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { input: 200, output: 1000, cacheRead: 20, cacheWrite: 250 },
  "claude-opus-5-5": { input: 400, output: 2000, cacheRead: 20, cacheWrite: 500 },
};
const FALLBACK = CENTS["claude-opus-5-5"]!;

/** $X per million tokens = X micro-dollars per token, so usd6 = tokens x cents / 100, rounded up. */
export function costUsd6(model: string, u: Usage): bigint {
  const p = CENTS[model] ?? FALLBACK;
  const cents =
    BigInt(u.input_tokens) * BigInt(p.input) +
    BigInt(u.output_tokens) * BigInt(p.output) +
    BigInt(u.cache_read_input_tokens ?? 0) * BigInt(p.cacheRead) +
    BigInt(u.cache_creation_input_tokens ?? 0) * BigInt(p.cacheWrite);
  return (cents + 99n) / 100n;
}
```

`agent/src/ledger/store.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReasonName } from "../types.js";

interface Data {
  version: 1;
  compute: Record<string, string>; // day -> usd6
  paidUsd6: string;
  refusals: Record<string, ReasonName[]>; // day -> reasons logged onchain
  txByDay: Record<string, number>;
}

const empty = (): Data => ({ version: 1, compute: {}, paidUsd6: "0", refusals: {}, txByDay: {} });

/** Agent memory that must survive restarts: compute bill, refusal-log rate limit, daily tx count. */
export class Store {
  private constructor(
    private readonly file: string,
    private data: Data,
  ) {}

  static async open(dir: string): Promise<Store> {
    await mkdir(dir, { recursive: true });
    const file = join(dir, "state.json");
    let data = empty();
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (raw.version !== 1) throw new Error(`unsupported state version ${raw.version}`);
      data = { ...empty(), ...raw };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    return new Store(file, data);
  }

  recordCompute(day: bigint, usd6: bigint): void {
    const k = day.toString();
    this.data.compute[k] = (BigInt(this.data.compute[k] ?? "0") + usd6).toString();
  }

  dailyComputeUsd6(today: bigint, fallbackUsd6: bigint): bigint {
    const days: bigint[] = [];
    for (let d = today - 7n; d < today; d++) {
      const v = this.data.compute[d.toString()];
      if (v !== undefined) days.push(BigInt(v));
    }
    if (days.length === 0) return fallbackUsd6;
    return days.reduce((a, b) => a + b, 0n) / BigInt(days.length);
  }

  unpaidUsd6(): bigint {
    const total = Object.values(this.data.compute).reduce((a, v) => a + BigInt(v), 0n);
    const paid = BigInt(this.data.paidUsd6);
    return total > paid ? total - paid : 0n;
  }

  recordPaid(usd6: bigint): void {
    this.data.paidUsd6 = (BigInt(this.data.paidUsd6) + usd6).toString();
  }

  hasLoggedRefusal(day: bigint, reason: ReasonName): boolean {
    return this.data.refusals[day.toString()]?.includes(reason) ?? false;
  }

  recordRefusalLog(day: bigint, reason: ReasonName): void {
    const k = day.toString();
    this.data.refusals[k] = [...(this.data.refusals[k] ?? []), reason];
  }

  txCount(day: bigint): number {
    return this.data.txByDay[day.toString()] ?? 0;
  }

  recordTx(day: bigint): void {
    const k = day.toString();
    this.data.txByDay[k] = (this.data.txByDay[k] ?? 0) + 1;
  }

  async save(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    await rename(tmp, this.file);
  }
}
```

`agent/src/ledger/journal.ts`:

```ts
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import type { PreviewResult } from "../chain/preview.js";

export type JournalEntry =
  | { kind: "run"; runId: string; block: bigint; day: bigint; mode: "dry-run" | "live"; ok: boolean; summary: string; costUsd6: bigint; suggestions: number; proposals: number; error?: string }
  | { kind: "intent"; runId: string; index: number; intentId: Hex; action: string; symbol: string; amountUsd6: bigint; rationale: string; rationaleHash: Hex; preview: PreviewResult; gate: string; txHash?: Hex; decision?: { allowed: boolean; reason: string } }
  | { kind: "housekeeping"; runId: string; call: "syncMultiplier"; token: Address; txHash?: Hex; note?: string }
  | { kind: "skip"; runId: string; index: number; symbol: string; action: string; error: string }
  | { kind: "error"; runId: string; message: string };

const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

/** Append-only JSONL. Rows read back keep bigints as strings. */
export class Journal {
  private readonly file: string;

  constructor(private readonly dir: string) {
    this.file = join(dir, "journal.jsonl");
  }

  async append(e: JournalEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file, JSON.stringify({ ts: new Date().toISOString(), ...e }, replacer) + "\n");
  }

  async read(): Promise<JournalEntry[]> {
    try {
      const text = await readFile(this.file, "utf8");
      return text
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as JournalEntry);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (12 new); `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add agent/src/ledger agent/src/llm/pricing.ts agent/test/store.test.ts agent/test/journal.test.ts agent/test/pricing.test.ts
git commit -m "feat(agent): persistent ledger, JSONL decision journal and Claude cost pricing"
```

---

### Task 7: Claude proposer

**Files:**
- Create: `agent/src/llm/schema.ts`
- Create: `agent/src/llm/prompt.ts`
- Create: `agent/src/llm/proposer.ts`
- Test: `agent/test/schema.test.ts`, `agent/test/prompt.test.ts`, `agent/test/proposer.test.ts`

**Interfaces:**
- Consumes: `Proposal` (Task 5); `VaultState` (Task 3); `PolicyView` (Task 4); `Usage`, `costUsd6` (Task 6); `usdc6ToUsd` (Task 2); `REASONS` (Task 1).
- Produces:
  - `src/llm/schema.ts`: `LLM_ACTIONS` (BUY, SELL, SUPPLY, WITHDRAW_COLLATERAL, BORROW, REPAY — PAY_EXPENSE is never Claude's call, Task 10 settles bills deterministically), `LLM_SYMBOLS` (`USDC`, `NVDAc`, `GOOGLc`, `AAPLc`), `BatchSchema` (zod), `type Batch`, `BATCH_JSON_SCHEMA` (plain JSON Schema for `output_config.format`).
  - `src/llm/prompt.ts`: `SYSTEM_PROMPT: string`, `renderUserMessage(input: ProposerInput): string`.
  - `src/llm/proposer.ts`:
    - `interface ProposerInput { state: VaultState; policy: PolicyView; billUsd6: bigint }`
    - `type ProposerOutput = { ok: true; summary: string; proposals: Proposal[]; costUsd6: bigint; model: string } | { ok: false; error: string; costUsd6: bigint }`
    - `interface Proposer { propose(input: ProposerInput): Promise<ProposerOutput> }`
    - `type CreateMessage = (params: Record<string, unknown>) => Promise<{ model: string; stop_reason: string | null; content: readonly { type: string; text?: string }[]; usage: Usage }>`
    - `class ClaudeProposer implements Proposer { constructor(opts: { model: string; create?: CreateMessage }) }`
    - `class FixedProposer implements Proposer { constructor(batch: Batch) }` — returns the batch with `costUsd6: 0n`; used by tests and the integration demo.

**Request shape** (claude-api skill; verify names against the installed SDK, which is authoritative over this plan if they differ):
- `client.beta.messages.create({...})` — the beta namespace because of `fallbacks`.
- `model: opts.model` (default from config `claude-sonnet-5-5`, spec §3.5).
- `max_tokens: 16000`, non-streaming (the answer is a short JSON object).
- `system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]` — stable prefix; the volatile state goes in the user message. (Below the model's minimum cacheable size the cache silently does nothing; that is fine.)
- `messages: [{ role: "user", content: renderUserMessage(input) }]`.
- `output_config: { effort: "medium", format: { type: "json_schema", schema: BATCH_JSON_SCHEMA } }` — structured output instead of a forced tool call: Sonnet 5.5 returns 400 on `tool_choice` `any`/`tool`, and the spec's "fixed schema" is exactly what structured outputs give.
- `betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"` — on a policy decline the API re-runs on a fallback model inside the same call. If the installed SDK's types reject `fallbacks: "default"`, keep it and cast the params object (`as never`) at the one call site; do not drop it silently.
- No `thinking` (adaptive is Sonnet 5.5's default), no `temperature` / `top_p` (rejected from 2026-10-21), no `tool_choice`.

**Response handling** (spec §5: invalid JSON → validate, skip, log; the vault is still the last check):
- Any thrown error (network, 4xx/5xx after the SDK's own retries) → `{ ok: false, error: "claude: <message>", costUsd6: 0n }`. Never throws.
- `costUsd6 = costUsd6(response.model, response.usage)` on every response, including failures.
- `stop_reason === "refusal"` → `ok: false, error: "claude refused"`; `"max_tokens"` → `ok: false, error: "claude output truncated"`.
- Join the `text` blocks, `JSON.parse`, `BatchSchema.safeParse` → failure → `ok: false, error: "invalid proposal JSON: ..."`.
- Success → `proposals` mapped from `intents` (same field names as `Proposal`).

- [ ] **Step 1: Write the failing tests**

`agent/test/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BATCH_JSON_SCHEMA, BatchSchema, LLM_ACTIONS, LLM_SYMBOLS } from "../src/llm/schema.js";

describe("proposal schema", () => {
  it("accepts a valid batch", () => {
    const r = BatchSchema.safeParse({ summary: "hold", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "underweight" }] });
    expect(r.success).toBe(true);
  });
  it("accepts an empty batch (doing nothing is a valid answer)", () => {
    expect(BatchSchema.safeParse({ summary: "market closed, nothing to do", intents: [] }).success).toBe(true);
  });
  it("rejects PAY_EXPENSE, unknown symbols, extra keys and bad amounts", () => {
    const bad = [
      { summary: "x", intents: [{ action: "PAY_EXPENSE", symbol: "USDC", amountUsd: 1, rationale: "r" }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "AMZNc", amountUsd: 1, rationale: "r" }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "r", minOut: 5 }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: -1, rationale: "r" }] },
      { summary: "x", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "" }] },
      { summary: "x", intents: Array(7).fill({ action: "BUY", symbol: "NVDAc", amountUsd: 1, rationale: "r" }) },
    ];
    for (const b of bad) expect(BatchSchema.safeParse(b).success).toBe(false);
  });
  it("JSON schema enums match the zod enums", () => {
    const item = BATCH_JSON_SCHEMA.properties.intents.items;
    expect(item.properties.action.enum).toEqual([...LLM_ACTIONS]);
    expect(item.properties.symbol.enum).toEqual([...LLM_SYMBOLS]);
    expect(item.additionalProperties).toBe(false);
    expect(BATCH_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});
```

`agent/test/prompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { renderUserMessage, SYSTEM_PROMPT } from "../src/llm/prompt.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";

describe("prompt", () => {
  it("system prompt carries the mandate rules and stays free of volatile data", () => {
    expect(SYSTEM_PROMPT).toMatch(/LLM proposes, contract decides/);
    expect(SYSTEM_PROMPT).toMatch(/empty list/i);
    expect(SYSTEM_PROMPT).toMatch(/30%/);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamps: keeps the cache prefix stable
  });
  it("user message shows state, weights, suggestions and the bill in dollars", async () => {
    const state = await readVaultState(standardScene().client(), VAULT);
    const policy = evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 120_000n });
    const msg = renderUserMessage({ state, policy, billUsd6: 120_000n });
    expect(msg).toContain('"usdc": 100');
    expect(msg).toContain('"marketOpen": true');
    expect(msg).toContain('"unpaidComputeBill": 0.12');
    expect(msg).toContain('"NVDAc"');
    expect(msg).toContain('"suggestions"');
    expect(msg).not.toMatch(/\d+n\b/); // no raw bigint leakage
  });
});
```

`agent/test/proposer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readVaultState } from "../src/chain/state.js";
import { ClaudeProposer, FixedProposer, type CreateMessage } from "../src/llm/proposer.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "./fakes/fakeChain.js";

const input = async () => {
  const state = await readVaultState(standardScene().client(), VAULT);
  return { state, policy: evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n }), billUsd6: 0n };
};
const usage = { input_tokens: 10_000, output_tokens: 1_000 };
const reply = (text: string, stop = "end_turn"): CreateMessage =>
  async () => ({ model: "claude-sonnet-5-5", stop_reason: stop, content: [{ type: "text", text }], usage });

describe("ClaudeProposer", () => {
  it("sends the documented request shape", async () => {
    let seen: Record<string, unknown> = {};
    const create: CreateMessage = async (p) => ((seen = p), { model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: '{"summary":"hold","intents":[]}' }], usage });
    await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
    expect(seen).toMatchObject({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema" } },
    });
    expect(seen).not.toHaveProperty("temperature");
    expect(seen).not.toHaveProperty("tool_choice");
    expect(seen).not.toHaveProperty("thinking");
    expect((seen.system as { cache_control?: unknown }[])[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns proposals and their cost", async () => {
    const out = await new ClaudeProposer({
      model: "claude-sonnet-5-5",
      create: reply('{"summary":"buy NVDAc","intents":[{"action":"BUY","symbol":"NVDAc","amountUsd":20,"rationale":"underweight"}]}'),
    }).propose(await input());
    expect(out).toEqual({
      ok: true,
      summary: "buy NVDAc",
      proposals: [{ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "underweight" }],
      costUsd6: 30_000n,
      model: "claude-sonnet-5-5",
    });
  });

  it("skips invalid JSON but still bills it", async () => {
    const out = await new ClaudeProposer({ model: "claude-sonnet-5-5", create: reply("not json") }).propose(await input());
    expect(out.ok).toBe(false);
    expect(out.costUsd6).toBe(30_000n);
    expect(!out.ok && out.error).toMatch(/invalid proposal JSON/);
  });

  it("skips a schema violation", async () => {
    const out = await new ClaudeProposer({
      model: "claude-sonnet-5-5",
      create: reply('{"summary":"x","intents":[{"action":"PAY_EXPENSE","symbol":"USDC","amountUsd":1,"rationale":"r"}]}'),
    }).propose(await input());
    expect(!out.ok && out.error).toMatch(/invalid proposal JSON/);
  });

  it("treats a refusal and a truncation as no proposals", async () => {
    const refused = await new ClaudeProposer({ model: "claude-sonnet-5-5", create: reply("", "refusal") }).propose(await input());
    expect(refused).toMatchObject({ ok: false, error: "claude refused" });
    const cut = await new ClaudeProposer({ model: "claude-sonnet-5-5", create: reply('{"summ', "max_tokens") }).propose(await input());
    expect(cut).toMatchObject({ ok: false, error: "claude output truncated" });
  });

  it("never throws on an API error", async () => {
    const create: CreateMessage = async () => {
      throw new Error("529 overloaded");
    };
    const out = await new ClaudeProposer({ model: "claude-sonnet-5-5", create }).propose(await input());
    expect(out).toEqual({ ok: false, error: "claude: 529 overloaded", costUsd6: 0n });
  });
});

describe("FixedProposer", () => {
  it("returns its batch for free", async () => {
    const out = await new FixedProposer({ summary: "s", intents: [{ action: "REPAY", symbol: "USDC", amountUsd: 1, rationale: "r" }] }).propose(await input());
    expect(out).toMatchObject({ ok: true, costUsd6: 0n, proposals: [{ action: "REPAY" }] });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/schema.test.ts test/prompt.test.ts test/proposer.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`agent/src/llm/schema.ts`:

```ts
import { z } from "zod";

export const LLM_ACTIONS = ["BUY", "SELL", "SUPPLY", "WITHDRAW_COLLATERAL", "BORROW", "REPAY"] as const;
export const LLM_SYMBOLS = ["USDC", "NVDAc", "GOOGLc", "AAPLc"] as const;

export const ProposalSchema = z.strictObject({
  action: z.enum(LLM_ACTIONS),
  symbol: z.enum(LLM_SYMBOLS),
  amountUsd: z.number().positive().max(1_000_000),
  rationale: z.string().min(1).max(600),
});

export const BatchSchema = z.strictObject({
  summary: z.string().min(1).max(1200),
  intents: z.array(ProposalSchema).max(6),
});

export type Batch = z.infer<typeof BatchSchema>;

/**
 * Structured-output schema sent to Claude. Kept to types, enums and required keys; the numeric and length
 * bounds live in BatchSchema, which validates every answer anyway (spec §5).
 */
export const BATCH_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "intents"],
  properties: {
    summary: { type: "string", description: "One or two sentences on what you decided and why, for the public diary." },
    intents: {
      type: "array",
      description: "Actions to submit, in execution order. An empty list means do nothing this round.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "symbol", "amountUsd", "rationale"],
        properties: {
          action: { type: "string", enum: [...LLM_ACTIONS] },
          symbol: { type: "string", enum: [...LLM_SYMBOLS] },
          amountUsd: { type: "number", description: "Size in US dollars (for stock actions, the dollar value of shares)." },
          rationale: { type: "string", description: "Why, in one or two sentences. Published onchain as a hash." },
        },
      },
    },
  },
} as const;
```

`agent/src/llm/prompt.ts`:

```ts
import type { ProposerInput } from "./proposer.js";
import { usdc6ToUsd } from "../units.js";

export const SYSTEM_PROMPT = `You are Maat, the treasury agent of an onchain vault on Base. The vault holds USDC and tokenized US stocks
(B20 tokens NVDAc, GOOGLc, AAPLc) and can borrow USDC against them on Aave V4. Motto: "LLM proposes, contract decides."
You propose actions; the MandateVault contract checks each one against its mandate and refuses anything unsafe, and every
verdict, including refusals, is published onchain.

Investment policy (fixed; do not invent another):
- Target: 30% of net equity in USDC, the rest split equally across the stocks in the basket.
- Rebalance only when a weight drifts more than 5 percentage points from target.
- Stocks held in the vault should be supplied as collateral; withdraw collateral before selling it.
- Borrow USDC only to keep 7 days of compute costs plus unpaid bills in USDC, and only against supplied collateral.
- Repay debt when new revenue arrives, keeping the 7-day runway.
- Never predict prices. Never chase news. Size limits and market hours are enforced by the contract.

You receive the current state, the policy's computed weights and a list of suggestions. Suggestions are arithmetic, not
orders: adopt, resize or drop them. Proposing nothing is a valid and often correct answer: return an empty list.
When the market is closed or a feed is stale, the contract will refuse trades; you may still propose one if the refusal
itself is worth recording, but say so in the rationale. Compute bills are settled automatically; do not propose them.

Reply only with the JSON object the response schema describes. Amounts are in US dollars. Keep rationales short, factual
and in English.`;

const usd = (v: bigint) => Number(usdc6ToUsd(v).toFixed(6));

export function renderUserMessage({ state: s, policy: p, billUsd6 }: ProposerInput): string {
  const view = {
    block: s.blockNumber.toString(),
    utcTime: new Date(Number(s.timestamp) * 1000).toISOString(),
    marketOpen: s.marketOpen,
    vaultPaused: s.paused,
    usdc: usd(s.usdcBalance),
    newRevenue: usd(s.newRevenue),
    equity: usd(p.equityUsd6),
    cashWeightPct: p.cashBps / 100,
    unpaidComputeBill: usd(billUsd6),
    computeRunwayNeed: usd(p.runwayNeedUsd6),
    spendableForTrades: usd(p.spendableUsd6),
    credit: s.credit && {
      readable: s.credit.readable,
      debt: usd(s.credit.debt),
      healthFactor: s.credit.debt === 0n ? null : Number(s.credit.healthFactor) / 1e18,
      minHealthFactor: Number(s.mandate.minHealthFactor) / 1e18,
      targetHealthFactor: Number(s.mandate.targetHealthFactor) / 1e18,
    },
    limits: { perTradeUsd: usd(s.mandate.perTradeCapUsd), dailyUsd: usd(s.mandate.dailyCapUsd), spentTodayUsd: usd(s.spentToday) },
    tokens: s.tokens.map((t) => ({
      symbol: t.symbol ?? t.address,
      price: t.price8 === null ? null : Number(t.price8) / 1e8,
      feedAgeSeconds: t.feedAge === null ? null : Number(t.feedAge),
      valueUsd: usd(t.valueUsd6),
      ...(() => {
        const w = p.weights.find((x) => x.symbol === t.symbol);
        return w ? { weightPct: w.weightBps / 100, targetPct: w.targetBps / 100, inVaultUsd: usd(w.walletUsd6), suppliedUsd: usd(w.suppliedUsd6) } : {};
      })(),
    })),
    suggestions: p.suggestions.map((x) => ({ action: x.action, symbol: x.symbol, amountUsd: usd(x.amountUsd6), why: x.why })),
  };
  return `Current state:\n${JSON.stringify(view, null, 2)}\n\nDecide this round's actions.`;
}
```

`agent/src/llm/proposer.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { PolicyView } from "../policy.js";
import type { VaultState } from "../chain/state.js";
import type { Proposal } from "../intent.js";
import { costUsd6, type Usage } from "./pricing.js";
import { renderUserMessage, SYSTEM_PROMPT } from "./prompt.js";
import { BATCH_JSON_SCHEMA, BatchSchema, type Batch } from "./schema.js";

export interface ProposerInput {
  state: VaultState;
  policy: PolicyView;
  billUsd6: bigint;
}

export type ProposerOutput =
  | { ok: true; summary: string; proposals: Proposal[]; costUsd6: bigint; model: string }
  | { ok: false; error: string; costUsd6: bigint };

export interface Proposer {
  propose(input: ProposerInput): Promise<ProposerOutput>;
}

export type CreateMessage = (params: Record<string, unknown>) => Promise<{
  model: string;
  stop_reason: string | null;
  content: readonly { type: string; text?: string }[];
  usage: Usage;
}>;

function defaultCreate(): CreateMessage {
  const client = new Anthropic();
  return (params) => client.beta.messages.create(params as never) as never;
}

export class ClaudeProposer implements Proposer {
  private readonly create: CreateMessage;

  constructor(private readonly opts: { model: string; create?: CreateMessage }) {
    this.create = opts.create ?? defaultCreate();
  }

  async propose(input: ProposerInput): Promise<ProposerOutput> {
    let res: Awaited<ReturnType<CreateMessage>>;
    try {
      res = await this.create({
        model: this.opts.model,
        max_tokens: 16000,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: renderUserMessage(input) }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: BATCH_JSON_SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (e) {
      return { ok: false, error: `claude: ${(e as Error).message}`, costUsd6: 0n };
    }
    const cost = costUsd6(res.model, res.usage);
    if (res.stop_reason === "refusal") return { ok: false, error: "claude refused", costUsd6: cost };
    if (res.stop_reason === "max_tokens") return { ok: false, error: "claude output truncated", costUsd6: cost };
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: `invalid proposal JSON: ${(e as Error).message}`, costUsd6: cost };
    }
    const r = BatchSchema.safeParse(parsed);
    if (!r.success) return { ok: false, error: `invalid proposal JSON: ${r.error.issues.map((i) => i.message).join("; ")}`, costUsd6: cost };
    return { ok: true, summary: r.data.summary, proposals: r.data.intents, costUsd6: cost, model: res.model };
  }
}

/** Deterministic stand-in for tests and the anvil demo (spec §6: agent loop with a fixed-output LLM). */
export class FixedProposer implements Proposer {
  constructor(private readonly batch: Batch) {}

  async propose(): Promise<ProposerOutput> {
    return { ok: true, summary: this.batch.summary, proposals: this.batch.intents, costUsd6: 0n, model: "fixed" };
  }
}
```

`defaultCreate` constructs the SDK client lazily inside `ClaudeProposer`, so tests that pass `create` never need `ANTHROPIC_API_KEY`.

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (13 new); `tsc` clean.

- [ ] **Step 5: Live smoke (optional, costs about one cent)**

Only if `ANTHROPIC_API_KEY` is set (or `ant auth status` shows a profile). This is the only step in the plan that calls the paid API; skip it when no key is configured and say so in the task report.

`agent/scripts/smoke-claude.ts`:

```ts
import { readVaultState } from "../src/chain/state.js";
import { ClaudeProposer } from "../src/llm/proposer.js";
import { evaluatePolicy } from "../src/policy.js";
import { VAULT, standardScene } from "../test/fakes/fakeChain.js";

const state = await readVaultState(standardScene().client(), VAULT);
const policy = evaluatePolicy(state, { dailyComputeUsd6: 500_000n, unpaidUsd6: 0n });
const out = await new ClaudeProposer({ model: "claude-sonnet-5-5" }).propose({ state, policy, billUsd6: 0n });
console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
```

Run: `npx tsx scripts/smoke-claude.ts`
Expected: `"ok": true` and up to three BUY proposals near $23.33. If the API returns 400 on `fallbacks` or `output_config`, fix the request to what the error says, keep the unit test in step with it, and record the change in the task report.

- [ ] **Step 6: Commit**

```bash
git add agent/src/llm agent/test/schema.test.ts agent/test/prompt.test.ts agent/test/proposer.test.ts agent/scripts/smoke-claude.ts
git commit -m "feat(agent): Claude proposer with structured output, fallbacks and schema validation"
```

---
### Task 8: Builder Code suffix and the guarded sender

**Files:**
- Create: `agent/src/exec/builderCode.ts`
- Create: `agent/src/exec/calls.ts`
- Create: `agent/src/exec/sender.ts`
- Test: `agent/test/builderCode.test.ts`, `agent/test/sender.test.ts`
- Create: `agent/test/fakes/fakeSender.ts` (reused by Tasks 10 and 12)

**Interfaces:**
- Consumes: `mandateVaultAbi` (Task 1); `OnchainIntent` (Task 1).
- Produces:
  - `src/exec/builderCode.ts`: `BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/`, `builderSuffix(code: string): Hex`, `withSuffix(data: Hex, suffix: Hex): Hex`, `codesIn(input: Hex): readonly string[]`.
  - `src/exec/calls.ts`: `encodeExecute(i: OnchainIntent): Hex`, `encodeSyncMultiplier(token: Address): Hex`.
  - `src/exec/sender.ts`:
    - `interface TxRequest { to: Address; data: Hex; idempotencyKey: string }`
    - `interface TxSender { readonly address: Address; send(tx: TxRequest): Promise<Hex> }`
    - `class SendRefused extends Error`
    - `ALLOWED_FUNCTIONS = ["execute", "syncMultiplier", "notifyRevenue"] as const`
    - `class GuardedSender implements TxSender { constructor(inner: TxSender, opts: { vault: Address; suffix: Hex }) }`
    - `class RpcSender implements TxSender { constructor(wallet: WalletClient, address: Address) }` — sends with `eth_sendTransaction` from an account the node holds (anvil's unlocked dev accounts). For local fork tests only; it never sees a private key.
  - `test/fakes/fakeSender.ts`: `class FakeSender implements TxSender { sent: TxRequest[]; fail?: Error }` returning hash `0x` + index padded to 32 bytes.

**Builder Code facts** (research/06-builder-codes.md, tested 2026-11-06):
- ERC-8021 schema 0 suffix = `utf8(codes joined by ",") ‖ length (1 byte) ‖ 0x00 (schema id) ‖ 0x80218021802180218021802180218021`. The hex example in the Base docs puts the length byte first, which is wrong. Generate with `ox` and never copy the docs hex.
- Helper: `Attribution.toDataSuffix({ codes: [code] })` from `ox/erc8021` (ox ≥ 0.9.11). viem does not re-export it, so install `ox`.
- Test vector: `bc_a1b2c3d4` → `0x62635f61316232633364340b0080218021802180218021802180218021`.
- Codes must match `^[a-z0-9_]{1,32}$` (the onchain registry rejects uppercase).
- Solidity ignores trailing calldata for `execute((bytes32,uint8,address,uint256,uint256,address,bytes32))`, `syncMultiplier(address)` and `notifyRevenue()`; this was tested in Foundry with solc 0.8.28.
- Native `cdp.evm.sendTransaction` has no `dataSuffix` option, so the suffix is appended to `data` before the sender sees it. `GuardedSender` is the single place that does this. Every transaction the agent sends goes through it: `execute`, `syncMultiplier` and the CLI's `notifyRevenue`.

**Guard rules (`GuardedSender.send`)**, applied before the inner sender is called:
1. `to` must equal `opts.vault` (checksum compare). Otherwise throw `SendRefused("target X is not the vault")`.
2. `data` must decode with `mandateVaultAbi` to one of `ALLOWED_FUNCTIONS`. Otherwise throw `SendRefused("function F is not allowed")`, or `SendRefused("calldata does not decode")` when decoding fails.
3. Forward `{ to, data: withSuffix(data, suffix), idempotencyKey }`.

These rules mirror the CDP policy (Task 9) in code, so a dry run, an anvil run and a live run all refuse the same things. Owner functions such as `withdraw` or `setExecutor` would revert onchain anyway (`NotOwner`), but refusing them here means no gas is spent and nothing reaches CDP.

- [ ] **Step 1: Install ox**

```bash
cd agent
npm install --save-exact ox
npm ls viem ox
```

Expected: `ox` ≥ 1.0 and viem ≥ 2.57.12. If viem is older, run `npm install --save-exact viem@latest`; earlier versions can drop a suffix on some sends (research/06 §4).

- [ ] **Step 2: Write the failing tests**

`agent/test/builderCode.test.ts`:

```ts
import { concat, size } from "viem";
import { describe, expect, it } from "vitest";
import { builderSuffix, codesIn, withSuffix } from "../src/exec/builderCode.js";
import { encodeSyncMultiplier } from "../src/exec/calls.js";

const VECTOR = "0x62635f61316232633364340b0080218021802180218021802180218021";

describe("builder code", () => {
  it("matches the ERC-8021 schema-0 test vector", () => {
    expect(builderSuffix("bc_a1b2c3d4")).toBe(VECTOR);
    expect(size(VECTOR)).toBe(29);
  });
  it("rejects codes the registry would reject", () => {
    expect(() => builderSuffix("BC_UPPER")).toThrow(/invalid builder code/);
    expect(() => builderSuffix("")).toThrow(/invalid builder code/);
    expect(() => builderSuffix("a".repeat(33))).toThrow(/invalid builder code/);
    expect(() => builderSuffix("bc_a,b")).toThrow(/invalid builder code/);
  });
  it("round-trips through calldata", () => {
    const data = encodeSyncMultiplier("0xb20000000000000000000078ee7ce2fE4908108C");
    const tagged = withSuffix(data, builderSuffix("bc_a1b2c3d4"));
    expect(tagged).toBe(concat([data, VECTOR]));
    expect(codesIn(tagged)).toEqual(["bc_a1b2c3d4"]);
  });
  it("finds no code in plain calldata", () => {
    expect(codesIn(encodeSyncMultiplier("0xb20000000000000000000078ee7ce2fE4908108C"))).toEqual([]);
    expect(codesIn("0x")).toEqual([]);
  });
});
```

`agent/test/fakes/fakeSender.ts`:

```ts
import { pad, toHex, type Address, type Hex } from "viem";
import type { TxRequest, TxSender } from "../../src/exec/sender.js";

export class FakeSender implements TxSender {
  sent: TxRequest[] = [];
  fail: Error | undefined;

  constructor(readonly address: Address = "0x2222222222222222222222222222222222222222") {}

  async send(tx: TxRequest): Promise<Hex> {
    if (this.fail) throw this.fail;
    this.sent.push(tx);
    return pad(toHex(this.sent.length), { size: 32 });
  }
}
```

`agent/test/sender.test.ts`:

```ts
import { encodeFunctionData } from "viem";
import { describe, expect, it } from "vitest";
import { mandateVaultAbi } from "../src/abi/index.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { encodeExecute, encodeSyncMultiplier } from "../src/exec/calls.js";
import { GuardedSender, SendRefused } from "../src/exec/sender.js";
import type { OnchainIntent } from "../src/types.js";
import { FakeSender } from "./fakes/fakeSender.js";

const VAULT = "0x1111111111111111111111111111111111111111" as const;
const suffix = builderSuffix("bc_maattest");
const intent: OnchainIntent = {
  id: `0x${"11".repeat(32)}`,
  action: 0,
  token: "0xb20000000000000000000078ee7ce2fE4908108C",
  amount: 20_000_000n,
  minOut: 0n,
  payee: "0x0000000000000000000000000000000000000000",
  rationaleHash: `0x${"22".repeat(32)}`,
};

describe("GuardedSender", () => {
  it("appends the Builder Code to execute and syncMultiplier", async () => {
    const inner = new FakeSender();
    const g = new GuardedSender(inner, { vault: VAULT, suffix });
    await g.send({ to: VAULT, data: encodeExecute(intent), idempotencyKey: "k1" });
    await g.send({ to: VAULT, data: encodeSyncMultiplier(intent.token), idempotencyKey: "k2" });
    expect(inner.sent.map((t) => codesIn(t.data))).toEqual([["bc_maattest"], ["bc_maattest"]]);
    expect(inner.sent.map((t) => t.idempotencyKey)).toEqual(["k1", "k2"]);
    expect(g.address).toBe(inner.address);
  });

  it("compares the vault address case-insensitively", async () => {
    const inner = new FakeSender();
    const checksummed = "0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD" as const;
    await new GuardedSender(inner, { vault: checksummed, suffix }).send({ to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd", data: encodeExecute(intent), idempotencyKey: "k" });
    expect(inner.sent).toHaveLength(1);
  });

  it("refuses another target", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ to: "0x9999999999999999999999999999999999999999", data: encodeExecute(intent), idempotencyKey: "k" })).rejects.toBeInstanceOf(SendRefused);
  });

  it("refuses owner functions", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    const data = encodeFunctionData({ abi: mandateVaultAbi, functionName: "withdraw", args: [intent.token, 1n] });
    await expect(g.send({ to: VAULT, data, idempotencyKey: "k" })).rejects.toThrow(/function withdraw is not allowed/);
  });

  it("refuses calldata that does not decode", async () => {
    const g = new GuardedSender(new FakeSender(), { vault: VAULT, suffix });
    await expect(g.send({ to: VAULT, data: "0xdeadbeef", idempotencyKey: "k" })).rejects.toThrow(/does not decode/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/builderCode.test.ts test/sender.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`agent/src/exec/builderCode.ts`:

```ts
import { Attribution } from "ox/erc8021";
import { concat, type Hex } from "viem";

/** Same rule as the Builder Codes registry (research/06-builder-codes.md §1). */
export const BUILDER_CODE_RE = /^[a-z0-9_]{1,32}$/;

/** ERC-8021 schema-0 suffix. Generated with ox: the hex example in Base's docs has the bytes in the wrong order. */
export function builderSuffix(code: string): Hex {
  if (!BUILDER_CODE_RE.test(code)) throw new Error(`invalid builder code "${code}"`);
  return Attribution.toDataSuffix({ codes: [code] }) as Hex;
}

export function withSuffix(data: Hex, suffix: Hex): Hex {
  return concat([data, suffix]);
}

export function codesIn(input: Hex): readonly string[] {
  try {
    const a = Attribution.fromData(input) as { codes?: readonly string[] } | undefined;
    return a?.codes ?? [];
  } catch {
    return [];
  }
}
```

`agent/src/exec/calls.ts`:

```ts
import { encodeFunctionData, type Address, type Hex } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import type { OnchainIntent } from "../types.js";

export function encodeExecute(i: OnchainIntent): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "execute", args: [i] });
}

export function encodeSyncMultiplier(token: Address): Hex {
  return encodeFunctionData({ abi: mandateVaultAbi, functionName: "syncMultiplier", args: [token] });
}
```

`agent/src/exec/sender.ts`:

```ts
import { decodeFunctionData, getAddress, type Address, type Hex, type WalletClient } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { withSuffix } from "./builderCode.js";

export interface TxRequest {
  to: Address;
  data: Hex;
  idempotencyKey: string;
}

export interface TxSender {
  readonly address: Address;
  send(tx: TxRequest): Promise<Hex>;
}

export class SendRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SendRefused";
  }
}

export const ALLOWED_FUNCTIONS = ["execute", "syncMultiplier", "notifyRevenue"] as const;

/** The only path to a sender: vault-only, allowlisted functions, Builder Code on every transaction. */
export class GuardedSender implements TxSender {
  constructor(
    private readonly inner: TxSender,
    private readonly opts: { vault: Address; suffix: Hex },
  ) {}

  get address(): Address {
    return this.inner.address;
  }

  async send(tx: TxRequest): Promise<Hex> {
    if (getAddress(tx.to) !== getAddress(this.opts.vault)) throw new SendRefused(`target ${tx.to} is not the vault`);
    let fn: string;
    try {
      fn = decodeFunctionData({ abi: mandateVaultAbi, data: tx.data }).functionName;
    } catch {
      throw new SendRefused("calldata does not decode against the MandateVault ABI");
    }
    if (!(ALLOWED_FUNCTIONS as readonly string[]).includes(fn)) throw new SendRefused(`function ${fn} is not allowed`);
    return this.inner.send({ ...tx, data: withSuffix(tx.data, this.opts.suffix) });
  }
}

/** eth_sendTransaction from an account the node unlocks (anvil dev accounts). Local fork tests only. */
export class RpcSender implements TxSender {
  constructor(
    private readonly wallet: WalletClient,
    readonly address: Address,
  ) {}

  async send(tx: TxRequest): Promise<Hex> {
    return this.wallet.sendTransaction({ account: this.address, chain: this.wallet.chain ?? null, to: tx.to, data: tx.data, value: 0n });
  }
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (9 new); `tsc` clean. If ox's `toDataSuffix` returns a different type name, keep the `as Hex` cast; the test vector is the contract.

- [ ] **Step 6: Commit**

```bash
git add agent/package.json agent/package-lock.json agent/src/exec agent/test/builderCode.test.ts agent/test/sender.test.ts agent/test/fakes/fakeSender.ts
git commit -m "feat(agent): ERC-8021 Builder Code suffix and vault-only guarded sender"
```

---

### Task 9: CDP Server Wallet executor and its policy

**Files:**
- Create: `agent/src/exec/cdpSender.ts`
- Create: `agent/src/exec/cdpPolicy.ts`
- Create: `agent/scripts/cdp-setup.ts`
- Test: `agent/test/cdpSender.test.ts`, `agent/test/cdpPolicy.test.ts`

**Interfaces:**
- Consumes: `TxSender`, `TxRequest` (Task 8).
- Produces:
  - `src/exec/cdpSender.ts`:
    - `interface CdpLike { evm: { getAccount(o: { name: string }): Promise<{ address: Address }>; sendTransaction(o: { address: Address; network: "base"; transaction: { to: Address; data: Hex; value: bigint }; idempotencyKey?: string }): Promise<{ transactionHash: Hex }> } }`
    - `uuidFromKey(key: string): string`
    - `class CdpSender implements TxSender { static connect(opts: { accountName: string; expectedAddress: Address; cdp?: CdpLike }): Promise<CdpSender> }`
  - `src/exec/cdpPolicy.ts`: `executorPolicy(vault: Address): { scope: "account"; description: string; rules: unknown[] }`.
  - `scripts/cdp-setup.ts`: a one-off for the owner (the human) to run. It is not imported by the runtime.

**CDP facts** (research/05-cdp-server-wallet.md, `@coinbase/cdp-sdk` 1.61.0):
- `new CdpClient()` reads `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`. Every write needs the Wallet Secret.
- Use `cdp.evm.sendTransaction({ address, network: "base", transaction: { to, data, value }, idempotencyKey })`. It returns `{ transactionHash }` once the tx is broadcast, not mined. CDP fills nonce, gas and fees. The network string is `"base"`; the REST name `"base-mainnet"` is rejected.
- The SDK retries with axios-retry, so always pass `idempotencyKey`. Reuse the same key when retrying the same logical tx.
- Policy: `cdp.policies.createPolicy({ policy })` and `cdp.evm.updateAccount({ address, update: { accountPolicy: id } })`. A rule set that only accepts makes its operation default-deny. `evmData` does not support tuple arguments, and there is no daily cap. The vault's caps plus `MAAT_MAX_TX_PER_DAY` (Task 10) are the cumulative limits.
- CDP has no `eth_call`. Previews go through the RPC with `account: executor` (Task 5).
- The EOA pays gas in ETH on Base; the paymaster only works for smart accounts. A smart account would also change `msg.sender`, and the vault's `executor` is one fixed address.

**Runtime rule:** `CdpSender.connect` uses `getAccount({ name })`, never `getOrCreateAccount`. Creating an account is a setup step the owner runs once (`scripts/cdp-setup.ts`). The runtime then fails loudly when the named account is missing or its address differs from `MAAT_EXECUTOR`, so the vault's `executor` and the signing key can never silently diverge.

**Idempotency key:** CDP's key format is not documented beyond being a string, and the SDK's own examples use `crypto.randomUUID()`. `uuidFromKey` formats `keccak256(key)` as a v4-shaped UUID: the same key always maps to the same UUID, and the output is 36 characters.

**Policy** (`executorPolicy(vault)`):

```ts
{
  scope: "account",
  description: "Maat executor: MandateVault calls on Base only",
  rules: [
    {
      action: "accept",
      operation: "sendEvmTransaction",
      criteria: [
        { type: "evmNetwork", networks: ["base"], operator: "in" },
        { type: "evmAddress", addresses: [vault], operator: "in" },
        { type: "ethValue", ethValue: "0", operator: "<=" },
      ],
    },
    {
      action: "accept",
      operation: "signEvmTransaction",
      criteria: [
        { type: "evmAddress", addresses: [vault], operator: "in" },
        { type: "ethValue", ethValue: "0", operator: "<=" },
      ],
    },
    { action: "reject", operation: "signEvmHash", criteria: [] },
  ],
}
```

The `signEvmTransaction` rule matters even though the runtime only uses `sendEvmTransaction`: without it, signing raw transactions would stay default-allow.

- [ ] **Step 1: Install the SDK**

```bash
cd agent
npm install --save-exact @coinbase/cdp-sdk
```

Expected: `@coinbase/cdp-sdk@1.61.0` or newer. Node must be ≥ 20.19 because `jose` v6 is ESM-only; the repo uses Node 24.

- [ ] **Step 2: Write the failing tests**

`agent/test/cdpSender.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CdpSender, uuidFromKey, type CdpLike } from "../src/exec/cdpSender.js";

const EXEC = "0x2222222222222222222222222222222222222222" as const;
const VAULT = "0x1111111111111111111111111111111111111111" as const;

function fakeCdp(address: string = EXEC) {
  const sent: unknown[] = [];
  const cdp: CdpLike = {
    evm: {
      getAccount: async ({ name }) => {
        if (name !== "maat-executor") throw new Error("account not found");
        return { address: address as `0x${string}` };
      },
      sendTransaction: async (o) => (sent.push(o), { transactionHash: `0x${"ab".repeat(32)}` }),
    },
  };
  return { cdp, sent };
}

describe("CdpSender", () => {
  it("connects to the named account and checks its address", async () => {
    const { cdp } = fakeCdp();
    const s = await CdpSender.connect({ accountName: "maat-executor", expectedAddress: EXEC, cdp });
    expect(s.address).toBe(EXEC);
  });
  it("refuses an account whose address is not MAAT_EXECUTOR", async () => {
    const { cdp } = fakeCdp("0x9999999999999999999999999999999999999999");
    await expect(CdpSender.connect({ accountName: "maat-executor", expectedAddress: EXEC, cdp })).rejects.toThrow(/does not match MAAT_EXECUTOR/);
  });
  it("never creates an account", async () => {
    const { cdp } = fakeCdp();
    await expect(CdpSender.connect({ accountName: "other", expectedAddress: EXEC, cdp })).rejects.toThrow(/account not found/);
  });
  it("sends on base with zero value and a stable idempotency key", async () => {
    const { cdp, sent } = fakeCdp();
    const s = await CdpSender.connect({ accountName: "maat-executor", expectedAddress: EXEC, cdp });
    const hash = await s.send({ to: VAULT, data: "0x1234", idempotencyKey: "intent-1" });
    expect(hash).toBe(`0x${"ab".repeat(32)}`);
    expect(sent[0]).toEqual({
      address: EXEC,
      network: "base",
      transaction: { to: VAULT, data: "0x1234", value: 0n },
      idempotencyKey: uuidFromKey("intent-1"),
    });
  });
  it("formats keys as deterministic v4-shaped UUIDs", () => {
    const u = uuidFromKey("intent-1");
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromKey("intent-1")).toBe(u);
    expect(uuidFromKey("intent-2")).not.toBe(u);
  });
});
```

`agent/test/cdpPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { executorPolicy } from "../src/exec/cdpPolicy.js";

describe("executorPolicy", () => {
  const p = executorPolicy("0x1111111111111111111111111111111111111111");
  it("is account-scoped", () => expect(p.scope).toBe("account"));
  it("only accepts zero-value vault calls on base", () => {
    expect(p.rules[0]).toEqual({
      action: "accept",
      operation: "sendEvmTransaction",
      criteria: [
        { type: "evmNetwork", networks: ["base"], operator: "in" },
        { type: "evmAddress", addresses: ["0x1111111111111111111111111111111111111111"], operator: "in" },
        { type: "ethValue", ethValue: "0", operator: "<=" },
      ],
    });
  });
  it("closes raw signing paths", () => {
    expect(p.rules.map((r) => (r as { operation: string }).operation)).toEqual(["sendEvmTransaction", "signEvmTransaction", "signEvmHash"]);
    expect(p.rules[2]).toEqual({ action: "reject", operation: "signEvmHash", criteria: [] });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/cdpSender.test.ts test/cdpPolicy.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

`agent/src/exec/cdpSender.ts`:

```ts
import { getAddress, keccak256, toBytes, type Address, type Hex } from "viem";
import type { TxRequest, TxSender } from "./sender.js";

/** The slice of CdpClient the runtime uses (research/05 §3-4). Tests pass a fake. */
export interface CdpLike {
  evm: {
    getAccount(o: { name: string }): Promise<{ address: Address }>;
    sendTransaction(o: {
      address: Address;
      network: "base";
      transaction: { to: Address; data: Hex; value: bigint };
      idempotencyKey?: string;
    }): Promise<{ transactionHash: Hex }>;
  };
}

/** Deterministic, v4-shaped UUID from any string key, so a retried send reuses its CDP idempotency key. */
export function uuidFromKey(key: string): string {
  const h = keccak256(toBytes(key)).slice(2, 34).split("");
  h[12] = "4";
  h[16] = "89ab"[parseInt(h[16]!, 16) & 3]!;
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

async function defaultCdp(): Promise<CdpLike> {
  const { CdpClient } = await import("@coinbase/cdp-sdk");
  return new CdpClient() as unknown as CdpLike; // reads CDP_API_KEY_ID / CDP_API_KEY_SECRET / CDP_WALLET_SECRET
}

export class CdpSender implements TxSender {
  private constructor(
    private readonly cdp: CdpLike,
    readonly address: Address,
  ) {}

  /** Looks the account up by name. Never creates one: that is scripts/cdp-setup.ts, run by the owner. */
  static async connect(opts: { accountName: string; expectedAddress: Address; cdp?: CdpLike }): Promise<CdpSender> {
    const cdp = opts.cdp ?? (await defaultCdp());
    const account = await cdp.evm.getAccount({ name: opts.accountName });
    if (getAddress(account.address) !== getAddress(opts.expectedAddress)) {
      throw new Error(`CDP account "${opts.accountName}" is ${account.address}, which does not match MAAT_EXECUTOR ${opts.expectedAddress}`);
    }
    return new CdpSender(cdp, getAddress(account.address));
  }

  async send(tx: TxRequest): Promise<Hex> {
    const { transactionHash } = await this.cdp.evm.sendTransaction({
      address: this.address,
      network: "base",
      transaction: { to: tx.to, data: tx.data, value: 0n },
      idempotencyKey: uuidFromKey(tx.idempotencyKey),
    });
    return transactionHash;
  }
}
```

`agent/src/exec/cdpPolicy.ts`:

```ts
import type { Address } from "viem";

/** CDP policy for the executor account (research/05 §6). Accept-only rules make each listed operation default-deny. */
export function executorPolicy(vault: Address) {
  return {
    scope: "account" as const,
    description: "Maat executor: MandateVault calls on Base only",
    rules: [
      {
        action: "accept",
        operation: "sendEvmTransaction",
        criteria: [
          { type: "evmNetwork", networks: ["base"], operator: "in" },
          { type: "evmAddress", addresses: [vault], operator: "in" },
          { type: "ethValue", ethValue: "0", operator: "<=" },
        ],
      },
      {
        action: "accept",
        operation: "signEvmTransaction",
        criteria: [
          { type: "evmAddress", addresses: [vault], operator: "in" },
          { type: "ethValue", ethValue: "0", operator: "<=" },
        ],
      },
      { action: "reject", operation: "signEvmHash", criteria: [] },
    ] as unknown[],
  };
}
```

`agent/scripts/cdp-setup.ts` is for the owner to run once. It talks to the user's CDP project, so implementers must never run it:

```ts
// One-off setup, run by the vault owner (not by CI or an agent):
//   node --env-file=.env --import tsx scripts/cdp-setup.ts 0xVaultAddress
// Creates (or finds) the named executor account, attaches the vault-only policy, prints the address.
import { CdpClient } from "@coinbase/cdp-sdk";
import { getAddress, isAddress } from "viem";
import { executorPolicy } from "../src/exec/cdpPolicy.js";

const vaultArg = process.argv[2];
if (!vaultArg || !isAddress(vaultArg)) {
  console.error("usage: cdp-setup.ts <vault address>");
  process.exit(1);
}
const vault = getAddress(vaultArg);
const name = process.env.CDP_ACCOUNT_NAME ?? "maat-executor";
const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name });
const policy = await cdp.policies.createPolicy({ policy: executorPolicy(vault) as never });
await cdp.evm.updateAccount({ address: account.address, update: { accountPolicy: policy.id } });
console.log(`executor account "${name}": ${account.address}`);
console.log(`policy ${policy.id} attached (vault ${vault}, Base only, zero value)`);
console.log("Next, from the owner wallet:");
console.log(`  1. MandateVault(${vault}).setExecutor(${account.address})`);
console.log(`  2. send ~0.002 ETH on Base to ${account.address} for gas`);
console.log(`  3. set MAAT_EXECUTOR=${account.address} in agent/.env`);
```

Then type-check the script without running it. The `as never` on the policy body is deliberate: `executorPolicy` is typed loosely so the unit test stays SDK-independent. If `tsc` reports a real mismatch with the SDK's `CreatePolicyBody` type, such as a renamed criterion field, fix `executorPolicy` and its test to the SDK's names. Do not widen the cast.

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (8 new); `tsc` clean, including `scripts/cdp-setup.ts`.

- [ ] **Step 6: Commit**

```bash
git add agent/package.json agent/package-lock.json agent/src/exec/cdpSender.ts agent/src/exec/cdpPolicy.ts agent/scripts/cdp-setup.ts agent/test/cdpSender.test.ts agent/test/cdpPolicy.test.ts
git commit -m "feat(agent): CDP Server Wallet executor with vault-only account policy"
```

---
### Task 10: The agent loop (`runOnce`)

**Files:**
- Create: `agent/src/loop/runOnce.ts`
- Create: `agent/test/fakes/fakeReceipts.ts`
- Test: `agent/test/runOnce.test.ts`

**Interfaces:**
- Consumes: everything above. Exact names:
  - `readVaultState`, `StateUnavailable`, `StateClient`, `VaultState` (Task 3)
  - `evaluatePolicy`, `DEFAULT_POLICY`, `PolicyParams` (Task 4)
  - `buildIntent`, `Proposal` (Task 5)
  - `previewIntent`, `PreviewClient` (Task 5)
  - `gate` (Task 5)
  - `Store` (Task 6)
  - `Journal` (Task 6)
  - `Proposer`, `FixedProposer` (Task 7)
  - `encodeExecute`, `encodeSyncMultiplier` (Task 8)
  - `TxSender`, `GuardedSender` (Task 8)
  - `builderSuffix`, `codesIn` (Task 8)
  - `REASONS`, `ReasonName`, `OnchainIntent` (Task 1)
  - `usdc6ToUsd` (Task 2)
  - test fakes: `FakeChain`, `standardScene`, `VAULT`, `EXECUTOR` (Task 3), `FakeSender` (Task 8)
- Produces:
  - `type ReceiptClient = Pick<PublicClient, "waitForTransactionReceipt">`
  - `BILL_MIN_USD6 = 100_000n` ($0.10)
  - `RECEIPT_TIMEOUT_MS = 120_000`
  - `interface RunDeps { vault: Address; executor: Address; expensePayee: Address; mode: "dry-run" | "live"; defaultDailyComputeUsd6: bigint; maxTxPerDay: number; stateClient: StateClient; previewClient: PreviewClient; receipts: ReceiptClient; proposer: Proposer; sender: TxSender | null; store: Store; journal: Pick<Journal, "append">; policy?: PolicyParams; runId?: string }`
  - `interface RunReport { runId: string; status: "no-state" | "wrong-executor" | "done" | "halted"; block?: bigint; marketOpen?: boolean | null; sent: Hex[]; skipped: number; proposals: number; haltReason?: string }`
  - `runOnce(d: RunDeps): Promise<RunReport>`

**The loop**, one call = one round (spec §3.5):

1. **Read** `readVaultState`. A `StateUnavailable` error means: journal `error`, return `no-state`, and do nothing else (spec §5: RPC down → no action). Other errors propagate, since they are bugs.
2. **Executor check:** `state.executor ≠ d.executor` → journal `error`, return `wrong-executor`. Every `execute` would revert `NotExecutor`. This catches "owner has not called `setExecutor` yet".
3. **Housekeeping (Plan 2A carry-over):** for each token with a market (`feed` or `pool` non-zero) whose readable `uiMultiplier ≠ lastMultiplier`, send `syncMultiplier(token)`. `execute()` only syncs the intent's own token, so a multiplier change on supplied collateral would otherwise go unrecorded before a BORROW. In dry-run, journal `housekeeping` with `note: "dry-run"` instead.
4. **Bill:** `unpaid = store.unpaidUsd6()`. When `unpaid ≥ BILL_MIN_USD6`, queue a deterministic PAY_EXPENSE proposal first, with `rationale = "Compute bill: $X of Claude API usage unpaid as of UTC day D"` (X to 6 decimals).
5. **Policy + Claude:** `evaluatePolicy(state, { dailyComputeUsd6: store.dailyComputeUsd6(day, d.defaultDailyComputeUsd6), unpaidUsd6: unpaid })`, then `proposer.propose(...)`. Always `store.recordCompute(day, out.costUsd6)`, even on failure, and journal a `run` row. On `ok: false` the queue is only the bill.
6. **Per proposal, in order:**
   - If any tx was sent since the last read, **re-read state** before building. Later proposals often depend on earlier ones (BUY → SUPPLY → BORROW). A re-read failure halts the run.
   - `buildIntent` → on error, journal `skip` and continue.
   - `previewIntent` with `account: executor` at latest, then `gate(preview, store.hasLoggedRefusal(day, preview))`.
   - Not sent (gate says no, or dry-run): journal `intent` with `gate` = the reason (`"dry-run: would execute"` / `"dry-run: would log-refusal"` in dry-run), and count it in `skipped`.
   - Sent: `sendAndWait(encodeExecute(intent), key = intent.id)`, then parse the `Decision` log for this `intentId`.
     - `log-refusal` → `store.recordRefusalLog(day, preview)`.
     - PAY_EXPENSE with `allowed` → `store.recordPaid(intent.amount)`.
     - Journal `intent` with `txHash` and `decision`.
7. **`sendAndWait`:** if `store.txCount(day) ≥ maxTxPerDay`, halt with `daily tx cap N reached`. Otherwise `sender.send`, `store.recordTx(day)`, push the hash to `report.sent`, and `waitForTransactionReceipt({ hash, timeout })`. A receipt status other than `success` halts with `tx H reverted`.
8. **Halting:** any error inside steps 3–7 (sender error, `SendRefused`, receipt timeout or revert, tx cap, state re-read failure) stops the round. The state after an uncertain tx is unknown, so nothing else is attempted. It journals `error` and returns `status: "halted"` with `haltReason`. Intent ids are unique per run, so the next round never re-sends the same intent.
9. **Always** `store.save()` (in `finally`).

`day` is the chain's `state.day` (block timestamp / 86400, same as `MandateVault.today()`), not the host clock. Refusal rate-limits, bills and tx caps therefore agree with the vault's day.

- [ ] **Step 1: Write the receipt fake**

`agent/test/fakes/fakeReceipts.ts` stands in for the chain's half of a send. It decodes what `FakeSender` recorded, after stripping the Builder Code suffix, and emits a `Decision` log for `execute` calls. Its `verdict` is the vault's answer:

```ts
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  size,
  slice,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { mandateVaultAbi } from "../../src/abi/index.js";
import type { ReceiptClient } from "../../src/loop/runOnce.js";
import type { OnchainIntent } from "../../src/types.js";
import type { FakeSender } from "./fakeSender.js";

export class FakeReceipts {
  status: "success" | "reverted" = "success";
  verdict: (i: OnchainIntent) => { allowed: boolean; reason: number } = () => ({ allowed: true, reason: 0 });

  constructor(
    private readonly sender: FakeSender,
    private readonly vault: Address,
    private readonly suffixSize: number,
  ) {}

  /** The calls the vault received, Builder Code stripped. */
  calls() {
    return this.sender.sent.map((t) => decodeFunctionData({ abi: mandateVaultAbi, data: slice(t.data, 0, size(t.data) - this.suffixSize) }));
  }

  client(): ReceiptClient {
    return {
      waitForTransactionReceipt: (async ({ hash }: { hash: Hex }) => {
        const call = this.calls()[Number(hash) - 1]!;
        const logs = [];
        if (call.functionName === "execute") {
          const i = call.args[0] as OnchainIntent;
          const v = this.verdict(i);
          logs.push({
            address: this.vault,
            topics: encodeEventTopics({ abi: mandateVaultAbi, eventName: "Decision", args: { intentId: i.id, token: i.token } }),
            data: encodeAbiParameters(parseAbiParameters("uint8, uint256, bool, uint8, bytes32"), [i.action, i.amount, v.allowed, v.reason, i.rationaleHash]),
            blockNumber: 1n,
            blockHash: `0x${"00".repeat(32)}`,
            transactionHash: hash,
            transactionIndex: 0,
            logIndex: 0,
            removed: false,
          });
        }
        return { status: this.status, transactionHash: hash, logs } as unknown as TransactionReceipt;
      }) as ReceiptClient["waitForTransactionReceipt"],
    };
  }
}
```

- [ ] **Step 2: Write the failing tests**

`agent/test/runOnce.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { size } from "viem";
import { describe, expect, it } from "vitest";
import { addressOf } from "../src/addresses.js";
import { builderSuffix, codesIn } from "../src/exec/builderCode.js";
import { GuardedSender } from "../src/exec/sender.js";
import { Journal } from "../src/ledger/journal.js";
import { Store } from "../src/ledger/store.js";
import { FixedProposer, type Proposer } from "../src/llm/proposer.js";
import type { Batch } from "../src/llm/schema.js";
import { runOnce, type RunDeps } from "../src/loop/runOnce.js";
import type { OnchainIntent } from "../src/types.js";
import { EXECUTOR, VAULT, standardScene, type FakeChain } from "./fakes/fakeChain.js";
import { FakeReceipts } from "./fakes/fakeReceipts.js";
import { FakeSender } from "./fakes/fakeSender.js";

const PAYEE = "0x3333333333333333333333333333333333333333" as const;
const SUFFIX = builderSuffix("bc_maattest");
const DAY = 1_794_000_000n / 86_400n;
const BUY20: Batch = { summary: "buy", intents: [{ action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "underweight" }] };

async function setup(o: { mode?: "dry-run" | "live"; batch?: Batch; proposer?: Proposer; preview?: (i: OnchainIntent) => number | Promise<number>; scene?: FakeChain; store?: Store; maxTxPerDay?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "maat-run-"));
  const scene = o.scene ?? standardScene();
  const store = o.store ?? (await Store.open(dir));
  const journal = new Journal(dir);
  const inner = new FakeSender(EXECUTOR);
  const receipts = new FakeReceipts(inner, VAULT, size(SUFFIX));
  const previews: OnchainIntent[] = [];
  let reads = 0;
  const stateClient = scene.client();
  const getBlock = stateClient.getBlock;
  stateClient.getBlock = ((...a: Parameters<typeof getBlock>) => (reads++, getBlock(...a))) as typeof getBlock;
  const deps: RunDeps = {
    vault: VAULT,
    executor: EXECUTOR,
    expensePayee: PAYEE,
    mode: o.mode ?? "live",
    defaultDailyComputeUsd6: 500_000n,
    maxTxPerDay: o.maxTxPerDay ?? 40,
    stateClient,
    previewClient: {
      readContract: (async (p: { args: readonly [OnchainIntent] }) => (previews.push(p.args[0]), (o.preview ?? (() => 0))(p.args[0]))) as never,
    },
    receipts: receipts.client(),
    proposer: o.proposer ?? new FixedProposer(o.batch ?? { summary: "hold", intents: [] }),
    sender: (o.mode ?? "live") === "live" ? new GuardedSender(inner, { vault: VAULT, suffix: SUFFIX }) : null,
    store,
    journal,
    runId: "run-1",
  };
  return { dir, deps, inner, receipts, store, journal, scene, previews, reads: () => reads };
}

describe("runOnce", () => {
  it("does nothing when the vault state is unavailable", async () => {
    let asked = 0;
    const t = await setup({ scene: standardScene().fail(VAULT, "mandate"), proposer: { propose: async () => (asked++, { ok: false, error: "x", costUsd6: 0n }) } });
    const r = await runOnce(t.deps);
    expect(r.status).toBe("no-state");
    expect(asked).toBe(0);
    expect(t.inner.sent).toEqual([]);
    expect((await t.journal.read()).at(-1)).toMatchObject({ kind: "error" });
  });

  it("stops when the vault's executor is someone else", async () => {
    const t = await setup({ batch: BUY20, scene: standardScene().set(VAULT, "executor", "0x9999999999999999999999999999999999999999") });
    expect((await runOnce(t.deps)).status).toBe("wrong-executor");
    expect(t.inner.sent).toEqual([]);
  });

  it("dry-run previews and journals but never sends", async () => {
    const t = await setup({ mode: "dry-run", batch: BUY20 });
    const r = await runOnce(t.deps);
    expect(r).toMatchObject({ status: "done", sent: [], skipped: 1, proposals: 1 });
    expect(t.previews).toHaveLength(1);
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ preview: "OK", gate: "dry-run: would execute" });
    expect(existsSync(join(t.dir, "state.json"))).toBe(true);
  });

  it("executes an allowed intent with the Builder Code and records the Decision", async () => {
    const t = await setup({ batch: BUY20 });
    const r = await runOnce(t.deps);
    expect(r.status).toBe("done");
    expect(r.sent).toHaveLength(1);
    expect(codesIn(t.inner.sent[0]!.data)).toEqual(["bc_maattest"]);
    expect(t.receipts.calls()[0]?.functionName).toBe("execute");
    expect(t.previews[0]).toMatchObject({ action: 0, token: addressOf("NVDAc"), amount: 20_000_000n });
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ gate: "execute", decision: { allowed: true, reason: "OK" } });
    expect(t.store.txCount(DAY)).toBe(1);
  });

  it("logs a market refusal onchain once per day", async () => {
    const t = await setup({ batch: BUY20, preview: () => 6 });
    t.receipts.verdict = () => ({ allowed: false, reason: 6 });
    expect((await runOnce(t.deps)).sent).toHaveLength(1);
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ preview: "MARKET_CLOSED", gate: "log-refusal", decision: { allowed: false, reason: "MARKET_CLOSED" } });
    const again = await runOnce({ ...t.deps, runId: "run-2" });
    expect(again.sent).toEqual([]);
    expect((await t.journal.read()).filter((e) => e.kind === "intent").at(-1)).toMatchObject({ gate: "MARKET_CLOSED already logged today" });
  });

  it("does not spend gas on a bookkeeping refusal", async () => {
    const t = await setup({ batch: BUY20, preview: () => 14 });
    expect((await runOnce(t.deps)).sent).toEqual([]);
  });

  it("does nothing for an intent whose preview is unknown", async () => {
    const t = await setup({ batch: BUY20, preview: () => Promise.reject(new Error("rpc")) });
    expect((await runOnce(t.deps)).sent).toEqual([]);
    expect((await t.journal.read()).find((e) => e.kind === "intent")).toMatchObject({ preview: "UNKNOWN", gate: "guard state unknown (RPC)" });
  });

  it("pays the compute bill first and marks it paid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "maat-run-"));
    const store = await Store.open(dir);
    store.recordCompute(DAY - 1n, 300_000n);
    const t = await setup({ batch: BUY20, store });
    await runOnce(t.deps);
    const [first, second] = t.receipts.calls();
    expect(first?.functionName).toBe("execute");
    expect(first?.args[0]).toMatchObject({ action: 6, amount: 300_000n, payee: PAYEE });
    expect(second?.args[0]).toMatchObject({ action: 0 });
    expect(store.unpaidUsd6()).toBe(0n);
  });

  it("bills a failed Claude call and still settles bills", async () => {
    const t = await setup({ proposer: { propose: async () => ({ ok: false, error: "invalid proposal JSON: x", costUsd6: 30_000n }) } });
    const r = await runOnce(t.deps);
    expect(r.sent).toEqual([]);
    expect(t.store.unpaidUsd6()).toBe(30_000n);
    expect((await t.journal.read()).find((e) => e.kind === "run")).toMatchObject({ ok: false, error: "invalid proposal JSON: x", costUsd6: "30000" });
  });

  it("syncs a changed multiplier before trading", async () => {
    const t = await setup({ batch: BUY20, scene: standardScene().set(addressOf("NVDAc"), "uiMultiplier", 2n * 10n ** 18n) });
    await runOnce(t.deps);
    expect(t.receipts.calls().map((c) => c.functionName)).toEqual(["syncMultiplier", "execute"]);
    expect(codesIn(t.inner.sent[0]!.data)).toEqual(["bc_maattest"]);
  });

  it("re-reads state after each transaction", async () => {
    const t = await setup({ batch: { summary: "two", intents: [BUY20.intents[0]!, { ...BUY20.intents[0]!, symbol: "AAPLc" }] } });
    await runOnce(t.deps);
    expect(t.inner.sent).toHaveLength(2);
    expect(t.reads()).toBe(2); // initial read + one before the second intent
  });

  it("halts the round when a send fails", async () => {
    const t = await setup({ batch: { summary: "two", intents: [BUY20.intents[0]!, { ...BUY20.intents[0]!, symbol: "AAPLc" }] } });
    t.inner.fail = new Error("cdp 500");
    const r = await runOnce(t.deps);
    expect(r.status).toBe("halted");
    expect(r.haltReason).toMatch(/cdp 500/);
    expect(t.previews).toHaveLength(1);
    expect(existsSync(join(t.dir, "state.json"))).toBe(true);
  });

  it("halts the round on a reverted receipt", async () => {
    const t = await setup({ batch: { summary: "two", intents: [BUY20.intents[0]!, { ...BUY20.intents[0]!, symbol: "AAPLc" }] } });
    t.receipts.status = "reverted";
    const r = await runOnce(t.deps);
    expect(r).toMatchObject({ status: "halted" });
    expect(r.sent).toHaveLength(1);
  });

  it("respects the daily tx cap", async () => {
    const t = await setup({ batch: BUY20, maxTxPerDay: 0 });
    const r = await runOnce(t.deps);
    expect(r).toMatchObject({ status: "halted", haltReason: "daily tx cap 0 reached", sent: [] });
  });

  it("skips an invalid proposal and continues", async () => {
    const t = await setup({ batch: { summary: "x", intents: [{ action: "BORROW", symbol: "NVDAc", amountUsd: 5, rationale: "r" }, BUY20.intents[0]!] } });
    const r = await runOnce(t.deps);
    expect(r.sent).toHaveLength(1);
    expect((await t.journal.read()).find((e) => e.kind === "skip")).toMatchObject({ error: "symbol NVDAc does not fit BORROW" });
  });
});
```

`standardScene` puts `uiMultiplier` and `lastMultiplier` both at 1e18, so no housekeeping happens unless a test changes one of them.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/runOnce.test.ts`
Expected: FAIL, `src/loop/runOnce.js` not found.

- [ ] **Step 4: Implement `src/loop/runOnce.ts`**

```ts
import { randomUUID } from "node:crypto";
import { getAddress, parseEventLogs, zeroAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { mandateVaultAbi } from "../abi/index.js";
import { previewIntent, type PreviewClient } from "../chain/preview.js";
import { readVaultState, StateUnavailable, type StateClient, type VaultState } from "../chain/state.js";
import { encodeExecute, encodeSyncMultiplier } from "../exec/calls.js";
import type { TxSender } from "../exec/sender.js";
import { buildIntent, type Proposal } from "../intent.js";
import type { Journal } from "../ledger/journal.js";
import type { Store } from "../ledger/store.js";
import type { Proposer } from "../llm/proposer.js";
import { DEFAULT_POLICY, evaluatePolicy, type PolicyParams } from "../policy.js";
import { gate } from "../refusals.js";
import { REASONS, type ReasonName } from "../types.js";
import { usdc6ToUsd } from "../units.js";

export type ReceiptClient = Pick<PublicClient, "waitForTransactionReceipt">;
export const BILL_MIN_USD6 = 100_000n;
export const RECEIPT_TIMEOUT_MS = 120_000;

export interface RunDeps {
  vault: Address;
  executor: Address;
  expensePayee: Address;
  mode: "dry-run" | "live";
  defaultDailyComputeUsd6: bigint;
  maxTxPerDay: number;
  stateClient: StateClient;
  previewClient: PreviewClient;
  receipts: ReceiptClient;
  proposer: Proposer;
  sender: TxSender | null;
  store: Store;
  journal: Pick<Journal, "append">;
  policy?: PolicyParams;
  runId?: string;
}

export interface RunReport {
  runId: string;
  status: "no-state" | "wrong-executor" | "done" | "halted";
  block?: bigint;
  marketOpen?: boolean | null;
  sent: Hex[];
  skipped: number;
  proposals: number;
  haltReason?: string;
}

class Halt extends Error {}

function decisionOf(receipt: TransactionReceipt, vault: Address, id: Hex): { allowed: boolean; reason: string } | undefined {
  const logs = parseEventLogs({ abi: mandateVaultAbi, eventName: "Decision", logs: receipt.logs });
  const l = logs.find((x) => getAddress(x.address) === getAddress(vault) && x.args.intentId === id);
  return l && { allowed: l.args.allowed, reason: REASONS[Number(l.args.reason)] ?? `REASON_${l.args.reason}` };
}

export async function runOnce(d: RunDeps): Promise<RunReport> {
  const runId = d.runId ?? `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const report: RunReport = { runId, status: "done", sent: [], skipped: 0, proposals: 0 };
  const j = d.journal;

  let s: VaultState;
  try {
    s = await readVaultState(d.stateClient, d.vault);
  } catch (e) {
    if (!(e instanceof StateUnavailable)) throw e;
    await j.append({ kind: "error", runId, message: `state unavailable: ${e.message}` });
    return { ...report, status: "no-state" };
  }
  report.block = s.blockNumber;
  report.marketOpen = s.marketOpen;
  if (getAddress(s.executor) !== getAddress(d.executor)) {
    await j.append({ kind: "error", runId, message: `vault executor is ${s.executor}, agent is ${d.executor}` });
    return { ...report, status: "wrong-executor" };
  }
  const day = s.day;
  const live = d.mode === "live" && d.sender !== null;

  const reread = async () => {
    try {
      return await readVaultState(d.stateClient, d.vault);
    } catch (e) {
      throw new Halt(`state unavailable after a transaction: ${(e as Error).message}`);
    }
  };

  const sendAndWait = async (data: Hex, key: string): Promise<TransactionReceipt> => {
    if (d.store.txCount(day) >= d.maxTxPerDay) throw new Halt(`daily tx cap ${d.maxTxPerDay} reached`);
    const hash = await d.sender!.send({ to: d.vault, data, idempotencyKey: key });
    d.store.recordTx(day);
    report.sent.push(hash);
    const receipt = await d.receipts.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    if (receipt.status !== "success") throw new Halt(`tx ${hash} reverted`);
    return receipt;
  };

  try {
    // Housekeeping: record multiplier changes the vault would otherwise only see on a trade of that token.
    for (const t of s.tokens) {
      const hasMarket = t.config.feed !== zeroAddress || t.config.pool !== zeroAddress;
      if (!hasMarket || t.uiMultiplier === null || t.uiMultiplier === t.lastMultiplier) continue;
      if (!live) {
        await j.append({ kind: "housekeeping", runId, call: "syncMultiplier", token: t.address, note: "dry-run" });
        continue;
      }
      const r = await sendAndWait(encodeSyncMultiplier(t.address), `sync:${runId}:${t.address}`);
      await j.append({ kind: "housekeeping", runId, call: "syncMultiplier", token: t.address, txHash: r.transactionHash });
    }
    let dirty = report.sent.length > 0;
    if (dirty) {
      s = await reread();
      dirty = false;
    }

    const unpaid = d.store.unpaidUsd6();
    const policy = evaluatePolicy(
      s,
      { dailyComputeUsd6: d.store.dailyComputeUsd6(day, d.defaultDailyComputeUsd6), unpaidUsd6: unpaid },
      d.policy ?? DEFAULT_POLICY,
    );
    const out = await d.proposer.propose({ state: s, policy, billUsd6: unpaid });
    d.store.recordCompute(day, out.costUsd6);
    await j.append({
      kind: "run",
      runId,
      block: s.blockNumber,
      day,
      mode: d.mode,
      ok: out.ok,
      summary: out.ok ? out.summary : "",
      costUsd6: out.costUsd6,
      suggestions: policy.suggestions.length,
      proposals: out.ok ? out.proposals.length : 0,
      ...(out.ok ? {} : { error: out.error }),
    });

    const queue: Proposal[] = [];
    if (unpaid >= BILL_MIN_USD6) {
      const usd = usdc6ToUsd(unpaid);
      queue.push({ action: "PAY_EXPENSE", symbol: "USDC", amountUsd: usd, rationale: `Compute bill: $${usd.toFixed(6)} of Claude API usage unpaid as of UTC day ${day}` });
    }
    if (out.ok) queue.push(...out.proposals);
    report.proposals = queue.length;

    for (const [index, p] of queue.entries()) {
      if (dirty) {
        s = await reread();
        dirty = false;
      }
      const b = buildIntent(p, s, { runId, index, expensePayee: d.expensePayee });
      if (!b.ok) {
        await j.append({ kind: "skip", runId, index, symbol: p.symbol, action: p.action, error: b.error });
        report.skipped++;
        continue;
      }
      const preview = await previewIntent(d.previewClient, d.vault, d.executor, b.intent);
      const logged = preview !== "OK" && preview !== "UNKNOWN" && d.store.hasLoggedRefusal(day, preview);
      const g = gate(preview, logged);
      const row = {
        kind: "intent" as const,
        runId,
        index,
        intentId: b.intent.id,
        action: p.action,
        symbol: p.symbol,
        amountUsd6: b.amountUsd6,
        rationale: p.rationale,
        rationaleHash: b.intent.rationaleHash,
        preview,
      };
      if (!g.send || !live) {
        await j.append({ ...row, gate: g.send ? `dry-run: would ${g.kind}` : g.why });
        report.skipped++;
        continue;
      }
      const receipt = await sendAndWait(encodeExecute(b.intent), b.intent.id);
      dirty = true;
      const decision = decisionOf(receipt, d.vault, b.intent.id);
      if (g.kind === "log-refusal") d.store.recordRefusalLog(day, preview as ReasonName);
      if (p.action === "PAY_EXPENSE" && decision?.allowed) d.store.recordPaid(b.intent.amount);
      await j.append({ ...row, gate: g.kind, txHash: receipt.transactionHash, ...(decision ? { decision } : {}) });
    }
  } catch (e) {
    report.status = "halted";
    report.haltReason = (e as Error).message;
    await j.append({ kind: "error", runId, message: `halted: ${report.haltReason}` });
  } finally {
    await d.store.save();
  }
  return report;
}
```

- [ ] **Step 5: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (15 new); `tsc` clean. If `parseEventLogs`' typed `args` do not narrow to `{ intentId, allowed, reason }` with the generated ABI, the generated file is missing `as const`: fix the generator, not the call site.

- [ ] **Step 6: Commit**

```bash
git add agent/src/loop/runOnce.ts agent/test/runOnce.test.ts agent/test/fakes/fakeReceipts.ts
git commit -m "feat(agent): agent round - read, propose, preview as executor, gate, send, journal"
```

---

### Task 11: Runtime wiring, scheduler, CLI and runbook

**Files:**
- Create: `agent/src/runtime.ts`
- Create: `agent/src/loop/scheduler.ts`
- Create: `agent/src/loop/lock.ts`
- Create: `agent/src/main.ts`
- Create: `agent/README.md`
- Modify: `agent/package.json` (the `agent` script)
- Modify: `deployments/README.md` (add an executor hand-over section)
- Test: `agent/test/runtime.test.ts`, `agent/test/scheduler.test.ts`, `agent/test/lock.test.ts`

**Interfaces:**
- Consumes: `AgentConfig`, `loadConfig` (Task 2); `RunDeps`, `RunReport`, `runOnce` (Task 10); `ClaudeProposer`, `Proposer` (Task 7); `CdpSender` (Task 9); `GuardedSender` (Task 8); `builderSuffix` (Task 8); `Store`, `Journal` (Task 6); `usdToUsdc6` (Task 2).
- Produces:
  - `src/runtime.ts`: `buildRuntime(cfg: AgentConfig, o?: { forceDryRun?: boolean; connectCdp?: (opts: { accountName: string; expectedAddress: Address }) => Promise<TxSender>; proposer?: Proposer }): Promise<RunDeps>`
  - `src/loop/scheduler.ts`: `IN_SESSION_MS = 900_000`, `OFF_SESSION_MS = 3_600_000`, `nextDelayMs(r: RunReport | null): number`, `runForever(o: { run: () => Promise<RunReport>; signal: AbortSignal; sleep?: (ms: number, signal: AbortSignal) => Promise<void>; log?: (m: string) => void }): Promise<number>` (returns the number of rounds run)
  - `src/loop/lock.ts`: `acquireLock(dir: string): Promise<() => Promise<void>>`
  - `src/main.ts`: CLI `npm run agent -- [--once] [--dry-run]`

**Cadence (spec §3.5):** 15 minutes when the vault's calendar says the market is open, 1 hour otherwise, including when `marketOpen` is `null` or the round failed. Rounds run strictly one after another (await, then sleep), so they never overlap inside a process. A lock file in `MAAT_DATA_DIR` stops a second process: two agents sharing a ledger would double-pay bills and double-log refusals. A lock left by a dead process (its pid no longer exists) is taken over.

**`--dry-run`** forces dry-run even when `.env` says `live`. It never constructs a CDP client.

- [ ] **Step 1: Write the failing tests**

`agent/test/scheduler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RunReport } from "../src/loop/runOnce.js";
import { IN_SESSION_MS, nextDelayMs, OFF_SESSION_MS, runForever } from "../src/loop/scheduler.js";

const rep = (marketOpen: boolean | null): RunReport => ({ runId: "r", status: "done", marketOpen, sent: [], skipped: 0, proposals: 0 });

describe("scheduler", () => {
  it("uses 15 min in session and 1 h otherwise", () => {
    expect(nextDelayMs(rep(true))).toBe(IN_SESSION_MS);
    expect(nextDelayMs(rep(false))).toBe(OFF_SESSION_MS);
    expect(nextDelayMs(rep(null))).toBe(OFF_SESSION_MS);
    expect(nextDelayMs(null)).toBe(OFF_SESSION_MS);
    expect(IN_SESSION_MS).toBe(15 * 60_000);
  });

  it("runs rounds back to back, survives a failing round, stops on abort", async () => {
    const ac = new AbortController();
    const delays: number[] = [];
    const outcomes = [rep(true), new Error("boom"), rep(false)];
    let i = 0;
    const runs = await runForever({
      signal: ac.signal,
      run: async () => {
        const o = outcomes[i++];
        if (o instanceof Error) throw o;
        return o!;
      },
      sleep: async (ms) => {
        delays.push(ms);
        if (delays.length === 3) ac.abort();
      },
      log: () => {},
    });
    expect(runs).toBe(3);
    expect(delays).toEqual([IN_SESSION_MS, OFF_SESSION_MS, OFF_SESSION_MS]);
  });

  it("does not start a round after abort", async () => {
    const ac = new AbortController();
    ac.abort();
    let called = false;
    expect(await runForever({ signal: ac.signal, run: async () => ((called = true), rep(true)), sleep: async () => {}, log: () => {} })).toBe(0);
    expect(called).toBe(false);
  });
});
```

`agent/test/lock.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acquireLock } from "../src/loop/lock.js";

describe("acquireLock", () => {
  it("holds and releases", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    const release = await acquireLock(d);
    expect(existsSync(join(d, "agent.lock"))).toBe(true);
    await expect(acquireLock(d)).rejects.toThrow(/another agent \(pid \d+\) is running/);
    await release();
    expect(existsSync(join(d, "agent.lock"))).toBe(false);
    await (await acquireLock(d))();
  });
  it("takes over a lock left by a dead process", async () => {
    const d = await mkdtemp(join(tmpdir(), "maat-lock-"));
    await writeFile(join(d, "agent.lock"), "2147483646");
    const release = await acquireLock(d);
    await release();
  });
});
```

`agent/test/runtime.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { GuardedSender } from "../src/exec/sender.js";
import { buildRuntime } from "../src/runtime.js";
import { FakeSender } from "./fakes/fakeSender.js";

const env = async (over: Record<string, string> = {}) => ({
  BASE_RPC_URL: "http://127.0.0.1:1",
  MAAT_VAULT: "0x1111111111111111111111111111111111111111",
  MAAT_EXECUTOR: "0x2222222222222222222222222222222222222222",
  MAAT_EXPENSE_PAYEE: "0x3333333333333333333333333333333333333333",
  MAAT_DATA_DIR: await mkdtemp(join(tmpdir(), "maat-rt-")),
  ...over,
});
const noProposer = { propose: async () => ({ ok: false as const, error: "unused", costUsd6: 0n }) };

describe("buildRuntime", () => {
  it("dry-run never touches CDP", async () => {
    let connected = false;
    const deps = await buildRuntime(loadConfig(await env()), { proposer: noProposer, connectCdp: async () => ((connected = true), new FakeSender()) });
    expect(deps.mode).toBe("dry-run");
    expect(deps.sender).toBeNull();
    expect(connected).toBe(false);
  });
  it("live wraps the CDP sender in the guard with the Builder Code", async () => {
    let seen: unknown;
    const cfg = loadConfig(await env({ MAAT_MODE: "live", MAAT_BUILDER_CODE: "bc_maattest" }));
    const deps = await buildRuntime(cfg, { proposer: noProposer, connectCdp: async (o) => ((seen = o), new FakeSender()) });
    expect(deps.mode).toBe("live");
    expect(deps.sender).toBeInstanceOf(GuardedSender);
    expect(seen).toEqual({ accountName: "maat-executor", expectedAddress: "0x2222222222222222222222222222222222222222" });
    expect(deps.defaultDailyComputeUsd6).toBe(500_000n);
  });
  it("--dry-run overrides live", async () => {
    const cfg = loadConfig(await env({ MAAT_MODE: "live", MAAT_BUILDER_CODE: "bc_maattest" }));
    const deps = await buildRuntime(cfg, { forceDryRun: true, proposer: noProposer, connectCdp: async () => { throw new Error("must not connect"); } });
    expect(deps.sender).toBeNull();
  });
  it("rejects an invalid Builder Code before connecting", async () => {
    const cfg = loadConfig(await env({ MAAT_MODE: "live", MAAT_BUILDER_CODE: "Not-Valid" }));
    await expect(buildRuntime(cfg, { proposer: noProposer, connectCdp: async () => new FakeSender() })).rejects.toThrow(/invalid builder code/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/scheduler.test.ts test/lock.test.ts test/runtime.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`agent/src/loop/scheduler.ts`:

```ts
import { setTimeout as delay } from "node:timers/promises";
import type { RunReport } from "./runOnce.js";

export const IN_SESSION_MS = 15 * 60_000;
export const OFF_SESSION_MS = 60 * 60_000;

export function nextDelayMs(r: RunReport | null): number {
  return r?.marketOpen === true ? IN_SESSION_MS : OFF_SESSION_MS;
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (e) {
    if ((e as Error).name !== "AbortError") throw e;
  }
}

/** One round at a time: await the round, then sleep. A failed round is logged and retried on the slow cadence. */
export async function runForever(o: {
  run: () => Promise<RunReport>;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  log?: (m: string) => void;
}): Promise<number> {
  const sleep = o.sleep ?? abortableSleep;
  const log = o.log ?? console.log;
  let runs = 0;
  while (!o.signal.aborted) {
    let report: RunReport | null = null;
    try {
      report = await o.run();
      log(`round ${report.runId}: ${report.status}, sent ${report.sent.length}, skipped ${report.skipped}`);
    } catch (e) {
      log(`round failed: ${(e as Error).stack ?? e}`);
    }
    runs++;
    if (o.signal.aborted) break;
    await sleep(nextDelayMs(report), o.signal);
  }
  return runs;
}
```

`agent/src/loop/lock.ts`:

```ts
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One agent per data dir: a second one would double-pay bills and double-log refusals. */
export async function acquireLock(dir: string): Promise<() => Promise<void>> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, "agent.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const h = await open(file, "wx");
      await h.writeFile(String(process.pid));
      await h.close();
      return async () => {
        await unlink(file).catch(() => {});
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number((await readFile(file, "utf8")).trim());
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw new Error(`another agent (pid ${pid}) is running; lock ${file}`);
      await unlink(file).catch(() => {});
    }
  }
  throw new Error(`could not acquire ${file}`);
}
```

`agent/src/runtime.ts`:

```ts
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import type { AgentConfig } from "./config.js";
import { builderSuffix } from "./exec/builderCode.js";
import { CdpSender } from "./exec/cdpSender.js";
import { GuardedSender, type TxSender } from "./exec/sender.js";
import { Journal } from "./ledger/journal.js";
import { Store } from "./ledger/store.js";
import { ClaudeProposer, type Proposer } from "./llm/proposer.js";
import type { RunDeps } from "./loop/runOnce.js";
import { usdToUsdc6 } from "./units.js";

export async function buildRuntime(
  cfg: AgentConfig,
  o: {
    forceDryRun?: boolean;
    connectCdp?: (opts: { accountName: string; expectedAddress: Address }) => Promise<TxSender>;
    proposer?: Proposer;
  } = {},
): Promise<RunDeps> {
  const mode = o.forceDryRun ? "dry-run" : cfg.mode;
  const client = createPublicClient({ chain: base, transport: http(cfg.rpcUrl) });
  let sender: TxSender | null = null;
  if (mode === "live") {
    const suffix = builderSuffix(cfg.builderCode ?? ""); // validates before any CDP call
    const connect = o.connectCdp ?? ((opts) => CdpSender.connect(opts));
    const cdp = await connect({ accountName: cfg.cdpAccountName, expectedAddress: cfg.executor });
    sender = new GuardedSender(cdp, { vault: cfg.vault, suffix });
  }
  return {
    vault: cfg.vault,
    executor: cfg.executor,
    expensePayee: cfg.expensePayee,
    mode,
    defaultDailyComputeUsd6: usdToUsdc6(cfg.defaultDailyComputeUsd),
    maxTxPerDay: cfg.maxTxPerDay,
    stateClient: client,
    previewClient: client,
    receipts: client,
    proposer: o.proposer ?? new ClaudeProposer({ model: cfg.loopModel }),
    sender,
    store: await Store.open(cfg.dataDir),
    journal: new Journal(cfg.dataDir),
  };
}
```

`agent/src/main.ts`:

```ts
import { loadConfig } from "./config.js";
import { acquireLock } from "./loop/lock.js";
import { runOnce } from "./loop/runOnce.js";
import { runForever } from "./loop/scheduler.js";
import { buildRuntime } from "./runtime.js";

const args = new Set(process.argv.slice(2));
const cfg = loadConfig();
const deps = await buildRuntime(cfg, { forceDryRun: args.has("--dry-run") });
console.log(`maat agent: mode=${deps.mode} vault=${cfg.vault} executor=${cfg.executor} data=${cfg.dataDir}`);
const release = await acquireLock(cfg.dataDir);
try {
  if (args.has("--once")) {
    const r = await runOnce(deps);
    console.log(JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  } else {
    const ac = new AbortController();
    process.once("SIGINT", () => ac.abort());
    process.once("SIGTERM", () => ac.abort());
    await runForever({ run: () => runOnce(deps), signal: ac.signal });
  }
} finally {
  await release();
}
```

In `agent/package.json`, change the `agent` script so `.env` is loaded without a dependency (Node ≥ 22.9):

```json
"agent": "node --env-file-if-exists=.env --import tsx src/main.ts"
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all PASS (9 new); `tsc` clean.

- [ ] **Step 5: Check the CLI's failure path (no network needed)**

Run (from `agent/`, with no `.env`): `npm run agent -- --once --dry-run`
Expected: exits non-zero with `invalid agent config: BASE_RPC_URL: ...` listing the missing variables. This proves config validation runs before anything else. Do not create a `.env` with real values; the live path is the owner's (step 7).

- [ ] **Step 6: Write the runbook**

`agent/README.md` (English, matching `deployments/README.md`):

````markdown
# Maat agent runtime

"LLM proposes, contract decides." Each round, the agent does the following steps:

1. Read the `MandateVault` state at a pinned block.
2. Compute the policy: an equal-weight basket of NVDAc/GOOGLc/AAPLc, keep 30% USDC, rebalance when the weights are off target by ±5%, borrow when the 7-day compute runway is short, repay debt when there is revenue.
3. Ask Claude (`claude-sonnet-5-5`, structured output). Claude may only propose.
4. Call `previewIntent` with `eth_call` and `from = executor`.
5. Send `execute` through the CDP Server Wallet; every tx carries the Builder Code (ERC-8021).
6. Write the log.

Refusals "worth logging", such as `MARKET_CLOSED` or `FEED_STALE`, are also sent onchain to produce a public `Decision(allowed=false)`. At most once per reason per UTC day.

Cadence: 15 minutes during the session, 1 hour outside the session.

## Dry run (default)

```bash
cd agent
npm ci
cp .env.example .env   # fill in BASE_RPC_URL, MAAT_VAULT, MAAT_EXECUTOR, MAAT_EXPENSE_PAYEE, ANTHROPIC_API_KEY
npm run agent -- --once --dry-run
```

The dry run reads the chain, calls Claude (this costs real API fees, about 1 cent per round), previews, then writes `data/journal.jsonl`. It never sends a tx.

## Live run (owner only)

1. **Builder Code:** register the project at https://dashboard.base.org, go to Settings → Builder Code, then fill in `MAAT_BUILDER_CODE=bc_...`. The code must match `^[a-z0-9_]{1,32}$`.
2. **CDP:** create an API key and a Wallet Secret at https://portal.cdp.coinbase.com, then fill in `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`.
3. **Create the executor and attach the policy** (run once):

   ```bash
   node --env-file=.env --import tsx scripts/cdp-setup.ts <MAAT_VAULT>
   ```

   The policy allows only txs on Base, with `to` = vault and `value` = 0. Hash signing is rejected.
4. **Point the vault at the new executor.** You sign this command yourself with the owner wallet; see `deployments/README.md`, section "Switch the executor to the CDP Server Wallet".
5. **Fund gas:** send about 0.002 ETH on Base to the executor address. A paymaster cannot be used, because it supports only smart accounts.
6. Set `MAAT_EXECUTOR=<executor address>` and `MAAT_MODE=live`, run `npm run agent -- --once`, then check the tx on Basescan. The end of the input data must be the Builder Code (`...0080218021...8021`).
7. Run continuously: `npm run agent`. Stop with Ctrl+C.

## Safety

- The contract is the final checkpoint: $50 cap per order, $100 cap per day, slippage floor, session hours, feed, premium, HF. The agent cannot exceed those limits.
- `GuardedSender` sends only `execute`, `syncMultiplier` and `notifyRevenue` to the vault, and always attaches the Builder Code. The CDP policy adds one more layer of blocking.
- `MAAT_MAX_TX_PER_DAY` (default 40) stops gas burn when an error repeats.
- If the RPC fails, that round does nothing. A failed or reverted tx stops the round immediately.
- Each `data/` allows only one agent process to run (file `agent.lock`).

## Data

- `data/state.json`: compute bills, per-day refusal logs, per-day tx counts.
- `data/journal.jsonl`: per round, the intents, rationale (the original text behind `rationaleHash`), preview, tx and Decision. Plan 3 (diary/dashboard) reads this file.

## Test

```bash
npm test                  # unit, no network needed
npm run test:integration  # anvil fork of Base, needs BASE_RPC_URL (archive)
```
````

Append to `deployments/README.md`:

````markdown
## Switch the executor to the CDP Server Wallet (owner only)

Do this after running `agent/scripts/cdp-setup.ts`, which prints the executor address:

```bash
export EXECUTOR=<CDP executor address>
cast send "$VAULT" "setExecutor(address)" "$EXECUTOR" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast call "$VAULT" "executor()(address)" --rpc-url "$BASE_RPC_URL"   # must print $EXECUTOR
```

The executor can only call `execute` within the mandate. To revoke it, call `setExecutor` again with your own wallet.
````

- [ ] **Step 7: Commit**

```bash
git add agent/src/runtime.ts agent/src/loop/scheduler.ts agent/src/loop/lock.ts agent/src/main.ts agent/README.md agent/package.json agent/test/runtime.test.ts agent/test/scheduler.test.ts agent/test/lock.test.ts deployments/README.md
git commit -m "feat(agent): runtime wiring, 15m/1h scheduler, single-instance lock, CLI and runbook"
```

---

### Task 12: Anvil Base-fork integration test

**Files:**
- Create: `agent/vitest.integration.config.ts`
- Create: `agent/test/integration/anvil.ts`
- Create: `agent/test/integration/deploy.ts`
- Test: `agent/test/integration/agent.fork.test.ts`

**Interfaces:**
- Consumes: `runOnce`, `RunDeps` (Task 10); `FixedProposer` (Task 7); `GuardedSender`, `RpcSender` (Task 8); `builderSuffix`, `codesIn` (Task 8); `Store`, `Journal` (Task 6); `BASKET`, `USDC`, `addressOf` (Task 2); `mandateVaultAbi`, `creditAdapterAbi` (Task 1); Forge artifacts in `contracts/out/`.
- Produces:
  - `startAnvil(o: { forkUrl: string; block: bigint; port: number }): Promise<{ url: string; stop(): Promise<void> }>`
  - `deployStack(url: string): Promise<{ vault: Address; creditAdapter: Address; owner: Address; executor: Address; payee: Address }>`

This is spec §6's "preview matches the contract on the same block" plus "agent loop with a fixed-output LLM", against real Base contracts (B20 precompiles, Aerodrome, Aave V4 MAG7) on a local fork at `BLOCK_SESSION` (Thu 2026-11-05 10:30 ET, market open, NVDA feed 14 s old).

**Safety:** everything happens on a local anvil fork. Transactions go to `http://127.0.0.1:<port>` only. Signing uses anvil's unlocked dev accounts through `eth_sendTransaction`, plus `anvil_impersonateAccount` for the USDC source. No private key appears anywhere, nothing reaches Base mainnet, and no `cast send`, `cast wallet` or `forge script --broadcast` is used. The suite is skipped when `BASE_RPC_URL` is unset.

- [ ] **Step 1: Find the anvil flags that serve B20 precompiles**

From the repo root, with `BASE_RPC_URL` set to an archive RPC (`contracts/.env.example` notes `https://mainnet.base.org` worked on 06/11):

```bash
anvil --fork-url "$BASE_RPC_URL" --fork-block-number 53551627 --network base --port 8547
```

In a second shell (read-only call):

```bash
cast call 0xb20000000000000000000078ee7ce2fE4908108C "decimals()(uint8)" --rpc-url http://127.0.0.1:8547
```

Expected: `8`. If the call fails or returns empty, B20 precompiles are not active. Restart anvil with `--hardfork` set to the Base Cobalt name that `anvil --help` lists (Forge uses `base:Cobalt` in `contracts/foundry.toml`). Repeat until `decimals()` returns `8`. Record the working argument list. Stop anvil.

- [ ] **Step 2: Write the anvil helper and the deploy fixture**

`agent/vitest.integration.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/integration/**/*.test.ts"], testTimeout: 300_000, hookTimeout: 300_000, fileParallelism: false },
});
```

`agent/test/integration/anvil.ts` — put the argument list from Step 1 in `ANVIL_ARGS`:

```ts
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** From Task 12 step 1. Keep in sync with what made NVDAc.decimals() return 8. */
const ANVIL_ARGS = ["--network", "base"];

export async function startAnvil(o: { forkUrl: string; block: bigint; port: number }) {
  const proc = spawn("anvil", ["--fork-url", o.forkUrl, "--fork-block-number", o.block.toString(), "--port", String(o.port), "--silent", ...ANVIL_ARGS], { stdio: "ignore" });
  const url = `http://127.0.0.1:${o.port}`;
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
      if (r.ok) return { url, stop: async () => void proc.kill() };
    } catch {
      // not up yet
    }
    await delay(500);
  }
  proc.kill();
  throw new Error("anvil did not start");
}
```

`agent/test/integration/deploy.ts` reproduces `contracts/script/Deploy.s.sol` with dev accounts. Owner, executor and payee are anvil accounts 0, 1 and 2, all unlocked by the node. It funds the vault with $200 of real USDC taken from the NVDAc/USDC pool via impersonation:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, getContractAddress, http, parseEther, type Abi, type Address, type Hex } from "viem";
import { base } from "viem/chains";
import { BASKET, USDC } from "../../src/addresses.js";

const OUT = join(import.meta.dirname, "..", "..", "..", "contracts", "out");
const artifact = (file: string, name: string) => {
  const j = JSON.parse(readFileSync(join(OUT, file, `${name}.json`), "utf8"));
  return { abi: j.abi as Abi, bytecode: j.bytecode.object as Hex };
};

// contracts/script/BaseAddresses.sol + MaatConfig.sol
const POLICY_REGISTRY: Address = "0x8453000000000000000000000000000000000002";
const SPOKE: Address = "0x17905Db0e4A3514467539956c084180616AE7B8D";
const USDC_RESERVE = 7n;
const FEEDS: Address[] = ["0x04689a41629776563E6822F76f2e57D148d28513", "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2", "0x787f13dEa48Db0897CbCDD985de77809D837F988"];
const POOLS: Address[] = ["0xF668e21993f0ACd7ab00BB1cFbAeD0df28A3C8EC", "0x16c70F04C3080a127486Cdf5a4C33c066bBF47C3", "0xF5FCB9CDAFcE67d50AfEf298F88E709d2B946BA6"];
const RESERVE_IDS = [5n, 2n, 0n]; // NVDAc, GOOGLc, AAPLc (basket order)

export async function deployStack(url: string) {
  const transport = http(url);
  const pub = createPublicClient({ chain: base, transport });
  const wallet = createWalletClient({ chain: base, transport });
  const test = createTestClient({ chain: base, transport, mode: "anvil" });
  const [owner, executor, payee] = (await wallet.getAddresses()) as [Address, Address, Address];
  const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

  const nonce = BigInt(await pub.getTransactionCount({ address: owner }));
  const predictedVault = getContractAddress({ from: owner, nonce: nonce + 3n });
  const deploy = async (file: string, name: string, args: unknown[]) => {
    const a = artifact(file, name);
    const r = await wait(await wallet.deployContract({ abi: a.abi, bytecode: a.bytecode, args, account: owner, chain: base }));
    return r.contractAddress!;
  };
  const calendar = await deploy("MarketCalendar.sol", "MarketCalendar", [owner]);
  const swap = await deploy("AerodromeSwapAdapter.sol", "AerodromeSwapAdapter", []);
  const credit = await deploy("AaveV4CreditAdapter.sol", "AaveV4CreditAdapter", [predictedVault, USDC, SPOKE, USDC_RESERVE, BASKET.map((t) => t.address), RESERVE_IDS]);
  const mandate = {
    sessionMode: 0, maxPremiumBps: 100, maxSlippageBps: 100, maxStaleness: 3600, multiplierCooldown: 86400, twapWindow: 1800,
    perTradeCapUsd: 50_000_000n, dailyCapUsd: 100_000_000n, calendar, swapAdapter: swap, creditAdapter: credit,
    minHealthFactor: 1_500_000_000_000_000_000n, targetHealthFactor: 2_000_000_000_000_000_000n, deriskWindow: 28800,
  };
  const configs = BASKET.map((_, i) => ({ allowed: true, feed: FEEDS[i]!, pool: POOLS[i]!, maxWeightBps: 4000 }));
  const vault = await deploy("MandateVault.sol", "MandateVault", [owner, executor, USDC, POLICY_REGISTRY, mandate, BASKET.map((t) => t.address), configs, [payee]]);
  if (vault !== predictedVault) throw new Error(`vault ${vault} != predicted ${predictedVault}`);

  // $200 of real USDC from the NVDAc/USDC pool (impersonated on the fork only), then owner.fund().
  const source = POOLS[0]!;
  await test.impersonateAccount({ address: source });
  await test.setBalance({ address: source, value: parseEther("1") });
  await wait(await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "transfer", args: [owner, 200_000_000n], account: source, chain: base }));
  await test.stopImpersonatingAccount({ address: source });
  const vaultAbi = artifact("MandateVault.sol", "MandateVault").abi;
  await wait(await wallet.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [vault, 200_000_000n], account: owner, chain: base }));
  await wait(await wallet.writeContract({ address: vault, abi: vaultAbi, functionName: "fund", args: [200_000_000n], account: owner, chain: base }));
  return { vault, creditAdapter: credit, owner, executor, payee };
}
```

The mandate and basket values are copied from `MaatConfig.sol` (`defaultMandate(SessionMode.REGULAR, ...)` and `basket()`); reserve ids come from `creditReserves()`. If `MaatConfig.sol` changes, update this fixture to match.

- [ ] **Step 3: Write the integration test**

`agent/test/integration/agent.fork.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { creditAdapterAbi } from "../../src/abi/index.js";
import { builderSuffix, codesIn } from "../../src/exec/builderCode.js";
import { GuardedSender, RpcSender } from "../../src/exec/sender.js";
import { Journal, type JournalEntry } from "../../src/ledger/journal.js";
import { Store } from "../../src/ledger/store.js";
import { FixedProposer } from "../../src/llm/proposer.js";
import type { Batch } from "../../src/llm/schema.js";
import { runOnce, type RunDeps } from "../../src/loop/runOnce.js";
import { startAnvil } from "./anvil.js";
import { deployStack } from "./deploy.js";

const RPC = process.env.BASE_RPC_URL;
const BLOCK_SESSION = 53_551_627n;
const CODE = "bc_maattest";

describe.skipIf(!RPC)("agent on a Base fork", () => {
  let anvil: Awaited<ReturnType<typeof startAnvil>>;
  let stack: Awaited<ReturnType<typeof deployStack>>;
  let pub: ReturnType<typeof createPublicClient>;
  let journal: Journal;
  let deps: (batch: Batch, runId: string) => Promise<RunDeps & { journal: Journal }>;

  beforeAll(async () => {
    anvil = await startAnvil({ forkUrl: RPC!, block: BLOCK_SESSION, port: 8547 });
    stack = await deployStack(anvil.url);
    pub = createPublicClient({ chain: base, transport: http(anvil.url) });
    const wallet = createWalletClient({ chain: base, transport: http(anvil.url) });
    const dir = await mkdtemp(join(tmpdir(), "maat-fork-"));
    const store = await Store.open(dir);
    journal = new Journal(dir);
    const sender = new GuardedSender(new RpcSender(wallet, stack.executor), { vault: stack.vault, suffix: builderSuffix(CODE) });
    deps = async (batch, runId) => ({
      vault: stack.vault,
      executor: stack.executor,
      expensePayee: stack.payee,
      mode: "live",
      defaultDailyComputeUsd6: 500_000n,
      maxTxPerDay: 40,
      stateClient: pub,
      previewClient: pub,
      receipts: pub,
      proposer: new FixedProposer(batch),
      sender,
      store,
      journal,
      runId,
    });
  });

  afterAll(async () => {
    await anvil?.stop();
  });

  const intents = async (j: Journal, runId: string) =>
    (await j.read()).filter((e): e is Extract<JournalEntry, { kind: "intent" }> => e.kind === "intent" && e.runId === runId);

  it("buys, supplies and borrows in one round; every tx carries the Builder Code; preview matches execute", async () => {
    const d = await deps(
      {
        summary: "build the position",
        intents: [
          { action: "BUY", symbol: "NVDAc", amountUsd: 20, rationale: "NVDAc underweight" },
          { action: "SUPPLY", symbol: "NVDAc", amountUsd: 15, rationale: "use as collateral" },
          { action: "BORROW", symbol: "USDC", amountUsd: 5, rationale: "compute runway" },
        ],
      },
      "fork-1",
    );
    const r = await runOnce(d);
    expect(r.status).toBe("done");
    // The vault constructor seeds lastMultiplier from uiMultiplier(), so a fresh vault needs no housekeeping.
    expect((await d.journal.read()).filter((e) => e.kind === "housekeeping")).toEqual([]);
    expect(r.sent).toHaveLength(3);
    for (const hash of r.sent) {
      const tx = await pub.getTransaction({ hash });
      expect(codesIn(tx.input)).toEqual([CODE]);
      expect(tx.from.toLowerCase()).toBe(stack.executor.toLowerCase());
    }
    const rows = await intents(d.journal, "fork-1");
    expect(rows.map((x) => [x.action, x.preview, x.decision?.allowed, x.decision?.reason])).toEqual([
      ["BUY", "OK", true, "OK"],
      ["SUPPLY", "OK", true, "OK"],
      ["BORROW", "OK", true, "OK"],
    ]);
    const debt = await pub.readContract({ address: stack.creditAdapter, abi: creditAdapterAbi, functionName: "debt" });
    expect(debt).toBeGreaterThanOrEqual(5_000_000n);
    expect(debt).toBeLessThanOrEqual(5_000_010n);
  });

  it("logs a market-closed refusal onchain once per day, with preview == Decision", async () => {
    // Saturday: market closed, equity feeds frozen.
    const test = createTestClient({ chain: base, transport: http(anvil.url), mode: "anvil" });
    const now = (await pub.getBlock()).timestamp;
    await test.setNextBlockTimestamp({ timestamp: now + 2n * 86_400n });
    await test.mine({ blocks: 1 });

    const batch: Batch = { summary: "try", intents: [{ action: "BUY", symbol: "GOOGLc", amountUsd: 10, rationale: "GOOGLc underweight" }] };
    const first = await runOnce(await deps(batch, "fork-2"));
    expect(first.sent).toHaveLength(1);
    const [row] = await intents(journal, "fork-2");
    expect(row?.gate).toBe("log-refusal");
    expect(row?.decision?.allowed).toBe(false);
    expect(row?.decision?.reason).toBe(row?.preview); // contract verdict == off-chain preview
    expect(["MARKET_CLOSED", "FEED_STALE"]).toContain(row?.preview);

    const second = await runOnce(await deps(batch, "fork-3"));
    expect(second.sent).toEqual([]);
  });

  it("dry-run sends nothing", async () => {
    const before = await pub.getTransactionCount({ address: stack.executor as Address });
    const d = await deps({ summary: "s", intents: [{ action: "SELL", symbol: "NVDAc", amountUsd: 1, rationale: "r" }] }, "fork-4");
    await runOnce({ ...d, mode: "dry-run", sender: null });
    expect(await pub.getTransactionCount({ address: stack.executor as Address })).toBe(before);
  });
});
```

Why there is no housekeeping here: `MandateVault._applyTokenConfig` sets `lastMultiplier[token] = uiMultiplier()` when it is 0, which happens at construction. Task 10's unit test covers the sync path. Do not add a test that changes a multiplier on the fork: a sync starts the 1-day `multiplierCooldown`, and every later trade of that token would be refused.

If BORROW comes back `HEALTH_FACTOR_LOW` or `CREDIT_FAILED` instead of `OK`, the fork's MAG7 liquidation threshold is lower than assumed. Raise SUPPLY to $18 and leave BORROW at $5; do not loosen the mandate. Note the change in the task report.

Why the Saturday case accepts either reason: GuardLib's check order decides whether `MARKET_CLOSED` or `FEED_STALE` comes first. The property under test is that the onchain reason equals the preview, not which reason it is.

- [ ] **Step 4: Run the integration suite**

Run (from `agent/`): `BASE_RPC_URL=<archive rpc> npm run test:integration`
Expected: 3 tests PASS. If the public RPC rate-limits (HTTP 429), retry with a free Alchemy/QuickNode Base URL; never put that URL in a committed file.

Also run: `npx vitest run && npx tsc --noEmit`
Expected: the unit suite still passes, and the integration files type-check.

- [ ] **Step 5: Commit**

```bash
git add agent/vitest.integration.config.ts agent/test/integration
git commit -m "test(agent): Base-fork run of the full loop with Builder Code and preview parity"
```

---
