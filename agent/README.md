# Maat agent runtime

"LLM proposes, contract decides." Each cycle, the agent does the following:

1. Read the state of `MandateVault` at a fixed block.
2. Compute the policy: an equal-weight basket of NVDAc/GOOGLc/AAPLc, keep 30% in USDC, rebalance on a ±5% drift, borrow when there is less than 7 days of compute runway, repay debt when revenue arrives.
3. Ask Claude (`claude-sonnet-5-5`, structured output). Claude may only propose.
4. Call `previewIntent` with `eth_call`, using `from = executor`.
5. Send `execute` through the CDP Server Wallet. Every tx carries the Builder Code (ERC-8021).
6. Write to the journal.

Refusals that are "worth recording", such as `MARKET_CLOSED` or `FEED_STALE`, are also sent onchain so that a public `Decision(allowed=false)` exists. Each reason is sent at most once per UTC day.

Cadence: 15 minutes in session, 1 hour out of session.

## Dry run (default)

```bash
cd agent
npm ci
cp .env.example .env   # fill in BASE_RPC_URL, MAAT_VAULT, MAAT_EXECUTOR, MAAT_EXPENSE_PAYEE, ANTHROPIC_API_KEY
npm run agent -- --once --dry-run
```

The dry run reads the chain, calls Claude (this costs real API fees, about 1 cent per cycle), runs the preview, then writes `data/journal.jsonl`. It never sends a tx.

## Live run (owner only)

1. **Builder Code:** register the project at https://dashboard.base.org, go to Settings → Builder Code, then set `MAAT_BUILDER_CODE=bc_...`. The code must match `^[a-z0-9_]{1,32}$`.
2. **CDP:** create an API key and a Wallet Secret at https://portal.cdp.coinbase.com, then set `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` and `CDP_WALLET_SECRET`.
3. **Create the executor and attach the policy** (run once):

   ```bash
   node --env-file=.env --import tsx scripts/cdp-setup.ts <MAAT_VAULT>
   ```

   The policy allows only txs on Base with `to` = the vault and `value` = 0. Hash signing is rejected.
4. **Point the vault at the new executor.** You sign this one yourself with the owner wallet; see `deployments/README.md`, section "Switch the executor to the CDP Server Wallet".
5. **Fund gas:** send about 0.002 ETH on Base to the executor address. A paymaster cannot be used, because it only supports smart accounts.
6. Set `MAAT_EXECUTOR=<executor address>` and `MAAT_MODE=live`, run `npm run agent -- --once`, then check the tx on Basescan. The input data must end with the Builder Code (`...0080218021...8021`).
7. Run continuously: `npm run agent`. Stop it with Ctrl+C.

## Safety

- The contract is the final gate: $50 per-trade cap, $100 daily cap, slippage floor, session hours, feed, premium, HF. The agent cannot exceed these limits.
- `GuardedSender` sends only `execute`, `syncMultiplier` and `notifyRevenue` to the vault, and always attaches the Builder Code. The CDP policy adds one more layer of blocking.
- `MAAT_MAX_TX_PER_DAY` (default 40) stops gas from being burned on a repeating error.
- If the RPC fails, that cycle does nothing. If a tx fails or reverts, the cycle stops immediately.
- Every tx has an explicit gas limit: `min(3,000,000, max(floor, estimate × 1.3))`. The floor is 2,500,000 for `execute` and 300,000 for `syncMultiplier`. The agent does not use `eth_estimateGas` directly, because the vault swallows inner errors (swap, transfer, credit), so the estimate can be too low and the vault would record `SWAP_FAILED`. If the estimate fails, the cycle stops.
- Every `execute` is recorded in `pending` in `data/state.json` before it is sent. The next cycle reconciles it before doing anything else, from the tx receipt once the tx is mined, otherwise against `usedIntent(id)`, so even a lost receipt cannot cause a bill to be paid twice.
- If the preview reports OK but the vault refuses, or the receipt has no `Decision`, the agent records `mismatch` and stops the cycle.
- Each `data/` directory allows only one agent process at a time (the `agent.lock` file). The agent takes the lock before it opens the Store or connects to CDP. A lock file that is empty or corrupt but newer than 60 seconds is treated as held.

## After a `halted` or `pending-tx` cycle

1. Read `data/journal.jsonl` (the `error`, `mismatch`, `sent` and `reconcile` lines), then look up the tx hash on Basescan.
2. `pending-tx` means a tx was sent and its outcome is still unknown. The next cycle reconciles it first, on its own:
   - the tx is mined and its receipt holds the intent's `Decision`: apply it, with no log search;
   - otherwise, the intent was used: find its `Decision` in the vault's logs and apply it;
   - the tx is still in the mempool, or less than 10 minutes of chain time have passed since the block the send was prepared at: keep waiting and send nothing;
   - 10 minutes or more have passed with no trace of it: record `dropped` and continue.

   The window is measured with block timestamps, not block counts, because Base's block interval has changed (one block every 200 ms since block 53,556,127). A `pending` entry written by an older agent has no timestamp, so it is aged in blocks instead and dropped after 3,000 blocks, 10 minutes at 200 ms. No manual fix is needed.
3. `halted` because of `mismatch` or a missing `Decision`: read the tx on Basescan before you run again. If a `pending` entry keeps halting the cycle, remove it from `data/state.json` only when you are sure that tx can no longer take effect.
4. Emergency stop (the owner signs it): call `setPaused(true)` on the vault, or `setExecutor(owner)` to take back the executor role.

## Data

- `data/state.json`: compute bills, refusal records per day, tx count per day, and `pending` txs not yet reconciled.
- `data/journal.jsonl`: for each cycle, the intent, the rationale (the original text behind `rationaleHash`), the preview, the tx (`sent`, gas, `gasUsed`) and the Decision. Plan 3 (diary/dashboard) reads this file.

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
- The committed log: `test/integration/fork-gas.json`; the web page reads its gas numbers from this file. Across 2 runs on 2026-11-07, `gasUsed` for SUPPLY, BORROW and the refusal log was identical, while BUY came out at 754,854 and then 758,192. If you overwrite this file, you must update `web/content/facts.ts` to match, because the parity test will fail.

## Known issue: npm audit

`npm audit` reports 3 high-severity issues in zod 3 and abitype nested inside `@coinbase/cdp-sdk`. They are DoS-type issues and only touch internal data. There is no safe override yet, because cdp-sdk uses the zod 3 API; `npm audit fix --force` would downgrade cdp-sdk to 1.7.0. Upgrade when Coinbase releases a version that uses zod 4.
