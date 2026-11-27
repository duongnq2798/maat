# Deployments

To deploy, fund and send the first intents on Base mainnet, follow the owner's runbook, [`go-live.md`](go-live.md). It puts the sections below in order and adds the read-only checks and the first-decision steps; this file keeps the reference and the record table.

| Network | Contract | Address | Tx | Date |
|---|---|---|---|---|
| Base mainnet | MarketCalendar | [`0x9bfe055323101245a644AF162287C4C38708aDB1`](https://basescan.org/address/0x9bfe055323101245a644AF162287C4C38708aDB1) | [`0x35f260151b987f6d05b63b1d90539edeaf4f7edf348155201049fea94fd337e6`](https://basescan.org/tx/0x35f260151b987f6d05b63b1d90539edeaf4f7edf348155201049fea94fd337e6) | 2026-11-24 |
| Base mainnet | AerodromeSwapAdapter | [`0x3265EEBEf5ad3c1CE41874Addf18CA207Be35Bfa`](https://basescan.org/address/0x3265EEBEf5ad3c1CE41874Addf18CA207Be35Bfa) | [`0x3f2b3ef236ade3ed1fa0b3ab2282ecddda340b2376137b7b438bb9c270127b39`](https://basescan.org/tx/0x3f2b3ef236ade3ed1fa0b3ab2282ecddda340b2376137b7b438bb9c270127b39) | 2026-11-24 |
| Base mainnet | AaveV4CreditAdapter | [`0x45dEA6BBeD30c120794115FeC8b01C346564aB2C`](https://basescan.org/address/0x45dEA6BBeD30c120794115FeC8b01C346564aB2C) | [`0xe79ef5ab90c0055ba218d6c0d2f271e30a128ba23e02f915ff527fde77818957`](https://basescan.org/tx/0xe79ef5ab90c0055ba218d6c0d2f271e30a128ba23e02f915ff527fde77818957) | 2026-11-24 |
| Base mainnet | MandateVault | [`0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b`](https://basescan.org/address/0x3F956072d18ddD20d5eFb74e9CCabf8Deade699b) | [`0xf5a532fe5d8b2ddf7fce312f524537e614f4988b425972dd1098f3d56631c9c1`](https://basescan.org/tx/0xf5a532fe5d8b2ddf7fce312f524537e614f4988b425972dd1098f3d56631c9c1) | 2026-11-24 |
| Base mainnet | MaatInbox | [`0x6a3D27f2d8a5BC991Bf4511aAA698A5B2DCDf12a`](https://basescan.org/address/0x6a3D27f2d8a5BC991Bf4511aAA698A5B2DCDf12a) | [`0x61b7f0b44ae01a6fbb34e0e7c35d53c2ffd1228fbc3f0b3dd020741826850db4`](https://basescan.org/tx/0x61b7f0b44ae01a6fbb34e0e7c35d53c2ffd1228fbc3f0b3dd020741826850db4) | 2026-11-27 |

On 2026-11-24, Basescan showed the source of all four contracts as verified, with an exact match, on each address's Contract tab.

The owner deployed `MaatInbox` on 2026-11-27, from the same wallet, at block 62,792,948, from `main` at `2a642a8` (its source and deploy script are unchanged on `main` since). It has no owner and no constructor arguments. Sourcify reports an exact match of its creation and runtime code since 03:09 UTC that day ([Sourcify](https://sourcify.dev/server/v2/contract/8453/0x6a3D27f2d8a5BC991Bf4511aAA698A5B2DCDf12a)), and on 2026-11-27 Basescan showed its source as verified, with an exact match, on its [Contract tab](https://basescan.org/address/0x6a3D27f2d8a5BC991Bf4511aAA698A5B2DCDf12a#code).

Owner = your wallet. The executor is your wallet at first, until you hand it to the CDP Server Wallet (see "Switch the executor to the CDP Server Wallet" below). Payee = the compute-expense wallet, plus an optional second payee. For the vault above: on 2026-11-27 at 01:04:08 UTC (block 62,755,363) the owner handed the executor role to the agent's CDP Server Wallet account [`0x9bC6E49d42e0659f3ef667B09B67506B348e115A`](https://basescan.org/address/0x9bC6E49d42e0659f3ef667B09B67506B348e115A), tx [`0x6f866bf770c461962af222b0ee67d5cb40229917287c68789672be7c7ab9f483`](https://basescan.org/tx/0x6f866bf770c461962af222b0ee67d5cb40229917287c68789672be7c7ab9f483); `owner()` is unchanged.

## Environment

`Deploy.s.sol` reads these from the environment (`contracts/.env.example` lists them):

| Variable | Required | What it is |
|---|---|---|
| `MAAT_DEPLOYER` | Yes | The address of the `--account` wallet that signs the broadcast. The script precomputes the vault address from its nonce. |
| `MAAT_OWNER` | Yes | Owner of the vault and the calendar. **Immutable.** |
| `MAAT_EXECUTOR` | Yes | The only address the vault accepts `execute` from. The owner can change it at once with `setExecutor`. |
| `MAAT_EXPENSE_PAYEE` | Yes | The first payee: an address `PAY_EXPENSE` may pay. |
| `MAAT_EXPENSE_PAYEE_2` | No | A second payee, allowlisted in the same deploy. Unset or the zero address means none. The script stops if it equals `MAAT_EXPENSE_PAYEE`. |

Set `MAAT_EXPENSE_PAYEE_2` when you already know a second address the vault should be able to pay, for example an agent's Bankr wallet: it is allowlisted at construction, where adding it later takes `queuePayee` and the 24h timelock. The agent pays one address only: its own `MAAT_EXPENSE_PAYEE` setting (`agent/src/config.ts`), which it reads at startup and puts in the `payee` field of every `PAY_EXPENSE` intent (`agent/src/intent.ts`). It never reads the vault's list, so with two payees allowlisted, moving the agent to the other one is a settings change and a restart, with no timelock.

## Default mandate

`MaatConfig.defaultMandate` uses `maxPremiumBps = 100` (not 50): the premium of TWAP(1800s) against Chainlink, measured in session at `BLOCK_SESSION`, is 53 bps for NVDAc, 49 bps for GOOGLc and 29 bps for AAPLc.

It uses `maxSlippageBps = 150` and `maxStaleness = 90000` (25 hours), measured on Base mainnet (read-only RPC) over the 10 NYSE sessions of Nov 2-6 and Nov 9-13, 2026. The measurement script and its data are not in the repository, so these figures cannot be re-run from it:

- `maxStaleness` is the feeds' 24h heartbeat plus 1h. The Chainlink B20 equity feeds update on a 0.5% price move or every 24h, so in session the latest answer was older than 1h for 45.9% of the time on AAPL, 37.6% on GOOGL and 9.8% on NVDA, and never older than 24h. A dead feed is still caught. For BUY and SELL the TWAP-vs-oracle premium check is the guard against a frozen price; BORROW and WITHDRAW_COLLATERAL against debt have no premium check and rely on the 25h limit alone.
- `maxSlippageBps`: the worst BUY cost against the oracle (pool spot price plus fee, sampled every 15 minutes in session) was 121 bps on NVDAc, p99 109 bps. At 150 bps a $50 trade loses at most $0.75 to slippage.
- Simulated $50 BUYs passed 81% (NVDAc), 60% (GOOGLc) and 53% (AAPLc) of the time with the old limits (`maxStaleness = 3600`, `maxSlippageBps = 100`), and 93%, 98% and 99% with these values. Most NVDAc refusals left are `PREMIUM_TOO_HIGH` in the first 45 minutes after the open, when the 30-minute TWAP still reflects the overnight price.

Credit (Aave V4 MAG7 Spoke): `minHealthFactor = 1.5`, `targetHealthFactor = 2.0` (buffer included), `deriskWindow = 8h` (from 12:00 ET on Friday until 20:00 ET, when the feed stops; for a REGULAR session this is 12:00–16:00). The window also applies to the last session before a day off: Monday–Thursday when the next day is a holiday in `MarketCalendar`, for example Thursday 2026-12-24 (early close at 13:00, so the in-session window is 12:00–13:00) and Thursday 2026-12-31, which come before two holidays that fall on Fridays; also Wednesday 2026-11-25, before Thanksgiving. Borrowing is allowed only when the market is open and the HF after the borrow is ≥ 1.5 (≥ 2.0 inside the window). Repay and adding collateral are allowed even when the market is closed. When the vault is paused with `setPaused(true)`, REPAY still runs so that debt can always be reduced; SUPPLY, BORROW, WITHDRAW_COLLATERAL (along with BUY, SELL, PAY_EXPENSE) are refused with `VAULT_PAUSED`.

## Foundry

The B20 stocks are precompiles, and the `MandateVault` constructor reads `uiMultiplier()` from each basket token, so the dry-run, the simulation and the broadcast below all need a Foundry that runs the B20 precompile. Foundry 1.8.4 or newer does when it runs in `contracts/`, where `foundry.toml` sets `hardfork = "base:Cobalt"`: the contract fork test `test_deployWiresEverything` runs this script on a Base fork that way (the README's runs used 1.9.0). Upstream Anvil 1.9 does not, because it reverts on `uiMultiplier()`, so do not point the script at a local upstream Anvil node. A local node must be Base's build, `base-anvil` v1.5.1, described in [`agent/README.md`](../agent/README.md#test).

## Dry-run (no broadcast, no key needed)

Run it in `contracts/`. It uses placeholder addresses, for simulation only. The contract addresses printed here will be **different** on mainnet, and the four lines `deployer`, `owner`, `executor`, `expense payee` are only placeholder addresses, not your real addresses (`expense payee 2` comes from your `.env`, and prints `none` when it is unset or zero):

```bash
set -a; source .env; set +a
MAAT_DEPLOYER=0x0000000000000000000000000000000000000004 \
MAAT_OWNER=0x0000000000000000000000000000000000000001 \
MAAT_EXECUTOR=0x0000000000000000000000000000000000000002 \
MAAT_EXPENSE_PAYEE=0x0000000000000000000000000000000000000003 \
forge script script/Deploy.s.sol --fork-url "$BASE_RPC_URL"
```

The script prints `deployer`, `owner`, `executor`, `expense payee` and `expense payee 2` before the contract addresses. To check the real addresses, use the simulation step with the real `.env` in the "Deploy mainnet" section below, not this dry-run.

The dry-run files (`contracts/broadcast/*/*/dry-run/`) are already in `.gitignore`. Whether to commit the file from the real run (`contracts/broadcast/Deploy.s.sol/8453/run-*.json`, which contains the txs and the deployer address, but no key) is the owner's decision.

## Checklist before broadcasting

- [ ] The deployer wallet has enough **ETH on Base** to pay gas (4 contracts). See the total estimated gas at the end of the dry-run output; fund extra, because gas prices change.
- [ ] `MAAT_DEPLOYER` is **exactly the address of the `--account` wallet** used to broadcast. The script precomputes the vault address from this wallet's nonce. If it is the wrong wallet, or the wallet sends another transaction between the simulation and the broadcast, the script can stop with `vault address mismatch` or a nonce error. `vault address mismatch` happens in the simulation step, before any transaction is sent, so no gas is lost: just simulate again. A nonce error during the broadcast (because the deployer wallet sent another transaction in between) can leave the calendar, the swap adapter and `AaveV4CreditAdapter` deployed but unused; in that case, redeploy from scratch.
- [ ] `MAAT_OWNER` is correct character for character. The owner is **immutable** on `MandateVault` and `MarketCalendar`: a mistyped address means **permanent loss of control** (you cannot withdraw funds or change the mandate). Check again with the `owner (immutable)` line in the output of the simulation step with the real `.env` ("Deploy mainnet" section), not the dry-run that uses placeholder addresses.
- [ ] `MAAT_EXECUTOR`, `MAAT_EXPENSE_PAYEE` and, if set, `MAAT_EXPENSE_PAYEE_2` are the correct addresses (they can be changed later, but a payee change must go through the 24h timelock).
- [ ] `--verify` needs `ETHERSCAN_API_KEY` in `contracts/.env` (an Etherscan v2 key works for Basescan). If the deploy finishes but verification fails, do not redeploy; run `forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --resume --verify --slow`.
- [ ] Fund the vault with `approve` and then `fund(amount)`. Do **not** transfer USDC straight into the vault: `notifyRevenue()` would record a direct transfer as revenue (`RevenueReceived`).
- [ ] To change the configuration later: `queueMandate` / `queueTokenConfig` / `queuePayee` (a public event with all parameters), wait 24h, then `apply*` within the 7 days after that; past that deadline the change expires (`ChangeExpired`) and must be queued again.

## Deploy mainnet (owner only, signed with your wallet)

The owner runs and signs the commands below.

```bash
cast wallet import maat-owner --interactive
cast wallet address --account maat-owner
```

The second command only prints the wallet's address (it signs nothing and sends nothing). Edit `contracts/.env`: set `MAAT_DEPLOYER` to the address just printed; set `MAAT_OWNER`, `MAAT_EXECUTOR` (temporarily your own wallet) and `MAAT_EXPENSE_PAYEE` all to your wallet address; leave `MAAT_EXPENSE_PAYEE_2` at the zero address unless you want a second payee (see "Environment"). Set `ETHERSCAN_API_KEY`, which the template leaves empty (an Etherscan v2 key works for Basescan).

Before broadcasting, simulate again with the real `.env`: no environment variable overrides, no `--broadcast`, no key needed:

```bash
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL"
```

Read the output and check it yourself:

- The `deployer`, `owner (immutable)`, `executor` and `expense payee` lines match your wallet address character for character (the owner is immutable; a wrong one means permanent loss of control), and `expense payee 2` shows `none` or the second payee you set.
- The simulation finishes, with no `vault address mismatch`.

Broadcast only when both conditions hold. If the simulation stops at `vault address mismatch` or a nonce error, fix the cause (use the right wallet, send no other transaction from the deployer wallet) and simulate again; no transaction has been sent at this step.

```bash
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --broadcast --verify --slow
```

`--slow` sends the four deploy transactions one at a time, each only after the previous one is confirmed and succeeded, as in go-live.md step 5.

Then fill the table at the top of this file with each contract's address, deploy transaction and date, and in `web/` run `npm run docs:gen` and commit what it rewrites. The docs and the website's `/ledger` page read the vault from that table: the page starts reading the vault's events at the block of the `MandateVault` deploy transaction, so fill its Tx cell too.

## Smoke test (owner only)

The smoke test is two $5 NVDAc BUY intents: one on a weekend, which the vault must refuse with `reason=6` (`MARKET_CLOSED`), and one in session, which it must allow. Send them **only** as [`go-live.md`](go-live.md) step 7 (weekend) and step 8 (in session) say, with the `execute` calldata that [`agent/scripts/first-decision.ts`](../agent/scripts/first-decision.ts) builds offline. That calldata ends with your Builder Code, each salt gives a new intent id, and the tool prints the `previewIntent` check to run before each send. This file gives no `cast send "$VAULT" "execute(...)"` command for them: a plain one carries no Builder Code, and the vault's first `Decision` cannot be redone.

Fund the vault first with `approve` + `fund`, **$20 USDC** or more (this does not count as revenue), as in go-live.md step 6:

```bash
VAULT=0x...   # address of the MandateVault just deployed
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
cast send "$USDC" "approve(address,uint256)" "$VAULT" 20000000 --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "fund(uint256)" 20000000 --rpc-url "$BASE_RPC_URL" --account maat-owner
```

The in-session intent needs US market hours, 9:30-16:00 ET. In UTC, the hours depend on whether the US is on standard time or daylight saving time:

- EST (UTC-5, from the first Sunday of November to the second Sunday of March, i.e. 2026-11-01 to 2027-03-14): **14:30-21:00 UTC**.
- EDT (UTC-4, the rest of the year, from 2027-03-14): **13:30-20:00 UTC**.

Expected: on the weekend, `previewIntent` returns `6` and the `execute` transaction has a `Decision` log with `allowed=false` and `reason=6` (`MARKET_CLOSED`); in session, `previewIntent` returns `0` (OK) and the `Decision` log has `allowed=true`. Fill in the addresses and tx hashes in the table above.

## Credit smoke test (owner only, after the BUY smoke test)

Run it during session hours, after the vault already holds NVDAc from the in-session BUY of the smoke test (go-live.md step 8). Action codes: SUPPLY = 2, WITHDRAW_COLLATERAL = 3, BORROW = 4, REPAY = 5. New reasons: CREDIT_FAILED = 17, HEALTH_FACTOR_LOW = 18, DERISK_WINDOW = 19.

```bash
NVDAC=0xb20000000000000000000078ee7ce2fE4908108C
STOCK=$(cast call "$NVDAC" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$BASE_RPC_URL" | cut -d' ' -f1)
EXEC="execute((bytes32,uint8,address,uint256,uint256,address,bytes32))"
ZERO=0x0000000000000000000000000000000000000000
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-1),2,$NVDAC,$STOCK,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-2),4,$USDC,1000000,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-3),5,$USDC,2000000,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-credit-4),3,$NVDAC,$STOCK,0,$ZERO,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
```

Expected: all four `Decision` logs have `allowed=true`. After the REPAY of 2 USDC, only about 1 USDC (debt + interest) is deducted from the vault. After the last order, the NVDAc is back in the vault.

## Unwinding the credit position (owner only)

The owner's `withdraw()` can only take out assets that sit in the vault. It does not touch the collateral supplied in Aave. To unwind the position, the owner acts as the executor and runs REPAY first and WITHDRAW_COLLATERAL after (once the debt is gone, WITHDRAW_COLLATERAL is allowed even when the market is closed), and finally calls `withdraw()` as usual (`VAULT`, `USDC`, `NVDAC`, `EXEC`, `ZERO` as in the two smoke test sections above):

```bash
OWNER=0x...   # address of the owner wallet
cast send "$VAULT" "setExecutor(address)" "$OWNER" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-unwind-1),5,$USDC,<enough USDC to repay debt + interest>,0,$ZERO,$(cast keccak unwind))" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "$EXEC" "($(cast keccak maat-unwind-2),3,$NVDAC,<amount of NVDAc currently supplied>,0,$ZERO,$(cast keccak unwind))" --rpc-url "$BASE_RPC_URL" --account maat-owner
```

REPAY also works while the vault is paused, so you can pause first and then unwind. WITHDRAW_COLLATERAL needs the vault to be unpaused.

If the Aave spoke's views start to revert: the adapter cannot be removed (`applyMandate` stops at `CreditPositionOpen`, because a failed position read counts as a position still being open), and every BUY returns `CONCENTRATION` (if collateral/debt cannot be read, it fails closed). Funds sitting in the vault can still be withdrawn with the owner's `withdraw()`.

## Switch the executor to the CDP Server Wallet (owner only)

Do this after running `agent/scripts/cdp-setup.ts`, which prints the executor address. These lines read `BASE_RPC_URL`, so run them in a shell that has it set. In go-live.md step 9 the shell may have unset it; there, use go-live.md step 9, item 2, which reads `RPC` instead.

```bash
EXECUTOR=<CDP executor address>
cast send "$VAULT" "setExecutor(address)" "$EXECUTOR" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast call "$VAULT" "executor()(address)" --rpc-url "$BASE_RPC_URL"   # must print $EXECUTOR
```

The executor can only call `execute` within the mandate. To revoke it, call `setExecutor` again with your wallet.
