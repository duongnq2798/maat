# Deployments

| Network | Contract | Address | Tx | Date |
|---|---|---|---|---|
| Base mainnet | MarketCalendar | | | |
| Base mainnet | AerodromeSwapAdapter | | | |
| Base mainnet | AaveV4CreditAdapter | | | |
| Base mainnet | MandateVault | | | |

Owner = your wallet. The executor is your wallet at first, until you hand it to the CDP Server Wallet (see "Switch the executor to the CDP Server Wallet" below). Payee = the compute-expense wallet.

## Default mandate

`MaatConfig.defaultMandate` uses `maxPremiumBps = 100` (not 50): the premium of TWAP(1800s) against Chainlink, measured in session at `BLOCK_SESSION`, is 53 bps for NVDAc, 49 bps for GOOGLc and 29 bps for AAPLc.

Credit (Aave V4 MAG7 Spoke): `minHealthFactor = 1.5`, `targetHealthFactor = 2.0` (buffer included), `deriskWindow = 8h` (from 12:00 ET on Friday until 20:00 ET, when the feed stops; for a REGULAR session this is 12:00–16:00). The window also applies to the last session before a day off: Monday–Thursday when the next day is a holiday in `MarketCalendar`, for example Thursday 2026-12-24 (early close at 13:00, so the in-session window is 12:00–13:00) and Thursday 2026-12-31, which come before two holidays that fall on Fridays; also Wednesday 2026-11-25, before Thanksgiving. Borrowing is allowed only when the market is open and the HF after the borrow is ≥ 1.5 (≥ 2.0 inside the window). Repay and adding collateral are allowed even when the market is closed. When the vault is paused with `setPaused(true)`, REPAY still runs so that debt can always be reduced; SUPPLY, BORROW, WITHDRAW_COLLATERAL (along with BUY, SELL, PAY_EXPENSE) are refused with `VAULT_PAUSED`.

## Dry-run (no broadcast, no key needed)

Run it in `contracts/`. It uses placeholder addresses, for simulation only. The contract addresses printed here will be **different** on mainnet, and the four lines `deployer`, `owner`, `executor`, `expense payee` are only placeholder addresses, not your real addresses:

```bash
set -a; source .env; set +a
MAAT_DEPLOYER=0x0000000000000000000000000000000000000004 \
MAAT_OWNER=0x0000000000000000000000000000000000000001 \
MAAT_EXECUTOR=0x0000000000000000000000000000000000000002 \
MAAT_EXPENSE_PAYEE=0x0000000000000000000000000000000000000003 \
forge script script/Deploy.s.sol --fork-url "$BASE_RPC_URL"
```

The script prints `deployer`, `owner`, `executor` and `expense payee` before the contract addresses. To check the real addresses, use the simulation step with the real `.env` in the "Deploy mainnet" section below, not this dry-run.

The dry-run files (`contracts/broadcast/*/*/dry-run/`) are already in `.gitignore`. Whether to commit the file from the real run (`contracts/broadcast/Deploy.s.sol/8453/run-*.json`, which contains the txs and the deployer address, but no key) is the owner's decision.

## Checklist before broadcasting

- [ ] The deployer wallet has enough **ETH on Base** to pay gas (4 contracts). See the total estimated gas at the end of the dry-run output; fund extra, because gas prices change.
- [ ] `MAAT_DEPLOYER` is **exactly the address of the `--account` wallet** used to broadcast. The script precomputes the vault address from this wallet's nonce. If it is the wrong wallet, or the wallet sends another transaction between the simulation and the broadcast, the script can stop with `vault address mismatch` or a nonce error. `vault address mismatch` happens in the simulation step, before any transaction is sent, so no gas is lost: just simulate again. A nonce error during the broadcast (because the deployer wallet sent another transaction in between) can leave the calendar, the swap adapter and `AaveV4CreditAdapter` deployed but unused; in that case, redeploy from scratch.
- [ ] `MAAT_OWNER` is correct character for character. The owner is **immutable** on `MandateVault` and `MarketCalendar`: a mistyped address means **permanent loss of control** (you cannot withdraw funds or change the mandate). Check again with the `owner (immutable)` line in the output of the simulation step with the real `.env` ("Deploy mainnet" section), not the dry-run that uses placeholder addresses.
- [ ] `MAAT_EXECUTOR` and `MAAT_EXPENSE_PAYEE` are the correct addresses (they can be changed later, but a payee change must go through the 24h timelock).
- [ ] `--verify` needs `ETHERSCAN_API_KEY` in `contracts/.env` (an Etherscan v2 key works for Basescan). If the deploy finishes but verification fails, do not redeploy; run `forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL" --account maat-owner --resume --verify`.
- [ ] Fund the vault with `approve` and then `fund(amount)`. Do **not** transfer USDC straight into the vault: `notifyRevenue()` would record a direct transfer as revenue (`RevenueReceived`).
- [ ] To change the configuration later: `queueMandate` / `queueTokenConfig` / `queuePayee` (a public event with all parameters), wait 24h, then `apply*` within the 7 days after that; past that deadline the change expires (`ChangeExpired`) and must be queued again.

## Deploy mainnet (owner only, signed with your wallet)

The owner runs and signs the commands below.

```bash
cast wallet import maat-owner --interactive
cast wallet address --account maat-owner
```

The second command only prints the wallet's address (it signs nothing and sends nothing). Edit `contracts/.env`: set `MAAT_DEPLOYER` to the address just printed; set `MAAT_OWNER`, `MAAT_EXECUTOR` (temporarily your own wallet) and `MAAT_EXPENSE_PAYEE` all to your wallet address. Add `ETHERSCAN_API_KEY` (an Etherscan v2 key works for Basescan).

Before broadcasting, simulate again with the real `.env`: no environment variable overrides, no `--broadcast`, no key needed:

```bash
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url "$BASE_RPC_URL"
```

Read the output and check it yourself:

- The `deployer`, `owner (immutable)`, `executor` and `expense payee` lines match your wallet address character for character (the owner is immutable; a wrong one means permanent loss of control).
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

## Guard Service and S4 (owner only)

The guard has no wallet. Every step here that moves money is signed by a CDP account the owner controls.

### S4: can x402 pay straight into the vault?

1. Create `agent/.env.guard` from `agent/.env.guard.example`:
   - `BASE_RPC_URL`, `MAAT_VAULT`, `MAAT_EXECUTOR`;
   - `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`;
   - leave `GUARD_PAY_TO` and `GUARD_FACILITATOR_URL` empty;
   - no `CDP_WALLET_SECRET`.

   Run it: `cd agent && npm run guard`. Expect the log line `maat guard: … payTo=<vault> facilitator=cdp`. It stays in the foreground, so step 3 runs in a second terminal.
2. Create `agent/.env.s4`:
   - `MAAT_VAULT`, `BASE_RPC_URL`;
   - `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`;
   - optionally `S4_BUYER_ACCOUNT` (default `maat-s4-buyer`).

   This account is a separate buyer, never the executor.
3. Run `npm run s4:pay -- http://localhost:8080` once. The first run creates the buyer account and stops with `fund <address> with at least 0.01 USDC`. Send it 0.01–0.05 USDC on Base, then run again. The script:
   - signs only if the guard offers exactly 0.01 USDC on Base to the vault;
   - prints the settlement tx and, for information only, the vault's USDC before and after it;
   - ends with `S4 PASS` or one `S4 FAIL (…)` line, and decides from the USDC transfer to the vault in the settlement tx itself, which must be exactly 0.01 USDC.
4. On `S4 PASS`, the 0.01 USDC is in the vault, but it is below the agent's default `MAAT_REVENUE_MIN_USD` (0.05), so the agent records it only once at least 0.05 USDC of new revenue has arrived. To see it recorded right away, run the agent's next round with `MAAT_REVENUE_MIN_USD=0.01`. The round that records revenue must be live (`MAAT_MODE=live`, `npm run agent -- --once`): a dry-run round only journals it. That round sends `notifyRevenue()` (journal: `kind: "housekeeping", call: "notifyRevenue"`), and the `RevenueReceived` event is on Basescan.
5. Take the fallback below only when the `S4 FAIL (facilitator refused): …` line says the facilitator rejects the `payTo` (the vault is a contract address). For any other `S4 FAIL` (unfunded buyer, network error, reverted tx, wrong amount), fix that cause and run the script again. The fallback:
   - Set `GUARD_PAY_TO` to an address you hold, then restart the guard.
   - From time to time, move the collected USDC into the vault with a plain ERC-20 `transfer`. Do not use `fund()`, which does not count as revenue.
   - Automating that forward needs its own CDP account and policy, and its own plan.

### Public deploy (Fly.io)

From `agent/`:

`fly.guard.toml` builds `agent/Dockerfile`, the agent's container image, and runs the guard from it. Deploy from a checkout that has that file.

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
