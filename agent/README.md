# Maat agent runtime

"LLM proposes, contract decides." Each cycle, the agent does the following:

1. Read the state of `MandateVault` at a fixed block.
2. Compute the policy: an equal-weight basket of NVDAc/GOOGLc/AAPLc, keep 30% in USDC, rebalance when a stock's weight drifts more than 5 percentage points from its target. With `MAAT_CREDIT_ACTIONS=on` it also supplies idle stock, borrows when there is less than 7 days of compute runway and repays debt when revenue arrives.
3. Ask Claude (`claude-sonnet-5-5`, structured output). Claude may only propose.
4. Call `previewIntent` with `eth_call`, using `from = executor`.
5. Send `execute` through the CDP Server Wallet. Every tx carries the Builder Code (ERC-8021), and every `execute` carries its maat:v1 rationale blob between the call and the Builder Code (see [Calldata](#calldata)).
6. Write to the journal, each row chained to the one before it.

Credit actions are off by default (`MAAT_CREDIT_ACTIONS=off`): the policy suggests no `SUPPLY`, `WITHDRAW_COLLATERAL`, `BORROW` or `REPAY`, the prompt tells Claude never to propose one, and a credit proposal is journaled as a `skip` before the preview.

Refusals that are "worth recording", such as `MARKET_CLOSED` or `FEED_STALE`, are also sent onchain so that a public `Decision(allowed=false)` exists. Each reason is sent at most once per NYSE date, the New York date that the vault's calendar contract reports. `MARKET_CLOSED` is also split by why the market is closed: a holiday, the weekend, the time between an early close and 16:00 ET, or outside regular hours, which covers both the time before the open and the time after the close of a date. So in Thanksgiving week 2026 it can log `MARKET_CLOSED` once outside regular hours on Wednesday (before the open or after the close), once on Thanksgiving Day, once outside regular hours on Friday and once after Friday's 13:00 ET early close, and it appends the case to the rationale of a `MARKET_CLOSED` log, for example "NYSE holiday: Thanksgiving", rebuilding the blob with it after the preview. A `MARKET_CLOSED` that the preview returns while the calendar still reports the session open at the state block has no phase yet, so the agent leaves its log to a later round. When the calendar cannot be read, the agent falls back to one log per reason per UTC day and says so in the journal. The daily tx cap and the compute bill still count UTC days.

Cadence: 15 minutes in session, 1 hour out of session.

## Dry run (default)

```bash
cd agent
npm ci
cp .env.example .env   # fill in BASE_RPC_URL, MAAT_VAULT, MAAT_EXECUTOR, MAAT_EXPENSE_PAYEE, ANTHROPIC_API_KEY
npm run agent -- --once --dry-run
```

The dry run reads the chain, calls Claude (this costs real API fees, about 1 cent per cycle), runs the preview, then writes `data/journal.jsonl`. It never sends a tx.

Give the dry run and the live agent separate data directories (`MAAT_DATA_DIR`). Live mode refuses to start on a directory whose journal holds dry-run rows, so the vault never pays a dry run's Claude bill, and a dry run refuses a directory whose journal holds live rows, so the live agent can start there again.

Claude is called only at `https://api.anthropic.com`, with `ANTHROPIC_API_KEY`. If `ANTHROPIC_BASE_URL` or `ANTHROPIC_AUTH_TOKEN` is set, the agent prints one warning at startup and ignores it. `MAAT_MAX_LLM_USD_PER_DAY` (default 0.75) caps the Claude cost of one UTC day: once it is reached, the day's later rounds skip Claude and still settle bills.

## Live run (owner only)

1. **Builder Code:** register the project at https://dashboard.base.org, go to Settings → Builder Code, then set `MAAT_BUILDER_CODE=bc_...`. The code must match `^[a-z0-9_]{1,32}$`.
2. **CDP:** create an API key and a Wallet Secret at https://portal.cdp.coinbase.com, then set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` and `CDP_WALLET_SECRET`.
3. **Create the executor and attach the policy** (run once):

   ```bash
   node --env-file=.env --import tsx scripts/cdp-setup.ts <MAAT_VAULT>
   ```

   The policy accepts sending a tx only on Base, with `to` = the vault and `value` = 0. It accepts signing a tx with `to` = the vault and `value` = 0, but that rule names no network. It does not limit which vault function is called. Hash, message and typed-data signing (`signEvmHash`, `signEvmMessage`, `signEvmTypedData`) are rejected. The script creates the policy before the account, so a policy CDP refuses leaves no account behind.
4. **Point the vault at the new executor.** You sign this one yourself with the owner wallet; see `deployments/README.md`, section "Switch the executor to the CDP Server Wallet".
5. **Fund gas:** send about 0.002 ETH on Base to the executor address. A paymaster cannot be used, because it only supports smart accounts.
6. Set `MAAT_EXECUTOR=<executor address>` and `MAAT_MODE=live`, run `npm run agent -- --once`, then check the tx on Basescan. The input data must end with the Builder Code (`...0080218021...8021`), and `npm run verify -- --tx <hash> --rpc <url> --journal data/journal.jsonl` must print `PASS`.
7. Run continuously: `npm run agent`. Stop it with Ctrl+C. On the owner's PC, `npm run agent:loop` starts `npm run agent` and starts it again each time it exits, after a pause that doubles from 10 s up to 15 min. Every 5 min it reads the heartbeat the agent writes after each round, and prints a `STALE` line (with a Windows notification) when no round has ended for more than 90 min. After 3 exits in a row that each came less than 10 min after their start, it prints a `FAILING` line and notifies once. `npm run agent:heartbeat` prints the age of the last round and exits 1 when it is older than 90 min.

## Safety

- The contract is the final gate: $50 per-trade cap, $100 daily cap, slippage floor, session hours, feed, premium, HF. The agent cannot exceed these limits.
- `GuardedSender` sends only `execute`, `syncMultiplier` and `notifyRevenue` to the vault, and always attaches the Builder Code. It refuses any bytes after the call except an `execute`'s blob, and an `execute` whose blob is missing, does not start with `maat:v1:`, is over 1,024 bytes, is not printable ASCII, breaks a spec rule, or does not hash to the intent's `rationaleHash`. The CDP policy adds one more layer, for the target and the value (and the network when sending), not for the function.
- `MAAT_MAX_TX_PER_DAY` (default 40) stops gas from being burned on a repeating error.
- If the RPC fails, that cycle does nothing. If a tx fails or reverts, the cycle stops immediately.
- `BASE_RPC_URL_FALLBACK` (optional) is a second RPC, best from another provider. Each request goes to `BASE_RPC_URL` first and moves to the fallback only when it fails. Neither URL is printed or journaled: a halt keeps only the first line of an RPC error, because viem lists the URL, and any key in it, below that line.
- Every tx has an explicit gas limit: `min(3,000,000, max(floor, estimate × 1.3))`. The floor is 2,500,000 for `execute` and 300,000 for `syncMultiplier`. The estimate is made on the full calldata, blob and Builder Code included (`GuardedSender.calldata`). The agent does not use `eth_estimateGas` directly, because the vault swallows inner errors (swap, transfer, credit), so the estimate can be too low and the vault would record `SWAP_FAILED`. If the estimate fails, the cycle stops.
- Every `execute` is recorded in `pending` in `data/state.json` before it is sent. The next cycle reconciles it before doing anything else, from the tx receipt once the tx is mined, otherwise against `usedIntent(id)`, so even a lost receipt cannot cause a bill to be paid twice.
- If the preview reports OK but the vault refuses, or the receipt has no `Decision`, the agent records `mismatch` and stops the cycle.
- Each `data/` directory allows only one agent process at a time (the `agent.lock` file). The agent takes the lock before it opens the Store or connects to CDP. A lock file that is empty or corrupt but newer than 60 seconds is treated as held.

## After a `halted` or `pending-tx` cycle

1. Read `data/journal.jsonl` (the `error`, `mismatch`, `sent` and `reconcile` lines), then look up the tx hash on Basescan.
2. `pending-tx` means a tx was sent and its outcome is still unknown. The next cycle reconciles it first, on its own:
   - the tx is mined and its receipt holds the intent's `Decision`: apply it, with no log search;
   - otherwise, the intent was used: find its `Decision` in the vault's logs, from the block the send was prepared at to the latest block, and apply it. Each `eth_getLogs` covers at most 9,000 blocks, and the window halves down to 200 blocks when an RPC refuses the range;
   - the tx is still in the mempool, or less than 10 minutes of chain time have passed since the block the send was prepared at: keep waiting and send nothing;
   - 10 minutes or more have passed with no trace of it: record `dropped` and continue.

   The window is measured with block timestamps, not block counts, so a change in Base's block interval does not change it. A `pending` entry written by an older agent has no timestamp, so it is aged in blocks instead and dropped after 3,000 blocks, 10 minutes at 200 ms. No manual fix is needed.
3. `halted` because of `mismatch` or a missing `Decision`: read the tx on Basescan before you run again. If a `pending` entry keeps halting the cycle, remove it from `data/state.json` only when you are sure that tx can no longer take effect.
4. Emergency stop (the owner signs it): call `setPaused(true)` on the vault, or `setExecutor(owner)` to take back the executor role.

## Data

- `data/state.json`: compute bills, refusal records per NYSE date (per UTC day in files from older agents, or while the calendar cannot be read), tx count per UTC day, and `pending` txs not yet reconciled.
- `data/heartbeat.json`: when the last round ended and how, written after every round; `agent:loop` and `agent:heartbeat` read it.
- `data/journal.jsonl`: for each cycle, the intent, the rationale (the text as written), the `blob` behind `rationaleHash`, the preview, the tx (`sent`, gas, `gasUsed`) and the Decision. Every row has `commit`, `prev` and `hash`: `hash` is keccak256 of the canonical JSON of the row's public fields with `prev`, and `prev` is the previous row's `hash` (32 zero bytes for the first). Rows older code wrote have no `prev` or `hash`. Plan 3 (diary/dashboard) reads this file.

## Calldata

An agent `execute` is `encodeExecute(intent) ‖ blob ‖ suffix` (docs/superpowers/specs/2026-11-25-maat-v1-rationale-blob-design.md):

| Bytes | Content |
| --- | --- |
| 0 to 228 | `execute(Intent)`: the selector `0x4ad3993f` and 7 words; `rationaleHash` is bytes 196 to 228 |
| 228 to 228 + n | the blob: `maat:v1:` and canonical JSON, at most 1,024 bytes |
| the rest | the ERC-8021 schema-0 suffix: codes, their length, `0x00`, then `8021` eight times |

The blob's fields: `b` the state block, `c` the git commit, `j` the journal's last row hash when the blob was built, `m` the model that answered (or `k: "bill"` for the compute bill), `r` the run id, `s` per vault token `[symbol, feed roundId, updatedAt, signed pool premium in bps]`, and `t` the rationale, sanitized (links, hex strings and key-like words replaced) and cut to 600 characters. `rationaleHash = keccak256(blob)`. The vault ignores the bytes after the call; a reader finds the suffix from the end of the input, so `Attribution.fromData` still reads the Builder Code. A proposal whose blob would break a rule is journaled as a `skip` with an error that starts `blob:`. `syncMultiplier` carries no blob. An owner `execute` built by `scripts/first-decision.ts` has no blob, and its `rationaleHash` is keccak256 of its text.

## Verify a Decision

```bash
npm run verify -- --input test/fixtures/calldata-v1.hex --journal test/fixtures/journal-v1.jsonl
npm run verify -- --tx <hash> --rpc <url> --journal data/journal.jsonl
```

`scripts/verify-decision.ts` decodes the input (hex, a file, or read over `--rpc` with the receipt's Decision and the vault's `owner()`; with `--rpc`, the calldata check fails unless the tx calls the vault, the Base mainnet MandateVault or the one `--vault <address>` names), re-derives keccak256 of the blob and compares it with the intent's `rationaleHash` (and the Decision's), checks the journal's hash chain, and checks that the blob's `j` names a row before the Decision's own row: the `sent` or `reconcile` row with the `--tx` hash, or, without `--tx`, the row that carries the blob. It prints one line per check and `PASS`, `FAIL` or `PENDING` (exit 0, 1 or 2; 3 for bad arguments). It sends nothing and never prints the RPC URL.

## Test

```bash
npm test                  # unit tests, no network needed
npm run test:integration  # anvil fork of Base, needs BASE_RPC_URL (archive)
```

The fork test needs:

- `BASE_RPC_URL`: a Base archive RPC (the test forks at block 53551627).
- base-anvil v1.5.1, installed with `base-foundryup --install v1.5.1`. Upstream Anvil 1.9 cannot deploy the vault, because it reverts on the B20 token's `uiMultiplier()`.
- On Windows, set `MAAT_ANVIL_BIN` to point to the real `anvil.exe` file, for example `~/.foundry/versions/base-v1.5.1/anvil.exe`, because `base-anvil` is only a shell wrapper. On macOS/Linux you can leave it unset.
- Port 8547 is free. The test runs only against a local anvil (`127.0.0.1`).
- About 3–5 minutes on a public RPC, because the first swap on a cold fork is very slow. Set `MAAT_GAS_LOG=<file path>` to write the gas limit and `gasUsed` of each tx to a JSON file.
- The committed log: `test/integration/fork-gas.json`; the website keeps a copy of its gas numbers in `web/content/facts.ts`, and `web/test/facts.test.ts` checks that the two match. Across 2 runs on 2026-11-07, `gasUsed` for SUPPLY, BORROW and the refusal log was identical, while BUY came out at 754,854 and then 758,192. If you overwrite this file, you must update `web/content/facts.ts` to match, because the parity test will fail.

## Known issue: npm audit

As of 2026-11-19, `npm audit` reports 3 high-severity vulnerabilities, all from one zod advisory, GHSA-mrhx-c7xc-m3w5. They are in zod 3.25.76 and abitype 1.0.6, both nested inside `@coinbase/cdp-sdk` 1.61.0, and in `@coinbase/cdp-sdk` itself, which depends on them. The advisory describes a DoS-type issue (memory exhaustion while validating oversized collections). In the agent, that issue only touches internal data. There is no safe override yet, because cdp-sdk uses the zod 3 API; `npm audit fix --force` would downgrade cdp-sdk to 1.7.0. Upgrade when Coinbase releases a version that uses zod 4.
