# Deployments

| Network | Contract | Address | Tx | Date |
|---|---|---|---|---|
| Base mainnet | MarketCalendar | | | |
| Base mainnet | AerodromeSwapAdapter | | | |
| Base mainnet | AaveV4CreditAdapter | | | |
| Base mainnet | MandateVault | | | |

Owner = your wallet. The executor is temporarily your wallet until Plan 2 (CDP Server Wallet). Payee = the compute-expense wallet, plus an optional second payee.

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

Credit (Aave V4 MAG7 Spoke): `minHealthFactor = 1.5`, `targetHealthFactor = 2.0` (buffer included), `deriskWindow = 8h` (from 12:00 ET on Friday until 20:00 ET, when the feed stops; for a REGULAR session this is 12:00–16:00). The window also applies to the last session before a day off: Monday–Thursday when the next day is a holiday in `MarketCalendar`, for example Thursday 2026-12-24 (early close at 13:00, so the in-session window is 12:00–13:00) and Thursday 2026-12-31, which come before two holidays that fall on Fridays; also Wednesday 2026-11-25, before Thanksgiving. Borrowing is allowed only when the market is open and the HF after the borrow is ≥ 1.5 (≥ 2.0 inside the window). Repay and adding collateral are allowed even when the market is closed. When the vault is paused with `setPaused(true)`, REPAY still runs so that debt can always be reduced; SUPPLY, BORROW, WITHDRAW_COLLATERAL (along with BUY, SELL, PAY_EXPENSE) are refused with `VAULT_PAUSED`.

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
- [ ] `--verify` needs `ETHERSCAN_API_KEY` in `contracts/.env` (an Etherscan v2 key works for Basescan). If the deploy finishes but verification fails, do not redeploy; run `forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --resume --verify`.
- [ ] Fund the vault with `approve` and then `fund(amount)`. Do **not** transfer USDC straight into the vault: `notifyRevenue()` would record a direct transfer as revenue (`RevenueReceived`).
- [ ] To change the configuration later: `queueMandate` / `queueTokenConfig` / `queuePayee` (a public event with all parameters), wait 24h, then `apply*` within the 7 days after that; past that deadline the change expires (`ChangeExpired`) and must be queued again.

## Deploy mainnet (owner only, signed with your wallet)

The owner runs and signs the commands below.

```bash
cast wallet import maat-owner --interactive
cast wallet address --account maat-owner
```

The second command only prints the wallet's address (it signs nothing and sends nothing). Edit `contracts/.env`: set `MAAT_DEPLOYER` to the address just printed; set `MAAT_OWNER`, `MAAT_EXECUTOR` (temporarily your own wallet) and `MAAT_EXPENSE_PAYEE` all to your wallet address; leave `MAAT_EXPENSE_PAYEE_2` at the zero address unless you want a second payee (see "Environment"). Add `ETHERSCAN_API_KEY` (an Etherscan v2 key works for Basescan).

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
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --broadcast --verify
```

## Smoke test (owner only)

Put **$20 USDC** into the vault with `approve` + `fund` (this does not count as revenue), then send one BUY $5 NVDAc intent. Do this only during US market hours, 9:30-16:00 ET. In UTC, the hours depend on whether the US is on standard time or daylight saving time:

- EST (UTC-5, from the first Sunday of November to the second Sunday of March, i.e. 2026-11-01 to 2027-03-14): **14:30-21:00 UTC**.
- EDT (UTC-4, the rest of the year, from 2027-03-14): **13:30-20:00 UTC**.

```bash
VAULT=0x...   # address of the MandateVault just deployed
USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
cast send "$USDC" "approve(address,uint256)" "$VAULT" 20000000 --rpc-url "$BASE_RPC_URL" --account maat-owner
cast send "$VAULT" "fund(uint256)" 20000000 --rpc-url "$BASE_RPC_URL" --account maat-owner
cast call "$VAULT" "previewIntent((bytes32,uint8,address,uint256,uint256,address,bytes32))(uint8)" "($(cast keccak maat-smoke-1),0,0xb20000000000000000000078ee7ce2fE4908108C,5000000,0,0x0000000000000000000000000000000000000000,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL"
cast send "$VAULT" "execute((bytes32,uint8,address,uint256,uint256,address,bytes32))" "($(cast keccak maat-smoke-1),0,0xb20000000000000000000078ee7ce2fE4908108C,5000000,0,0x0000000000000000000000000000000000000000,$(cast keccak smoke))" --rpc-url "$BASE_RPC_URL" --account maat-owner
```

Expected: `previewIntent` returns `0` (OK). The `execute` transaction has a `Decision` log with `allowed=true`. Send one more new intent (id `maat-smoke-2`) on a weekend: the log must show `reason=6` (MARKET_CLOSED). Fill in the addresses and tx hashes in the table above.

## Credit smoke test (owner only, after the BUY smoke test)

Run it during session hours, after the vault already holds NVDAc from the BUY smoke test. Action codes: SUPPLY = 2, WITHDRAW_COLLATERAL = 3, BORROW = 4, REPAY = 5. New reasons: CREDIT_FAILED = 17, HEALTH_FACTOR_LOW = 18, DERISK_WINDOW = 19.

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

Do this after running `agent/scripts/cdp-setup.ts`, which prints the executor address:

```bash
export EXECUTOR=<CDP executor address>
cast send "$VAULT" "setExecutor(address)" "$EXECUTOR" --rpc-url "$BASE_RPC_URL" --account maat-owner
cast call "$VAULT" "executor()(address)" --rpc-url "$BASE_RPC_URL"   # must print $EXECUTOR
```

The executor can only call `execute` within the mandate. To revoke it, call `setExecutor` again with your wallet.
